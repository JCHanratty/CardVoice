# Batch TCDB Scraping with Preview/Edit Modal

## Goal

Scrape 91 sets from TCDB in a batch queue, preview/edit each scraped result, then import to CardVoice. Separates scraping from importing so the user can review and fix data quality issues before committing.

## Architecture

Three-phase pipeline: **Queue → Scrape → Preview/Edit → Import**. Each queue item gets its own `catalog.db` file (full scrape fidelity). The catalog.db is serialized to JSON for the preview modal. Edits modify the catalog.db directly via SQLite operations. Import runs the existing `mergeCatalog()` on the edited catalog.db.

## Data Flow

```
1. User loads 91-item JSON → scrape_queue table
2. "Start Scraping" → server processes in priority order:
   For each item:
     a. Fetch TCDB set list for year → match tcdb_search to find tcdb_set_id
     b. If low-confidence match → mark needs_review, skip to next
     c. Spawn scraper.py --set-id {id} → writes resources/scrape-queue/{queueId}/catalog.db
     d. Read catalog.db → serialize to JSON → store in scrape_queue.scraped_data
     e. Mark status = scraped, wait 15s, next item
3. Frontend polls status, shows live progress
4. User reviews scraped items in preview modal
5. User edits (rename, reclassify, remove) → SQLite ops on catalog.db
6. User clicks Import → mergeCatalog(userDb, catalogPath) → mark imported
```

## Database

New table in `server/db.js`:

```sql
scrape_queue (
  id INTEGER PRIMARY KEY,
  priority INTEGER,
  year INTEGER,
  brand TEXT,
  set_name TEXT,
  tcdb_search TEXT,
  tcdb_set_id INTEGER,          -- resolved after TCDB search
  status TEXT DEFAULT 'pending', -- pending/searching/scraping/needs_review/scraped/importing/imported/error/skipped
  scraped_data TEXT,             -- JSON blob for preview modal
  catalog_path TEXT,             -- path to per-item catalog.db
  error_message TEXT,
  card_set_id INTEGER,           -- FK to card_sets.id after import
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

Status lifecycle:
- `pending` → `searching` → `scraping` → `scraped` → `importing` → `imported`
- `searching` → `needs_review` (low-confidence match) → user assigns ID → `pending`
- Any step → `error` (retryable) or `skipped` (user choice)

## TCDB Search Resolution

The riskiest step. Many search terms don't match TCDB's naming exactly (e.g., "2009 Bowman & Prospects" vs "2009 Bowman Baseball & Prospects").

### Resolution algorithm

1. Fetch all sets for the year: `scraper.py --list --year {year} --json`
2. Normalize both `tcdb_search` and each TCDB name: lowercase, strip "baseball", collapse whitespace
3. Score via token overlap: `intersection(tokens_a, tokens_b) / union(tokens_a, tokens_b)`
4. Decision thresholds:
   - **Score >= 0.9** → auto-resolve, proceed to scrape
   - **Score 0.6-0.9** → auto-resolve with `note: "fuzzy match"` logged
   - **Score < 0.6 or multiple candidates within 0.1** → `needs_review`
5. `needs_review` items store top 3 candidates: `{"candidates": [{tcdb_id, name, card_count, score}, ...]}`

### needs_review handling

- Queue processor **skips** these items and continues to the next
- In the queue table, shows "Assign" button → inline form to pick from candidates or paste a TCDB set ID
- Saving an assignment sets `tcdb_set_id` and resets status to `pending`

## API Endpoints

All under `/api/admin/tcdb/scrape-queue`.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | POST | Load queue from JSON array of `{tcdb_search, year, brand, set_name, priority}` |
| `/` | GET | List all queue items |
| `/start` | POST | Begin processing pending items |
| `/stop` | POST | Pause after current item completes |
| `/status` | GET | Polling endpoint: `{running, currentItem, completedCount, totalCount, errors}` |
| `/:id` | DELETE | Remove queue item and its catalog.db |
| `/:id/assign` | PUT | Set tcdb_set_id manually, reset needs_review → pending |
| `/:id/preview` | GET | Return scraped_data JSON |
| `/:id/edit` | PUT | Apply operations to catalog.db, re-serialize JSON |
| `/:id/import` | POST | Run mergeCatalog(), mark imported, store card_set_id |
| `/:id/skip` | POST | Mark as skipped |
| `/:id/rescrape` | POST | Reset to pending, delete old catalog.db |
| `/import-all` | POST | Batch import all scraped items that haven't been imported |
| `/clear` | DELETE | Remove all queue items and catalog files |

## Edit Operations on catalog.db

The PUT `/:id/edit` endpoint accepts `{operations: [...]}`. Each operation maps to SQLite on the per-item catalog.db.

**catalog.db schema** (from `db_helper.py`):
```
card_sets:             id, name, year, brand, sport, total_cards
cards:                 id, set_id, card_number, player, team, rc_sp, insert_type, parallel, qty, image_path
set_insert_types:      id, set_id, name, card_count, odds, section_type
set_parallels:         id, set_id, name, print_run, exclusive, notes, serial_max, channels, variation_type
insert_type_parallels: insert_type_id, parallel_id
```

### Operation map

| UI Action | op_type | SQL on catalog.db |
|-----------|---------|-------------------|
| Rename set | `rename_set` | `UPDATE card_sets SET name = :new WHERE id = :id` |
| Change brand | `update_set_brand` | `UPDATE card_sets SET brand = :new WHERE id = :id` |
| Remove card | `remove_card` | `DELETE FROM cards WHERE id = :id` + recount total |
| Rename insert | `rename_insert` | `UPDATE set_insert_types SET name = :new WHERE id = :id` + `UPDATE cards SET insert_type = :new WHERE insert_type = :old AND set_id = :sid` |
| Remove insert | `remove_insert` | `DELETE FROM set_insert_types WHERE id = :id` + `DELETE FROM cards WHERE insert_type = :name AND set_id = :sid` + recount |
| Rename parallel | `rename_parallel` | `UPDATE set_parallels SET name = :new WHERE id = :id` + `UPDATE cards SET parallel = :new WHERE parallel = :old AND set_id = :sid` |
| Remove parallel | `remove_parallel` | `DELETE FROM set_parallels WHERE id = :id` + `DELETE FROM cards WHERE parallel = :name AND set_id = :sid` + recount |
| Insert → parallel | `insert_to_parallel` | Create `set_parallels` row, `UPDATE cards SET parallel = :name, insert_type = :parent WHERE insert_type = :name AND set_id = :sid`, delete `set_insert_types` row, recount |
| Parallel → insert | `parallel_to_insert` | Reverse of above |

All operations run in a single transaction. After applying, re-read catalog.db → JSON → update `scraped_data`.

## Server — ScrapeQueueProcessor

New file: `server/scrape-queue.js`

```
class ScrapeQueueProcessor {
  constructor(db, tcdbService, scrapeDir)

  async start()     — loop pending items by priority, skip needs_review
  stop()            — set flag, halt after current item
  getStatus()       — {running, currentItem, completedCount, totalCount, errorCount}

  // Per-item pipeline:
  async _resolveSetId(item)   — search + fuzzy match → tcdb_set_id or needs_review
  async _scrapeItem(item)     — spawn scraper, write catalog.db to scrapeDir/{id}/
  _serializeCatalog(dbPath)   — open catalog.db, read all tables, return JSON
  async _applyEdits(item, ops) — open catalog.db, run SQL operations, re-serialize
  async _importItem(item)     — mergeCatalog(userDb, {catalogPath, force: true})
}
```

The processor reuses `TcdbService._runScraperRaw()` for spawning the Python scraper. It does NOT replace TcdbService — it wraps it for batch orchestration.

## Frontend

### Admin Page — Scrape Queue Section

New section between "Checklist Backfill" and "Browse & Import" on AdminPage.

**Top bar:**
- "Load Queue" button → opens textarea to paste JSON (or file upload)
- "Start Scraping" / "Stop" toggle button
- Progress: "Scraping 14/91 — 2006 Bowman Chrome & Prospects..." with elapsed time
- Filter tabs: All (91) | Pending (45) | Needs Review (3) | Scraped (30) | Imported (10) | Errors (3)

**Queue table:**
- Columns: #, Year, Brand, Set Name, Status, Cards, Actions
- Status badges with color coding
- Actions vary by status (see API section)
- Bulk action: "Import All Scraped" button

**needs_review row:**
- Inline expandable: shows top 3 TCDB candidates with name, card count, match score
- Radio select or "Paste TCDB ID" input
- "Assign & Queue" button

### ScrapePreviewModal.jsx (new component)

Opens when user clicks "Preview" on a scraped item.

**Header:** "{year} {brand} {set_name}" — editable inline fields for name, brand

**Three tabs:**

1. **Cards** — scrollable table of all cards
   - Columns: Card #, Player, Team, RC/SP, Insert Type, Parallel
   - Search/filter bar
   - Checkbox column for bulk remove
   - "Remove Selected" button

2. **Insert Types** — table of detected inserts
   - Columns: Name (editable), Card Count, Section Type
   - Actions: Rename, Reclassify as Parallel, Remove
   - Reclassify prompts for parent insert (dropdown)

3. **Parallels** — table of detected parallels
   - Columns: Name (editable), Print Run, Type
   - Actions: Rename, Reclassify as Insert, Remove

**Footer:**
- "Import to CardVoice" (primary green button)
- "Skip" (gray)
- "Re-scrape" (orange)
- "Close" (x)

## Storage

Per-item catalog.db files stored at:
```
{userData}/scrape-queue/{queueId}/catalog.db
```

On packaged app: `resources/scrape-queue/{id}/catalog.db` under the app's userData path.
Cleaned up when queue item is deleted or imported (configurable — could keep for re-import).

## The 91 Sets

The queue JSON is provided by the user. It covers:
- Years: 1984-2024
- Brands: Topps, Bowman, Donruss, Fleer, Upper Deck, Score, Leaf, O-Pee-Chee, Panini
- Mix of Base sets, Chrome/Prospects subsets, and specialty sets (Holiday, Gallery, Heritage, etc.)

Estimated scrape time at 15s/set: ~23 minutes for the full batch. Some sets (1987 Topps = 792 cards) will take longer to paginate.

## Risks

1. **TCDB name mismatches** — mitigated by `needs_review` status + manual assignment
2. **Cloudflare blocking** — existing scraper has rate limiting + user-agent rotation; 15s delays help
3. **Large JSON blobs** — 1987 Topps with 792 cards = ~400KB JSON. SQLite TEXT handles this fine
4. **Scraper failures mid-batch** — errors are per-item, don't stop the queue; re-scrape button for retries
5. **Edit complexity** — insert↔parallel reclassification requires careful SQL; transaction wrapping prevents partial edits
