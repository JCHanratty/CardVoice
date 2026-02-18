/**
 * Dry-run migration test against the real JCHanratty database.
 * Uses an in-memory CardVoice DB so nothing is written to disk.
 * Run: node tests/test-migration-dry-run.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const { openDb } = require('../db');

const db = openDb(':memory:');

const binderDbPath = path.join(
  'c:', 'Users', 'jorda', 'Desktop',
  'Baseball Check Lists', 'card-collection', 'card_collection.db'
);

let binderDb;
try {
  binderDb = new Database(binderDbPath, { readonly: true });
} catch (err) {
  console.log('Could not open JCHanratty DB:', err.message);
  console.log('Skipping migration dry-run test.');
  process.exit(0);
}

const tables = binderDb.prepare(
  "SELECT name FROM sqlite_master WHERE type='table'"
).all().map(r => r.name);

const hasNewSystem = tables.includes('products') && tables.includes('checklist_cards');
const hasOldSystem = tables.includes('checklists');

const findSet = db.prepare('SELECT id FROM card_sets WHERE name = ?');
const createSet = db.prepare(
  'INSERT INTO card_sets (name, year, brand, sport, total_cards) VALUES (?, ?, ?, ?, 0)'
);
const insertCard = db.prepare(
  `INSERT INTO cards (set_id, card_number, player, team, rc_sp, insert_type, parallel, qty)
   VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
);
const findCard = db.prepare(
  'SELECT id, qty FROM cards WHERE set_id = ? AND card_number = ? AND insert_type = ? AND parallel = ?'
);
const upsertInsertType = db.prepare(`
  INSERT INTO set_insert_types (set_id, name, card_count, odds)
  VALUES (?, ?, ?, '')
  ON CONFLICT(set_id, name) DO UPDATE SET card_count = excluded.card_count
`);

let newCards = 0, newSets = 0, oldCards = 0, oldSets = 0;

const migrate = db.transaction(() => {
  // === New system: products → product_checklists → checklist_cards ===
  if (hasNewSystem) {
    const products = binderDb.prepare('SELECT * FROM products').all();
    for (const product of products) {
      const productName = product.name || 'Unknown';
      const year = product.year || null;
      const setName = year ? `${year} ${productName}` : productName;
      const brand = productName.split(/\s+/)[0] || null;

      const existing = findSet.get(setName);
      if (existing) { console.log('  SKIP (new):', setName); continue; }

      const setInfo = createSet.run(setName, year, brand, 'Baseball');
      const newSetId = setInfo.lastInsertRowid;
      newSets++;

      const checklists = binderDb.prepare(
        'SELECT * FROM product_checklists WHERE product_id = ?'
      ).all(product.id);

      for (const cl of checklists) {
        const insertTypeName = cl.display_name || 'Base';
        const cards = binderDb.prepare(
          'SELECT * FROM checklist_cards WHERE checklist_id = ?'
        ).all(cl.id);

        upsertInsertType.run(newSetId, insertTypeName, cards.length);

        for (const card of cards) {
          let rcSpParts = [];
          if (card.flags) {
            try {
              const parsed = JSON.parse(card.flags);
              if (Array.isArray(parsed)) rcSpParts = parsed;
            } catch (_) {}
          }
          const existingCard = findCard.get(newSetId, card.card_number || '', insertTypeName, '');
          if (!existingCard) {
            insertCard.run(
              newSetId, card.card_number || '', card.player_name || '',
              card.team || '', rcSpParts.join(' '), insertTypeName, ''
            );
            newCards++;
          }
        }
      }

      const count = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE set_id = ?').get(newSetId);
      db.prepare('UPDATE card_sets SET total_cards = ? WHERE id = ?').run(count.cnt, newSetId);
      console.log(`  New: ${setName} — ${count.cnt} cards`);
    }
  }

  // === Old system: checklists table ===
  if (hasOldSystem) {
    const oldSetGroups = binderDb.prepare(`
      SELECT DISTINCT
        COALESCE(set_name, 'Unknown') as set_name,
        COALESCE(year, 0) as year
      FROM checklists
      ORDER BY year DESC, set_name
    `).all();

    for (const oldSet of oldSetGroups) {
      const yearNum = oldSet.year ? parseInt(String(oldSet.year), 10) : null;
      const setName = yearNum ? `${yearNum} ${oldSet.set_name}` : oldSet.set_name;

      const existing = findSet.get(setName);
      if (existing) { console.log('  SKIP (old):', setName); continue; }

      const brandGuess = oldSet.set_name.split(/\s+/)[0] || null;
      const setInfo = createSet.run(setName, yearNum, brandGuess, 'Baseball');
      const newSetId = setInfo.lastInsertRowid;
      oldSets++;

      const rows = binderDb.prepare(
        'SELECT * FROM checklists WHERE COALESCE(set_name, ?) = ? AND COALESCE(year, 0) = ?'
      ).all(oldSet.set_name, oldSet.set_name, oldSet.year);

      for (const row of rows) {
        const cardNumber = String(row.card_number || '');
        const insertType = row.variety || 'Base';
        const parallel = row.parallel || '';
        const existingCard = findCard.get(newSetId, cardNumber, insertType, parallel);
        if (!existingCard) {
          insertCard.run(
            newSetId, cardNumber, row.player || '', row.team || '',
            row.rookie ? 'RC' : '', insertType, parallel
          );
          oldCards++;
        }
        if (insertType && insertType !== 'Base') {
          try { upsertInsertType.run(newSetId, insertType, 0); } catch (_) {}
        }
      }

      const count = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE set_id = ?').get(newSetId);
      db.prepare('UPDATE card_sets SET total_cards = ? WHERE id = ?').run(count.cnt, newSetId);
      console.log(`  Old: ${setName} — ${count.cnt} cards`);
    }
  }
});

console.log('=== Migration Dry Run ===\n');
migrate();
binderDb.close();

console.log('\n=== RESULTS ===');
console.log(`New system: ${newSets} sets, ${newCards} cards`);
console.log(`Old system: ${oldSets} sets, ${oldCards} cards`);
console.log(`Total sets in CardVoice: ${db.prepare('SELECT COUNT(*) as cnt FROM card_sets').get().cnt}`);
console.log(`Total cards in CardVoice: ${db.prepare('SELECT COUNT(*) as cnt FROM cards').get().cnt}`);
console.log(`Total insert types: ${db.prepare('SELECT COUNT(*) as cnt FROM set_insert_types').get().cnt}`);

// Sample verification
const sampleSet = db.prepare('SELECT * FROM card_sets LIMIT 1').get();
if (sampleSet) {
  console.log(`\nSample set: "${sampleSet.name}" (${sampleSet.year}, ${sampleSet.brand})`);
  const sampleCards = db.prepare('SELECT * FROM cards WHERE set_id = ? LIMIT 3').all(sampleSet.id);
  for (const c of sampleCards) {
    console.log(`  Card: ${c.card_number} — ${c.player} (${c.team}) [${c.insert_type}] qty=${c.qty}`);
  }
}

db.close();
console.log('\nDry run complete — no data written to disk.');
