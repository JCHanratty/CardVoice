require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const config = require('./scraper-config.json');

const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_CERT_ID = process.env.EBAY_CERT_ID;

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE_API_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search';

// Cached token + expiry
let cachedToken = null;
let tokenExpiry = 0;

/**
 * Get a fresh OAuth application token using client credentials grant.
 * Tokens are cached and auto-refreshed when expired.
 */
async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry) {
    return cachedToken;
  }

  if (!EBAY_APP_ID || !EBAY_CERT_ID) {
    throw new Error('EBAY_APP_ID and EBAY_CERT_ID must be set in server/.env');
  }

  const credentials = Buffer.from(`${EBAY_APP_ID}:${EBAY_CERT_ID}`).toString('base64');

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${credentials}`,
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Token request failed (${resp.status}): ${text.substring(0, 200)}`);
  }

  const data = await resp.json();
  cachedToken = data.access_token;
  // Refresh 5 minutes before actual expiry
  tokenExpiry = Date.now() + (data.expires_in - 300) * 1000;

  return cachedToken;
}

/**
 * Search eBay for items using the Browse API.
 * Auto-refreshes OAuth tokens as needed.
 */
async function scrapeEbaySold(query) {
  let token;
  try {
    token = await getToken();
  } catch (err) {
    return { error: err.message, results: [] };
  }

  const params = new URLSearchParams({
    q: query,
    limit: '50',
    sort: 'newlyListed',
  });

  const url = `${BROWSE_API_URL}?${params.toString()}`;

  try {
    const resp = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
        'Accept': 'application/json',
      },
    });

    if (resp.status === 429) {
      return { error: 'rate_limited', results: [] };
    }
    if (resp.status === 401) {
      // Token expired mid-request -- invalidate and retry once
      cachedToken = null;
      tokenExpiry = 0;
      try {
        token = await getToken();
      } catch (err) {
        return { error: err.message, results: [] };
      }
      const retry = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_US',
          'Accept': 'application/json',
        },
      });
      if (!retry.ok) {
        return { error: `Retry failed: http_${retry.status}`, results: [] };
      }
      const retryData = await retry.json();
      return parseResults(retryData);
    }
    if (!resp.ok) {
      const text = await resp.text();
      return { error: `http_${resp.status}: ${text.substring(0, 300)}`, results: [] };
    }

    const data = await resp.json();
    return parseResults(data);
  } catch (err) {
    return { error: err.message, results: [] };
  }
}

function parseResults(data) {
  const items = data.itemSummaries || [];
  const results = [];

  for (const item of items) {
    const title = item.title || '';
    const priceVal = parseFloat(item.price?.value || '0');
    const currency = item.price?.currency || 'USD';
    const itemUrl = item.itemWebUrl || '';
    const condName = item.condition || '';
    const endDate = item.itemEndDate || item.itemCreationDate || '';

    if (priceVal === 0 || currency !== 'USD') continue;

    results.push({
      title,
      price: priceVal,
      soldDate: endDate ? endDate.split('T')[0] : null,
      listingUrl: itemUrl,
      condition: condName,
    });
  }

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
  getToken,
};
