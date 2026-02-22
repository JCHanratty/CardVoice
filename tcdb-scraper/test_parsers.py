"""Tests for TCDB HTML page parsers."""

import pytest

from parsers import (
    parse_set_id_from_url,
    parse_set_list_page,
    parse_set_detail_page,
)


# ---------------------------------------------------------------------------
# Sample HTML fragments
# ---------------------------------------------------------------------------

SET_LIST_HTML = """\
<html><body>
<div class="set-list">
  <div class="set-row">
    <a href="/ViewSet.cfm/sid/482758/2025-Topps-Series-1">2025 Topps Series 1</a>
    <span>(150 cards)</span>
  </div>
  <div class="set-row">
    <a href="/ViewSet.cfm/sid/490001/2025-Bowman-Chrome">2025 Bowman Chrome</a>
    <span>(200 cards)</span>
  </div>
  <div class="set-row">
    <a href="/ViewSet.cfm/sid/490050/2025-Panini-Prizm">2025 Panini Prizm</a>
    <span>(300 cards)</span>
  </div>
</div>
</body></html>
"""

SET_DETAIL_HTML = """\
<html>
<head><title>2025 Topps Series 1 Baseball</title></head>
<body>
<div>Total Cards: 350</div>
<table class="block1">
  <tr>
    <td valign="top">1</td>
    <td valign="top">Aaron Judge</td>
    <td valign="top">New York Yankees</td>
    <td><img data-original="https://img.tcdb.com/cards/1.jpg" src="/placeholder.gif" /></td>
  </tr>
  <tr>
    <td valign="top">2</td>
    <td valign="top">Shohei Ohtani</td>
    <td valign="top">Los Angeles Dodgers</td>
    <td><img data-original="https://img.tcdb.com/cards/2.jpg" src="/placeholder.gif" /></td>
  </tr>
  <tr>
    <td valign="top">3</td>
    <td valign="top">Mike Trout</td>
    <td valign="top">Los Angeles Angels</td>
  </tr>
</table>
</body></html>
"""


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestParseSetListPage:
    """test_parse_set_list_page: extract tcdb_id, name, url_slug from set links."""

    def test_parse_set_list_page(self):
        results = parse_set_list_page(SET_LIST_HTML)

        assert len(results) == 3

        first = results[0]
        assert first["tcdb_id"] == 482758
        assert first["name"] == "2025 Topps Series 1"
        assert first["url_slug"] == "2025-Topps-Series-1"

        second = results[1]
        assert second["tcdb_id"] == 490001
        assert second["name"] == "2025 Bowman Chrome"
        assert second["url_slug"] == "2025-Bowman-Chrome"

    def test_parse_set_list_extracts_card_count(self):
        """\"(150 cards)\" -> card_count=150"""
        results = parse_set_list_page(SET_LIST_HTML)

        assert results[0]["card_count"] == 150
        assert results[1]["card_count"] == 200
        assert results[2]["card_count"] == 300


class TestParseSetDetailCards:
    """test_parse_set_detail_cards: table rows -> card_number, player, team."""

    def test_parse_set_detail_cards(self):
        detail = parse_set_detail_page(SET_DETAIL_HTML)

        assert detail["title"] == "2025 Topps Series 1 Baseball"
        assert detail["total_cards"] == 350

        cards = detail["cards"]
        assert len(cards) == 3

        assert cards[0]["card_number"] == "1"
        assert cards[0]["player"] == "Aaron Judge"
        assert cards[0]["team"] == "New York Yankees"

        assert cards[1]["card_number"] == "2"
        assert cards[1]["player"] == "Shohei Ohtani"
        assert cards[1]["team"] == "Los Angeles Dodgers"

        assert cards[2]["card_number"] == "3"
        assert cards[2]["player"] == "Mike Trout"
        assert cards[2]["team"] == "Los Angeles Angels"

    def test_parse_set_detail_with_image_urls(self):
        """img[data-original] attribute should be extracted as image_url."""
        detail = parse_set_detail_page(SET_DETAIL_HTML)
        cards = detail["cards"]

        assert cards[0]["image_url"] == "https://img.tcdb.com/cards/1.jpg"
        assert cards[1]["image_url"] == "https://img.tcdb.com/cards/2.jpg"
        # Third card has no image
        assert cards[2]["image_url"] is None


class TestParseSetIdFromUrl:
    """test_parse_set_id_from_url: extract numeric ID from ViewSet.cfm URLs."""

    def test_parse_set_id_from_url(self):
        assert parse_set_id_from_url("/ViewSet.cfm/sid/482758/2025-Topps-Series-1") == 482758
        assert parse_set_id_from_url("/ViewSet.cfm/sid/12345/Some-Set") == 12345
        assert parse_set_id_from_url("https://www.tcdb.com/ViewSet.cfm/sid/99999/Test") == 99999
        assert parse_set_id_from_url("/SomeOtherPage.cfm") is None
        assert parse_set_id_from_url("") is None
