const { load } = require('cheerio');
const { request } = require('undici');
const config = require('./scraper-config.json');

function randomUserAgent() {
  const agents = config.userAgents;
  return agents[Math.floor(Math.random() * agents.length)];
}

function buildSearchUrl(query) {
  const params = new URLSearchParams({ ...config.defaultParams, _nkw: query });
  return `${config.baseUrl}?${params.toString()}`;
}

function parsePriceText(text) {
  if (!text) return null;
  const cleaned = text.replace(/[^0-9.]/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function parseDateText(text) {
  if (!text) return null;
  const match = text.match(/(\w{3}\s+\d{1,2},?\s+\d{4})/);
  if (!match) return null;
  const d = new Date(match[1]);
  return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
}

async function scrapeEbaySold(query) {
  const url = buildSearchUrl(query);
  const { selectors } = config;

  let body;
  try {
    const resp = await request(url, {
      headers: {
        'User-Agent': randomUserAgent(),
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      maxRedirections: 3,
    });

    if (resp.statusCode === 429) {
      return { error: 'rate_limited', results: [] };
    }
    if (resp.statusCode !== 200) {
      return { error: `http_${resp.statusCode}`, results: [] };
    }

    body = await resp.body.text();
  } catch (err) {
    return { error: err.message, results: [] };
  }

  const $ = load(body);
  const results = [];

  $(selectors.resultItem).each((i, el) => {
    const $el = $(el);
    const title = $el.find(selectors.title).text().trim();
    const priceText = $el.find(selectors.price).first().text().trim();
    const dateText = $el.find(selectors.date).text().trim();
    const link = $el.find(selectors.link).attr('href') || '';
    const condition = $el.find(selectors.condition).text().trim();

    const price = parsePriceText(priceText);
    if (price === null || price === 0) return;

    results.push({
      title,
      price,
      soldDate: parseDateText(dateText),
      listingUrl: link.split('?')[0],
      condition,
    });
  });

  return { error: null, results };
}

function filterOutliers(results, opts = {}) {
  if (results.length === 0) return { filtered: [], median: null };

  const { lotKeywords, outlierMultiplier } = config;
  const skipLots = opts.skipLots !== false;

  let items = results;

  if (skipLots) {
    items = items.filter(r => {
      const lower = r.title.toLowerCase();
      return !lotKeywords.some(kw => lower.includes(kw));
    });
  }

  if (items.length === 0) return { filtered: [], median: null };

  const prices = items.map(r => r.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 0
    ? (prices[mid - 1] + prices[mid]) / 2
    : prices[mid];

  const filtered = items.filter(r => {
    return r.price >= median / outlierMultiplier && r.price <= median * outlierMultiplier;
  });

  const finalPrices = filtered.map(r => r.price).sort((a, b) => a - b);
  const fMid = Math.floor(finalPrices.length / 2);
  const finalMedian = finalPrices.length === 0 ? null
    : finalPrices.length % 2 === 0
      ? (finalPrices[fMid - 1] + finalPrices[fMid]) / 2
      : finalPrices[fMid];

  return { filtered, median: finalMedian };
}

function buildCardQuery(card, set) {
  let q = `${set.year} ${set.name} #${card.card_number}`;
  if (card.player) q += ` ${card.player}`;
  if (card.parallel && card.parallel !== 'Base') q += ` ${card.parallel}`;
  return q;
}

function buildSetQuery(set) {
  return `${set.year} ${set.name} complete set`;
}

module.exports = {
  scrapeEbaySold,
  filterOutliers,
  buildCardQuery,
  buildSetQuery,
  buildSearchUrl,
  parsePriceText,
  parseDateText,
};
