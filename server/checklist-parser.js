/**
 * CardVoice Checklist Parser (LEGACY)
 * Ported from BaseballBinder's checklist_parser_backend.py + backend/parsing.py
 *
 * DEPRECATED: Replaced by hardened-parser.js (ported from CNNSCAN's hardened_parser.py).
 * Kept for backward compatibility and test coverage. Use hardened-parser.js for new code.
 *
 * Parses raw Beckett/TCDB checklist text into structured sections with
 * card data, parallels, and metadata.
 */

// ============================================================
// Constants
// ============================================================

const TEAM_NAMES = [
  'Arizona Diamondbacks',
  'Atlanta Braves',
  'Baltimore Orioles',
  'Boston Red Sox',
  'Chicago Cubs',
  'Chicago White Sox',
  'Cincinnati Reds',
  'Cleveland Guardians',
  'Colorado Rockies',
  'Detroit Tigers',
  'Houston Astros',
  'Kansas City Royals',
  'Los Angeles Angels',
  'Los Angeles Dodgers',
  'Miami Marlins',
  'Milwaukee Brewers',
  'Minnesota Twins',
  'New York Mets',
  'New York Yankees',
  'Oakland Athletics',
  'Philadelphia Phillies',
  'Pittsburgh Pirates',
  'San Diego Padres',
  'San Francisco Giants',
  'Seattle Mariners',
  'St. Louis Cardinals',
  'Tampa Bay Rays',
  'Texas Rangers',
  'Toronto Blue Jays',
  'Washington Nationals',
];

// Build token map: { "los|angeles|angels": { name: "...", tokenCount: 3 } }
const TEAM_TOKEN_MAP = {};
for (const team of TEAM_NAMES) {
  const tokens = team.toLowerCase().split(/\s+/);
  TEAM_TOKEN_MAP[tokens.join('|')] = { name: team, tokenCount: tokens.length };
}
// Sorted longest-first for greedy matching
const TEAM_ENTRIES = Object.entries(TEAM_TOKEN_MAP)
  .sort((a, b) => b[1].tokenCount - a[1].tokenCount);

const FLAG_TOKENS = new Set([
  'RC', 'RD', 'SP', 'SSP', 'VAR', 'AUTO', 'PATCH', 'REL', 'RS', 'FS', 'FYC',
]);

const SUBSET_KEYWORDS = [
  'Rookie Debut',
  'Season Highlights',
  'Veteran Combo',
  'Team Card',
  'League Leaders',
  'Future Stars',
  'Prospects',
  'Draft Picks',
  'Checklist',
  'Throwback',
  'Golden Mirror',
];

const EXCLUSIVE_KEYWORDS = [
  'Hobby',
  'Retail',
  'Hanger',
  'Value Box',
  'Superbox',
  'Blaster',
  'Mega Box',
  'Cello',
  'Jumbo',
];

// Card number pattern:
//   1) Has at least one digit: US84, 90AU-AB, TFAP2-AB, 1, US290
//   2) OR all-uppercase with hyphen: MLMDA-ORI, TFAP-BM (insert prefixes)
const CARD_NUM_RE = /^[A-Za-z0-9]*\d+[A-Za-z0-9-]*$|^[A-Z]{2,}-[A-Z0-9]+$/;


// ============================================================
// Utility Functions
// ============================================================

/**
 * Greedy team name matching from a token array starting at startIdx.
 * @param {string[]} tokens - Array of words
 * @param {number} [startIdx=0]
 * @returns {{ team: string|null, consumed: number }}
 */
function matchTeamTokens(tokens, startIdx = 0) {
  const remaining = tokens.slice(startIdx);
  const lowered = remaining.map(t => t.toLowerCase());

  for (const [key, { name, tokenCount }] of TEAM_ENTRIES) {
    if (lowered.length < tokenCount) continue;
    const candidate = lowered.slice(0, tokenCount).join('|');
    if (candidate === key) {
      return { team: name, consumed: tokenCount };
    }
  }
  return { team: null, consumed: 0 };
}


/**
 * Extract flag tokens (RC, SP, etc.) and subset keywords from text.
 * @param {string} description
 * @returns {{ flags: string[], cleaned: string }}
 */
function extractFlags(description) {
  if (!description || !description.trim()) return { flags: [], cleaned: description || '' };

  const flags = [];
  let remaining = description.trim();

  // First pass: extract subset keywords (multi-word phrases)
  for (const phrase of SUBSET_KEYWORDS) {
    const re = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (re.test(remaining)) {
      flags.push(phrase);
      remaining = remaining.replace(re, '').trim();
    }
  }

  // Second pass: extract single-word flag tokens
  const words = remaining.split(/\s+/).filter(Boolean);
  const kept = [];
  for (const word of words) {
    const cleaned = word.replace(/[^\w]/g, '').toUpperCase();
    if (FLAG_TOKENS.has(cleaned)) {
      flags.push(cleaned);
    } else {
      kept.push(word);
    }
  }

  return { flags, cleaned: kept.join(' ').trim() };
}


/**
 * Clean team name suffixes and capture flags (RC, RD, etc.).
 * Ported from the team cleanup logic in checklist_parser_backend.py.
 * @param {string} teamStr
 * @returns {{ team: string, flags: string[] }}
 */
function cleanTeamSuffix(teamStr) {
  if (!teamStr) return { team: '', flags: [] };
  const flags = [];
  let team = teamStr;

  // Strip known suffixes and capture RC/RD as flags
  const suffixes = [
    { pattern: ' Season Highlights', flag: null },
    { pattern: '/Checklist', flag: null },
    { pattern: ' RC (eBay)', flag: 'RC' },
    { pattern: ' RD (eBay)', flag: 'RD' },
    { pattern: ' RC', flag: 'RC' },
    { pattern: ' RD', flag: 'RD' },
    { pattern: ' Combo', flag: null },
  ];

  for (const { pattern, flag } of suffixes) {
    const idx = team.indexOf(pattern);
    if (idx !== -1) {
      team = team.substring(0, idx);
      if (flag && !flags.includes(flag)) flags.push(flag);
    }
  }

  team = team.trim().replace(/\/+$/, '');
  return { team, flags };
}


/**
 * Parse a single parallel line.
 * Examples: "Gold /50", "Blue Refractor (Hobby Exclusive) /99"
 * @param {string} line
 * @returns {{ name: string, printRun: number|null, exclusive: string, notes: string, rawLine: string }|null}
 */
function parseParallelLine(line) {
  if (!line || !line.trim()) return null;
  const rawLine = line;
  line = line.trim();

  // Extract print run: /250, /99, etc.
  const prMatch = line.match(/\/(\d+)/);
  const printRun = prMatch ? parseInt(prMatch[1], 10) : null;

  // Extract notes from parentheses
  let exclusive = '';
  let notes = '';
  const parenMatch = line.match(/\(([^)]*)\)/);
  if (parenMatch) {
    notes = parenMatch[1].trim();
    // Check for exclusive keywords
    const notesLower = notes.toLowerCase();
    for (const kw of EXCLUSIVE_KEYWORDS) {
      if (notesLower.includes(kw.toLowerCase() + ' exclusive') || notesLower === kw.toLowerCase()) {
        exclusive = kw;
        break;
      }
    }
    // Also check outside parentheses
    if (!exclusive) {
      const lineLower = line.toLowerCase();
      for (const kw of EXCLUSIVE_KEYWORDS) {
        if (lineLower.includes(kw.toLowerCase() + ' exclusive')) {
          exclusive = kw;
          break;
        }
      }
    }
  } else {
    // No parentheses — check line itself for exclusive keywords
    const lineLower = line.toLowerCase();
    for (const kw of EXCLUSIVE_KEYWORDS) {
      if (lineLower.includes(kw.toLowerCase() + ' exclusive')) {
        exclusive = kw;
        break;
      }
    }
  }

  // Remove print run and parentheses to get the name
  let name = line.replace(/\/\d+/g, '').replace(/\([^)]*\)/g, '').trim();
  // Clean up double spaces
  name = name.replace(/\s+/g, ' ').trim();

  return { name, printRun, exclusive, notes, rawLine };
}


// ============================================================
// Main Parser
// ============================================================

/**
 * Parse pasted Beckett checklist text into structured sections.
 *
 * Supports formats:
 *  - Pipe:      NUM | PLAYER | TEAM
 *  - Tab:       NUM\tPLAYER\tTEAM
 *  - Dash:      NUM PLAYER - TEAM
 *  - Multi-line: card number alone → player on next line → team on third
 *  - Multi-auto: dual/triple autograph sections
 *
 * @param {string} text
 * @returns {{ sections: Array<{ name, rawHeading, cardCount, odds, parallels, cards }> }}
 */
function parsePastedChecklist(text) {
  if (!text || !text.trim()) return { sections: [] };

  const sections = [];
  let current = null;
  let inParallels = false;

  // Multi-line card parsing state
  let pendingCardNum = null;
  let pendingPlayerName = null;

  // Multi-player autograph state
  let multiAutoMode = null; // null | 'dual' | 'triple'
  let pendingPlayers = [];
  let pendingPartialName = null;
  let pendingAutoCardNum = null;

  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // --- Empty line: reset state ---
    if (!line) {
      inParallels = false;
      pendingCardNum = null;
      pendingPlayerName = null;
      multiAutoMode = null;
      pendingPlayers = [];
      pendingPartialName = null;
      pendingAutoCardNum = null;
      continue;
    }

    // Skip "SUBJECT TO CHANGE." lines
    if (line.toUpperCase() === 'SUBJECT TO CHANGE.') continue;

    // --- Section detection: "Checklist" keyword ---
    if (line.includes('Checklist')) {
      // Skip lines that look like card numbers (e.g., "US84 Checklist")
      if (/^([A-Z]*\d+[A-Z-]*|[A-Z]+\d+-[A-Z]+)\s/.test(line)) {
        // This is a card line, not a section header — fall through to card parsing
      } else {
        // Extract section name
        const nameBase = line.split('Checklist')[0].trim();
        current = {
          name: nameBase || 'Base',
          rawHeading: line,
          cardCount: null,
          odds: '',
          parallels: [],
          cards: [],
        };
        sections.push(current);
        inParallels = false;
        pendingCardNum = null;
        pendingPlayerName = null;
        multiAutoMode = null;
        pendingPlayers = [];
        pendingPartialName = null;
        pendingAutoCardNum = null;

        // Detect dual/triple autograph sections
        const nameLower = nameBase.toLowerCase();
        if (nameLower.includes('dual') && nameLower.includes('autograph')) {
          multiAutoMode = 'dual';
        } else if (nameLower.includes('triple') && nameLower.includes('autograph')) {
          multiAutoMode = 'triple';
        }
        continue;
      }
    }

    if (!current) continue;

    // --- Card count line: "350 cards." ---
    const countMatch = line.match(/^(\d+)\s+cards?\./i);
    if (countMatch) {
      current.cardCount = parseInt(countMatch[1], 10);
      pendingCardNum = null;
      pendingPlayerName = null;
      continue;
    }

    // --- Odds line ---
    if (line.toLowerCase().startsWith('odds')) {
      current.odds = line;
      pendingCardNum = null;
      pendingPlayerName = null;
      continue;
    }

    // --- Currently collecting parallels ---
    if (inParallels) {
      const parsed = parseParallelLine(line);
      if (parsed) current.parallels.push(parsed);
      continue;
    }

    // --- Skip "Variations" lines ---
    if (line.toLowerCase().startsWith('variations')) {
      pendingCardNum = null;
      pendingPlayerName = null;
      continue;
    }

    // --- Parallels header ---
    if (line.toLowerCase().startsWith('parallels')) {
      pendingCardNum = null;
      pendingPlayerName = null;
      // Check for inline parallels (semicolon-separated after colon)
      if (line.includes(':')) {
        const parallelsText = line.split(':')[1].trim();
        if (parallelsText) {
          const items = parallelsText.split(';').map(p => p.trim()).filter(Boolean);
          for (const item of items) {
            const parsed = parseParallelLine(item);
            if (parsed) current.parallels.push(parsed);
          }
          continue;
        }
      }
      // Multi-line parallels — next lines until blank
      inParallels = true;
      continue;
    }

    // --- Multi-auto with pending card number (multi-line format) ---
    if (multiAutoMode && pendingCardNum) {
      const expectedCount = multiAutoMode === 'dual' ? 2 : 3;

      // Collecting partial name (first/last split)
      if (pendingPartialName) {
        const fullName = pendingPartialName + ' ' + line;
        pendingPartialName = null;
        pendingPlayerName = fullName;
        continue;
      }

      // Pending player name waiting for team
      if (pendingPlayerName) {
        const team = line;
        pendingPlayers.push({ player: pendingPlayerName, team });
        pendingPlayerName = null;

        if (pendingPlayers.length === expectedCount) {
          const combinedPlayer = pendingPlayers.map(p => p.player).join(' / ');
          const combinedTeam = pendingPlayers.map(p => p.team).join(' / ');
          const { team: cleanedTeam, flags } = cleanTeamSuffix(combinedTeam);
          current.cards.push({
            cardNumber: pendingCardNum,
            player: combinedPlayer,
            team: cleanedTeam,
            rcSp: flags.join(' '),
          });
          pendingCardNum = null;
          pendingPlayers = [];
          multiAutoMode = null;
        }
        continue;
      }

      // This line is either a full name or a first-name fragment
      if (pendingPlayers.length > 0 && !line.includes(' ')) {
        pendingPartialName = line;
      } else {
        pendingPlayerName = line;
      }
      continue;
    }

    // --- Regular multi-line card: have card num + player, this is team ---
    if (pendingCardNum && pendingPlayerName) {
      const { team, flags } = cleanTeamSuffix(line);
      current.cards.push({
        cardNumber: pendingCardNum,
        player: pendingPlayerName,
        team,
        rcSp: flags.join(' '),
      });
      pendingCardNum = null;
      pendingPlayerName = null;
      continue;
    }

    // --- Regular multi-line card: have card num, this is player ---
    if (pendingCardNum) {
      pendingPlayerName = line;
      continue;
    }

    // --- Standalone card number (starts multi-line card) ---
    if (CARD_NUM_RE.test(line) && current) {
      pendingCardNum = line;

      // Re-detect multi-auto mode from current section
      const sectionLower = (current.name || '').toLowerCase();
      if (sectionLower.includes('dual') && sectionLower.includes('autograph')) {
        multiAutoMode = 'dual';
        pendingPlayers = [];
      } else if (sectionLower.includes('triple') && sectionLower.includes('autograph')) {
        multiAutoMode = 'triple';
        pendingPlayers = [];
      } else {
        multiAutoMode = null;
      }
      continue;
    }

    // --- Single-line formats ---

    // Format 1: Pipe-separated  (NUM | PLAYER | TEAM)
    if (line.includes('|')) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length >= 3) {
        const { team, flags } = cleanTeamSuffix(parts[2]);
        current.cards.push({
          cardNumber: parts[0],
          player: parts[1],
          team,
          rcSp: flags.join(' '),
        });
        continue;
      }
    }

    // Format 2: Tab-separated
    if (line.includes('\t')) {
      const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        const { team, flags } = cleanTeamSuffix(parts[2]);
        current.cards.push({
          cardNumber: parts[0],
          player: parts[1],
          team,
          rcSp: flags.join(' '),
        });
        continue;
      }
    }

    // Format 3: Dash-separated  (NUM PLAYER - TEAM)
    if (line.includes(' - ')) {
      const dashIdx = line.lastIndexOf(' - ');
      const pre = line.substring(0, dashIdx);
      let teamStr = line.substring(dashIdx + 3).trim();

      // Multi-auto single-line format
      if (multiAutoMode) {
        const parts = pre.split(/\s+/);
        if (parts.length >= 2 && CARD_NUM_RE.test(parts[0])) {
          // "NUM PLAYER - TEAM" — first player
          pendingAutoCardNum = parts[0];
          const playerName = parts.slice(1).join(' ');
          pendingPlayers = [{ player: playerName, team: teamStr }];

          const expectedCount = multiAutoMode === 'dual' ? 2 : 3;
          if (pendingPlayers.length === expectedCount) {
            const combinedPlayer = pendingPlayers.map(p => p.player).join(' / ');
            const combinedTeam = pendingPlayers.map(p => p.team).join(' / ');
            const { team: ct, flags: cf } = cleanTeamSuffix(combinedTeam);
            current.cards.push({ cardNumber: pendingAutoCardNum, player: combinedPlayer, team: ct, rcSp: cf.join(' ') });
            pendingAutoCardNum = null;
            pendingPlayers = [];
          }
          continue;
        } else if (pendingAutoCardNum) {
          // "PLAYER - TEAM" — continuation
          const playerName = pre.trim();
          pendingPlayers.push({ player: playerName, team: teamStr });

          const expectedCount = multiAutoMode === 'dual' ? 2 : 3;
          if (pendingPlayers.length === expectedCount) {
            const combinedPlayer = pendingPlayers.map(p => p.player).join(' / ');
            const combinedTeam = pendingPlayers.map(p => p.team).join(' / ');
            const { team: ct, flags: cf } = cleanTeamSuffix(combinedTeam);
            current.cards.push({ cardNumber: pendingAutoCardNum, player: combinedPlayer, team: ct, rcSp: cf.join(' ') });
            pendingAutoCardNum = null;
            pendingPlayers = [];
          }
          continue;
        }
      }

      // Regular dash-separated
      const { team, flags } = cleanTeamSuffix(teamStr);
      const parts = pre.split(/\s+/);
      if (parts.length >= 2) {
        const num = parts[0];
        const name = parts.slice(1).join(' ');
        current.cards.push({ cardNumber: num, player: name, team, rcSp: flags.join(' ') });
        continue;
      } else if (parts.length === 1) {
        // No card number, just "PLAYER - TEAM" — auto-number
        const name = pre.trim();
        const autoNum = String(current.cards.length + 1);
        current.cards.push({ cardNumber: autoNum, player: name, team, rcSp: flags.join(' ') });
        continue;
      }
    }

    // Format 4: Regex pipe fallback
    const pipeMatch = line.match(/^([A-Z0-9-]+)\s+\|\s*(.*?)\s*\|\s*(.*)$/);
    if (pipeMatch) {
      const { team, flags } = cleanTeamSuffix(pipeMatch[3]);
      current.cards.push({
        cardNumber: pipeMatch[1],
        player: pipeMatch[2],
        team,
        rcSp: flags.join(' '),
      });
      continue;
    }
  }

  // If no sections were detected but we have a default section, return it
  // If text had no "Checklist" headers, try to parse as a flat card list
  if (sections.length === 0) {
    // Try parsing the entire text as a flat card list
    const flatSection = {
      name: 'Base',
      rawHeading: '',
      cardCount: null,
      odds: '',
      parallels: [],
      cards: [],
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Try pipe format
      if (line.includes('|')) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 3) {
          const { team, flags } = cleanTeamSuffix(parts[2]);
          flatSection.cards.push({ cardNumber: parts[0], player: parts[1], team, rcSp: flags.join(' ') });
          continue;
        }
      }
      // Try tab format
      if (line.includes('\t')) {
        const parts = line.split('\t').map(p => p.trim()).filter(Boolean);
        if (parts.length >= 3) {
          const { team, flags } = cleanTeamSuffix(parts[2]);
          flatSection.cards.push({ cardNumber: parts[0], player: parts[1], team, rcSp: flags.join(' ') });
          continue;
        }
      }
      // Try dash format
      if (line.includes(' - ')) {
        const dashIdx = line.lastIndexOf(' - ');
        const pre = line.substring(0, dashIdx);
        const teamStr = line.substring(dashIdx + 3).trim();
        const { team, flags } = cleanTeamSuffix(teamStr);
        const parts = pre.split(/\s+/);
        if (parts.length >= 2) {
          flatSection.cards.push({ cardNumber: parts[0], player: parts.slice(1).join(' '), team, rcSp: flags.join(' ') });
        }
      }
    }

    if (flatSection.cards.length > 0) {
      return { sections: [flatSection] };
    }
  }

  return { sections };
}


module.exports = {
  parsePastedChecklist,
  parseParallelLine,
  matchTeamTokens,
  extractFlags,
  cleanTeamSuffix,
  TEAM_NAMES,
  FLAG_TOKENS,
  SUBSET_KEYWORDS,
  EXCLUSIVE_KEYWORDS,
};
