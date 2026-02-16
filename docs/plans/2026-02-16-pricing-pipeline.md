# Pricing Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add eBay sold-listing price tracking to CardVoice -- set-level value estimates, manually tracked individual cards, background sync, and a portfolio dashboard.

**Architecture:** New `server/pricing/` module handles scraping and sync. Three new DB tables store tracked cards, raw price history, and computed snapshots. Frontend adds recharts for charts, a Settings page, and pricing panels to Dashboard and SetDetail.

**Tech Stack:** cheerio (HTML parsing), undici (HTTP), recharts (charts), existing Express + better-sqlite3 + React stack.

---

### Task 1: Database Schema -- Pricing Tables

**Files:**
- Modify: `server/db.js` (add new CREATE TABLE statements after line ~125, add migrations after line ~151)

**Step 1: Write the new table DDL in db.js**

Add these CREATE TABLE statements inside the `openDb()` function, after the existing `set_parallels` table creation (around line 125):

```js
db.exec(`
  CREATE TABLE IF NOT EXISTS tracked_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    search_query TEXT NOT NULL DEFAULT '',
    tracked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_synced DATETIME,
    UNIQUE(card_id)
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
    set_id INTEGER REFERENCES card_sets(id) ON DELETE SET NULL,
    price REAL NOT NULL,
    sold_date TEXT,
    listing_title TEXT,
    listing_url TEXT,
    condition TEXT,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS price_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id INTEGER REFERENCES card_sets(id) ON DELETE CASCADE,
    card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
    median_price REAL NOT NULL,
    snapshot_date TEXT NOT NULL,
    UNIQUE(set_id, card_id, snapshot_date)
  )
`);
```

**Step 2: Add index migrations**

After the existing migration blocks (around line 151), add:

```js
// Pricing indexes
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_price_history_card ON price_history(card_id)`); } catch(e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_price_history_set ON price_history(set_id)`); } catch(e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_price_snapshots_date ON price_snapshots(snapshot_date)`); } catch(e) {}
try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tracked_cards_card ON tracked_cards(card_id)`); } catch(e) {}
```

**Step 3: Verify the app starts without errors**

Run: `cd /c/Users/jorda/Desktop/VoiceLogger/server && node -e "const {openDb}=require('./db'); const db=openDb(); console.log(db.prepare('SELECT name FROM sqlite_master WHERE type=\\'table\\'').all()); db.close()"`

Expected: Output includes `tracked_cards`, `price_history`, `price_snapshots` in the table list.

**Step 4: Commit**

```bash
git add server/db.js
git commit -m "feat: add pricing database schema (tracked_cards, price_history, price_snapshots)"
```

---

### Task 2: Scraper Config File

**Files:**
- Create: `server/pricing/scraper-config.json`

**Step 1: Create the config file**

```json
{
  "baseUrl": "https://www.ebay.com/sch/i.html",
  "defaultParams": {
    "_nkw": "",
    "LH_Complete": "1",
    "LH_Sold": "1",
    "_sop": "13",
    "_ipg": "60"
  },
  "selectors": {
    "resultItem": ".s-item",
    "title": ".s-item__title span",
    "price": ".s-item__price",
    "date": ".s-item__title--tag .POSITIVE",
    "link": ".s-item__link",
    "condition": ".SECONDARY_INFO"
  },
  "userAgents": [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0"
  ],
  "rateLimitMs": 3000,
  "maxRetries": 3,
  "backoffMs": [3600000, 14400000, 86400000],
  "outlierMultiplier": 3.0,
  "staleDays": 30,
  "lotKeywords": ["lot", "bundle", "collection", "set of", "bulk", "mixed"]
}
```

**Step 2: Commit**

```bash
git add server/pricing/scraper-config.json
git commit -m "feat: add eBay scraper configuration file"
```

---

### Task 3: eBay Scraper Module

**Files:**
- Create: `server/pricing/scraper.js`

**Step 1: Install dependencies**

Run: `cd /c/Users/jorda/Desktop/VoiceLogger/server && npm install cheerio undici`

**Step 2: Write the scraper module**

```js
const { load } = require('cheerio');
const { request } = require('undici');
const config = require('./scraper-config.json');

function randomUserAgent() {
  const agents = config.userAgents;
  return agents[Math.floor(Math.random() * agents.length)];
}

function buildSearchUrl(query) {
  const params = new URLSearchParams({ ...config.defaultParams, _nkw: query });
  return `${config.baseUrl}?${params.toString()}`;
}

function parsePriceText(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function parseDateText(text) {
  if (!text) return null;
  // eBay formats: "Sold  Feb 14, 2026" or "Feb 14, 2026"
  const match = text.match(/(\w{3}\s+\d{1,2},?\s+\d{4})/);
  if (!match) return null;
  const d = new Date(match[1]);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

async function scrapeEbaySold(query) {
  const url = buildSearchUrl(query);
  const { selectors } = config;

  let body;
  try {
    const resp = await request(url, {
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirections: 3,
    });

    if (resp.statusCode === 429) {
      return { error: 'rate_limited', results: [] };
    }
    if (resp.statusCode !== 200) {
      return { error: `http_${resp.statusCode}`, results: [] };
    }

    body = await resp.body.text();
  } catch (err) {
    return { error: err.message, results: [] };
  }

  const $ = load(body);
  const results = [];

  $(selectors.resultItem).each((i, el) => {
    const $el = $(el);
    const title = $el.find(selectors.title).text().trim();
    const priceText = $el.find(selectors.price).first().text().trim();
    const dateText = $el.find(selectors.date).text().trim();
    const link = $el.find(selectors.link).attr('href') || '';
    const condition = $el.find(selectors.condition).text().trim();

    const price = parsePriceText(priceText);
    if (price === null || price === 0) return; // skip unparseable

    results.push({
      title,
      price,
      soldDate: parseDateText(dateText),
      listingUrl: link.split('?')[0], // strip tracking params
      condition,
    });
  });

  return { error: null, results };
}

function filterOutliers(results, opts = {}) {
  if (results.length === 0) return { filtered: [], median: null };

  const { lotKeywords, outlierMultiplier } = config;
  const skipLots = opts.skipLots !== false;

  let items = results;

  // Remove lot listings
  if (skipLots) {
    items = items.filter(r => {
      const lower = r.title.toLowerCase();
      return !lotKeywords.some(kw => lower.includes(kw));
    });
  }

  if (items.length === 0) return { filtered: [], median: null };

  // Sort by price to compute median
  const prices = items.map(r => r.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 0
    ? (prices[mid - 1] + prices[mid]) / 2
    : prices[mid];

  // Remove outliers
  const filtered = items.filter(r => {
    return r.price >= median / outlierMultiplier && r.price <= median * outlierMultiplier;
  });

  // Recalculate median after filtering
  const finalPrices = filtered.map(r => r.price).sort((a, b) => a - b);
  const fMid = Math.floor(finalPrices.length / 2);
  const finalMedian = finalPrices.length === 0 ? null
    : finalPrices.length % 2 === 0
      ? (finalPrices[fMid - 1] + finalPrices[fMid]) / 2
      : finalPrices[fMid];

  return { filtered, median: finalMedian };
}

function buildCardQuery(card, set) {
  // card: { card_number, player, parallel }
  // set: { name, year }
  let q = `${set.year} ${set.name} #${card.card_number}`;
  if (card.player) q += ` ${card.player}`;
  if (card.parallel && card.parallel !== 'Base') q += ` ${card.parallel}`;
  return q;
}

function buildSetQuery(set) {
  return `${set.year} ${set.name} complete set`;
}

module.exports = {
  scrapeEbaySold,
  filterOutliers,
  buildCardQuery,
  buildSetQuery,
  buildSearchUrl,
  parsePriceText,
  parseDateText,
};
```

**Step 3: Smoke test the module loads**

Run: `cd /c/Users/jorda/Desktop/VoiceLogger/server && node -e "const s = require('./pricing/scraper'); console.log(Object.keys(s));"`

Expected: `['scrapeEbaySold', 'filterOutliers', 'buildCardQuery', 'buildSetQuery', 'buildSearchUrl', 'parsePriceText', 'parseDateText']`

**Step 4: Commit**

```bash
git add server/pricing/scraper.js server/package.json server/package-lock.json
git commit -m "feat: add eBay sold listing scraper with outlier filtering"
```

---

### Task 4: Sync Service

**Files:**
- Create: `server/pricing/sync.js`

**Step 1: Write the sync service**

```js
const { scrapeEbaySold, filterOutliers, buildCardQuery, buildSetQuery } = require('./scraper');
const config = require('./scraper-config.json');

class SyncService {
  constructor(db) {
    this.db = db;
    this.queue = [];
    this.running = false;
    this.timer = null;
    this.intervalMs = 24 * 60 * 60 * 1000; // 24 hours
    this.enabled = true;
    this.lastSyncTime = null;
    this.syncLog = []; // in-memory log, max 100 entries
  }

  log(entry) {
    this.syncLog.unshift({ ...entry, timestamp: new Date().toISOString() });
    if (this.syncLog.length > 100) this.syncLog.pop();
  }

  start() {
    if (!this.enabled) return;

    // Check if sync is overdue
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
      // 1. Sync set-level prices
      const sets = this.db.prepare(`SELECT * FROM card_sets`).all();
      for (const set of sets) {
        await this._syncSetPrice(set);
        await this._delay(config.rateLimitMs);
      }

      // 2. Sync tracked card prices
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

      // 3. Compute snapshots
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

    // Set snapshots: median of the latest batch of set-level price_history rows
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

      // Card snapshots
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
```

**Step 2: Smoke test the module loads**

Run: `cd /c/Users/jorda/Desktop/VoiceLogger/server && node -e "const { SyncService } = require('./pricing/sync'); console.log('SyncService loaded');"`

Expected: `SyncService loaded`

**Step 3: Commit**

```bash
git add server/pricing/sync.js
git commit -m "feat: add background sync service with queue, rate limiting, and snapshot computation"
```

---

### Task 5: Wire Sync Service into Express Server

**Files:**
- Modify: `server/index.js` (~lines 15-40)

**Step 1: Import and start SyncService in createServer**

After `const routes = createRoutes(db);` (around line 24), add:

```js
const { SyncService } = require('./pricing/sync');
const syncService = new SyncService(db);
app.locals.syncService = syncService;

// Start background sync after a short delay to let the app fully initialize
setTimeout(() => syncService.start(), 5000);
```

In the graceful shutdown handlers (around lines 31-37), add `syncService.stop()` before `db.close()`.

**Step 2: Verify the server starts without errors**

Run: `cd /c/Users/jorda/Desktop/VoiceLogger/server && timeout 5 node index.js --port 8099 || true`

Expected: Server starts on port 8099 without crashing. The sync service initializes in the background.

**Step 3: Commit**

```bash
git add server/index.js
git commit -m "feat: wire sync service into Express server lifecycle"
```

---

### Task 6: Pricing API Routes

**Files:**
- Modify: `server/routes.js` (add new endpoints after existing routes, before the final `return router`)

**Step 1: Add tracked card endpoints**

After the last existing route (around line 871), add:

```js
// ─── PRICING ROUTES ───────────────────────────────────────────────

// Track/untrack a card
router.post('/api/cards/:id/track', (req, res) => {
  const card = db.prepare(`SELECT * FROM cards WHERE id = ?`).get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  const set = db.prepare(`SELECT * FROM card_sets WHERE id = ?`).get(card.set_id);
  const { buildCardQuery } = require('./pricing/scraper');
  const query = buildCardQuery(card, set);

  db.prepare(`INSERT OR IGNORE INTO tracked_cards (card_id, search_query) VALUES (?, ?)`).run(card.id, query);
  const tracked = db.prepare(`SELECT * FROM tracked_cards WHERE card_id = ?`).get(card.id);
  res.json(tracked);
});

router.delete('/api/cards/:id/track', (req, res) => {
  db.prepare(`DELETE FROM tracked_cards WHERE card_id = ?`).run(req.params.id);
  res.json({ ok: true });
});

// Get all tracked cards (with latest price info)
router.get('/api/tracked-cards', (req, res) => {
  const rows = db.prepare(`
    SELECT tc.*, c.card_number, c.player, c.team, c.parallel, c.insert_type,
           cs.name as set_name, cs.year as set_year, cs.id as set_id,
           ps.median_price, ps.snapshot_date
    FROM tracked_cards tc
    JOIN cards c ON tc.card_id = c.id
    JOIN card_sets cs ON c.set_id = cs.id
    LEFT JOIN price_snapshots ps ON ps.card_id = c.id
      AND ps.snapshot_date = (SELECT MAX(snapshot_date) FROM price_snapshots WHERE card_id = c.id)
    ORDER BY ps.median_price DESC NULLS LAST
  `).all();
  res.json(rows);
});

// Check if a card is tracked
router.get('/api/cards/:id/tracked', (req, res) => {
  const tracked = db.prepare(`SELECT * FROM tracked_cards WHERE card_id = ?`).get(req.params.id);
  res.json({ tracked: !!tracked, data: tracked || null });
});

// Update tracked card search query
router.put('/api/tracked-cards/:id', (req, res) => {
  const { search_query } = req.body;
  db.prepare(`UPDATE tracked_cards SET search_query = ? WHERE id = ?`).run(search_query, req.params.id);
  res.json({ ok: true });
});

// Get price history for a card
router.get('/api/cards/:id/price-history', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM price_history WHERE card_id = ? ORDER BY sold_date DESC, fetched_at DESC
  `).all(req.params.id);
  res.json(rows);
});

// Get price history for a set (set-level)
router.get('/api/sets/:id/price-history', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM price_history WHERE set_id = ? ORDER BY sold_date DESC, fetched_at DESC
  `).all(req.params.id);
  res.json(rows);
});

// Get price snapshots for a set over time
router.get('/api/sets/:id/price-snapshots', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM price_snapshots WHERE set_id = ? AND card_id IS NULL ORDER BY snapshot_date ASC
  `).all(req.params.id);
  res.json(rows);
});

// Get price snapshots for a card over time
router.get('/api/cards/:id/price-snapshots', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM price_snapshots WHERE card_id = ? ORDER BY snapshot_date ASC
  `).all(req.params.id);
  res.json(rows);
});

// Portfolio summary
router.get('/api/portfolio', (req, res) => {
  // Latest set values
  const setValues = db.prepare(`
    SELECT cs.id, cs.name, cs.year, ps.median_price, ps.snapshot_date
    FROM card_sets cs
    LEFT JOIN price_snapshots ps ON ps.set_id = cs.id AND ps.card_id IS NULL
      AND ps.snapshot_date = (SELECT MAX(snapshot_date) FROM price_snapshots WHERE set_id = cs.id AND card_id IS NULL)
    ORDER BY ps.median_price DESC NULLS LAST
  `).all();

  // Latest tracked card values
  const cardValues = db.prepare(`
    SELECT c.id, c.card_number, c.player, c.parallel, cs.name as set_name, cs.year as set_year,
           ps.median_price, ps.snapshot_date
    FROM tracked_cards tc
    JOIN cards c ON tc.card_id = c.id
    JOIN card_sets cs ON c.set_id = cs.id
    LEFT JOIN price_snapshots ps ON ps.card_id = c.id
      AND ps.snapshot_date = (SELECT MAX(snapshot_date) FROM price_snapshots WHERE card_id = c.id)
    ORDER BY ps.median_price DESC NULLS LAST
  `).all();

  // Total portfolio value over time (sum of all set snapshots per date)
  const timeline = db.prepare(`
    SELECT snapshot_date, SUM(median_price) as total_value
    FROM price_snapshots
    WHERE set_id IS NOT NULL AND card_id IS NULL
    GROUP BY snapshot_date
    ORDER BY snapshot_date ASC
  `).all();

  const totalSetValue = setValues.reduce((sum, s) => sum + (s.median_price || 0), 0);
  const totalCardValue = cardValues.reduce((sum, c) => sum + (c.median_price || 0), 0);

  res.json({
    totalValue: totalSetValue + totalCardValue,
    totalSetValue,
    totalCardValue,
    topSets: setValues.filter(s => s.median_price).slice(0, 5),
    topCards: cardValues.filter(c => c.median_price).slice(0, 5),
    timeline,
  });
});

// Sync control endpoints
router.get('/api/sync/status', (req, res) => {
  const syncService = req.app.locals.syncService;
  res.json(syncService ? syncService.getStatus() : { running: false, enabled: false });
});

router.post('/api/sync/trigger', async (req, res) => {
  const syncService = req.app.locals.syncService;
  if (!syncService) return res.status(500).json({ error: 'Sync service not available' });
  if (syncService.running) return res.json({ message: 'Sync already running' });
  syncService.runFullSync(); // fire and forget
  res.json({ message: 'Sync started' });
});

router.put('/api/sync/settings', (req, res) => {
  const syncService = req.app.locals.syncService;
  if (!syncService) return res.status(500).json({ error: 'Sync service not available' });
  const { enabled, intervalHours } = req.body;
  if (typeof enabled === 'boolean') syncService.setEnabled(enabled);
  if (typeof intervalHours === 'number' && intervalHours > 0) {
    syncService.setInterval(intervalHours * 60 * 60 * 1000);
  }
  res.json(syncService.getStatus());
});
```

**Step 2: Test a basic endpoint**

Run: Start the server and test with curl:
```bash
cd /c/Users/jorda/Desktop/VoiceLogger/server && node index.js --port 8099 &
sleep 2
curl -s http://localhost:8099/api/sync/status | head -c 200
kill %1
```

Expected: JSON response with `running`, `enabled`, etc.

**Step 3: Commit**

```bash
git add server/routes.js
git commit -m "feat: add pricing API routes (track, price history, portfolio, sync control)"
```

---

### Task 7: Install Frontend Charting Library

**Files:**
- Modify: `frontend/package.json` (via npm install)

**Step 1: Install recharts**

Run: `cd /c/Users/jorda/Desktop/VoiceLogger/frontend && npm install recharts`

**Step 2: Verify it installed**

Run: `cd /c/Users/jorda/Desktop/VoiceLogger/frontend && node -e "require('recharts'); console.log('recharts ok');"`

**Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "chore: add recharts for pricing charts"
```

---

### Task 8: Card Tracking Toggle on SetDetail

**Files:**
- Modify: `frontend/src/pages/SetDetail.jsx`

This task adds a star icon on each card row to toggle price tracking, and shows the current price badge for tracked cards.

**Step 1: Add tracking state and API calls**

At the top of the `SetDetail` component, add state for tracked card IDs and a fetch call. After the existing `metadata` state (around line 27), add:

```js
const [trackedCards, setTrackedCards] = useState({}); // { cardId: { median_price, ... } }
```

In the existing `useEffect` that fetches data (around line 30), add a call to load tracked status for all cards in this set:

```js
// After fetching cards, load tracked status
axios.get(`${API}/api/tracked-cards`).then(r => {
  const map = {};
  r.data.filter(tc => tc.set_id === parseInt(id)).forEach(tc => {
    map[tc.card_id] = tc;
  });
  setTrackedCards(map);
}).catch(() => {});
```

Add toggle function:

```js
const toggleTrack = async (cardId) => {
  if (trackedCards[cardId]) {
    await axios.delete(`${API}/api/cards/${cardId}/track`);
    setTrackedCards(prev => { const next = { ...prev }; delete next[cardId]; return next; });
  } else {
    const resp = await axios.post(`${API}/api/cards/${cardId}/track`);
    setTrackedCards(prev => ({ ...prev, [cardId]: resp.data }));
  }
};
```

**Step 2: Add star icon and price badge to card rows**

In the card table rows (around line 400+), before the card number column, add:

```jsx
<td className="px-2 py-1 text-center">
  <button
    onClick={() => toggleTrack(card.id)}
    className={`hover:scale-110 transition-transform ${trackedCards[card.id] ? 'text-yellow-400' : 'text-gray-600'}`}
    title={trackedCards[card.id] ? 'Stop tracking price' : 'Track price on eBay'}
  >
    {trackedCards[card.id] ? '★' : '☆'}
  </button>
</td>
```

After the last data column and before actions, add a price column:

```jsx
<td className="px-3 py-1 text-right text-sm">
  {trackedCards[card.id]?.median_price != null ? (
    <span className="text-green-400 font-mono">${trackedCards[card.id].median_price.toFixed(2)}</span>
  ) : trackedCards[card.id] ? (
    <span className="text-gray-500 text-xs">No data</span>
  ) : null}
</td>
```

Add corresponding `<th>` headers for the Track and Price columns in the table header.

**Step 3: Verify the page renders without errors**

Run the dev server and navigate to a set detail page. Stars should appear. Clicking should toggle tracking.

**Step 4: Commit**

```bash
git add frontend/src/pages/SetDetail.jsx
git commit -m "feat: add card price tracking toggle and price badge on SetDetail"
```

---

### Task 9: Set Value Section on SetDetail

**Files:**
- Modify: `frontend/src/pages/SetDetail.jsx`

This task adds a value summary section at the top of the SetDetail page showing the set's estimated market value, a sparkline trend, and a list of tracked cards with their prices.

**Step 1: Add price state and fetch**

Add new state variables:

```js
const [setPrice, setSetPrice] = useState(null); // { median_price, snapshot_date }
const [setSnapshots, setSetSnapshots] = useState([]); // for sparkline
```

In the data fetch `useEffect`, add:

```js
axios.get(`${API}/api/sets/${id}/price-snapshots`).then(r => {
  setSetSnapshots(r.data);
  if (r.data.length > 0) setSetPrice(r.data[r.data.length - 1]);
}).catch(() => {});
```

**Step 2: Add the value panel component**

Below the header card and above the search/filter bar, add:

```jsx
{/* Set Value Panel */}
{(setPrice || Object.keys(trackedCards).length > 0) && (
  <div className="bg-[#1a1f2e] rounded-xl p-5 mb-6 border border-gray-800">
    <h3 className="text-lg font-semibold text-gray-200 mb-3">Estimated Value</h3>
    <div className="flex items-end gap-8">
      <div>
        <div className="text-3xl font-bold text-green-400 font-mono">
          {setPrice ? `$${setPrice.median_price.toFixed(2)}` : 'No data yet'}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {setPrice ? `Set value as of ${setPrice.snapshot_date}` : 'Sync to get pricing'}
        </div>
      </div>
      {setSnapshots.length > 1 && (
        <div className="w-48 h-12">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={setSnapshots}>
              <Area type="monotone" dataKey="median_price" stroke="#00d4aa" fill="#00d4aa" fillOpacity={0.15} strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>

    {/* Tracked cards in this set */}
    {Object.keys(trackedCards).length > 0 && (
      <div className="mt-4 border-t border-gray-700 pt-3">
        <h4 className="text-sm font-medium text-gray-400 mb-2">Tracked Cards</h4>
        {Object.values(trackedCards).map(tc => (
          <div key={tc.card_id} className="flex justify-between items-center py-1 text-sm">
            <span className="text-gray-300">#{tc.card_number} {tc.player}</span>
            <span className="text-green-400 font-mono">
              {tc.median_price != null ? `$${tc.median_price.toFixed(2)}` : 'No data'}
            </span>
          </div>
        ))}
      </div>
    )}
  </div>
)}
```

**Step 3: Import recharts at the top of the file**

```js
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
```

**Step 4: Verify the panel renders**

Start the dev server, navigate to SetDetail. The value panel should appear (empty state with "No data yet" until a sync runs).

**Step 5: Commit**

```bash
git add frontend/src/pages/SetDetail.jsx
git commit -m "feat: add set value panel with sparkline and tracked card prices on SetDetail"
```

---

### Task 10: Tracked Card Expanded Detail (Price History Inline)

**Files:**
- Modify: `frontend/src/pages/SetDetail.jsx`

When a tracked card in the value panel is clicked, expand to show: price history table, eBay links, and a mini price chart.

**Step 1: Add expanded state and data fetch**

```js
const [expandedCardId, setExpandedCardId] = useState(null);
const [cardPriceHistory, setCardPriceHistory] = useState([]);
const [cardSnapshots, setCardSnapshots] = useState([]);
```

When a tracked card is clicked:

```js
const expandTrackedCard = async (cardId) => {
  if (expandedCardId === cardId) { setExpandedCardId(null); return; }
  setExpandedCardId(cardId);
  const [histResp, snapResp] = await Promise.all([
    axios.get(`${API}/api/cards/${cardId}/price-history`),
    axios.get(`${API}/api/cards/${cardId}/price-snapshots`),
  ]);
  setCardPriceHistory(histResp.data);
  setCardSnapshots(snapResp.data);
};
```

**Step 2: Add the expanded panel below each tracked card row**

Replace the tracked card list items in the value panel with clickable versions:

```jsx
{Object.values(trackedCards).map(tc => (
  <div key={tc.card_id}>
    <div
      onClick={() => expandTrackedCard(tc.card_id)}
      className="flex justify-between items-center py-1 text-sm cursor-pointer hover:bg-gray-800/50 rounded px-2"
    >
      <span className="text-gray-300">#{tc.card_number} {tc.player} {expandedCardId === tc.card_id ? '▾' : '▸'}</span>
      <span className="text-green-400 font-mono">
        {tc.median_price != null ? `$${tc.median_price.toFixed(2)}` : 'No data'}
      </span>
    </div>

    {expandedCardId === tc.card_id && (
      <div className="bg-[#151a26] rounded-lg p-4 mt-1 mb-2 ml-4 border border-gray-700">
        {/* Mini chart */}
        {cardSnapshots.length > 1 && (
          <div className="h-24 mb-3">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cardSnapshots}>
                <Area type="monotone" dataKey="median_price" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Price history table */}
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-500 border-b border-gray-700">
              <th className="text-left py-1">Date</th>
              <th className="text-right py-1">Price</th>
              <th className="text-left py-1 pl-3">Condition</th>
              <th className="text-left py-1 pl-3">Listing</th>
            </tr>
          </thead>
          <tbody>
            {cardPriceHistory.slice(0, 20).map(ph => (
              <tr key={ph.id} className="border-b border-gray-800">
                <td className="py-1 text-gray-400">{ph.sold_date || 'N/A'}</td>
                <td className="py-1 text-right text-green-400 font-mono">${ph.price.toFixed(2)}</td>
                <td className="py-1 pl-3 text-gray-500">{ph.condition || '—'}</td>
                <td className="py-1 pl-3">
                  {ph.listing_url ? (
                    <a href={ph.listing_url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline truncate block max-w-[200px]">
                      {ph.listing_title || 'View'}
                    </a>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {cardPriceHistory.length === 0 && (
          <div className="text-gray-500 text-center py-2">No price data yet. Run a sync to fetch prices.</div>
        )}
      </div>
    )}
  </div>
))}
```

**Step 3: Verify expansion works**

Navigate to a set with tracked cards. Click a tracked card name -- it should expand showing chart and table (or empty state).

**Step 4: Commit**

```bash
git add frontend/src/pages/SetDetail.jsx
git commit -m "feat: add expandable price history with chart and eBay links for tracked cards"
```

---

### Task 11: Portfolio Panel on Dashboard

**Files:**
- Modify: `frontend/src/pages/Dashboard.jsx`

**Step 1: Add portfolio state and fetch**

After existing state declarations (around line 131), add:

```js
const [portfolio, setPortfolio] = useState(null);
```

In the existing `useEffect` (around line 133), add:

```js
axios.get(`${API}/api/portfolio`).then(r => setPortfolio(r.data)).catch(() => {});
```

**Step 2: Import recharts**

```js
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
```

**Step 3: Add the portfolio panel**

After the "Your Collection" section (around line 321) and before "Quick Start", add:

```jsx
{/* Portfolio Value */}
{portfolio && (portfolio.totalValue > 0 || portfolio.timeline.length > 0) && (
  <div className="mt-10">
    <h2 className="text-2xl font-bold text-gray-100 mb-4">Portfolio Value</h2>
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Total value card */}
      <div className="bg-[#1a1f2e] rounded-xl p-5 border border-gray-800 col-span-1">
        <div className="text-sm text-gray-400 mb-1">Total Estimated Value</div>
        <div className="text-3xl font-bold text-green-400 font-mono">
          ${portfolio.totalValue.toFixed(2)}
        </div>
        <div className="mt-3 text-xs text-gray-500">
          Sets: ${portfolio.totalSetValue.toFixed(2)} &middot; Cards: ${portfolio.totalCardValue.toFixed(2)}
        </div>
      </div>

      {/* Value chart */}
      {portfolio.timeline.length > 1 && (
        <div className="bg-[#1a1f2e] rounded-xl p-5 border border-gray-800 col-span-2">
          <div className="text-sm text-gray-400 mb-2">Value Over Time</div>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={portfolio.timeline}>
                <XAxis dataKey="snapshot_date" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <Tooltip
                  contentStyle={{ background: '#1a1f2e', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#9ca3af' }}
                  formatter={(val) => [`$${val.toFixed(2)}`, 'Value']}
                />
                <Area type="monotone" dataKey="total_value" stroke="#00d4aa" fill="#00d4aa" fillOpacity={0.15} strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>

    {/* Top cards and sets */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      {portfolio.topSets.length > 0 && (
        <div className="bg-[#1a1f2e] rounded-xl p-5 border border-gray-800">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Top Sets by Value</h3>
          {portfolio.topSets.map((s, i) => (
            <div key={s.id} className="flex justify-between items-center py-1.5 text-sm border-b border-gray-800 last:border-0">
              <span className="text-gray-300">{i + 1}. {s.year} {s.name}</span>
              <span className="text-green-400 font-mono">${s.median_price.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}

      {portfolio.topCards.length > 0 && (
        <div className="bg-[#1a1f2e] rounded-xl p-5 border border-gray-800">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Top Tracked Cards</h3>
          {portfolio.topCards.map((c, i) => (
            <div key={c.id} className="flex justify-between items-center py-1.5 text-sm border-b border-gray-800 last:border-0">
              <span className="text-gray-300">{i + 1}. #{c.card_number} {c.player} <span className="text-gray-500">({c.set_year} {c.set_name})</span></span>
              <span className="text-green-400 font-mono">${c.median_price.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
)}
```

**Step 4: Verify the dashboard renders**

Start the dev server, visit the dashboard. The portfolio section should appear (hidden if no pricing data exists yet).

**Step 5: Commit**

```bash
git add frontend/src/pages/Dashboard.jsx
git commit -m "feat: add portfolio value panel with chart and top cards/sets to Dashboard"
```

---

### Task 12: Settings Page

**Files:**
- Create: `frontend/src/pages/Settings.jsx`
- Modify: `frontend/src/App.jsx` (add route)

**Step 1: Create the Settings page component**

```jsx
import { useState, useEffect } from 'react';
import axios from 'axios';
import { Settings as SettingsIcon, RefreshCw, Clock, ToggleLeft, ToggleRight } from 'lucide-react';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function Settings() {
  const [status, setStatus] = useState(null);
  const [intervalHours, setIntervalHours] = useState(24);
  const [trackedCards, setTrackedCards] = useState([]);
  const [editingQuery, setEditingQuery] = useState(null);
  const [queryText, setQueryText] = useState('');

  const fetchStatus = () => {
    axios.get(`${API}/api/sync/status`).then(r => {
      setStatus(r.data);
      setIntervalHours(Math.round(r.data.intervalMs / 3600000));
    }).catch(() => {});
  };

  useEffect(() => {
    fetchStatus();
    axios.get(`${API}/api/tracked-cards`).then(r => setTrackedCards(r.data)).catch(() => {});
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const triggerSync = () => {
    axios.post(`${API}/api/sync/trigger`).then(fetchStatus);
  };

  const toggleEnabled = () => {
    axios.put(`${API}/api/sync/settings`, { enabled: !status.enabled }).then(r => setStatus(r.data));
  };

  const updateInterval = () => {
    axios.put(`${API}/api/sync/settings`, { intervalHours }).then(r => setStatus(r.data));
  };

  const saveQuery = (tcId) => {
    axios.put(`${API}/api/tracked-cards/${tcId}`, { search_query: queryText }).then(() => {
      setEditingQuery(null);
      axios.get(`${API}/api/tracked-cards`).then(r => setTrackedCards(r.data));
    });
  };

  if (!status) return <div className="text-gray-400 p-8">Loading...</div>;

  return (
    <div className="max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-100 mb-6 flex items-center gap-2">
        <SettingsIcon size={24} /> Settings
      </h1>

      {/* Sync Controls */}
      <div className="bg-[#1a1f2e] rounded-xl p-5 border border-gray-800 mb-6">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">Price Sync</h2>

        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm text-gray-300">Auto-Sync</div>
            <div className="text-xs text-gray-500">Automatically fetch prices on a schedule</div>
          </div>
          <button onClick={toggleEnabled} className="text-2xl">
            {status.enabled ? <ToggleRight className="text-green-400" size={32} /> : <ToggleLeft className="text-gray-600" size={32} />}
          </button>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <label className="text-sm text-gray-300">Sync every</label>
          <input
            type="number"
            value={intervalHours}
            onChange={e => setIntervalHours(parseInt(e.target.value) || 24)}
            className="w-20 bg-[#0f1419] border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
            min={1}
          />
          <span className="text-sm text-gray-400">hours</span>
          <button onClick={updateInterval} className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 px-3 py-1 rounded">
            Save
          </button>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={triggerSync}
            disabled={status.running}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${
              status.running ? 'bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-cyan-600 hover:bg-cyan-500 text-white'
            }`}
          >
            <RefreshCw size={16} className={status.running ? 'animate-spin' : ''} />
            {status.running ? 'Syncing...' : 'Sync Now'}
          </button>
          <div className="text-xs text-gray-500">
            {status.lastSyncTime ? `Last sync: ${new Date(status.lastSyncTime).toLocaleString()}` : 'Never synced'}
            {status.running && ` · ${status.queueLength} items in queue`}
          </div>
        </div>
      </div>

      {/* Tracked Cards & Query Editor */}
      <div className="bg-[#1a1f2e] rounded-xl p-5 border border-gray-800 mb-6">
        <h2 className="text-lg font-semibold text-gray-200 mb-4">Tracked Cards ({trackedCards.length})</h2>
        {trackedCards.length === 0 ? (
          <div className="text-gray-500 text-sm">No cards tracked yet. Go to a set and click the star icon on cards you want to track.</div>
        ) : (
          <div className="space-y-2">
            {trackedCards.map(tc => (
              <div key={tc.id} className="border border-gray-700 rounded-lg p-3">
                <div className="flex justify-between items-center">
                  <div>
                    <span className="text-gray-200 text-sm font-medium">#{tc.card_number} {tc.player}</span>
                    <span className="text-gray-500 text-xs ml-2">{tc.set_year} {tc.set_name}</span>
                  </div>
                  <span className="text-green-400 font-mono text-sm">
                    {tc.median_price != null ? `$${tc.median_price.toFixed(2)}` : 'No data'}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {editingQuery === tc.id ? (
                    <>
                      <input
                        value={queryText}
                        onChange={e => setQueryText(e.target.value)}
                        className="flex-1 bg-[#0f1419] border border-gray-600 rounded px-2 py-1 text-xs text-gray-200"
                      />
                      <button onClick={() => saveQuery(tc.id)} className="text-xs bg-cyan-700 hover:bg-cyan-600 text-white px-2 py-1 rounded">Save</button>
                      <button onClick={() => setEditingQuery(null)} className="text-xs text-gray-400 hover:text-gray-200">Cancel</button>
                    </>
                  ) : (
                    <>
                      <span className="text-xs text-gray-500 truncate flex-1">Query: {tc.search_query}</span>
                      <button
                        onClick={() => { setEditingQuery(tc.id); setQueryText(tc.search_query); }}
                        className="text-xs text-cyan-400 hover:text-cyan-300"
                      >Edit</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sync Log */}
      <div className="bg-[#1a1f2e] rounded-xl p-5 border border-gray-800">
        <h2 className="text-lg font-semibold text-gray-200 mb-4 flex items-center gap-2">
          <Clock size={18} /> Sync Log
        </h2>
        <div className="max-h-80 overflow-y-auto space-y-1">
          {status.log.length === 0 ? (
            <div className="text-gray-500 text-sm">No sync activity yet.</div>
          ) : (
            status.log.map((entry, i) => (
              <div key={i} className={`text-xs py-1 px-2 rounded flex items-start gap-2 ${
                entry.type === 'error' ? 'text-red-400 bg-red-900/10' :
                entry.type === 'warn' ? 'text-yellow-400 bg-yellow-900/10' :
                entry.type === 'success' ? 'text-green-400 bg-green-900/10' :
                'text-gray-400'
              }`}>
                <span className="text-gray-600 whitespace-nowrap">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                <span>{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Add route in App.jsx**

In `frontend/src/App.jsx`, add the import at the top:

```js
import Settings from './pages/Settings';
```

In the route definitions (around line 140), add before the closing `</Route>`:

```jsx
<Route path="/settings" element={<Settings />} />
```

**Step 3: Add Settings nav link**

In the `Layout` component's nav bar (around line 110-120), add a Settings link alongside the existing nav items:

```jsx
<NavLink to="/settings" icon={<SettingsIcon size={16} />}>Settings</NavLink>
```

Import the icon at the top: `import { Settings as SettingsIcon } from 'lucide-react';`

**Step 4: Verify the page renders**

Navigate to `/settings`. The sync controls, tracked cards list, and sync log should all display.

**Step 5: Commit**

```bash
git add frontend/src/pages/Settings.jsx frontend/src/App.jsx
git commit -m "feat: add Settings page with sync controls, query editor, and sync log"
```

---

### Task 13: Price History Page (Full Detail)

**Files:**
- Create: `frontend/src/pages/PriceHistory.jsx`
- Modify: `frontend/src/App.jsx` (add route)

**Step 1: Create the PriceHistory page**

```jsx
import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { AreaChart, Area, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function PriceHistory() {
  const { cardId } = useParams();
  const [card, setCard] = useState(null);
  const [history, setHistory] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [sortField, setSortField] = useState('sold_date');
  const [sortDir, setSortDir] = useState('desc');
  const [filterCondition, setFilterCondition] = useState('all');

  useEffect(() => {
    Promise.all([
      axios.get(`${API}/api/cards/${cardId}/price-history`),
      axios.get(`${API}/api/cards/${cardId}/price-snapshots`),
      axios.get(`${API}/api/cards/${cardId}/tracked`),
    ]).then(([histResp, snapResp, trackResp]) => {
      setHistory(histResp.data);
      setSnapshots(snapResp.data);
      if (trackResp.data.data) {
        setCard(trackResp.data.data);
      }
    });
  }, [cardId]);

  const conditions = useMemo(() => {
    const set = new Set(history.map(h => h.condition).filter(Boolean));
    return ['all', ...Array.from(set)];
  }, [history]);

  const filtered = useMemo(() => {
    let items = history;
    if (filterCondition !== 'all') {
      items = items.filter(h => h.condition === filterCondition);
    }
    items.sort((a, b) => {
      const aVal = a[sortField] || '';
      const bVal = b[sortField] || '';
      if (sortField === 'price') return sortDir === 'asc' ? a.price - b.price : b.price - a.price;
      return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    });
    return items;
  }, [history, sortField, sortDir, filterCondition]);

  const toggleSort = (field) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const sortIcon = (field) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-100 mb-2">
        Price History {card && <>— #{card.card_number} {card.player}</>}
      </h1>
      {card && (
        <div className="text-sm text-gray-500 mb-6">
          {card.set_year} {card.set_name} · Query: <span className="text-gray-400">{card.search_query}</span>
        </div>
      )}

      {/* Chart */}
      {snapshots.length > 1 && (
        <div className="bg-[#1a1f2e] rounded-xl p-5 border border-gray-800 mb-6">
          <div className="text-sm text-gray-400 mb-2">Price Over Time</div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={snapshots}>
                <XAxis dataKey="snapshot_date" tick={{ fontSize: 10, fill: '#6b7280' }} />
                <YAxis tick={{ fontSize: 10, fill: '#6b7280' }} tickFormatter={v => `$${v}`} width={50} />
                <Tooltip
                  contentStyle={{ background: '#1a1f2e', border: '1px solid #374151', borderRadius: 8 }}
                  labelStyle={{ color: '#9ca3af' }}
                  formatter={(val) => [`$${val.toFixed(2)}`, 'Median']}
                />
                <Area type="monotone" dataKey="median_price" stroke="#6366f1" fill="#6366f1" fillOpacity={0.15} strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center gap-4 mb-4">
        <label className="text-sm text-gray-400">Condition:</label>
        <select
          value={filterCondition}
          onChange={e => setFilterCondition(e.target.value)}
          className="bg-[#0f1419] border border-gray-700 rounded px-2 py-1 text-sm text-gray-200"
        >
          {conditions.map(c => <option key={c} value={c}>{c === 'all' ? 'All' : c}</option>)}
        </select>
        <span className="text-xs text-gray-500">{filtered.length} listings</span>
      </div>

      {/* Table */}
      <div className="bg-[#1a1f2e] rounded-xl border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-gray-400 border-b border-gray-700 bg-[#151a26]">
              <th className="text-left px-4 py-2 cursor-pointer hover:text-gray-200" onClick={() => toggleSort('sold_date')}>
                Date{sortIcon('sold_date')}
              </th>
              <th className="text-right px-4 py-2 cursor-pointer hover:text-gray-200" onClick={() => toggleSort('price')}>
                Price{sortIcon('price')}
              </th>
              <th className="text-left px-4 py-2 cursor-pointer hover:text-gray-200" onClick={() => toggleSort('condition')}>
                Condition{sortIcon('condition')}
              </th>
              <th className="text-left px-4 py-2">Listing</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(ph => (
              <tr key={ph.id} className="border-b border-gray-800 hover:bg-gray-800/30">
                <td className="px-4 py-2 text-gray-300">{ph.sold_date || 'N/A'}</td>
                <td className="px-4 py-2 text-right text-green-400 font-mono">${ph.price.toFixed(2)}</td>
                <td className="px-4 py-2 text-gray-400">{ph.condition || '—'}</td>
                <td className="px-4 py-2">
                  {ph.listing_url ? (
                    <a href={ph.listing_url} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline truncate block max-w-xs">
                      {ph.listing_title || 'View on eBay'}
                    </a>
                  ) : (
                    <span className="text-gray-600">{ph.listing_title || '—'}</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={4} className="text-center text-gray-500 py-8">No price data yet. Run a sync to fetch prices.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

**Step 2: Add route in App.jsx**

Import:
```js
import PriceHistory from './pages/PriceHistory';
```

Route:
```jsx
<Route path="/cards/:cardId/prices" element={<PriceHistory />} />
```

**Step 3: Add link from SetDetail tracked card expanded panel**

In the expanded panel in SetDetail (Task 10), add a "View Full History" link below the table:

```jsx
<Link to={`/cards/${tc.card_id}/prices`} className="text-xs text-cyan-400 hover:underline mt-2 inline-block">
  View Full Price History →
</Link>
```

Import `Link` from `react-router-dom` if not already imported.

**Step 4: Verify the page renders**

Navigate to `/cards/1/prices`. Should show chart, filter, and table (or empty state).

**Step 5: Commit**

```bash
git add frontend/src/pages/PriceHistory.jsx frontend/src/App.jsx frontend/src/pages/SetDetail.jsx
git commit -m "feat: add full Price History page with sortable table, chart, and condition filter"
```

---

### Task 14: Recent Price Changes Feed on Dashboard

**Files:**
- Modify: `server/routes.js` (add endpoint)
- Modify: `frontend/src/pages/Dashboard.jsx` (add feed)

**Step 1: Add recent changes endpoint**

In `server/routes.js`, add after the portfolio endpoint:

```js
// Recent price changes (cards with significant movement)
router.get('/api/portfolio/changes', (req, res) => {
  const rows = db.prepare(`
    SELECT c.id, c.card_number, c.player, cs.name as set_name, cs.year as set_year,
           curr.median_price as current_price,
           prev.median_price as previous_price
    FROM price_snapshots curr
    JOIN cards c ON curr.card_id = c.id
    JOIN card_sets cs ON c.set_id = cs.id
    LEFT JOIN price_snapshots prev ON prev.card_id = curr.card_id
      AND prev.snapshot_date = (
        SELECT MAX(snapshot_date) FROM price_snapshots
        WHERE card_id = curr.card_id AND snapshot_date < curr.snapshot_date
      )
    WHERE curr.card_id IS NOT NULL
      AND curr.snapshot_date = (SELECT MAX(snapshot_date) FROM price_snapshots WHERE card_id = curr.card_id)
      AND prev.median_price IS NOT NULL
      AND ABS(curr.median_price - prev.median_price) / prev.median_price > 0.1
    ORDER BY ABS(curr.median_price - prev.median_price) DESC
    LIMIT 10
  `).all();
  res.json(rows);
});
```

**Step 2: Add feed to Dashboard**

In Dashboard.jsx, add state:

```js
const [priceChanges, setPriceChanges] = useState([]);
```

Fetch in useEffect:

```js
axios.get(`${API}/api/portfolio/changes`).then(r => setPriceChanges(r.data)).catch(() => {});
```

Add the feed section after the top cards/sets grid in the portfolio panel:

```jsx
{priceChanges.length > 0 && (
  <div className="bg-[#1a1f2e] rounded-xl p-5 border border-gray-800 mt-4">
    <h3 className="text-sm font-semibold text-gray-300 mb-3">Recent Price Changes</h3>
    {priceChanges.map(c => {
      const diff = c.current_price - c.previous_price;
      const pct = ((diff / c.previous_price) * 100).toFixed(1);
      const up = diff > 0;
      return (
        <div key={c.id} className="flex justify-between items-center py-1.5 text-sm border-b border-gray-800 last:border-0">
          <span className="text-gray-300">#{c.card_number} {c.player} <span className="text-gray-500">({c.set_year} {c.set_name})</span></span>
          <span className={`font-mono ${up ? 'text-green-400' : 'text-red-400'}`}>
            {up ? '↑' : '↓'} {up ? '+' : ''}{pct}% (${c.current_price.toFixed(2)})
          </span>
        </div>
      );
    })}
  </div>
)}
```

**Step 3: Commit**

```bash
git add server/routes.js frontend/src/pages/Dashboard.jsx
git commit -m "feat: add recent price changes feed to Dashboard"
```

---

### Task 15: Final Integration Test

**Step 1: Start the full app**

Run: `cd /c/Users/jorda/Desktop/VoiceLogger && bash start-dev.bat` (or start server + frontend separately)

**Step 2: Manual verification checklist**

- [ ] App starts without errors
- [ ] Dashboard loads, portfolio section hidden (no data yet)
- [ ] Navigate to a set, star icons appear on card rows
- [ ] Click star to track a card -- star turns yellow
- [ ] Click star again to untrack -- star turns gray
- [ ] Navigate to Settings -- sync controls visible
- [ ] Click "Sync Now" -- sync log starts populating
- [ ] After sync completes, return to Dashboard -- portfolio panel appears with values
- [ ] Return to set detail -- value section shows set price and tracked card prices
- [ ] Click a tracked card in value section -- expands with price history table and chart
- [ ] Click "View Full Price History" link -- navigates to full price history page
- [ ] Price history page has sortable columns, condition filter, eBay links
- [ ] Settings page shows all tracked cards with editable search queries
- [ ] Edit a search query and save -- query updates

**Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "feat: complete pricing pipeline integration"
```
