const { scrapeEbaySold, filterOutliers, buildCardQuery, buildSetQuery } = require('./scraper');
const config = require('./scraper-config.json');

class SyncService {
  constructor(db) {
    this.db = db;
    this.queue = [];
    this.running = false;
    this.timer = null;
    this.intervalMs = 24 * 60 * 60 * 1000;
    this.enabled = true;
    this.lastSyncTime = null;
    this.syncLog = [];
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
      queueLength: this.queue.length,
      log: this.syncLog.slice(0, 20),
    };
  }

  async runFullSync() {
    if (this.running) {
      this.log({ type: 'warn', message: 'Sync already running, skipping' });
      return;
    }
    this.running = true;
    this.log({ type: 'info', message: 'Starting full sync' });

    try {
      const sets = this.db.prepare(`SELECT * FROM card_sets`).all();
      for (const set of sets) {
        await this._syncSetPrice(set);
        await this._delay(config.rateLimitMs);
      }

      const tracked = this.db.prepare(`
        SELECT tc.*, c.card_number, c.player, c.parallel, cs.name as set_name, cs.year as set_year
        FROM tracked_cards tc
        JOIN cards c ON tc.card_id = c.id
        JOIN card_sets cs ON c.set_id = cs.id
      `).all();

      for (const card of tracked) {
        await this._syncCardPrice(card);
        await this._delay(config.rateLimitMs);
      }

      this._computeSnapshots();

      this.lastSyncTime = new Date().toISOString();
      this.log({ type: 'success', message: `Sync complete. ${sets.length} sets, ${tracked.length} tracked cards.` });
    } catch (err) {
      this.log({ type: 'error', message: `Sync failed: ${err.message}` });
    } finally {
      this.running = false;
    }
  }

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

    const sets = this.db.prepare(`SELECT DISTINCT set_id FROM price_history WHERE set_id IS NOT NULL`).all();
    const upsertSnapshot = this.db.prepare(`
      INSERT INTO price_snapshots (set_id, card_id, median_price, snapshot_date)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(set_id, card_id, snapshot_date) DO UPDATE SET median_price = excluded.median_price
    `);

    const tx = this.db.transaction(() => {
      for (const { set_id } of sets) {
        const prices = this.db.prepare(`
          SELECT price FROM price_history
          WHERE set_id = ? AND fetched_at >= datetime('now', '-7 days')
          ORDER BY price
        `).all(set_id).map(r => r.price);

        if (prices.length === 0) continue;
        const mid = Math.floor(prices.length / 2);
        const median = prices.length % 2 === 0
          ? (prices[mid - 1] + prices[mid]) / 2
          : prices[mid];
        upsertSnapshot.run(set_id, null, median, today);
      }

      const cards = this.db.prepare(`SELECT DISTINCT card_id FROM price_history WHERE card_id IS NOT NULL`).all();
      for (const { card_id } of cards) {
        const prices = this.db.prepare(`
          SELECT price FROM price_history
          WHERE card_id = ? AND fetched_at >= datetime('now', '-7 days')
          ORDER BY price
        `).all(card_id).map(r => r.price);

        if (prices.length === 0) continue;
        const mid = Math.floor(prices.length / 2);
        const median = prices.length % 2 === 0
          ? (prices[mid - 1] + prices[mid]) / 2
          : prices[mid];
        upsertSnapshot.run(null, card_id, median, today);
      }
    });
    tx();

    this.log({ type: 'info', message: 'Snapshots computed' });
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { SyncService };
