# CardVoice Pricing Pipeline Design

**Date:** 2026-02-16
**Status:** Approved

## Goal

Add collection value tracking to CardVoice: per-set estimated values from eBay sold listings, manually tracked individual card pricing, and a portfolio dashboard showing total collection value over time.

## Pricing Model

Two-tier pricing:

1. **Set Value Estimation** -- Scrape eBay sold listings for complete set / lot listings (e.g., "2024 Topps Chrome complete set") to estimate overall set market value.
2. **Tracked Cards** -- User manually flags specific cards for individual price tracking. Only these cards get individual eBay sold lookups.

This minimizes scraping volume and gives the user control over what's worth watching.

## eBay Scraping Engine

### Query Construction

- **Set queries:** `"{year} {set name} complete set"` and `"{year} {set name} base lot"`
- **Card queries:** `"{year} {set name} #{card number} {player name}"` with parallel name appended when applicable
- Queries stored in `tracked_cards.search_query`, auto-generated but user-editable

### Scraping Implementation

- HTTP client (`node-fetch` or `undici`) with rotating User-Agent strings
- HTML parsing via `cheerio`
- Target URL: eBay completed/sold listings (`LH_Complete=1&LH_Sold=1`)
- Extract: sold price, sale date, listing title, condition

### Resilience

- Selector-based parsing driven by a `scraper-config.json` file -- update one file when eBay changes HTML
- Exponential backoff on failures: 1hr -> 4hr -> 24hr
- Rate limiting: max 1 request per 3 seconds
- All scraped data cached in SQLite permanently

### Outlier Filtering

- Discard "lot" listings (multiple cards) from individual card searches
- Filter by condition (raw vs. graded)
- Use median of last 5-10 sold prices as market price
- Flag prices >3x or <0.3x the median as outliers

## Database Schema

### `tracked_cards`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `card_id` | INTEGER FK | References `cards.id` |
| `search_query` | TEXT | eBay search query (auto-generated, user-editable) |
| `tracked_at` | DATETIME | When tracking was enabled |
| `last_synced` | DATETIME | Last successful price fetch |

### `price_history`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `card_id` | INTEGER FK | Nullable -- for tracked cards |
| `set_id` | INTEGER FK | Nullable -- for set-level prices |
| `price` | REAL | Sold price in USD |
| `sold_date` | DATE | When it sold on eBay |
| `listing_title` | TEXT | eBay listing title |
| `condition` | TEXT | Raw/graded/etc. |
| `fetched_at` | DATETIME | When we scraped this |

### `price_snapshots`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `set_id` | INTEGER FK | Nullable -- per-set snapshot |
| `card_id` | INTEGER FK | Nullable -- per-card snapshot |
| `median_price` | REAL | Median of recent solds |
| `snapshot_date` | DATE | Date of this snapshot |

## Background Sync Service

### Scheduler

- Background timer in Express server, runs every 24 hours (configurable)
- Each cycle: fetch set prices -> fetch tracked card prices -> compute snapshots
- On app startup: if last sync >24hr ago, trigger immediately
- Runs only when the app is open

### Sync Queue

- Sequential processing, one request at a time with ~3s gap
- Queue persists in memory; resumes on next startup if interrupted
- Per-item status: `pending`, `in_progress`, `completed`, `failed`

### Settings

- Configurable sync interval (default: 24 hours)
- Auto-sync on/off toggle
- Manual "Sync Now" button

## UI Changes

### Set Detail Page -- Value Section

- Set estimated market value with sparkline trend chart
- Tracked cards list: current median price, price range, trend arrow, number of recent sales
- Click a tracked card to expand inline panel:
  - Price history table: date, sold price, listing title, condition
  - Clickable eBay links for each sold listing (opens in browser)
  - Mini price-over-time chart
- "Track this card" toggle on every card row
- Last synced timestamp

### Dashboard -- Portfolio Panel

- Total collection value with change since last week/month
- Area chart of total value over time
- Top 5 most valuable tracked cards with current price
- Top 5 sets by estimated value
- Recent price changes feed: tracked cards with significant price movement since last sync

### Card Row Enhancement

- Tracked cards show: price badge, trend indicator, count of recent eBay solds
- Star icon to toggle tracking on/off
- Hover tooltip: "Based on median of N recent sales"

### Settings Page (New)

- Sync frequency control
- Auto-sync on/off toggle
- Manual "Sync Now" trigger
- Sync log: scrollable list of recent sync activity and errors
- Search query editor: view/edit eBay queries for any tracked card

### Price History Page (Per Tracked Card)

- Full table of all scraped sold listings
- Sortable by date, price, condition
- Each row has clickable eBay link
- Price-over-time chart above the table
- Filter by condition (raw / graded)

## Error Handling

### Scraping Failures

- eBay blocks (CAPTCHA, 429): exponential backoff, "Sync stalled" in UI with reason
- HTML structure changes: parser returns empty, UI shows "0 results found -- search query may need updating"
- All failures logged in sync log (visible in Settings)

### No Results Found

- Show "No sales found" rather than $0
- Excluded from portfolio total calculation

### Stale Prices

- Prices older than 30 days get a "stale" indicator
- Portfolio chart still uses them but marks data point as estimated

### Data Integrity

- Deleted tracked card: price history preserved (soft reference), removed from portfolio total
- Set deletion: cascades to tracked cards and price history (with confirmation prompt)

## Technology Additions

- `cheerio` -- HTML parsing for eBay scraping
- `node-fetch` or `undici` -- HTTP client for scraping requests
- A lightweight charting library for the frontend (e.g., `recharts` or `chart.js`)
