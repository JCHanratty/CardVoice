/**
 * Player name normalization and matching against player_metadata.
 */

/**
 * Normalize a player name for matching:
 * - Lowercase
 * - Strip periods and commas
 * - Remove suffix words (Jr, Sr, II, III, IV) using word boundaries
 * - Collapse whitespace
 */
function normalizePlayerName(name) {
  if (!name) return '';
  let n = name.toLowerCase().trim();
  n = n.replace(/[.,]/g, '');
  n = n.replace(/\b(jr|sr|ii|iii|iv)\b/gi, '');
  return n.replace(/\s+/g, ' ').trim();
}

/**
 * Look up a player name in player_metadata. Returns the row or null.
 */
function matchPlayer(db, rawName) {
  const normalized = normalizePlayerName(rawName);
  if (!normalized) return null;
  return db.prepare('SELECT * FROM player_metadata WHERE player_name = ?').get(normalized) || null;
}

/**
 * Batch-match an array of player names. Returns a Map<normalizedName, metadataRow>.
 */
function matchPlayers(db, rawNames) {
  const results = new Map();
  const seen = new Set();
  for (const name of rawNames) {
    const normalized = normalizePlayerName(name);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    const row = db.prepare('SELECT * FROM player_metadata WHERE player_name = ?').get(normalized);
    if (row) results.set(normalized, row);
  }
  return results;
}

module.exports = { normalizePlayerName, matchPlayer, matchPlayers };
