const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('../hardened-parser');


// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

describe('cleanParallelLine', () => {
  it('strips odds parentheticals', () => {
    assert.equal(cleanParallelLine('Rainbow Foil – (1:11 hobby, 1:2 jumbo, 1:11 value)'), 'Rainbow Foil');
  });
  it('keeps serial numbers', () => {
    assert.equal(cleanParallelLine('Gold /50 (Hobby, Jumbo)'), 'Gold /50');
  });
  it('strips exclusive parentheticals', () => {
    assert.equal(cleanParallelLine('Pink Rainbow Foil /25 (Retail only)'), 'Pink Rainbow Foil /25');
  });
  it('strips trailing dashes', () => {
    assert.equal(cleanParallelLine('Independence Day –'), 'Independence Day');
  });
  it('returns empty for empty input', () => {
    assert.equal(cleanParallelLine(''), '');
    assert.equal(cleanParallelLine(null), '');
  });
});

describe('cleanParallelsList', () => {
  it('parses multi-line parallels', () => {
    const input = 'Rainbow Foil – (1:11 hobby)\nGold /50 (Hobby)\nSilver /100';
    const result = cleanParallelsList(input);
    assert.deepEqual(result, ['Rainbow Foil', 'Gold /50', 'Silver /100']);
  });
  it('handles semicolon separation', () => {
    const result = cleanParallelsList('Gold /50; Silver /100; Bronze');
    assert.deepEqual(result, ['Gold /50', 'Silver /100', 'Bronze']);
  });
  it('strips Parallels: prefix', () => {
    const result = cleanParallelsList('Parallels: Gold /50; Silver /100');
    assert.deepEqual(result, ['Gold /50', 'Silver /100']);
  });
});

describe('matchTeamTokens', () => {
  it('matches multi-word team names', () => {
    const tokens = ['Boston', 'Red', 'Sox'];
    const result = matchTeamTokens(tokens, 0);
    assert.equal(result.team, 'Boston Red Sox');
    assert.equal(result.consumed, 3);
  });
  it('matches single-word team in multi-word context', () => {
    const tokens = ['chicago', 'cubs'];
    const result = matchTeamTokens(tokens, 0);
    assert.equal(result.team, 'Chicago Cubs');
  });
  it('returns null for non-team tokens', () => {
    const result = matchTeamTokens(['Bananas'], 0);
    assert.equal(result.team, null);
  });
});


// ============================================================================
// PHASE 1: BLOCK SEGMENTATION
// ============================================================================

describe('_isMetadataLine', () => {
  it('recognizes checklist headers', () => {
    assert.ok(_isMetadataLine('Base Set Checklist'));
  });
  it('recognizes card count lines', () => {
    assert.ok(_isMetadataLine('350 cards'));
  });
  it('recognizes year-starting lines', () => {
    assert.ok(_isMetadataLine('2025 Bowman Baseball'));
  });
  it('recognizes publisher lines', () => {
    assert.ok(_isMetadataLine('Topps Chrome'));
  });
  it('rejects card lines', () => {
    assert.ok(!_isMetadataLine('US1 Kristian Campbell, Boston Red Sox RC'));
  });
});

describe('_isParallelSectionHeader', () => {
  it('recognizes "Parallels"', () => {
    assert.ok(_isParallelSectionHeader('Parallels'));
  });
  it('recognizes "Parallel Versions"', () => {
    assert.ok(_isParallelSectionHeader('Parallel Versions'));
  });
  it('rejects card lines', () => {
    assert.ok(!_isParallelSectionHeader('Gold /2025'));
  });
});

describe('_isInsertSectionHeader', () => {
  it('recognizes "Baseball Stars Autographs"', () => {
    const { isHeader, sectionName } = _isInsertSectionHeader('Baseball Stars Autographs');
    assert.ok(isHeader);
    assert.equal(sectionName, 'Baseball Stars Autographs');
  });
  it('recognizes "Future Stars"', () => {
    const { isHeader } = _isInsertSectionHeader('Future Stars');
    assert.ok(isHeader);
  });
  it('rejects card lines', () => {
    const { isHeader } = _isInsertSectionHeader('US1 Kristian Campbell, Boston Red Sox RC');
    assert.ok(!isHeader);
  });
  it('rejects set name lines', () => {
    const { isHeader } = _isInsertSectionHeader('2024 Topps Update Baseball');
    assert.ok(!isHeader);
  });
  it('rejects parallel definitions', () => {
    const { isHeader } = _isInsertSectionHeader('Gold /2025');
    assert.ok(!isHeader);
  });
  it('rejects card count declarations', () => {
    const { isHeader } = _isInsertSectionHeader('46 cards');
    assert.ok(!isHeader);
  });
});

describe('_isParallelDefinitionLine — critical discriminator', () => {
  it('"Gold /2025" is a parallel', () => {
    assert.ok(_isParallelDefinitionLine('Gold /2025'));
  });
  it('"Aqua Holo Foil (Retail Exclusive)" is a parallel', () => {
    assert.ok(_isParallelDefinitionLine('Aqua Holo Foil (Retail Exclusive)'));
  });
  it('"Pink Rainbow Foil /250" is a parallel', () => {
    assert.ok(_isParallelDefinitionLine('Pink Rainbow Foil /250'));
  });
  it('"Rainbow Foil – (1:11 hobby, 1:2 jumbo)" is a parallel', () => {
    assert.ok(_isParallelDefinitionLine('Rainbow Foil – (1:11 hobby, 1:2 jumbo)'));
  });
  it('"Royal Blue – (1:11 value, 1:4 hanger)" is a parallel', () => {
    assert.ok(_isParallelDefinitionLine('Royal Blue – (1:11 value, 1:4 hanger)'));
  });
  it('"Silver" is a parallel', () => {
    assert.ok(_isParallelDefinitionLine('Silver'));
  });

  // NOT parallels — card lines
  it('"US1 Kristian Campbell, Boston Red Sox RC" is NOT a parallel', () => {
    assert.ok(!_isParallelDefinitionLine('US1 Kristian Campbell, Boston Red Sox RC'));
  });
  it('"1 Mike Trout - Angels" is NOT a parallel', () => {
    assert.ok(!_isParallelDefinitionLine('1 Mike Trout - Angels'));
  });
  it('"MMU-AB Alex Bregman, Boston Red Sox" is NOT a parallel (despite "Red")', () => {
    assert.ok(!_isParallelDefinitionLine('MMU-AB Alex Bregman, Boston Red Sox'));
  });
  it('"BSAU-AB Adrian Beltré, Texas Rangers" is NOT a parallel', () => {
    assert.ok(!_isParallelDefinitionLine('BSAU-AB Adrian Beltré, Texas Rangers'));
  });
});

describe('_extractCardCountDeclaration', () => {
  it('extracts "46 cards"', () => {
    assert.equal(_extractCardCountDeclaration('46 cards'), 46);
  });
  it('extracts "350 Cards"', () => {
    assert.equal(_extractCardCountDeclaration('350 Cards'), 350);
  });
  it('returns null for non-count lines', () => {
    assert.equal(_extractCardCountDeclaration('Gold /50'), null);
  });
});

describe('segmentBlocks', () => {
  it('classifies metadata, parallels, and cards correctly', () => {
    const text = [
      '2025 Bowman Baseball Checklist',
      '350 cards',
      '',
      'Parallels',
      'Gold /2025',
      'Silver /100',
      '',
      'US1 Kristian Campbell, Boston Red Sox RC',
      'US2 Mike Trout, Los Angeles Angels',
    ].join('\n');

    const segments = segmentBlocks(text);
    const types = segments.map(s => s.blockType);
    assert.ok(types.includes('metadata'));
    assert.ok(types.includes('parallels'));
    assert.ok(types.includes('cards'));
  });

  it('detects section headers', () => {
    const text = [
      'US1 Kristian Campbell, Boston Red Sox RC',
      '',
      'Baseball Stars Autographs',
      '46 cards',
      'BSAU-AB Adrian Beltré, Texas Rangers',
    ].join('\n');

    const segments = segmentBlocks(text);
    const sectionHeaders = segments.filter(s => s.blockType === 'section_header');
    assert.ok(sectionHeaders.length > 0);
    assert.equal(sectionHeaders[0].label, 'Baseball Stars Autographs');
  });
});


// ============================================================================
// PHASE 2: DETERMINISTIC EXTRACTION
// ============================================================================

describe('_extractFlags', () => {
  it('extracts RC flag', () => {
    const flags = _extractFlags('Boston Red Sox RC');
    assert.ok(flags.includes('RC'));
  });
  it('extracts Rookie Debut flag', () => {
    const flags = _extractFlags('Rookie Debut something');
    assert.ok(flags.includes('Rookie Debut'));
  });
  it('extracts multiple flags', () => {
    const flags = _extractFlags('RC All-Star');
    assert.ok(flags.includes('RC'));
    assert.ok(flags.includes('All-Star'));
  });
  it('returns empty for no flags', () => {
    assert.deepEqual(_extractFlags('Mike Trout'), []);
  });
});

describe('_extractCardDeterministic', () => {
  it('parses comma format: "US1 Kristian Campbell, Boston Red Sox RC"', () => {
    const card = _extractCardDeterministic('US1 Kristian Campbell, Boston Red Sox RC', 0);
    assert.ok(card);
    assert.equal(card.cardNumber, 'US1');
    assert.equal(card.player, 'Kristian Campbell');
    assert.equal(card.team, 'Boston Red Sox');
    assert.ok(card.flags.includes('RC'));
    assert.equal(card.confidence, 1.0);
  });

  it('parses dash format: "1 Mike Trout - Los Angeles Angels"', () => {
    const card = _extractCardDeterministic('1 Mike Trout - Los Angeles Angels', 0);
    assert.ok(card);
    assert.equal(card.cardNumber, '1');
    assert.equal(card.player, 'Mike Trout');
    assert.equal(card.team, 'Los Angeles Angels');
  });

  it('parses card with prefix code: "BSAU-AB Adrian Beltré, Texas Rangers"', () => {
    const card = _extractCardDeterministic('BSAU-AB Adrian Beltré, Texas Rangers', 0);
    assert.ok(card);
    assert.equal(card.cardNumber, 'BSAU-AB');
    assert.equal(card.player, 'Adrian Beltré');
    assert.equal(card.team, 'Texas Rangers');
  });

  it('handles missing team (lower confidence)', () => {
    const card = _extractCardDeterministic('US99 Some Player Name', 0);
    assert.ok(card);
    assert.equal(card.cardNumber, 'US99');
    assert.equal(card.confidence, 0.9);
  });

  it('extracts parenthetical notes', () => {
    const card = _extractCardDeterministic('US1 Player, Team (Veteran Combos)', 0);
    assert.ok(card);
    assert.ok(card.notes);
    assert.ok(card.notes.includes('Veteran Combos'));
  });

  it('returns null for non-card lines', () => {
    assert.equal(_extractCardDeterministic('Gold /2025', 0), null);
    assert.equal(_extractCardDeterministic('', 0), null);
  });

  it('generates rowId', () => {
    const card = _extractCardDeterministic('US1 Player, Team', 5);
    assert.ok(card);
    assert.ok(card.rowId);
    assert.equal(card.rowId.length, 16);
  });
});

describe('_extractSerialMax', () => {
  it('extracts /2025', () => {
    assert.equal(_extractSerialMax('Gold /2025'), 2025);
  });
  it('extracts /50', () => {
    assert.equal(_extractSerialMax('Blue Refractor /50'), 50);
  });
  it('returns null when no serial', () => {
    assert.equal(_extractSerialMax('Rainbow Foil'), null);
  });
});

describe('_extractChannels', () => {
  it('extracts hobby', () => {
    const ch = _extractChannels('(Hobby Exclusive)');
    assert.ok(ch.includes('hobby'));
  });
  it('extracts retail', () => {
    const ch = _extractChannels('Retail only');
    assert.ok(ch.includes('retail'));
  });
  it('extracts multiple channels', () => {
    const ch = _extractChannels('(1:11 hobby, 1:2 jumbo, 1:11 value)');
    assert.ok(ch.includes('hobby'));
    assert.ok(ch.includes('jumbo'));
    assert.ok(ch.includes('value_box'));
  });
  it('returns empty array for unknown', () => {
    const ch = _extractChannels('Some random text');
    assert.deepEqual(ch, []);
  });
});

describe('_normalizeParallelName', () => {
  it('strips serial number', () => {
    assert.equal(_normalizeParallelName('Gold /2025'), 'Gold');
  });
  it('strips parentheticals', () => {
    assert.equal(_normalizeParallelName('Aqua Holo Foil (Retail Exclusive)'), 'Aqua Holo Foil');
  });
  it('strips trailing dashes', () => {
    assert.equal(_normalizeParallelName('Rainbow Foil –'), 'Rainbow Foil');
  });
});

describe('_extractParallelDeterministic', () => {
  it('extracts "Gold /2025"', () => {
    const p = _extractParallelDeterministic('Gold /2025', 0);
    assert.ok(p);
    assert.equal(p.name, 'Gold');
    assert.equal(p.serialMax, 2025);
    assert.equal(p.printRun, 2025);
    assert.equal(p.confidence, 1.0);
  });

  it('extracts "Aqua Holo Foil (Retail Exclusive)"', () => {
    const p = _extractParallelDeterministic('Aqua Holo Foil (Retail Exclusive)', 0);
    assert.ok(p);
    assert.equal(p.name, 'Aqua Holo Foil');
    assert.equal(p.exclusive, 'Retail');
    assert.ok(p.channels.includes('retail'));
  });

  it('extracts variation type for autograph parallels', () => {
    const p = _extractParallelDeterministic('Gold Auto Refractor /50', 0);
    assert.ok(p);
    assert.equal(p.variationType, 'autograph');
  });

  it('extracts variation type for relic parallels', () => {
    const p = _extractParallelDeterministic('Gold Relic Foil /25', 0);
    assert.ok(p);
    assert.equal(p.variationType, 'relic');
  });

  it('returns null for card lines', () => {
    assert.equal(_extractParallelDeterministic('US1 Player, Team', 0), null);
  });
});

describe('_extractMetadataDeterministic', () => {
  it('extracts year, publisher, set name', () => {
    const meta = _extractMetadataDeterministic([
      '2025 Bowman Baseball Checklist',
      '350 cards',
    ]);
    assert.equal(meta.year, 2025);
    assert.equal(meta.publisher, 'Bowman');
    assert.equal(meta.setName, '2025 Bowman Baseball Checklist');
    assert.equal(meta.declaredCardCount, 350);
  });

  it('handles lines without year', () => {
    const meta = _extractMetadataDeterministic(['Some Checklist']);
    assert.equal(meta.year, null);
    assert.equal(meta.setName, 'Some Checklist');
  });
});

describe('_classifySectionType', () => {
  it('classifies base sections', () => {
    assert.equal(_classifySectionType('Base'), 'base');
    assert.equal(_classifySectionType('Base Set'), 'base');
    assert.equal(_classifySectionType('Base Cards'), 'base');
  });
  it('classifies autograph sections', () => {
    assert.equal(_classifySectionType('Baseball Stars Autographs'), 'autograph');
    assert.equal(_classifySectionType('Auto Relics'), 'autograph');
    assert.equal(_classifySectionType('Ink Signatures'), 'autograph');
  });
  it('classifies relic sections', () => {
    assert.equal(_classifySectionType('Major League Materials'), 'relic');
    assert.equal(_classifySectionType('Relic Cards'), 'relic');
    assert.equal(_classifySectionType('Game Used Jersey'), 'relic');
  });
  it('classifies insert sections', () => {
    assert.equal(_classifySectionType('Future Stars'), 'insert');
    assert.equal(_classifySectionType('Chrome Prospects'), 'insert');
    assert.equal(_classifySectionType('Draft Picks'), 'insert');
  });
});


// ============================================================================
// PHASE 4: VALIDATION
// ============================================================================

describe('_validateCard', () => {
  it('detects suspicious characters in card number', () => {
    const errors = _validateCard({
      cardNumber: "US1'",
      player: 'Player',
      confidence: 1.0,
      needsReview: false,
      rowId: 'abc123',
    });
    assert.ok(errors.length > 0);
    assert.equal(errors[0].errorType, 'suspicious_characters');
  });

  it('detects low confidence without review flag', () => {
    const errors = _validateCard({
      cardNumber: 'US1',
      player: 'Player',
      confidence: 0.4,
      needsReview: false,
      rowId: 'abc123',
    });
    assert.ok(errors.length > 0);
    assert.equal(errors[0].errorType, 'low_confidence');
  });

  it('passes valid cards', () => {
    const errors = _validateCard({
      cardNumber: 'US1',
      player: 'Mike Trout',
      confidence: 1.0,
      needsReview: false,
      rowId: 'abc123',
    });
    assert.equal(errors.length, 0);
  });
});

describe('_detectDuplicateCardNumbers', () => {
  it('detects duplicates', () => {
    const cards = [
      { cardNumber: 'US1' },
      { cardNumber: 'US2' },
      { cardNumber: 'US1' },
    ];
    const dups = _detectDuplicateCardNumbers(cards);
    assert.deepEqual(dups, ['US1']);
  });

  it('returns empty for no duplicates', () => {
    const cards = [
      { cardNumber: 'US1' },
      { cardNumber: 'US2' },
    ];
    assert.deepEqual(_detectDuplicateCardNumbers(cards), []);
  });
});


// ============================================================================
// FULL PIPELINE
// ============================================================================

describe('parseChecklist — full pipeline', () => {
  it('parses a complete Beckett-style checklist', () => {
    const text = [
      '2025 Bowman Baseball Checklist',
      '350 cards',
      '',
      'Parallels',
      'Gold /2025',
      'Silver /100',
      'Pink Refractor /50',
      '',
      '1 Mike Trout, Los Angeles Angels',
      '2 Shohei Ohtani, Los Angeles Dodgers',
      '3 Aaron Judge, New York Yankees RC',
    ].join('\n');

    const result = parseChecklist(text);
    assert.ok(result.metadata);
    assert.equal(result.metadata.year, 2025);
    assert.equal(result.metadata.publisher, 'Bowman');
    assert.equal(result.metadata.declaredCardCount, 350);

    assert.ok(result.sections.length > 0);
    const baseSection = result.sections.find(s => s.sectionType === 'base');
    assert.ok(baseSection);
    assert.ok(baseSection.cards.length >= 3);
    assert.ok(baseSection.parallels.length >= 3);

    // Check first card
    const firstCard = baseSection.cards[0];
    assert.equal(firstCard.cardNumber, '1');
    assert.equal(firstCard.player, 'Mike Trout');
    assert.equal(firstCard.team, 'Los Angeles Angels');

    // Check RC flag on third card
    const thirdCard = baseSection.cards[2];
    assert.ok(thirdCard.flags.includes('RC'));

    // Check parallels
    const gold = baseSection.parallels.find(p => p.name === 'Gold');
    assert.ok(gold);
    assert.equal(gold.serialMax, 2025);
    assert.equal(gold.printRun, 2025);
  });

  it('handles insert sections with their own parallels', () => {
    const text = [
      '1 Mike Trout, Los Angeles Angels',
      '2 Shohei Ohtani, Los Angeles Dodgers',
      '',
      'Baseball Stars Autographs',
      '46 cards',
      '',
      'Parallels',
      'Gold /50',
      '',
      'BSAU-AB Adrian Beltré, Texas Rangers',
      'BSAU-MT Mike Trout, Los Angeles Angels',
    ].join('\n');

    const result = parseChecklist(text);
    assert.ok(result.sections.length >= 2);

    const autoSection = result.sections.find(s => s.sectionType === 'autograph');
    assert.ok(autoSection);
    assert.equal(autoSection.name, 'Baseball Stars Autographs');
    assert.ok(autoSection.cards.length >= 2);
  });

  it('returns empty result for empty input', () => {
    const result = parseChecklist('');
    assert.equal(result.sections.length, 0);
    assert.equal(result.summary.totalCards, 0);
  });

  it('calculates summary correctly', () => {
    const text = [
      '1 Mike Trout, Los Angeles Angels',
      '2 Shohei Ohtani, Los Angeles Dodgers',
      '',
      'Parallels',
      'Gold /50',
    ].join('\n');

    const result = parseChecklist(text);
    assert.equal(result.summary.totalCards, 2);
    assert.equal(result.summary.totalParallels, 1);
  });

  it('detects duplicate card numbers', () => {
    const text = [
      '1 Mike Trout, Los Angeles Angels',
      '2 Shohei Ohtani, Los Angeles Dodgers',
      '1 Aaron Judge, New York Yankees',
    ].join('\n');

    const result = parseChecklist(text);
    assert.ok(result.duplicateCardNumbers.length > 0);
  });
});


// ============================================================================
// BACKWARD COMPATIBILITY
// ============================================================================

describe('parsePastedChecklist — backward compat adapter', () => {
  it('returns legacy shape', () => {
    const text = [
      '1 Mike Trout, Los Angeles Angels',
      '2 Shohei Ohtani, Los Angeles Dodgers',
      '',
      'Parallels',
      'Gold /50',
    ].join('\n');

    const result = parsePastedChecklist(text);
    assert.ok(result.sections);
    assert.ok(Array.isArray(result.sections));

    if (result.sections.length > 0) {
      const section = result.sections[0];
      assert.ok('name' in section);
      assert.ok('rawHeading' in section);
      assert.ok('cardCount' in section);
      assert.ok('odds' in section);
      assert.ok('parallels' in section);
      assert.ok('cards' in section);

      if (section.cards.length > 0) {
        const card = section.cards[0];
        assert.ok('cardNumber' in card);
        assert.ok('player' in card);
        assert.ok('team' in card);
        assert.ok('rcSp' in card);
      }

      if (section.parallels.length > 0) {
        const parallel = section.parallels[0];
        assert.ok('name' in parallel);
        assert.ok('printRun' in parallel);
        assert.ok('exclusive' in parallel);
        assert.ok('notes' in parallel);
        assert.ok('rawLine' in parallel);
      }
    }
  });

  it('card rcSp contains flags', () => {
    const text = '1 Aaron Judge, New York Yankees RC';
    const result = parsePastedChecklist(text);
    assert.ok(result.sections.length > 0);
    const card = result.sections[0].cards[0];
    assert.ok(card.rcSp.includes('RC'));
  });
});
