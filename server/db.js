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

  // Migration: scope parallels to specific insert types (NULL = base parallel)
  const parallelScopeCols = [
    'ALTER TABLE set_parallels ADD COLUMN insert_type_id INTEGER REFERENCES set_insert_types(id) ON DELETE SET NULL',
  ];
  for (const sql of parallelScopeCols) {
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

  // Migration: tracked toggle for insert types (progress stats, tree expansion)
  const trackedCols = [
    "ALTER TABLE set_insert_types ADD COLUMN tracked INTEGER DEFAULT 0",
  ];
  for (const sql of trackedCols) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }

  // Set tracked = 1 for all Base insert types
  db.prepare("UPDATE set_insert_types SET tracked = 1 WHERE name = 'Base' AND tracked = 0").run();

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

  // Migration: hierarchy data quality fixes (v2)
  _migrateHierarchyFixV2(db);

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


/**
 * Delete a card_set and all dependent rows (cascade manually for tables
 * that don't have ON DELETE CASCADE or need extra cleanup).
 */
function deleteSetCascade(db, setId) {
  db.prepare('DELETE FROM price_history WHERE set_id = ?').run(setId);
  db.prepare('DELETE FROM price_snapshots WHERE set_id = ?').run(setId);
  db.prepare('DELETE FROM price_history WHERE card_id IN (SELECT id FROM cards WHERE set_id = ?)').run(setId);
  db.prepare('DELETE FROM price_snapshots WHERE card_id IN (SELECT id FROM cards WHERE set_id = ?)').run(setId);
  db.prepare('DELETE FROM tracked_cards WHERE card_id IN (SELECT id FROM cards WHERE set_id = ?)').run(setId);
  db.prepare('DELETE FROM card_parallels WHERE card_id IN (SELECT id FROM cards WHERE set_id = ?)').run(setId);
  db.prepare('DELETE FROM insert_type_parallels WHERE insert_type_id IN (SELECT id FROM set_insert_types WHERE set_id = ?)').run(setId);
  db.prepare('DELETE FROM cards WHERE set_id = ?').run(setId);
  db.prepare('DELETE FROM set_insert_types WHERE set_id = ?').run(setId);
  db.prepare('DELETE FROM set_parallels WHERE set_id = ?').run(setId);
  db.prepare('DELETE FROM voice_sessions WHERE set_id = ?').run(setId);
  db.prepare('DELETE FROM card_sets WHERE id = ?').run(setId);
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

/**
 * Backfill missing "Base" insert type for ALL sets that have Base cards but no
 * set_insert_types row named 'Base'. Idempotent — runs on every startup,
 * skips sets that already have it.
 */
function _backfillBaseInsertTypes(db) {
  const missingBase = db.prepare(`
    SELECT cs.id as set_id,
      (SELECT COUNT(*) FROM cards WHERE set_id = cs.id AND insert_type = 'Base') as base_cards
    FROM card_sets cs
    WHERE EXISTS (SELECT 1 FROM cards WHERE set_id = cs.id AND insert_type = 'Base')
      AND NOT EXISTS (SELECT 1 FROM set_insert_types WHERE set_id = cs.id AND name = 'Base')
  `).all();

  if (missingBase.length === 0) return;

  const insert = db.prepare(
    "INSERT OR IGNORE INTO set_insert_types (set_id, name, card_count, section_type) VALUES (?, 'Base', ?, 'base')"
  );
  const run = db.transaction(() => {
    for (const row of missingBase) {
      insert.run(row.set_id, row.base_cards);
    }
  });
  run();
  console.log(`[Migration] Backfilled ${missingBase.length} missing Base insert types`);
}


/**
 * Hierarchy Fix V2 — data quality cleanup migration.
 * Fixes: phantom Base in inserts, empty Series shells, duplicate insert names,
 * Chrome/Foil variant inserts → parallels, and scoping existing parallels.
 * Idempotent — guarded by app_meta flag.
 */
function _migrateHierarchyFixV2(db) {
  // Fix 7 (backfill Base insert types) runs independently — always check
  _backfillBaseInsertTypes(db);

  if (getMeta(db, 'hierarchy_fix_v2_done') === '1') return;

  const { PARALLEL_KEYWORDS } = require('./parallel-keywords');

  console.log('[Migration] Running hierarchy fix v2...');

  const migrate = db.transaction(() => {
    // ── Fix 4: Delete phantom "Base" entries from insert child sets ──
    // These are 0-card "Base" insert types auto-created in insert child sets
    let fix4 = 0;
    try {
      const result = db.prepare(`
        DELETE FROM set_insert_types
        WHERE name = 'Base' AND card_count = 0
          AND set_id IN (SELECT id FROM card_sets WHERE set_type = 'insert')
      `).run();
      fix4 = result.changes;
    } catch (_) {
      // set_type column may not exist — skip silently
    }
    console.log(`[Migration]   Fix 4: Deleted ${fix4} phantom Base entries`);

    // ── Fix 3: Merge empty Series shell sets into bloated parent ──
    let fix3 = 0;
    try {
      const emptyShells = db.prepare(`
        SELECT cs.* FROM card_sets cs
        WHERE cs.total_cards = 0
          AND (cs.name LIKE '% Series 1' OR cs.name LIKE '% Series 2')
          AND EXISTS (SELECT 1 FROM card_sets ch WHERE ch.parent_set_id = cs.id)
      `).all();

      for (const shell of emptyShells) {
        const baseName = shell.name.replace(/\s+Series\s+(1|2|One|Two)\s*$/i, '').trim();
        const realParent = db.prepare(`
          SELECT * FROM card_sets WHERE id != ? AND year = ? AND name = ? AND total_cards > 0
          ORDER BY total_cards DESC LIMIT 1
        `).get(shell.id, shell.year, baseName);

        if (realParent) {
          // Reassign children from shell to real parent
          db.prepare('UPDATE card_sets SET parent_set_id = ? WHERE parent_set_id = ?')
            .run(realParent.id, shell.id);

          // Merge insert types from shell to real parent (skip duplicates)
          const shellInserts = db.prepare('SELECT * FROM set_insert_types WHERE set_id = ?').all(shell.id);
          for (const si of shellInserts) {
            const exists = db.prepare('SELECT id FROM set_insert_types WHERE set_id = ? AND name = ?')
              .get(realParent.id, si.name);
            if (!exists) {
              db.prepare('INSERT INTO set_insert_types (set_id, name, card_count, odds, section_type) VALUES (?, ?, ?, ?, ?)')
                .run(realParent.id, si.name, si.card_count, si.odds, si.section_type);
            }
          }

          // Merge parallels from shell to real parent (skip duplicates)
          const shellParallels = db.prepare('SELECT * FROM set_parallels WHERE set_id = ?').all(shell.id);
          for (const sp of shellParallels) {
            const exists = db.prepare('SELECT id FROM set_parallels WHERE set_id = ? AND name = ?')
              .get(realParent.id, sp.name);
            if (!exists) {
              db.prepare(`INSERT INTO set_parallels (set_id, name, print_run, exclusive, notes, serial_max, channels, variation_type)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(realParent.id, sp.name, sp.print_run, sp.exclusive, sp.notes, sp.serial_max, sp.channels, sp.variation_type);
            }
          }

          // Delete empty shell
          deleteSetCascade(db, shell.id);
          fix3++;
        }
      }
    } catch (_) {
      // parent_set_id column may not exist — skip silently
    }
    console.log(`[Migration]   Fix 3: Merged ${fix3} empty Series shell sets`);

    // ── Fix 6: Merge duplicate insert type names ──
    // Normalize by removing "Topps", "Baseball", "Topps Baseball" tokens
    function normalize(name) {
      return name.replace(/\bTopps\s+Baseball\b/gi, '').replace(/\bTopps\b/gi, '')
        .replace(/\bBaseball\b/gi, '').replace(/\s+/g, ' ').trim();
    }

    let fix6 = 0;
    const allSets = db.prepare('SELECT id FROM card_sets').all();
    for (const cs of allSets) {
      const inserts = db.prepare('SELECT * FROM set_insert_types WHERE set_id = ? ORDER BY id').all(cs.id);
      const groups = {};
      for (const ins of inserts) {
        const norm = normalize(ins.name);
        if (!groups[norm]) groups[norm] = [];
        groups[norm].push(ins);
      }
      for (const [, group] of Object.entries(groups)) {
        if (group.length < 2) continue;
        const keeper = group[0]; // keep the first occurrence
        for (let i = 1; i < group.length; i++) {
          const dupe = group[i];
          // Update cards referencing the dupe insert type name
          db.prepare('UPDATE cards SET insert_type = ? WHERE set_id = ? AND insert_type = ?')
            .run(keeper.name, cs.id, dupe.name);
          // Merge child set references if parent_set_id exists
          try {
            db.prepare('UPDATE card_sets SET parent_set_id = ? WHERE parent_set_id IN (SELECT id FROM card_sets WHERE name = ? AND year = ?)')
              .run(cs.id, dupe.name, null); // best-effort
          } catch (_) {}
          // Take max card_count
          if (dupe.card_count > keeper.card_count) {
            db.prepare('UPDATE set_insert_types SET card_count = ? WHERE id = ?').run(dupe.card_count, keeper.id);
          }
          // Clean up pricing data for dupe
          db.prepare('DELETE FROM price_snapshots WHERE insert_type_id = ?').run(dupe.id);
          db.prepare('DELETE FROM price_history WHERE insert_type_id = ?').run(dupe.id);
          // Migrate junction entries
          db.prepare('UPDATE OR IGNORE insert_type_parallels SET insert_type_id = ? WHERE insert_type_id = ?')
            .run(keeper.id, dupe.id);
          db.prepare('DELETE FROM insert_type_parallels WHERE insert_type_id = ?').run(dupe.id);
          // Delete the duplicate insert type
          db.prepare('DELETE FROM set_insert_types WHERE id = ?').run(dupe.id);
          fix6++;
        }
      }
    }
    console.log(`[Migration]   Fix 6: Merged ${fix6} duplicate insert type names`);

    // ── Fix 2 + Fix 5: Convert Chrome/Foil variant inserts → parallels ──
    let fix2 = 0;
    for (const cs of allSets) {
      const inserts = db.prepare('SELECT * FROM set_insert_types WHERE set_id = ? ORDER BY LENGTH(name) DESC, id')
        .all(cs.id);
      // Build map of name → insert (shortest-last so we can match against shorter names)
      const insertByName = new Map();
      // Insert in ascending length order so shortest names are in the map first
      const byLenAsc = [...inserts].sort((a, b) => a.name.length - b.name.length);
      for (const ins of byLenAsc) insertByName.set(ins.name, ins);

      // Now iterate in descending length order (longest names first = most specific)
      for (const ins of inserts) {
        for (const [baseName, baseInsert] of insertByName) {
          if (baseName === ins.name || !ins.name.startsWith(baseName + ' ')) continue;
          const suffix = ins.name.slice(baseName.length + 1).trim();
          const lower = suffix.toLowerCase();
          const isParallel = PARALLEL_KEYWORDS.some(kw =>
            lower === kw || lower.startsWith(kw + ' ') || lower.endsWith(' ' + kw) || lower.includes(kw)
          );
          if (isParallel) {
            // 1. Upsert set_parallels with insert_type_id
            const existingPar = db.prepare('SELECT id FROM set_parallels WHERE set_id = ? AND name = ?')
              .get(cs.id, suffix);
            if (existingPar) {
              db.prepare('UPDATE set_parallels SET insert_type_id = ? WHERE id = ?')
                .run(baseInsert.id, existingPar.id);
            } else {
              db.prepare(`INSERT INTO set_parallels (set_id, name, insert_type_id, variation_type)
                VALUES (?, ?, ?, 'parallel')`)
                .run(cs.id, suffix, baseInsert.id);
            }

            // 2. For each card with this insert_type, convert to base insert + parallel
            const cardsToConvert = db.prepare(
              'SELECT * FROM cards WHERE set_id = ? AND insert_type = ?'
            ).all(cs.id, ins.name);

            for (const card of cardsToConvert) {
              // Check if base card exists
              const baseCard = db.prepare(
                "SELECT id FROM cards WHERE set_id = ? AND card_number = ? AND insert_type = ? AND parallel = ''"
              ).get(cs.id, card.card_number, baseName);

              if (!baseCard) {
                // Create placeholder base card with qty=0
                db.prepare(`INSERT INTO cards (set_id, card_number, player, team, rc_sp, insert_type, parallel, qty, image_path)
                  VALUES (?, ?, ?, ?, ?, ?, '', 0, ?)`)
                  .run(cs.id, card.card_number, card.player, card.team, card.rc_sp, baseName, card.image_path);
              }

              // Update card: change insert_type to base, set parallel to suffix
              db.prepare('UPDATE cards SET insert_type = ?, parallel = ? WHERE id = ?')
                .run(baseName, suffix, card.id);
            }

            // 3. Clean up pricing data for the old insert type
            db.prepare('DELETE FROM price_snapshots WHERE insert_type_id = ?').run(ins.id);
            db.prepare('DELETE FROM price_history WHERE insert_type_id = ?').run(ins.id);
            db.prepare('DELETE FROM insert_type_parallels WHERE insert_type_id = ?').run(ins.id);

            // 4. Delete the insert type
            db.prepare('DELETE FROM set_insert_types WHERE id = ?').run(ins.id);
            insertByName.delete(ins.name);
            fix2++;
            break; // matched — move to next insert
          }
        }
      }
    }
    console.log(`[Migration]   Fix 2+5: Converted ${fix2} variant inserts to parallels`);

    // ── Fix 1: Scope existing insert-prefixed parallels ──
    let fix1 = 0;
    const allParallels = db.prepare(`
      SELECT sp.id, sp.set_id, sp.name, sit.id as found_insert_type_id, sit.name as insert_name
      FROM set_parallels sp
      JOIN set_insert_types sit ON sit.set_id = sp.set_id
      WHERE sp.insert_type_id IS NULL AND sp.name LIKE sit.name || ' %'
      ORDER BY LENGTH(sit.name) DESC
    `).all();

    const processed = new Set();
    for (const row of allParallels) {
      if (processed.has(row.id)) continue;
      processed.add(row.id);

      const suffix = row.name.slice(row.insert_name.length + 1).trim();
      if (!suffix) continue;

      // Check if short-name parallel already exists for this set
      const existing = db.prepare('SELECT id FROM set_parallels WHERE set_id = ? AND name = ? AND id != ?')
        .get(row.set_id, suffix, row.id);

      if (existing) {
        // Short name already exists — scope it and merge the long-named one into it
        db.prepare('UPDATE set_parallels SET insert_type_id = ? WHERE id = ?')
          .run(row.found_insert_type_id, existing.id);
        // Repoint cards from long name to short name
        db.prepare('UPDATE cards SET parallel = ? WHERE set_id = ? AND parallel = ?')
          .run(suffix, row.set_id, row.name);
        // Move junction entries
        db.prepare('UPDATE OR IGNORE insert_type_parallels SET parallel_id = ? WHERE parallel_id = ?')
          .run(existing.id, row.id);
        db.prepare('DELETE FROM insert_type_parallels WHERE parallel_id = ?').run(row.id);
        // Move card_parallels entries
        db.prepare('UPDATE OR IGNORE card_parallels SET parallel_id = ? WHERE parallel_id = ?')
          .run(existing.id, row.id);
        db.prepare('DELETE FROM card_parallels WHERE parallel_id = ?').run(row.id);
        // Delete the long-named duplicate
        db.prepare('DELETE FROM set_parallels WHERE id = ?').run(row.id);
      } else {
        // Rename parallel to just the suffix and set insert_type_id
        db.prepare('UPDATE set_parallels SET name = ?, insert_type_id = ? WHERE id = ?')
          .run(suffix, row.found_insert_type_id, row.id);
        // Update cards.parallel to match the new short name
        db.prepare('UPDATE cards SET parallel = ? WHERE set_id = ? AND parallel = ?')
          .run(suffix, row.set_id, row.name);
      }

      fix1++;
    }
    console.log(`[Migration]   Fix 1: Scoped ${fix1} insert-prefixed parallels`);

    // Fix 7 handled separately in _backfillBaseInsertTypes()
  });

  migrate();
  setMeta(db, 'hierarchy_fix_v2_done', '1');
  console.log('[Migration] Hierarchy fix v2 complete');
}


module.exports = { openDb, backupDb, getMeta, setMeta, deleteSetCascade, DB_PATH, DB_DIR };
