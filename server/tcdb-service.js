/**
 * TcdbService — spawns the Python TCDB scraper as a child process.
 * Exposes browse/preview/import with status polling for the admin UI.
 */
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

class TcdbService {
  constructor(opts = {}) {
    this.scraperDir = opts.scraperDir || path.join(__dirname, '..', 'tcdb-scraper');
    this.outputDir = opts.outputDir || path.join(this.scraperDir, 'output');
    this.python = opts.python || TcdbService._findPython();
    this.db = opts.db || null;

    // Ensure output directory exists and is writable
    fs.mkdirSync(this.outputDir, { recursive: true });

    this._status = {
      running: false,
      phase: 'idle',       // 'idle' | 'browsing' | 'previewing' | 'importing' | 'merging' | 'done' | 'error'
      progress: null,      // { current, total, currentItem }
      result: null,        // last completed result
      error: null,
    };
    this._log = [];        // rolling buffer of recent scraper log lines
    this._process = null;
  }

  getStatus() {
    return { ...this._status, log: this._log.slice(-30) };
  }

  /**
   * Browse available sets for a year.
   * Returns a promise that resolves to the JSON array of sets.
   */
  async browse(year) {
    return this._runScraper(['--list', '--year', String(year), '--json'], 'browsing');
  }

  /**
   * Preview a specific set.
   * Returns a promise that resolves to the JSON preview object.
   */
  async preview(setId, year) {
    const args = ['--preview', '--set-id', String(setId), '--no-images', '--json'];
    if (year) args.push('--year', String(year));
    return this._runScraper(args, 'previewing');
  }

  /**
   * Import a set into the catalog DB.
   * Returns a promise that resolves to the scrape summary.
   */
  async importSet(setId, year) {
    this._log = [];
    this._status = {
      running: true,
      phase: 'importing',
      progress: { current: 0, total: 3, currentItem: 'Scraping base cards...' },
      result: null,
      error: null,
      startedAt: Date.now(),
    };

    try {
      // Step 1: Run the scraper to build catalog DB
      const args = ['--set-id', String(setId), '--no-images', '--json', '--output-dir', this.outputDir];
      if (year) args.push('--year', String(year));
      const scrapeResult = await this._runScraperRaw(args);

      // Step 2: Merge catalog into user DB (skip if scraper found nothing)
      this._status.phase = 'merging';
      this._status.progress = { current: 2, total: 3, currentItem: 'Merging into CardVoice...' };

      let mergeResult = null;
      const totalScraped = (scrapeResult?.total_cards || 0) + (scrapeResult?.base_cards || 0);
      if (totalScraped === 0) {
        mergeResult = { skipped: true, reason: 'TCDB has no cards for this set yet' };
      } else if (this.db) {
        const { mergeCatalog } = require('./catalog-merge');
        const catalogPath = path.join(this.outputDir, 'tcdb-catalog.db');
        mergeResult = mergeCatalog(this.db, { catalogPath, force: true });
      }

      // Step 3: Done
      this._status = {
        running: false,
        phase: 'done',
        progress: { current: 3, total: 3, currentItem: 'Complete' },
        result: { scrape: scrapeResult, merge: mergeResult },
        error: null,
        startedAt: this._status.startedAt,
      };

      return this._status.result;
    } catch (err) {
      this._status = {
        running: false,
        phase: 'error',
        progress: null,
        result: null,
        error: err.message,
        startedAt: this._status.startedAt,
      };
      throw err;
    }
  }

  /**
   * Spawn scraper, collect stdout, parse JSON, update status.
   */
  _runScraper(args, phase) {
    this._log = [];
    this._status = { running: true, phase, progress: null, result: null, error: null };

    return this._runScraperRaw(args).then(result => {
      this._status = { running: false, phase: 'done', progress: null, result, error: null };
      return result;
    }).catch(err => {
      this._status = { running: false, phase: 'error', progress: null, result: null, error: err.message };
      throw err;
    });
  }

  /**
   * Low-level: spawn python scraper.py with args, return parsed JSON from stdout.
   */
  _runScraperRaw(args) {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(this.scraperDir, 'scraper.py');
      const proc = spawn(this.python, [scriptPath, ...args], {
        cwd: this.scraperDir,
        env: { ...process.env },
        shell: true,
      });
      this._process = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        // Parse log lines and add to rolling buffer
        const lines = chunk.split('\n').filter(l => l.trim());
        for (const line of lines) {
          this._log.push(line.trim());
          if (this._log.length > 100) this._log.shift();
          // Update currentItem with the latest meaningful log line
          if (this._status.running && this._status.progress) {
            this._status.progress.currentItem = line.trim();
          }
        }
      });

      proc.on('close', (code) => {
        this._process = null;
        if (code !== 0) {
          return reject(new Error(`Scraper exited with code ${code}: ${stderr.slice(0, 500)}`));
        }
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse scraper output: ${e.message}\nstdout: ${stdout.slice(0, 500)}`));
        }
      });

      proc.on('error', (err) => {
        this._process = null;
        reject(new Error(`Failed to spawn scraper: ${err.message}`));
      });
    });
  }

  /**
   * Import a user's entire TCDB collection.
   * Spawns collection_scraper.py with the session cookie.
   */
  async importCollection(cookie, member) {
    this._log = [];
    this._status = {
      running: true,
      phase: 'collection-scrape',
      progress: { current: 0, total: 0, currentItem: 'Starting collection scraper...' },
      result: null,
      error: null,
      startedAt: Date.now(),
    };

    try {
      // Step 1: Run collection scraper
      const scrapeResult = await this._runCollectionScraper(cookie, member);

      // Step 2: Import into CardVoice DB
      this._status.phase = 'collection-import';
      this._status.progress = { current: 0, total: scrapeResult?.total_cards || 0, currentItem: 'Importing cards into CardVoice...' };
      this._log.push(`Importing ${scrapeResult?.total_cards || 0} cards across ${scrapeResult?.total_sets || 0} sets...`);

      const importResult = this._importCollectionData(scrapeResult);

      // Step 3: Done
      this._status = {
        running: false,
        phase: 'done',
        progress: { current: importResult.cards_added + importResult.cards_updated, total: scrapeResult?.total_cards || 0, currentItem: 'Complete' },
        result: { scrape: scrapeResult, import: importResult },
        error: null,
        startedAt: this._status.startedAt,
      };
      this._log.push(`Done! ${importResult.sets_created} sets created, ${importResult.sets_matched} matched, ${importResult.cards_added} cards added, ${importResult.cards_updated} updated`);

      return this._status.result;
    } catch (err) {
      this._status = {
        running: false, phase: 'error', progress: null, result: null,
        error: err.message, startedAt: this._status.startedAt,
      };
      throw err;
    }
  }

  /**
   * Low-level: spawn collection_scraper.py with args, return parsed JSON from stdout.
   * Separate from _runScraperRaw because it uses a different script.
   */
  _runCollectionScraper(cookie, member) {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(this.scraperDir, 'collection_scraper.py');
      const args = [scriptPath, '--cookie', cookie, '--member', member, '--json', '--output-dir', this.outputDir];
      const proc = spawn(this.python, args, {
        cwd: this.scraperDir,
        env: { ...process.env },
        shell: true,
      });
      this._process = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        const lines = chunk.split('\n').filter(l => l.trim());
        for (const line of lines) {
          this._log.push(line.trim());
          if (this._log.length > 100) this._log.shift();
          // Parse page progress from log lines like "Page 5/71: 100 cards (total: 500)"
          const pageMatch = line.match(/Page (\d+)\/(\d+)/);
          if (pageMatch && this._status.running) {
            this._status.progress = {
              current: parseInt(pageMatch[1]),
              total: parseInt(pageMatch[2]),
              currentItem: line.trim(),
            };
          } else if (this._status.running && this._status.progress) {
            this._status.progress.currentItem = line.trim();
          }
        }
      });

      proc.on('close', (code) => {
        this._process = null;
        if (code !== 0) {
          return reject(new Error(`Collection scraper exited with code ${code}: ${stderr.slice(0, 500)}`));
        }
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch (e) {
          reject(new Error(`Failed to parse collection scraper output: ${e.message}\nstdout: ${stdout.slice(0, 500)}`));
        }
      });

      proc.on('error', (err) => {
        this._process = null;
        reject(new Error(`Failed to spawn collection scraper: ${err.message}`));
      });
    });
  }

  /**
   * Import scraped collection data into the user's DB.
   */
  _importCollectionData(scrapeResult) {
    if (!this.db || !scrapeResult?.sets) return { skipped: true };

    const findSetByTcdbId = this.db.prepare('SELECT id FROM card_sets WHERE tcdb_set_id = ?');
    const findSetByNameYear = this.db.prepare('SELECT id FROM card_sets WHERE name = ? AND year = ?');
    const createSet = this.db.prepare('INSERT INTO card_sets (name, year, brand, sport, tcdb_set_id) VALUES (?, ?, ?, ?, ?)');
    const findCard = this.db.prepare('SELECT id, qty FROM cards WHERE set_id = ? AND card_number = ? AND insert_type = ? AND parallel = ?');
    const insertCard = this.db.prepare('INSERT INTO cards (set_id, card_number, player, team, rc_sp, insert_type, parallel, qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const updateCardQty = this.db.prepare('UPDATE cards SET qty = ?, player = CASE WHEN player = ? THEN ? ELSE player END WHERE id = ?');
    const upsertInsertType = this.db.prepare('INSERT INTO set_insert_types (set_id, name) VALUES (?, ?) ON CONFLICT(set_id, name) DO NOTHING');

    const results = { sets_created: 0, sets_matched: 0, cards_added: 0, cards_updated: 0 };

    const doImport = this.db.transaction(() => {
      for (const setGroup of scrapeResult.sets) {
        const { tcdb_set_id, set_name, year, cards } = setGroup;
        const brand = set_name.split(' ').find(w => ['Topps', 'Bowman', 'Panini', 'Donruss', 'Upper', 'Fleer', 'Score'].includes(w)) || 'Unknown';

        // Match set: tcdb_set_id first, then name+year fallback
        let setRow = findSetByTcdbId.get(tcdb_set_id);
        if (!setRow) {
          setRow = findSetByNameYear.get(set_name, year);
        }
        let userSetId;
        if (setRow) {
          userSetId = setRow.id;
          results.sets_matched++;
          // Update tcdb_set_id if not set
          this.db.prepare('UPDATE card_sets SET tcdb_set_id = COALESCE(tcdb_set_id, ?) WHERE id = ?').run(tcdb_set_id, userSetId);
        } else {
          const info = createSet.run(set_name, year, brand, 'Baseball', tcdb_set_id);
          userSetId = Number(info.lastInsertRowid);
          results.sets_created++;
        }

        // Register "Base" insert type for this set
        upsertInsertType.run(userSetId, 'Base');

        for (const card of cards) {
          const insertType = 'Base';
          const parallel = '';
          const existing = findCard.get(userSetId, card.card_number, insertType, parallel);
          if (existing) {
            if (card.qty > existing.qty) {
              updateCardQty.run(card.qty, '', card.player, existing.id);
            }
            results.cards_updated++;
          } else {
            insertCard.run(userSetId, card.card_number, card.player, '', card.rc_sp || '', insertType, parallel, card.qty);
            results.cards_added++;
          }
        }

        // Update total_cards count
        const count = this.db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE set_id = ?').get(userSetId);
        this.db.prepare('UPDATE card_sets SET total_cards = ? WHERE id = ?').run(count.cnt, userSetId);
      }
    });

    doImport();
    return results;
  }

  /**
   * Backfill full checklists for all sets that have cards but no checklist.
   * Runs in background, one set at a time with rate limiting.
   */
  async backfillChecklists() {
    if (!this.db) return;
    const setsToBackfill = this.db.prepare(`
      SELECT id, name, year, tcdb_set_id FROM card_sets
      WHERE checklist_imported = 0 AND tcdb_set_id IS NOT NULL
      ORDER BY year DESC
    `).all();

    if (setsToBackfill.length === 0) {
      this._status = { running: false, phase: 'done', progress: null, result: { message: 'All checklists up to date' }, error: null };
      return;
    }

    this._log = [];
    this._status = {
      running: true,
      phase: 'backfilling',
      progress: { current: 0, total: setsToBackfill.length, currentItem: 'Starting checklist backfill...' },
      result: null,
      error: null,
      startedAt: Date.now(),
    };

    let completed = 0;
    for (const set of setsToBackfill) {
      if (!this._status.running) break; // cancelled
      this._status.progress = { current: completed, total: setsToBackfill.length, currentItem: `${set.name} (${set.year})` };
      try {
        await this.importSet(set.tcdb_set_id, set.year);
        this.db.prepare('UPDATE card_sets SET checklist_imported = 1 WHERE id = ?').run(set.id);
        completed++;
      } catch (err) {
        this._log.push(`ERROR: ${set.name}: ${err.message}`);
      }
    }

    this._status = {
      running: false,
      phase: 'done',
      progress: { current: completed, total: setsToBackfill.length, currentItem: 'Backfill complete' },
      result: { sets_backfilled: completed, total: setsToBackfill.length },
      error: null,
      startedAt: this._status.startedAt,
    };
  }

  /**
   * Cancel a running scraper process.
   */
  cancel() {
    if (this._process) {
      this._process.kill('SIGTERM');
      this._status = { running: false, phase: 'idle', progress: null, result: null, error: 'Cancelled' };
    }
  }

  static _findPython() {
    const { execSync } = require('child_process');

    // Try common commands
    for (const cmd of ['python', 'python3', 'py']) {
      try {
        execSync(`${cmd} --version`, { stdio: 'ignore', timeout: 5000 });
        return cmd;
      } catch (_) { /* not found */ }
    }

    // Try common Windows install paths
    const home = process.env.LOCALAPPDATA || '';
    if (home) {
      try {
        const pyDir = path.join(home, 'Programs', 'Python');
        if (fs.existsSync(pyDir)) {
          const versions = fs.readdirSync(pyDir).filter(d => d.startsWith('Python')).sort().reverse();
          for (const ver of versions) {
            const pyExe = path.join(pyDir, ver, 'python.exe');
            if (fs.existsSync(pyExe)) return pyExe;
          }
        }
      } catch (_) { /* not found */ }
    }

    return 'python'; // fallback, will error at spawn time
  }
}

module.exports = { TcdbService };
