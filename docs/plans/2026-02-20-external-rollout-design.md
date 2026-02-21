# CardVoice External Rollout Design

**Date:** 2026-02-20
**Status:** Approved
**Goal:** Ship CardVoice to external users with pre-loaded checklists, user submissions, safe updates, anonymous analytics, and user-provided eBay credentials.

---

## Architecture Overview

CardVoice remains a **fully offline-first Electron desktop app**. No cloud services are required for core functionality. External integrations are optional and privacy-respecting:

- **Checklist catalog** — bundled SQLite file, ships with each release
- **User submissions/requests** — GitHub Issues with templates
- **Analytics** — anonymous heartbeat to Google Sheets webhook
- **Price tracking** — user-provided eBay API credentials
- **Updates** — electron-updater via GitHub Releases (already working)

```
[User's Machine]
  CardVoice.exe
    ├── checklist-catalog.db  (read-only, bundled)
    ├── cardvoice.db          (user data: %APPDATA%/CardVoice/)
    └── server (in-process)
          ├── catalog merge on startup (catalog → user DB, never touches qty)
          ├── eBay Browse API (user's own credentials)
          └── heartbeat ping (anonymous, once/day, opt-out)

[GitHub]
  ├── Releases → electron-updater auto-downloads
  ├── Issues → checklist submissions & set requests
  └── Actions → CI/CD build pipeline

[Google Sheets]
  └── Webhook endpoint → receives anonymous heartbeat pings
```

---

## 1. Bundled Checklist Catalog

### What ships with the app

A `checklist-catalog.db` SQLite file inside Electron's `resources/` directory. Contains:
- All approved card sets (name, year, brand, sport)
- All cards per set (card_number, player, team, rc_sp, insert_type, parallel)
- Insert type metadata (name, card_count, odds, section_type)
- Parallel metadata (name, print_run, exclusive, variation_type)
- **Zero ownership data** — all qty = 0

### Catalog merge on startup

On first launch, and after each app update:

1. Read `catalog_version` from `app_meta` table in user's DB
2. Compare against bundled catalog's version
3. If bundled version is newer, run merge **inside a transaction**:
   - Call `backupDb()` first (existing backup rotation)
   - For each set in catalog: find existing by name+year, or create new
   - For each card: find by set_id + card_number + insert_type + parallel
     - **Exists**: update player/team/rc_sp metadata only. **Never modify qty.**
     - **New**: insert with qty=0
   - Upsert insert types and parallels (metadata only)
   - Update `app_meta.catalog_version`
4. Log merge results: "Catalog v2026.02.1: added 3 sets, 450 cards, updated 12 cards"

### Catalog build process (admin workflow)

New script: `npm run export-checklists`
- Exports all sets from your development DB to `checklist-catalog.db`
- Strips all qty values to 0
- Stamps a version string (e.g., `2026.02.1`)
- Output file goes to `electron/resources/checklist-catalog.db`
- Bundled automatically by electron-builder via existing `extraResources` config

### Schema addition

```sql
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
-- Stores: catalog_version, heartbeat_last_sent, ebay_app_id, ebay_cert_id, analytics_enabled
```

**Files to modify:**
- `server/db.js` — add `app_meta` table creation
- `server/index.js` — run catalog merge on startup
- New file: `server/catalog-merge.js` — merge logic
- New file: `scripts/export-checklists.js` — catalog export tool
- `electron/package.json` — add `checklist-catalog.db` to `extraResources`

---

## 2. eBay API Credentials (User-Provided)

### Problem

Current eBay Browse API credentials (`EBAY_APP_ID`, `EBAY_CERT_ID`) are in `server/.env` and must not be shared with external users. Each user needs their own.

### Solution

**Settings page** gets a "Price Tracking Setup" section:
- Two text inputs: eBay App ID, eBay Cert ID
- "Save & Test" button — validates against `https://api.ebay.com/identity/v1/oauth2/token`
- Success: green checkmark + "Credentials valid"
- Failure: red error + "Invalid credentials — check your App ID and Cert ID"
- Credentials stored in `app_meta` table (local DB, never sent anywhere)

**Scraper** (`server/pricing/scraper.js`):
- On startup, load credentials from `app_meta` instead of `.env`
- Fall back to `.env` for backwards compatibility (your dev setup)
- If neither exists: skip sync, show "Set up eBay API keys in Settings to enable price tracking" in sync status

**How To page** gets a new section: "Setting Up eBay Price Tracking"
1. Go to developer.ebay.com → Sign in or create account
2. My Account → Application Access → Create Application
3. Choose "Production" environment
4. Copy the App ID (Client ID) and Cert ID (Client Secret)
5. Paste into CardVoice → Settings → Price Tracking Setup
6. Click "Save & Test" to verify

**Files to modify:**
- `server/pricing/scraper.js` — load credentials from DB, fall back to .env
- `frontend/src/pages/Settings.jsx` — add credential input section
- `frontend/src/pages/HowTo.jsx` — add eBay setup guide
- `server/routes.js` — new endpoints: `PUT /api/settings/ebay`, `POST /api/settings/ebay/test`

---

## 3. User Submissions & Set Requests

### GitHub Issue templates

Create `.github/ISSUE_TEMPLATE/` with two templates:

**checklist-submission.yml:**
```yaml
name: Submit a Checklist
description: Submit a checklist for review and inclusion in CardVoice
labels: [checklist-submission]
body:
  - type: input
    label: Set Name
    placeholder: "e.g., 2024 Topps Chrome"
  - type: input
    label: Year
  - type: input
    label: Brand
  - type: textarea
    label: Checklist Data
    description: Paste the checklist text (from Beckett, CardboardConnection, etc.)
  - type: textarea
    label: Parallels
    description: List any parallel variations (name, print run, exclusive)
```

**set-request.yml:**
```yaml
name: Request a Set
description: Request a specific set to be added to CardVoice
labels: [set-request]
body:
  - type: input
    label: Set Name
  - type: input
    label: Year
  - type: input
    label: Brand
  - type: textarea
    label: Notes
    description: Any additional details (specific inserts, parallels, etc.)
```

### In-app integration

- **SetManager page**: "Request a Set" text link below the header that opens `https://github.com/JCHanratty/CardVoice/issues/new?template=set-request.yml` in the default browser
- **ChecklistWizardModal**: After successful import, show a "Submit to Community" button that pre-fills the submission template with the imported data
- **Help menu**: "Request a Set" and "Submit a Checklist" menu items

**Files to modify:**
- `frontend/src/pages/SetManager.jsx` — add "Request a Set" link
- `frontend/src/components/ChecklistWizardModal.jsx` — add "Submit to Community" button
- `electron/main.js` — add Help menu items
- New files: `.github/ISSUE_TEMPLATE/checklist-submission.yml`, `.github/ISSUE_TEMPLATE/set-request.yml`

---

## 4. Update Modal

### Current behavior

Auto-downloads in background, shows a subtle banner at the top, installs on quit.

### New behavior

Replace the banner with a **modal dialog** when `update-downloaded` fires:

```
┌─────────────────────────────────────┐
│         CardVoice v1.2.0            │
│         Update Ready                │
│                                     │
│  A new version has been downloaded  │
│  and is ready to install.           │
│                                     │
│  [  Restart Now  ]  [  Later  ]     │
└─────────────────────────────────────┘
```

- **Restart Now**: calls IPC `quit-and-install` → `autoUpdater.quitAndInstall()`
- **Later**: dismisses modal, installs on next natural quit (existing behavior)

**Files to modify:**
- `electron/main.js` — add `ipcMain.handle('quit-and-install', ...)` handler
- `electron/preload.js` — expose `quitAndInstall()` method
- `frontend/src/App.jsx` — replace banner with modal component

---

## 5. Data Safety

### Guarantees

1. **User ownership is never overwritten** — catalog merge only touches metadata, never qty
2. **Transaction safety** — merge runs in SQLite transaction; any error rolls back entirely
3. **Pre-merge backup** — `backupDb()` creates .bak1/.bak2/.bak3 rotation before any merge
4. **Idempotent** — running the same merge twice produces the same result (version check prevents re-runs)
5. **No destructive operations** — merge only inserts new data or updates metadata on existing cards

### Edge cases handled

| Scenario | Behavior |
|----------|----------|
| User has a set the catalog also has | Merge updates card metadata, preserves all qty |
| User manually added cards not in catalog | Cards are untouched (merge only processes catalog cards) |
| Catalog removes a set (discontinued) | User's data is untouched (merge only adds, never deletes) |
| Catalog corrects a player name | Player name updates on existing card, qty preserved |
| Merge fails mid-transaction | SQLite transaction rolls back, user data unchanged |
| App crashes during merge | WAL journal mode + backup ensures recovery |

---

## 6. Anonymous Analytics

### Heartbeat ping

Once per day (max), on app startup:

```json
POST https://script.google.com/macros/s/{YOUR_SHEET_ID}/exec
{
  "app_version": "1.2.0",
  "os": "win32",
  "set_count": 15,
  "card_count": 4200,
  "owned_count": 2800,
  "catalog_version": "2026.02.1",
  "timestamp": "2026-02-20T10:00:00Z"
}
```

**What is NOT sent:** No user ID, no machine fingerprint, no IP logging (Google Sheets webhook doesn't log IPs by default), no file paths, no card names, no personal data.

### User control

Settings page toggle: **"Help improve CardVoice by sharing anonymous usage stats"**
- Default: **ON**
- Stored in `app_meta` table as `analytics_enabled`
- Tooltip: "Sends app version, OS, and card/set counts once per day. No personal data is collected."

### Admin dashboard

A simple `/admin` route (your copy only, gated behind password):
- Your local collection stats
- Link to the Google Sheet for aggregate user stats
- Download counts from GitHub API (`GET /repos/JCHanratty/CardVoice/releases`)

**Files to modify:**
- New file: `server/analytics.js` — heartbeat sender (runs on startup, respects opt-out)
- `server/db.js` — `app_meta` table (shared with catalog and eBay settings)
- `frontend/src/pages/Settings.jsx` — analytics toggle
- New file: `frontend/src/pages/AdminDashboard.jsx` — admin view
- `frontend/src/App.jsx` — add `/admin` route

---

## 7. Launch Requirements & Oversights

### Must-have for launch

| Item | Description | Effort |
|------|-------------|--------|
| **Code signing** | Windows SmartScreen blocks unsigned apps. Options: (a) SSL.com EV cert ~$70/yr, (b) accept "Run anyway" warning and document it in README | Decision needed |
| **First-run onboarding** | 3-step overlay for new users: Welcome → Browse Sets → Start Logging | Small |
| **GitHub README** | Screenshots, feature list, download link, setup guide | Small |
| **License file** | MIT license in repo root | Trivial |
| **Error reporting** | Help menu → "Report a Bug" opens GitHub Issue with pre-filled system info | Small |
| **Remove CardVision code** | Hide "Import from CardVision" for users who don't have CNNSCAN installed | Small |
| **Donation link** | "Support CardVoice" in sidebar footer + Settings page → Buy Me a Coffee | Small |

### CardVision migration cleanup

The "Import from CardVision" button and menu item should be **auto-hidden** when the CardVision database doesn't exist on the user's machine. The endpoint already checks for the file at `%LOCALAPPDATA%/CardVision/CardVision/cardvision.db` and returns a 404 if missing.

**Approach:** Add a quick check on SetManager mount: `GET /api/cardvision-status` returns `{ exists: boolean }`. Only show the import option when `exists === true`.

### Donation link placement

- **Sidebar footer** (below collapse button): small heart icon + "Support" text
- **Settings page**: "Support CardVoice" section with Buy Me a Coffee button
- **About dialog** (Help → About): "Support this project" link

---

## Implementation Priority

1. **Checklist catalog system** (catalog merge, export script, app_meta table)
2. **eBay credentials UI** (Settings inputs, scraper refactor, How To guide)
3. **Update modal** (replace banner with proper modal + restart button)
4. **Data safety verification** (write tests for merge edge cases)
5. **User submissions** (GitHub Issue templates, in-app links)
6. **Analytics** (heartbeat sender, opt-out toggle, admin dashboard)
7. **Launch prep** (README, license, onboarding, donation link, error reporting)
8. **Code signing** (if pursuing)
