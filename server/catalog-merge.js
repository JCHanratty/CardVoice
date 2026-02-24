/**
 * Merge a bundled checklist catalog into the user's local database.
 * SAFETY: Never modifies qty — only inserts new cards (qty=0) or updates metadata.
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { backupDb, getMeta, setMeta } = require('./db');

/**
 * Compare dot-separated version strings numerically.
 * Returns true if `a` is newer than `b`.
 */
function versionIsNewer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const av = pa[i] || 0, bv = pb[i] || 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  return false;
}

/**
 * Resolve the catalog DB path (packaged vs dev).
 */
function getCatalogPath(isPackaged) {
  const candidates = [];
  if (isPackaged && process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'checklist-catalog.db'));
  }
  // Dev fallback: look in electron/resources/
  candidates.push(path.join(__dirname, '..', 'electron', 'resources', 'checklist-catalog.db'));
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Merge the bundled catalog into the user's DB.
 * @param {import('better-sqlite3').Database} db - User's database
 * @param {object} [opts]
 * @param {boolean} [opts.isPackaged] - Whether running packaged
 * @param {string}  [opts.catalogPath] - Override catalog path (for testing)
 * @param {boolean} [opts.force] - Skip version check (for on-demand TCDB imports)
 * @returns {{ skipped: boolean, reason?: string, added?: object, updated?: object }}
 */
function mergeCatalog(db, opts = {}) {
  const catalogPath = opts.catalogPath || getCatalogPath(!!opts.isPackaged);

  if (!catalogPath) {
    return { skipped: true, reason: 'No catalog file found' };
  }

  let catalogDb;
  try {
    catalogDb = new Database(catalogPath, { readonly: true });
  } catch (err) {
    return { skipped: true, reason: `Cannot open catalog: ${err.message}` };
  }

  try {
    // Check versions
    const catalogVersionRow = catalogDb.prepare(
      "SELECT value FROM app_meta WHERE key = 'catalog_version'"
    ).get();
    const catalogVersion = catalogVersionRow ? catalogVersionRow.value : '0';
    const userVersion = getMeta(db, 'catalog_version') || '0';

    if (!opts.force && !versionIsNewer(catalogVersion, userVersion)) {
      catalogDb.close();
      return { skipped: true, reason: `Already up to date (user: ${userVersion}, catalog: ${catalogVersion})` };
    }

    console.log(`[Catalog] Merging v${catalogVersion} (current: ${userVersion})...`);

    // Backup before merge
    backupDb();

    const results = {
      skipped: false,
      catalogVersion,
      sets: { added: 0, existing: 0 },
      cards: { added: 0, updated: 0 },
      insertTypes: { added: 0 },
      parallels: { added: 0 },
    };

    // Prepared statements for user DB
    const findSetByNameYear = db.prepare('SELECT id FROM card_sets WHERE name = ? AND year = ?');
    const findSetByNameNullYear = db.prepare('SELECT id FROM card_sets WHERE name = ? AND year IS NULL');
    const createSet = db.prepare('INSERT INTO card_sets (name, year, brand, sport, total_cards) VALUES (?, ?, ?, ?, 0)');
    const findCard = db.prepare('SELECT id, qty FROM cards WHERE set_id = ? AND card_number = ? AND insert_type = ? AND parallel = ?');
    const insertCard = db.prepare('INSERT INTO cards (set_id, card_number, player, team, rc_sp, insert_type, parallel, qty, image_path) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)');
    const updateCardMeta = db.prepare('UPDATE cards SET player = ?, team = ?, rc_sp = ?, image_path = CASE WHEN ? != \'\' THEN ? ELSE image_path END WHERE id = ?');
    const upsertInsertType = db.prepare(`
      INSERT INTO set_insert_types (set_id, name, card_count, odds, section_type)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(set_id, name) DO UPDATE SET
        card_count = excluded.card_count,
        odds = excluded.odds,
        section_type = COALESCE(excluded.section_type, set_insert_types.section_type)
    `);
    const upsertParallel = db.prepare(`
      INSERT INTO set_parallels (set_id, name, print_run, exclusive, notes, serial_max, channels, variation_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(set_id, name) DO UPDATE SET
        print_run = COALESCE(excluded.print_run, set_parallels.print_run),
        exclusive = CASE WHEN excluded.exclusive != '' THEN excluded.exclusive ELSE set_parallels.exclusive END,
        notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE set_parallels.notes END,
        serial_max = COALESCE(excluded.serial_max, set_parallels.serial_max),
        channels = CASE WHEN excluded.channels != '' THEN excluded.channels ELSE set_parallels.channels END,
        variation_type = CASE WHEN excluded.variation_type != 'parallel' THEN excluded.variation_type ELSE set_parallels.variation_type END
    `);

    const catalogSets = catalogDb.prepare('SELECT * FROM card_sets ORDER BY id').all();

    const doMerge = db.transaction(() => {
      const setIdMap = {};

      for (const catSet of catalogSets) {
        const existing = catSet.year != null
          ? findSetByNameYear.get(catSet.name, catSet.year)
          : findSetByNameNullYear.get(catSet.name);

        if (existing) {
          setIdMap[catSet.id] = existing.id;
          results.sets.existing++;
        } else {
          const info = createSet.run(catSet.name, catSet.year, catSet.brand, catSet.sport);
          setIdMap[catSet.id] = Number(info.lastInsertRowid);
          results.sets.added++;
        }

        const userSetId = setIdMap[catSet.id];

        // Merge insert types
        const catInsertTypes = catalogDb.prepare('SELECT * FROM set_insert_types WHERE set_id = ?').all(catSet.id);
        for (const it of catInsertTypes) {
          upsertInsertType.run(userSetId, it.name, it.card_count, it.odds, it.section_type);
          results.insertTypes.added++;
        }

        // Merge parallels
        const catParallels = catalogDb.prepare('SELECT * FROM set_parallels WHERE set_id = ?').all(catSet.id);
        for (const p of catParallels) {
          upsertParallel.run(userSetId, p.name, p.print_run, p.exclusive, p.notes, p.serial_max, p.channels, p.variation_type);
          results.parallels.added++;
        }

        // Merge cards — NEVER touch qty
        const catCards = catalogDb.prepare('SELECT * FROM cards WHERE set_id = ?').all(catSet.id);
        for (const card of catCards) {
          const existingCard = findCard.get(userSetId, card.card_number, card.insert_type, card.parallel);
          if (existingCard) {
            const imgPath = card.image_path || '';
            updateCardMeta.run(card.player, card.team, card.rc_sp, imgPath, imgPath, existingCard.id);
            results.cards.updated++;
          } else {
            insertCard.run(userSetId, card.card_number, card.player, card.team, card.rc_sp, card.insert_type, card.parallel, card.image_path || '');
            results.cards.added++;
          }
        }

        // Update total_cards count
        const count = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE set_id = ?').get(userSetId);
        db.prepare('UPDATE card_sets SET total_cards = ? WHERE id = ?').run(count.cnt, userSetId);
      }

      setMeta(db, 'catalog_version', catalogVersion);
    });

    doMerge();

    console.log(`[Catalog] Merge complete: ${results.sets.added} sets added, ${results.cards.added} cards added, ${results.cards.updated} cards updated`);

    catalogDb.close();
    return results;

  } catch (err) {
    catalogDb.close();
    console.error(`[Catalog] Merge failed:`, err.message);
    return { skipped: true, reason: `Merge failed: ${err.message}` };
  }
}

module.exports = { mergeCatalog, getCatalogPath };
