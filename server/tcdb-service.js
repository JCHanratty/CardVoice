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
