# TCDB Admin Integration Design

**Goal:** Embed the TCDB scraper into CardVoice's admin page so users can browse, preview, and import card sets without touching the command line.

**Architecture:** New AdminPage.jsx with a two-phase browse-then-import flow. Node/Express spawns the Python scraper as a child process. Frontend polls for progress via REST API, matching the existing SyncService pattern.

**Runtime:** Python subprocess spawned by Node via `child_process.spawn()`. Requires Python installed on user's machine.

---

## Data Flow

```
AdminPage.jsx -> Express /api/admin/tcdb/* -> spawn python scraper.py -> stdout JSON
                                                      |
                                            output/tcdb-catalog.db
                                                      |
                                            catalog-merge.js -> cardvoice.db
```

## UI Sections

### 1. Browse Sets

- Year dropdown (defaults to current year), sport preset to "Baseball"
- "Browse" button calls `POST /api/admin/tcdb/browse` which spawns `python scraper.py --list --year {year} --sport {sport} --json`
- Displays searchable table of available sets (name, card count)
- Click a set row to trigger preview

### 2. Preview

- Calls `POST /api/admin/tcdb/preview` with the TCDB set ID
- Spawns `python scraper.py --preview --set-id {id} --no-images --json`
- Renders structured preview in CardVoice panel style:
  - Base card count and sample cards
  - Parallels list with names
  - Inserts list with names
- "Import" button at the bottom

### 3. Import + Progress

- Calls `POST /api/admin/tcdb/import` with the set ID
- Spawns `python scraper.py --set-id {id} --no-images --json`
- Express holds a status object polled by frontend every 2 seconds
- Progress bar matching Settings sync progress style (gradient bar, current/total, current item label)
- On completion: Express calls `mergeCatalog()` to bring data into CardVoice's DB
- Shows summary: cards added, parallels, inserts

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/admin/tcdb/browse` | Fetch set list for year/sport |
| POST | `/api/admin/tcdb/preview` | Preview a set's cards/inserts/parallels |
| POST | `/api/admin/tcdb/import` | Start scrape + merge |
| GET | `/api/admin/tcdb/status` | Poll import progress |

## Scraper Changes

- Add `--json` flag to scraper.py for machine-readable output (JSON to stdout)
- Add `--list` mode to fetch available sets for a year/sport
- Preview mode already exists, just needs JSON output variant

## UI Patterns (from existing app)

- Dark theme with cv-* Tailwind color palette
- Panel: `bg-cv-panel rounded-xl border border-cv-border/50 p-5`
- Progress bar: gradient from-cv-accent to-cv-gold, polled every 2-5s
- Buttons: gradient primary, bordered secondary
- Icons: lucide-react
- Fonts: Playfair Display (headings), DM Sans (body), JetBrains Mono (data)

## Decisions

- **Metadata only** -- no image downloads during scrape
- **Single set at a time** -- no batch queue (YAGNI)
- **Python subprocess** -- not rewritten in Node, not bundled as exe
- **No collection sync** -- just set import (migrator stays CLI-only for now)
