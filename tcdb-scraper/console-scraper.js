// ===========================================================
// TCDB Collection Console Scraper for CardVoice
// ===========================================================
// HOW TO USE:
// 1. Open https://www.tcdb.com in Chrome
// 2. Log into your TCDB account
// 3. Go to your collection page (e.g. My Cards > View Collection)
// 4. Open DevTools (F12) and go to the Console tab
// 5. Copy this ENTIRE script and paste it into the console
// 6. Press Enter — it will scrape all pages automatically
// 7. When done, it copies JSON to your clipboard
// 8. In CardVoice Admin page, click "Paste JSON" and paste it
// ===========================================================

(async function tcdbScraper() {
  const MEMBER = "Jhanratty";
  const BASE = "https://www.tcdb.com";
  const DELAY_MS = 3000; // 3 seconds between page requests
  const CARDS_PER_PAGE = 100;

  console.log("%c[CardVoice] TCDB Collection Scraper starting...", "color: #4ade80; font-weight: bold; font-size: 14px");

  // Helper: wait ms
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Helper: parse HTML string into DOM
  function parseHTML(html) {
    const parser = new DOMParser();
    return parser.parseFromString(html, "text/html");
  }

  // Parse a single collection page DOM
  function parsePage(doc) {
    const cards = [];
    const rows = doc.querySelectorAll("tr");
    for (const row of rows) {
      const tds = row.querySelectorAll("td");
      if (tds.length < 5) continue;

      // Look for a card link in td[2] (ViewCard.cfm)
      const link = tds[2] ? tds[2].querySelector("a[href*='ViewCard.cfm']") : null;
      if (!link) continue;

      const href = link.getAttribute("href") || "";
      const match = href.match(/\/ViewCard\.cfm\/sid\/(\d+)\/cid\/(\d+)/);
      if (!match) continue;

      const tcdb_set_id = parseInt(match[1]);
      const tcdb_card_id = parseInt(match[2]);
      const card_number = link.textContent.trim();

      // Qty from badge in first td
      const badge = tds[0].querySelector("span.badge");
      const qty = badge ? parseInt(badge.textContent.trim()) || 1 : 1;

      // Player name from td[4]
      const playerLink = tds[4] ? tds[4].querySelector("a") : null;
      const player = playerLink ? playerLink.textContent.trim() : (tds[4] ? tds[4].textContent.trim() : "");

      // RC/SP suffix
      let rc_sp = "";
      if (playerLink && tds[4]) {
        const fullText = tds[4].textContent.trim();
        if (fullText.length > player.length) {
          rc_sp = fullText.substring(player.length).trim();
        }
      }

      cards.push({ card_number, player, qty, rc_sp, tcdb_set_id, tcdb_card_id });
    }
    return cards;
  }

  // Step 1: Fetch page 1 to determine total records
  console.log("[CardVoice] Fetching page 1 to determine total records...");
  const firstUrl = BASE + "/ViewCollectionMode.cfm?Filter=G&Member=" + MEMBER + "&MODE=&Type=Baseball&CollectionID=1&Records=10000&PageIndex=1";

  let firstResp;
  try {
    firstResp = await fetch(firstUrl);
  } catch (e) {
    console.error("[CardVoice] Failed to fetch page 1:", e.message);
    console.error("[CardVoice] Make sure you are logged into TCDB and on tcdb.com");
    return;
  }

  const firstHTML = await firstResp.text();
  const firstDoc = parseHTML(firstHTML);

  // Find total records from the page
  let totalRecords = 0;
  const recordsText = firstDoc.body.innerHTML.match(/Records?\s*=\s*(\d+)/i);
  if (recordsText) {
    totalRecords = parseInt(recordsText[1]);
  }
  // Also check page text for "of XXXX cards"
  if (!totalRecords) {
    const ofCards = firstDoc.body.textContent.match(/of\s+([\d,]+)\s+cards/i);
    if (ofCards) totalRecords = parseInt(ofCards[1].replace(/,/g, ""));
  }
  // Fallback: count pagination links
  if (!totalRecords) {
    const pageLinks = firstDoc.querySelectorAll("a[href*='PageIndex=']");
    let maxPage = 1;
    for (const pl of pageLinks) {
      const m = pl.href.match(/PageIndex=(\d+)/);
      if (m) maxPage = Math.max(maxPage, parseInt(m[1]));
    }
    totalRecords = maxPage * CARDS_PER_PAGE;
  }

  const totalPages = Math.ceil(totalRecords / CARDS_PER_PAGE);
  console.log("[CardVoice] Total records: " + totalRecords + ", pages: " + totalPages);

  // Parse page 1
  const allCards = parsePage(firstDoc);
  console.log("[CardVoice] Page 1/" + totalPages + ": " + allCards.length + " cards");

  // Step 2: Scrape remaining pages
  for (let page = 2; page <= totalPages; page++) {
    await sleep(DELAY_MS);

    const url = BASE + "/ViewCollectionMode.cfm?Filter=G&Member=" + MEMBER + "&MODE=&Type=Baseball&CollectionID=1&Records=" + totalRecords + "&PageIndex=" + page;
    try {
      const resp = await fetch(url);
      const html = await resp.text();
      const doc = parseHTML(html);
      const pageCards = parsePage(doc);
      allCards.push(...pageCards);
      console.log("[CardVoice] Page " + page + "/" + totalPages + ": " + pageCards.length + " cards (total: " + allCards.length + ")");
    } catch (e) {
      console.error("[CardVoice] Page " + page + " failed: " + e.message);
    }
  }

  console.log("%c[CardVoice] Scraping complete! " + allCards.length + " cards found", "color: #4ade80; font-weight: bold");

  // Step 3: Resolve set names
  console.log("[CardVoice] Resolving set names...");
  const uniqueSids = [...new Set(allCards.map(c => c.tcdb_set_id))];
  const setInfo = {};

  for (let i = 0; i < uniqueSids.length; i++) {
    const sid = uniqueSids[i];
    if (setInfo[sid]) continue;

    await sleep(1500);

    try {
      const resp = await fetch(BASE + "/ViewSet.cfm/sid/" + sid);
      const html = await resp.text();
      const doc = parseHTML(html);
      let title = doc.title || "";
      // Clean up: remove " - Trading Card Checklist" etc.
      title = title.replace(/\s*-\s*Trading Card.*$/i, "").trim();
      title = title.replace(/\s*Baseball\s*$/i, "").trim();
      if (!title) title = "Set-" + sid;

      const yearMatch = title.match(/^(\d{4})\s+/);
      const year = yearMatch ? parseInt(yearMatch[1]) : 0;

      setInfo[sid] = { name: title, year: year };
      console.log("[CardVoice]   [" + (i + 1) + "/" + uniqueSids.length + "] sid=" + sid + " -> " + title);
    } catch (e) {
      setInfo[sid] = { name: "Set-" + sid, year: 0 };
      console.error("[CardVoice]   Failed sid=" + sid + ": " + e.message);
    }
  }

  // Step 4: Group by set
  const groups = {};
  for (const card of allCards) {
    if (!groups[card.tcdb_set_id]) groups[card.tcdb_set_id] = [];
    groups[card.tcdb_set_id].push(card);
  }

  const sets = [];
  for (const sid in groups) {
    const info = setInfo[parseInt(sid)] || { name: "Set-" + sid, year: 0 };
    sets.push({
      tcdb_set_id: parseInt(sid),
      set_name: info.name,
      year: info.year,
      card_count: groups[sid].length,
      cards: groups[sid]
    });
  }
  sets.sort(function(a, b) { return b.year - a.year || a.set_name.localeCompare(b.set_name); });

  const result = {
    total_cards: allCards.length,
    total_sets: sets.length,
    sets: sets
  };

  // Step 5: Copy to clipboard
  const jsonStr = JSON.stringify(result);
  try {
    await navigator.clipboard.writeText(jsonStr);
    console.log("%c[CardVoice] JSON copied to clipboard! (" + (jsonStr.length / 1024).toFixed(0) + " KB)", "color: #4ade80; font-weight: bold; font-size: 14px");
    console.log("%c[CardVoice] Now go to CardVoice Admin > Import TCDB Collection > Paste JSON", "color: #facc15; font-weight: bold");
  } catch (e) {
    console.warn("[CardVoice] Could not copy to clipboard. Download instead...");
    // Fallback: download as file
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tcdb-collection.json";
    a.click();
    URL.revokeObjectURL(url);
    console.log("%c[CardVoice] Downloaded tcdb-collection.json — import it in CardVoice Admin", "color: #facc15; font-weight: bold");
  }

  console.log("[CardVoice] Summary: " + allCards.length + " cards across " + sets.length + " sets");
  return result;
})();
