/**
 * Export checklist definitions from the database to JSON files.
 * These files contain only set structure (no user ownership data).
 * Usage: node scripts/export-checklists.js
 */
const path = require('path');
const fs = require('fs');
const { openDb } = require('../server/db');

const db = openDb();
const outputDir = path.join(__dirname, '..', 'checklists');

const sets = db.prepare('SELECT * FROM card_sets ORDER BY year DESC, name').all();

if (sets.length === 0) {
  console.log('No sets found in database.');
  process.exit(0);
}

let exported = 0;

for (const set of sets) {
  const year = set.year || 'unknown';
  const brand = (set.brand || 'unknown').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  const name = set.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

  const dir = path.join(outputDir, String(year));
  fs.mkdirSync(dir, { recursive: true });

  const insertTypes = db.prepare(
    'SELECT name, card_count, odds, section_type FROM set_insert_types WHERE set_id = ? ORDER BY id'
  ).all(set.id);

  const parallels = db.prepare(
    'SELECT name, print_run, exclusive, notes, serial_max, channels, variation_type FROM set_parallels WHERE set_id = ? ORDER BY id'
  ).all(set.id);

  const cards = db.prepare(
    'SELECT card_number, player, team, rc_sp, insert_type, parallel FROM cards WHERE set_id = ? ORDER BY insert_type, CAST(card_number AS INTEGER), card_number'
  ).all(set.id);

  const output = {
    name: set.name,
    year: set.year,
    brand: set.brand,
    sport: set.sport,
    totalCards: set.total_cards,
    insertTypes: insertTypes.map(it => ({
      name: it.name,
      cardCount: it.card_count,
      odds: it.odds,
      sectionType: it.section_type,
    })),
    parallels: parallels.map(p => ({
      name: p.name,
      printRun: p.print_run,
      serialMax: p.serial_max,
      exclusive: p.exclusive,
      channels: p.channels,
      variationType: p.variation_type,
      notes: p.notes,
    })),
    cards: cards.map(c => ({
      number: c.card_number,
      player: c.player,
      team: c.team,
      rcSp: c.rc_sp,
      insertType: c.insert_type,
      parallel: c.parallel,
    })),
  };

  const filePath = path.join(dir, `${brand}-${name}.json`);
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2));
  console.log(`  Exported: ${filePath}`);
  exported++;
}

db.close();
console.log(`\nDone. Exported ${exported} set(s) to ${outputDir}`);
