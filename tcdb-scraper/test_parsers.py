"""Tests for TCDB HTML page parsers."""

import pytest

from parsers import (
    parse_set_id_from_url,
    parse_set_list_page,
    parse_set_detail_page,
    parse_sub_set_list,
)


# ---------------------------------------------------------------------------
# Sample HTML fragments (matching real TCDB structure)
# ---------------------------------------------------------------------------

SET_LIST_HTML = """\
<html><body>
<ul style="list-style: none; padding:5px 0px 10px 30px; margin:0;">
  <li><a href="/ViewSet.cfm/sid/482758/2025-Topps-Series-1">2025 Topps Series 1</a></li>
  <li><a href="/ViewSet.cfm/sid/490001/2025-Bowman-Chrome" title="81.4%% of images added">2025 Bowman Chrome</a></li>
  <li><a href="/ViewSet.cfm/sid/490050/2025-Panini-Prizm">2025 Panini Prizm</a></li>
</ul>
</body></html>
"""

SET_DETAIL_HTML = """\
<html>
<head><title>2025 Topps Series 1 Baseball</title></head>
<body>
<strong>Total Cards:</strong> 350
<table>
  <tr bgcolor="#F7F9F9">
    <td height="35" nowrap valign="top" width="25"><a href="/ViewCard.cfm/sid/482758/cid/100001/2025-Topps-1-Aaron-Judge">
      <img class="lazy bshadow" data-original="/Images/Thumbs/Baseball/482758/482758_100001Thumb.jpg" /></a></td>
    <td height="35" nowrap valign="top" width="25"><a href="/ViewCard.cfm/sid/482758/cid/100001/2025-Topps-1-Aaron-Judge">
      <img class="lazy bshadow" data-original="/Images/Thumbs/Baseball/482758/482758_100001Thumb3.jpg" /></a></td>
    <td nowrap valign="top"><a href="/ViewCard.cfm/sid/482758/cid/100001/2025-Topps-1-Aaron-Judge">1</a></td>
    <td valign="top" width="45%"><a href="/Person.cfm/pid/12345/Aaron-Judge">Aaron Judge</a> </td>
    <td valign="top" width="45%"><a href="/Team.cfm/tid/25/New-York-Yankees">New York Yankees</a></td>
  </tr>
  <tr bgcolor="#EAEEEE">
    <td height="35" nowrap valign="top" width="25"><a href="/ViewCard.cfm/sid/482758/cid/100002/2025-Topps-2-Shohei-Ohtani">
      <img class="lazy bshadow" data-original="/Images/Thumbs/Baseball/482758/482758_100002Thumb.jpg" /></a></td>
    <td height="35" nowrap valign="top" width="25"><a href="/ViewCard.cfm/sid/482758/cid/100002/2025-Topps-2-Shohei-Ohtani">
      <img class="lazy bshadow" data-original="/Images/Thumbs/Baseball/482758/482758_100002Thumb3.jpg" /></a></td>
    <td nowrap valign="top"><a href="/ViewCard.cfm/sid/482758/cid/100002/2025-Topps-2-Shohei-Ohtani">2</a></td>
    <td valign="top" width="45%"><a href="/Person.cfm/pid/23456/Shohei-Ohtani">Shohei Ohtani</a> </td>
    <td valign="top" width="45%"><a href="/Team.cfm/tid/14/Los-Angeles-Dodgers">Los Angeles Dodgers</a></td>
  </tr>
  <tr bgcolor="#F7F9F9">
    <td height="35" nowrap valign="top" width="25"><a href="/ViewCard.cfm/sid/482758/cid/100003/2025-Topps-3-Mike-Trout">
      <img class="lazy bshadow" data-original="/Images/Thumbs/Baseball/482758/482758_100003Thumb.jpg" /></a></td>
    <td height="35" nowrap valign="top" width="25"><a href="/ViewCard.cfm/sid/482758/cid/100003/2025-Topps-3-Mike-Trout">
      <img class="lazy bshadow" data-original="/Images/Thumbs/Baseball/482758/482758_100003Thumb3.jpg" /></a></td>
    <td nowrap valign="top"><a href="/ViewCard.cfm/sid/482758/cid/100003/2025-Topps-3-Mike-Trout">3</a></td>
    <td valign="top" width="45%"><a href="/Person.cfm/pid/37543/Mike-Trout">Mike Trout</a> RC</td>
    <td valign="top" width="45%"><a href="/Team.cfm/tid/14/Los-Angeles-Angels">Los Angeles Angels</a></td>
  </tr>
</table>
<h1>Inserts and Related Sets</h1>
<table><tr>
  <td valign="top"><a href="/Checklist.cfm/sid/490099/2025-Topps---Gold" title="Gold">
    <img class="lazy" data-original="/Images/SampleCards/Baseball/490099.jpg" /></a></td>
  <td valign="top"><a href="/Checklist.cfm/sid/490100/2025-Topps---Bowman-Is-Back" title="Bowman Is Back">
    <img class="lazy" data-original="/Images/SampleCards/Baseball/490100.jpg" /></a></td>
</tr></table>
</body></html>
"""

SUB_SET_AJAX_HTML = """\
<ul>
<li><a href="/ViewSet.cfm/sid/490099/2025-Topps---Gold" title="80%% of images">Topps - Gold</a></li>
<li><a href="/ViewSet.cfm/sid/490100/2025-Topps---Bowman-Is-Back">Topps - Bowman Is Back</a></li>
<li><a href="/ViewSet.cfm/sid/490101/2025-Topps---Silver-Foil">Topps - Silver Foil</a></li>
</ul>
"""


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestParseSetListPage:
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

    def test_parse_set_list_no_card_count_on_list_page(self):
        """Real TCDB list pages don't include card counts inline."""
        results = parse_set_list_page(SET_LIST_HTML)
        # Card counts come from detail page, not list page
        assert results[0]["card_count"] is None


class TestParseSetDetailCards:
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
        """Front thumbnail (non-Thumb3) should be extracted as image_url."""
        detail = parse_set_detail_page(SET_DETAIL_HTML)
        cards = detail["cards"]

        assert cards[0]["image_url"] == "/Images/Thumbs/Baseball/482758/482758_100001Thumb.jpg"
        assert cards[1]["image_url"] == "/Images/Thumbs/Baseball/482758/482758_100002Thumb.jpg"
        assert cards[2]["image_url"] == "/Images/Thumbs/Baseball/482758/482758_100003Thumb.jpg"

    def test_parse_rc_flag(self):
        """RC text after player anchor is captured."""
        detail = parse_set_detail_page(SET_DETAIL_HTML)
        cards = detail["cards"]

        assert cards[0]["rc_sp"] == []
        assert cards[1]["rc_sp"] == []
        assert cards[2]["rc_sp"] == ["RC"]

    def test_parse_sub_sets_from_detail(self):
        """Checklist links in 'Inserts and Related Sets' section are extracted."""
        detail = parse_set_detail_page(SET_DETAIL_HTML)
        sub_sets = detail["sub_sets"]

        assert len(sub_sets) == 2
        assert sub_sets[0]["tcdb_id"] == 490099
        assert sub_sets[0]["name"] == "Gold"
        assert sub_sets[1]["tcdb_id"] == 490100
        assert sub_sets[1]["name"] == "Bowman Is Back"


class TestParseSubSetList:
    def test_parse_sub_set_ajax(self):
        """ViewAllExp.cfm AJAX response returns sub-set links."""
        results = parse_sub_set_list(SUB_SET_AJAX_HTML)

        assert len(results) == 3
        assert results[0]["tcdb_id"] == 490099
        assert results[0]["name"] == "Topps - Gold"
        assert results[1]["tcdb_id"] == 490100
        assert results[1]["name"] == "Topps - Bowman Is Back"
        assert results[2]["tcdb_id"] == 490101
        assert results[2]["name"] == "Topps - Silver Foil"


class TestParseSetIdFromUrl:
    def test_parse_set_id_from_url(self):
        assert parse_set_id_from_url("/ViewSet.cfm/sid/482758/2025-Topps-Series-1") == 482758
        assert parse_set_id_from_url("/ViewSet.cfm/sid/12345/Some-Set") == 12345
        assert parse_set_id_from_url("https://www.tcdb.com/ViewSet.cfm/sid/99999/Test") == 99999
        assert parse_set_id_from_url("/SomeOtherPage.cfm") is None
        assert parse_set_id_from_url("") is None
