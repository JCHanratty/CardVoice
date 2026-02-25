# TCDB Collection Import + Player Metadata Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Import a user's entire TCDB collection (~10,000 cards across 71 pages) into CardVoice, then backfill full checklists, and add a player metadata system (HOF, tiers, focus players) with UI badges and cross-set filtering.

**Architecture:** New Python collection scraper uses authenticated TCDB session cookie to paginate the flat collection view, extracts cards with set IDs, resolves canonical set names, then imports into CardVoice via the existing API. Player metadata lives in a single `player_metadata` table seeded from a bundled HOF JSON file, with UI-managed tiers and focus players. Matching uses normalized exact name comparison.

**Tech Stack:** Python 3 (scraper, BeautifulSoup, cloudscraper), Node.js/Express (API), SQLite (better-sqlite3), React/Tailwind (frontend)

---

### Task 1: Schema — Add `player_metadata` Table + `card_sets` Migrations

**Files:**
- Modify: `server/db.js:267` (before `return db;` at line 271)
- Test: `server/tests/test-routes.js`

**Step 1: Write the failing test**

Add to `server/tests/test-routes.js`:

```javascript
describe('Player Metadata', () => {
  it('can insert and query player_metadata', () => {
    const result = db.prepare(
      "INSERT INTO player_metadata (player_name, tier, is_focus, hof_induction_year, hof_position) VALUES (?, ?, ?, ?, ?)"
    ).run('nolan ryan', 'hof', 1, 1999, 'P');
    const row = db.prepare("SELECT * FROM player_metadata WHERE id = ?").get(result.lastInsertRowid);
    assert.strictEqual(row.player_name, 'nolan ryan');
    assert.strictEqual(row.tier, 'hof');
    assert.strictEqual(row.is_focus, 1);
    assert.strictEqual(row.hof_induction_year, 1999);
  });

  it('enforces unique player_name', () => {
    db.prepare("INSERT INTO player_metadata (player_name, tier) VALUES (?, ?)").run('frank thomas', 'hof');
    assert.throws(() => {
      db.prepare("INSERT INTO player_metadata (player_name, tier) VALUES (?, ?)").run('frank thomas', 'star');
    });
  });

  it('enforces tier CHECK constraint', () => {
    assert.throws(() => {
      db.prepare("INSERT INTO player_metadata (player_name, tier) VALUES (?, ?)").run('bad tier', 'invalid');
    });
  });
});

describe('card_sets migrations', () => {
  it('has checklist_imported column', () => {
    const set = db.prepare("INSERT INTO card_sets (name, year, brand, sport) VALUES (?, ?, ?, ?)").run('MigTest', 2025, 'Topps', 'Baseball');
    const row = db.prepare("SELECT checklist_imported FROM card_sets WHERE id = ?").get(set.lastInsertRowid);
    assert.strictEqual(row.checklist_imported, 0);
  });

  it('has tcdb_set_id column', () => {
    const set = db.prepare("INSERT INTO card_sets (name, year, brand, sport, tcdb_set_id) VALUES (?, ?, ?, ?, ?)").run('TcdbTest', 2025, 'Topps', 'Baseball', 404413);
    const row = db.prepare("SELECT tcdb_set_id FROM card_sets WHERE id = ?").get(set.lastInsertRowid);
    assert.strictEqual(row.tcdb_set_id, 404413);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && node --test tests/test-routes.js`
Expected: FAIL — `no such table: player_metadata` and `no such column: checklist_imported`

**Step 3: Write the migrations**

In `server/db.js`, add before the `_migrateParallelCards(db);` line (around line 267):

```javascript
  // Migration: player_metadata table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS player_metadata (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        player_name        TEXT UNIQUE NOT NULL,
        tier               TEXT CHECK(tier IN ('hof','future_hof','key_rookie','star')),
        is_focus           INTEGER DEFAULT 0,
        focus_added_at     DATETIME,
        hof_induction_year INTEGER,
        hof_position       TEXT,
        hof_primary_team   TEXT
      )
    `);
  } catch (_) {}

  // Migration: card_sets columns for TCDB collection import
  const setMigrations = [
    'ALTER TABLE card_sets ADD COLUMN checklist_imported INTEGER DEFAULT 0',
    'ALTER TABLE card_sets ADD COLUMN tcdb_set_id INTEGER',
  ];
  for (const sql of setMigrations) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }
```

**Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/db.js server/tests/test-routes.js
git commit -m "feat: add player_metadata table and card_sets TCDB columns"
```

---

### Task 2: Seed HOF Data — Bundled JSON + Migration

**Files:**
- Create: `server/data/hof-players.json`
- Modify: `server/db.js` (add seeding function)
- Test: `server/tests/test-routes.js`

**Step 1: Create the HOF data file**

Create `server/data/hof-players.json` with all ~340 Baseball Hall of Fame inductees. Each entry:

```json
[
  {"name": "Hank Aaron", "year": 1982, "position": "OF", "team": "Milwaukee Braves"},
  {"name": "Roberto Alomar", "year": 2011, "position": "2B", "team": "Toronto Blue Jays"},
  ...
]
```

Use the canonical Baseball Hall of Fame roster. Normalize all names (lowercase, no Jr/Sr suffixes). Include every inductee through 2025. This file should be ~340 entries.

**Step 2: Write the seeding function**

In `server/db.js`, add after the `player_metadata` table creation:

```javascript
  // Seed HOF players if table is empty
  const hofCount = db.prepare('SELECT COUNT(*) as cnt FROM player_metadata WHERE tier = ?').get('hof');
  if (hofCount.cnt === 0) {
    _seedHofPlayers(db);
  }
```

Add the seeding function:

```javascript
function _seedHofPlayers(db) {
  const hofPath = require('path').join(__dirname, 'data', 'hof-players.json');
  if (!require('fs').existsSync(hofPath)) return;
  const players = JSON.parse(require('fs').readFileSync(hofPath, 'utf8'));
  const insert = db.prepare(`
    INSERT OR IGNORE INTO player_metadata (player_name, tier, hof_induction_year, hof_position, hof_primary_team)
    VALUES (?, 'hof', ?, ?, ?)
  `);
  const seed = db.transaction(() => {
    for (const p of players) {
      insert.run(p.name.toLowerCase().trim(), p.year, p.position, p.team);
    }
  });
  seed();
  console.log(`[Seed] Loaded ${players.length} HOF players`);
}
```

**Step 3: Write the test**

```javascript
it('seeds HOF players on first run', () => {
  const count = db.prepare("SELECT COUNT(*) as cnt FROM player_metadata WHERE tier = 'hof'").get();
  assert.ok(count.cnt > 300, `Expected 300+ HOF players, got ${count.cnt}`);
  const aaron = db.prepare("SELECT * FROM player_metadata WHERE player_name = 'hank aaron'").get();
  assert.ok(aaron);
  assert.strictEqual(aaron.tier, 'hof');
  assert.strictEqual(aaron.hof_induction_year, 1982);
});
```

**Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/db.js server/data/hof-players.json server/tests/test-routes.js
git commit -m "feat: seed HOF players from bundled JSON"
```

---

### Task 3: Player Metadata API Endpoints

**Files:**
- Modify: `server/routes.js` (add new endpoints)
- Test: `server/tests/test-routes.js`

**Step 1: Write the failing tests**

```javascript
describe('Player Metadata API', () => {
  it('GET /api/player-metadata returns all players', async () => {
    const { status, data } = await api('GET', '/api/player-metadata');
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(data));
    assert.ok(data.length > 300); // HOF seeds
  });

  it('GET /api/player-metadata?tier=hof filters by tier', async () => {
    const { data } = await api('GET', '/api/player-metadata?tier=hof');
    assert.ok(data.every(p => p.tier === 'hof'));
  });

  it('GET /api/player-metadata?is_focus=1 filters focus players', async () => {
    db.prepare("INSERT OR REPLACE INTO player_metadata (player_name, tier, is_focus) VALUES (?, ?, ?)").run('test focus', 'star', 1);
    const { data } = await api('GET', '/api/player-metadata?is_focus=1');
    assert.ok(data.some(p => p.player_name === 'test focus'));
  });

  it('PUT /api/player-metadata/:name sets tier and focus', async () => {
    const { status } = await api('PUT', '/api/player-metadata/mike%20trout', { tier: 'future_hof', is_focus: 1 });
    assert.strictEqual(status, 200);
    const row = db.prepare("SELECT * FROM player_metadata WHERE player_name = 'mike trout'").get();
    assert.strictEqual(row.tier, 'future_hof');
    assert.strictEqual(row.is_focus, 1);
  });

  it('PUT /api/player-metadata/:name/focus toggles focus', async () => {
    db.prepare("INSERT OR IGNORE INTO player_metadata (player_name) VALUES (?)").run('nolan ryan');
    const { status } = await api('PUT', '/api/player-metadata/nolan%20ryan/focus', { is_focus: 1 });
    assert.strictEqual(status, 200);
    const row = db.prepare("SELECT * FROM player_metadata WHERE player_name = 'nolan ryan'").get();
    assert.strictEqual(row.is_focus, 1);
  });

  it('DELETE /api/player-metadata/:name removes non-HOF player', async () => {
    db.prepare("INSERT OR IGNORE INTO player_metadata (player_name, tier) VALUES (?, ?)").run('nobody', 'star');
    const { status } = await api('DELETE', '/api/player-metadata/nobody');
    assert.strictEqual(status, 200);
  });

  it('GET /api/player-metadata/search?q=ryan finds matches', async () => {
    const { data } = await api('GET', '/api/player-metadata/search?q=ryan');
    assert.ok(data.some(p => p.player_name.includes('ryan')));
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — 404 for all new endpoints

**Step 3: Add the endpoints**

In `server/routes.js`, add these endpoints:

```javascript
  // --- Player Metadata ---

  // GET /api/player-metadata — list all (filterable by tier, is_focus)
  router.get('/api/player-metadata', (req, res) => {
    let sql = 'SELECT * FROM player_metadata WHERE 1=1';
    const params = [];
    if (req.query.tier) { sql += ' AND tier = ?'; params.push(req.query.tier); }
    if (req.query.is_focus === '1') { sql += ' AND is_focus = 1'; }
    sql += ' ORDER BY player_name';
    res.json(db.prepare(sql).all(...params));
  });

  // GET /api/player-metadata/search?q=... — search by name substring
  router.get('/api/player-metadata/search', (req, res) => {
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q) return res.json([]);
    res.json(db.prepare("SELECT * FROM player_metadata WHERE player_name LIKE ? ORDER BY player_name LIMIT 50").all(`%${q}%`));
  });

  // PUT /api/player-metadata/:name — upsert tier/focus for a player
  router.put('/api/player-metadata/:name', (req, res) => {
    const name = decodeURIComponent(req.params.name).toLowerCase().trim();
    const { tier, is_focus } = req.body;
    db.prepare(`
      INSERT INTO player_metadata (player_name, tier, is_focus, focus_added_at)
      VALUES (?, ?, ?, CASE WHEN ? = 1 THEN datetime('now','localtime') ELSE NULL END)
      ON CONFLICT(player_name) DO UPDATE SET
        tier = COALESCE(excluded.tier, player_metadata.tier),
        is_focus = excluded.is_focus,
        focus_added_at = CASE WHEN excluded.is_focus = 1 AND player_metadata.is_focus = 0 THEN datetime('now','localtime') ELSE player_metadata.focus_added_at END
    `).run(name, tier || null, is_focus ? 1 : 0, is_focus ? 1 : 0);
    res.json({ ok: true });
  });

  // PUT /api/player-metadata/:name/focus — toggle focus only
  router.put('/api/player-metadata/:name/focus', (req, res) => {
    const name = decodeURIComponent(req.params.name).toLowerCase().trim();
    const { is_focus } = req.body;
    db.prepare(`
      INSERT INTO player_metadata (player_name, is_focus, focus_added_at)
      VALUES (?, ?, CASE WHEN ? = 1 THEN datetime('now','localtime') ELSE NULL END)
      ON CONFLICT(player_name) DO UPDATE SET
        is_focus = excluded.is_focus,
        focus_added_at = CASE WHEN excluded.is_focus = 1 THEN datetime('now','localtime') ELSE player_metadata.focus_added_at END
    `).run(name, is_focus ? 1 : 0, is_focus ? 1 : 0);
    res.json({ ok: true });
  });

  // DELETE /api/player-metadata/:name — remove a player (not HOF)
  router.delete('/api/player-metadata/:name', (req, res) => {
    const name = decodeURIComponent(req.params.name).toLowerCase().trim();
    db.prepare("DELETE FROM player_metadata WHERE player_name = ? AND tier != 'hof'").run(name);
    res.json({ ok: true });
  });
```

**Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/routes.js server/tests/test-routes.js
git commit -m "feat: add player metadata API endpoints"
```

---

### Task 4: Player Name Normalization + Matching Utility

**Files:**
- Create: `server/player-match.js`
- Test: `server/tests/test-routes.js`

**Step 1: Write the failing test**

```javascript
describe('Player Name Normalization', () => {
  it('normalizes Jr/Sr suffixes with word boundaries', () => {
    const { normalizePlayerName } = require('../player-match');
    assert.strictEqual(normalizePlayerName('Cal Ripken Jr.'), 'cal ripken');
    assert.strictEqual(normalizePlayerName('Ken Griffey, Jr'), 'ken griffey');
    assert.strictEqual(normalizePlayerName('Cal Ripken Sr.'), 'cal ripken');
    assert.strictEqual(normalizePlayerName('Roberto Alomar II'), 'roberto alomar');
  });

  it('does not mangle names containing suffix substrings', () => {
    const { normalizePlayerName } = require('../player-match');
    assert.strictEqual(normalizePlayerName('William Smith'), 'william smith');
    assert.strictEqual(normalizePlayerName('Kirby Puckett'), 'kirby puckett');
  });

  it('strips punctuation', () => {
    const { normalizePlayerName } = require('../player-match');
    assert.strictEqual(normalizePlayerName('Cal Ripken, Jr.'), 'cal ripken');
    assert.strictEqual(normalizePlayerName("Shohei Ohtani"), 'shohei ohtani');
  });
});

describe('Player Matching', () => {
  it('matchPlayer finds HOF player', () => {
    const { matchPlayer } = require('../player-match');
    const result = matchPlayer(db, 'Hank Aaron');
    assert.ok(result);
    assert.strictEqual(result.tier, 'hof');
  });

  it('matchPlayer returns null for unknown player', () => {
    const { matchPlayer } = require('../player-match');
    const result = matchPlayer(db, 'Random Nobody');
    assert.strictEqual(result, null);
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — module not found

**Step 3: Create `server/player-match.js`**

```javascript
/**
 * Player name normalization and matching against player_metadata.
 */

/**
 * Normalize a player name for matching:
 * - Lowercase
 * - Strip periods and commas
 * - Remove suffix words (Jr, Sr, II, III, IV) using word boundaries
 * - Collapse whitespace
 */
function normalizePlayerName(name) {
  if (!name) return '';
  let n = name.toLowerCase().trim();
  n = n.replace(/[.,]/g, '');
  n = n.replace(/\b(jr|sr|ii|iii|iv)\b/gi, '');
  return n.replace(/\s+/g, ' ').trim();
}

/**
 * Look up a player name in player_metadata. Returns the row or null.
 */
function matchPlayer(db, rawName) {
  const normalized = normalizePlayerName(rawName);
  if (!normalized) return null;
  return db.prepare('SELECT * FROM player_metadata WHERE player_name = ?').get(normalized) || null;
}

/**
 * Batch-match an array of player names. Returns a Map<normalizedName, metadataRow>.
 */
function matchPlayers(db, rawNames) {
  const results = new Map();
  const seen = new Set();
  for (const name of rawNames) {
    const normalized = normalizePlayerName(name);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const row = db.prepare('SELECT * FROM player_metadata WHERE player_name = ?').get(normalized);
    if (row) results.set(normalized, row);
  }
  return results;
}

module.exports = { normalizePlayerName, matchPlayer, matchPlayers };
```

**Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/player-match.js server/tests/test-routes.js
git commit -m "feat: player name normalization and matching utility"
```

---

### Task 5: Enrich GET /api/sets/:id with Player Metadata

**Files:**
- Modify: `server/routes.js:76-110` (GET /api/sets/:id handler)
- Test: `server/tests/test-routes.js`

**Step 1: Write the failing test**

```javascript
it('GET /api/sets/:id includes player_tier and is_focus on cards', async () => {
  const set = (await api('POST', '/api/sets', { name: 'PlayerEnrich', year: 2025, sport: 'Baseball', brand: 'Topps' })).data;
  // Hank Aaron should exist from HOF seeding
  await api('POST', `/api/sets/${set.id}/cards`, { cards: [
    { card_number: '1', player: 'Hank Aaron', insert_type: 'Base', qty: 1 },
    { card_number: '2', player: 'Random Nobody', insert_type: 'Base', qty: 1 },
  ]});
  const { data } = await api('GET', `/api/sets/${set.id}`);
  const aaron = data.cards.find(c => c.card_number === '1');
  const nobody = data.cards.find(c => c.card_number === '2');
  assert.strictEqual(aaron.player_tier, 'hof');
  assert.strictEqual(nobody.player_tier, null);
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `aaron.player_tier` is undefined

**Step 3: Modify the GET /api/sets/:id handler**

In `server/routes.js`, after the `owned_parallels` attachment code (around line 101), add:

```javascript
    // Enrich cards with player metadata
    const { matchPlayers, normalizePlayerName } = require('./player-match');
    const playerNames = cards.map(c => c.player).filter(Boolean);
    const playerMap = matchPlayers(db, playerNames);
    for (const card of cards) {
      const normalized = normalizePlayerName(card.player);
      const meta = playerMap.get(normalized);
      card.player_tier = meta?.tier || null;
      card.is_focus_player = meta?.is_focus ? true : false;
      card.hof_year = meta?.hof_induction_year || null;
    }
```

**Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/routes.js server/tests/test-routes.js
git commit -m "feat: enrich cards with player tier and focus status"
```

---

### Task 6: Cross-Set Player Search API

**Files:**
- Modify: `server/routes.js`
- Test: `server/tests/test-routes.js`

**Step 1: Write the failing test**

```javascript
describe('Cross-Set Player Search', () => {
  it('GET /api/cards/by-player?name=... finds cards across sets', async () => {
    const set1 = (await api('POST', '/api/sets', { name: 'XSet1', year: 2024, sport: 'Baseball', brand: 'Topps' })).data;
    const set2 = (await api('POST', '/api/sets', { name: 'XSet2', year: 2025, sport: 'Baseball', brand: 'Topps' })).data;
    await api('POST', `/api/sets/${set1.id}/cards`, { cards: [{ card_number: '1', player: 'Hank Aaron', qty: 1 }] });
    await api('POST', `/api/sets/${set2.id}/cards`, { cards: [{ card_number: '50', player: 'Hank Aaron', qty: 2 }] });

    const { data } = await api('GET', '/api/cards/by-player?name=hank%20aaron');
    assert.ok(data.length >= 2);
    assert.ok(data.some(c => c.set_name === 'XSet1'));
    assert.ok(data.some(c => c.set_name === 'XSet2'));
  });

  it('GET /api/cards/focus-players returns all focus player cards', async () => {
    db.prepare("UPDATE player_metadata SET is_focus = 1 WHERE player_name = 'hank aaron'").run();
    const { data } = await api('GET', '/api/cards/focus-players');
    assert.ok(data.length >= 1);
    assert.ok(data.every(c => c.is_focus_player === true));
  });

  it('GET /api/cards/hof-rookies returns HOF cards with RC flag', async () => {
    const set = (await api('POST', '/api/sets', { name: 'RCTest', year: 2025, sport: 'Baseball', brand: 'Topps' })).data;
    await api('POST', `/api/sets/${set.id}/cards`, { cards: [
      { card_number: '1', player: 'Hank Aaron', rc_sp: 'RC', qty: 1 },
      { card_number: '2', player: 'Hank Aaron', qty: 1 },
    ]});
    const { data } = await api('GET', '/api/cards/hof-rookies');
    assert.ok(data.length >= 1);
    assert.ok(data.every(c => c.rc_sp && c.rc_sp.includes('RC')));
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — 404

**Step 3: Add the endpoints**

```javascript
  // GET /api/cards/by-player?name=... — find cards across all sets for a player
  router.get('/api/cards/by-player', (req, res) => {
    const { normalizePlayerName } = require('./player-match');
    const name = normalizePlayerName(req.query.name || '');
    if (!name) return res.json([]);
    const cards = db.prepare(`
      SELECT c.*, cs.name as set_name, cs.year as set_year
      FROM cards c JOIN card_sets cs ON cs.id = c.set_id
      WHERE LOWER(REPLACE(REPLACE(c.player, '.', ''), ',', '')) LIKE ?
      ORDER BY cs.year DESC, c.card_number
    `).all(`%${name}%`);
    const meta = db.prepare('SELECT * FROM player_metadata WHERE player_name = ?').get(name);
    for (const c of cards) {
      c.player_tier = meta?.tier || null;
      c.is_focus_player = meta?.is_focus ? true : false;
    }
    res.json(cards);
  });

  // GET /api/cards/focus-players — all cards for focus players
  router.get('/api/cards/focus-players', (req, res) => {
    const { normalizePlayerName } = require('./player-match');
    const focusPlayers = db.prepare("SELECT player_name FROM player_metadata WHERE is_focus = 1").all();
    if (focusPlayers.length === 0) return res.json([]);
    const allCards = [];
    for (const fp of focusPlayers) {
      const cards = db.prepare(`
        SELECT c.*, cs.name as set_name, cs.year as set_year
        FROM cards c JOIN card_sets cs ON cs.id = c.set_id
        WHERE LOWER(REPLACE(REPLACE(c.player, '.', ''), ',', '')) LIKE ?
        AND c.qty > 0
        ORDER BY cs.year DESC
      `).all(`%${fp.player_name}%`);
      for (const c of cards) { c.player_tier = 'focus'; c.is_focus_player = true; }
      allCards.push(...cards);
    }
    res.json(allCards);
  });

  // GET /api/cards/hof-rookies — HOF players with RC flag, owned
  router.get('/api/cards/hof-rookies', (req, res) => {
    const hofPlayers = db.prepare("SELECT player_name FROM player_metadata WHERE tier = 'hof'").all();
    const rookies = [];
    for (const hp of hofPlayers) {
      const cards = db.prepare(`
        SELECT c.*, cs.name as set_name, cs.year as set_year
        FROM cards c JOIN card_sets cs ON cs.id = c.set_id
        WHERE LOWER(REPLACE(REPLACE(c.player, '.', ''), ',', '')) LIKE ?
        AND c.rc_sp LIKE '%RC%' AND c.qty > 0
      `).all(`%${hp.player_name}%`);
      for (const c of cards) { c.player_tier = 'hof'; c.is_focus_player = false; }
      rookies.push(...cards);
    }
    res.json(rookies);
  });
```

**Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/routes.js server/tests/test-routes.js
git commit -m "feat: cross-set player search, focus players, HOF rookies endpoints"
```

---

### Task 7: TCDB Collection Page Parser

**Files:**
- Modify: `tcdb-scraper/parsers.py:363-399` (improve existing `parse_collection_cards`)
- Create: `tcdb-scraper/test_collection_parser.py`

**Step 1: Write the failing test**

Create `tcdb-scraper/test_collection_parser.py`:

```python
"""Tests for the TCDB collection page parser."""
import pytest
from parsers import parse_collection_page

# Sample HTML mimicking ViewCollectionMode.cfm row structure
SAMPLE_HTML = '''
<table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr class="collection_row" bgcolor="#D9EDF7">
  <td><button type="button" class="btn btn-primary"><span class="badge bg-light text-dark">2</span></button></td>
  <td nowrap width="4">&nbsp;</td>
  <td nowrap valign="top"><a href="/ViewCard.cfm/sid/404413/cid/23860904/2024-Topps-3-Endy-Rodriguez">3</a></td>
  <td nowrap width="2">&nbsp;</td>
  <td valign="top" class="w-100"><a href="/ViewCard.cfm/sid/404413/cid/23860904/2024-Topps-3-Endy-Rodriguez">Endy Rodríguez</a> RC</td>
  <td align="right"><a target="_blank" href="https://www.ebay.com/sch/..."><i class="fa-brands fa-ebay"></i></a></td>
</tr>
<tr><td colspan="6"><div id="hideDiv1" style="display:none"><div id="theDiv1"></div></div></td></tr>
<tr class="collection_row" bgcolor="#FFFFFF">
  <td><button type="button" class="btn btn-primary"><span class="badge bg-light text-dark">1</span></button></td>
  <td nowrap width="4">&nbsp;</td>
  <td nowrap valign="top"><a href="/ViewCard.cfm/sid/333/cid/114503/1994-Finest-100-Frank-Thomas">100</a></td>
  <td nowrap width="2">&nbsp;</td>
  <td valign="top" class="w-100"><a href="/ViewCard.cfm/sid/333/cid/114503/1994-Finest-100-Frank-Thomas">Frank Thomas</a></td>
  <td align="right"><a target="_blank" href="https://www.ebay.com/sch/..."><i class="fa-brands fa-ebay"></i></a></td>
</tr>
<tr><td colspan="6"><div id="hideDiv2" style="display:none"><div id="theDiv2"></div></div></td></tr>
</table>
<p><em>592 record(s)</em></p>
'''

def test_parse_collection_page_cards():
    result = parse_collection_page(SAMPLE_HTML)
    assert len(result["cards"]) == 2

    card1 = result["cards"][0]
    assert card1["card_number"] == "3"
    assert card1["player"] == "Endy Rodríguez"
    assert card1["qty"] == 2
    assert card1["rc_sp"] == "RC"
    assert card1["tcdb_set_id"] == 404413
    assert card1["tcdb_card_id"] == 23860904

    card2 = result["cards"][1]
    assert card2["card_number"] == "100"
    assert card2["player"] == "Frank Thomas"
    assert card2["qty"] == 1
    assert card2["rc_sp"] == ""
    assert card2["tcdb_set_id"] == 333

def test_parse_collection_page_total():
    result = parse_collection_page(SAMPLE_HTML)
    assert result["total_records"] == 592
```

**Step 2: Run test to verify it fails**

Run: `cd tcdb-scraper && python -m pytest test_collection_parser.py -v`
Expected: FAIL — `parse_collection_page` not found

**Step 3: Add `parse_collection_page` to parsers.py**

Add after the existing `parse_collection_cards` function:

```python
def parse_collection_page(html: str) -> dict:
    """Parse ViewCollectionMode.cfm — the flat collection page with all cards.

    Each card row has class 'collection_row' and contains:
    - Qty: <span class="badge bg-light text-dark">{qty}</span>
    - Card link: /ViewCard.cfm/sid/{setId}/cid/{cardId}/{slug}
    - Player name + suffix (RC, SP, etc.) in the 5th <td>

    Returns dict with 'cards' list and 'total_records' count.
    """
    soup = BeautifulSoup(html, "html.parser")
    cards: list[dict] = []

    _VIEWCARD_RE = re.compile(r"/ViewCard\.cfm/sid/(\d+)/cid/(\d+)")

    for tr in soup.find_all("tr", class_="collection_row"):
        tds = tr.find_all("td")
        if len(tds) < 5:
            continue

        # Qty from badge
        badge = tds[0].find("span", class_="badge")
        qty = int(badge.get_text(strip=True)) if badge else 1

        # Card number and IDs from ViewCard link
        card_link = tds[2].find("a", href=_VIEWCARD_RE)
        if not card_link:
            continue
        card_number = card_link.get_text(strip=True)
        href_match = _VIEWCARD_RE.search(card_link["href"])
        tcdb_set_id = int(href_match.group(1))
        tcdb_card_id = int(href_match.group(2))

        # Player name from 5th td's first <a>, suffix from remaining text
        player_td = tds[4]
        player_link = player_td.find("a")
        player = player_link.get_text(strip=True) if player_link else player_td.get_text(strip=True)

        # RC/SP suffix: text after the </a> tag
        rc_sp = ""
        if player_link and player_link.next_sibling:
            suffix_text = player_link.next_sibling
            if isinstance(suffix_text, str):
                rc_sp = suffix_text.strip()

        cards.append({
            "card_number": card_number,
            "player": player,
            "qty": qty,
            "rc_sp": rc_sp,
            "tcdb_set_id": tcdb_set_id,
            "tcdb_card_id": tcdb_card_id,
        })

    # Total records
    total_records = 0
    em = soup.find("em", string=re.compile(r"\d+\s+record"))
    if em:
        m = re.search(r"(\d[\d,]*)", em.get_text())
        if m:
            total_records = int(m.group(1).replace(",", ""))

    return {"cards": cards, "total_records": total_records}
```

**Step 4: Run test to verify it passes**

Run: `cd tcdb-scraper && python -m pytest test_collection_parser.py -v`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add tcdb-scraper/parsers.py tcdb-scraper/test_collection_parser.py
git commit -m "feat: parse TCDB collection page (ViewCollectionMode.cfm)"
```

---

### Task 8: Collection Scraper Script

**Files:**
- Create: `tcdb-scraper/collection_scraper.py`

**Step 1: Create the collection scraper**

```python
#!/usr/bin/env python3
"""
TCDB Collection Scraper — imports a user's full TCDB collection into CardVoice.

Usage:
    python collection_scraper.py --cookie "CFID=xxx;CFTOKEN=yyy" --member Jhanratty --json
    python collection_scraper.py --cookie "CFID=xxx;CFTOKEN=yyy" --member Jhanratty --json --output-dir /path/to/output
"""
import os
import sys
import re
import json
import time
import random
import logging
import argparse
from pathlib import Path
from collections import defaultdict

from http_client import TcdbClient
from parsers import parse_collection_page, parse_set_detail_page

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stderr)],
)
logger = logging.getLogger(__name__)

TCDB_BASE = "https://www.tcdb.com"
DEFAULT_OUTPUT_DIR = Path("output")


class CollectionCheckpoint:
    """Track which pages have been scraped for resumability."""

    def __init__(self, path: str):
        self._path = path
        self._data = {"completed_pages": [], "cards": [], "set_ids": {}}
        self._load()

    def _load(self):
        if os.path.exists(self._path):
            try:
                with open(self._path) as f:
                    self._data = json.load(f)
                logger.info(f"Resumed from checkpoint: {len(self._data['completed_pages'])} pages done, {len(self._data['cards'])} cards found")
            except Exception as e:
                logger.warning(f"Could not load checkpoint: {e}")

    def _save(self):
        with open(self._path, "w") as f:
            json.dump(self._data, f)

    def is_page_done(self, page: int) -> bool:
        return page in self._data["completed_pages"]

    def mark_page_done(self, page: int, cards: list):
        self._data["completed_pages"].append(page)
        self._data["cards"].extend(cards)
        self._save()

    def get_all_cards(self) -> list:
        return self._data["cards"]

    def set_set_info(self, tcdb_set_id: int, name: str, year: int):
        self._data["set_ids"][str(tcdb_set_id)] = {"name": name, "year": year}
        self._save()

    def get_set_info(self, tcdb_set_id: int) -> dict | None:
        return self._data["set_ids"].get(str(tcdb_set_id))

    def all_pages_done(self) -> list:
        return self._data["completed_pages"]


def scrape_collection(client: TcdbClient, member: str, checkpoint: CollectionCheckpoint,
                      max_pages: int = 200) -> list[dict]:
    """Scrape all pages of ViewCollectionMode.cfm. Returns list of card dicts."""

    # Discover total pages from first page
    first_url = (
        f"{TCDB_BASE}/ViewCollectionMode.cfm?"
        f"Filter=G&Member={member}&MODE=&Type=Baseball&CollectionID=1&Records=10000&PageIndex=1"
    )
    if not checkpoint.is_page_done(1):
        logger.info("Fetching page 1 to discover total records...")
        resp = client.get(first_url)
        result = parse_collection_page(resp.text)
        total = result["total_records"]
        logger.info(f"Total records: {total}")
        checkpoint.mark_page_done(1, result["cards"])
        logger.info(f"Page 1: {len(result['cards'])} cards (total so far: {len(checkpoint.get_all_cards())})")
    else:
        total = len(checkpoint.get_all_cards()) * 100 // max(len(checkpoint.all_pages_done()), 1)
        logger.info(f"Page 1 already done, estimating ~{total} total records")

    # Determine total pages (100 cards per page)
    pages_per_100 = (total + 99) // 100
    total_pages = min(pages_per_100, max_pages)
    logger.info(f"Will scrape {total_pages} pages")

    # Scrape remaining pages
    for page in range(2, total_pages + 1):
        if checkpoint.is_page_done(page):
            logger.info(f"Page {page}/{total_pages}: already done, skipping")
            continue

        delay = random.uniform(15, 20)
        logger.info(f"Waiting {delay:.0f}s before page {page}...")
        time.sleep(delay)

        url = (
            f"{TCDB_BASE}/ViewCollectionMode.cfm?"
            f"Filter=G&Member={member}&MODE=&Type=Baseball&CollectionID=1&Records=10000&PageIndex={page}"
        )
        try:
            resp = client.get(url)
            result = parse_collection_page(resp.text)
            checkpoint.mark_page_done(page, result["cards"])
            total_so_far = len(checkpoint.get_all_cards())
            logger.info(f"Page {page}/{total_pages}: {len(result['cards'])} cards (total: {total_so_far})")
        except Exception as e:
            logger.error(f"Page {page} failed: {e}")
            logger.info("Saved progress to checkpoint. Re-run to resume.")
            break

    return checkpoint.get_all_cards()


def resolve_set_names(client: TcdbClient, cards: list[dict],
                      checkpoint: CollectionCheckpoint) -> dict:
    """Look up canonical set names for each unique tcdb_set_id.
    Returns dict: {tcdb_set_id: {name, year}}.
    """
    unique_sids = {c["tcdb_set_id"] for c in cards}
    logger.info(f"Resolving canonical names for {len(unique_sids)} unique sets...")

    set_info = {}
    for i, sid in enumerate(sorted(unique_sids)):
        # Check checkpoint first
        cached = checkpoint.get_set_info(sid)
        if cached:
            set_info[sid] = cached
            continue

        delay = random.uniform(3, 5)
        time.sleep(delay)

        url = f"{TCDB_BASE}/ViewSet.cfm/sid/{sid}"
        try:
            resp = client.get(url)
            detail = parse_set_detail_page(resp.text)
            raw_title = detail.get("title", "")
            set_name = raw_title.split(" - Trading Card")[0].replace(" Baseball", "").strip()
            if not set_name:
                set_name = f"Set-{sid}"

            # Extract year from name
            year_match = re.match(r"(\d{4})\s+", set_name)
            year = int(year_match.group(1)) if year_match else 0

            info = {"name": set_name, "year": year}
            set_info[sid] = info
            checkpoint.set_set_info(sid, set_name, year)
            logger.info(f"  [{i+1}/{len(unique_sids)}] sid={sid} -> {set_name} ({year})")
        except Exception as e:
            logger.error(f"  Failed to resolve sid={sid}: {e}")
            set_info[sid] = {"name": f"Set-{sid}", "year": 0}

    return set_info


def group_by_set(cards: list[dict], set_info: dict) -> list[dict]:
    """Group cards by set and attach set metadata."""
    groups = defaultdict(list)
    for card in cards:
        groups[card["tcdb_set_id"]].append(card)

    result = []
    for sid, set_cards in groups.items():
        info = set_info.get(sid, {"name": f"Set-{sid}", "year": 0})
        result.append({
            "tcdb_set_id": sid,
            "set_name": info["name"],
            "year": info["year"],
            "card_count": len(set_cards),
            "cards": set_cards,
        })
    result.sort(key=lambda s: (-s["year"], s["set_name"]))
    return result


def main():
    parser = argparse.ArgumentParser(description="TCDB Collection Scraper")
    parser.add_argument("--cookie", required=True, help="TCDB session cookie string (CFID=xxx;CFTOKEN=yyy)")
    parser.add_argument("--member", required=True, help="TCDB member username")
    parser.add_argument("--json", action="store_true", help="Output JSON to stdout")
    parser.add_argument("--output-dir", type=str, default=None, help="Output directory")
    parser.add_argument("--max-pages", type=int, default=200, help="Max pages to scrape")
    args = parser.parse_args()

    output_dir = Path(args.output_dir) if args.output_dir else DEFAULT_OUTPUT_DIR
    output_dir.mkdir(parents=True, exist_ok=True)
    checkpoint_path = str(output_dir / "collection_checkpoint.json")

    # Create client with slower rate limiting for collection pages
    client = TcdbClient(min_delay=15.0, max_delay=20.0)

    # Set the session cookie
    for part in args.cookie.split(";"):
        part = part.strip()
        if "=" in part:
            key, val = part.split("=", 1)
            client.session.cookies.set(key.strip(), val.strip(), domain=".tcdb.com", path="/")

    # Verify authentication
    if not client.is_logged_in():
        logger.error("Session cookie is invalid or expired. Log into TCDB in your browser and copy fresh cookies.")
        sys.exit(1)
    logger.info("Session authenticated successfully")

    checkpoint = CollectionCheckpoint(checkpoint_path)

    # Phase 1: Scrape all collection pages
    cards = scrape_collection(client, args.member, checkpoint, max_pages=args.max_pages)
    logger.info(f"Phase 1 complete: {len(cards)} total cards")

    # Phase 2: Resolve canonical set names
    # Use faster rate limiting for set lookups
    client.set_speed(3.0, 5.0)
    set_info = resolve_set_names(client, cards, checkpoint)
    logger.info(f"Phase 2 complete: {len(set_info)} sets resolved")

    # Phase 3: Group by set
    grouped = group_by_set(cards, set_info)

    # Output
    summary = {
        "total_cards": len(cards),
        "total_sets": len(grouped),
        "sets": grouped,
    }

    if args.json:
        print(json.dumps(summary))
    else:
        logger.info(f"Done! {len(cards)} cards across {len(grouped)} sets")
        # Save to file
        output_path = output_dir / "collection-import.json"
        with open(output_path, "w") as f:
            json.dump(summary, f, indent=2)
        logger.info(f"Saved to {output_path}")


if __name__ == "__main__":
    main()
```

**Step 2: Verify syntax**

Run: `cd tcdb-scraper && python -c "import collection_scraper; print('OK')"`
Expected: OK

**Step 3: Commit**

```bash
git add tcdb-scraper/collection_scraper.py
git commit -m "feat: TCDB collection scraper with checkpoint resumability"
```

---

### Task 9: Collection Import Service (Node.js Integration)

**Files:**
- Modify: `server/tcdb-service.js` (add `importCollection` method)
- Modify: `server/routes.js` (add collection import endpoints)
- Test: `server/tests/test-routes.js`

**Step 1: Write the failing test**

```javascript
describe('TCDB Collection Import API', () => {
  it('POST /api/admin/tcdb/collection/import returns 400 without cookie', async () => {
    const { status } = await api('POST', '/api/admin/tcdb/collection/import', { member: 'test' });
    assert.strictEqual(status, 400);
  });

  it('PUT /api/settings/tcdb-cookie saves cookie', async () => {
    const { status } = await api('PUT', '/api/settings/tcdb-cookie', { cookie: 'CFID=123;CFTOKEN=abc' });
    assert.strictEqual(status, 200);
    const row = db.prepare("SELECT value FROM app_meta WHERE key = 'tcdb_session_cookie'").get();
    assert.ok(row.value.includes('CFID=123'));
  });

  it('GET /api/settings/tcdb-cookie returns masked cookie', async () => {
    db.prepare("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('tcdb_session_cookie', 'CFID=123456;CFTOKEN=abcdef')").run();
    const { data } = await api('GET', '/api/settings/tcdb-cookie');
    assert.ok(data.cookie);
    assert.ok(data.cookie.includes('***')); // masked
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — 404

**Step 3: Add importCollection to TcdbService**

In `server/tcdb-service.js`, add after `importSet`:

```javascript
  /**
   * Import a user's entire TCDB collection.
   * Spawns collection_scraper.py with the session cookie.
   */
  async importCollection(cookie, member) {
    this._log = [];
    this._status = {
      running: true,
      phase: 'collection-import',
      progress: { current: 0, total: 3, currentItem: 'Scraping collection pages...' },
      result: null,
      error: null,
      startedAt: Date.now(),
    };

    try {
      // Step 1: Run collection scraper
      const scriptPath = path.join(this.scraperDir, 'collection_scraper.py');
      const args = [
        scriptPath, '--cookie', cookie, '--member', member,
        '--json', '--output-dir', this.outputDir,
      ];
      const scrapeResult = await this._runScraperRaw(args);

      // Step 2: Import into CardVoice DB
      this._status.phase = 'importing';
      this._status.progress = { current: 1, total: 3, currentItem: 'Importing cards into CardVoice...' };

      const importResult = this._importCollectionData(scrapeResult);

      // Step 3: Done
      this._status = {
        running: false,
        phase: 'done',
        progress: { current: 3, total: 3, currentItem: 'Complete' },
        result: { scrape: scrapeResult, import: importResult },
        error: null,
        startedAt: this._status.startedAt,
      };

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
   * Import scraped collection data into the user's DB.
   */
  _importCollectionData(scrapeResult) {
    if (!this.db || !scrapeResult?.sets) return { skipped: true };
    const { normalizePlayerName } = require('./player-match');

    const findSetByTcdbId = this.db.prepare('SELECT id FROM card_sets WHERE tcdb_set_id = ?');
    const findSetByNameYear = this.db.prepare('SELECT id FROM card_sets WHERE name = ? AND year = ?');
    const createSet = this.db.prepare('INSERT INTO card_sets (name, year, brand, sport, tcdb_set_id) VALUES (?, ?, ?, ?, ?)');
    const findCard = this.db.prepare('SELECT id, qty FROM cards WHERE set_id = ? AND card_number = ? AND insert_type = ? AND parallel = ?');
    const insertCard = this.db.prepare('INSERT INTO cards (set_id, card_number, player, team, rc_sp, insert_type, parallel, qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const updateCardQty = this.db.prepare('UPDATE cards SET qty = ?, player = CASE WHEN player = ? THEN ? ELSE player END WHERE id = ?');
    const upsertInsertType = this.db.prepare(`INSERT INTO set_insert_types (set_id, name) VALUES (?, ?) ON CONFLICT(set_id, name) DO NOTHING`);
    const upsertParallel = this.db.prepare(`INSERT INTO set_parallels (set_id, name) VALUES (?, ?) ON CONFLICT(set_id, name) DO NOTHING`);
    const findParallel = this.db.prepare('SELECT id FROM set_parallels WHERE set_id = ? AND name = ?');
    const findInsertType = this.db.prepare('SELECT id FROM set_insert_types WHERE set_id = ? AND name = ?');
    const upsertJunction = this.db.prepare('INSERT OR IGNORE INTO insert_type_parallels (insert_type_id, parallel_id) VALUES (?, ?)');
    const upsertCardParallel = this.db.prepare(`INSERT INTO card_parallels (card_id, parallel_id, qty) VALUES (?, ?, ?) ON CONFLICT(card_id, parallel_id) DO UPDATE SET qty = excluded.qty`);

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
          const insertType = 'Base'; // Collection page cards are base
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
```

**Step 4: Add API endpoints**

In `server/routes.js`, add:

```javascript
  // --- TCDB Cookie Settings ---

  router.put('/api/settings/tcdb-cookie', (req, res) => {
    const { cookie } = req.body;
    if (!cookie) return res.status(400).json({ error: 'cookie required' });
    const { setMeta } = require('./db');
    setMeta(db, 'tcdb_session_cookie', cookie);
    res.json({ ok: true });
  });

  router.get('/api/settings/tcdb-cookie', (req, res) => {
    const { getMeta } = require('./db');
    const cookie = getMeta(db, 'tcdb_session_cookie') || '';
    // Mask cookie values for display
    const masked = cookie.replace(/=([^;]+)/g, (m, val) => '=' + val.slice(0, 3) + '***');
    res.json({ cookie: masked, hasValue: !!cookie });
  });

  // --- TCDB Collection Import ---

  router.post('/api/admin/tcdb/collection/import', async (req, res) => {
    const { member } = req.body;
    const { getMeta } = require('./db');
    const cookie = getMeta(db, 'tcdb_session_cookie');
    if (!cookie) return res.status(400).json({ error: 'TCDB cookie not set. Go to Settings > TCDB to add your session cookie.' });
    if (!member) return res.status(400).json({ error: 'TCDB member username required' });
    if (!req.app.locals.tcdbService) return res.status(500).json({ error: 'TCDB service not available' });
    try {
      const result = await req.app.locals.tcdbService.importCollection(cookie, member);
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

**Step 5: Run tests**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add server/tcdb-service.js server/routes.js server/tests/test-routes.js
git commit -m "feat: TCDB collection import service and API endpoints"
```

---

### Task 10: Checklist Backfill Service

**Files:**
- Modify: `server/tcdb-service.js` (add `backfillChecklists` method)
- Modify: `server/routes.js` (add backfill endpoint)

**Step 1: Add backfillChecklists to TcdbService**

```javascript
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
```

**Step 2: Add API endpoint**

```javascript
  // POST /api/admin/tcdb/backfill — start checklist backfill for all imported sets
  router.post('/api/admin/tcdb/backfill', async (req, res) => {
    if (!req.app.locals.tcdbService) return res.status(500).json({ error: 'TCDB service not available' });
    try {
      // Run in background
      req.app.locals.tcdbService.backfillChecklists().catch(err => {
        console.error('[Backfill] Error:', err.message);
      });
      res.json({ started: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
```

**Step 3: Commit**

```bash
git add server/tcdb-service.js server/routes.js
git commit -m "feat: checklist backfill service for imported collection sets"
```

---

### Task 11: Admin UI — TCDB Cookie Settings + Collection Import

**Files:**
- Modify: `frontend/src/pages/AdminPage.jsx`

**Step 1: Add TCDB Cookie settings section**

At the top of AdminPage (before the TCDB Browse section), add a cookie settings panel:

```jsx
{/* TCDB Session Cookie */}
<div className="bg-cv-panel rounded-xl border border-cv-border p-4 mb-4">
  <h3 className="text-sm font-semibold text-cv-text mb-3">TCDB Authentication</h3>
  <p className="text-xs text-cv-muted mb-3">
    Log into tcdb.com in your browser, then copy your session cookie and paste it here.
    This allows CardVoice to import your collection.
  </p>
  <div className="flex gap-2">
    <input type="text" value={tcdbCookie} onChange={e => setTcdbCookie(e.target.value)}
      placeholder="CFID=123456;CFTOKEN=abcdef..."
      className="flex-1 bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text font-mono focus:border-cv-accent focus:outline-none" />
    <button onClick={saveTcdbCookie}
      className="px-4 py-2 rounded-lg text-sm bg-cv-accent text-white font-medium">Save</button>
  </div>
  {tcdbCookieStatus && <p className="text-xs text-cv-accent mt-2">{tcdbCookieStatus}</p>}
</div>
```

**Step 2: Add Collection Import section**

```jsx
{/* Collection Import */}
<div className="bg-cv-panel rounded-xl border border-cv-border p-4 mb-4">
  <h3 className="text-sm font-semibold text-cv-text mb-3">Import TCDB Collection</h3>
  <div className="flex gap-2 items-end">
    <div className="flex-1">
      <label className="text-xs text-cv-muted block mb-1">TCDB Username</label>
      <input type="text" value={tcdbMember} onChange={e => setTcdbMember(e.target.value)}
        placeholder="Jhanratty"
        className="w-full bg-cv-dark border border-cv-border rounded-lg px-3 py-2 text-sm text-cv-text focus:border-cv-accent focus:outline-none" />
    </div>
    <button onClick={startCollectionImport} disabled={!tcdbMember || collectionImporting}
      className="px-4 py-2 rounded-lg text-sm bg-gradient-to-r from-cv-accent to-cv-accent2 text-white font-medium disabled:opacity-50">
      {collectionImporting ? 'Importing...' : 'Import My Collection'}
    </button>
  </div>
  {collectionImporting && (
    <div className="mt-3 bg-cv-dark rounded-lg p-3 border border-cv-border">
      <div className="text-xs text-cv-muted mb-1">{collectionStatus}</div>
      <div className="flex gap-2 mt-2">
        <button onClick={cancelImport} className="text-xs text-cv-red">Cancel</button>
      </div>
    </div>
  )}
  {collectionResult && (
    <div className="mt-3 bg-cv-accent/10 border border-cv-accent/30 rounded-lg p-3">
      <div className="text-sm text-cv-accent font-semibold">Import Complete!</div>
      <div className="text-xs text-cv-muted mt-1">
        {collectionResult.sets_created} sets created, {collectionResult.cards_added} cards added
      </div>
    </div>
  )}
</div>
```

**Step 3: Add state and handlers**

```jsx
const [tcdbCookie, setTcdbCookie] = useState('');
const [tcdbCookieStatus, setTcdbCookieStatus] = useState('');
const [tcdbMember, setTcdbMember] = useState('');
const [collectionImporting, setCollectionImporting] = useState(false);
const [collectionStatus, setCollectionStatus] = useState('');
const [collectionResult, setCollectionResult] = useState(null);

const saveTcdbCookie = async () => {
  try {
    await axios.put(`${API}/api/settings/tcdb-cookie`, { cookie: tcdbCookie });
    setTcdbCookieStatus('Cookie saved!');
    setTcdbCookie('');
    setTimeout(() => setTcdbCookieStatus(''), 3000);
  } catch (err) { setTcdbCookieStatus('Failed to save'); }
};

const startCollectionImport = async () => {
  setCollectionImporting(true);
  setCollectionStatus('Starting collection import...');
  setCollectionResult(null);
  try {
    const res = await axios.post(`${API}/api/admin/tcdb/collection/import`, { member: tcdbMember });
    setCollectionResult(res.data?.import || res.data);
    setCollectionStatus('Done!');
  } catch (err) {
    setCollectionStatus(`Error: ${err.response?.data?.error || err.message}`);
  } finally {
    setCollectionImporting(false);
  }
};
```

**Step 4: Verify frontend builds**

Run: `cd frontend && npx vite build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add frontend/src/pages/AdminPage.jsx
git commit -m "feat: admin UI for TCDB cookie settings and collection import"
```

---

### Task 12: SetDetail UI — Player Badges + Focus Star

**Files:**
- Modify: `frontend/src/pages/SetDetail.jsx:881` (player name cell in card rows)

**Step 1: Add player tier badge to card rows**

In SetDetail.jsx, find the player name cell (around line 881):

```jsx
<td className="px-3 py-2 text-cv-text">{card.player || '-'}</td>
```

Replace with:

```jsx
<td className={`px-3 py-2 ${card.is_focus_player ? 'bg-cv-gold/5' : ''}`}>
  <div className="flex items-center gap-1.5">
    <span className="text-cv-text">{card.player || '-'}</span>
    {card.player_tier === 'hof' && (
      <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-cv-gold/20 text-cv-gold border border-cv-gold/30">HOF</span>
    )}
    {card.player_tier === 'future_hof' && (
      <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-gray-400/20 text-gray-300 border border-gray-400/30">F-HOF</span>
    )}
    {card.player_tier === 'key_rookie' && (
      <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-green-500/20 text-green-400 border border-green-500/30">KEY RC</span>
    )}
    {card.player_tier === 'star' && (
      <span className="px-1 py-0.5 rounded text-[9px] font-bold bg-blue-500/20 text-blue-400 border border-blue-500/30">STAR</span>
    )}
    {card.player && (
      <button
        onClick={() => toggleFocusPlayer(card.player)}
        className={`opacity-0 group-hover:opacity-100 transition-opacity ${card.is_focus_player ? 'text-cv-gold' : 'text-cv-muted/40 hover:text-cv-gold'}`}
        title={card.is_focus_player ? 'Remove from focus players' : 'Add to focus players'}
      >
        ★
      </button>
    )}
  </div>
</td>
```

**Step 2: Add the focus toggle handler**

```jsx
const toggleFocusPlayer = async (playerName) => {
  const { normalizePlayerName } = await import('../utils/playerMatch.js');
  // We don't need to import a module — just call the API
  const normalized = playerName.toLowerCase().replace(/[.,]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/gi, '').replace(/\s+/g, ' ').trim();
  const card = cards.find(c => c.player === playerName);
  const newFocus = !card?.is_focus_player;
  try {
    await axios.put(`${API}/api/player-metadata/${encodeURIComponent(normalized)}/focus`, { is_focus: newFocus ? 1 : 0 });
    // Refresh cards
    const res = await axios.get(`${API}/api/sets/${setId}`);
    setCards(res.data.cards || []);
  } catch (err) {
    console.error('Failed to toggle focus:', err);
  }
};
```

**Step 3: Add `group-hover` to table rows**

Make sure the `<tr>` for card rows has `className="group ..."` so the star shows on hover.

**Step 4: Verify frontend builds**

Run: `cd frontend && npx vite build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add frontend/src/pages/SetDetail.jsx
git commit -m "feat: player tier badges and focus star in SetDetail"
```

---

### Task 13: Version Bump + Final Tests

**Files:**
- Modify: `package.json`, `electron/package.json`

**Step 1: Run all tests**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

Run: `cd tcdb-scraper && python -m pytest test_collection_parser.py test_db_helper.py -v`
Expected: ALL PASS

Run: `cd frontend && npx vite build`
Expected: Build succeeds

**Step 2: Bump version**

Update both `package.json` and `electron/package.json` version to `1.7.0`.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: TCDB collection import + player metadata system (v1.7.0)"
```

---

## Task Dependencies

```
Task 1 (schema) ──── Task 2 (HOF seed) ──── Task 3 (API)
                                              │
Task 4 (name matching) ──────────────────── Task 5 (enrich GET sets/:id)
                                              │
                                            Task 6 (cross-set search)
                                              │
Task 7 (parser) ──── Task 8 (scraper) ──── Task 9 (import service)
                                              │
                                            Task 10 (backfill)
                                              │
Task 11 (admin UI) depends on Task 9
Task 12 (badges UI) depends on Task 5
Task 13 (final) depends on ALL
```

Tasks 1-6 (server/API) can be done before Tasks 7-10 (scraper). Task 11-12 (UI) can be done in parallel after their dependencies.
