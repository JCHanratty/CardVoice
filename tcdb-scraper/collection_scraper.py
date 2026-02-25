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

    def get_set_info(self, tcdb_set_id: int):
        return self._data["set_ids"].get(str(tcdb_set_id))

    def all_pages_done(self) -> list:
        return self._data["completed_pages"]


def scrape_collection(client: TcdbClient, member: str, checkpoint: CollectionCheckpoint,
                      max_pages: int = 200) -> list:
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


def resolve_set_names(client: TcdbClient, cards: list,
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
            raw_title = detail["title"]

            # Clean up the title: remove " - Trading Card Checklist" and similar suffixes
            set_name = re.sub(r'\s*-\s*Trading Card.*$', '', raw_title).strip()
            set_name = re.sub(r'\s*Baseball\s*$', '', set_name).strip()
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


def group_by_set(cards: list, set_info: dict) -> list:
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
