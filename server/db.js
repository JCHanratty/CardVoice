/**
 * CardVoice Database Layer
 * Ported from backend/db/models.py — same schema, same paths.
 * Uses better-sqlite3 (synchronous, no ORM).
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// --- DB location: %APPDATA%/CardVoice/ (falls back to project folder) ---
const _APPDATA = process.env.APPDATA || process.env.XDG_DATA_HOME;

let DB_DIR;
if (_APPDATA) {
  DB_DIR = path.join(_APPDATA, 'CardVoice');
} else {
  DB_DIR = path.join(__dirname, '..');
}

fs.mkdirSync(DB_DIR, { recursive: true });

const DB_PATH = path.join(DB_DIR, 'cardvoice.db');

// Auto-migrate from old location (backend/cardvoice.db)
const _OLD_DB_PATH = path.join(__dirname, '..', 'backend', 'cardvoice.db');
if (
  fs.existsSync(_OLD_DB_PATH) &&
  path.resolve(_OLD_DB_PATH) !== path.resolve(DB_PATH) &&
  !fs.existsSync(DB_PATH)
) {
  fs.copyFileSync(_OLD_DB_PATH, DB_PATH);
  try {
    fs.renameSync(_OLD_DB_PATH, _OLD_DB_PATH + '.migrated');
  } catch (_) {
    // Rename is best-effort — file may be locked by Python backend
  }
}


/**
 * Rotate backup copies of the database.
 * Keeps the last `maxBackups` versions (.bak1, .bak2, .bak3).
 */
function backupDb(maxBackups = 3) {
  if (!fs.existsSync(DB_PATH)) return;
  for (let i = maxBackups; i > 1; i--) {
    const older = `${DB_PATH}.bak${i - 1}`;
    const newer = `${DB_PATH}.bak${i}`;
    if (fs.existsSync(older)) {
      fs.copyFileSync(older, newer);
    }
  }
  fs.copyFileSync(DB_PATH, `${DB_PATH}.bak1`);
}


/**
 * Open (or create) the database and ensure tables exist.
 * @param {string} [dbPath] - Override path (useful for testing with :memory:)
 * @returns {import('better-sqlite3').Database}
 */
function openDb(dbPath) {
  const db = new Database(dbPath || DB_PATH);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create tables matching Python's SQLAlchemy schema exactly
  db.exec(`
    CREATE TABLE IF NOT EXISTS card_sets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      year        INTEGER,
      brand       TEXT,
      sport       TEXT    DEFAULT 'Baseball',
      total_cards INTEGER DEFAULT 0,
      UNIQUE(name, year)
    );

    CREATE TABLE IF NOT EXISTS cards (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id      INTEGER NOT NULL REFERENCES card_sets(id) ON DELETE CASCADE,
      card_number TEXT    NOT NULL,
      player      TEXT    NOT NULL,
      team        TEXT    DEFAULT '',
      rc_sp       TEXT    DEFAULT '',
      insert_type TEXT    DEFAULT 'Base',
      parallel    TEXT    DEFAULT '',
      qty         INTEGER DEFAULT 0,
      image_path  TEXT    DEFAULT ''
    );

    CREATE UNIQUE INDEX IF NOT EXISTS uq_card_variant
      ON cards(set_id, card_number, insert_type, parallel);

    CREATE TABLE IF NOT EXISTS voice_sessions (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id             INTEGER REFERENCES card_sets(id),
      timestamp          TEXT,
      insert_type_filter TEXT    DEFAULT 'Base',
      numbers_raw        TEXT    DEFAULT '',
      numbers_parsed     TEXT    DEFAULT '',
      cards_updated      INTEGER DEFAULT 0
    );
  `);

  // Set metadata tables (for checklist import)
  db.exec(`
    CREATE TABLE IF NOT EXISTS set_insert_types (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id     INTEGER NOT NULL REFERENCES card_sets(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      card_count INTEGER DEFAULT 0,
      odds       TEXT    DEFAULT '',
      UNIQUE(set_id, name)
    );

    CREATE TABLE IF NOT EXISTS set_parallels (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id     INTEGER NOT NULL REFERENCES card_sets(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      print_run  INTEGER,
      exclusive  TEXT    DEFAULT '',
      notes      TEXT    DEFAULT '',
      UNIQUE(set_id, name)
    );
  `);

  // App metadata (catalog version, settings, credentials)
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_meta (
      key        TEXT PRIMARY KEY,
      value      TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Pricing pipeline tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      search_query TEXT NOT NULL DEFAULT '',
      tracked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_synced DATETIME,
      UNIQUE(card_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER REFERENCES cards(id) ON DELETE SET NULL,
      set_id INTEGER REFERENCES card_sets(id) ON DELETE SET NULL,
      price REAL NOT NULL,
      sold_date TEXT,
      listing_title TEXT,
      listing_url TEXT,
      condition TEXT,
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS price_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id INTEGER REFERENCES card_sets(id) ON DELETE CASCADE,
      card_id INTEGER REFERENCES cards(id) ON DELETE CASCADE,
      median_price REAL NOT NULL,
      snapshot_date TEXT NOT NULL,
      UNIQUE(set_id, card_id, snapshot_date)
    )
  `);

  // Migration: add stats columns to voice_sessions (ignore if already present)
  const statsCols = [
    'ALTER TABLE voice_sessions ADD COLUMN duration_seconds INTEGER DEFAULT 0',
    'ALTER TABLE voice_sessions ADD COLUMN total_entries INTEGER DEFAULT 0',
    'ALTER TABLE voice_sessions ADD COLUMN total_cards INTEGER DEFAULT 0',
    'ALTER TABLE voice_sessions ADD COLUMN edits INTEGER DEFAULT 0',
    'ALTER TABLE voice_sessions ADD COLUMN deletes INTEGER DEFAULT 0',
    'ALTER TABLE voice_sessions ADD COLUMN accuracy_pct REAL DEFAULT 100.0',
    'ALTER TABLE voice_sessions ADD COLUMN cards_per_min REAL DEFAULT 0.0',
  ];
  for (const sql of statsCols) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }

  // Migration: hardened parser columns (ignore if already present)
  const hardenedCols = [
    "ALTER TABLE set_insert_types ADD COLUMN section_type TEXT DEFAULT 'base'",
    'ALTER TABLE set_parallels ADD COLUMN serial_max INTEGER',
    "ALTER TABLE set_parallels ADD COLUMN channels TEXT DEFAULT ''",
    "ALTER TABLE set_parallels ADD COLUMN variation_type TEXT DEFAULT 'parallel'",
  ];
  for (const sql of hardenedCols) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }

  // Migration: per-set sync toggle
  const syncCols = [
    'ALTER TABLE card_sets ADD COLUMN sync_enabled INTEGER DEFAULT 1',
  ];
  for (const sql of syncCols) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }

  // Migration: per-insert-type pricing controls
  const pricingCols = [
    'ALTER TABLE set_insert_types ADD COLUMN pricing_enabled INTEGER DEFAULT 0',
    "ALTER TABLE set_insert_types ADD COLUMN pricing_mode TEXT DEFAULT 'full_set'",
    "ALTER TABLE set_insert_types ADD COLUMN search_query_override TEXT DEFAULT ''",
  ];
  for (const sql of pricingCols) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }

  // Migration: link price data to insert types
  const insertTypeFk = [
    'ALTER TABLE price_history ADD COLUMN insert_type_id INTEGER REFERENCES set_insert_types(id) ON DELETE SET NULL',
    'ALTER TABLE price_snapshots ADD COLUMN insert_type_id INTEGER REFERENCES set_insert_types(id) ON DELETE CASCADE',
  ];
  for (const sql of insertTypeFk) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }

  // Migration: add image_path to cards
  const imageCols = [
    "ALTER TABLE cards ADD COLUMN image_path TEXT DEFAULT ''",
  ];
  for (const sql of imageCols) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }

  // Pricing indexes
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_price_history_card ON price_history(card_id)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_price_history_set ON price_history(set_id)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_price_snapshots_date ON price_snapshots(snapshot_date)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tracked_cards_card ON tracked_cards(card_id)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_price_history_insert_type ON price_history(insert_type_id)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_price_snapshots_insert_type ON price_snapshots(insert_type_id, snapshot_date)`); } catch(e) {}

  // Migration: insert_type_parallels junction table (which parallels belong to which insert type)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS insert_type_parallels (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        insert_type_id  INTEGER NOT NULL REFERENCES set_insert_types(id) ON DELETE CASCADE,
        parallel_id     INTEGER NOT NULL REFERENCES set_parallels(id) ON DELETE CASCADE,
        UNIQUE(insert_type_id, parallel_id)
      )
    `);
  } catch (_) { /* table already exists */ }

  // Migration: card_parallels table (which parallels the user owns for a specific card)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS card_parallels (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        card_id     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        parallel_id INTEGER NOT NULL REFERENCES set_parallels(id) ON DELETE CASCADE,
        qty         INTEGER DEFAULT 1,
        UNIQUE(card_id, parallel_id)
      )
    `);
  } catch (_) { /* table already exists */ }

  // Migration: player_metadata table
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS player_metadata (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        player_name        TEXT UNIQUE NOT NULL,
        tier               TEXT CHECK(tier IN ('hof','future_hof','key_rookie','star')),
        is_focus           INTEGER DEFAULT 0,
        focus_added_at     DATETIME,
        hof_induction_year INTEGER,
        hof_position       TEXT,
        hof_primary_team   TEXT
      )
    `);
  } catch (_) {}

  // Seed HOF players if table is empty
  const hofCount = db.prepare('SELECT COUNT(*) as cnt FROM player_metadata WHERE tier = ?').get('hof');
  if (hofCount.cnt === 0) {
    _seedHofPlayers(db);
  }

  // Migration: card_sets columns for TCDB collection import
  const tcdbSetCols = [
    'ALTER TABLE card_sets ADD COLUMN checklist_imported INTEGER DEFAULT 0',
    'ALTER TABLE card_sets ADD COLUMN tcdb_set_id INTEGER',
  ];
  for (const sql of tcdbSetCols) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }

  // Migration: move existing cards with parallel != '' into card_parallels
  _migrateParallelCards(db);

  return db;
}


/**
 * Migrate legacy card rows that have parallel != '' into the card_parallels table.
 * For each such row: find/create the base card, create a card_parallels entry,
 * then delete the old parallel card row. Idempotent — skips if no legacy rows exist.
 */
function _migrateParallelCards(db) {
  const cardsWithParallel = db.prepare(`
    SELECT c.id, c.set_id, c.card_number, c.insert_type, c.parallel, c.qty,
           c.player, c.team, c.rc_sp, c.image_path
    FROM cards c WHERE c.parallel != '' AND c.parallel IS NOT NULL
  `).all();

  if (cardsWithParallel.length === 0) return;
  console.log(`[Migration] Migrating ${cardsWithParallel.length} parallel card rows to card_parallels...`);

  const findBaseCard = db.prepare('SELECT id FROM cards WHERE set_id = ? AND card_number = ? AND insert_type = ? AND parallel = ?');
  const createBaseCard = db.prepare(`
    INSERT INTO cards (set_id, card_number, player, team, rc_sp, insert_type, parallel, qty, image_path)
    VALUES (?, ?, ?, ?, ?, ?, '', 0, ?)
  `);
  const findParallel = db.prepare('SELECT id FROM set_parallels WHERE set_id = ? AND name = ?');
  const insertCardParallel = db.prepare('INSERT OR IGNORE INTO card_parallels (card_id, parallel_id, qty) VALUES (?, ?, ?)');
  const deleteCard = db.prepare('DELETE FROM cards WHERE id = ?');

  const migrate = db.transaction(() => {
    for (const c of cardsWithParallel) {
      // Find or create the base card
      let baseCard = findBaseCard.get(c.set_id, c.card_number, c.insert_type, '');
      if (!baseCard) {
        const info = createBaseCard.run(c.set_id, c.card_number, c.player, c.team, c.rc_sp, c.insert_type, c.image_path);
        baseCard = { id: Number(info.lastInsertRowid) };
      }

      // Find the parallel in set_parallels
      const par = findParallel.get(c.set_id, c.parallel);
      if (par && c.qty > 0) {
        insertCardParallel.run(baseCard.id, par.id, c.qty);
      }

      // Delete the old parallel card row (unless it IS the base)
      if (c.id !== baseCard.id) {
        deleteCard.run(c.id);
      }
    }
  });

  migrate();
  console.log('[Migration] Parallel card migration complete');
}


function _seedHofPlayers(db) {
  const hofPath = require('path').join(__dirname, 'data', 'hof-players.json');
  if (!require('fs').existsSync(hofPath)) return;
  const players = JSON.parse(require('fs').readFileSync(hofPath, 'utf8'));
  const insert = db.prepare(`
    INSERT OR IGNORE INTO player_metadata (player_name, tier, hof_induction_year, hof_position, hof_primary_team)
    VALUES (?, 'hof', ?, ?, ?)
  `);
  const seed = db.transaction(() => {
    for (const p of players) {
      insert.run(p.name.toLowerCase().trim(), p.year, p.position, p.team);
    }
  });
  seed();
  console.log(`[Seed] Loaded ${players.length} HOF players`);
}


function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setMeta(db, key, value) {
  db.prepare(
    `INSERT INTO app_meta (key, value, updated_at) VALUES (?, ?, datetime('now','localtime'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value);
}

module.exports = { openDb, backupDb, getMeta, setMeta, DB_PATH, DB_DIR };
