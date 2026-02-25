"""Tests for the TCDB collection page parser."""
import pytest
from parsers import parse_collection_page

# Sample HTML mimicking ViewCollectionMode.cfm row structure
SAMPLE_HTML = '''
<table width="100%" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
<tr class="collection_row" bgcolor="#D9EDF7">
  <td><button type="button" class="btn btn-primary"><span class="badge bg-light text-dark">2</span></button></td>
  <td nowrap width="4">&nbsp;</td>
  <td nowrap valign="top"><a href="/ViewCard.cfm/sid/404413/cid/23860904/2024-Topps-3-Endy-Rodriguez">3</a></td>
  <td nowrap width="2">&nbsp;</td>
  <td valign="top" class="w-100"><a href="/ViewCard.cfm/sid/404413/cid/23860904/2024-Topps-3-Endy-Rodriguez">Endy Rodríguez</a> RC</td>
  <td align="right"><a target="_blank" href="https://www.ebay.com/sch/..."><i class="fa-brands fa-ebay"></i></a></td>
</tr>
<tr><td colspan="6"><div id="hideDiv1" style="display:none"><div id="theDiv1"></div></div></td></tr>
<tr class="collection_row" bgcolor="#FFFFFF">
  <td><button type="button" class="btn btn-primary"><span class="badge bg-light text-dark">1</span></button></td>
  <td nowrap width="4">&nbsp;</td>
  <td nowrap valign="top"><a href="/ViewCard.cfm/sid/333/cid/114503/1994-Finest-100-Frank-Thomas">100</a></td>
  <td nowrap width="2">&nbsp;</td>
  <td valign="top" class="w-100"><a href="/ViewCard.cfm/sid/333/cid/114503/1994-Finest-100-Frank-Thomas">Frank Thomas</a></td>
  <td align="right"><a target="_blank" href="https://www.ebay.com/sch/..."><i class="fa-brands fa-ebay"></i></a></td>
</tr>
<tr><td colspan="6"><div id="hideDiv2" style="display:none"><div id="theDiv2"></div></div></td></tr>
</table>
<p><em>592 record(s)</em></p>
'''

def test_parse_collection_page_cards():
    result = parse_collection_page(SAMPLE_HTML)
    assert len(result["cards"]) == 2

    card1 = result["cards"][0]
    assert card1["card_number"] == "3"
    assert card1["player"] == "Endy Rodríguez"
    assert card1["qty"] == 2
    assert card1["rc_sp"] == "RC"
    assert card1["tcdb_set_id"] == 404413
    assert card1["tcdb_card_id"] == 23860904

    card2 = result["cards"][1]
    assert card2["card_number"] == "100"
    assert card2["player"] == "Frank Thomas"
    assert card2["qty"] == 1
    assert card2["rc_sp"] == ""
    assert card2["tcdb_set_id"] == 333

def test_parse_collection_page_total():
    result = parse_collection_page(SAMPLE_HTML)
    assert result["total_records"] == 592
