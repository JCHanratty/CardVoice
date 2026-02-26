# Set Display Redesign — Card-Centric Design

**Date:** 2026-02-26
**Status:** Approved
**Goal:** Reorganize how sets are displayed and navigated. Fix clutter, add hierarchy, make parallels per-card instead of per-row, add insert tracking.

---

## Problem

The My Sets page is a flat list of 100+ sets grouped only by year. Child sets, insert sets, and empty sets all appear at the same level. Inside SetDetail, each parallel is a separate card row — "Mike Trout Base" and "Mike Trout Gold" are 2 rows, but collectors think of them as 1 card with 2 variants. Buttons everywhere, no visual hierarchy, empty 0/0 sets mixed in.

## Three Changes

### 1. My Sets — Collapsible Tree with Tracked-Only Expansion

**Collapsed (default):** One line per set, grouped Year > Brand > Product.

```
 2025
   Topps
      2025 Topps              ████░░░░ 52%   890/1710
         65 inserts · 129 parallels · 37,974 total cards
```

Progress bar reflects only **tracked** insert types.

**Expanded (click chevron):** Shows only tracked inserts under the set.

```
    2025 Topps              ████░░░░ 52%   890/1710
        65 inserts · 129 parallels · 37,974 total cards
        Base                ██████░░ 78%   280/360
        Series 2 Base       ███░░░░░ 38%   135/355
        Update Base         █████░░░ 65%   475/730
        1990 35th Anniv     ██░░░░░░ 22%   44/200
                                [View All Inserts ->]
```

- `[View All Inserts ->]` navigates to SetDetail
- Clicking the set name also navigates to SetDetail (same as today)
- **Empty sets hidden by default.** Toggle "Show empty" in header to reveal (dimmed).
- **Action buttons** (Voice, Delete, etc.) consolidated into a `...` overflow menu per set row
- Collapse state persisted in localStorage

**Grouping rules:**
- Year = top-level collapsible (already exists)
- Brand = second-level group (from `card_sets.brand`)
- Parent set = clickable row with aggregate stats
- Child sets (`parent_set_id`) nest under parent with tree lines
- Orphan sets sit at brand level

### 2. SetDetail Card Table — One Row Per Card, Parallels on Expand

**Table columns:** `#`, `Player`, `Team`, `RC/SP`, `Qty`

No parallel column. No checkmark badges. Clean table.

```
  #  | Player               | Team         | RC/SP | Qty
  1  | Mike Trout           | LAA          |       |  2
  2  | Shohei Ohtani        | LAD          |       |  1
 12  | Roki Sasaki          | LAD          |  RC   |  1
 15  | Emmanuel Clase       | CLE          |       |  0
```

**Click/expand a row** to see owned parallels underneath:

```
 12  | Roki Sasaki          | LAD          |  RC   |  1
       Base ........................ qty: 2
       Gold /2000 .............. qty: 1
       Purple Holo /250 ........ qty: 1
```

- Only owned parallels shown in expand (no empty ones)
- Rows with owned parallels get a subtle visual hint (left border accent)
- Unowned cards show `0` in Qty, no expand content

**Filters above table:**
- Insert Type dropdown (tracked inserts pinned at top)
- Filter: All / Have / Need
- Search box
- No parallel dropdown needed — parallels are inline per card

**Stats bar** reflects the active insert type only.

### 3. Insert Type Tracking Toggle

**Location:** SetDetail "Edit Sections" modal.

Each insert type gets a toggle:
- ON = tracked. Counts toward My Sets progress. Visible in tree expansion.
- OFF = still browsable in SetDetail. Not in progress stats. Not in tree.

Base is ON by default when a set is added. All others default OFF.

**Schema:** `ALTER TABLE set_insert_types ADD COLUMN tracked INTEGER DEFAULT 0`
Migration sets `tracked = 1` WHERE `name = 'Base'`.

**API:** `GET /api/sets` aggregates stats from tracked inserts only. `PUT /api/insert-types/:id` accepts `tracked` field.

---

## What Stays the Same

- Voice entry flow (unchanged)
- Card editing inline (unchanged)
- Pricing/valuation panels (unchanged)
- Import/export (unchanged)
- The underlying data model (cards, card_parallels, set_insert_types, set_parallels)

## Tech Stack

- Node.js/Express, better-sqlite3 (backend)
- React, Tailwind CSS (frontend)
- Existing component library (Lucide icons, etc.)
