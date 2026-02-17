/**
 * CardVoice Route Handlers
 * Ported from backend/api/main.py — same paths, same JSON shapes.
 */
const { Router } = require('express');
const { backupDb } = require('./db');
const { parseSpokenNumbers, parseCardQuantities, countCards, formatOutput } = require('./parser');
const { parseChecklist, parsePastedChecklist } = require('./hardened-parser');

/**
 * Build an Express router bound to the given better-sqlite3 instance.
 * @param {import('better-sqlite3').Database} db
 * @returns {import('express').Router}
 */
function createRoutes(db) {
  const router = Router();

  // ============================================================
  // Set Endpoints
  // ============================================================

  // GET /api/sets — list all sets (with owned/qty summary)
  router.get('/api/sets', (_req, res) => {
    const sets = db.prepare(
      `SELECT cs.id, cs.name, cs.year, cs.brand, cs.sport, cs.total_cards,
        COALESCE(SUM(CASE WHEN c.qty > 0 THEN 1 ELSE 0 END), 0) as owned_count,
        COALESCE(SUM(c.qty), 0) as total_qty,
        (SELECT COUNT(*) FROM set_insert_types WHERE set_id = cs.id) as section_count
       FROM card_sets cs
       LEFT JOIN cards c ON c.set_id = cs.id
       GROUP BY cs.id
       ORDER BY cs.year DESC, cs.name`
    ).all();
    res.json(sets);
  });

  // POST /api/sets — create set
  router.post('/api/sets', (req, res) => {
    const { name, year, brand, sport } = req.body;
    if (!name) return res.status(400).json({ detail: 'name is required' });

    const yearVal = year ?? null;
    // Exact match: name + year. If no year given, check name-only to prevent duplicates.
    const existing = yearVal !== null
      ? db.prepare('SELECT id FROM card_sets WHERE name = ? AND year = ?').get(name, yearVal)
      : db.prepare('SELECT id FROM card_sets WHERE name = ?').get(name);
    if (existing) return res.status(400).json({ detail: 'Set already exists' });

    const info = db.prepare(
      'INSERT INTO card_sets (name, year, brand, sport) VALUES (?, ?, ?, ?)'
    ).run(name, year ?? null, brand ?? null, sport ?? 'Baseball');

    res.json({ id: info.lastInsertRowid, name });
  });

  // GET /api/sets/:id — get set + cards
  router.get('/api/sets/:id', (req, res) => {
    const setId = Number(req.params.id);
    const cardSet = db.prepare('SELECT * FROM card_sets WHERE id = ?').get(setId);
    if (!cardSet) return res.status(404).json({ detail: 'Set not found' });

    const cards = db.prepare(
      `SELECT id, card_number, player, team, rc_sp, insert_type, parallel, qty
       FROM cards WHERE set_id = ? ORDER BY card_number`
    ).all(setId);

    res.json({
      id: cardSet.id,
      name: cardSet.name,
      year: cardSet.year,
      brand: cardSet.brand,
      total_cards: cards.length,
      cards,
    });
  });

  // PUT /api/sets/:id — update set details (name, year, brand, sport)
  router.put('/api/sets/:id', (req, res) => {
    const setId = Number(req.params.id);
    const cardSet = db.prepare('SELECT * FROM card_sets WHERE id = ?').get(setId);
    if (!cardSet) return res.status(404).json({ detail: 'Set not found' });

    const name = req.body.name ?? cardSet.name;
    const year = req.body.year !== undefined ? req.body.year : cardSet.year;
    const brand = req.body.brand !== undefined ? req.body.brand : cardSet.brand;
    const sport = req.body.sport !== undefined ? req.body.sport : cardSet.sport;

    if (!name) return res.status(400).json({ detail: 'name is required' });

    // Check for duplicate (same name+year, different id)
    const dupe = year != null
      ? db.prepare('SELECT id FROM card_sets WHERE name = ? AND year = ? AND id != ?').get(name, year, setId)
      : db.prepare('SELECT id FROM card_sets WHERE name = ? AND year IS NULL AND id != ?').get(name, setId);
    if (dupe) return res.status(400).json({ detail: 'A set with that name and year already exists' });

    db.prepare('UPDATE card_sets SET name = ?, year = ?, brand = ?, sport = ? WHERE id = ?')
      .run(name, year, brand, sport, setId);

    res.json({ id: setId, name, year, brand, sport });
  });

  // DELETE /api/sets/:id — delete set + cascade
  router.delete('/api/sets/:id', (req, res) => {
    const setId = Number(req.params.id);
    const cardSet = db.prepare('SELECT id FROM card_sets WHERE id = ?').get(setId);
    if (!cardSet) return res.status(404).json({ detail: 'Set not found' });

    // foreign_keys ON + ON DELETE CASCADE handles cards
    db.prepare('DELETE FROM card_sets WHERE id = ?').run(setId);
    res.json({ deleted: true });
  });

  // ============================================================
  // Card Endpoints
  // ============================================================

  // POST /api/sets/:id/cards — bulk add (ADD to qty)
  router.post('/api/sets/:id/cards', (req, res) => {
    const setId = Number(req.params.id);
    const cardSet = db.prepare('SELECT id FROM card_sets WHERE id = ?').get(setId);
    if (!cardSet) return res.status(404).json({ detail: 'Set not found' });

    const { cards } = req.body;
    if (!Array.isArray(cards)) return res.status(400).json({ detail: 'cards array required' });

    const findCard = db.prepare(
      `SELECT id, player, team, rc_sp, qty FROM cards
       WHERE set_id = ? AND card_number = ? AND insert_type = ? AND parallel = ?`
    );
    const insertCard = db.prepare(
      `INSERT INTO cards (set_id, card_number, player, team, rc_sp, insert_type, parallel, qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const updateExisting = db.prepare(
      `UPDATE cards SET player = ?, team = ?, rc_sp = ?, qty = ? WHERE id = ?`
    );

    let added = 0;

    const bulkAdd = db.transaction(() => {
      for (const c of cards) {
        const existing = findCard.get(
          setId, c.card_number, c.insert_type || 'Base', c.parallel || ''
        );

        if (existing) {
          const newPlayer = c.player || existing.player;
          const newTeam = c.team || existing.team;
          const newRcSp = c.rc_sp || existing.rc_sp;
          const newQty = (c.qty > 0) ? existing.qty + c.qty : existing.qty;
          updateExisting.run(newPlayer, newTeam, newRcSp, newQty, existing.id);
        } else {
          insertCard.run(
            setId, c.card_number, c.player || '', c.team || '',
            c.rc_sp || '', c.insert_type || 'Base', c.parallel || '', c.qty || 0
          );
          added++;
        }
      }

      // Recount total
      const count = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE set_id = ?').get(setId);
      db.prepare('UPDATE card_sets SET total_cards = ? WHERE id = ?').run(count.cnt, setId);

      return count.cnt;
    });

    backupDb();
    const total = bulkAdd();

    res.json({ added, total });
  });

  // DELETE /api/cards/:id — delete single card
  router.delete('/api/cards/:id', (req, res) => {
    const cardId = Number(req.params.id);
    const card = db.prepare('SELECT id, set_id FROM cards WHERE id = ?').get(cardId);
    if (!card) return res.status(404).json({ detail: 'Card not found' });

    db.prepare('DELETE FROM cards WHERE id = ?').run(cardId);

    const count = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE set_id = ?').get(card.set_id);
    db.prepare('UPDATE card_sets SET total_cards = ? WHERE id = ?').run(count.cnt, card.set_id);

    res.json({ deleted: true });
  });

  // PUT /api/cards/:id — update card fields (SET qty)
  router.put('/api/cards/:id', (req, res) => {
    const cardId = Number(req.params.id);
    const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
    if (!card) return res.status(404).json({ detail: 'Card not found' });

    const data = req.body;
    const updated = {
      card_number: data.card_number ?? card.card_number,
      player: data.player ?? card.player,
      team: data.team ?? card.team,
      rc_sp: data.rc_sp ?? card.rc_sp,
      insert_type: data.insert_type ?? card.insert_type,
      parallel: data.parallel ?? card.parallel,
      qty: data.qty ?? card.qty,
    };

    db.prepare(
      `UPDATE cards SET card_number=?, player=?, team=?, rc_sp=?, insert_type=?, parallel=?, qty=?
       WHERE id = ?`
    ).run(
      updated.card_number, updated.player, updated.team,
      updated.rc_sp, updated.insert_type, updated.parallel,
      updated.qty, cardId
    );

    res.json({ id: cardId, ...updated });
  });

  // PUT /api/sets/:id/voice-qty — parse voice text, SET qty
  router.put('/api/sets/:id/voice-qty', (req, res) => {
    const setId = Number(req.params.id);
    const cardSet = db.prepare('SELECT id FROM card_sets WHERE id = ?').get(setId);
    if (!cardSet) return res.status(404).json({ detail: 'Set not found' });

    const text = (req.body.text || '').toString();
    const insertType = req.body.insert_type || 'Base';

    // If user said "card", parse card-id / qty pairs
    if (text.toLowerCase().includes('card')) {
      const pairs = parseCardQuantities(text);
      const parsedPairs = pairs.map(p => ({ card: p.card, qty: p.qty, confidence: p.confidence }));

      let updated = 0;
      const notFound = [];

      const findCard = db.prepare(
        'SELECT id FROM cards WHERE set_id = ? AND card_number = ? AND insert_type = ?'
      );
      const setQty = db.prepare('UPDATE cards SET qty = ? WHERE id = ?');

      for (const { card: cardNum, qty } of pairs) {
        const row = findCard.get(setId, String(cardNum), insertType);
        if (row) {
          setQty.run(qty, row.id);
          updated++;
        } else {
          notFound.push(cardNum);
        }
      }

      return res.json({ parsed_pairs: parsedPairs, updated, not_found: notFound });
    }

    // Fallback: each mention = set qty
    const numbers = parseSpokenNumbers(text);
    const counts = countCards(numbers);

    let updated = 0;
    const notFound = [];

    const findCard = db.prepare(
      'SELECT id FROM cards WHERE set_id = ? AND card_number = ? AND insert_type = ?'
    );
    const setQty = db.prepare('UPDATE cards SET qty = ? WHERE id = ?');

    for (const [cardNum, qty] of Object.entries(counts)) {
      const row = findCard.get(setId, String(cardNum), insertType);
      if (row) {
        setQty.run(qty, row.id);
        updated++;
      } else {
        notFound.push(Number(cardNum));
      }
    }

    res.json({
      parsed_numbers: numbers,
      counts,
      updated,
      not_found: notFound,
      output: formatOutput(numbers),
    });
  });

  // ============================================================
  // Voice Session Stats
  // ============================================================

  // POST /api/voice-sessions — save session summary
  router.post('/api/voice-sessions', (req, res) => {
    const { set_id, duration_seconds, total_entries, total_cards,
            edits, deletes, accuracy_pct, cards_per_min,
            insert_type_filter, numbers_raw } = req.body;

    const info = db.prepare(`
      INSERT INTO voice_sessions
        (set_id, timestamp, duration_seconds, total_entries, total_cards,
         edits, deletes, accuracy_pct, cards_per_min,
         insert_type_filter, numbers_raw, cards_updated)
      VALUES (?, datetime('now','localtime'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      set_id || null,
      duration_seconds || 0,
      total_entries || 0,
      total_cards || 0,
      edits || 0,
      deletes || 0,
      accuracy_pct ?? 100,
      cards_per_min || 0,
      insert_type_filter || 'Base',
      numbers_raw || '',
      total_cards || 0
    );

    res.json({ id: info.lastInsertRowid });
  });

  // GET /api/voice-sessions/stats — aggregate lifetime stats
  router.get('/api/voice-sessions/stats', (_req, res) => {
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_sessions,
        COALESCE(SUM(duration_seconds), 0) as total_seconds,
        COALESCE(SUM(total_cards), 0) as total_cards_logged,
        COALESCE(SUM(edits), 0) as total_edits,
        COALESCE(SUM(deletes), 0) as total_deletes,
        COALESCE(SUM(total_entries), 0) as total_entries,
        CASE WHEN SUM(duration_seconds) > 0
          THEN ROUND(SUM(total_cards) * 60.0 / SUM(duration_seconds), 1)
          ELSE 0 END as avg_cards_per_min
      FROM voice_sessions
      WHERE duration_seconds > 0
    `).get();

    const totalActions = (stats.total_entries || 0) + (stats.total_edits || 0) + (stats.total_deletes || 0);
    const totalErrors = (stats.total_edits || 0) + (stats.total_deletes || 0);
    const lifetimeAccuracy = totalActions > 0
      ? Math.round(((totalActions - totalErrors) / totalActions) * 1000) / 10
      : 100;

    res.json({
      total_sessions: stats.total_sessions,
      total_seconds: stats.total_seconds,
      total_cards_logged: stats.total_cards_logged,
      avg_cards_per_min: stats.avg_cards_per_min,
      lifetime_accuracy: lifetimeAccuracy,
    });
  });

  // GET /api/voice-sessions/recent — last N voice sessions with set names
  router.get('/api/voice-sessions/recent', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 5, 20);
    const sessions = db.prepare(`
      SELECT vs.id, vs.timestamp, vs.duration_seconds, vs.total_cards,
             vs.accuracy_pct, vs.cards_per_min,
             cs.name as set_name
      FROM voice_sessions vs
      LEFT JOIN card_sets cs ON vs.set_id = cs.id
      WHERE vs.duration_seconds > 0
      ORDER BY vs.timestamp DESC LIMIT ?
    `).all(limit);
    res.json(sessions);
  });

  // ============================================================
  // Checklist Import & Set Metadata
  // ============================================================

  // POST /api/parse-checklist — parse raw text, return preview (hardened parser)
  router.post('/api/parse-checklist', (req, res) => {
    const { text } = req.body;
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ detail: 'text is required' });
    }
    if (text.length > 512000) {
      return res.status(400).json({ detail: 'text too large (max 500KB)' });
    }
    const result = parseChecklist(text);
    res.json(result);
  });

  // POST /api/sets/:id/import-checklist — import parsed sections into a set
  router.post('/api/sets/:id/import-checklist', (req, res) => {
    const setId = Number(req.params.id);
    const cardSet = db.prepare('SELECT id FROM card_sets WHERE id = ?').get(setId);
    if (!cardSet) return res.status(404).json({ detail: 'Set not found' });

    const { sections } = req.body;
    if (!Array.isArray(sections) || sections.length === 0) {
      return res.status(400).json({ detail: 'sections array required' });
    }

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

    const findCard = db.prepare(
      `SELECT id, qty FROM cards
       WHERE set_id = ? AND card_number = ? AND insert_type = ? AND parallel = ?`
    );

    const insertCard = db.prepare(
      `INSERT INTO cards (set_id, card_number, player, team, rc_sp, insert_type, parallel, qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`
    );

    const updateCardMeta = db.prepare(
      `UPDATE cards SET player = ?, team = ?, rc_sp = ? WHERE id = ?`
    );

    let totalImported = 0;
    let totalUpdated = 0;
    let insertTypesAdded = 0;
    let parallelsAdded = 0;

    const doImport = db.transaction(() => {
      for (const section of sections) {
        const insertTypeName = section.name || 'Base';

        // Upsert insert type metadata
        upsertInsertType.run(
          setId, insertTypeName,
          section.declaredCount || section.cardCount || 0,
          section.odds || '',
          section.sectionType || 'base'
        );
        insertTypesAdded++;

        // Upsert parallels
        if (Array.isArray(section.parallels)) {
          for (const p of section.parallels) {
            const channelsStr = Array.isArray(p.channels) ? p.channels.join(', ') : (p.channels || '');
            upsertParallel.run(
              setId,
              p.name || p,
              p.printRun ?? null,
              p.exclusive || '',
              p.notes || '',
              p.serialMax ?? null,
              channelsStr,
              p.variationType || 'parallel'
            );
            parallelsAdded++;
          }
        }

        // Import cards — NEVER touch existing qty
        if (Array.isArray(section.cards)) {
          for (const card of section.cards) {
            const existing = findCard.get(
              setId, card.cardNumber, insertTypeName, ''
            );

            if (existing) {
              // Update metadata only — qty stays untouched
              updateCardMeta.run(
                card.player || '',
                card.team || '',
                card.rcSp || '',
                existing.id
              );
              totalUpdated++;
            } else {
              insertCard.run(
                setId,
                card.cardNumber,
                card.player || '',
                card.team || '',
                card.rcSp || '',
                insertTypeName,
                ''
              );
              totalImported++;
            }
          }
        }
      }

      // Recount total cards in set
      const count = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE set_id = ?').get(setId);
      db.prepare('UPDATE card_sets SET total_cards = ? WHERE id = ?').run(count.cnt, setId);
    });

    backupDb();
    doImport();

    res.json({
      imported: totalImported,
      updated: totalUpdated,
      insertTypes: insertTypesAdded,
      parallels: parallelsAdded,
    });
  });

  // GET /api/sets/:id/metadata — get set's available insert types + parallels
  router.get('/api/sets/:id/metadata', (req, res) => {
    const setId = Number(req.params.id);
    const cardSet = db.prepare('SELECT id FROM card_sets WHERE id = ?').get(setId);
    if (!cardSet) return res.status(404).json({ detail: 'Set not found' });

    const insertTypes = db.prepare(
      'SELECT id, name, card_count, odds, section_type FROM set_insert_types WHERE set_id = ? ORDER BY id'
    ).all(setId);

    const parallels = db.prepare(
      'SELECT id, name, print_run, exclusive, notes, serial_max, channels, variation_type FROM set_parallels WHERE set_id = ? ORDER BY id'
    ).all(setId);

    res.json({ insertTypes, parallels });
  });

  // POST /api/migrate-from-cardvision — import from CNNSCAN/CardVision database
  router.post('/api/migrate-from-cardvision', (req, res) => {
    const path = require('path');
    const fs = require('fs');
    const Database = require('better-sqlite3');

    // CNNSCAN DB location (platformdirs default)
    const cvDbPath = req.body.db_path
      || path.join(process.env.LOCALAPPDATA || '', 'CardVision', 'CardVision', 'cardvision.db');

    if (!fs.existsSync(cvDbPath)) {
      return res.status(404).json({ detail: `CardVision DB not found at ${cvDbPath}` });
    }

    let cvDb;
    try {
      cvDb = new Database(cvDbPath, { readonly: true });
    } catch (err) {
      return res.status(500).json({ detail: `Could not open CardVision DB: ${err.message}` });
    }

    backupDb();

    const results = {
      cleaned: { sets: 0, cards: 0 },
      imported: { sets: 0, cards: 0, sections: 0, parallels: 0, owned: 0 },
      skipped: [],
    };

    const findSetByNameYear = db.prepare('SELECT id FROM card_sets WHERE name = ? AND year = ?');
    const findSetByNameNullYear = db.prepare('SELECT id FROM card_sets WHERE name = ? AND year IS NULL');
    const findSet = (name, year) => year != null ? findSetByNameYear.get(name, year) : findSetByNameNullYear.get(name);
    const createSet = db.prepare(
      'INSERT INTO card_sets (name, year, brand, sport, total_cards) VALUES (?, ?, ?, ?, 0)'
    );
    const findCard = db.prepare(
      'SELECT id, qty FROM cards WHERE set_id = ? AND card_number = ? AND insert_type = ? AND parallel = ?'
    );
    const insertCard = db.prepare(
      `INSERT INTO cards (set_id, card_number, player, team, rc_sp, insert_type, parallel, qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const updateCardQty = db.prepare(
      'UPDATE cards SET qty = ? WHERE id = ?'
    );
    const upsertInsertType = db.prepare(`
      INSERT INTO set_insert_types (set_id, name, card_count, odds)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(set_id, name) DO UPDATE SET card_count = excluded.card_count, odds = excluded.odds
    `);
    const upsertParallel = db.prepare(`
      INSERT INTO set_parallels (set_id, name, print_run, exclusive, notes)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(set_id, name) DO UPDATE SET
        print_run = COALESCE(excluded.print_run, set_parallels.print_run),
        exclusive = CASE WHEN excluded.exclusive != '' THEN excluded.exclusive ELSE set_parallels.exclusive END,
        notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE set_parallels.notes END
    `);

    try {
      const migrate = db.transaction(() => {
        // --- Step 1: Clean up old BaseballBinder-migrated sets (0 owned cards) ---
        const allSets = db.prepare('SELECT id, name FROM card_sets').all();
        for (const s of allSets) {
          const ownedCount = db.prepare(
            'SELECT COUNT(*) as cnt FROM cards WHERE set_id = ? AND qty > 0'
          ).get(s.id).cnt;
          const totalCount = db.prepare(
            'SELECT COUNT(*) as cnt FROM cards WHERE set_id = ?'
          ).get(s.id).cnt;

          // Delete sets that have checklist cards but 0 owned (= old migration data)
          if (totalCount > 0 && ownedCount === 0) {
            db.prepare('DELETE FROM set_insert_types WHERE set_id = ?').run(s.id);
            db.prepare('DELETE FROM set_parallels WHERE set_id = ?').run(s.id);
            db.prepare('DELETE FROM cards WHERE set_id = ?').run(s.id);
            db.prepare('DELETE FROM card_sets WHERE id = ?').run(s.id);
            results.cleaned.sets++;
            results.cleaned.cards += totalCount;
          }
        }

        // --- Step 2: Import sets from CardVision ---
        const cvSets = cvDb.prepare(
          "SELECT * FROM sets WHERE status = 'approved' ORDER BY year DESC, product"
        ).all();

        // Map CNNSCAN set id → CardVoice set id for user_cards matching
        const setIdMap = {};

        for (const cvSet of cvSets) {
          const product = cvSet.product || '';
          const year = cvSet.year || null;
          const setName = product;
          if (!setName.trim()) continue;

          // Skip if already exists
          const existing = findSet(setName, year);
          if (existing) {
            setIdMap[cvSet.id] = existing.id;
            results.skipped.push(setName);
            continue;
          }

          const brand = (cvSet.brand || product.split(/\s+/)[0] || '');
          const sport = (cvSet.sport || 'baseball');
          const sportCap = sport.charAt(0).toUpperCase() + sport.slice(1);

          const setInfo = createSet.run(setName, year, brand, sportCap);
          const newSetId = Number(setInfo.lastInsertRowid);
          setIdMap[cvSet.id] = newSetId;
          results.imported.sets++;

          // --- Import set_sections as set_insert_types ---
          const sections = cvDb.prepare(
            'SELECT * FROM set_sections WHERE set_id = ? ORDER BY id'
          ).all(cvSet.id);

          for (const section of sections) {
            const sectionName = section.section_name || 'Base';
            const cardCount = section.parsed_count || section.declared_count || 0;
            let odds = '';
            if (section.odds_json) {
              try {
                const parsed = JSON.parse(section.odds_json);
                if (parsed && typeof parsed === 'object') {
                  odds = parsed.format || parsed.odds || JSON.stringify(parsed);
                }
              } catch (_) {}
            }
            upsertInsertType.run(newSetId, sectionName, cardCount, odds);
            results.imported.sections++;
          }

          // --- Import parallels from parallels_json ---
          // CNNSCAN stores parallels as a dict keyed by name:
          // {"Pink Foil": {id, name_raw, name_normalized, serial_max, print_run, channels, ...}}
          if (cvSet.parallels_json) {
            try {
              const pData = JSON.parse(cvSet.parallels_json);
              // Convert dict-of-objects → array, or use as-is if already an array
              const pList = Array.isArray(pData) ? pData
                : (pData && typeof pData === 'object') ? Object.values(pData)
                : [];

              for (const p of pList) {
                if (typeof p === 'string') {
                  upsertParallel.run(newSetId, p, null, '', '');
                  results.imported.parallels++;
                } else if (p && typeof p === 'object') {
                  const name = p.name || p.name_normalized || p.name_raw || '';
                  if (!name) continue;
                  const printRun = p.serial_max || p.print_run || null;
                  const channels = Array.isArray(p.channels) ? p.channels.join(', ') : '';
                  upsertParallel.run(newSetId, name, printRun, channels, '');
                  results.imported.parallels++;
                }
              }
            } catch (_) {}
          }

          // --- Import checklist_items as cards ---
          const items = cvDb.prepare(
            'SELECT * FROM checklist_items WHERE set_id = ? ORDER BY id'
          ).all(cvSet.id);

          for (const item of items) {
            const cardNumber = String(item.card_number || '');
            if (!cardNumber) continue;

            const player = item.player_name || '';
            const team = item.team || '';
            const rcSp = item.is_rc ? 'RC' : '';
            const insertType = item.section_name || 'Base';
            const parallel = item.parallel_name || '';

            const existingCard = findCard.get(newSetId, cardNumber, insertType, parallel);
            if (!existingCard) {
              insertCard.run(newSetId, cardNumber, player, team, rcSp, insertType, parallel, 0);
              results.imported.cards++;
            }
          }

          // Update total cards count
          const count = db.prepare('SELECT COUNT(*) as cnt FROM cards WHERE set_id = ?').get(newSetId);
          db.prepare('UPDATE card_sets SET total_cards = ? WHERE id = ?').run(count.cnt, newSetId);
        }

        // --- Step 3: Import user_cards quantities ---
        const userCards = cvDb.prepare(
          'SELECT uc.*, ci.set_id as ci_set_id, ci.card_number as ci_card_number, ' +
          'ci.section_name as ci_section_name, ci.parallel_name as ci_parallel_name ' +
          'FROM user_cards uc ' +
          'LEFT JOIN checklist_items ci ON uc.global_card_ref = ci.id ' +
          'WHERE uc.quantity > 0'
        ).all();

        for (const uc of userCards) {
          const qty = uc.quantity || 1;

          // Try to match via checklist_item link first
          if (uc.ci_set_id && setIdMap[uc.ci_set_id]) {
            const cvSetId = setIdMap[uc.ci_set_id];
            const cardNum = uc.ci_card_number || uc.card_number || '';
            const insertType = uc.ci_section_name || 'Base';
            const parallel = uc.ci_parallel_name || uc.parallel || '';

            const card = findCard.get(cvSetId, cardNum, insertType, parallel);
            if (card) {
              if (card.qty === 0) {
                updateCardQty.run(qty, card.id);
                results.imported.owned++;
              }
              continue;
            }
          }

          // Fallback: match by year + product name
          if (uc.year && uc.product) {
            const setName = uc.product;
            const existingSet = findSet(setName, uc.year);
            if (existingSet) {
              const cardNum = uc.card_number || '';
              const insertType = uc.insert_type || 'Base';
              const parallel = uc.parallel || '';

              const card = findCard.get(existingSet.id, cardNum, insertType, parallel);
              if (card) {
                if (card.qty === 0) {
                  updateCardQty.run(qty, card.id);
                  results.imported.owned++;
                }
              }
            }
          }
        }
      });

      migrate();
      cvDb.close();

      res.json({
        success: true,
        cleaned: results.cleaned,
        imported: results.imported,
        skipped: results.skipped,
      });
    } catch (err) {
      cvDb.close();
      res.status(500).json({ detail: `Migration failed: ${err.message}` });
    }
  });

  // ============================================================
  // Export Endpoints
  // ============================================================

  // GET /api/sets/:id/export/excel
  router.get('/api/sets/:id/export/excel', async (req, res) => {
    const ExcelJS = require('exceljs');
    const setId = Number(req.params.id);
    const cardSet = db.prepare('SELECT * FROM card_sets WHERE id = ?').get(setId);
    if (!cardSet) return res.status(404).json({ detail: 'Set not found' });

    const cards = db.prepare('SELECT * FROM cards WHERE set_id = ?').all(setId);

    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet(cardSet.name);

    // Headers
    const headers = ['Card #', 'Player', 'Team', 'RC/SP', 'Insert Type', 'Parallel', 'Qty'];
    const headerRow = ws.addRow(headers);
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      cell.alignment = { horizontal: 'center' };
      cell.border = {
        top: { style: 'thin' }, bottom: { style: 'thin' },
        left: { style: 'thin' }, right: { style: 'thin' },
      };
    });

    // Data rows
    for (const c of cards) {
      const row = ws.addRow([
        c.card_number, c.player, c.team, c.rc_sp,
        c.insert_type, c.parallel, c.qty > 0 ? c.qty : null,
      ]);
      row.eachCell(cell => {
        cell.border = {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
      });
    }

    // Column widths
    for (let i = 1; i <= 7; i++) {
      ws.getColumn(i).width = 18;
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${cardSet.name}.xlsx"`);
    await workbook.xlsx.write(res);
    res.end();
  });

  // GET /api/sets/:id/export/csv
  router.get('/api/sets/:id/export/csv', (req, res) => {
    const setId = Number(req.params.id);
    const cardSet = db.prepare('SELECT * FROM card_sets WHERE id = ?').get(setId);
    if (!cardSet) return res.status(404).json({ detail: 'Set not found' });

    const cards = db.prepare('SELECT * FROM cards WHERE set_id = ? AND qty > 0').all(setId);

    // Build CSV with proper escaping
    const escape = (val) => {
      const s = String(val ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };

    const lines = ['Card #,Player,Team,RC/SP,Insert Type,Parallel,Qty'];
    for (const c of cards) {
      lines.push([
        c.card_number, c.player, c.team, c.rc_sp,
        c.insert_type, c.parallel, c.qty,
      ].map(escape).join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${cardSet.name}.csv"`);
    res.send(lines.join('\n'));
  });

  // ============================================================
  // Health
  // ============================================================

  router.get('/api/health', (_req, res) => {
    const { DB_PATH: dbPath, DB_DIR: dbDir } = require('./db');
    res.json({ status: 'ok', version: '0.2.0', db_path: dbPath, db_dir: dbDir });
  });

  // ============================================================
  // Pricing Routes
  // ============================================================

  // Track/untrack a card
  router.post('/api/cards/:id/track', (req, res) => {
    const card = db.prepare(`SELECT * FROM cards WHERE id = ?`).get(req.params.id);
    if (!card) return res.status(404).json({ error: 'Card not found' });

    const set = db.prepare(`SELECT * FROM card_sets WHERE id = ?`).get(card.set_id);
    const { buildCardQuery } = require('./pricing/scraper');
    const query = buildCardQuery(card, set);

    db.prepare(`INSERT OR IGNORE INTO tracked_cards (card_id, search_query) VALUES (?, ?)`).run(card.id, query);
    const tracked = db.prepare(`SELECT * FROM tracked_cards WHERE card_id = ?`).get(card.id);
    res.json(tracked);
  });

  router.delete('/api/cards/:id/track', (req, res) => {
    db.prepare(`DELETE FROM tracked_cards WHERE card_id = ?`).run(req.params.id);
    res.json({ ok: true });
  });

  // Get all tracked cards (with latest price info)
  router.get('/api/tracked-cards', (req, res) => {
    const rows = db.prepare(`
      SELECT tc.*, c.card_number, c.player, c.team, c.parallel, c.insert_type,
             cs.name as set_name, cs.year as set_year, cs.id as set_id,
             ps.median_price, ps.snapshot_date
      FROM tracked_cards tc
      JOIN cards c ON tc.card_id = c.id
      JOIN card_sets cs ON c.set_id = cs.id
      LEFT JOIN price_snapshots ps ON ps.card_id = c.id
        AND ps.snapshot_date = (SELECT MAX(snapshot_date) FROM price_snapshots WHERE card_id = c.id)
      ORDER BY ps.median_price DESC NULLS LAST
    `).all();
    res.json(rows);
  });

  // Check if a card is tracked
  router.get('/api/cards/:id/tracked', (req, res) => {
    const tracked = db.prepare(`SELECT * FROM tracked_cards WHERE card_id = ?`).get(req.params.id);
    res.json({ tracked: !!tracked, data: tracked || null });
  });

  // Update tracked card search query
  router.put('/api/tracked-cards/:id', (req, res) => {
    const { search_query } = req.body;
    db.prepare(`UPDATE tracked_cards SET search_query = ? WHERE id = ?`).run(search_query, req.params.id);
    res.json({ ok: true });
  });

  // Get price history for a card
  router.get('/api/cards/:id/price-history', (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM price_history WHERE card_id = ? ORDER BY sold_date DESC, fetched_at DESC
    `).all(req.params.id);
    res.json(rows);
  });

  // Get price history for a set (set-level)
  router.get('/api/sets/:id/price-history', (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM price_history WHERE set_id = ? ORDER BY sold_date DESC, fetched_at DESC
    `).all(req.params.id);
    res.json(rows);
  });

  // Get price snapshots for a set over time
  router.get('/api/sets/:id/price-snapshots', (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM price_snapshots WHERE set_id = ? AND card_id IS NULL ORDER BY snapshot_date ASC
    `).all(req.params.id);
    res.json(rows);
  });

  // Get price snapshots for a card over time
  router.get('/api/cards/:id/price-snapshots', (req, res) => {
    const rows = db.prepare(`
      SELECT * FROM price_snapshots WHERE card_id = ? ORDER BY snapshot_date ASC
    `).all(req.params.id);
    res.json(rows);
  });

  // Portfolio summary
  router.get('/api/portfolio', (req, res) => {
    const setValues = db.prepare(`
      SELECT cs.id, cs.name, cs.year, ps.median_price, ps.snapshot_date
      FROM card_sets cs
      LEFT JOIN price_snapshots ps ON ps.set_id = cs.id AND ps.card_id IS NULL
        AND ps.snapshot_date = (SELECT MAX(snapshot_date) FROM price_snapshots WHERE set_id = cs.id AND card_id IS NULL)
      ORDER BY ps.median_price DESC NULLS LAST
    `).all();

    const cardValues = db.prepare(`
      SELECT c.id, c.card_number, c.player, c.parallel, cs.name as set_name, cs.year as set_year,
             ps.median_price, ps.snapshot_date
      FROM tracked_cards tc
      JOIN cards c ON tc.card_id = c.id
      JOIN card_sets cs ON c.set_id = cs.id
      LEFT JOIN price_snapshots ps ON ps.card_id = c.id
        AND ps.snapshot_date = (SELECT MAX(snapshot_date) FROM price_snapshots WHERE card_id = c.id)
      ORDER BY ps.median_price DESC NULLS LAST
    `).all();

    const timeline = db.prepare(`
      SELECT snapshot_date, SUM(median_price) as total_value
      FROM price_snapshots
      WHERE set_id IS NOT NULL AND card_id IS NULL
      GROUP BY snapshot_date
      ORDER BY snapshot_date ASC
    `).all();

    const totalSetValue = setValues.reduce((sum, s) => sum + (s.median_price || 0), 0);
    const totalCardValue = cardValues.reduce((sum, c) => sum + (c.median_price || 0), 0);

    res.json({
      totalValue: totalSetValue + totalCardValue,
      totalSetValue,
      totalCardValue,
      topSets: setValues.filter(s => s.median_price).slice(0, 5),
      topCards: cardValues.filter(c => c.median_price).slice(0, 5),
      timeline,
    });
  });

  // Recent price changes (cards with significant movement)
  router.get('/api/portfolio/changes', (req, res) => {
    const rows = db.prepare(`
      SELECT c.id, c.card_number, c.player, cs.name as set_name, cs.year as set_year,
             curr.median_price as current_price,
             prev.median_price as previous_price
      FROM price_snapshots curr
      JOIN cards c ON curr.card_id = c.id
      JOIN card_sets cs ON c.set_id = cs.id
      LEFT JOIN price_snapshots prev ON prev.card_id = curr.card_id
        AND prev.snapshot_date = (
          SELECT MAX(snapshot_date) FROM price_snapshots
          WHERE card_id = curr.card_id AND snapshot_date < curr.snapshot_date
        )
      WHERE curr.card_id IS NOT NULL
        AND curr.snapshot_date = (SELECT MAX(snapshot_date) FROM price_snapshots WHERE card_id = curr.card_id)
        AND prev.median_price IS NOT NULL
        AND ABS(curr.median_price - prev.median_price) / prev.median_price > 0.1
      ORDER BY ABS(curr.median_price - prev.median_price) DESC
      LIMIT 10
    `).all();
    res.json(rows);
  });

  // Sync control endpoints
  router.get('/api/sync/status', (req, res) => {
    const syncService = req.app.locals.syncService;
    res.json(syncService ? syncService.getStatus() : { running: false, enabled: false });
  });

  router.post('/api/sync/trigger', async (req, res) => {
    const syncService = req.app.locals.syncService;
    if (!syncService) return res.status(500).json({ error: 'Sync service not available' });
    if (syncService.running) return res.json({ message: 'Sync already running' });
    syncService.runFullSync(); // fire and forget
    res.json({ message: 'Sync started' });
  });

  router.put('/api/sync/settings', (req, res) => {
    const syncService = req.app.locals.syncService;
    if (!syncService) return res.status(500).json({ error: 'Sync service not available' });
    const { enabled, intervalHours } = req.body;
    if (typeof enabled === 'boolean') syncService.setEnabled(enabled);
    if (typeof intervalHours === 'number' && intervalHours > 0) {
      syncService.setInterval(intervalHours * 60 * 60 * 1000);
    }
    res.json(syncService.getStatus());
  });

  return router;
}


module.exports = { createRoutes };
