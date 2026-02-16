/**
 * Tests for the Beckett Checklist Parser
 * Run: node --test tests/test-checklist-parser.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  parsePastedChecklist,
  parseParallelLine,
  matchTeamTokens,
  extractFlags,
  cleanTeamSuffix,
  TEAM_NAMES,
  FLAG_TOKENS,
} = require('../checklist-parser');


// ============================================================
// matchTeamTokens
// ============================================================

describe('matchTeamTokens', () => {
  it('matches 3-token team (Los Angeles Angels)', () => {
    const { team, consumed } = matchTeamTokens(['Los', 'Angeles', 'Angels']);
    assert.equal(team, 'Los Angeles Angels');
    assert.equal(consumed, 3);
  });

  it('matches 3-token team (New York Yankees)', () => {
    const { team, consumed } = matchTeamTokens(['New', 'York', 'Yankees']);
    assert.equal(team, 'New York Yankees');
    assert.equal(consumed, 3);
  });

  it('matches 3-token team (San Francisco Giants)', () => {
    const { team, consumed } = matchTeamTokens(['San', 'Francisco', 'Giants']);
    assert.equal(team, 'San Francisco Giants');
    assert.equal(consumed, 3);
  });

  it('matches 3-token team (St. Louis Cardinals)', () => {
    const { team, consumed } = matchTeamTokens(['St.', 'Louis', 'Cardinals']);
    assert.equal(team, 'St. Louis Cardinals');
    assert.equal(consumed, 3);
  });

  it('matches 2-token team (Atlanta Braves)', () => {
    const { team, consumed } = matchTeamTokens(['Atlanta', 'Braves']);
    assert.equal(team, 'Atlanta Braves');
    assert.equal(consumed, 2);
  });

  it('matches 2-token team (Detroit Tigers)', () => {
    const { team, consumed } = matchTeamTokens(['Detroit', 'Tigers']);
    assert.equal(team, 'Detroit Tigers');
    assert.equal(consumed, 2);
  });

  it('returns null for no match', () => {
    const { team, consumed } = matchTeamTokens(['Some', 'Random', 'Words']);
    assert.equal(team, null);
    assert.equal(consumed, 0);
  });

  it('matches at startIdx offset', () => {
    const { team, consumed } = matchTeamTokens(['foo', 'New', 'York', 'Yankees'], 1);
    assert.equal(team, 'New York Yankees');
    assert.equal(consumed, 3);
  });

  it('matches case-insensitively', () => {
    const { team, consumed } = matchTeamTokens(['BOSTON', 'RED', 'SOX']);
    assert.equal(team, 'Boston Red Sox');
    assert.equal(consumed, 3);
  });

  it('all 30 teams are in TEAM_NAMES', () => {
    assert.equal(TEAM_NAMES.length, 30);
  });
});


// ============================================================
// extractFlags
// ============================================================

describe('extractFlags', () => {
  it('extracts RC flag', () => {
    const { flags } = extractFlags('RC');
    assert.ok(flags.includes('RC'));
  });

  it('extracts SP flag', () => {
    const { flags } = extractFlags('SP');
    assert.ok(flags.includes('SP'));
  });

  it('extracts multiple flags', () => {
    const { flags } = extractFlags('RC SP');
    assert.ok(flags.includes('RC'));
    assert.ok(flags.includes('SP'));
  });

  it('extracts subset keyword', () => {
    const { flags } = extractFlags('Rookie Debut');
    assert.ok(flags.includes('Rookie Debut'));
  });

  it('extracts mixed flags and subsets', () => {
    const { flags } = extractFlags('Rookie Debut RC SSP');
    assert.ok(flags.includes('Rookie Debut'));
    assert.ok(flags.includes('RC'));
    assert.ok(flags.includes('SSP'));
  });

  it('returns empty for no flags', () => {
    const { flags } = extractFlags('Mike Trout');
    assert.equal(flags.length, 0);
  });

  it('handles empty string', () => {
    const { flags } = extractFlags('');
    assert.equal(flags.length, 0);
  });

  it('handles null', () => {
    const { flags } = extractFlags(null);
    assert.equal(flags.length, 0);
  });
});


// ============================================================
// cleanTeamSuffix
// ============================================================

describe('cleanTeamSuffix', () => {
  it('strips RC and captures flag', () => {
    const { team, flags } = cleanTeamSuffix('Los Angeles Angels RC');
    assert.equal(team, 'Los Angeles Angels');
    assert.ok(flags.includes('RC'));
  });

  it('strips RD and captures flag', () => {
    const { team, flags } = cleanTeamSuffix('New York Yankees RD');
    assert.equal(team, 'New York Yankees');
    assert.ok(flags.includes('RD'));
  });

  it('strips Season Highlights', () => {
    const { team, flags } = cleanTeamSuffix('Boston Red Sox Season Highlights');
    assert.equal(team, 'Boston Red Sox');
    assert.equal(flags.length, 0);
  });

  it('strips /Checklist', () => {
    const { team } = cleanTeamSuffix('Chicago Cubs/Checklist');
    assert.equal(team, 'Chicago Cubs');
  });

  it('strips Combo', () => {
    const { team } = cleanTeamSuffix('Houston Astros Combo');
    assert.equal(team, 'Houston Astros');
  });

  it('no suffix — pass through', () => {
    const { team, flags } = cleanTeamSuffix('Atlanta Braves');
    assert.equal(team, 'Atlanta Braves');
    assert.equal(flags.length, 0);
  });

  it('handles empty string', () => {
    const { team, flags } = cleanTeamSuffix('');
    assert.equal(team, '');
    assert.equal(flags.length, 0);
  });
});


// ============================================================
// parseParallelLine
// ============================================================

describe('parseParallelLine', () => {
  it('parses name + print run', () => {
    const p = parseParallelLine('Gold /50');
    assert.equal(p.name, 'Gold');
    assert.equal(p.printRun, 50);
  });

  it('parses name without print run', () => {
    const p = parseParallelLine('Blue Refractor');
    assert.equal(p.name, 'Blue Refractor');
    assert.equal(p.printRun, null);
  });

  it('parses exclusive keyword', () => {
    const p = parseParallelLine('Red (Hobby Exclusive) /25');
    assert.equal(p.name, 'Red');
    assert.equal(p.printRun, 25);
    assert.equal(p.exclusive, 'Hobby');
    assert.equal(p.notes, 'Hobby Exclusive');
  });

  it('parses notes in parentheses', () => {
    const p = parseParallelLine('Green (only in jumbo packs) /99');
    assert.equal(p.printRun, 99);
    assert.equal(p.notes, 'only in jumbo packs');
  });

  it('parses 1/1', () => {
    const p = parseParallelLine('Platinum 1/1');
    assert.equal(p.printRun, 1);
    assert.ok(p.name.includes('Platinum'));
  });

  it('returns null for empty line', () => {
    assert.equal(parseParallelLine(''), null);
    assert.equal(parseParallelLine(null), null);
  });

  it('preserves rawLine', () => {
    const p = parseParallelLine('  Gold /50  ');
    assert.equal(p.rawLine, '  Gold /50  ');
  });
});


// ============================================================
// parsePastedChecklist — pipe format
// ============================================================

describe('parsePastedChecklist — pipe format', () => {
  it('parses pipe-delimited cards in a section', () => {
    const text = `Base Set Checklist
200 cards.
1 | Mike Trout | Los Angeles Angels
2 | Shohei Ohtani | Los Angeles Dodgers`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].name, 'Base Set');
    assert.equal(sections[0].cardCount, 200);
    assert.equal(sections[0].cards.length, 2);
    assert.equal(sections[0].cards[0].cardNumber, '1');
    assert.equal(sections[0].cards[0].player, 'Mike Trout');
    assert.equal(sections[0].cards[0].team, 'Los Angeles Angels');
    assert.equal(sections[0].cards[1].cardNumber, '2');
    assert.equal(sections[0].cards[1].player, 'Shohei Ohtani');
  });

  it('captures RC from team suffix', () => {
    const text = `Base Set Checklist
1 | Juan Soto | New York Yankees RC`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].cards[0].team, 'New York Yankees');
    assert.equal(sections[0].cards[0].rcSp, 'RC');
  });
});


// ============================================================
// parsePastedChecklist — tab format
// ============================================================

describe('parsePastedChecklist — tab format', () => {
  it('parses tab-delimited cards', () => {
    const text = `Base Checklist
1\tMike Trout\tLos Angeles Angels
2\tAaron Judge\tNew York Yankees`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].cards.length, 2);
    assert.equal(sections[0].cards[0].player, 'Mike Trout');
    assert.equal(sections[0].cards[1].player, 'Aaron Judge');
  });
});


// ============================================================
// parsePastedChecklist — dash format
// ============================================================

describe('parsePastedChecklist — dash format', () => {
  it('parses dash-separated cards', () => {
    const text = `Base Set Checklist
1 Mike Trout - Los Angeles Angels
2 Shohei Ohtani - Los Angeles Dodgers`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].cards.length, 2);
    assert.equal(sections[0].cards[0].cardNumber, '1');
    assert.equal(sections[0].cards[0].player, 'Mike Trout');
    assert.equal(sections[0].cards[0].team, 'Los Angeles Angels');
  });

  it('captures RC flag from dash format', () => {
    const text = `Base Set Checklist
1 Juan Soto - New York Yankees RC`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].cards[0].rcSp, 'RC');
    assert.equal(sections[0].cards[0].team, 'New York Yankees');
  });
});


// ============================================================
// parsePastedChecklist — multi-line format
// ============================================================

describe('parsePastedChecklist — multi-line format', () => {
  it('parses 3-line card format (num, player, team)', () => {
    const text = `Base Checklist
1
Mike Trout
Los Angeles Angels
2
Shohei Ohtani
Los Angeles Dodgers`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].cards.length, 2);
    assert.equal(sections[0].cards[0].cardNumber, '1');
    assert.equal(sections[0].cards[0].player, 'Mike Trout');
    assert.equal(sections[0].cards[0].team, 'Los Angeles Angels');
    assert.equal(sections[0].cards[1].cardNumber, '2');
    assert.equal(sections[0].cards[1].player, 'Shohei Ohtani');
  });

  it('handles alphanumeric card numbers', () => {
    const text = `Update Checklist
US1
Victor Scott II
Cincinnati Reds
US2
Jordan Walker
St. Louis Cardinals`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].cards.length, 2);
    assert.equal(sections[0].cards[0].cardNumber, 'US1');
    assert.equal(sections[0].cards[0].player, 'Victor Scott II');
    assert.equal(sections[0].cards[1].cardNumber, 'US2');
  });
});


// ============================================================
// parsePastedChecklist — multiple sections
// ============================================================

describe('parsePastedChecklist — multiple sections', () => {
  it('detects multiple sections', () => {
    const text = `Base Set Checklist
1 | Player A | Team A

Update Checklist
2 | Player B | Team B`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].name, 'Base Set');
    assert.equal(sections[0].cards.length, 1);
    assert.equal(sections[1].name, 'Update');
    assert.equal(sections[1].cards.length, 1);
  });

  it('captures card count per section', () => {
    const text = `Base Set Checklist
350 cards.
1 | Player | Team

Chrome Checklist
50 cards.
1 | Player | Team`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].cardCount, 350);
    assert.equal(sections[1].cardCount, 50);
  });

  it('captures odds', () => {
    const text = `Insert Checklist
Odds: 1:24
1 | Player | Team`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].odds, 'Odds: 1:24');
  });
});


// ============================================================
// parsePastedChecklist — parallels
// ============================================================

describe('parsePastedChecklist — parallels', () => {
  it('parses inline parallels (semicolon-separated)', () => {
    const text = `Base Set Checklist
Parallels: Gold /50; Blue /150; Red 1/1
1 | Player | Team`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].parallels.length, 3);
    assert.equal(sections[0].parallels[0].name, 'Gold');
    assert.equal(sections[0].parallels[0].printRun, 50);
    assert.equal(sections[0].parallels[1].name, 'Blue');
    assert.equal(sections[0].parallels[1].printRun, 150);
  });

  it('parses multi-line parallels', () => {
    const text = `Base Set Checklist
Parallels:
Gold /50
Blue /150
Rainbow Foil

1 | Player | Team`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].parallels.length, 3);
    assert.equal(sections[0].parallels[0].name, 'Gold');
    assert.equal(sections[0].parallels[2].name, 'Rainbow Foil');
    // Cards should still be parsed after blank line ends parallels
    assert.equal(sections[0].cards.length, 1);
  });
});


// ============================================================
// parsePastedChecklist — dual autograph
// ============================================================

describe('parsePastedChecklist — dual autograph', () => {
  it('handles multi-line dual autograph cards', () => {
    const text = `Dual Autograph Checklist
6 cards.
MLMDA-ORI
Austin Riley
Atlanta Braves
Matt Olson
Atlanta Braves`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].cards.length, 1);
    assert.equal(sections[0].cards[0].cardNumber, 'MLMDA-ORI');
    assert.ok(sections[0].cards[0].player.includes('Austin Riley'));
    assert.ok(sections[0].cards[0].player.includes('Matt Olson'));
    assert.ok(sections[0].cards[0].player.includes(' / '));
  });

  it('handles dash-format dual autograph cards', () => {
    const text = `Dual Autograph Checklist
1AU Mike Trout - Los Angeles Angels
Aaron Judge - New York Yankees`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].cards.length, 1);
    assert.ok(sections[0].cards[0].player.includes('Mike Trout'));
    assert.ok(sections[0].cards[0].player.includes('Aaron Judge'));
  });
});


// ============================================================
// parsePastedChecklist — edge cases
// ============================================================

describe('parsePastedChecklist — edge cases', () => {
  it('empty input returns empty sections', () => {
    const { sections } = parsePastedChecklist('');
    assert.equal(sections.length, 0);
  });

  it('null input returns empty sections', () => {
    const { sections } = parsePastedChecklist(null);
    assert.equal(sections.length, 0);
  });

  it('flat card list without section header creates default Base section', () => {
    const text = `1 | Mike Trout | Angels
2 | Aaron Judge | Yankees`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections.length, 1);
    assert.equal(sections[0].name, 'Base');
    assert.equal(sections[0].cards.length, 2);
  });

  it('skips SUBJECT TO CHANGE lines', () => {
    const text = `Base Set Checklist
SUBJECT TO CHANGE.
1 | Player | Team`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].cards.length, 1);
  });

  it('handles Windows-style line endings', () => {
    const text = "Base Set Checklist\r\n1 | Player | Team\r\n2 | Player2 | Team2";
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].cards.length, 2);
  });

  it('handles card number with hyphen (US84-AB)', () => {
    const text = `Insert Checklist
US84-AB
Mike Trout
Los Angeles Angels`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].cards[0].cardNumber, 'US84-AB');
  });

  it('singular "card." works for card count', () => {
    const text = `Insert Checklist
1 card.
1 | Player | Team`;
    const { sections } = parsePastedChecklist(text);
    assert.equal(sections[0].cardCount, 1);
  });
});


// ============================================================
// Integration: realistic Beckett text
// ============================================================

describe('integration — realistic Beckett checklist', () => {
  it('parses multi-section Beckett text correctly', () => {
    const text = `Base Set Checklist
350 cards.
Parallels: Gold /2024; Independence Day /76; Vintage Stock /99; Black /1
1 | Juan Soto | New York Yankees
2 | Victor Scott II | Cincinnati Reds RC
3 | Elly De La Cruz | Cincinnati Reds RC
4 | Mookie Betts | Los Angeles Dodgers

Mystical Checklist
50 cards.
Odds: 1:6
M-1 | Shohei Ohtani | Los Angeles Dodgers
M-2 | Aaron Judge | New York Yankees

All-Star Stitch Autographs Checklist
27 cards.
Odds: 1:500
ASA-1 | Mike Trout | Los Angeles Angels
ASA-2 | Ronald Acuna Jr. | Atlanta Braves`;

    const { sections } = parsePastedChecklist(text);

    // Verify sections
    assert.equal(sections.length, 3);

    // Base Set
    assert.equal(sections[0].name, 'Base Set');
    assert.equal(sections[0].cardCount, 350);
    assert.equal(sections[0].cards.length, 4);
    assert.equal(sections[0].parallels.length, 4);
    assert.equal(sections[0].parallels[0].name, 'Gold');
    assert.equal(sections[0].parallels[0].printRun, 2024);
    assert.equal(sections[0].parallels[3].name, 'Black');
    assert.equal(sections[0].parallels[3].printRun, 1);

    // RC detection
    assert.equal(sections[0].cards[1].rcSp, 'RC');
    assert.equal(sections[0].cards[1].team, 'Cincinnati Reds');

    // Mystical
    assert.equal(sections[1].name, 'Mystical');
    assert.equal(sections[1].cardCount, 50);
    assert.equal(sections[1].odds, 'Odds: 1:6');
    assert.equal(sections[1].cards.length, 2);

    // Autographs
    assert.equal(sections[2].name, 'All-Star Stitch Autographs');
    assert.equal(sections[2].cardCount, 27);
    assert.equal(sections[2].cards.length, 2);
    assert.equal(sections[2].cards[0].cardNumber, 'ASA-1');
    assert.equal(sections[2].cards[0].player, 'Mike Trout');
  });
});
