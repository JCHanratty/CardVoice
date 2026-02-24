# TCDB Import Progress Modal Design

## Problem

The TCDB import shows a spinner stuck at "0/3" for 5+ minutes with no indication of whether it's working, hung, or errored. No live log, no elapsed time, no cancel button, no error display.

## Goal

Replace the inline progress panel with a modal overlay that shows real-time scraper output, elapsed time, cancel/error/success states.

## Changes

### 1. scraper.py — Ensure logging during --set-id import mode
The single-set import mode should log to stderr (via Python logging) so the Node process can capture it. Verify that logger.info calls fire during scrape_set() and _process_cards().

### 2. tcdb-service.js — Track elapsed time
- Store `startedAt: Date.now()` when import begins
- Include `startedAt` in getStatus() response
- Frontend calculates elapsed time from this

### 3. AdminPage.jsx — Import progress modal
Replace the inline progress section with a modal overlay:
- Set name at top
- Elapsed time counter (recalculated from startedAt each render)
- Phase indicator (Scraping / Merging / Done / Error)
- Live log panel (scrollable, auto-scrolls to bottom)
- Cancel button (calls POST /api/admin/tcdb/cancel)
- Error state: shows error message + Close button
- Success state: shows merge stats + Close button
- Poll interval: 1 second (was 2)

### 4. Cleanup
- Remove the old inline Import Progress section
- The modal opens when import starts, closes when user clicks Close after done/error/cancel
