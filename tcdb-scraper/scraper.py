#!/usr/bin/env python3
"""
TCDB-to-CardVoice Catalog Scraper
Scrapes baseball card set checklists from tcdb.com and outputs a
CardVoice-compatible SQLite catalog database with thumbnail images.

Usage:
    python scraper.py                    # Full run (or resume from checkpoint)
    python scraper.py --start-year 2025  # Start from specific year
    python scraper.py --dry-run          # Discover sets only, don't scrape details
    python scraper.py --preview          # Scrape one set and show text preview
"""
import os
import sys
import json
import logging
import argparse
from pathlib import Path

from dotenv import load_dotenv

from db_helper import (create_catalog_db, insert_set, insert_card,
                       upsert_insert_type, upsert_parallel,
                       update_set_total, set_catalog_version)
from http_client import TcdbClient
from checkpoint import Checkpoint
from parsers import (parse_set_list_page, parse_set_detail_page,
                     parse_next_page_url, parse_sub_set_list)
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
                logger.warning("Rate limited during discovery -- stopping")
                break

        year -= 1

    return all_sets


def discover_sub_sets(client: TcdbClient, parent_tcdb_id: int,
                      parent_name: str = "") -> list[dict]:
    """Fetch the insert/parallel sub-sets for a parent set via AJAX endpoint.

    Strips the parent set prefix from sub-set names so
    "Bowman - Gold" becomes just "Gold".
    """
    url = f"{TCDB_BASE}/ViewAllExp.cfm?SetID={parent_tcdb_id}"
    try:
        resp = client.get(url)
        sub_sets = parse_sub_set_list(resp.text)
        # Strip parent prefix: "Bowman - Gold" -> "Gold"
        for s in sub_sets:
            s["name"] = _strip_parent_prefix(s["name"], parent_name)
        return sub_sets
    except Exception as e:
        logger.warning(f"Failed to fetch sub-sets for {parent_tcdb_id}: {e}")
        return []


def _strip_parent_prefix(sub_name: str, parent_name: str) -> str:
    """Strip the parent set brand prefix from a sub-set name.

    TCDB names sub-sets like "Bowman - Gold", "Topps - Chrome Prospects".
    We want just "Gold", "Chrome Prospects" for CardVoice.
    """
    if " - " in sub_name:
        # "Bowman - Chrome Prospects Blue Refractor" -> "Chrome Prospects Blue Refractor"
        return sub_name.split(" - ", 1)[1]
    return sub_name


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


def scrape_set_cards(client: TcdbClient, tcdb_id: int, url_slug: str) -> dict:
    """Fetch the checklist page for a set and parse cards.

    Uses /Checklist.cfm which shows ALL cards on one page (unlike
    /ViewSet.cfm which paginates at ~10).
    """
    url = f"{TCDB_BASE}/Checklist.cfm/sid/{tcdb_id}/{url_slug}"
    resp = client.get(url)
    return parse_set_detail_page(resp.text)


def download_image(client: TcdbClient, image_url: str, local_path: Path) -> bool:
    """Download a thumbnail image if it doesn't already exist."""
    if local_path.exists():
        return True
    try:
        full_url = f"{TCDB_BASE}{image_url}" if image_url.startswith("/") else image_url
        img_resp = client.session.get(full_url, timeout=15)
        if img_resp.status_code == 200:
            local_path.write_bytes(img_resp.content)
            return True
        logger.debug(f"Image download failed ({img_resp.status_code}): {full_url}")
    except Exception as e:
        logger.debug(f"Image download error: {e}")
    return False


def scrape_set(client: TcdbClient, conn, set_info: dict,
               download_images: bool = True) -> dict:
    """Scrape a single set: base cards + all sub-sets (inserts/parallels).

    Returns a summary dict for preview/logging.
    """
    tcdb_id = set_info["tcdb_id"]
    year = set_info.get("year", 0)
    name = set_info["name"]
    brand = extract_brand(name)
    url_slug = set_info.get("url_slug", name.replace(" ", "-"))

    logger.info(f"Scraping: {name} (ID: {tcdb_id})")

    # Insert or find the parent set
    try:
        set_id = insert_set(conn, name=name, year=year, brand=brand, sport="Baseball")
    except Exception:
        row = conn.execute("SELECT id FROM card_sets WHERE name = ? AND year = ?",
                           (name, year)).fetchone()
        if row:
            set_id = row[0]
        else:
            logger.error(f"Cannot create or find set: {name}")
            return {"name": name, "cards": 0, "sub_sets": []}

    set_image_dir = IMAGES_DIR / str(tcdb_id)
    if download_images:
        set_image_dir.mkdir(parents=True, exist_ok=True)

    # --- Scrape base cards from Checklist page ---
    result = scrape_set_cards(client, tcdb_id, url_slug)
    total_cards = _process_cards(
        client, conn, set_id, tcdb_id, result.get("cards", []),
        insert_type="Base", set_image_dir=set_image_dir,
        download_images=download_images,
    )

    if result.get("total_cards"):
        update_set_total(conn, set_id)

    # --- Discover sub-sets (inserts & parallels) via AJAX ---
    sub_sets = discover_sub_sets(client, tcdb_id, parent_name=name)
    sub_set_summaries = []

    for sub in sub_sets:
        sub_tcdb_id = sub["tcdb_id"]
        sub_name = sub["name"]
        sub_slug = sub.get("url_slug", "")

        # Classify as insert or parallel based on naming
        is_parallel = _is_parallel(sub_name)

        if is_parallel:
            upsert_parallel(conn, set_id=set_id, name=sub_name)
        else:
            upsert_insert_type(conn, set_id=set_id, name=sub_name)

        # Scrape the sub-set's cards
        try:
            sub_result = scrape_set_cards(client, sub_tcdb_id, sub_slug)
            sub_cards = sub_result.get("cards", [])

            insert_type = "Base" if is_parallel else sub_name
            parallel = sub_name if is_parallel else ""

            sub_count = _process_cards(
                client, conn, set_id, sub_tcdb_id, sub_cards,
                insert_type=insert_type, parallel=parallel,
                set_image_dir=set_image_dir,
                download_images=download_images,
            )

            sub_set_summaries.append({
                "name": sub_name,
                "type": "parallel" if is_parallel else "insert",
                "cards": sub_count,
            })
            total_cards += sub_count
        except Exception as e:
            logger.error(f"  Failed to scrape sub-set {sub_name}: {e}")
            sub_set_summaries.append({"name": sub_name, "cards": 0, "error": str(e)})

    update_set_total(conn, set_id)
    logger.info(f"  Done: {total_cards} total cards ({len(sub_set_summaries)} sub-sets)")

    return {
        "name": name,
        "year": year,
        "brand": brand,
        "base_cards": result.get("total_cards") or len(result.get("cards", [])),
        "total_cards": total_cards,
        "sub_sets": sub_set_summaries,
    }


def _process_cards(client, conn, set_id, tcdb_id, cards,
                   insert_type="Base", parallel="",
                   set_image_dir=None, download_images=True) -> int:
    """Insert cards into DB and optionally download images. Returns count added."""
    count = 0
    for card in cards:
        image_path = ""
        image_url = card.get("image_url", "")

        if image_url and download_images and set_image_dir:
            ext = os.path.splitext(image_url.split("?")[0])[1] or ".jpg"
            safe_num = card["card_number"].replace("/", "_").replace("\\", "_")
            image_filename = f"{safe_num}{ext}"
            local_path = set_image_dir / image_filename
            image_path = f"images/{tcdb_id}/{image_filename}"

            if not download_image(client, image_url, local_path):
                image_path = ""

        rc_sp = card.get("rc_sp", [])
        if isinstance(rc_sp, list):
            rc_sp = ",".join(rc_sp)

        card_id = insert_card(
            conn, set_id=set_id,
            card_number=card["card_number"],
            player=card["player"],
            team=card.get("team", ""),
            rc_sp=rc_sp,
            insert_type=insert_type,
            parallel=parallel,
            image_path=image_path,
        )
        if card_id:
            count += 1
    return count


# Common parallel keywords — if the sub-set name contains these, it's a parallel
_PARALLEL_KEYWORDS = [
    "refractor", "foil", "pattern", "gold", "silver",
    "red", "blue", "green", "purple", "orange", "pink", "black",
    "white", "yellow", "fuchsia", "burgundy", "navy", "aqua",
    "neon green", "sky blue", "rose gold",
    "superfractor", "printing plate", "shimmer", "wave",
    "holo", "prizm", "mojo", "x-fractor", "firefractor",
    "/99", "/50", "/25", "/10", "/5", "/1",
    "numbered", "serial", "mini diamond", "image variation",
    "speckle", "lava", "reptilian", "gumball", "peanuts",
    "sunflower", "popcorn", "steel metal", "raywave",
    "geometric", "platinum",
]


def _is_parallel(name: str) -> bool:
    """Heuristic: is this sub-set name a parallel (vs an insert)?

    Trading card parallels are color/material variants of a base or insert set.
    Inserts are distinct card sets (e.g., "Anime", "Scouts Top 100").
    """
    lower = name.lower()
    # Strip the parent prefix (e.g., "Bowman - " -> check the rest)
    if " - " in lower:
        lower = lower.split(" - ", 1)[1]

    return any(kw in lower for kw in _PARALLEL_KEYWORDS)


def list_sets_json(client: TcdbClient, year: int,
                    sport: str = "Baseball") -> list[dict]:
    """Fetch available sets for a year and return a JSON-serializable list.

    Each dict contains: tcdb_id, name, url_slug, card_count, year.
    """
    url = f"{TCDB_BASE}/ViewAll.cfm/sp/{sport}/year/{year}"
    resp = client.get(url)
    sets = parse_set_list_page(resp.text)
    for s in sets:
        s["year"] = year
    return sets


def preview_set_json(client: TcdbClient, set_info: dict) -> dict:
    """Scrape one set and return a structured, JSON-serializable dict.

    Returns a dict with: tcdb_id, name, year, brand, base_cards,
    total_cards, parallels, inserts.
    """
    tcdb_id = set_info["tcdb_id"]
    name = set_info["name"]
    url_slug = set_info.get("url_slug", name.replace(" ", "-"))
    year = set_info.get("year", 0)
    brand = extract_brand(name)

    # Scrape base cards from Checklist page
    result = scrape_set_cards(client, tcdb_id, url_slug)
    base_cards = result.get("cards", [])
    total = result.get("total_cards") or len(base_cards)

    # Discover sub-sets (inserts & parallels) via AJAX
    sub_sets = discover_sub_sets(client, tcdb_id, parent_name=name)

    parallels = []
    inserts = []
    for s in sub_sets:
        entry = {"tcdb_id": s["tcdb_id"], "name": s["name"]}
        if _is_parallel(s["name"]):
            parallels.append(entry)
        else:
            inserts.append(entry)

    return {
        "tcdb_id": tcdb_id,
        "name": name,
        "year": year,
        "brand": brand,
        "base_cards": base_cards,
        "total_cards": total,
        "parallels": parallels,
        "inserts": inserts,
    }


def preview_set(client: TcdbClient, set_info: dict) -> str:
    """Scrape one set and return a human-readable text preview."""
    tcdb_id = set_info["tcdb_id"]
    name = set_info["name"]
    url_slug = set_info.get("url_slug", name.replace(" ", "-"))
    year = set_info.get("year", "?")
    brand = extract_brand(name)

    lines = []
    lines.append(f"{'=' * 70}")
    lines.append(f"SET: {name}")
    lines.append(f"Year: {year}  |  Brand: {brand}  |  TCDB ID: {tcdb_id}")
    lines.append(f"{'=' * 70}")

    # Base cards
    result = scrape_set_cards(client, tcdb_id, url_slug)
    base_cards = result.get("cards", [])
    total = result.get("total_cards") or len(base_cards)

    lines.append(f"\nBASE CARDS ({total} cards)")
    lines.append(f"{'-' * 50}")
    lines.append(f"{'#':>5}  {'Player':<30}  {'Team':<25}  Flags")
    lines.append(f"{'-' * 5}  {'-' * 30}  {'-' * 25}  {'-' * 5}")

    for c in base_cards:
        flags = ",".join(c["rc_sp"]) if c["rc_sp"] else ""
        lines.append(f"{c['card_number']:>5}  {c['player']:<30}  {c['team']:<25}  {flags}")

    # Sub-sets
    sub_sets = discover_sub_sets(client, tcdb_id, parent_name=name)

    if sub_sets:
        inserts = [s for s in sub_sets if not _is_parallel(s["name"])]
        parallels = [s for s in sub_sets if _is_parallel(s["name"])]

        if parallels:
            lines.append(f"\nPARALLELS ({len(parallels)} variants)")
            lines.append(f"{'-' * 50}")
            for p in parallels:
                lines.append(f"  - {p['name']}")

        if inserts:
            lines.append(f"\nINSERTS ({len(inserts)} sets)")
            lines.append(f"{'-' * 50}")
            for ins in inserts:
                lines.append(f"  - {ins['name']}")

    lines.append(f"\n{'=' * 70}")
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="TCDB-to-CardVoice Catalog Scraper")
    parser.add_argument("--start-year", type=int, default=START_YEAR,
                        help=f"Year to start scraping from (default: {START_YEAR})")
    parser.add_argument("--dry-run", action="store_true",
                        help="Discover sets only, don't scrape details")
    parser.add_argument("--preview", nargs="?", const="auto", metavar="SET_ID",
                        help="Preview one set as text (auto picks first, or pass a set ID)")
    parser.add_argument("--no-images", action="store_true",
                        help="Skip downloading thumbnail images")
    parser.add_argument("--json", action="store_true",
                        help="Output results as JSON (for API integration)")
    parser.add_argument("--list", action="store_true",
                        help="List available sets for a year")
    parser.add_argument("--set-id", type=int, default=None,
                        help="TCDB set ID to operate on")
    parser.add_argument("--year", type=int, default=START_YEAR,
                        help=f"Year for --list mode (default: {START_YEAR})")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    client = TcdbClient()

    # --- List mode: show available sets for a year ---
    if args.list:
        sets = list_sets_json(client, year=args.year)
        if args.json:
            print(json.dumps(sets, indent=2))
        else:
            # Text table output
            print(f"{'ID':>8}  {'Name':<50}  {'Cards':>6}")
            print(f"{'-' * 8}  {'-' * 50}  {'-' * 6}")
            for s in sets:
                cc = s.get("card_count") or ""
                print(f"{s['tcdb_id']:>8}  {s['name']:<50}  {str(cc):>6}")
            print(f"\n{len(sets)} sets found for {args.year}")
        return

    # --- Preview + JSON mode: structured JSON output ---
    if args.preview is not None and args.json:
        set_id = args.set_id
        if args.preview != "auto":
            set_id = int(args.preview)

        if set_id:
            # Fetch set info from the page to get name/slug
            resp = client.get(f"{TCDB_BASE}/ViewSet.cfm/sid/{set_id}")
            detail = parse_set_detail_page(resp.text)
            raw_title = detail.get("title", "")
            set_name = raw_title.split(" - Trading Card")[0].replace(" Baseball", "").strip()
            if not set_name:
                set_name = f"Set-{set_id}"
            slug = set_name.replace(" ", "-")
            info = {"tcdb_id": set_id, "name": set_name, "url_slug": slug, "year": args.year}
        else:
            # Auto: discover one year and pick first set
            url = f"{TCDB_BASE}/ViewAll.cfm/sp/Baseball/year/{args.year}"
            resp = client.get(url)
            sets = parse_set_list_page(resp.text)
            if not sets:
                print(json.dumps({"error": "No sets found"}))
                return
            info = sets[0]
            info["year"] = args.year

        result = preview_set_json(client, info)
        print(json.dumps(result, indent=2))
        return

    cp = Checkpoint(CHECKPOINT_PATH)

    # --- Preview mode (text) ---
    if args.preview is not None:
        # Determine set ID: --preview <id> takes precedence, then --set-id, then auto
        sid = None
        if args.preview != "auto":
            sid = int(args.preview)
        elif args.set_id:
            sid = args.set_id

        if sid:
            # User specified a set ID — fetch the real page to get name/slug
            logger.info(f"Fetching set info for ID {sid}...")
            resp = client.get(f"{TCDB_BASE}/ViewSet.cfm/sid/{sid}")
            detail = parse_set_detail_page(resp.text)
            # Extract name from title (e.g., "2025 Bowman Baseball - Trading Card Database")
            raw_title = detail.get("title", "")
            set_name = raw_title.split(" - Trading Card")[0].replace(" Baseball", "").strip()
            if not set_name:
                set_name = f"Set-{sid}"
            # Build URL slug from name
            slug = set_name.replace(" ", "-")
            info = {"tcdb_id": sid, "name": set_name, "url_slug": slug, "year": args.year}
        else:
            # Auto: discover one year and pick first set
            url = f"{TCDB_BASE}/ViewAll.cfm/sp/Baseball/year/{args.start_year}"
            logger.info(f"Discovering sets for preview ({args.start_year})...")
            resp = client.get(url)
            sets = parse_set_list_page(resp.text)
            if not sets:
                logger.error("No sets found")
                return
            info = sets[0]
            info["year"] = args.start_year

        report = preview_set(client, info)
        print(report)

        # Save to file
        preview_path = OUTPUT_DIR / "preview.txt"
        with open(preview_path, "w", encoding="utf-8") as f:
            f.write(report)
        logger.info(f"Preview saved to {preview_path}")
        return

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
        logger.info("Dry run -- stopping after discovery")
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
            scrape_set(client, conn, set_info,
                       download_images=not args.no_images)
            cp.mark_set_done(tcdb_id)
            done_count += 1
        except KeyboardInterrupt:
            logger.info("Interrupted -- progress saved to checkpoint")
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
