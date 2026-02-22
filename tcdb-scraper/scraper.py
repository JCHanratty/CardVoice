#!/usr/bin/env python3
"""
TCDB-to-CardVoice Catalog Scraper
Scrapes baseball card set checklists from tcdb.com and outputs a
CardVoice-compatible SQLite catalog database with thumbnail images.

Usage:
    python scraper.py                    # Full run (or resume from checkpoint)
    python scraper.py --start-year 2025  # Start from specific year
    python scraper.py --dry-run          # Discover sets only, don't scrape details
"""
import os
import sys
import json
import time
import logging
import argparse
import random
from pathlib import Path

from dotenv import load_dotenv

from db_helper import (create_catalog_db, insert_set, insert_card,
                       upsert_insert_type, upsert_parallel,
                       update_set_total, set_catalog_version)
from http_client import TcdbClient
from checkpoint import Checkpoint
from parsers import parse_set_list_page, parse_set_detail_page, parse_next_page_url, parse_set_id_from_url
from utils import extract_brand

load_dotenv()

# --- Config ---
OUTPUT_DIR = Path("output")
DB_PATH = OUTPUT_DIR / "tcdb-catalog.db"
IMAGES_DIR = OUTPUT_DIR / "images"
CHECKPOINT_PATH = "checkpoint.json"
MY_SETS_PATH = "my_sets.json"
TCDB_BASE = "https://www.tcdb.com"
START_YEAR = 2026
END_YEAR = 1900  # Go all the way back

# --- Logging ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("scraper.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


def discover_sets(client: TcdbClient, start_year: int) -> list[dict]:
    """Phase 1: Discover all baseball sets from start_year downward."""
    all_sets = []
    year = start_year

    while year >= END_YEAR:
        url = f"{TCDB_BASE}/ViewAll.cfm/sp/Baseball/year/{year}"
        logger.info(f"Discovering sets for {year}...")

        try:
            resp = client.get(url)
            sets = parse_set_list_page(resp.text)
            if not sets:
                logger.info(f"No sets found for {year}, stopping discovery")
                break
            for s in sets:
                s["year"] = year
            all_sets.extend(sets)
            logger.info(f"  Found {len(sets)} sets for {year} (total: {len(all_sets)})")
        except Exception as e:
            logger.error(f"Failed to fetch year {year}: {e}")
            if "403" in str(e) or "429" in str(e):
                logger.warning("Rate limited during discovery — stopping")
                break

        year -= 1

    return all_sets


def prioritize_sets(all_sets: list[dict]) -> list[dict]:
    """Sort sets: owned sets first (2026->oldest), then remaining (2026->oldest)."""
    owned_ids = set()
    if os.path.exists(MY_SETS_PATH):
        with open(MY_SETS_PATH) as f:
            my_sets = json.load(f)
            owned_ids = {s["tcdb_id"] for s in my_sets}
        logger.info(f"Loaded {len(owned_ids)} owned set IDs for prioritization")

    owned = [s for s in all_sets if s["tcdb_id"] in owned_ids]
    others = [s for s in all_sets if s["tcdb_id"] not in owned_ids]

    owned.sort(key=lambda s: -s.get("year", 0))
    others.sort(key=lambda s: -s.get("year", 0))

    return owned + others


def scrape_set(client: TcdbClient, conn, set_info: dict) -> int:
    """Scrape a single set's cards, inserts, parallels, and images. Returns count of cards added."""
    tcdb_id = set_info["tcdb_id"]
    year = set_info.get("year", 0)
    name = set_info["name"]
    brand = extract_brand(name)

    logger.info(f"Scraping: {name} (ID: {tcdb_id})")

    try:
        set_id = insert_set(conn, name=name, year=year, brand=brand, sport="Baseball")
    except Exception:
        row = conn.execute("SELECT id FROM card_sets WHERE name = ? AND year = ?",
                           (name, year)).fetchone()
        if row:
            set_id = row[0]
        else:
            logger.error(f"Cannot create or find set: {name}")
            return 0

    set_image_dir = IMAGES_DIR / str(tcdb_id)
    set_image_dir.mkdir(parents=True, exist_ok=True)

    url = f"{TCDB_BASE}/ViewSet.cfm/sid/{tcdb_id}"
    total_cards_added = 0
    page_num = 1

    while url:
        try:
            resp = client.get(url)
        except Exception as e:
            logger.error(f"Failed to fetch set page {url}: {e}")
            break

        result = parse_set_detail_page(resp.text)

        for section in result.get("insert_sections", []):
            upsert_insert_type(conn, set_id=set_id, name=section["name"],
                               card_count=section.get("card_count", 0),
                               odds=section.get("odds", ""))

        for parallel in result.get("parallels", []):
            upsert_parallel(conn, set_id=set_id, name=parallel["name"],
                            print_run=parallel.get("print_run"),
                            exclusive=parallel.get("exclusive", ""))

        for card in result.get("cards", []):
            image_path = ""
            image_url = card.get("image_url", "")

            if image_url:
                ext = os.path.splitext(image_url)[1] or ".jpg"
                safe_num = card["card_number"].replace("/", "_").replace("\\", "_")
                image_filename = f"{safe_num}{ext}"
                local_path = set_image_dir / image_filename
                image_path = f"images/{tcdb_id}/{image_filename}"

                if not local_path.exists():
                    try:
                        img_resp = client.session.get(image_url, timeout=15)
                        if img_resp.status_code == 200:
                            local_path.write_bytes(img_resp.content)
                        else:
                            image_path = ""
                            logger.debug(f"Image download failed ({img_resp.status_code}): {image_url}")
                    except Exception as e:
                        image_path = ""
                        logger.debug(f"Image download error: {e}")

            card_id = insert_card(
                conn, set_id=set_id,
                card_number=card["card_number"],
                player=card["player"],
                team=card.get("team", ""),
                rc_sp=card.get("rc_sp", ""),
                insert_type=card.get("insert_type", "Base"),
                parallel="",
                image_path=image_path,
            )
            if card_id:
                total_cards_added += 1

        next_url = parse_next_page_url(resp.text)
        if next_url:
            url = f"{TCDB_BASE}{next_url}" if next_url.startswith("/") else next_url
            page_num += 1
            logger.debug(f"  Page {page_num}...")
        else:
            url = None

    update_set_total(conn, set_id)
    logger.info(f"  Done: {total_cards_added} cards added")
    return total_cards_added


def main():
    parser = argparse.ArgumentParser(description="TCDB-to-CardVoice Catalog Scraper")
    parser.add_argument("--start-year", type=int, default=START_YEAR,
                        help=f"Year to start scraping from (default: {START_YEAR})")
    parser.add_argument("--dry-run", action="store_true",
                        help="Discover sets only, don't scrape details")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    client = TcdbClient()
    cp = Checkpoint(CHECKPOINT_PATH)
    conn = create_catalog_db(str(DB_PATH))

    if cp.get_sets():
        all_sets = cp.get_sets()
        logger.info(f"Resuming with {len(all_sets)} sets from checkpoint")
    else:
        logger.info("Phase 1: Discovering sets...")
        all_sets = discover_sets(client, args.start_year)
        cp.save_sets(all_sets)
        logger.info(f"Discovered {len(all_sets)} total sets")

    if args.dry_run:
        logger.info("Dry run — stopping after discovery")
        conn.close()
        return

    ordered_sets = prioritize_sets(all_sets)
    done_count = sum(1 for s in ordered_sets if cp.is_set_done(s["tcdb_id"]))
    total_count = len(ordered_sets)

    logger.info(f"Phase 2: Scraping sets ({done_count}/{total_count} already done)")

    for i, set_info in enumerate(ordered_sets):
        tcdb_id = set_info["tcdb_id"]
        if cp.is_set_done(tcdb_id):
            continue

        progress = f"[{done_count + 1}/{total_count}]"
        logger.info(f"{progress} {set_info['name']} ({set_info.get('year', '?')})")

        try:
            scrape_set(client, conn, set_info)
            cp.mark_set_done(tcdb_id)
            done_count += 1
        except KeyboardInterrupt:
            logger.info("Interrupted — progress saved to checkpoint")
            break
        except Exception as e:
            logger.error(f"Failed to scrape set {set_info['name']}: {e}")

    from datetime import date
    version = date.today().strftime("%Y.%m.1")
    set_catalog_version(conn, version)

    conn.close()
    logger.info(f"Done! Catalog saved to {DB_PATH} ({done_count}/{total_count} sets)")


if __name__ == "__main__":
    main()
