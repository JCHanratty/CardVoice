/**
 * CardVoice Hardened Checklist Parser
 * Ported from CNNSCAN's hardened_parser.py — Phases 1, 2, 4 (no AI repair).
 *
 * ARCHITECTURE:
 * Phase 1: Deterministic Block Segmentation
 *   - Split text into metadata/parallels/cards/section_header blocks
 *   - Never parse across block boundaries
 *
 * Phase 2: Deterministic Extraction
 *   - Regex + rule-based extraction
 *   - Confidence scoring per row
 *   - Extract: card_no, player, team, flags, parallel info
 *
 * Phase 4: Validation Gates
 *   - Schema validation
 *   - Semantic invariants
 *   - Cross-field consistency
 *   - Failure = needs_review
 */

const crypto = require('crypto');

// ============================================================================
// TEAM DATA (retained from checklist-parser.js)
// ============================================================================

const TEAM_NAMES = [
  'Arizona Diamondbacks', 'Atlanta Braves', 'Baltimore Orioles',
  'Boston Red Sox', 'Chicago Cubs', 'Chicago White Sox',
  'Cincinnati Reds', 'Cleveland Guardians', 'Colorado Rockies',
  'Detroit Tigers', 'Houston Astros', 'Kansas City Royals',
  'Los Angeles Angels', 'Los Angeles Dodgers', 'Miami Marlins',
  'Milwaukee Brewers', 'Minnesota Twins', 'New York Mets',
  'New York Yankees', 'Oakland Athletics', 'Philadelphia Phillies',
  'Pittsburgh Pirates', 'San Diego Padres', 'San Francisco Giants',
  'Seattle Mariners', 'St. Louis Cardinals', 'Tampa Bay Rays',
  'Texas Rangers', 'Toronto Blue Jays', 'Washington Nationals',
];

const TEAM_TOKEN_MAP = {};
for (const team of TEAM_NAMES) {
  const tokens = team.toLowerCase().split(/\s+/);
  TEAM_TOKEN_MAP[tokens.join('|')] = { name: team, tokenCount: tokens.length };
}
const TEAM_ENTRIES = Object.entries(TEAM_TOKEN_MAP)
  .sort((a, b) => b[1].tokenCount - a[1].tokenCount);


// ============================================================================
// CONSTANTS
// ============================================================================

const METADATA_PATTERNS = [
  /^.*Checklist$/i,
  /^\d+\s+cards?$/i,
  /^20\d{2}\s+.*/,
  /^(Topps|Panini|Upper Deck|Bowman|Leaf)\s+.*/i,
  /^(?:.*\s+)?(?:Hobby|Retail|Japan|Target|Walmart|Blaster|Hanger|Mega|Value|HTA|Superbox)\s+(?:Box\s+)?Exclusive$/i,
  /^(?:Hobby|Retail|Japan)\s+(?:Only|Edition)$/i,
];

const PARALLEL_SECTION_PATTERNS = [
  /^Parallels?$/i,
  /^Parallel\s+Versions?$/i,
  /^Variations?$/i,
  /^Refractors?$/i,
];

const CARD_SECTION_PATTERNS = [
  /^Base\s+(Set|Checklist|Cards?)$/i,
  /^Insert/i,
  /^Autograph/i,
  /^Relic/i,
  /^Short\s+Print/i,
];

const SECTION_HEADER_PATTERNS = [
  /^[A-Z][A-Za-z\s&]+(?:Autograph|Relic|Insert|Parallel|Patch|Memorabilia|Material|Hit)s?$/,
  /^(?:Future Stars|Baseball Stars|All-Stars?|Rookie|Chrome Prospects|1st Edition|Draft Picks|Bowman Chrome|Major League)/,
  /^[A-Z][A-Za-z\s&]+\s*[-–]\s*(?:Hobby|Retail|Hanger|Blaster)\s*Exclusive$/,
  /^20\d{2}\s+[A-Z][A-Za-z\s]+(?!.*\d+\s*cards?)$/,
];

const CARD_COUNT_PATTERN = /^(\d+)\s+cards?$/i;

const PARALLEL_INDICATORS_STRONG = [
  /\/\d+/,
  /\((.*Exclusive)\)/i,
  /\bPrint Run of \d+/i,
  /\b(Foil|Rainbow|Refractor|Prizm|Shimmer|Holo|Chrome|Mirror|SuperFractor|Diamante|Foilboard)\b/i,
  /\b(Canvas|Wood|Camo|Stock|Plates?|Variation)\b/i,
  /\b(Sandglitter|Foilfractor|Clear|Vintage|Independence|Memorial|First)\b/i,
];

const PARALLEL_COLOR_PATTERNS = [
  /^(Gold|Silver|Bronze|Platinum|Pink|Red|Blue|Green|Orange|Purple|Black|White|Aqua|Teal|Yellow|Brown|Grey|Gray|Copper|Golden)\b/i,
];

const CARD_NUMBER_PATTERN = /^(?<number>[#A-Za-z0-9-]{1,15})[\s,]+(?<rest>.+)$/;

const CARD_NUMBER_STRICT = /^[A-Z]{0,4}[A-Z0-9]*[-]?[A-Z0-9]*$/i;

const PARALLEL_PREFIXES = new Set([
  'gold', 'silver', 'bronze', 'copper', 'platinum',
  'pink', 'red', 'blue', 'green', 'orange', 'purple', 'black', 'white',
  'aqua', 'teal', 'yellow', 'brown', 'grey', 'gray',
  'rainbow', 'refractor', 'prizm', 'shimmer', 'chrome', 'foil',
  'holo', 'mirror', 'diamante', 'superfractor', 'xfractor',
  'printing', 'canvas', 'wave', 'mojo', 'atomic', 'golden',
  'vintage', 'independence', 'memorial', 'wood', 'clear', 'first',
  'foilfractor', 'value', 'sandglitter', 'royal', 'sapphire', 'ruby',
  'emerald', 'diamond', 'ice', 'fire', 'earth', 'magenta', 'cyan',
]);

const FLAG_PATTERNS = [
  { flag: 'RC', pattern: /\bRC\b/i },
  { flag: 'Rookie Debut', pattern: /\bRookie Debut\b/i },
  { flag: 'Veteran Combos', pattern: /\bVeteran Combos\b/i },
  { flag: 'Season Highlights', pattern: /\bSeason Highlights\b/i },
  { flag: 'All-Star', pattern: /\bAll-Star\b/i },
  { flag: 'Hall of Fame', pattern: /\b(?:Hall of Fame|HOF)\b/i },
  { flag: 'Legend', pattern: /\bLegend\b/i },
  { flag: 'Prospect', pattern: /\bProspect\b/i },
  { flag: 'Variation', pattern: /\b(?:Variation|Var)\b/i },
];

const EXCLUSIVE_KEYWORDS = [
  'Hobby', 'Retail', 'Hanger', 'Value Box', 'Superbox',
  'Blaster', 'Mega Box', 'Cello', 'Jumbo', 'HTA',
];

const SET_NAME_ENDINGS = new Set([
  'baseball', 'football', 'basketball', 'hockey', 'soccer',
  'update', 'series', 'chrome', 'heritage', 'archives', 'flagship',
  'checklist', 'set',
]);


// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Clean a parallel definition line by stripping odds and formatting.
 * @param {string} line
 * @returns {string}
 */
function cleanParallelLine(line) {
  if (!line) return '';
  let cleaned = line.trim();
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/, '');
  cleaned = cleaned.replace(/\s*\(1:[^)]*\)/g, '');
  cleaned = cleaned.replace(/\s*\([^)]*only\)/gi, '');
  cleaned = cleaned.replace(/\s*\([^)]*Exclusive\)/gi, '');
  cleaned = cleaned.replace(/\s*[-–—]\s*$/, '');
  return cleaned.trim();
}

/**
 * Parse a raw text block of parallels into cleaned list.
 * @param {string} rawText
 * @returns {string[]}
 */
function cleanParallelsList(rawText) {
  if (!rawText || !rawText.trim()) return [];
  let text = rawText.trim();
  text = text.replace(/^\s*parallels?\s*:\s*/i, '');
  const lines = text.split(/[;\n]+/);
  const cleaned = [];
  for (let line of lines) {
    line = line.replace(/^\s*parallels?\s*:\s*/i, '').trim();
    if (!line) continue;
    const c = cleanParallelLine(line);
    if (c) cleaned.push(c);
  }
  return cleaned;
}

/**
 * Greedy team name matching from a token array starting at startIdx.
 * @param {string[]} tokens
 * @param {number} startIdx
 * @returns {{ team: string|null, consumed: number }}
 */
function matchTeamTokens(tokens, startIdx = 0) {
  const remaining = tokens.slice(startIdx);
  const lowered = remaining.map(t => t.toLowerCase());
  for (const [key, { name, tokenCount }] of TEAM_ENTRIES) {
    if (lowered.length < tokenCount) continue;
    const candidate = lowered.slice(0, tokenCount).join('|');
    if (candidate === key) return { team: name, consumed: tokenCount };
  }
  return { team: null, consumed: 0 };
}

/**
 * Generate a short hash ID for a parsed row.
 * @param {number} lineIndex
 * @param {string} rawLine
 * @returns {string}
 */
function generateRowId(lineIndex, rawLine) {
  return crypto.createHash('sha256')
    .update(`${lineIndex}:${rawLine}`)
    .digest('hex')
    .slice(0, 16);
}


// ============================================================================
// PHASE 1: DETERMINISTIC BLOCK SEGMENTATION
// ============================================================================

function _isMetadataLine(line) {
  const clean = line.trim();
  if (!clean) return false;
  for (const pattern of METADATA_PATTERNS) {
    if (pattern.test(clean)) return true;
  }
  if (/\d+\s+cards?/i.test(clean)) return true;
  return false;
}

function _isParallelSectionHeader(line) {
  const clean = line.trim();
  for (const pattern of PARALLEL_SECTION_PATTERNS) {
    if (pattern.test(clean)) return true;
  }
  return false;
}

function _isCardSectionHeader(line) {
  const clean = line.trim();
  for (const pattern of CARD_SECTION_PATTERNS) {
    if (pattern.test(clean)) return true;
  }
  return false;
}

/**
 * Check if line is an insert/subset section header.
 * @param {string} line
 * @returns {{ isHeader: boolean, sectionName: string|null }}
 */
function _isInsertSectionHeader(line) {
  const clean = line.trim();
  if (!clean) return { isHeader: false, sectionName: null };

  // Skip SET NAMES ending in sport names or set type indicators
  const words = clean.split(/\s+/);
  const lastWord = words[words.length - 1].toLowerCase();
  if (SET_NAME_ENDINGS.has(lastWord)) return { isHeader: false, sectionName: null };

  // If first word looks like a card number code, not a section header
  if (words.length >= 1) {
    const firstWord = words[0];
    if (CARD_NUMBER_STRICT.test(firstWord) || firstWord.startsWith('#')) {
      // Exception: years like "2025" followed by more text could be section headers
      if (!/^\d{4}$/.test(firstWord)) {
        const rest = words.slice(1).join(' ');
        if (rest.includes(',') || rest.includes(' - ')) {
          return { isHeader: false, sectionName: null };
        }
      }
    }
  }

  // Skip if it's a parallel definition
  if (_isParallelDefinitionLine(clean)) return { isHeader: false, sectionName: null };

  // Skip if it's a card count
  if (CARD_COUNT_PATTERN.test(clean)) return { isHeader: false, sectionName: null };

  // Skip if it's a parallel section header
  if (_isParallelSectionHeader(clean)) return { isHeader: false, sectionName: null };

  // Check against section header patterns
  for (const pattern of SECTION_HEADER_PATTERNS) {
    if (pattern.test(clean)) return { isHeader: true, sectionName: clean };
  }

  // Heuristic: lines with 2-6 capitalized words ending in known terms
  if (words.length >= 2 && words.length <= 6) {
    const last = words[words.length - 1].toLowerCase();
    if (['autographs', 'autograph', 'relics', 'relic', 'inserts', 'insert',
         'parallels', 'parallel', 'memorabilia', 'patches', 'patch'].includes(last)) {
      if (!clean.includes(',') && !clean.includes(' - ')) {
        return { isHeader: true, sectionName: clean };
      }
    }
  }

  return { isHeader: false, sectionName: null };
}

function _extractCardCountDeclaration(line) {
  const match = line.trim().match(CARD_COUNT_PATTERN);
  if (match) {
    const val = parseInt(match[1], 10);
    return isNaN(val) ? null : val;
  }
  return null;
}

/**
 * Check if line is a parallel definition (NOT a card).
 * Critical discriminator ported from CNNSCAN.
 * @param {string} line
 * @returns {boolean}
 */
function _isParallelDefinitionLine(line) {
  const clean = line.trim();
  if (!clean) return false;

  // Check if first word is a known parallel prefix
  const firstWord = clean.split(/\s+/)[0].toLowerCase();
  if (PARALLEL_PREFIXES.has(firstWord)) return true;

  // Check for odds pattern like "(1:11 hobby, 1:2 jumbo)"
  if (/\(1:\d+[^)]*\)/.test(clean)) return true;

  // CRITICAL: If line has card-like structure (code + comma/dash + team), NOT a parallel
  if (clean.includes(',') || clean.includes(' - ')) {
    const cardMatch = clean.match(CARD_NUMBER_PATTERN);
    if (cardMatch) {
      const numberPart = cardMatch.groups.number.trim();
      const restPart = cardMatch.groups.rest.trim();
      if (numberPart.includes('-') || (numberPart.length <= 10 && /^[a-z0-9]+$/i.test(numberPart))) {
        if (restPart.includes(',') || restPart.includes(' - ')) {
          return false;
        }
      }
    }
  }

  // Check for STRONG parallel indicators
  let hasStrongIndicator = false;
  for (const pattern of PARALLEL_INDICATORS_STRONG) {
    if (pattern.test(clean)) { hasStrongIndicator = true; break; }
  }

  // Check for color patterns at start of line
  let hasColorIndicator = false;
  for (const pattern of PARALLEL_COLOR_PATTERNS) {
    if (pattern.test(clean)) { hasColorIndicator = true; break; }
  }

  if (!hasStrongIndicator && !hasColorIndicator) return false;

  // Check if first token is a parallel color/material term vs card number
  const cardMatch = clean.match(CARD_NUMBER_PATTERN);
  if (cardMatch) {
    const numberPart = cardMatch.groups.number.trim();

    // If the "number" contains at least one digit, likely a real card number
    if (/\d/.test(numberPart)) {
      if (!/\/\d+/.test(clean) && !/\((Retail|Hanger|Blaster) Exclusive\)/i.test(clean)) {
        return false;
      }
    }

    // If number part is a known parallel prefix, it's a parallel
    if (PARALLEL_PREFIXES.has(numberPart.toLowerCase())) return true;

    // If number part is NOT a known prefix and NOT digit-containing,
    // it might be a card code like "MMU-AB"
    if (!PARALLEL_PREFIXES.has(numberPart.toLowerCase()) && !/\d/.test(numberPart)) {
      if (numberPart === numberPart.toUpperCase() || numberPart.includes('-')) {
        return false;
      }
    }
  }

  // Has strong parallel indicators = definitely a parallel
  if (hasStrongIndicator) return true;

  // Only color indicator at start = parallel only if rest is simple
  if (hasColorIndicator) {
    const words = clean.split(/\s+/);
    if (words.length <= 4) return true;
  }

  return false;
}

/**
 * Phase 1: Deterministic Block Segmentation.
 * Split raw text into typed blocks.
 * @param {string} rawText
 * @returns {Array<{blockType: string, startLine: number, endLine: number, lines: string[], label: string|null, parentSection: string|null}>}
 */
function segmentBlocks(rawText) {
  const lines = rawText.split(/\r?\n/);
  const segments = [];

  let currentType = 'metadata';
  let currentLabel = null;
  let currentStart = 0;
  let currentLines = [];
  let currentSection = null;
  let pendingSectionHeader = null;

  function finishSegment() {
    if (currentLines.length > 0) {
      segments.push({
        blockType: currentType,
        startLine: currentStart,
        endLine: currentStart + currentLines.length - 1,
        lines: [...currentLines],
        label: currentLabel || currentSection,
        parentSection: currentSection,
      });
    }
    currentLines = [];
    currentLabel = null;
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const stripped = lines[idx].trim();
    if (!stripped) continue;

    // Check for "X Checklist" section headers (Beckett format)
    const checklistMatch = stripped.match(/^(.+?)\s+Checklist$/i);
    if (checklistMatch && !/^[A-Z]*\d+[A-Z-]*\s/.test(stripped)) {
      finishSegment();
      const name = checklistMatch[1].trim() || 'Base';
      currentSection = name;
      pendingSectionHeader = name;
      segments.push({
        blockType: 'section_header',
        startLine: idx,
        endLine: idx,
        lines: [stripped],
        label: name,
        parentSection: name,
      });
      currentType = 'metadata';
      currentStart = idx + 1;
      continue;
    }

    // Check for card count declarations with period: "350 cards."
    const cardCountWithPeriod = stripped.match(/^(\d+)\s+cards?\.\s*$/i);
    if (cardCountWithPeriod && pendingSectionHeader) {
      const count = parseInt(cardCountWithPeriod[1], 10);
      segments.push({
        blockType: 'metadata',
        startLine: idx,
        endLine: idx,
        lines: [stripped],
        label: `${pendingSectionHeader} (${count} cards)`,
        parentSection: currentSection,
      });
      pendingSectionHeader = null;
      currentStart = idx + 1;
      continue;
    }

    // Check for "Odds:" lines — store as metadata with section context
    if (/^odds\b/i.test(stripped)) {
      // Store odds line in current section's metadata
      segments.push({
        blockType: 'metadata',
        startLine: idx,
        endLine: idx,
        lines: [stripped],
        label: 'odds',
        parentSection: currentSection,
      });
      currentStart = idx + 1;
      continue;
    }

    // Handle inline parallels: "Parallels: Gold /50; Silver /100"
    if (/^parallels?\s*:/i.test(stripped)) {
      finishSegment();
      const parallelsText = stripped.replace(/^parallels?\s*:\s*/i, '');
      if (parallelsText) {
        const items = parallelsText.split(';').map(p => p.trim()).filter(Boolean);
        if (items.length > 0) {
          segments.push({
            blockType: 'parallels',
            startLine: idx,
            endLine: idx,
            lines: items,
            label: 'Parallels',
            parentSection: currentSection,
          });
          currentStart = idx + 1;
          continue;
        }
      }
    }

    // Check for insert section headers FIRST
    const { isHeader, sectionName } = _isInsertSectionHeader(stripped);
    if (isHeader) {
      finishSegment();
      currentSection = sectionName;
      pendingSectionHeader = sectionName;
      segments.push({
        blockType: 'section_header',
        startLine: idx,
        endLine: idx,
        lines: [stripped],
        label: sectionName,
        parentSection: sectionName,
      });
      currentType = 'metadata';
      currentStart = idx + 1;
      continue;
    }

    // Check for card count declaration after section header
    const cardCount = _extractCardCountDeclaration(stripped);
    if (cardCount !== null && pendingSectionHeader) {
      segments.push({
        blockType: 'metadata',
        startLine: idx,
        endLine: idx,
        lines: [stripped],
        label: `${pendingSectionHeader} (${cardCount} cards)`,
        parentSection: currentSection,
      });
      pendingSectionHeader = null;
      currentStart = idx + 1;
      continue;
    }

    // Check for parallel section headers
    if (_isParallelSectionHeader(stripped)) {
      finishSegment();
      currentType = 'parallels';
      currentLabel = stripped;
      currentStart = idx;
      continue;
    }

    if (_isCardSectionHeader(stripped)) {
      finishSegment();
      currentType = 'cards';
      currentLabel = stripped;
      currentStart = idx;
      continue;
    }

    if (_isMetadataLine(stripped)) {
      if (currentType === 'parallels' || currentType === 'cards') {
        finishSegment();
        currentType = 'metadata';
        currentStart = idx;
      }
      currentLines.push(stripped);
      continue;
    }

    // Classify content lines based on current context
    if (currentType === 'metadata') {
      if (_isParallelDefinitionLine(stripped)) {
        finishSegment();
        currentType = 'parallels';
        currentStart = idx;
        currentLines.push(stripped);
      } else if (CARD_NUMBER_PATTERN.test(stripped)) {
        finishSegment();
        currentType = 'cards';
        currentStart = idx;
        currentLines.push(stripped);
      } else {
        currentLines.push(stripped);
      }
    } else if (currentType === 'parallels') {
      if (CARD_NUMBER_PATTERN.test(stripped) && !_isParallelDefinitionLine(stripped)) {
        finishSegment();
        currentType = 'cards';
        currentStart = idx;
        currentLines.push(stripped);
      } else {
        currentLines.push(stripped);
      }
    } else if (currentType === 'cards') {
      const { isHeader: isNewSection, sectionName: newName } = _isInsertSectionHeader(stripped);
      if (isNewSection) {
        finishSegment();
        currentSection = newName;
        pendingSectionHeader = newName;
        segments.push({
          blockType: 'section_header',
          startLine: idx,
          endLine: idx,
          lines: [stripped],
          label: newName,
          parentSection: newName,
        });
        currentType = 'metadata';
        currentStart = idx + 1;
      } else if (_isParallelDefinitionLine(stripped)) {
        finishSegment();
        currentType = 'parallels';
        currentStart = idx;
        currentLines.push(stripped);
      } else {
        currentLines.push(stripped);
      }
    }
  }

  finishSegment();
  return segments;
}


// ============================================================================
// PHASE 2: DETERMINISTIC EXTRACTION
// ============================================================================

/**
 * Extract card flags from text.
 * @param {string} text
 * @returns {string[]}
 */
function _extractFlags(text) {
  const flags = [];
  for (const { flag, pattern } of FLAG_PATTERNS) {
    if (pattern.test(text)) flags.push(flag);
  }
  return flags;
}

/**
 * Extract parenthetical content from text.
 * @param {string} text
 * @returns {string[]}
 */
function _extractParentheticalNotes(text) {
  const notes = [];
  const re = /[(\[{]([^)\]}]+)[)\]}]/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const content = match[1].trim();
    if (content) notes.push(content);
  }
  return notes;
}

/**
 * Phase 2: Deterministic Card Extraction.
 * @param {string} line
 * @param {number} lineIndex
 * @returns {object|null}
 */
function _extractCardDeterministic(line, lineIndex) {
  const stripped = line.trim();
  if (!stripped) return null;

  // Reject parallel definition lines
  if (_isParallelDefinitionLine(stripped)) return null;

  let cardNo = null;
  let playerName = null;
  let team = null;
  let confidence = 1.0;
  let restForFlags = '';

  // Format 1: Pipe-separated (NUM | PLAYER | TEAM)
  if (stripped.includes('|')) {
    const parts = stripped.split('|').map(p => p.trim());
    if (parts.length >= 3) {
      cardNo = parts[0];
      playerName = parts[1];
      team = parts[2];
      restForFlags = parts.slice(1).join(' ');
    } else if (parts.length === 2) {
      cardNo = parts[0];
      playerName = parts[1];
      restForFlags = parts[1];
      confidence = 0.9;
    }
  }
  // Format 2: Tab-separated
  else if (stripped.includes('\t')) {
    const parts = stripped.split('\t').map(p => p.trim()).filter(Boolean);
    if (parts.length >= 3) {
      cardNo = parts[0];
      playerName = parts[1];
      team = parts[2];
      restForFlags = parts.slice(1).join(' ');
    } else if (parts.length === 2) {
      cardNo = parts[0];
      playerName = parts[1];
      restForFlags = parts[1];
      confidence = 0.9;
    }
  }
  // Format 3: Standard (NUM REST with comma/dash/space delimiters)
  else {
    const match = stripped.match(CARD_NUMBER_PATTERN);
    if (!match) return null;

    cardNo = match.groups.number.trim();
    const rest = match.groups.rest.trim();
    restForFlags = rest;

    if (rest.includes(',')) {
      const parts = rest.split(',', 2);
      playerName = parts[0].trim();
      team = parts.length > 1 ? parts[1].trim() : null;
    } else if (rest.includes(' - ')) {
      const parts = rest.split(' - ', 2);
      playerName = parts[0].trim();
      team = parts.length > 1 ? parts[1].trim() : null;
    } else {
      playerName = rest;
      team = null;
      confidence = 0.9;
    }
  }

  if (!cardNo || !playerName) return null;

  // Extract flags
  const flags = _extractFlags(restForFlags);

  // Extract parenthetical notes
  const parentheticalNotes = _extractParentheticalNotes(restForFlags);
  const notes = parentheticalNotes.length > 0 ? parentheticalNotes.join(', ') : null;

  // Remove flags from player name and team
  for (const { pattern } of FLAG_PATTERNS) {
    if (playerName) playerName = playerName.replace(pattern, '').trim();
    if (team) team = team.replace(pattern, '').trim();
  }

  // Remove parenthetical notes from team
  if (team) {
    team = team.replace(/[(\[{][^)\]}]*[)\]}]/g, '').trim();
    if (!team) team = null;
  }

  if (!playerName || !cardNo) return null;

  // Check for unusual patterns that lower confidence
  if (/[/\\]/.test(playerName)) confidence = 0.7;
  if (playerName.split(/\s+/).length > 6) confidence = 0.75;

  const rowId = generateRowId(lineIndex, stripped);

  return {
    rowId,
    cardNumber: cardNo,
    player: playerName,
    team: team || '',
    rcSp: flags.join(' '),
    flags,
    notes,
    confidence,
    needsReview: confidence < 0.7,
    rawLine: stripped,
    lineIndex,
  };
}

/**
 * Extract serial number ceiling from parallel name.
 * @param {string} text
 * @returns {number|null}
 */
function _extractSerialMax(text) {
  const match = text.match(/\/(\d+)$/);
  if (match) {
    const val = parseInt(match[1], 10);
    return isNaN(val) ? null : val;
  }
  // Also try non-end-of-string serial
  const match2 = text.match(/\/(\d+)/);
  if (match2) {
    const val = parseInt(match2[1], 10);
    return isNaN(val) ? null : val;
  }
  return null;
}

/**
 * Extract distribution channels from text.
 * @param {string} text
 * @returns {string[]}
 */
function _extractChannels(text) {
  const channels = [];
  const channelPatterns = [
    { channel: 'retail', pattern: /\bRetail\b/i },
    { channel: 'hobby', pattern: /\bHobby\b/i },
    { channel: 'hanger', pattern: /\bHanger\b/i },
    { channel: 'blaster', pattern: /\bBlaster\b/i },
    { channel: 'mega_box', pattern: /\b(?:Mega|Mega Box)\b/i },
    { channel: 'value_box', pattern: /\bValue\b/i },
    { channel: 'jumbo', pattern: /\bJumbo\b/i },
    { channel: 'hta', pattern: /\bHTA\b/i },
  ];
  for (const { channel, pattern } of channelPatterns) {
    if (pattern.test(text)) channels.push(channel);
  }
  return channels.length > 0 ? channels : [];
}

/**
 * Normalize parallel name by removing serial numbers and parentheticals.
 * @param {string} rawName
 * @returns {string}
 */
function _normalizeParallelName(rawName) {
  let name = rawName.replace(/\s*\/\d+$/, '');
  name = name.replace(/\s*\/\d+/, '');
  name = name.replace(/\s*\([^)]+\)/g, '');
  name = name.replace(/\s*[-–—]\s*$/, '');
  return name.trim();
}

/**
 * Phase 2: Deterministic Parallel Extraction.
 * @param {string} line
 * @param {number} lineIndex
 * @returns {object|null}
 */
function _extractParallelDeterministic(line, lineIndex) {
  const stripped = line.trim();
  if (!stripped) return null;
  if (!_isParallelDefinitionLine(stripped)) return null;

  const nameRaw = stripped;
  const name = _normalizeParallelName(stripped);
  const serialMax = _extractSerialMax(stripped);
  const printRun = serialMax;
  const channels = _extractChannels(stripped);

  // Determine variation type
  let variationType = 'parallel';
  if (/\b(?:Auto|Autograph)\b/i.test(name)) variationType = 'autograph';
  else if (/\b(?:Relic|Memorabilia|Jersey)\b/i.test(name)) variationType = 'relic';
  else if (/\bPatch\b/i.test(name)) variationType = 'patch';
  else if (/\bPrinting Plate\b/i.test(name)) variationType = 'printing_plate';
  else if (/\bImage Variation\b/i.test(name)) variationType = 'image_variation';
  else if (/\bSSP\b/i.test(name)) variationType = 'ssp';
  else if (/\bSP\b/i.test(name)) variationType = 'sp';

  // Extract exclusive from text
  let exclusive = '';
  const lineLower = stripped.toLowerCase();
  for (const kw of EXCLUSIVE_KEYWORDS) {
    if (lineLower.includes(kw.toLowerCase() + ' exclusive') || lineLower.includes(kw.toLowerCase() + ' only')) {
      exclusive = kw;
      break;
    }
  }
  // Check parenthetical content for exclusive
  if (!exclusive) {
    const parenMatch = stripped.match(/\(([^)]*)\)/);
    if (parenMatch) {
      const inner = parenMatch[1].toLowerCase();
      for (const kw of EXCLUSIVE_KEYWORDS) {
        if (inner.includes(kw.toLowerCase())) {
          exclusive = kw;
          break;
        }
      }
    }
  }

  // Extract notes from parentheses
  let notes = '';
  const parenMatch = stripped.match(/\(([^)]*)\)/);
  if (parenMatch) notes = parenMatch[1].trim();

  // Confidence scoring
  let confidence = 1.0;
  if (serialMax || channels.length > 0) {
    confidence = 1.0;
  } else {
    confidence = 0.9;
  }

  return {
    name,
    nameRaw,
    serialMax,
    printRun,
    channels,
    variationType,
    exclusive,
    notes,
    confidence,
    needsReview: confidence < 0.9,
    rawLine: stripped,
  };
}

/**
 * Phase 2: Deterministic Metadata Extraction.
 * @param {string[]} lines
 * @returns {{ setName: string|null, year: number|null, publisher: string|null, declaredCardCount: number|null, sport: string }}
 */
function _extractMetadataDeterministic(lines) {
  let year = null;
  let publisher = null;
  let setName = null;
  let declaredCardCount = null;

  const publisherPattern = /\b(Topps|Panini|Upper Deck|Leaf|Bowman|Donruss|Fleer|Score)\b/i;
  const yearPattern = /\b(19\d{2}|20\d{2})\b/;
  const cardCountPattern = /(\d+)\s+cards?/i;

  for (const line of lines) {
    const stripped = line.trim();
    if (!stripped) continue;

    if (!year) {
      const m = stripped.match(yearPattern);
      if (m) year = parseInt(m[1], 10);
    }
    if (!publisher) {
      const m = stripped.match(publisherPattern);
      if (m) publisher = m[1];
    }
    if (!declaredCardCount) {
      const m = stripped.match(cardCountPattern);
      if (m) declaredCardCount = parseInt(m[1], 10);
    }
    if (!setName && !/^\d+\s+cards?$/i.test(stripped)) {
      setName = stripped;
    }
  }

  return { setName, year, publisher, declaredCardCount, sport: 'Baseball' };
}

/**
 * Classify section type based on section name.
 * @param {string} name
 * @returns {"base"|"autograph"|"relic"|"insert"}
 */
function _classifySectionType(name) {
  if (!name) return 'base';
  const lower = name.toLowerCase();
  if (/\b(base|base set|base cards|base checklist)\b/.test(lower)) return 'base';
  if (/\b(autographs?|auto|signatures?|signed|ink)\b/.test(lower)) return 'autograph';
  if (/\b(relics?|memorabilia|jerseys?|patches?|materials?)\b/.test(lower)) return 'relic';
  return 'insert';
}


// ============================================================================
// PHASE 4: VALIDATION GATES
// ============================================================================

/**
 * Validate a card for suspicious patterns.
 * @param {object} card
 * @returns {Array<{errorType: string, message: string, field: string, value: any, rowId: string}>}
 */
function _validateCard(card) {
  const errors = [];

  if (/[;'"\\]/.test(card.cardNumber)) {
    errors.push({
      errorType: 'suspicious_characters',
      message: `Card number contains suspicious characters: ${card.cardNumber}`,
      field: 'cardNumber',
      value: card.cardNumber,
      rowId: card.rowId,
    });
  }

  if (/[;'"\\]/.test(card.player)) {
    errors.push({
      errorType: 'suspicious_characters',
      message: `Player name contains suspicious characters: ${card.player}`,
      field: 'player',
      value: card.player,
      rowId: card.rowId,
    });
  }

  if (card.confidence < 0.5 && !card.needsReview) {
    errors.push({
      errorType: 'low_confidence',
      message: `Card has low confidence (${card.confidence}) but not flagged for review`,
      field: 'confidence',
      value: card.confidence,
      rowId: card.rowId,
    });
  }

  return errors;
}

/**
 * Detect duplicate card numbers within a section.
 * @param {object[]} cards
 * @returns {string[]}
 */
function _detectDuplicateCardNumbers(cards) {
  const seen = {};
  const duplicates = [];
  for (const card of cards) {
    const key = card.cardNumber.toUpperCase().trim();
    if (seen[key]) {
      if (seen[key] === 1) duplicates.push(key);
      seen[key]++;
    } else {
      seen[key] = 1;
    }
  }
  return duplicates;
}


// ============================================================================
// MAIN PIPELINE
// ============================================================================

/**
 * Execute hardened parsing pipeline (Phases 1, 2, 4 — no AI repair).
 * @param {string} rawText
 * @returns {object} HardenedParseResult
 */
function parseChecklist(rawText) {
  if (!rawText || !rawText.trim()) {
    return {
      metadata: { setName: null, year: null, publisher: null, declaredCardCount: null, sport: 'Baseball' },
      sections: [],
      validationErrors: [],
      duplicateCardNumbers: [],
      summary: { totalCards: 0, totalParallels: 0, cardsNeedingReview: 0, parallelsNeedingReview: 0 },
    };
  }

  // Phase 1: Segment blocks
  const segments = segmentBlocks(rawText);

  // Separate segments by type
  const metadataSegments = segments.filter(s => s.blockType === 'metadata');
  const parallelSegments = segments.filter(s => s.blockType === 'parallels');
  const cardSegments = segments.filter(s => s.blockType === 'cards');
  const sectionHeaderSegments = segments.filter(s => s.blockType === 'section_header');

  // Phase 2: Deterministic extraction
  const allMetadataLines = [];
  for (const seg of metadataSegments) {
    for (const line of seg.lines) allMetadataLines.push(line);
  }
  const metadata = _extractMetadataDeterministic(allMetadataLines);

  // Build section-aware data structures
  const sectionData = {};
  const baseParallels = [];
  const baseCards = [];

  // Initialize sections from section headers
  for (const seg of sectionHeaderSegments) {
    const sectionName = seg.label || seg.parentSection;
    if (sectionName && !sectionData[sectionName]) {
      let declaredCount = null;
      let odds = '';
      for (const metaSeg of metadataSegments) {
        if (metaSeg.parentSection === sectionName) {
          for (const line of metaSeg.lines) {
            // Extract card count (with or without period)
            const countMatch = line.match(/^(\d+)\s+cards?\.?\s*$/i);
            if (countMatch && declaredCount === null) {
              declaredCount = parseInt(countMatch[1], 10);
            }
            // Also try standard extraction
            if (declaredCount === null) {
              const count = _extractCardCountDeclaration(line);
              if (count !== null) declaredCount = count;
            }
            // Extract odds
            if (/^odds\b/i.test(line)) odds = line;
          }
        }
      }
      sectionData[sectionName] = {
        parallels: [],
        cards: [],
        declaredCount,
        odds,
        notes: [],
      };
    }
  }

  // Extract parallels
  for (const seg of parallelSegments) {
    for (let i = 0; i < seg.lines.length; i++) {
      const parallel = _extractParallelDeterministic(seg.lines[i], seg.startLine + i);
      if (parallel) {
        if (seg.parentSection && sectionData[seg.parentSection]) {
          sectionData[seg.parentSection].parallels.push(parallel);
        } else {
          baseParallels.push(parallel);
        }
      }
    }
  }

  // Extract cards
  for (const seg of cardSegments) {
    for (let i = 0; i < seg.lines.length; i++) {
      const card = _extractCardDeterministic(seg.lines[i], seg.startLine + i);
      if (card) {
        if (seg.parentSection && sectionData[seg.parentSection]) {
          sectionData[seg.parentSection].cards.push(card);
        } else {
          baseCards.push(card);
        }
      }
    }
  }

  // Phase 4: Validation gates
  const allCards = [...baseCards];
  const allParallels = [...baseParallels];
  for (const data of Object.values(sectionData)) {
    allCards.push(...data.cards);
    allParallels.push(...data.parallels);
  }

  const validationErrors = [];
  for (const card of allCards) {
    const errors = _validateCard(card);
    validationErrors.push(...errors);
  }

  // Detect duplicates
  const duplicateCardNumbers = [];
  const duplicateSet = new Set();

  const baseDuplicates = new Set(_detectDuplicateCardNumbers(baseCards));
  for (const cardNo of baseDuplicates) {
    if (!duplicateSet.has(cardNo)) {
      duplicateCardNumbers.push(cardNo);
      duplicateSet.add(cardNo);
    }
  }
  for (const card of baseCards) {
    if (baseDuplicates.has(card.cardNumber.toUpperCase().trim())) {
      card.needsReview = true;
    }
  }

  for (const [sectionName, data] of Object.entries(sectionData)) {
    const sectionDups = new Set(_detectDuplicateCardNumbers(data.cards));
    for (const cardNo of sectionDups) {
      if (!duplicateSet.has(cardNo)) {
        duplicateCardNumbers.push(cardNo);
        duplicateSet.add(cardNo);
      }
    }
    for (const card of data.cards) {
      if (sectionDups.has(card.cardNumber.toUpperCase().trim())) {
        card.needsReview = true;
      }
    }
  }

  // Build sections array
  const sections = [];

  // Base section first (if we have base cards or base parallels)
  if (baseCards.length > 0 || baseParallels.length > 0) {
    sections.push({
      name: 'Base',
      sectionType: 'base',
      declaredCount: metadata.declaredCardCount,
      odds: '',
      parallels: baseParallels,
      cards: baseCards,
    });
  }

  // Insert sections
  for (const [sectionName, data] of Object.entries(sectionData)) {
    sections.push({
      name: sectionName,
      sectionType: _classifySectionType(sectionName),
      declaredCount: data.declaredCount,
      odds: data.odds || '',
      parallels: data.parallels,
      cards: data.cards,
    });
  }

  // Summary
  const summary = {
    totalCards: allCards.length,
    totalParallels: allParallels.length,
    cardsNeedingReview: allCards.filter(c => c.needsReview).length,
    parallelsNeedingReview: allParallels.filter(p => p.needsReview).length,
  };

  return {
    metadata,
    sections,
    validationErrors,
    duplicateCardNumbers,
    summary,
  };
}


/**
 * Backward-compatible adapter — maps hardened result to the old shape
 * used by the existing import endpoint.
 * @param {string} text
 * @returns {{ sections: Array<{name, rawHeading, cardCount, odds, parallels, cards}> }}
 */
function parsePastedChecklist(text) {
  const result = parseChecklist(text);

  const sections = result.sections.map(s => ({
    name: s.name,
    rawHeading: s.name,
    cardCount: s.declaredCount || s.cards.length,
    odds: s.odds || '',
    parallels: s.parallels.map(p => ({
      name: p.name,
      printRun: p.printRun,
      exclusive: p.exclusive || '',
      notes: p.notes || '',
      rawLine: p.rawLine || p.nameRaw || '',
    })),
    cards: s.cards.map(c => ({
      cardNumber: c.cardNumber,
      player: c.player,
      team: c.team || '',
      rcSp: c.rcSp || '',
    })),
  }));

  return { sections };
}


module.exports = {
  parseChecklist,
  parsePastedChecklist,
  segmentBlocks,
  cleanParallelLine,
  cleanParallelsList,
  matchTeamTokens,
  _isMetadataLine,
  _isParallelSectionHeader,
  _isCardSectionHeader,
  _isInsertSectionHeader,
  _isParallelDefinitionLine,
  _extractCardDeterministic,
  _extractParallelDeterministic,
  _extractMetadataDeterministic,
  _extractFlags,
  _extractSerialMax,
  _extractChannels,
  _normalizeParallelName,
  _classifySectionType,
  _validateCard,
  _detectDuplicateCardNumbers,
  _extractCardCountDeclaration,
  generateRowId,
  TEAM_NAMES,
  PARALLEL_PREFIXES,
  EXCLUSIVE_KEYWORDS,
  FLAG_PATTERNS,
};
