"""Tests for scraper CLI JSON modes: --list --json and --preview --json."""

import json
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Sample HTML fragments (matching real TCDB structure)
# ---------------------------------------------------------------------------

SET_LIST_HTML = """\
<html><body>
<ul style="list-style: none; padding:5px 0px 10px 30px; margin:0;">
  <li><a href="/ViewSet.cfm/sid/482758/2025-Topps-Series-1">2025 Topps Series 1</a></li>
  <li><a href="/ViewSet.cfm/sid/490001/2025-Bowman-Chrome">2025 Bowman Chrome</a></li>
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
</body></html>
"""

SUB_SET_AJAX_HTML = """\
<ul>
<li><a href="/ViewSet.cfm/sid/490099/2025-Topps---Gold" title="80%% of images">Topps - Gold</a></li>
<li><a href="/ViewSet.cfm/sid/490100/2025-Topps---Bowman-Is-Back">Topps - Bowman Is Back</a></li>
<li><a href="/ViewSet.cfm/sid/490101/2025-Topps---Silver-Foil">Topps - Silver Foil</a></li>
</ul>
"""


def _make_mock_client():
    """Create a mock TcdbClient that returns canned HTML responses."""
    client = MagicMock()

    def fake_get(url):
        resp = MagicMock()
        if "ViewAll.cfm" in url:
            resp.text = SET_LIST_HTML
        elif "Checklist.cfm" in url:
            resp.text = SET_DETAIL_HTML
        elif "ViewAllExp.cfm" in url:
            resp.text = SUB_SET_AJAX_HTML
        else:
            resp.text = "<html></html>"
        resp.status_code = 200
        return resp

    client.get = MagicMock(side_effect=fake_get)
    return client


# ---------------------------------------------------------------------------
# Tests: list_sets_json
# ---------------------------------------------------------------------------


class TestListSetsJson:
    """Tests for list_sets_json() function."""

    def test_list_sets_returns_json_array(self):
        """list_sets_json returns a list of dicts with tcdb_id, name, year."""
        from scraper import list_sets_json

        client = _make_mock_client()
        result = list_sets_json(client, year=2025)

        # Must be a list
        assert isinstance(result, list)
        assert len(result) == 3

        # Verify first set
        first = result[0]
        assert first["tcdb_id"] == 482758
        assert first["name"] == "2025 Topps Series 1"
        assert first["year"] == 2025

        # Verify the result is JSON-serializable
        json_str = json.dumps(result)
        assert isinstance(json_str, str)
        roundtrip = json.loads(json_str)
        assert roundtrip == result

    def test_list_sets_includes_url_slug(self):
        """list_sets_json result includes url_slug for each set."""
        from scraper import list_sets_json

        client = _make_mock_client()
        result = list_sets_json(client, year=2025)

        assert result[0]["url_slug"] == "2025-Topps-Series-1"
        assert result[1]["url_slug"] == "2025-Bowman-Chrome"

    def test_list_sets_includes_card_count(self):
        """list_sets_json result includes card_count when available."""
        from scraper import list_sets_json

        client = _make_mock_client()
        result = list_sets_json(client, year=2025)

        # card_count key should exist (may be None from the fixture)
        for s in result:
            assert "card_count" in s

    def test_list_sets_passes_correct_url(self):
        """list_sets_json fetches the correct URL for the given year and sport."""
        from scraper import list_sets_json

        client = _make_mock_client()
        list_sets_json(client, year=2024, sport="Baseball")

        # Verify the URL called
        call_url = client.get.call_args[0][0]
        assert "ViewAll.cfm" in call_url
        assert "/year/2024" in call_url
        assert "Baseball" in call_url

    def test_list_sets_empty_page(self):
        """list_sets_json returns empty list when page has no sets."""
        from scraper import list_sets_json

        client = MagicMock()
        resp = MagicMock()
        resp.text = "<html><body>No sets here</body></html>"
        client.get.return_value = resp

        result = list_sets_json(client, year=1899)
        assert result == []


# ---------------------------------------------------------------------------
# Tests: preview_set_json
# ---------------------------------------------------------------------------


class TestPreviewSetJson:
    """Tests for preview_set_json() function."""

    def test_preview_returns_structured_dict(self):
        """preview_set_json returns a dict with expected keys and structure."""
        from scraper import preview_set_json

        client = _make_mock_client()
        set_info = {
            "tcdb_id": 482758,
            "name": "2025 Topps Series 1",
            "url_slug": "2025-Topps-Series-1",
            "year": 2025,
        }

        result = preview_set_json(client, set_info)

        # Must be a dict
        assert isinstance(result, dict)

        # Required top-level keys
        assert result["tcdb_id"] == 482758
        assert result["name"] == "2025 Topps Series 1"
        assert result["year"] == 2025
        assert result["brand"] == "Topps"

        # base_cards is the count from the Checklist page
        assert result["base_cards"] == 350  # from Total Cards in fixture

        # total_cards >= base_cards
        assert result["total_cards"] >= result["base_cards"]

        # parallels and inserts are lists
        assert isinstance(result["parallels"], list)
        assert isinstance(result["inserts"], list)

    def test_preview_classifies_parallels_and_inserts(self):
        """Sub-sets are classified using _is_parallel into parallels vs inserts."""
        from scraper import preview_set_json

        client = _make_mock_client()
        set_info = {
            "tcdb_id": 482758,
            "name": "2025 Topps Series 1",
            "url_slug": "2025-Topps-Series-1",
            "year": 2025,
        }

        result = preview_set_json(client, set_info)

        # From SUB_SET_AJAX_HTML: "Gold" -> parallel, "Silver Foil" -> parallel,
        # "Bowman Is Back" -> insert
        parallel_names = [p["name"] for p in result["parallels"]]
        insert_names = [i["name"] for i in result["inserts"]]

        assert "Gold" in parallel_names
        assert "Silver Foil" in parallel_names
        assert "Bowman Is Back" in insert_names

    def test_preview_is_json_serializable(self):
        """preview_set_json result can be serialized to JSON without error."""
        from scraper import preview_set_json

        client = _make_mock_client()
        set_info = {
            "tcdb_id": 482758,
            "name": "2025 Topps Series 1",
            "url_slug": "2025-Topps-Series-1",
            "year": 2025,
        }

        result = preview_set_json(client, set_info)

        # Roundtrip through JSON
        json_str = json.dumps(result)
        assert isinstance(json_str, str)
        roundtrip = json.loads(json_str)
        assert roundtrip == result

    def test_preview_sub_sets_have_tcdb_id(self):
        """Each parallel and insert entry includes its TCDB sub-set ID."""
        from scraper import preview_set_json

        client = _make_mock_client()
        set_info = {
            "tcdb_id": 482758,
            "name": "2025 Topps Series 1",
            "url_slug": "2025-Topps-Series-1",
            "year": 2025,
        }

        result = preview_set_json(client, set_info)

        for p in result["parallels"]:
            assert "tcdb_id" in p
            assert isinstance(p["tcdb_id"], int)

        for i in result["inserts"]:
            assert "tcdb_id" in i
            assert isinstance(i["tcdb_id"], int)
