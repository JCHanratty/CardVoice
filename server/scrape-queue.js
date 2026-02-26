/**
 * ScrapeQueueProcessor — orchestrates batch TCDB scraping.
 *
 * Processes a queue of sets one at a time: resolves TCDB set IDs via fuzzy
 * matching, scrapes each set to a per-item catalog.db, serializes for preview,
 * and imports via mergeCatalog().
 */
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

class ScrapeQueueProcessor {
  /**
   * @param {import('better-sqlite3').Database} db - User's main database
   * @param {import('./tcdb-service').TcdbService} tcdbService - TCDB scraper service
   * @param {object} [opts]
   * @param {string} [opts.scrapeDir] - Directory for per-item catalog.db files
   */
  constructor(db, tcdbService, opts = {}) {
    this.db = db;
    this.tcdbService = tcdbService;
    this.scrapeDir = opts.scrapeDir || path.join(__dirname, '..', 'scrape-queue');
    this._running = false;
    this._stopRequested = false;
    this._currentItem = null;

    fs.mkdirSync(this.scrapeDir, { recursive: true });
  }

  // ─── Queue CRUD ───────────────────────────────────────────────────────

  /**
   * Insert an array of queue items.
   * @param {Array<{priority: number, year: number, brand: string, set_name: string, tcdb_search: string}>} items
   */
  loadQueue(items) {
    const insert = this.db.prepare(`
      INSERT INTO scrape_queue (priority, year, brand, set_name, tcdb_search, status)
      VALUES (?, ?, ?, ?, ?, 'pending')
    `);
    const run = this.db.transaction(() => {
      for (const item of items) {
        insert.run(
          item.priority,
          item.year,
          item.brand,
          item.set_name,
          item.tcdb_search || item.set_name
        );
      }
    });
    run();
  }

  /**
   * Return all queue items ordered by priority.
   */
  getQueue() {
    return this.db.prepare('SELECT * FROM scrape_queue ORDER BY priority ASC').all();
  }

  /**
   * Return a single queue item by id.
   */
  getItem(id) {
    return this.db.prepare('SELECT * FROM scrape_queue WHERE id = ?').get(id);
  }

  /**
   * Delete a single queue item and clean up its catalog files.
   */
  deleteItem(id) {
    const item = this.getItem(id);
    if (item && item.catalog_path) {
      this._cleanupCatalogDir(item.catalog_path);
    }
    this.db.prepare('DELETE FROM scrape_queue WHERE id = ?').run(id);
  }

  /**
   * Delete all queue items and clean up all catalog files.
   */
  clearQueue() {
    const items = this.db.prepare('SELECT catalog_path FROM scrape_queue WHERE catalog_path IS NOT NULL').all();
    for (const item of items) {
      this._cleanupCatalogDir(item.catalog_path);
    }
    this.db.prepare('DELETE FROM scrape_queue').run();
  }

  /**
   * Remove the catalog directory for an item.
   */
  _cleanupCatalogDir(catalogPath) {
    try {
      const dir = path.dirname(catalogPath);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (_) { /* best effort */ }
  }

  // ─── Status ───────────────────────────────────────────────────────────

  /**
   * Return current processing status.
   */
  getStatus() {
    const total = this.db.prepare('SELECT COUNT(*) as cnt FROM scrape_queue').get().cnt;
    const completed = this.db.prepare("SELECT COUNT(*) as cnt FROM scrape_queue WHERE status = 'scraped' OR status = 'imported'").get().cnt;
    const errors = this.db.prepare("SELECT COUNT(*) as cnt FROM scrape_queue WHERE status = 'error'").get().cnt;
    const needsReview = this.db.prepare("SELECT COUNT(*) as cnt FROM scrape_queue WHERE status = 'needs_review'").get().cnt;

    return {
      running: this._running,
      currentItem: this._currentItem,
      total,
      completed,
      errors,
      needsReview,
    };
  }

  // ─── Processing ───────────────────────────────────────────────────────

  /**
   * Start processing the queue. Fire-and-forget — caller does not await.
   * Processes pending items in priority order with a 15-second delay between items.
   */
  async start() {
    if (this._running) return;
    this._running = true;
    this._stopRequested = false;

    try {
      while (!this._stopRequested) {
        const item = this.db.prepare(
          "SELECT * FROM scrape_queue WHERE status = 'pending' ORDER BY priority ASC LIMIT 1"
        ).get();

        if (!item) break;

        this._currentItem = item;
        try {
          await this._processItem(item);
        } catch (err) {
          this.db.prepare(
            "UPDATE scrape_queue SET status = 'error', error_message = ?, updated_at = datetime('now','localtime') WHERE id = ?"
          ).run(err.message, item.id);
        }
        this._currentItem = null;

        // 15-second delay between items (unless stop requested)
        if (!this._stopRequested) {
          await new Promise(resolve => setTimeout(resolve, 15000));
        }
      }
    } finally {
      this._running = false;
      this._currentItem = null;
    }
  }

  /**
   * Signal the processor to stop after the current item finishes.
   */
  stop() {
    this._stopRequested = true;
  }

  /**
   * Process a single queue item: resolve set ID, scrape, serialize, mark scraped.
   */
  async _processItem(item) {
    // Step 1: Resolve TCDB set ID if not already assigned
    if (!item.tcdb_set_id) {
      const resolved = await this._resolveSetId(item);
      if (!resolved) return; // needs_review — stop processing this item
      item.tcdb_set_id = resolved;
    }

    // Step 2: Scrape the set to a per-item catalog.db
    const itemDir = path.join(this.scrapeDir, `item-${item.id}`);
    fs.mkdirSync(itemDir, { recursive: true });

    await this.tcdbService._runScraperRaw([
      '--set-id', String(item.tcdb_set_id),
      '--no-images',
      '--json',
      '--output-dir', itemDir,
      '--year', String(item.year),
    ]);

    const catalogPath = path.join(itemDir, 'tcdb-catalog.db');
    if (!fs.existsSync(catalogPath)) {
      throw new Error('Scraper did not produce catalog.db');
    }

    // Step 3: Serialize the catalog for preview
    const serialized = this._serializeCatalog(catalogPath);

    // Step 4: Mark as scraped
    this.db.prepare(`
      UPDATE scrape_queue
      SET status = 'scraped',
          tcdb_set_id = ?,
          catalog_path = ?,
          scraped_data = ?,
          error_message = NULL,
          updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(item.tcdb_set_id, catalogPath, JSON.stringify(serialized), item.id);
  }

  /**
   * Resolve the TCDB set ID for a queue item by fuzzy-matching the search string
   * against the year's set listing.
   *
   * @returns {number|null} The resolved set ID, or null if needs_review
   */
  async _resolveSetId(item) {
    const searchText = item.tcdb_search || item.set_name;

    // Fetch year's set list from TCDB
    const sets = await this.tcdbService._runScraperRaw([
      '--list', '--year', String(item.year), '--json',
    ]);

    if (!Array.isArray(sets) || sets.length === 0) {
      throw new Error(`No sets found on TCDB for year ${item.year}`);
    }

    // Normalize: strip "baseball" (case-insensitive), collapse whitespace, lowercase
    const normalize = (str) =>
      str.replace(/\bbaseball\b/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();

    const searchTokens = new Set(normalize(searchText).split(' ').filter(Boolean));

    // Score each set by Jaccard similarity of word tokens
    const scored = sets.map(s => {
      const nameTokens = new Set(normalize(s.name).split(' ').filter(Boolean));
      const intersection = new Set([...searchTokens].filter(t => nameTokens.has(t)));
      const union = new Set([...searchTokens, ...nameTokens]);
      const score = union.size > 0 ? intersection.size / union.size : 0;
      return { ...s, score };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    const best = scored[0];

    if (best.score >= 0.6) {
      // Auto-resolve
      this.db.prepare(
        "UPDATE scrape_queue SET tcdb_set_id = ?, updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(best.tcdb_id, item.id);
      return best.tcdb_id;
    }

    // Needs review — store top 5 candidates
    const candidates = scored.slice(0, 5).map(s => ({
      tcdb_id: s.tcdb_id,
      name: s.name,
      score: Math.round(s.score * 100) / 100,
      card_count: s.card_count,
    }));

    this.db.prepare(`
      UPDATE scrape_queue
      SET status = 'needs_review',
          scraped_data = ?,
          updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(JSON.stringify({ candidates }), item.id);

    return null;
  }

  // ─── Catalog Serialization ────────────────────────────────────────────

  /**
   * Open a catalog.db read-only and serialize all tables to a plain object.
   * @param {string} catalogPath - Path to catalog.db
   * @returns {{sets: Array, cards: Array, insertTypes: Array, parallels: Array, junctions: Array}}
   */
  _serializeCatalog(catalogPath) {
    const catDb = new Database(catalogPath, { readonly: true });
    try {
      const sets = catDb.prepare('SELECT * FROM card_sets').all();
      const cards = catDb.prepare('SELECT * FROM cards').all();
      const insertTypes = catDb.prepare('SELECT * FROM set_insert_types').all();
      const parallels = catDb.prepare('SELECT * FROM set_parallels').all();

      let junctions = [];
      try {
        junctions = catDb.prepare('SELECT * FROM insert_type_parallels').all();
      } catch (_) { /* table may not exist */ }

      return { sets, cards, insertTypes, parallels, junctions };
    } finally {
      catDb.close();
    }
  }

  // ─── Edit Operations ──────────────────────────────────────────────────

  /**
   * Apply a list of edit operations to an item's catalog.db, then re-serialize
   * and update scraped_data in the main queue.
   *
   * @param {number} itemId
   * @param {Array<{type: string, ...}>} operations
   */
  applyEdits(itemId, operations) {
    const item = this.getItem(itemId);
    if (!item || !item.catalog_path) {
      throw new Error(`Item ${itemId} has no catalog to edit`);
    }

    const catDb = new Database(item.catalog_path);
    try {
      const doEdits = catDb.transaction(() => {
        for (const op of operations) {
          switch (op.type) {
            case 'rename_set':
              catDb.prepare('UPDATE card_sets SET name = ? WHERE id = ?')
                .run(op.name, op.setId);
              break;

            case 'update_set_brand':
              catDb.prepare('UPDATE card_sets SET brand = ? WHERE id = ?')
                .run(op.brand, op.setId);
              break;

            case 'remove_card':
              catDb.prepare('DELETE FROM cards WHERE id = ?').run(op.cardId);
              break;

            case 'rename_insert':
              catDb.prepare('UPDATE set_insert_types SET name = ? WHERE id = ? AND set_id = ?')
                .run(op.newName, op.insertId, op.setId);
              catDb.prepare('UPDATE cards SET insert_type = ? WHERE set_id = ? AND insert_type = ?')
                .run(op.newName, op.setId, op.oldName);
              break;

            case 'remove_insert': {
              catDb.prepare('DELETE FROM cards WHERE set_id = ? AND insert_type = (SELECT name FROM set_insert_types WHERE id = ? AND set_id = ?)')
                .run(op.setId, op.insertId, op.setId);
              // Clean up junctions referencing this insert type
              try {
                catDb.prepare('DELETE FROM insert_type_parallels WHERE insert_type_id = ?')
                  .run(op.insertId);
              } catch (_) { /* junction table may not exist */ }
              catDb.prepare('DELETE FROM set_insert_types WHERE id = ? AND set_id = ?')
                .run(op.insertId, op.setId);
              break;
            }

            case 'rename_parallel':
              catDb.prepare('UPDATE set_parallels SET name = ? WHERE id = ? AND set_id = ?')
                .run(op.newName, op.parallelId, op.setId);
              catDb.prepare('UPDATE cards SET parallel = ? WHERE set_id = ? AND parallel = ?')
                .run(op.newName, op.setId, op.oldName);
              break;

            case 'remove_parallel': {
              catDb.prepare('DELETE FROM cards WHERE set_id = ? AND parallel = (SELECT name FROM set_parallels WHERE id = ? AND set_id = ?)')
                .run(op.setId, op.parallelId, op.setId);
              // Clean up junctions referencing this parallel
              try {
                catDb.prepare('DELETE FROM insert_type_parallels WHERE parallel_id = ?')
                  .run(op.parallelId);
              } catch (_) { /* junction table may not exist */ }
              catDb.prepare('DELETE FROM set_parallels WHERE id = ? AND set_id = ?')
                .run(op.parallelId, op.setId);
              break;
            }

            case 'insert_to_parallel': {
              // Move an insert type to become a parallel under a parent insert
              const ins = catDb.prepare('SELECT * FROM set_insert_types WHERE id = ?').get(op.insertId);
              if (!ins) break;

              const parentIns = catDb.prepare('SELECT * FROM set_insert_types WHERE id = ?').get(op.parentInsert);
              if (!parentIns) break;

              // Create parallel entry
              const parInfo = catDb.prepare(
                "INSERT INTO set_parallels (set_id, name, variation_type) VALUES (?, ?, 'parallel')"
              ).run(ins.set_id, ins.name);
              const newParallelId = Number(parInfo.lastInsertRowid);

              // Create junction to parent insert
              try {
                catDb.prepare(
                  'INSERT INTO insert_type_parallels (insert_type_id, parallel_id) VALUES (?, ?)'
                ).run(op.parentInsert, newParallelId);
              } catch (_) { /* junction table may not exist */ }

              // Update cards: change insert_type to parent's name, set parallel to this name
              catDb.prepare(
                'UPDATE cards SET insert_type = ?, parallel = ? WHERE set_id = ? AND insert_type = ?'
              ).run(parentIns.name, ins.name, ins.set_id, ins.name);

              // Remove old insert type and its junctions
              try {
                catDb.prepare('DELETE FROM insert_type_parallels WHERE insert_type_id = ?')
                  .run(op.insertId);
              } catch (_) { /* junction table may not exist */ }
              catDb.prepare('DELETE FROM set_insert_types WHERE id = ?').run(op.insertId);
              break;
            }

            case 'parallel_to_insert': {
              // Move a parallel to become its own insert type
              const par = catDb.prepare('SELECT * FROM set_parallels WHERE id = ?').get(op.parallelId);
              if (!par) break;

              // Create new insert type
              const insInfo = catDb.prepare(
                "INSERT INTO set_insert_types (set_id, name, card_count, section_type) VALUES (?, ?, 0, 'insert')"
              ).run(par.set_id, par.name);
              const newInsertId = Number(insInfo.lastInsertRowid);

              // Update cards: change parallel field to '', set insert_type to this name
              catDb.prepare(
                'UPDATE cards SET insert_type = ?, parallel = \'\' WHERE set_id = ? AND parallel = ?'
              ).run(par.name, par.set_id, par.name);

              // Remove junction entries
              try {
                catDb.prepare('DELETE FROM insert_type_parallels WHERE parallel_id = ?')
                  .run(op.parallelId);
              } catch (_) { /* junction table may not exist */ }

              // Delete the old parallel
              catDb.prepare('DELETE FROM set_parallels WHERE id = ?').run(op.parallelId);

              // Update card_count on new insert type
              const cnt = catDb.prepare(
                'SELECT COUNT(*) as cnt FROM cards WHERE set_id = ? AND insert_type = ?'
              ).get(par.set_id, par.name);
              catDb.prepare('UPDATE set_insert_types SET card_count = ? WHERE id = ?')
                .run(cnt.cnt, newInsertId);
              break;
            }

            default:
              throw new Error(`Unknown edit operation: ${op.type}`);
          }
        }

        // Recount totals after all edits
        this._recountTotals(catDb);
      });

      doEdits();

      // Re-serialize and update scraped_data in the main DB
      const serialized = this._serializeCatalog(item.catalog_path);
      this.db.prepare(
        "UPDATE scrape_queue SET scraped_data = ?, updated_at = datetime('now','localtime') WHERE id = ?"
      ).run(JSON.stringify(serialized), itemId);
    } finally {
      catDb.close();
    }
  }

  /**
   * Recount card_sets.total_cards and set_insert_types.card_count in a catalog.db.
   * @param {import('better-sqlite3').Database} catDb
   */
  _recountTotals(catDb) {
    // Recount card_sets.total_cards
    const sets = catDb.prepare('SELECT id FROM card_sets').all();
    for (const s of sets) {
      const cnt = catDb.prepare('SELECT COUNT(*) as cnt FROM cards WHERE set_id = ?').get(s.id);
      catDb.prepare('UPDATE card_sets SET total_cards = ? WHERE id = ?').run(cnt.cnt, s.id);
    }

    // Recount set_insert_types.card_count
    const insertTypes = catDb.prepare('SELECT id, set_id, name FROM set_insert_types').all();
    for (const it of insertTypes) {
      const cnt = catDb.prepare(
        'SELECT COUNT(*) as cnt FROM cards WHERE set_id = ? AND insert_type = ?'
      ).get(it.set_id, it.name);
      catDb.prepare('UPDATE set_insert_types SET card_count = ? WHERE id = ?').run(cnt.cnt, it.id);
    }
  }

  // ─── Import ───────────────────────────────────────────────────────────

  /**
   * Import a single scraped item into the user's DB via mergeCatalog().
   * @param {number} itemId
   * @returns {object} Merge result
   */
  importItem(itemId) {
    const item = this.getItem(itemId);
    if (!item) throw new Error(`Queue item ${itemId} not found`);
    if (!item.catalog_path) throw new Error(`Item ${itemId} has no catalog to import`);

    const { mergeCatalog } = require('./catalog-merge');
    const result = mergeCatalog(this.db, { catalogPath: item.catalog_path, force: true });

    // Find the imported set's card_sets.id by matching name + year from the catalog
    let cardSetId = null;
    try {
      const serialized = item.scraped_data ? JSON.parse(item.scraped_data) : null;
      if (serialized && serialized.sets && serialized.sets.length > 0) {
        const catSet = serialized.sets[0];
        const row = this.db.prepare('SELECT id FROM card_sets WHERE name = ? AND year = ?')
          .get(catSet.name, catSet.year);
        if (row) cardSetId = row.id;
      }
    } catch (_) { /* best effort */ }

    this.db.prepare(`
      UPDATE scrape_queue
      SET status = 'imported',
          card_set_id = ?,
          updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(cardSetId, itemId);

    return result;
  }

  /**
   * Import all items with status 'scraped' in priority order.
   * @returns {Array<{itemId: number, result: object}>}
   */
  importAllScraped() {
    const items = this.db.prepare(
      "SELECT * FROM scrape_queue WHERE status = 'scraped' ORDER BY priority ASC"
    ).all();

    const results = [];
    for (const item of items) {
      try {
        const result = this.importItem(item.id);
        results.push({ itemId: item.id, result });
      } catch (err) {
        results.push({ itemId: item.id, error: err.message });
      }
    }
    return results;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  /**
   * Manually assign a TCDB set ID and reset needs_review to pending.
   */
  assignSetId(itemId, tcdbSetId) {
    this.db.prepare(`
      UPDATE scrape_queue
      SET tcdb_set_id = ?,
          status = 'pending',
          error_message = NULL,
          updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(tcdbSetId, itemId);
  }

  /**
   * Mark an item as skipped.
   */
  skipItem(itemId) {
    this.db.prepare(
      "UPDATE scrape_queue SET status = 'skipped', updated_at = datetime('now','localtime') WHERE id = ?"
    ).run(itemId);
  }

  /**
   * Reset an item to pending and delete old catalog files.
   */
  rescrapeItem(itemId) {
    const item = this.getItem(itemId);
    if (item && item.catalog_path) {
      this._cleanupCatalogDir(item.catalog_path);
    }
    this.db.prepare(`
      UPDATE scrape_queue
      SET status = 'pending',
          scraped_data = NULL,
          catalog_path = NULL,
          error_message = NULL,
          updated_at = datetime('now','localtime')
      WHERE id = ?
    `).run(itemId);
  }
}

module.exports = { ScrapeQueueProcessor };
