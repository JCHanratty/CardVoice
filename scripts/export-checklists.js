#!/usr/bin/env node
/**
 * Export all approved checklists from your dev database into a
 * portable checklist-catalog.db that ships with each release.
 *
 * Usage: node scripts/export-checklists.js [version]
 * Example: node scripts/export-checklists.js 2026.02.1
 */
const path = require('path');
const fs = require('fs');
const Database = require(path.join(__dirname, '..', 'server', 'node_modules', 'better-sqlite3'));

const version = process.argv[2] || new Date().toISOString().slice(0, 10).replace(/-/g, '.');

// Source: your dev database
const { DB_PATH } = require('../server/db');
if (!fs.existsSync(DB_PATH)) {
  console.error(`Source DB not found at ${DB_PATH}`);
  process.exit(1);
}

const srcDb = new Database(DB_PATH, { readonly: true });

// Destination: bundled catalog
const outDir = path.join(__dirname, '..', 'electron', 'resources');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'checklist-catalog.db');

// Remove old catalog if it exists
if (fs.existsSync(outPath)) fs.unlinkSync(outPath);

const destDb = new Database(outPath);
destDb.pragma('journal_mode = WAL');

// Create schema (mirrors main DB but only checklist-relevant tables)
destDb.exec(`
  CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS card_sets (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    year        INTEGER,
    brand       TEXT,
    sport       TEXT DEFAULT 'Baseball',
    total_cards INTEGER DEFAULT 0,
    UNIQUE(name, year)
  );

  CREATE TABLE IF NOT EXISTS cards (
    id          INTEGER PRIMARY KEY,
    set_id      INTEGER NOT NULL REFERENCES card_sets(id),
    card_number TEXT NOT NULL,
    player      TEXT NOT NULL,
    team        TEXT DEFAULT '',
    rc_sp       TEXT DEFAULT '',
    insert_type TEXT DEFAULT 'Base',
    parallel    TEXT DEFAULT '',
    qty         INTEGER DEFAULT 0
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_card_variant
    ON cards(set_id, card_number, insert_type, parallel);

  CREATE TABLE IF NOT EXISTS set_insert_types (
    id           INTEGER PRIMARY KEY,
    set_id       INTEGER NOT NULL REFERENCES card_sets(id),
    name         TEXT NOT NULL,
    card_count   INTEGER DEFAULT 0,
    odds         TEXT DEFAULT '',
    section_type TEXT DEFAULT 'base',
    UNIQUE(set_id, name)
  );

  CREATE TABLE IF NOT EXISTS set_parallels (
    id             INTEGER PRIMARY KEY,
    set_id         INTEGER NOT NULL REFERENCES card_sets(id),
    name           TEXT NOT NULL,
    print_run      INTEGER,
    exclusive      TEXT DEFAULT '',
    notes          TEXT DEFAULT '',
    serial_max     INTEGER,
    channels       TEXT DEFAULT '',
    variation_type TEXT DEFAULT 'parallel',
    UNIQUE(set_id, name)
  );
`);

// Copy data
const copyData = destDb.transaction(() => {
  const sets = srcDb.prepare('SELECT * FROM card_sets').all();
  const insertSet = destDb.prepare(
    'INSERT INTO card_sets (id, name, year, brand, sport, total_cards) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const s of sets) {
    insertSet.run(s.id, s.name, s.year, s.brand, s.sport, s.total_cards);
  }

  // Cards — qty forced to 0 (no ownership data shipped)
  const cards = srcDb.prepare('SELECT * FROM cards').all();
  const insertCard = destDb.prepare(
    'INSERT INTO cards (id, set_id, card_number, player, team, rc_sp, insert_type, parallel, qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)'
  );
  for (const c of cards) {
    insertCard.run(c.id, c.set_id, c.card_number, c.player, c.team, c.rc_sp, c.insert_type, c.parallel);
  }

  // Insert types
  const insertTypes = srcDb.prepare('SELECT * FROM set_insert_types').all();
  const insertIT = destDb.prepare(
    'INSERT INTO set_insert_types (id, set_id, name, card_count, odds, section_type) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const it of insertTypes) {
    insertIT.run(it.id, it.set_id, it.name, it.card_count, it.odds, it.section_type);
  }

  // Parallels
  const parallels = srcDb.prepare('SELECT * FROM set_parallels').all();
  const insertP = destDb.prepare(
    'INSERT INTO set_parallels (id, set_id, name, print_run, exclusive, notes, serial_max, channels, variation_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const p of parallels) {
    insertP.run(p.id, p.set_id, p.name, p.print_run, p.exclusive, p.notes, p.serial_max, p.channels, p.variation_type);
  }

  // Stamp version
  destDb.prepare(
    "INSERT INTO app_meta (key, value) VALUES ('catalog_version', ?)"
  ).run(version);
});

copyData();

const setCount = destDb.prepare('SELECT COUNT(*) as cnt FROM card_sets').get().cnt;
const cardCount = destDb.prepare('SELECT COUNT(*) as cnt FROM cards').get().cnt;

srcDb.close();
destDb.close();

console.log(`Catalog v${version} exported to ${outPath}`);
console.log(`  ${setCount} sets, ${cardCount} cards (all qty=0)`);
