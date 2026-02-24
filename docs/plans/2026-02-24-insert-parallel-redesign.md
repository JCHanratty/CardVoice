# Insert-Parallel Redesign

## Problem

Insert types and parallels are stored as independent flat lists with no relationship. The system has no way to express "Gold Refractor is a parallel OF Chrome" or "Red Foil is a parallel OF Anime". This causes:

- Parallel dropdowns show ALL parallels regardless of insert type
- Filtering by insert type + parallel shows 0 cards (parallel card rows don't exist)
- Scraper loses the insert-parallel mapping during normalization
- No rainbow tracking (which parallels do you own per card?)

## Design

### Schema Changes

**New table: `insert_type_parallels`** — junction table mapping valid parallels per insert type.

```sql
CREATE TABLE insert_type_parallels (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  insert_type_id  INTEGER NOT NULL REFERENCES set_insert_types(id) ON DELETE CASCADE,
  parallel_id     INTEGER NOT NULL REFERENCES set_parallels(id) ON DELETE CASCADE,
  UNIQUE(insert_type_id, parallel_id)
);
```

**New table: `card_parallels`** — tracks owned parallels per card (on-demand, only when user owns one).

```sql
CREATE TABLE card_parallels (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  parallel_id INTEGER NOT NULL REFERENCES set_parallels(id) ON DELETE CASCADE,
  qty         INTEGER DEFAULT 1,
  UNIQUE(card_id, parallel_id)
);
```

**Cards table:** The `parallel` text column becomes unused for new imports. Cards are created with `parallel = ''` always. The `qty` on `cards` represents the base/non-parallel quantity.

### Migration

For each existing card row where `parallel != ''`:
1. Find or create the base card row (`parallel = ''`, same `card_number` + `insert_type`)
2. Find the matching `set_parallels` row by name
3. Create a `card_parallels` entry: `{card_id: base_card.id, parallel_id: parallel.id, qty: old_card.qty}`
4. Delete the old parallel card row entirely

### Scraper Changes

The scraper groups TCDB sub-sets by insert prefix:

1. First pass: identify all non-parallel sub-sets as inserts (+ implicit "Base")
2. Second pass: for each parallel sub-set, find which insert name it starts with (longest match first, already implemented)
3. Strip the insert prefix to get the normalized parallel name
4. Record the mapping and write to catalog DB: `upsert_insert_type()`, `upsert_parallel()`, AND populate `insert_type_parallels` junction
5. Create card rows only for root inserts with `parallel = ''`

Orphaned parallels (no matching insert prefix, like "Gold", "Blue") are assigned to "Base" insert.

### Catalog DB Schema

The `tcdb-catalog.db` (written by Python scraper) needs a new `insert_type_parallels` table matching the main schema. The catalog-merge reads this and populates the user's DB.

### API Changes

**GET /api/sets/:id/metadata** — returns parallels nested under insert types:

```json
{
  "insertTypes": [
    { "id": 1, "name": "Base", "card_count": 350, "parallels": [
      {"id": 10, "name": "Gold"}, {"id": 11, "name": "Blue"}
    ]},
    { "id": 2, "name": "Chrome", "card_count": 50, "parallels": [
      {"id": 12, "name": "Gold Refractor"}, {"id": 13, "name": "Black Refractor"}
    ]}
  ]
}
```

**GET /api/sets/:id/cards** — when filtering by insert type, also returns `card_parallels` data so the UI can render the spreadsheet.

**POST /api/cards/:id/parallels** — new endpoint to add/update/remove a parallel qty for a card.

### UI Changes

**SetDetail (spreadsheet view):**
- Pick insert type -> shows card list with one row per card
- Columns: `#`, `Player`, `Team`, `Base Qty`, then one column per owned parallel
- "Show all parallels" toggle to expand to full rainbow tracker (horizontally scrollable)
- Click qty cell to increment/decrement

**Voice Entry:**
- User selects insert type first -> parallel dropdown filters to only valid parallels for that insert
- User selects parallel (or "Base") before speaking card numbers
- Speaks card numbers + qty, system creates `card_parallels` entries

### Test Case

Use 2025 Topps Holiday as validation:
- "Chrome" insert with 9 parallels (Gold, Black, Blue, Blue Sparkle, Green, Green Sparkle, Orange, Purple, Red, SuperFractor)
- "Holiday" insert with its own set of parallels
- Base set with base-level parallels (Gold, Blue, etc.)

Verify: Chrome parallels only show when Chrome insert is selected. Holiday parallels only show for Holiday. Base parallels only show for Base.
