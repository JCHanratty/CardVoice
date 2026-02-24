# Insert-Parallel Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Link parallels to specific insert types so users see only valid parallels per insert, and track owned parallels via a separate `card_parallels` table with a spreadsheet-style rainbow tracker UI.

**Architecture:** Add two new tables (`insert_type_parallels` junction, `card_parallels` owned tracker). Scraper groups TCDB sub-sets by insert prefix to build the mapping. Catalog-merge propagates the junction data. Frontend shows one card row per player per insert with parallel qty columns.

**Tech Stack:** SQLite (better-sqlite3), Node.js test runner, React/Tailwind, Python 3 (scraper)

---

### Task 1: Add `insert_type_parallels` Junction Table

**Files:**
- Modify: `server/db.js:175-241` (migrations array)
- Test: `server/tests/test-routes.js`

**Step 1: Write the failing test**

Add to `server/tests/test-routes.js` in a new test suite:

```javascript
describe('Insert-Parallel Junction', () => {
  it('can link a parallel to an insert type', async () => {
    const set = (await api('POST', '/api/sets', { name: 'Test', year: 2025, sport: 'Baseball', brand: 'Topps' })).data;
    // Create insert type and parallel via import-checklist or direct DB
    const db = getDb();
    const itId = db.prepare('INSERT INTO set_insert_types (set_id, name) VALUES (?, ?)').run(set.id, 'Chrome').lastInsertRowid;
    const pId = db.prepare('INSERT INTO set_parallels (set_id, name) VALUES (?, ?)').run(set.id, 'Gold Refractor').lastInsertRowid;
    // Link them
    db.prepare('INSERT INTO insert_type_parallels (insert_type_id, parallel_id) VALUES (?, ?)').run(itId, pId);
    // Verify
    const row = db.prepare('SELECT * FROM insert_type_parallels WHERE insert_type_id = ? AND parallel_id = ?').get(itId, pId);
    assert.ok(row);
  });

  it('cascade deletes when insert type is deleted', async () => {
    const set = (await api('POST', '/api/sets', { name: 'Test2', year: 2025, sport: 'Baseball', brand: 'Topps' })).data;
    const db = getDb();
    const itId = db.prepare('INSERT INTO set_insert_types (set_id, name) VALUES (?, ?)').run(set.id, 'Anime').lastInsertRowid;
    const pId = db.prepare('INSERT INTO set_parallels (set_id, name) VALUES (?, ?)').run(set.id, 'Red Foil').lastInsertRowid;
    db.prepare('INSERT INTO insert_type_parallels (insert_type_id, parallel_id) VALUES (?, ?)').run(itId, pId);
    // Delete insert type
    db.prepare('DELETE FROM set_insert_types WHERE id = ?').run(itId);
    const row = db.prepare('SELECT * FROM insert_type_parallels WHERE insert_type_id = ?').get(itId);
    assert.strictEqual(row, undefined);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && node --test tests/test-routes.js`
Expected: FAIL — `no such table: insert_type_parallels`

**Step 3: Write the migration**

In `server/db.js`, add to the migrations array (after line 241):

```javascript
'CREATE TABLE IF NOT EXISTS insert_type_parallels (id INTEGER PRIMARY KEY AUTOINCREMENT, insert_type_id INTEGER NOT NULL REFERENCES set_insert_types(id) ON DELETE CASCADE, parallel_id INTEGER NOT NULL REFERENCES set_parallels(id) ON DELETE CASCADE, UNIQUE(insert_type_id, parallel_id))',
```

**Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/db.js server/tests/test-routes.js
git commit -m "feat: add insert_type_parallels junction table"
```

---

### Task 2: Add `card_parallels` Table

**Files:**
- Modify: `server/db.js:175-241` (migrations array)
- Test: `server/tests/test-routes.js`

**Step 1: Write the failing test**

```javascript
describe('Card Parallels', () => {
  it('can track owned parallel for a card', async () => {
    const set = (await api('POST', '/api/sets', { name: 'CPTest', year: 2025, sport: 'Baseball', brand: 'Topps' })).data;
    const db = getDb();
    const cardId = db.prepare('INSERT INTO cards (set_id, card_number, player, insert_type) VALUES (?, ?, ?, ?)').run(set.id, '1', 'Ohtani', 'Chrome').lastInsertRowid;
    const pId = db.prepare('INSERT INTO set_parallels (set_id, name) VALUES (?, ?)').run(set.id, 'Gold Refractor').lastInsertRowid;
    db.prepare('INSERT INTO card_parallels (card_id, parallel_id, qty) VALUES (?, ?, ?)').run(cardId, pId, 1);
    const row = db.prepare('SELECT * FROM card_parallels WHERE card_id = ? AND parallel_id = ?').get(cardId, pId);
    assert.strictEqual(row.qty, 1);
  });

  it('cascade deletes when card is deleted', async () => {
    const set = (await api('POST', '/api/sets', { name: 'CPTest2', year: 2025, sport: 'Baseball', brand: 'Topps' })).data;
    const db = getDb();
    const cardId = db.prepare('INSERT INTO cards (set_id, card_number, player, insert_type) VALUES (?, ?, ?, ?)').run(set.id, '1', 'Ohtani', 'Chrome').lastInsertRowid;
    const pId = db.prepare('INSERT INTO set_parallels (set_id, name) VALUES (?, ?)').run(set.id, 'Gold').lastInsertRowid;
    db.prepare('INSERT INTO card_parallels (card_id, parallel_id, qty) VALUES (?, ?, ?)').run(cardId, pId, 2);
    db.prepare('DELETE FROM cards WHERE id = ?').run(cardId);
    const row = db.prepare('SELECT * FROM card_parallels WHERE card_id = ?').get(cardId);
    assert.strictEqual(row, undefined);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd server && node --test tests/test-routes.js`
Expected: FAIL — `no such table: card_parallels`

**Step 3: Write the migration**

In `server/db.js`, add to the migrations array:

```javascript
'CREATE TABLE IF NOT EXISTS card_parallels (id INTEGER PRIMARY KEY AUTOINCREMENT, card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE, parallel_id INTEGER NOT NULL REFERENCES set_parallels(id) ON DELETE CASCADE, qty INTEGER DEFAULT 1, UNIQUE(card_id, parallel_id))',
```

**Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/db.js server/tests/test-routes.js
git commit -m "feat: add card_parallels table for owned parallel tracking"
```

---

### Task 3: Update Metadata API to Nest Parallels Under Insert Types

**Files:**
- Modify: `server/routes.js:627-658` (GET /api/sets/:id/metadata)
- Test: `server/tests/test-routes.js`

**Step 1: Write the failing test**

```javascript
describe('Nested Metadata', () => {
  it('returns parallels nested under insert types', async () => {
    const set = (await api('POST', '/api/sets', { name: 'NestTest', year: 2025, sport: 'Baseball', brand: 'Topps' })).data;
    const db = getDb();
    const itId = db.prepare('INSERT INTO set_insert_types (set_id, name) VALUES (?, ?)').run(set.id, 'Chrome').lastInsertRowid;
    const p1Id = db.prepare('INSERT INTO set_parallels (set_id, name) VALUES (?, ?)').run(set.id, 'Gold Refractor').lastInsertRowid;
    const p2Id = db.prepare('INSERT INTO set_parallels (set_id, name) VALUES (?, ?)').run(set.id, 'Black Refractor').lastInsertRowid;
    db.prepare('INSERT INTO insert_type_parallels (insert_type_id, parallel_id) VALUES (?, ?)').run(itId, p1Id);
    db.prepare('INSERT INTO insert_type_parallels (insert_type_id, parallel_id) VALUES (?, ?)').run(itId, p2Id);

    const { data } = await api('GET', `/api/sets/${set.id}/metadata`);
    const chrome = data.insertTypes.find(t => t.name === 'Chrome');
    assert.ok(chrome);
    assert.ok(chrome.parallels);
    assert.strictEqual(chrome.parallels.length, 2);
    assert.ok(chrome.parallels.find(p => p.name === 'Gold Refractor'));
    assert.ok(chrome.parallels.find(p => p.name === 'Black Refractor'));
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `chrome.parallels` is undefined (not in current response)

**Step 3: Modify the metadata endpoint**

In `server/routes.js`, update the GET /api/sets/:id/metadata handler (lines 627-658).

After fetching insertTypes and parallels, add a query to fetch the junction data and nest parallels under their insert types:

```javascript
// After existing insertTypes and parallels queries:
const junctionRows = db.prepare(`
  SELECT itp.insert_type_id, itp.parallel_id, sp.name, sp.print_run, sp.exclusive, sp.notes, sp.serial_max, sp.channels, sp.variation_type
  FROM insert_type_parallels itp
  JOIN set_parallels sp ON sp.id = itp.parallel_id
  WHERE sp.set_id = ?
`).all(setId);

// Group by insert_type_id
const parallelsByInsertType = {};
for (const row of junctionRows) {
  if (!parallelsByInsertType[row.insert_type_id]) parallelsByInsertType[row.insert_type_id] = [];
  parallelsByInsertType[row.insert_type_id].push({
    id: row.parallel_id, name: row.name, print_run: row.print_run,
    exclusive: row.exclusive, notes: row.notes, serial_max: row.serial_max,
    channels: row.channels, variation_type: row.variation_type,
  });
}

// Attach to each insert type
for (const it of insertTypes) {
  it.parallels = parallelsByInsertType[it.id] || [];
}
```

Keep the flat `parallels` array in the response for backward compat (voice entry free-text fallback).

**Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/routes.js server/tests/test-routes.js
git commit -m "feat: nest parallels under insert types in metadata API"
```

---

### Task 4: Add Card Parallels API Endpoint

**Files:**
- Modify: `server/routes.js` (new endpoint)
- Test: `server/tests/test-routes.js`

**Step 1: Write the failing test**

```javascript
describe('Card Parallels API', () => {
  it('can set parallel qty for a card', async () => {
    const set = (await api('POST', '/api/sets', { name: 'ParAPI', year: 2025, sport: 'Baseball', brand: 'Topps' })).data;
    const db = getDb();
    const itId = db.prepare('INSERT INTO set_insert_types (set_id, name) VALUES (?, ?)').run(set.id, 'Base').lastInsertRowid;
    const pId = db.prepare('INSERT INTO set_parallels (set_id, name) VALUES (?, ?)').run(set.id, 'Gold').lastInsertRowid;
    db.prepare('INSERT INTO insert_type_parallels (insert_type_id, parallel_id) VALUES (?, ?)').run(itId, pId);
    const { data: addResult } = await api('POST', `/api/sets/${set.id}/cards`, { cards: [{ card_number: '1', player: 'Ohtani', insert_type: 'Base' }] });
    const cardId = addResult.created[0].id;

    // Set parallel qty
    const { status, data } = await api('PUT', `/api/cards/${cardId}/parallels`, { parallel_id: pId, qty: 2 });
    assert.strictEqual(status, 200);

    // Verify
    const row = db.prepare('SELECT qty FROM card_parallels WHERE card_id = ? AND parallel_id = ?').get(cardId, pId);
    assert.strictEqual(row.qty, 2);
  });

  it('removes parallel when qty set to 0', async () => {
    const set = (await api('POST', '/api/sets', { name: 'ParAPI2', year: 2025, sport: 'Baseball', brand: 'Topps' })).data;
    const db = getDb();
    const pId = db.prepare('INSERT INTO set_parallels (set_id, name) VALUES (?, ?)').run(set.id, 'Blue').lastInsertRowid;
    const cardId = db.prepare('INSERT INTO cards (set_id, card_number, player) VALUES (?, ?, ?)').run(set.id, '1', 'Judge').lastInsertRowid;
    db.prepare('INSERT INTO card_parallels (card_id, parallel_id, qty) VALUES (?, ?, ?)').run(cardId, pId, 1);

    await api('PUT', `/api/cards/${cardId}/parallels`, { parallel_id: pId, qty: 0 });
    const row = db.prepare('SELECT * FROM card_parallels WHERE card_id = ? AND parallel_id = ?').get(cardId, pId);
    assert.strictEqual(row, undefined);
  });
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — 404 (endpoint doesn't exist)

**Step 3: Add the endpoint**

In `server/routes.js`, add after the existing card endpoints:

```javascript
// PUT /api/cards/:cardId/parallels — set/update/remove a parallel qty
router.put('/api/cards/:cardId/parallels', (req, res) => {
  const { cardId } = req.params;
  const { parallel_id, qty } = req.body;
  if (!parallel_id) return res.status(400).json({ error: 'parallel_id required' });

  const card = db.prepare('SELECT id FROM cards WHERE id = ?').get(cardId);
  if (!card) return res.status(404).json({ error: 'Card not found' });

  if (qty <= 0) {
    db.prepare('DELETE FROM card_parallels WHERE card_id = ? AND parallel_id = ?').run(cardId, parallel_id);
  } else {
    db.prepare(`
      INSERT INTO card_parallels (card_id, parallel_id, qty) VALUES (?, ?, ?)
      ON CONFLICT(card_id, parallel_id) DO UPDATE SET qty = excluded.qty
    `).run(cardId, parallel_id, qty);
  }

  res.json({ ok: true });
});
```

**Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/routes.js server/tests/test-routes.js
git commit -m "feat: add PUT /api/cards/:cardId/parallels endpoint"
```

---

### Task 5: Include Card Parallels in GET /api/sets/:id Response

**Files:**
- Modify: `server/routes.js:76-94` (GET /api/sets/:id)
- Test: `server/tests/test-routes.js`

**Step 1: Write the failing test**

```javascript
it('GET /api/sets/:id includes card_parallels', async () => {
  const set = (await api('POST', '/api/sets', { name: 'GetCP', year: 2025, sport: 'Baseball', brand: 'Topps' })).data;
  const db = getDb();
  const cardId = db.prepare('INSERT INTO cards (set_id, card_number, player) VALUES (?, ?, ?)').run(set.id, '1', 'Ohtani').lastInsertRowid;
  const pId = db.prepare('INSERT INTO set_parallels (set_id, name) VALUES (?, ?)').run(set.id, 'Gold').lastInsertRowid;
  db.prepare('INSERT INTO card_parallels (card_id, parallel_id, qty) VALUES (?, ?, ?)').run(cardId, pId, 3);

  const { data } = await api('GET', `/api/sets/${set.id}`);
  const card = data.cards.find(c => c.card_number === '1');
  assert.ok(card.owned_parallels);
  assert.strictEqual(card.owned_parallels.length, 1);
  assert.strictEqual(card.owned_parallels[0].name, 'Gold');
  assert.strictEqual(card.owned_parallels[0].qty, 3);
});
```

**Step 2: Run test to verify it fails**

Expected: FAIL — `card.owned_parallels` is undefined

**Step 3: Add card_parallels to the GET response**

In `server/routes.js` GET /api/sets/:id handler, after fetching cards, query card_parallels for the set:

```javascript
// After fetching cards array:
const cardParallelsRows = db.prepare(`
  SELECT cp.card_id, cp.qty, sp.id as parallel_id, sp.name
  FROM card_parallels cp
  JOIN set_parallels sp ON sp.id = cp.parallel_id
  WHERE cp.card_id IN (SELECT id FROM cards WHERE set_id = ?)
`).all(setId);

// Group by card_id
const parallelsByCard = {};
for (const row of cardParallelsRows) {
  if (!parallelsByCard[row.card_id]) parallelsByCard[row.card_id] = [];
  parallelsByCard[row.card_id].push({ parallel_id: row.parallel_id, name: row.name, qty: row.qty });
}

// Attach to each card
for (const card of cards) {
  card.owned_parallels = parallelsByCard[card.id] || [];
}
```

**Step 4: Run test to verify it passes**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add server/routes.js server/tests/test-routes.js
git commit -m "feat: include owned_parallels in GET /api/sets/:id response"
```

---

### Task 6: Update Python Scraper — Catalog DB Schema + Insert-Parallel Mapping

**Files:**
- Modify: `tcdb-scraper/db_helper.py:16-97` (create_catalog_db), `tcdb-scraper/db_helper.py:136-173` (upserts)
- Modify: `tcdb-scraper/scraper.py:244-263` (Pass 1 registration)
- Test: `tcdb-scraper/test_db_helper.py`

**Step 1: Add `insert_type_parallels` table to catalog DB schema**

In `tcdb-scraper/db_helper.py`, inside `create_catalog_db()`, after the `set_parallels` table creation (line 88), add:

```python
        CREATE TABLE IF NOT EXISTS insert_type_parallels (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            insert_type_id  INTEGER NOT NULL REFERENCES set_insert_types(id) ON DELETE CASCADE,
            parallel_id     INTEGER NOT NULL REFERENCES set_parallels(id) ON DELETE CASCADE,
            UNIQUE(insert_type_id, parallel_id)
        );
```

**Step 2: Add `link_parallel_to_insert()` helper function**

In `db_helper.py`, after `upsert_parallel()`:

```python
def link_parallel_to_insert(conn: sqlite3.Connection, *, insert_type_id: int, parallel_id: int):
    """Link a parallel to an insert type (idempotent)."""
    conn.execute(
        """INSERT OR IGNORE INTO insert_type_parallels (insert_type_id, parallel_id)
           VALUES (?, ?)""",
        (insert_type_id, parallel_id),
    )
    conn.commit()
```

**Step 3: Update `upsert_insert_type` and `upsert_parallel` to return IDs**

Both functions currently don't return the row ID. Modify them to return the ID:

```python
def upsert_insert_type(conn, *, set_id, name, card_count=0, odds="", section_type="base"):
    conn.execute(...)
    conn.commit()
    row = conn.execute(
        "SELECT id FROM set_insert_types WHERE set_id = ? AND name = ?",
        (set_id, name),
    ).fetchone()
    return row[0] if row else None
```

Same pattern for `upsert_parallel` → return `set_parallels.id`.

**Step 4: Update scraper Pass 1 to build the mapping**

In `scraper.py`, modify Pass 1 (lines 244-263). Track which insert each parallel belongs to:

```python
# --- Pass 1: Register all parallels and insert type names ---
# Build mapping: for each parallel, determine its parent insert
insert_ids = {}  # canonical_name -> insert_type_id
parallel_ids = {}  # normalized_name -> parallel_id

for sub in sub_sets:
    sub_name = sub["name"]

    if _is_parallel(sub_name):
        normalized = _normalize_parallel_name(sub_name, insert_names)
        norm_key = normalized.lower()
        if norm_key not in parallel_names_seen:
            parallel_names_seen.add(norm_key)
            pid = upsert_parallel(conn, set_id=set_id, name=normalized)
            parallel_ids[norm_key] = pid
            parallels_registered += 1

            # Determine parent insert by prefix matching (longest first)
            parent_insert = "Base"
            canonical_inserts_sorted = sorted(
                {_strip_series_suffix(n) for n in insert_names},
                key=len, reverse=True,
            )
            stripped = _strip_series_suffix(sub_name)
            for ins_name in canonical_inserts_sorted:
                if stripped.lower().startswith(ins_name.lower()):
                    parent_insert = ins_name
                    break

            # Link parallel to parent insert
            if parent_insert.lower() not in insert_ids:
                iid = upsert_insert_type(conn, set_id=set_id, name=parent_insert)
                insert_ids[parent_insert.lower()] = iid
            link_parallel_to_insert(conn,
                insert_type_id=insert_ids[parent_insert.lower()],
                parallel_id=pid)
    else:
        canonical = _strip_series_suffix(sub_name)
        canon_key = canonical.lower()
        if canon_key not in insert_names_registered:
            insert_names_registered.add(canon_key)
            iid = upsert_insert_type(conn, set_id=set_id, name=canonical)
            insert_ids[canon_key] = iid
```

**Step 5: Run tests**

Run: `cd tcdb-scraper && python -m pytest test_db_helper.py -v`
And: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add tcdb-scraper/db_helper.py tcdb-scraper/scraper.py
git commit -m "feat: scraper builds insert-parallel mapping in catalog DB"
```

---

### Task 7: Update Catalog-Merge to Import Junction Data

**Files:**
- Modify: `server/catalog-merge.js:120-173` (doMerge transaction)
- Test: `server/tests/test-routes.js`

**Step 1: Write the failing test**

Add test that verifies merged catalog populates `insert_type_parallels`:

```javascript
it('catalog merge populates insert_type_parallels junction', async () => {
  // This test uses a test catalog DB with junction data
  // Create a minimal catalog with the junction table
  // ... (create temp catalog DB, add set + insert type + parallel + junction row)
  // ... merge, then verify insert_type_parallels has rows in user DB
});
```

**Step 2: Add junction merge logic to catalog-merge.js**

In the `doMerge` transaction, after merging parallels (line 151), add:

```javascript
// Merge insert_type_parallels junction
const hasJunction = (() => {
  try {
    catalogDb.prepare('SELECT 1 FROM insert_type_parallels LIMIT 1').get();
    return true;
  } catch (_) { return false; }
})();

if (hasJunction) {
  const catJunctions = catalogDb.prepare(`
    SELECT itp.insert_type_id as cat_it_id, itp.parallel_id as cat_p_id,
           sit.name as it_name, sp.name as p_name
    FROM insert_type_parallels itp
    JOIN set_insert_types sit ON sit.id = itp.insert_type_id
    JOIN set_parallels sp ON sp.id = itp.parallel_id
    WHERE sit.set_id = ?
  `).all(catSet.id);

  const findUserInsertType = db.prepare('SELECT id FROM set_insert_types WHERE set_id = ? AND name = ?');
  const findUserParallel = db.prepare('SELECT id FROM set_parallels WHERE set_id = ? AND name = ?');
  const upsertJunction = db.prepare(`
    INSERT OR IGNORE INTO insert_type_parallels (insert_type_id, parallel_id) VALUES (?, ?)
  `);

  for (const junc of catJunctions) {
    const userIt = findUserInsertType.get(userSetId, junc.it_name);
    const userP = findUserParallel.get(userSetId, junc.p_name);
    if (userIt && userP) {
      upsertJunction.run(userIt.id, userP.id);
    }
  }
}
```

**Step 3: Run tests**

Run: `cd server && node --test tests/test-routes.js`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add server/catalog-merge.js server/tests/test-routes.js
git commit -m "feat: catalog-merge imports insert_type_parallels junction"
```

---

### Task 8: Update SetDetail.jsx — Filtered Parallel Dropdown + Spreadsheet View

**Files:**
- Modify: `frontend/src/pages/SetDetail.jsx:30-32` (state), `frontend/src/pages/SetDetail.jsx:618-647` (filter UI), `frontend/src/pages/SetDetail.jsx:700+` (card table)

**Step 1: Update state and parallel filtering**

Change the parallel dropdown to use `activeInsertType`'s nested parallels:

```jsx
// Replace flat parallels with nested lookup
const activeInsertTypeObj = metadata.insertTypes.find(t => t.name === activeInsertType);
const availableParallels = activeInsertTypeObj?.parallels || [];
```

Update the parallel `<select>` to use `availableParallels` instead of `metadata.parallels`. Reset `activeParallel` to `''` when insert type changes.

**Step 2: Add parallel columns to card table**

When viewing an insert type, show owned parallel columns:

```jsx
// Determine which parallel columns to show
const [showAllParallels, setShowAllParallels] = useState(false);
const ownedParallelNames = new Set();
filtered.forEach(c => c.owned_parallels?.forEach(op => ownedParallelNames.add(op.name)));
const parallelColumns = showAllParallels
  ? availableParallels
  : availableParallels.filter(p => ownedParallelNames.has(p.name));

// In the table header:
<th>Qty</th>
{parallelColumns.map(p => <th key={p.id} className="text-xs">{p.name}</th>)}

// In each card row:
<td>{card.qty}</td>
{parallelColumns.map(p => {
  const owned = card.owned_parallels?.find(op => op.parallel_id === p.id);
  return <td key={p.id}>{owned?.qty || 0}</td>;
})}
```

**Step 3: Add "Show All Parallels" toggle**

```jsx
{availableParallels.length > 0 && (
  <button onClick={() => setShowAllParallels(!showAllParallels)} className="text-xs text-cv-accent">
    {showAllParallels ? 'Show owned only' : `Show all ${availableParallels.length} parallels`}
  </button>
)}
```

**Step 4: Test manually in dev mode**

Run: `cd frontend && npm run dev` and `cd server && npm start`
Verify: Changing insert type updates parallel dropdown. Card table shows parallel columns.

**Step 5: Commit**

```bash
git add frontend/src/pages/SetDetail.jsx
git commit -m "feat: filtered parallel dropdown + spreadsheet view in SetDetail"
```

---

### Task 9: Update VoiceEntry.jsx — Filtered Parallel Dropdown

**Files:**
- Modify: `frontend/src/pages/VoiceEntry.jsx:147-149` (state), `frontend/src/pages/VoiceEntry.jsx:454-467` (parallel dropdown)

**Step 1: Filter parallels by selected insert type**

```jsx
// Derive available parallels from nested metadata
const activeInsertObj = metadata.insertTypes.find(t => t.name === insertType);
const availableParallels = activeInsertObj?.parallels || [];

// Reset parallel when insert type changes
useEffect(() => { setParallel(''); }, [insertType]);
```

**Step 2: Update parallel dropdown to use filtered list**

Replace `metadata.parallels.map(...)` with `availableParallels.map(...)` in the parallel `<select>`.

**Step 3: Update commit logic**

When committing a voice entry batch with a parallel selected, use the card_parallels API instead of creating a separate card row:

```jsx
// In commitEntries:
if (parallel) {
  // Find card by card_number + insert_type, then set parallel qty
  const card = cards.find(c => c.card_number === entry.cardNumber && c.insert_type === insertType);
  if (card) {
    const parallelObj = availableParallels.find(p => p.name === parallel);
    await axios.put(`${API}/api/cards/${card.id}/parallels`, {
      parallel_id: parallelObj.id, qty: entry.qty,
    });
  }
} else {
  // Normal base qty update
  await axios.put(`${API}/api/cards/${card.id}`, { qty: entry.qty });
}
```

**Step 4: Test manually in dev mode**

Verify: Select a set → select insert type → parallel dropdown shows only valid parallels.

**Step 5: Commit**

```bash
git add frontend/src/pages/VoiceEntry.jsx
git commit -m "feat: filter parallel dropdown by insert type in VoiceEntry"
```

---

### Task 10: Data Migration for Existing Cards

**Files:**
- Modify: `server/db.js` (migration function)
- Test: `server/tests/test-routes.js`

**Step 1: Write migration logic**

Add a migration function in `server/db.js` that runs after table creation:

```javascript
// Migrate existing cards with parallel != '' to card_parallels
function migrateParallelCards(db) {
  const cardsWithParallel = db.prepare(`
    SELECT c.id, c.set_id, c.card_number, c.insert_type, c.parallel, c.qty
    FROM cards c WHERE c.parallel != '' AND c.parallel IS NOT NULL
  `).all();

  if (cardsWithParallel.length === 0) return;
  console.log(`[Migration] Migrating ${cardsWithParallel.length} parallel card rows to card_parallels...`);

  const findBaseCard = db.prepare('SELECT id FROM cards WHERE set_id = ? AND card_number = ? AND insert_type = ? AND parallel = ?');
  const createBaseCard = db.prepare('INSERT INTO cards (set_id, card_number, player, team, rc_sp, insert_type, parallel, qty, image_path) SELECT set_id, card_number, player, team, rc_sp, insert_type, \'\', 0, image_path FROM cards WHERE id = ?');
  const findParallel = db.prepare('SELECT id FROM set_parallels WHERE set_id = ? AND name = ?');
  const insertCardParallel = db.prepare('INSERT OR IGNORE INTO card_parallels (card_id, parallel_id, qty) VALUES (?, ?, ?)');
  const deleteCard = db.prepare('DELETE FROM cards WHERE id = ?');

  const migrate = db.transaction(() => {
    for (const c of cardsWithParallel) {
      // Find or create the base card
      let baseCard = findBaseCard.get(c.set_id, c.card_number, c.insert_type, '');
      if (!baseCard) {
        createBaseCard.run(c.id);
        baseCard = findBaseCard.get(c.set_id, c.card_number, c.insert_type, '');
      }
      if (!baseCard) continue;

      // Find the parallel in set_parallels
      const par = findParallel.get(c.set_id, c.parallel);
      if (par && c.qty > 0) {
        insertCardParallel.run(baseCard.id, par.id, c.qty);
      }

      // Delete the old parallel card row (unless it IS the base)
      if (c.id !== baseCard.id) {
        deleteCard.run(c.id);
      }
    }
  });

  migrate();
  console.log('[Migration] Parallel card migration complete');
}
```

Call this after `openDb()` returns, idempotently.

**Step 2: Test with existing data**

Manually verify with the user's DB or write a test that creates legacy data and verifies migration.

**Step 3: Commit**

```bash
git add server/db.js
git commit -m "feat: migrate existing parallel card rows to card_parallels table"
```

---

### Task 11: End-to-End Test with 2025 Topps Holiday

**Files:**
- Test manually using the admin TCDB import

**Step 1: Import 2025 Topps Holiday from TCDB admin page**

Verify in the logs:
- "Chrome" insert type is created
- "Gold Refractor", "Black Refractor", etc. are created as parallels LINKED to Chrome
- "Holiday" insert type has its own parallels
- Base has its own parallels

**Step 2: Verify in SetDetail**

- Select "Chrome" insert → parallel dropdown shows only Chrome parallels
- Select "Holiday" insert → parallel dropdown shows only Holiday parallels
- Card table shows parallel columns

**Step 3: Verify in VoiceEntry**

- Select set → select "Chrome" → parallel dropdown filters correctly
- Enter a card with a parallel → verify card_parallels row created

**Step 4: Version bump and release**

```bash
# Bump version in package.json and electron/package.json
git add -A && git commit -m "feat: insert-parallel redesign with junction table and rainbow tracker"
git tag v1.6.0 && git push origin main --tags
```

---

## Task Dependencies

```
Task 1 (junction table) ──┐
Task 2 (card_parallels) ──┼── Task 3 (metadata API)
                          │── Task 4 (parallels API)
                          │── Task 5 (GET sets/:id)
                          └── Task 6 (scraper) ── Task 7 (catalog-merge)
Task 3 + 4 + 5 ──── Task 8 (SetDetail UI) ── Task 9 (VoiceEntry UI)
Task 1 + 2 ──── Task 10 (migration)
All ──── Task 11 (E2E test)
```

Tasks 1-2 can run in parallel. Tasks 3-5 depend on 1-2. Task 6-7 can run in parallel with 3-5. Tasks 8-9 depend on 3-5. Task 10 depends on 1-2. Task 11 depends on all.
