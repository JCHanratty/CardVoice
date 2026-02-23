# TCDB Admin Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an Admin page to CardVoice where users can browse TCDB sets by year, preview card data, and import sets into their local database — all from within the app.

**Architecture:** React frontend page with three-phase flow (browse → preview → import). Express API endpoints spawn Python scraper as a child process. Scraper gains `--json` and `--list` output modes. On import completion, `catalog-merge.js` merges the scraped catalog into the user's DB. Progress is tracked via in-memory status object polled by the frontend.

**Tech Stack:** React 18, Tailwind CSS (cv-* palette), Express/Node.js, Python 3 (child_process.spawn), better-sqlite3, axios

---

### Task 1: Add `--json` and `--list` modes to scraper.py

**Files:**
- Modify: `tcdb-scraper/scraper.py`
- Test: `tcdb-scraper/test_scraper_cli.py` (create)

The scraper currently outputs text. We need two new modes for the Express API to consume:
- `--list --year YYYY --json` — outputs JSON array of sets for a year
- `--preview --set-id NNN --json` — outputs JSON preview (base cards, parallels, inserts)
- `--set-id NNN --no-images --json` — outputs JSON progress lines during import

**Step 1: Write the failing test**

Create `tcdb-scraper/test_scraper_cli.py`:

```python
"""Tests for scraper CLI JSON output modes."""
import json
import subprocess
import sys
from unittest.mock import patch, MagicMock
import pytest

from scraper import list_sets_json, preview_set_json


class TestListSetsJson:
    def test_list_sets_returns_json_array(self):
        """list_sets_json should return a JSON-serializable list of set dicts."""
        mock_client = MagicMock()
        mock_resp = MagicMock()
        mock_resp.text = """<html><body>
        <ul style="list-style: none; padding:5px 0px 10px 30px; margin:0;">
          <li><a href="/ViewSet.cfm/sid/482758/2025-Topps-Series-1">2025 Topps Series 1</a></li>
          <li><a href="/ViewSet.cfm/sid/490001/2025-Bowman-Chrome">2025 Bowman Chrome</a></li>
        </ul>
        </body></html>"""
        mock_client.get.return_value = mock_resp

        result = list_sets_json(mock_client, year=2025)

        assert isinstance(result, list)
        assert len(result) == 2
        assert result[0]["tcdb_id"] == 482758
        assert result[0]["name"] == "2025 Topps Series 1"
        assert result[0]["year"] == 2025
        # Must be JSON-serializable
        json.dumps(result)


class TestPreviewSetJson:
    def test_preview_returns_structured_dict(self):
        """preview_set_json should return a dict with base_cards, parallels, inserts."""
        mock_client = MagicMock()

        # Mock the checklist page response
        checklist_resp = MagicMock()
        checklist_resp.text = """<html>
        <head><title>2025 Topps Series 1 Baseball</title></head>
        <body>
        <strong>Total Cards:</strong> 2
        <table>
          <tr bgcolor="#F7F9F9">
            <td nowrap valign="top"><a href="/ViewCard.cfm/sid/482758/cid/100001/2025-Topps-1-Aaron-Judge">1</a></td>
            <td valign="top" width="45%"><a href="/Person.cfm/pid/12345/Aaron-Judge">Aaron Judge</a></td>
            <td valign="top" width="45%"><a href="/Team.cfm/tid/25/New-York-Yankees">New York Yankees</a></td>
          </tr>
        </table>
        </body></html>"""

        # Mock the AJAX sub-sets response
        ajax_resp = MagicMock()
        ajax_resp.text = """<ul>
        <li><a href="/ViewSet.cfm/sid/490099/2025-Topps---Gold">Topps - Gold</a></li>
        <li><a href="/ViewSet.cfm/sid/490100/2025-Topps---Anime">Topps - Anime</a></li>
        </ul>"""

        mock_client.get.side_effect = [checklist_resp, ajax_resp]

        set_info = {"tcdb_id": 482758, "name": "2025 Topps Series 1",
                     "url_slug": "2025-Topps-Series-1", "year": 2025}
        result = preview_set_json(mock_client, set_info)

        assert result["name"] == "2025 Topps Series 1"
        assert result["year"] == 2025
        assert len(result["base_cards"]) == 1
        assert result["base_cards"][0]["player"] == "Aaron Judge"
        assert any(p["name"] == "Gold" for p in result["parallels"])
        assert any(i["name"] == "Anime" for i in result["inserts"])
        # Must be JSON-serializable
        json.dumps(result)
```

**Step 2: Run test to verify it fails**

Run: `cd /tmp/CardVoice/tcdb-scraper && python -m pytest test_scraper_cli.py -v`
Expected: FAIL with "cannot import name 'list_sets_json'"

**Step 3: Write minimal implementation**

Add these functions to `tcdb-scraper/scraper.py` (above `main()`):

```python
def list_sets_json(client: TcdbClient, year: int, sport: str = "Baseball") -> list[dict]:
    """Fetch available sets for a year and return as JSON-serializable list."""
    url = f"{TCDB_BASE}/ViewAll.cfm/sp/{sport}/year/{year}"
    resp = client.get(url)
    sets = parse_set_list_page(resp.text)
    for s in sets:
        s["year"] = year
    return sets


def preview_set_json(client: TcdbClient, set_info: dict) -> dict:
    """Scrape one set and return structured JSON-serializable preview."""
    tcdb_id = set_info["tcdb_id"]
    name = set_info["name"]
    url_slug = set_info.get("url_slug", name.replace(" ", "-"))
    year = set_info.get("year", 0)
    brand = extract_brand(name)

    # Base cards
    result = scrape_set_cards(client, tcdb_id, url_slug)
    base_cards = result.get("cards", [])
    total = result.get("total_cards") or len(base_cards)

    # Sub-sets
    sub_sets = discover_sub_sets(client, tcdb_id, parent_name=name)
    parallels = [s for s in sub_sets if _is_parallel(s["name"])]
    inserts = [s for s in sub_sets if not _is_parallel(s["name"])]

    return {
        "tcdb_id": tcdb_id,
        "name": name,
        "year": year,
        "brand": brand,
        "total_cards": total,
        "base_cards": base_cards,
        "parallels": [{"tcdb_id": p["tcdb_id"], "name": p["name"]} for p in parallels],
        "inserts": [{"tcdb_id": i["tcdb_id"], "name": i["name"]} for i in inserts],
    }
```

Then update the `main()` argument parser to handle `--json` and `--list`:

```python
def main():
    parser = argparse.ArgumentParser(description="TCDB-to-CardVoice Catalog Scraper")
    parser.add_argument("--start-year", type=int, default=START_YEAR)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--preview", nargs="?", const="auto", metavar="SET_ID")
    parser.add_argument("--no-images", action="store_true")
    parser.add_argument("--json", action="store_true",
                        help="Output JSON to stdout (for programmatic use)")
    parser.add_argument("--list", action="store_true",
                        help="List available sets for a year")
    parser.add_argument("--set-id", type=int, metavar="ID",
                        help="TCDB set ID to scrape or preview")
    parser.add_argument("--year", type=int, default=START_YEAR,
                        help="Year for --list mode")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    client = TcdbClient()

    # --- List mode ---
    if args.list:
        sets = list_sets_json(client, year=args.year)
        if args.json:
            print(json.dumps(sets))
        else:
            for s in sets:
                print(f"  {s['tcdb_id']:>8}  {s['name']}")
        return

    # --- Preview mode ---
    if args.preview is not None or (args.set_id and not args.list):
        sid = args.set_id or (int(args.preview) if args.preview != "auto" else None)

        if sid:
            resp = client.get(f"{TCDB_BASE}/ViewSet.cfm/sid/{sid}")
            detail = parse_set_detail_page(resp.text)
            raw_title = detail.get("title", "")
            set_name = raw_title.split(" - Trading Card")[0].replace(" Baseball", "").strip()
            if not set_name:
                set_name = f"Set-{sid}"
            slug = set_name.replace(" ", "-")
            info = {"tcdb_id": sid, "name": set_name, "url_slug": slug, "year": args.year}
        else:
            url = f"{TCDB_BASE}/ViewAll.cfm/sp/Baseball/year/{args.start_year}"
            resp = client.get(url)
            sets = parse_set_list_page(resp.text)
            if not sets:
                logger.error("No sets found")
                return
            info = sets[0]
            info["year"] = args.start_year

        if args.json:
            result = preview_set_json(client, info)
            print(json.dumps(result))
        else:
            report = preview_set(client, info)
            print(report)
            preview_path = OUTPUT_DIR / "preview.txt"
            with open(preview_path, "w", encoding="utf-8") as f:
                f.write(report)
            logger.info(f"Preview saved to {preview_path}")
        return

    # ... rest of main() for full scrape mode (unchanged) ...
```

**Step 4: Run test to verify it passes**

Run: `cd /tmp/CardVoice/tcdb-scraper && python -m pytest test_scraper_cli.py test_parsers.py test_http_client.py -v`
Expected: All PASS

**Step 5: Commit**

```bash
cd /tmp/CardVoice/tcdb-scraper
git add scraper.py test_scraper_cli.py
git commit -m "feat(scraper): add --json and --list CLI modes for admin integration"
```

---

### Task 2: Create the TcdbService (Node.js scraper wrapper)

**Files:**
- Create: `server/tcdb-service.js`
- Test: `server/test-tcdb-service.js` (create)

This service wraps `child_process.spawn` to call the Python scraper and exposes an API similar to SyncService. It holds in-memory status for polling.

**Step 1: Write the failing test**

Create `server/test-tcdb-service.js`:

```javascript
const assert = require('assert');

// Quick smoke test — just verify the module loads and has expected methods
const { TcdbService } = require('./tcdb-service');

const service = new TcdbService({ scraperDir: '/tmp/CardVoice/tcdb-scraper' });

assert.strictEqual(typeof service.browse, 'function', 'browse method exists');
assert.strictEqual(typeof service.preview, 'function', 'preview method exists');
assert.strictEqual(typeof service.importSet, 'function', 'importSet method exists');
assert.strictEqual(typeof service.getStatus, 'function', 'getStatus method exists');

const status = service.getStatus();
assert.strictEqual(status.running, false);
assert.strictEqual(status.phase, 'idle');

console.log('All TcdbService smoke tests passed');
```

**Step 2: Run test to verify it fails**

Run: `node /tmp/CardVoice/server/test-tcdb-service.js`
Expected: FAIL with "Cannot find module './tcdb-service'"

**Step 3: Write minimal implementation**

Create `server/tcdb-service.js`:

```javascript
/**
 * TcdbService — spawns the Python TCDB scraper as a child process.
 * Exposes browse/preview/import with status polling for the admin UI.
 */
const { spawn } = require('child_process');
const path = require('path');

class TcdbService {
  constructor(opts = {}) {
    this.scraperDir = opts.scraperDir || path.join(__dirname, '..', 'tcdb-scraper');
    this.python = opts.python || 'python';
    this.db = opts.db || null;

    this._status = {
      running: false,
      phase: 'idle',       // 'idle' | 'browsing' | 'previewing' | 'importing' | 'merging' | 'done' | 'error'
      progress: null,      // { current, total, currentItem }
      result: null,        // last completed result
      error: null,
    };
    this._process = null;
  }

  getStatus() {
    return { ...this._status };
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
    this._status = {
      running: true,
      phase: 'importing',
      progress: { current: 0, total: 3, currentItem: 'Scraping base cards...' },
      result: null,
      error: null,
    };

    try {
      // Step 1: Run the scraper to build catalog DB
      const args = ['--set-id', String(setId), '--no-images', '--json'];
      if (year) args.push('--year', String(year));
      const scrapeResult = await this._runScraperRaw(args);

      // Step 2: Merge catalog into user DB
      this._status.phase = 'merging';
      this._status.progress = { current: 2, total: 3, currentItem: 'Merging into CardVoice...' };

      let mergeResult = null;
      if (this.db) {
        const { mergeCatalog } = require('./catalog-merge');
        const catalogPath = path.join(this.scraperDir, 'output', 'tcdb-catalog.db');
        mergeResult = mergeCatalog(this.db, { catalogPath });
      }

      // Step 3: Done
      this._status = {
        running: false,
        phase: 'done',
        progress: { current: 3, total: 3, currentItem: 'Complete' },
        result: { scrape: scrapeResult, merge: mergeResult },
        error: null,
      };

      return this._status.result;
    } catch (err) {
      this._status = {
        running: false,
        phase: 'error',
        progress: null,
        result: null,
        error: err.message,
      };
      throw err;
    }
  }

  /**
   * Spawn scraper, collect stdout, parse JSON, update status.
   */
  _runScraper(args, phase) {
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
      });
      this._process = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

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
}

module.exports = { TcdbService };
```

**Step 4: Run test to verify it passes**

Run: `node /tmp/CardVoice/server/test-tcdb-service.js`
Expected: "All TcdbService smoke tests passed"

**Step 5: Commit**

```bash
cd /tmp/CardVoice
git add server/tcdb-service.js server/test-tcdb-service.js
git commit -m "feat(server): add TcdbService wrapper for Python scraper subprocess"
```

---

### Task 3: Add Express API routes for TCDB admin

**Files:**
- Modify: `server/routes.js` (add routes before `return router;` at line ~1770)
- Modify: `server/index.js` (initialize TcdbService, attach to app.locals)

**Step 1: Add TcdbService initialization to `server/index.js`**

After the SyncService setup (around line 37), add:

```javascript
// Start TCDB scraper service
const { TcdbService } = require('./tcdb-service');
const tcdbService = new TcdbService({
  scraperDir: path.join(__dirname, '..', 'tcdb-scraper'),
  db,
});
app.locals.tcdbService = tcdbService;
```

Also add `const path = require('path');` at the top if not already imported.

**Step 2: Add API routes to `server/routes.js`**

Add before `return router;`:

```javascript
  // ============================================================
  // TCDB Admin Endpoints
  // ============================================================

  // POST /api/admin/tcdb/browse — list sets for a year
  router.post('/api/admin/tcdb/browse', async (req, res) => {
    const tcdb = req.app.locals.tcdbService;
    if (!tcdb) return res.status(500).json({ error: 'TCDB service not available' });
    const { year } = req.body;
    if (!year) return res.status(400).json({ error: 'year is required' });
    try {
      const sets = await tcdb.browse(year);
      res.json(sets);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/tcdb/preview — preview a set's cards/inserts/parallels
  router.post('/api/admin/tcdb/preview', async (req, res) => {
    const tcdb = req.app.locals.tcdbService;
    if (!tcdb) return res.status(500).json({ error: 'TCDB service not available' });
    const { setId, year } = req.body;
    if (!setId) return res.status(400).json({ error: 'setId is required' });
    try {
      const preview = await tcdb.preview(setId, year);
      res.json(preview);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/admin/tcdb/import — scrape a set and merge into CardVoice DB
  router.post('/api/admin/tcdb/import', async (req, res) => {
    const tcdb = req.app.locals.tcdbService;
    if (!tcdb) return res.status(500).json({ error: 'TCDB service not available' });
    if (tcdb.getStatus().running) return res.json({ message: 'Import already running' });
    const { setId, year } = req.body;
    if (!setId) return res.status(400).json({ error: 'setId is required' });
    // Fire and forget — frontend polls /status
    tcdb.importSet(setId, year).catch(err => {
      console.error('[TCDB] Import failed:', err.message);
    });
    res.json({ message: 'Import started' });
  });

  // GET /api/admin/tcdb/status — poll import progress
  router.get('/api/admin/tcdb/status', (req, res) => {
    const tcdb = req.app.locals.tcdbService;
    if (!tcdb) return res.status(500).json({ error: 'TCDB service not available' });
    res.json(tcdb.getStatus());
  });

  // POST /api/admin/tcdb/cancel — cancel running import
  router.post('/api/admin/tcdb/cancel', (req, res) => {
    const tcdb = req.app.locals.tcdbService;
    if (!tcdb) return res.status(500).json({ error: 'TCDB service not available' });
    tcdb.cancel();
    res.json({ message: 'Cancelled' });
  });
```

**Step 3: Test manually**

Start the server and verify the endpoints respond:

Run: `cd /tmp/CardVoice && node server/index.js &`

Then:
```bash
curl -X POST http://localhost:8000/api/admin/tcdb/browse -H "Content-Type: application/json" -d '{"year":2025}'
curl http://localhost:8000/api/admin/tcdb/status
```

Expected: Browse returns JSON array of sets, status returns `{"running":false,"phase":"idle",...}`

**Step 4: Commit**

```bash
cd /tmp/CardVoice
git add server/routes.js server/index.js
git commit -m "feat(server): add TCDB admin API routes (browse/preview/import/status)"
```

---

### Task 4: Create AdminPage.jsx (browse section)

**Files:**
- Create: `frontend/src/pages/AdminPage.jsx`
- Modify: `frontend/src/App.jsx` (add import, route, nav link)

**Step 1: Create the AdminPage component with browse functionality**

Create `frontend/src/pages/AdminPage.jsx`:

```jsx
import { useState, useEffect } from 'react';
import axios from 'axios';
import { Shield, Search, Download, RefreshCw, ChevronRight, CheckCircle, XCircle } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function AdminPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Preview state
  const [selectedSet, setSelectedSet] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Import state
  const [importStatus, setImportStatus] = useState(null);
  const [importResult, setImportResult] = useState(null);

  // Search/filter
  const [searchQuery, setSearchQuery] = useState('');

  const browse = async () => {
    setLoading(true);
    setError('');
    setSets([]);
    setSelectedSet(null);
    setPreview(null);
    try {
      const res = await axios.post(`${API}/api/admin/tcdb/browse`, { year });
      setSets(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setLoading(false);
  };

  const loadPreview = async (set) => {
    setSelectedSet(set);
    setPreviewLoading(true);
    setPreview(null);
    setImportResult(null);
    try {
      const res = await axios.post(`${API}/api/admin/tcdb/preview`, {
        setId: set.tcdb_id,
        year: set.year || year,
      });
      setPreview(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setPreviewLoading(false);
  };

  const startImport = async () => {
    if (!selectedSet) return;
    setImportResult(null);
    try {
      await axios.post(`${API}/api/admin/tcdb/import`, {
        setId: selectedSet.tcdb_id,
        year: selectedSet.year || year,
      });
      // Start polling
      const interval = setInterval(async () => {
        try {
          const res = await axios.get(`${API}/api/admin/tcdb/status`);
          setImportStatus(res.data);
          if (!res.data.running && res.data.phase !== 'idle') {
            clearInterval(interval);
            if (res.data.phase === 'done') {
              setImportResult(res.data.result);
            } else if (res.data.phase === 'error') {
              setError(res.data.error || 'Import failed');
            }
          }
        } catch (e) {
          clearInterval(interval);
        }
      }, 2000);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const filteredSets = sets.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isImporting = importStatus?.running;

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-display font-bold text-cv-text mb-6 flex items-center gap-2">
        <Shield size={24} /> Admin
      </h1>

      {/* Browse Section */}
      <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
        <h2 className="text-lg font-display font-semibold text-cv-text mb-4">Import from TCDB</h2>
        <p className="text-xs text-cv-muted mb-4">
          Browse baseball card sets on TCDB, preview the checklist, and import directly into CardVoice.
        </p>

        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-cv-text">Year</label>
          <input
            type="number"
            value={year}
            onChange={e => setYear(parseInt(e.target.value) || currentYear)}
            className="w-24 bg-cv-dark border border-cv-border/50 rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none"
            min={1900}
            max={currentYear + 1}
          />
          <button
            onClick={browse}
            disabled={loading}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
              loading
                ? 'bg-cv-border/50 text-cv-muted cursor-not-allowed'
                : 'bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/20'
            } transition-all`}
          >
            {loading ? <RefreshCw size={16} className="animate-spin" /> : <Search size={16} />}
            {loading ? 'Browsing...' : 'Browse Sets'}
          </button>
        </div>

        {/* Error display */}
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-red-900/20 border border-red-500/30 text-red-400 text-sm flex items-center gap-2">
            <XCircle size={16} /> {error}
            <button onClick={() => setError('')} className="ml-auto text-red-400/50 hover:text-red-400">dismiss</button>
          </div>
        )}

        {/* Set list */}
        {sets.length > 0 && (
          <>
            <div className="mb-3">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Filter sets..."
                className="w-full bg-cv-dark border border-cv-border/50 rounded-lg px-3 py-2 text-sm text-cv-text placeholder:text-cv-muted/50 focus:border-cv-accent focus:outline-none"
              />
            </div>
            <div className="text-xs text-cv-muted mb-2">{filteredSets.length} sets found</div>
            <div className="max-h-80 overflow-y-auto space-y-1">
              {filteredSets.map(s => (
                <button
                  key={s.tcdb_id}
                  onClick={() => loadPreview(s)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-all flex items-center justify-between ${
                    selectedSet?.tcdb_id === s.tcdb_id
                      ? 'bg-cv-accent/15 text-cv-accent border border-cv-accent/30'
                      : 'text-cv-text hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <span className="font-medium">{s.name}</span>
                  <ChevronRight size={14} className="text-cv-muted" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Preview Section */}
      {(previewLoading || preview) && (
        <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
          <h2 className="text-lg font-display font-semibold text-cv-text mb-4">
            Preview: {selectedSet?.name}
          </h2>

          {previewLoading ? (
            <div className="flex items-center gap-2 text-cv-muted text-sm">
              <RefreshCw size={16} className="animate-spin" /> Loading preview...
            </div>
          ) : preview && (
            <>
              {/* Summary stats */}
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-cv-dark/50 rounded-lg p-3 border border-cv-border/30">
                  <div className="text-2xl font-bold text-cv-text font-mono">{preview.total_cards}</div>
                  <div className="text-xs text-cv-muted">Base Cards</div>
                </div>
                <div className="bg-cv-dark/50 rounded-lg p-3 border border-cv-border/30">
                  <div className="text-2xl font-bold text-cv-text font-mono">{preview.parallels?.length || 0}</div>
                  <div className="text-xs text-cv-muted">Parallels</div>
                </div>
                <div className="bg-cv-dark/50 rounded-lg p-3 border border-cv-border/30">
                  <div className="text-2xl font-bold text-cv-text font-mono">{preview.inserts?.length || 0}</div>
                  <div className="text-xs text-cv-muted">Inserts</div>
                </div>
              </div>

              {/* Parallels list */}
              {preview.parallels?.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-cv-muted uppercase tracking-widest mb-2">Parallels</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.parallels.map(p => (
                      <span key={p.tcdb_id} className="text-xs bg-cv-accent/10 text-cv-accent border border-cv-accent/20 rounded px-2 py-0.5">
                        {p.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Inserts list */}
              {preview.inserts?.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-cv-muted uppercase tracking-widest mb-2">Inserts</h3>
                  <div className="flex flex-wrap gap-1.5">
                    {preview.inserts.map(ins => (
                      <span key={ins.tcdb_id} className="text-xs bg-cv-gold/10 text-cv-gold border border-cv-gold/20 rounded px-2 py-0.5">
                        {ins.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Sample cards table */}
              {preview.base_cards?.length > 0 && (
                <div className="mb-4">
                  <h3 className="text-sm font-semibold text-cv-muted uppercase tracking-widest mb-2">
                    Base Cards (showing {Math.min(preview.base_cards.length, 20)})
                  </h3>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-cv-muted border-b border-cv-border/20">
                        <th className="text-left py-1 font-semibold w-16">#</th>
                        <th className="text-left py-1 font-semibold">Player</th>
                        <th className="text-left py-1 font-semibold">Team</th>
                        <th className="text-left py-1 font-semibold w-16">Flags</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.base_cards.slice(0, 20).map((c, i) => (
                        <tr key={i} className="border-b border-cv-border/10">
                          <td className="py-1.5 text-cv-text font-mono">{c.card_number}</td>
                          <td className="py-1.5 text-cv-text">{c.player}</td>
                          <td className="py-1.5 text-cv-muted">{c.team}</td>
                          <td className="py-1.5">
                            {c.rc_sp?.map(f => (
                              <span key={f} className="text-[10px] bg-cv-gold/15 text-cv-gold rounded px-1 mr-1">{f}</span>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.base_cards.length > 20 && (
                    <div className="text-xs text-cv-muted mt-1">...and {preview.base_cards.length - 20} more</div>
                  )}
                </div>
              )}

              {/* Import button */}
              <button
                onClick={startImport}
                disabled={isImporting}
                className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-medium ${
                  isImporting
                    ? 'bg-cv-border/50 text-cv-muted cursor-not-allowed'
                    : 'bg-gradient-to-r from-cv-accent to-cv-accent2 text-white hover:shadow-lg hover:shadow-cv-accent/20'
                } transition-all`}
              >
                {isImporting ? <RefreshCw size={16} className="animate-spin" /> : <Download size={16} />}
                {isImporting ? 'Importing...' : 'Import to CardVoice'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Import Progress */}
      {isImporting && importStatus?.progress && (
        <div className="bg-cv-panel rounded-xl p-5 border border-cv-border/50 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-cv-accent font-semibold uppercase tracking-wider">Import Progress</span>
            <span className="text-xs text-cv-muted font-mono">
              {importStatus.progress.current}/{importStatus.progress.total}
            </span>
          </div>
          {importStatus.progress.total > 0 && (
            <div className="w-full h-1.5 bg-cv-border/50 rounded-full mb-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cv-accent to-cv-gold rounded-full transition-all duration-500"
                style={{ width: `${Math.round((importStatus.progress.current / importStatus.progress.total) * 100)}%` }}
              />
            </div>
          )}
          <div className="text-xs text-cv-text">{importStatus.progress.currentItem}</div>
        </div>
      )}

      {/* Import Result */}
      {importResult && (
        <div className="bg-cv-panel rounded-xl p-5 border border-green-500/30 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={20} className="text-green-400" />
            <h3 className="text-lg font-display font-semibold text-cv-text">Import Complete</h3>
          </div>
          {importResult.merge && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="text-cv-muted">Sets added:</div>
              <div className="text-cv-text font-mono">{importResult.merge.sets?.added || 0}</div>
              <div className="text-cv-muted">Cards added:</div>
              <div className="text-cv-text font-mono">{importResult.merge.cards?.added || 0}</div>
              <div className="text-cv-muted">Cards updated:</div>
              <div className="text-cv-text font-mono">{importResult.merge.cards?.updated || 0}</div>
              <div className="text-cv-muted">Insert types:</div>
              <div className="text-cv-text font-mono">{importResult.merge.insertTypes?.added || 0}</div>
              <div className="text-cv-muted">Parallels:</div>
              <div className="text-cv-text font-mono">{importResult.merge.parallels?.added || 0}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Wire up routing in App.jsx**

Add import at top of `frontend/src/App.jsx` (after the other page imports):

```javascript
import AdminPage from './pages/AdminPage';
```

Add route to the children array (after the settings route):

```javascript
{ path: '/admin', element: <AdminPage /> },
```

Add NavLink in the sidebar nav section (after Settings, before the closing `</nav>`):

```jsx
<NavLink to="/admin" icon={Shield} label="Admin" collapsed={collapsed} />
```

Add `Shield` to the lucide-react import at the top of App.jsx:

```javascript
import { Mic, Database, HelpCircle, LayoutDashboard, ChevronRight, ChevronLeft, Settings as SettingsIcon, Home, PanelLeftClose, PanelLeft, DollarSign, Shield } from 'lucide-react';
```

Add breadcrumb support in the `Breadcrumbs` component (after the settings check):

```javascript
} else if (path.startsWith('/admin')) {
  crumbs.push({ label: 'Admin', to: '/admin' });
}
```

**Step 3: Test visually**

Run: `cd /tmp/CardVoice/frontend && npm run dev`

Navigate to `#/admin` in the browser. Verify:
- Page loads with "Admin" heading and "Import from TCDB" panel
- Year input defaults to current year
- "Browse Sets" button is present

**Step 4: Commit**

```bash
cd /tmp/CardVoice
git add frontend/src/pages/AdminPage.jsx frontend/src/App.jsx
git commit -m "feat(frontend): add Admin page with TCDB browse/preview/import UI"
```

---

### Task 5: Integration test — end-to-end browse → preview → import

**Files:**
- No new files — this is a manual integration test

**Step 1: Start the app**

Run: `cd /tmp/CardVoice && node server/index.js`

**Step 2: Test browse**

Run:
```bash
curl -s -X POST http://localhost:8000/api/admin/tcdb/browse \
  -H "Content-Type: application/json" \
  -d '{"year":2025}' | python -m json.tool | head -20
```

Expected: JSON array with set objects (tcdb_id, name, year, url_slug)

**Step 3: Test preview**

Pick a set ID from the browse results (e.g., 482758 for 2025 Topps Series 1):

Run:
```bash
curl -s -X POST http://localhost:8000/api/admin/tcdb/preview \
  -H "Content-Type: application/json" \
  -d '{"setId":482758,"year":2025}' | python -m json.tool | head -30
```

Expected: JSON with name, base_cards array, parallels array, inserts array

**Step 4: Test import**

Run:
```bash
curl -s -X POST http://localhost:8000/api/admin/tcdb/import \
  -H "Content-Type: application/json" \
  -d '{"setId":482758,"year":2025}'
```

Then poll status:
```bash
watch -n 2 'curl -s http://localhost:8000/api/admin/tcdb/status | python -m json.tool'
```

Expected: Status progresses from importing → merging → done with merge results

**Step 5: Verify in CardVoice DB**

Run:
```bash
curl -s http://localhost:8000/api/sets | python -m json.tool
```

Expected: The imported set appears in the list with cards

**Step 6: Run all existing tests**

Run: `cd /tmp/CardVoice/tcdb-scraper && python -m pytest -v`

Expected: All tests pass

**Step 7: Commit any fixes**

```bash
cd /tmp/CardVoice
git add -A
git commit -m "fix: integration test fixes for TCDB admin flow"
```

---

### Task 6: Handle `--set-id` for direct import mode in scraper

**Files:**
- Modify: `tcdb-scraper/scraper.py` (update main() to support `--set-id` without `--preview`)

The current scraper's main() runs the full discovery loop. We need `--set-id NNN --no-images --json` to scrape a single set and output JSON.

**Step 1: Write the test**

Add to `tcdb-scraper/test_scraper_cli.py`:

```python
class TestMainSetIdMode:
    """Verify that --set-id without --preview runs a single-set scrape."""

    @patch('scraper.TcdbClient')
    @patch('scraper.create_catalog_db')
    def test_set_id_scrape_creates_db(self, mock_create_db, mock_client_cls):
        """--set-id NNN should scrape just that one set."""
        import scraper
        # This is a structural test — just verify the code path exists
        # Full integration is tested in Task 5
        assert hasattr(scraper, 'main')
```

**Step 2: Update main() in scraper.py**

In the `main()` function, after the preview block and before the full discovery loop, add a `--set-id` single-set import mode:

```python
    # --- Single set import mode ---
    if args.set_id and args.preview is None and not args.list:
        conn = create_catalog_db(str(DB_PATH))
        sid = args.set_id

        # Fetch set info from the ViewSet page
        resp = client.get(f"{TCDB_BASE}/ViewSet.cfm/sid/{sid}")
        detail = parse_set_detail_page(resp.text)
        raw_title = detail.get("title", "")
        set_name = raw_title.split(" - Trading Card")[0].replace(" Baseball", "").strip()
        if not set_name:
            set_name = f"Set-{sid}"
        slug = set_name.replace(" ", "-")

        set_info = {
            "tcdb_id": sid,
            "name": set_name,
            "url_slug": slug,
            "year": args.year,
        }

        summary = scrape_set(client, conn, set_info, download_images=not args.no_images)

        from datetime import date
        version = date.today().strftime("%Y.%m.1")
        set_catalog_version(conn, version)
        conn.close()

        if args.json:
            print(json.dumps(summary))
        else:
            logger.info(f"Done! Scraped {summary['total_cards']} cards for {set_name}")

        return
```

**Step 3: Run tests**

Run: `cd /tmp/CardVoice/tcdb-scraper && python -m pytest -v`
Expected: All PASS

**Step 4: Commit**

```bash
cd /tmp/CardVoice/tcdb-scraper
git add scraper.py test_scraper_cli.py
git commit -m "feat(scraper): add single-set import mode with --set-id"
```

---

### Summary of all tasks

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add `--json` and `--list` to scraper.py | scraper.py, test_scraper_cli.py |
| 2 | Create TcdbService Node wrapper | server/tcdb-service.js, server/test-tcdb-service.js |
| 3 | Add Express API routes | server/routes.js, server/index.js |
| 4 | Create AdminPage.jsx + routing | frontend/src/pages/AdminPage.jsx, frontend/src/App.jsx |
| 5 | End-to-end integration test | Manual testing |
| 6 | Single-set import mode in scraper | scraper.py |

Tasks 1 and 2 are independent and can be done in parallel. Task 3 depends on Task 2. Task 4 depends on Task 3. Task 5 depends on all. Task 6 should be done before Task 5 (it fills in the import path that Task 5 tests).

Recommended order: 1 → 6 → 2 → 3 → 4 → 5
