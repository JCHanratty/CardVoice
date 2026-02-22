#!/usr/bin/env python3
"""
TCDB Collection Migrator
Logs into TCDB, reads your collection, and generates data for CardVoice import.

Usage:
    python migrator.py --discover     # Find which sets you own, save to my_sets.json
    python migrator.py --migrate      # Full migration: read all owned cards, output qty_updates.json
"""
import os
import sys
import json
import logging
import argparse

from dotenv import load_dotenv

from http_client import TcdbClient
from parsers import parse_collection_sets, parse_collection_cards, parse_set_id_from_url

load_dotenv()

TCDB_BASE = "https://www.tcdb.com"
MY_SETS_PATH = "my_sets.json"
QTY_UPDATES_PATH = "qty_updates.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("migrator.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


def login(client: TcdbClient) -> bool:
    """Login to TCDB using .env credentials."""
    username = os.getenv("TCDB_USER")
    password = os.getenv("TCDB_PASS")
    if not username or not password:
        logger.error("TCDB_USER and TCDB_PASS must be set in .env file")
        return False
    return client.login(username, password)


def discover_owned_sets(client: TcdbClient, username: str) -> list[dict]:
    """Discover all sets the user has cards in."""
    url = f"{TCDB_BASE}/Collection.cfm/{username}/Baseball"
    logger.info(f"Fetching collection page: {url}")

    all_sets = []
    page = 1

    while url:
        try:
            resp = client.get(url)
            sets = parse_collection_sets(resp.text)
            if not sets:
                break
            all_sets.extend(sets)
            logger.info(f"  Page {page}: found {len(sets)} sets (total: {len(all_sets)})")

            from parsers import parse_next_page_url
            next_url = parse_next_page_url(resp.text)
            if next_url:
                url = f"{TCDB_BASE}{next_url}" if next_url.startswith("/") else next_url
                page += 1
            else:
                url = None
        except Exception as e:
            logger.error(f"Failed to fetch collection page: {e}")
            break

    return all_sets


def migrate_collection(client: TcdbClient, username: str) -> list[dict]:
    """Read all owned cards and generate qty updates."""
    if not os.path.exists(MY_SETS_PATH):
        logger.error(f"{MY_SETS_PATH} not found — run --discover first")
        return []

    with open(MY_SETS_PATH) as f:
        my_sets = json.load(f)

    all_updates = []
    total = len(my_sets)

    for i, set_info in enumerate(my_sets):
        tcdb_id = set_info["tcdb_id"]
        name = set_info.get("name", f"Set {tcdb_id}")
        logger.info(f"[{i + 1}/{total}] Reading collection for: {name}")

        url = f"{TCDB_BASE}/Collection.cfm/{username}/Baseball/{tcdb_id}"

        try:
            resp = client.get(url)
            cards = parse_collection_cards(resp.text)
            for card in cards:
                card["tcdb_set_id"] = tcdb_id
                card["set_name"] = name
            all_updates.extend(cards)
            logger.info(f"  Found {len(cards)} cards")
        except Exception as e:
            logger.error(f"  Failed: {e}")

    return all_updates


def main():
    parser = argparse.ArgumentParser(description="TCDB Collection Migrator")
    parser.add_argument("--discover", action="store_true",
                        help="Discover owned sets, save to my_sets.json")
    parser.add_argument("--migrate", action="store_true",
                        help="Full migration: read all owned cards")
    args = parser.parse_args()

    if not args.discover and not args.migrate:
        parser.print_help()
        return

    username = os.getenv("TCDB_USER")
    if not username:
        logger.error("TCDB_USER must be set in .env file")
        sys.exit(1)

    client = TcdbClient()

    if not login(client):
        sys.exit(1)

    if args.discover:
        logger.info("Mode: Discover owned sets")
        sets = discover_owned_sets(client, username)
        with open(MY_SETS_PATH, "w") as f:
            json.dump(sets, f, indent=2)
        logger.info(f"Saved {len(sets)} owned sets to {MY_SETS_PATH}")

    if args.migrate:
        logger.info("Mode: Full collection migration")
        updates = migrate_collection(client, username)
        with open(QTY_UPDATES_PATH, "w") as f:
            json.dump(updates, f, indent=2)
        logger.info(f"Saved {len(updates)} card updates to {QTY_UPDATES_PATH}")


if __name__ == "__main__":
    main()
