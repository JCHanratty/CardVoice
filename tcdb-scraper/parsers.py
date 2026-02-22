"""
HTML page parsers for TCDB (Trading Card Database) scraper.

Best-effort parsers that extract structured data from TCDB HTML pages
using BeautifulSoup. Key URL patterns and selectors:
  - Set links:    a[href*="/ViewSet.cfm/sid/"]
  - Cards table:  table rows with card data
  - Images:       img[data-original] (lazy-loaded src)
  - Card count:   text like "(150 cards)" next to set names
"""

from __future__ import annotations

import re
from typing import Optional

from bs4 import BeautifulSoup, Tag


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------

_SET_ID_RE = re.compile(r"/ViewSet\.cfm/sid/(\d+)")


def parse_set_id_from_url(url: str) -> Optional[int]:
    """Extract the numeric set ID from a TCDB ViewSet URL.

    Example:
        >>> parse_set_id_from_url("/ViewSet.cfm/sid/482758/2025-Topps-Series-1")
        482758
    """
    m = _SET_ID_RE.search(url)
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------------------
# Set list page  (e.g. Browse Sets page)
# ---------------------------------------------------------------------------

_CARD_COUNT_RE = re.compile(r"\((\d+)\s+cards?\)", re.IGNORECASE)


def parse_set_list_page(html: str) -> list[dict]:
    """Parse a page that lists sets, returning one dict per set.

    Each dict contains:
        tcdb_id   (int)   – numeric set identifier
        name      (str)   – display name of the set
        url_slug  (str)   – the URL path portion after /sid/<id>/
        card_count (int|None) – number of cards if listed
    """
    soup = BeautifulSoup(html, "html.parser")
    results: list[dict] = []

    for anchor in soup.find_all("a", href=_SET_ID_RE):
        href = anchor["href"]
        sid_match = _SET_ID_RE.search(href)
        if not sid_match:
            continue

        tcdb_id = int(sid_match.group(1))
        name = anchor.get_text(strip=True)

        # url_slug is everything after /sid/<id>/
        slug_start = href.find(f"/sid/{tcdb_id}/")
        if slug_start != -1:
            url_slug = href[slug_start + len(f"/sid/{tcdb_id}/"):]
        else:
            url_slug = ""

        # Look for "(NNN cards)" in the surrounding text
        card_count: Optional[int] = None
        parent = anchor.parent
        if parent:
            parent_text = parent.get_text()
            cc_match = _CARD_COUNT_RE.search(parent_text)
            if cc_match:
                card_count = int(cc_match.group(1))

        results.append(
            {
                "tcdb_id": tcdb_id,
                "name": name,
                "url_slug": url_slug,
                "card_count": card_count,
            }
        )

    return results


# ---------------------------------------------------------------------------
# Set detail page  (e.g. ViewSet.cfm/sid/XXXXX)
# ---------------------------------------------------------------------------


def parse_set_detail_page(html: str) -> dict:
    """Parse a set detail page that shows individual cards.

    Returns a dict with:
        title         (str)
        total_cards   (int|None)
        cards         (list[dict])   – each has card_number, player, team,
                                        image_url, rc_sp
        insert_sections (list[dict]) – best-effort
        parallels       (list[dict]) – best-effort
    """
    soup = BeautifulSoup(html, "html.parser")

    # --- title ---
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else ""

    # --- total cards ---
    total_cards: Optional[int] = None
    total_label = soup.find(string=re.compile(r"Total\s+Cards:", re.I))
    if total_label:
        # The number usually follows in a <strong> or plain text
        parent = total_label.parent if total_label.parent else total_label
        num_match = re.search(r"Total\s+Cards:\s*(\d+)", parent.get_text(), re.I)
        if num_match:
            total_cards = int(num_match.group(1))

    # --- cards ---
    cards = _parse_card_rows(soup)

    # --- inserts & parallels (best-effort) ---
    insert_sections = _parse_insert_sections(soup)
    parallels = _parse_parallels(soup)

    return {
        "title": title,
        "total_cards": total_cards,
        "cards": cards,
        "insert_sections": insert_sections,
        "parallels": parallels,
    }


def _parse_card_rows(soup: BeautifulSoup) -> list[dict]:
    """Extract card rows from the set detail table."""
    cards: list[dict] = []

    # TCDB typically renders cards in <tr> rows inside tables.
    # We look for rows whose first <td> has valign="top".
    for tr in soup.find_all("tr"):
        tds = tr.find_all("td", valign="top")
        if not tds:
            continue

        # Heuristic: need at least 2 cells (number + player)
        all_tds = tr.find_all("td")
        if len(all_tds) < 2:
            continue

        card_number = all_tds[0].get_text(strip=True)
        player = all_tds[1].get_text(strip=True)
        team = all_tds[2].get_text(strip=True) if len(all_tds) > 2 else ""

        # Image URL – prefer data-original (lazy load)
        image_url: Optional[str] = None
        img_tag = tr.find("img", attrs={"data-original": True})
        if img_tag:
            image_url = img_tag["data-original"]

        # RC / SP flags – look for small text markers
        row_text = tr.get_text()
        rc_sp: list[str] = []
        if re.search(r"\bRC\b", row_text):
            rc_sp.append("RC")
        if re.search(r"\bSP\b", row_text):
            rc_sp.append("SP")

        cards.append(
            {
                "card_number": card_number,
                "player": player,
                "team": team,
                "image_url": image_url,
                "rc_sp": rc_sp,
            }
        )

    return cards


# ---------------------------------------------------------------------------
# Insert sections  (best-effort)
# ---------------------------------------------------------------------------


def _parse_insert_sections(soup: BeautifulSoup) -> list[dict]:
    """Parse insert set sections from a set detail page.

    Returns a list of dicts: [{name, card_count, odds}]
    """
    sections: list[dict] = []

    for header in soup.find_all(string=re.compile(r"Insert", re.I)):
        parent = header.parent if isinstance(header, str) else header
        if not isinstance(parent, Tag):
            continue
        name = parent.get_text(strip=True)

        card_count: Optional[int] = None
        odds: Optional[str] = None

        # Look in surrounding text for counts and odds
        sibling_text = parent.parent.get_text() if parent.parent else ""
        cc_match = re.search(r"(\d+)\s+cards?", sibling_text, re.I)
        if cc_match:
            card_count = int(cc_match.group(1))
        odds_match = re.search(r"(1:\d+)", sibling_text)
        if odds_match:
            odds = odds_match.group(1)

        sections.append({"name": name, "card_count": card_count, "odds": odds})

    return sections


# ---------------------------------------------------------------------------
# Parallels  (best-effort)
# ---------------------------------------------------------------------------


def _parse_parallels(soup: BeautifulSoup) -> list[dict]:
    """Parse parallel information from a set detail page.

    Returns a list of dicts: [{name, print_run, exclusive}]
    """
    parallels: list[dict] = []

    for el in soup.find_all(string=re.compile(r"Parallel", re.I)):
        parent = el.parent if isinstance(el, str) else el
        if not isinstance(parent, Tag):
            continue
        name = parent.get_text(strip=True)

        print_run: Optional[int] = None
        exclusive: Optional[str] = None

        sibling_text = parent.parent.get_text() if parent.parent else ""
        pr_match = re.search(r"#(?:d|/)\s*(\d+)", sibling_text)
        if not pr_match:
            pr_match = re.search(r"(\d+)\s*(?:copies|print run)", sibling_text, re.I)
        if pr_match:
            print_run = int(pr_match.group(1))

        excl_match = re.search(r"(Hobby|Retail|Online)\s+Exclusive", sibling_text, re.I)
        if excl_match:
            exclusive = excl_match.group(1)

        parallels.append(
            {"name": name, "print_run": print_run, "exclusive": exclusive}
        )

    return parallels


# ---------------------------------------------------------------------------
# Pagination
# ---------------------------------------------------------------------------


def parse_next_page_url(html: str) -> Optional[str]:
    """Find the 'Next' pagination link on a page.

    Returns the href string or None if there is no next page.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Look for an anchor whose visible text is "Next" (or "Next >", ">>", etc.)
    for anchor in soup.find_all("a", href=True):
        text = anchor.get_text(strip=True).lower()
        if text in ("next", "next >", "next >>", ">>", ">"):
            return anchor["href"]

    return None


# ---------------------------------------------------------------------------
# Collection pages
# ---------------------------------------------------------------------------


def parse_collection_sets(html: str) -> list[dict]:
    """Parse a user's collection page that lists sets they own cards from.

    Returns a list of dicts: [{tcdb_id, name, owned_count}]
    """
    soup = BeautifulSoup(html, "html.parser")
    results: list[dict] = []

    for anchor in soup.find_all("a", href=_SET_ID_RE):
        href = anchor["href"]
        sid_match = _SET_ID_RE.search(href)
        if not sid_match:
            continue

        tcdb_id = int(sid_match.group(1))
        name = anchor.get_text(strip=True)

        owned_count: Optional[int] = None
        parent = anchor.parent
        if parent:
            num_match = re.search(r"(\d+)", parent.get_text().replace(name, ""))
            if num_match:
                owned_count = int(num_match.group(1))

        results.append(
            {"tcdb_id": tcdb_id, "name": name, "owned_count": owned_count}
        )

    return results


def parse_collection_cards(html: str) -> list[dict]:
    """Parse a collection page that shows individual owned cards.

    Returns a list of dicts: [{card_number, player, team, qty}]
    """
    soup = BeautifulSoup(html, "html.parser")
    cards: list[dict] = []

    for tr in soup.find_all("tr"):
        tds = tr.find_all("td", valign="top")
        if not tds:
            continue

        all_tds = tr.find_all("td")
        if len(all_tds) < 2:
            continue

        card_number = all_tds[0].get_text(strip=True)
        player = all_tds[1].get_text(strip=True)
        team = all_tds[2].get_text(strip=True) if len(all_tds) > 2 else ""

        qty = 1
        if len(all_tds) > 3:
            qty_match = re.search(r"(\d+)", all_tds[3].get_text())
            if qty_match:
                qty = int(qty_match.group(1))

        cards.append(
            {
                "card_number": card_number,
                "player": player,
                "team": team,
                "qty": qty,
            }
        )

    return cards
