# TCDB Collection Import + Player Metadata System — Design

## Problem

User has ~10,000 cards logged on TCDB across 71 pages. No way to bulk-import an existing TCDB collection into CardVoice. Also no player enrichment — can't filter by Hall of Famer, can't highlight focus players, can't find "all my HOF rookie cards."

## Design Decisions

- **Auth method:** Cookie-based. User pastes TCDB session cookie into CardVoice admin. Scraper uses it to access the flat 71-page collection view.
- **Insert/parallel classification:** Name-based parsing using existing `_is_parallel` / `_normalize_parallel_name` logic.
- **Set name resolution:** Extract `sid` from card links, batch-lookup canonical names (one request per unique set, ~100 total).
- **Set matching during import:** Primary key is `tcdb_set_id` (guaranteed unique). Fall back to name+year only for manually-created sets.
- **Checklist backfill:** Background after import. Track `checklist_imported` flag on `card_sets`.
- **HOF data source:** Bundled static JSON (~340 HOF members). Player tiers manually curated.
- **Player metadata schema:** Single `player_metadata` table (consolidated from 3 tables).
- **Name matching:** Normalized exact match. Strip suffixes with word-boundary regex `\b(jr|sr|ii|iii|iv)\b` to avoid mangling names like "William".
- **Focus players:** UI-managed via settings page + star icon on player names.

## Schema Changes

### New table: `player_metadata`

```sql
CREATE TABLE IF NOT EXISTS player_metadata (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  player_name       TEXT UNIQUE NOT NULL,
  tier              TEXT CHECK(tier IN ('hof','future_hof','key_rookie','star')),
  is_focus          INTEGER DEFAULT 0,
  focus_added_at    DATETIME,
  hof_induction_year INTEGER,
  hof_position      TEXT,
  hof_primary_team  TEXT
);
```

### Migrations on `card_sets`

```sql
ALTER TABLE card_sets ADD COLUMN checklist_imported INTEGER DEFAULT 0;
ALTER TABLE card_sets ADD COLUMN tcdb_set_id INTEGER;
```

### New key in `app_meta`

`tcdb_session_cookie` — user's TCDB session cookie for authenticated scraping.

## Collection Scraper (`tcdb-scraper/collection_scraper.py`)

1. Reads cookie from CLI arg (passed by TcdbService from `app_meta`)
2. Paginates `ViewCollectionMode.cfm?PageIndex=1..N` with 15-20s delays
3. Per `<tr class="collection_row">`: extracts qty (badge text), card_number (link text col 3), player + rc_sp suffix (col 5 text after `</a>`), sid + cid from `/ViewCard.cfm/sid/{sid}/cid/{cid}/...` href
4. Checkpoint: `collection_checkpoint.json` tracks completed page numbers
5. After all pages: collect unique `sid` values, fetch canonical set name from each set's ViewSet page (one request per unique set)
6. Output: JSON grouped by set with all card data

## Import Pipeline

For each set in the scraped collection:
1. Match on `tcdb_set_id` first → existing `card_sets` row
2. Fall back to name+year match for manually-created sets
3. If no match: create new `card_sets` row with `tcdb_set_id`
4. Parse set name to extract insert type + parallel (existing scraper logic)
5. Register insert types and parallels, link via `insert_type_parallels` junction
6. Create base cards (parallel='', qty=base qty)
7. For parallel cards: use `card_parallels` table
8. Match players against `player_metadata` for tier/focus tagging

## Checklist Backfill (Second Pass)

After collection import completes:
1. Find all sets where `checklist_imported = 0`
2. Queue each for full checklist scrape using existing `TcdbService.importSet(tcdb_set_id, year)`
3. On completion: set `checklist_imported = 1`
4. Runs in background with progress polling
5. 15-20s delays between sets

## Player Name Normalization

```python
import re
def normalize_player_name(name):
    name = name.lower().strip()
    name = re.sub(r'[.,]', '', name)                    # strip punctuation
    name = re.sub(r'\b(jr|sr|ii|iii|iv)\b', '', name)   # strip suffixes (word-boundary)
    return re.sub(r'\s+', ' ', name).strip()             # collapse whitespace
```

Same function implemented in JS for server-side matching.

## UI Changes

### SetDetail Spreadsheet
- HOF gold badge next to player name
- Tier color indicator (Future HOF = silver, Key Rookie = green, Star = blue)
- Focus player: entire row background highlight (subtle gold tint)

### New Filters
- "HOF Rookie Cards" — tier='hof' AND rc_sp LIKE '%RC%'
- "Focus Players" — is_focus=1
- "By Tier" — dropdown for each tier level
- These work across sets in a new cross-set view

### Focus Player Management
- Star icon on any player name → toggle focus
- Settings page with search + add/remove
- "My Players" page: all focus player cards across entire collection

### Admin Page
- TCDB cookie input field (stored in app_meta, masked display)
- "Import My Collection" button with live progress (page X/71, cards found)
- Checklist backfill status bar
- Cancel button for long-running operations

## Test Case

Import the user's TCDB collection (71 pages, ~7000 cards). Verify:
- All sets created with correct names and tcdb_set_id
- Cards have correct qty, insert_type, parallel
- RC/SP flags preserved
- HOF players tagged with gold badge in UI
- Focus players highlighted
- Checklist backfill fills in unowned cards
- Set completion percentages update correctly
