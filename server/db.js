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
      qty         INTEGER DEFAULT 0
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

  // Pricing indexes
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_price_history_card ON price_history(card_id)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_price_history_set ON price_history(set_id)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_price_snapshots_date ON price_snapshots(snapshot_date)`); } catch(e) {}
  try { db.exec(`CREATE INDEX IF NOT EXISTS idx_tracked_cards_card ON tracked_cards(card_id)`); } catch(e) {}

  return db;
}


module.exports = { openDb, backupDb, DB_PATH, DB_DIR };
