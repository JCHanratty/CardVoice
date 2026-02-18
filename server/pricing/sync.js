const { scrapeEbaySold, filterOutliers, buildCardQuery, buildSetQuery, buildInsertSetQuery } = require('./scraper');
const config = require('./scraper-config.json');

class SyncService {
  constructor(db) {
    this.db = db;
    this.running = false;
    this.timer = null;
    this.intervalMs = 24 * 60 * 60 * 1000;
    this.enabled = true;
    this.lastSyncTime = null;
    this.syncLog = [];
    // Progress tracking
    this.progress = { current: 0, total: 0, currentItem: '' };
  }

  log(entry) {
    this.syncLog.unshift({ ...entry, timestamp: new Date().toISOString() });
    if (this.syncLog.length > 100) this.syncLog.pop();
  }

  start() {
    if (!this.enabled) return;

    const lastSnapshot = this.db.prepare(
      `SELECT MAX(snapshot_date) as last FROM price_snapshots`
    ).get();

    const lastDate = lastSnapshot?.last ? new Date(lastSnapshot.last) : null;
    const overdue = !lastDate || (Date.now() - lastDate.getTime() > this.intervalMs);

    if (overdue) {
      this.log({ type: 'info', message: 'Sync overdue, starting immediately' });
      this.runFullSync();
    }

    this.timer = setInterval(() => {
      if (this.enabled) this.runFullSync();
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    this.queue = [];
  }

  setInterval(ms) {
    this.intervalMs = ms;
    this.stop();
    this.start();
  }

  setEnabled(val) {
    this.enabled = val;
    if (!val) this.stop();
    else this.start();
  }

  getStatus() {
    return {
      running: this.running,
      enabled: this.enabled,
      intervalMs: this.intervalMs,
      lastSyncTime: this.lastSyncTime,
      progress: this.progress,
      log: this.syncLog.slice(0, 30),
    };
  }

  async runFullSync() {
    if (this.running) {
      this.log({ type: 'warn', message: 'Sync already running, skipping' });
      return;
    }
    this.running = true;
    this.progress = { current: 0, total: 0, currentItem: 'Preparing...' };
    this.log({ type: 'info', message: 'Starting full sync' });

    try {
      const sets = this.db.prepare(`SELECT * FROM card_sets WHERE sync_enabled = 1`).all();

      // Build work list to count total items
      const workItems = [];
      for (const set of sets) {
        const enabledInsertTypes = this.db.prepare(
          `SELECT * FROM set_insert_types WHERE set_id = ? AND pricing_enabled = 1`
        ).all(set.id);
        const hasMetadata = this.db.prepare(
          `SELECT COUNT(*) as cnt FROM set_insert_types WHERE set_id = ?`
        ).get(set.id).cnt > 0;

        if (enabledInsertTypes.length > 0) {
          for (const it of enabledInsertTypes) {
            if (it.pricing_mode === 'per_card') {
              const cardCount = this.db.prepare(
                `SELECT COUNT(*) as cnt FROM cards WHERE set_id = ? AND insert_type = ? AND qty > 0`
              ).get(set.id, it.name).cnt;
              workItems.push({ type: 'insert_per_card', set, insertType: it, cardCount });
            } else {
              workItems.push({ type: 'insert_full_set', set, insertType: it });
            }
          }
        } else if (!hasMetadata) {
          workItems.push({ type: 'legacy_set', set });
        }
      }

      const tracked = this.db.prepare(`
        SELECT tc.*, c.card_number, c.player, c.parallel, cs.name as set_name, cs.year as set_year
        FROM tracked_cards tc
        JOIN cards c ON tc.card_id = c.id
        JOIN card_sets cs ON c.set_id = cs.id
      `).all();

      for (const card of tracked) {
        workItems.push({ type: 'tracked_card', card });
      }

      // Calculate total API calls
      let totalCalls = 0;
      for (const item of workItems) {
        if (item.type === 'insert_per_card') totalCalls += (item.cardCount || 0);
        else totalCalls += 1;
      }
      this.progress = { current: 0, total: totalCalls, currentItem: 'Starting...' };

      if (totalCalls === 0) {
        this.log({ type: 'warn', message: 'Nothing to sync. Enable sync on at least one set or insert type, or star individual cards.' });
        this.lastSyncTime = new Date().toISOString();
        return;
      }

      this.log({ type: 'info', message: `${sets.length} set(s), ${tracked.length} tracked card(s), ${totalCalls} total API calls` });

      // Execute work items
      let completed = 0;
      for (const item of workItems) {
        if (item.type === 'legacy_set') {
          this.progress.currentItem = `Set: ${item.set.year} ${item.set.name}`;
          await this._syncSetPrice(item.set);
          completed++;
          this.progress.current = completed;
          await this._delay(config.rateLimitMs);
        } else if (item.type === 'insert_full_set') {
          this.progress.currentItem = `${item.set.name} / ${item.insertType.name}`;
          await this._syncInsertTypeFullSet(item.set, item.insertType);
          completed++;
          this.progress.current = completed;
          await this._delay(config.rateLimitMs);
        } else if (item.type === 'insert_per_card') {
          // Per-card sync updates progress internally
          completed = await this._syncInsertTypePerCard(item.set, item.insertType, completed);
          this.progress.current = completed;
        } else if (item.type === 'tracked_card') {
          this.progress.currentItem = `Card: #${item.card.card_number} ${item.card.player || ''}`;
          await this._syncCardPrice(item.card);
          completed++;
          this.progress.current = completed;
          await this._delay(config.rateLimitMs);
        }
      }

      this.progress.currentItem = 'Computing snapshots...';
      this._computeSnapshots();

      this.lastSyncTime = new Date().toISOString();
      this.progress = { current: totalCalls, total: totalCalls, currentItem: 'Done' };
      this.log({ type: 'success', message: `Sync complete. ${sets.length} sets, ${tracked.length} tracked cards, ${totalCalls} API calls.` });
    } catch (err) {
      this.log({ type: 'error', message: `Sync failed: ${err.message}` });
      this.progress.currentItem = `Error: ${err.message}`;
    } finally {
      this.running = false;
    }
  }

  // Legacy whole-set sync (for sets without insert type metadata)
  async _syncSetPrice(set) {
    const query = buildSetQuery(set);
    this.log({ type: 'info', message: `Fetching set price: ${set.name} (${set.year})` });

    const { error, results } = await scrapeEbaySold(query);
    if (error) {
      this.log({ type: 'error', message: `Set "${set.name}": ${error}` });
      return;
    }

    const { filtered, median } = filterOutliers(results, { skipLots: false });
    if (filtered.length === 0) {
      this.log({ type: 'warn', message: `Set "${set.name}": no results found` });
      return;
    }

    const insert = this.db.prepare(`
      INSERT INTO price_history (set_id, price, sold_date, listing_title, listing_url, condition, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const tx = this.db.transaction(() => {
      for (const r of filtered) {
        insert.run(set.id, r.price, r.soldDate, r.title, r.listingUrl, r.condition);
      }
    });
    tx();

    this.log({ type: 'success', message: `Set "${set.name}": ${filtered.length} results, median $${median?.toFixed(2)}` });
  }

  // Insert type full-set sync: one query for "YEAR NAME INSERT complete set"
  async _syncInsertTypeFullSet(set, insertType) {
    const query = buildInsertSetQuery(set, insertType.name, insertType.search_query_override);
    this.log({ type: 'info', message: `Fetching insert set price: ${set.name} / ${insertType.name}` });

    const { error, results } = await scrapeEbaySold(query);
    if (error) {
      this.log({ type: 'error', message: `Insert "${insertType.name}": ${error}` });
      return;
    }

    const { filtered, median } = filterOutliers(results, { skipLots: false });
    if (filtered.length === 0) {
      this.log({ type: 'warn', message: `Insert "${insertType.name}": no results found` });
      return;
    }

    const insert = this.db.prepare(`
      INSERT INTO price_history (set_id, insert_type_id, price, sold_date, listing_title, listing_url, condition, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const tx = this.db.transaction(() => {
      for (const r of filtered) {
        insert.run(set.id, insertType.id, r.price, r.soldDate, r.title, r.listingUrl, r.condition);
      }
    });
    tx();

    this.log({ type: 'success', message: `Insert "${insertType.name}": ${filtered.length} results, median $${median?.toFixed(2)}` });
  }

  // Insert type per-card sync: one query per card in the insert type
  async _syncInsertTypePerCard(set, insertType, completedSoFar) {
    const cards = this.db.prepare(
      `SELECT * FROM cards WHERE set_id = ? AND insert_type = ? AND qty > 0`
    ).all(set.id, insertType.name);

    this.log({ type: 'info', message: `Per-card sync: ${set.name} / ${insertType.name} (${cards.length} owned cards)` });
    let completed = completedSoFar;

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      this.progress.currentItem = `${insertType.name}: #${card.card_number} ${card.player || ''} (${i + 1}/${cards.length})`;

      const query = buildCardQuery(card, set);
      const { error, results } = await scrapeEbaySold(query);

      if (error) {
        this.log({ type: 'error', message: `Card #${card.card_number} in "${insertType.name}": ${error}` });
        completed++;
        this.progress.current = completed;
        await this._delay(config.rateLimitMs);
        continue;
      }

      const { filtered, median } = filterOutliers(results);
      if (filtered.length === 0) {
        completed++;
        this.progress.current = completed;
        await this._delay(config.rateLimitMs);
        continue;
      }

      const insert = this.db.prepare(`
        INSERT INTO price_history (card_id, set_id, insert_type_id, price, sold_date, listing_title, listing_url, condition, fetched_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      `);

      const tx = this.db.transaction(() => {
        for (const r of filtered) {
          insert.run(card.id, set.id, insertType.id, r.price, r.soldDate, r.title, r.listingUrl, r.condition);
        }
      });
      tx();

      completed++;
      this.progress.current = completed;
      await this._delay(config.rateLimitMs);
    }

    this.log({ type: 'success', message: `Per-card sync done: ${insertType.name} (${cards.length} cards)` });
    return completed;
  }

  async _syncCardPrice(card) {
    const query = card.search_query || buildCardQuery(
      { card_number: card.card_number, player: card.player, parallel: card.parallel },
      { name: card.set_name, year: card.set_year }
    );

    this.log({ type: 'info', message: `Fetching card: #${card.card_number} ${card.player || ''}` });

    const { error, results } = await scrapeEbaySold(query);
    if (error) {
      this.log({ type: 'error', message: `Card #${card.card_number}: ${error}` });
      return;
    }

    const { filtered, median } = filterOutliers(results);
    if (filtered.length === 0) {
      this.log({ type: 'warn', message: `Card #${card.card_number}: no results found` });
      return;
    }

    const insert = this.db.prepare(`
      INSERT INTO price_history (card_id, price, sold_date, listing_title, listing_url, condition, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `);

    const update = this.db.prepare(`UPDATE tracked_cards SET last_synced = datetime('now') WHERE id = ?`);

    const tx = this.db.transaction(() => {
      for (const r of filtered) {
        insert.run(card.card_id, r.price, r.soldDate, r.title, r.listingUrl, r.condition);
      }
      update.run(card.id);
    });
    tx();

    this.log({ type: 'success', message: `Card #${card.card_number}: ${filtered.length} results, median $${median?.toFixed(2)}` });
  }

  _computeSnapshots() {
    const today = new Date().toISOString().split('T')[0];

    // --- Legacy set snapshots (no insert_type_id) ---
    const legacySets = this.db.prepare(
      `SELECT DISTINCT set_id FROM price_history WHERE set_id IS NOT NULL AND insert_type_id IS NULL`
    ).all();

    const deleteSetSnap = this.db.prepare(
      `DELETE FROM price_snapshots WHERE set_id = ? AND card_id IS NULL AND insert_type_id IS NULL AND snapshot_date = ?`
    );
    const deleteCardSnap = this.db.prepare(
      `DELETE FROM price_snapshots WHERE card_id = ? AND set_id IS NULL AND insert_type_id IS NULL AND snapshot_date = ?`
    );
    const deleteInsertTypeSnap = this.db.prepare(
      `DELETE FROM price_snapshots WHERE insert_type_id = ? AND card_id IS NULL AND snapshot_date = ?`
    );
    const deleteInsertTypeCardSnap = this.db.prepare(
      `DELETE FROM price_snapshots WHERE card_id = ? AND insert_type_id = ? AND snapshot_date = ?`
    );
    const insertSnapshot = this.db.prepare(
      `INSERT INTO price_snapshots (set_id, card_id, insert_type_id, median_price, snapshot_date) VALUES (?, ?, ?, ?, ?)`
    );

    const tx = this.db.transaction(() => {
      // Legacy set-level snapshots
      for (const { set_id } of legacySets) {
        const prices = this.db.prepare(`
          SELECT price FROM price_history
          WHERE set_id = ? AND insert_type_id IS NULL AND fetched_at >= datetime('now', '-7 days')
          ORDER BY price
        `).all(set_id).map(r => r.price);

        if (prices.length === 0) continue;
        const median = this._median(prices);
        deleteSetSnap.run(set_id, today);
        insertSnapshot.run(set_id, null, null, median, today);
      }

      // --- Insert type snapshots (full_set mode) ---
      const insertTypeSets = this.db.prepare(
        `SELECT DISTINCT set_id, insert_type_id FROM price_history WHERE insert_type_id IS NOT NULL AND card_id IS NULL`
      ).all();

      for (const { set_id, insert_type_id } of insertTypeSets) {
        const prices = this.db.prepare(`
          SELECT price FROM price_history
          WHERE set_id = ? AND insert_type_id = ? AND card_id IS NULL AND fetched_at >= datetime('now', '-7 days')
          ORDER BY price
        `).all(set_id, insert_type_id).map(r => r.price);

        if (prices.length === 0) continue;
        const median = this._median(prices);
        deleteInsertTypeSnap.run(insert_type_id, today);
        insertSnapshot.run(set_id, null, insert_type_id, median, today);
      }

      // --- Insert type per-card snapshots ---
      const insertTypeCards = this.db.prepare(
        `SELECT DISTINCT card_id, insert_type_id FROM price_history WHERE insert_type_id IS NOT NULL AND card_id IS NOT NULL`
      ).all();

      for (const { card_id, insert_type_id } of insertTypeCards) {
        const prices = this.db.prepare(`
          SELECT price FROM price_history
          WHERE card_id = ? AND insert_type_id = ? AND fetched_at >= datetime('now', '-7 days')
          ORDER BY price
        `).all(card_id, insert_type_id).map(r => r.price);

        if (prices.length === 0) continue;
        const median = this._median(prices);
        deleteInsertTypeCardSnap.run(card_id, insert_type_id, today);
        insertSnapshot.run(null, card_id, insert_type_id, median, today);
      }

      // --- Tracked card snapshots (no insert_type_id) ---
      const cards = this.db.prepare(
        `SELECT DISTINCT card_id FROM price_history WHERE card_id IS NOT NULL AND insert_type_id IS NULL`
      ).all();

      for (const { card_id } of cards) {
        const prices = this.db.prepare(`
          SELECT price FROM price_history
          WHERE card_id = ? AND insert_type_id IS NULL AND fetched_at >= datetime('now', '-7 days')
          ORDER BY price
        `).all(card_id).map(r => r.price);

        if (prices.length === 0) continue;
        const median = this._median(prices);
        deleteCardSnap.run(card_id, today);
        insertSnapshot.run(null, card_id, null, median, today);
      }
    });
    tx();

    this.log({ type: 'info', message: 'Snapshots computed' });
  }

  _median(sortedPrices) {
    const len = sortedPrices.length;
    if (len === 0) return null;
    const mid = Math.floor(len / 2);
    return len % 2 === 0
      ? (sortedPrices[mid - 1] + sortedPrices[mid]) / 2
      : sortedPrices[mid];
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { SyncService };
