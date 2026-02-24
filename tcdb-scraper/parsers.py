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
        sub_sets      (list[dict])   – insert/parallel sub-sets linked from page
    """
    soup = BeautifulSoup(html, "html.parser")

    # --- title ---
    title_tag = soup.find("title")
    title = title_tag.get_text(strip=True) if title_tag else ""

    # --- total cards ---
    total_cards: Optional[int] = None
    total_label = soup.find("strong", string=re.compile(r"Total\s+Cards", re.I))
    if total_label:
        # Number is the next text sibling after the <strong>
        for sib in total_label.next_siblings:
            sib_text = sib.get_text(strip=True) if hasattr(sib, "get_text") else str(sib).strip()
            if sib_text:
                num_match = re.search(r"(\d[\d,]*)", sib_text)
                if num_match:
                    total_cards = int(num_match.group(1).replace(",", ""))
                break

    # --- cards ---
    cards = _parse_card_rows(soup)

    # --- sub-sets (inserts & parallels linked from page) ---
    sub_sets = _parse_sub_sets(soup)

    return {
        "title": title,
        "total_cards": total_cards,
        "cards": cards,
        "sub_sets": sub_sets,
    }


_VIEWCARD_RE = re.compile(r"/ViewCard\.cfm/sid/\d+/cid/\d+")
_PERSON_RE = re.compile(r"/Person\.cfm/pid/\d+")
_TEAM_RE = re.compile(r"/Team\.cfm/tid/\d+")


def _parse_card_rows(soup: BeautifulSoup) -> list[dict]:
    """Extract card rows from the set detail or checklist table.

    Card rows are identified by containing a ViewCard link. Key data is
    extracted by anchor patterns rather than column position (since the
    checklist page has many empty spacer cells).
    """
    cards: list[dict] = []

    for tr in soup.find_all("tr"):
        # Card rows must contain a ViewCard link
        viewcard_link = tr.find("a", href=_VIEWCARD_RE)
        if not viewcard_link:
            continue

        # --- Card number: text of the ViewCard anchor ---
        card_number = viewcard_link.get_text(strip=True)
        # Skip if it looks like an image-only link (empty text)
        if not card_number:
            # Try other ViewCard links in the row
            for a in tr.find_all("a", href=_VIEWCARD_RE):
                t = a.get_text(strip=True)
                if t:
                    card_number = t
                    break

        # --- Player name: anchor with /Person.cfm link ---
        player = ""
        rc_sp: list[str] = []
        person_link = tr.find("a", href=_PERSON_RE)
        if person_link:
            player = person_link.get_text(strip=True)
            # RC/SP flags are text siblings after the person anchor
            player_cell = person_link.parent
            if player_cell:
                cell_text = player_cell.get_text(strip=True)
                trailing = cell_text[len(player):].strip() if player else cell_text
                if "RC" in trailing:
                    rc_sp.append("RC")
                if "SP" in trailing:
                    rc_sp.append("SP")

        # --- Team: anchor with /Team.cfm link ---
        team = ""
        team_link = tr.find("a", href=_TEAM_RE)
        if team_link:
            team = team_link.get_text(strip=True)

        # --- Image URL: front thumbnail (data-original, not Thumb3) ---
        image_url: Optional[str] = None
        for img in tr.find_all("img", attrs={"data-original": True}):
            src = img["data-original"]
            if "Thumb3" not in src:
                image_url = src
                break
            elif image_url is None:
                image_url = src

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
# Sub-sets (inserts & parallels)
# ---------------------------------------------------------------------------

_CHECKLIST_RE = re.compile(r"/Checklist\.cfm/sid/(\d+)")


def _parse_sub_sets(soup: BeautifulSoup) -> list[dict]:
    """Parse insert/parallel sub-set links from the 'Inserts and Related Sets' section.

    Returns a list of dicts: [{tcdb_id, name}]
    """
    sub_sets: list[dict] = []
    seen: set[int] = set()

    for anchor in soup.find_all("a", href=_CHECKLIST_RE):
        m = _CHECKLIST_RE.search(anchor["href"])
        if not m:
            continue
        tcdb_id = int(m.group(1))
        name = anchor.get("title", anchor.get_text(strip=True))
        if name in ("Checklist", "More", "") or tcdb_id in seen:
            continue
        seen.add(tcdb_id)
        sub_sets.append({"tcdb_id": tcdb_id, "name": name})

    return sub_sets


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


_PAGE_INDEX_RE = re.compile(r"\?PageIndex=(\d+)")


def parse_max_page_index(html: str) -> int:
    """Find the highest PageIndex from pagination links on a Checklist page.

    TCDB Checklist pages paginate via ``?PageIndex=N`` links.
    Returns 1 if no pagination links are found (single-page set).
    """
    soup = BeautifulSoup(html, "html.parser")
    max_page = 1
    for anchor in soup.find_all("a", href=_PAGE_INDEX_RE):
        m = _PAGE_INDEX_RE.search(anchor["href"])
        if m:
            page = int(m.group(1))
            if page > max_page:
                max_page = page
    return max_page


# ---------------------------------------------------------------------------
# Sub-set expansion (AJAX endpoint)
# ---------------------------------------------------------------------------


def parse_sub_set_list(html: str) -> list[dict]:
    """Parse the AJAX response from /ViewAllExp.cfm?SetID=NNN.

    This returns all insert/parallel sub-sets for a parent set.
    Returns a list of dicts: [{tcdb_id, name, url_slug}]
    """
    soup = BeautifulSoup(html, "html.parser")
    results: list[dict] = []
    seen: set[int] = set()

    for anchor in soup.find_all("a", href=_SET_ID_RE):
        href = anchor["href"]
        sid_match = _SET_ID_RE.search(href)
        if not sid_match:
            continue

        tcdb_id = int(sid_match.group(1))
        if tcdb_id in seen:
            continue
        seen.add(tcdb_id)

        name = anchor.get_text(strip=True)

        slug_start = href.find(f"/sid/{tcdb_id}/")
        if slug_start != -1:
            url_slug = href[slug_start + len(f"/sid/{tcdb_id}/"):]
        else:
            url_slug = ""

        results.append({"tcdb_id": tcdb_id, "name": name, "url_slug": url_slug})

    return results


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
