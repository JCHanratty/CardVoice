#!/usr/bin/env python3
"""
Browser-based TCDB collection scraper using undetected-chromedriver.

Uses a real Chrome browser with anti-detection patches to bypass Cloudflare.
The user logs in manually, then the scraper automates page collection.

Usage:
    python browser_scraper.py --member Jhanratty --json
    python browser_scraper.py --member Jhanratty --json --output-dir output
"""
import json
import sys
import re
import time
import logging
import argparse
from pathlib import Path
from collections import defaultdict

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s",
                    handlers=[logging.StreamHandler(sys.stderr)])
logger = logging.getLogger(__name__)

TCDB_BASE = "https://www.tcdb.com"


def parse_collection_rows(driver):
    """Extract cards from current page using page_source + regex (much faster than Selenium DOM)."""
    from bs4 import BeautifulSoup

    html = driver.page_source
    soup = BeautifulSoup(html, "html.parser")
    cards = []

    # Find all links to ViewCard.cfm
    for link in soup.find_all("a", href=re.compile(r"ViewCard\.cfm/sid/\d+/cid/\d+")):
        href = link.get("href", "")
        m = re.search(r"/ViewCard\.cfm/sid/(\d+)/cid/(\d+)", href)
        if not m:
            continue

        tcdb_set_id = int(m.group(1))
        tcdb_card_id = int(m.group(2))
        card_number = link.get_text(strip=True)

        # Walk up to the row (tr) to find qty and player
        row = link.find_parent("tr")
        if not row:
            continue

        tds = row.find_all("td")

        # Qty from badge in first td
        qty = 1
        if tds:
            badge = tds[0].find("span", class_="badge")
            if badge:
                try:
                    qty = int(badge.get_text(strip=True))
                except ValueError:
                    qty = 1

        # Player name — typically in td[4] or last meaningful td
        player = ""
        rc_sp = ""
        # Find the td that contains a link to ViewPerson or Person
        for td in tds[3:]:
            person_link = td.find("a", href=re.compile(r"(ViewPerson|Person|Members)"))
            if person_link:
                player = person_link.get_text(strip=True)
                full_text = td.get_text(strip=True)
                if player and len(full_text) > len(player):
                    rc_sp = full_text[len(player):].strip()
                break

        # Fallback: if no person link found, try td[4] text
        if not player and len(tds) > 4:
            player = tds[4].get_text(strip=True)

        if card_number or player:
            cards.append({
                "card_number": card_number, "player": player, "qty": qty,
                "rc_sp": rc_sp, "tcdb_set_id": tcdb_set_id, "tcdb_card_id": tcdb_card_id,
            })

    return cards


def resolve_set_name(driver, sid):
    """Get the canonical set name by visiting the set page."""
    driver.get(f"{TCDB_BASE}/ViewSet.cfm/sid/{sid}")
    time.sleep(2)
    title = driver.title or ""
    set_name = re.sub(r'\s*-\s*Trading Card.*$', '', title).strip()
    set_name = re.sub(r'\s*Baseball\s*$', '', set_name).strip()
    if not set_name:
        set_name = f"Set-{sid}"
    year_match = re.match(r"(\d{4})\s+", set_name)
    year = int(year_match.group(1)) if year_match else 0
    return {"name": set_name, "year": year}


def main():
    parser = argparse.ArgumentParser(description="TCDB Browser Collection Scraper")
    parser.add_argument("--member", required=True, help="TCDB member username")
    parser.add_argument("--json", action="store_true", help="Output JSON to stdout")
    parser.add_argument("--output-dir", type=str, default="output", help="Output directory")
    parser.add_argument("--max-pages", type=int, default=200, help="Max pages to scrape")
    args = parser.parse_args()

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # Checkpoint
    checkpoint_path = output_dir / "browser_checkpoint.json"
    checkpoint = {"completed_pages": [], "cards": [], "set_ids": {}}
    if checkpoint_path.exists():
        try:
            checkpoint = json.loads(checkpoint_path.read_text())
            logger.info(f"Resumed: {len(checkpoint['completed_pages'])} pages, {len(checkpoint['cards'])} cards")
        except Exception:
            pass

    try:
        import undetected_chromedriver as uc
    except ImportError:
        logger.error("undetected-chromedriver not installed. Run: pip install undetected-chromedriver")
        sys.exit(1)

    logger.info("Launching Chrome (undetected)...")
    options = uc.ChromeOptions()
    options.add_argument("--no-first-run")
    options.add_argument("--no-default-browser-check")

    driver = uc.Chrome(options=options)
    driver.implicitly_wait(5)

    try:
        # Navigate to TCDB and let user log in
        logger.info("Opening TCDB... Log in if prompted.")
        driver.get(f"{TCDB_BASE}/Login.cfm")
        time.sleep(3)

        # Check if already logged in by trying to access collection
        collection_url = (
            f"{TCDB_BASE}/ViewCollectionMode.cfm?"
            f"Filter=G&Member={args.member}&MODE=&Type=Baseball&CollectionID=1&Records=10000&PageIndex=1"
        )
        driver.get(collection_url)
        time.sleep(3)

        # Check if we got redirected to login or profile (not the collection page)
        page_source = driver.page_source
        if "ViewCard.cfm" not in page_source:
            logger.info("Not logged in. Please log into TCDB in the Chrome window...")
            logger.info("(You have up to 10 minutes to log in)")
            driver.get(f"{TCDB_BASE}/Login.cfm")
            # Wait for user to log in (up to 10 minutes)
            logged_in = False
            for i in range(600):
                time.sleep(1)
                current = driver.current_url
                # User logged in when they leave the login page
                if "Login.cfm" not in current:
                    logger.info(f"Login detected! Navigated to: {current}")
                    logged_in = True
                    break
                if i > 0 and i % 30 == 0:
                    logger.info(f"Still waiting for login... ({i}s elapsed)")

            if not logged_in:
                logger.error("Login timed out after 10 minutes.")
                driver.quit()
                sys.exit(1)

            # Give TCDB a moment to settle, then navigate to collection
            time.sleep(3)
            logger.info("Navigating to collection page...")
            driver.get(collection_url)
            time.sleep(5)

            # Verify we can see the collection
            page_source = driver.page_source
            if "ViewCard.cfm" not in page_source:
                # Maybe redirected to profile — try the collection URL once more
                logger.info("Retrying collection page...")
                driver.get(collection_url)
                time.sleep(5)
                page_source = driver.page_source

        if "ViewCard.cfm" not in page_source:
            logger.error("Could not access collection page after login.")
            logger.info("Current URL: " + driver.current_url)
            logger.info("Page title: " + driver.title)
            driver.quit()
            sys.exit(1)

        logger.info("Collection page loaded! Starting scrape...")

        # Parse first page to count cards
        first_cards = parse_collection_rows(driver)
        all_cards = list(checkpoint.get("cards", []))

        if 1 not in checkpoint["completed_pages"]:
            all_cards.extend(first_cards)
            checkpoint["completed_pages"].append(1)
            checkpoint["cards"] = all_cards
            checkpoint_path.write_text(json.dumps(checkpoint))
            logger.info(f"Page 1: {len(first_cards)} cards (total: {len(all_cards)})")

        # Determine total pages from pagination links
        total_pages = 1
        page_links = re.findall(r'PageIndex=(\d+)', page_source)
        if page_links:
            total_pages = max(int(p) for p in page_links)
        total_pages = min(total_pages, args.max_pages)
        logger.info(f"Total pages: {total_pages}")

        # Scrape remaining pages
        for page_num in range(2, total_pages + 1):
            if page_num in checkpoint["completed_pages"]:
                logger.info(f"Page {page_num}/{total_pages}: skipping (done)")
                continue

            url = (
                f"{TCDB_BASE}/ViewCollectionMode.cfm?"
                f"Filter=G&Member={args.member}&MODE=&Type=Baseball&CollectionID=1&Records=10000&PageIndex={page_num}"
            )
            logger.info(f"Page {page_num}/{total_pages}: loading...")
            driver.get(url)
            time.sleep(3)

            cards = parse_collection_rows(driver)
            all_cards.extend(cards)
            checkpoint["completed_pages"].append(page_num)
            checkpoint["cards"] = all_cards
            checkpoint_path.write_text(json.dumps(checkpoint))

            logger.info(f"Page {page_num}/{total_pages}: {len(cards)} cards (total: {len(all_cards)})")

            if page_num < total_pages:
                time.sleep(2)  # Small delay between pages

        logger.info(f"Scraping done: {len(all_cards)} cards total")

        # Resolve set names
        unique_sids = {c["tcdb_set_id"] for c in all_cards}
        logger.info(f"Resolving {len(unique_sids)} set names...")

        set_info = checkpoint.get("set_ids", {})
        for i, sid in enumerate(sorted(unique_sids)):
            if str(sid) in set_info:
                continue
            info = resolve_set_name(driver, sid)
            set_info[str(sid)] = info
            checkpoint["set_ids"] = set_info
            checkpoint_path.write_text(json.dumps(checkpoint))
            logger.info(f"  [{i+1}/{len(unique_sids)}] sid={sid} -> {info['name']}")
            time.sleep(1.5)

        # Group by set
        groups = defaultdict(list)
        for card in all_cards:
            groups[card["tcdb_set_id"]].append(card)

        sets = []
        for sid, cards in groups.items():
            info = set_info.get(str(sid), {"name": f"Set-{sid}", "year": 0})
            sets.append({
                "tcdb_set_id": sid, "set_name": info["name"], "year": info["year"],
                "card_count": len(cards), "cards": cards,
            })
        sets.sort(key=lambda s: (-s["year"], s["set_name"]))

        result = {"total_cards": len(all_cards), "total_sets": len(sets), "sets": sets}

        # Save to file
        out_path = output_dir / "collection-import.json"
        out_path.write_text(json.dumps(result, indent=2))
        logger.info(f"Saved to {out_path}")

        # Output JSON to stdout for the import service
        if args.json:
            print(json.dumps(result))

    finally:
        driver.quit()
        logger.info("Browser closed.")


if __name__ == "__main__":
    main()
