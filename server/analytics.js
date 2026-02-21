/**
 * Anonymous usage heartbeat — sends basic stats to a Google Sheets webhook.
 * No user ID, no machine fingerprint, no personal data.
 */
const { getMeta, setMeta } = require('./db');

// Replace with your actual Google Apps Script URL after setup
const HEARTBEAT_URL = process.env.HEARTBEAT_URL || '';

/**
 * Send a single anonymous heartbeat ping (max once per day).
 * @param {import('better-sqlite3').Database} db
 */
async function sendHeartbeat(db) {
  if (!HEARTBEAT_URL) return; // Not configured yet

  // Check opt-out
  const enabled = getMeta(db, 'analytics_enabled');
  if (enabled === '0') return;

  // Check if we already sent today
  const lastSent = getMeta(db, 'heartbeat_last_sent') || '';
  const today = new Date().toISOString().slice(0, 10);
  if (lastSent === today) return;

  // Gather anonymous stats
  const setCount = db.prepare('SELECT COUNT(*) as cnt FROM card_sets').get().cnt;
  const cardCount = db.prepare('SELECT COUNT(*) as cnt FROM cards').get().cnt;
  const ownedCount = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE qty > 0').get().cnt;
  const catalogVersion = getMeta(db, 'catalog_version') || 'unknown';

  const payload = {
    app_version: process.env.npm_package_version || 'dev',
    os: process.platform,
    set_count: setCount,
    card_count: cardCount,
    owned_count: ownedCount,
    catalog_version: catalogVersion,
    timestamp: new Date().toISOString(),
  };

  try {
    await fetch(HEARTBEAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    setMeta(db, 'heartbeat_last_sent', today);
    console.log('[Analytics] Heartbeat sent');
  } catch (err) {
    // Silent failure — analytics should never break the app
    console.log('[Analytics] Heartbeat failed (non-critical):', err.message);
  }
}

module.exports = { sendHeartbeat };
