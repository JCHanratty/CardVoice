/**
 * Parser tests — ported line-for-line from backend/tests/test_parser.py
 * Run: node --test tests/test-parser.js
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseSpokenNumbers, countCards, formatOutput } = require('../parser');

// ============================================================
// TestBasicNumbers
// ============================================================
describe('TestBasicNumbers', () => {
  it('test_digit_strings', () => {
    assert.deepStrictEqual(parseSpokenNumbers('42 55 103'), [42, 55, 103]);
  });
  it('test_single_digits', () => {
    assert.deepStrictEqual(parseSpokenNumbers('1 2 3 4 5'), [1, 2, 3, 4, 5]);
  });
  it('test_word_numbers', () => {
    assert.deepStrictEqual(parseSpokenNumbers('one two three four five'), [1, 2, 3, 4, 5]);
  });
  it('test_teens', () => {
    assert.deepStrictEqual(parseSpokenNumbers('eleven twelve thirteen'), [11, 12, 13]);
  });
  it('test_compound_tens', () => {
    assert.deepStrictEqual(parseSpokenNumbers('twenty three forty two'), [23, 42]);
  });
  it('test_hundreds', () => {
    assert.deepStrictEqual(parseSpokenNumbers('one hundred'), [100]);
    assert.deepStrictEqual(parseSpokenNumbers('one hundred fifty'), [150]);
    assert.deepStrictEqual(parseSpokenNumbers('two hundred thirty five'), [235]);
    assert.deepStrictEqual(parseSpokenNumbers('three hundred'), [300]);
  });
  it('test_mixed_words_and_digits', () => {
    assert.deepStrictEqual(parseSpokenNumbers('42 fifty five 103'), [42, 55, 103]);
  });
});

// ============================================================
// TestDuplicates
// ============================================================
describe('TestDuplicates', () => {
  it('test_repeated_numbers', () => {
    const result = parseSpokenNumbers('42 42 42');
    assert.deepStrictEqual(result, [42, 42, 42]);
    assert.deepStrictEqual(countCards(result), { 42: 3 });
  });
  it('test_times_multiplier', () => {
    assert.deepStrictEqual(parseSpokenNumbers('42 times 3'), [42, 42, 42]);
  });
  it('test_x_multiplier', () => {
    assert.deepStrictEqual(parseSpokenNumbers('55 x 2'), [55, 55]);
  });
  it('test_mixed_with_multiplier', () => {
    assert.deepStrictEqual(parseSpokenNumbers('42 times 3 55 103'), [42, 42, 42, 55, 103]);
  });
});

// ============================================================
// TestEdgeCases
// ============================================================
describe('TestEdgeCases', () => {
  it('test_empty_string', () => {
    assert.deepStrictEqual(parseSpokenNumbers(''), []);
  });
  it('test_filler_words', () => {
    assert.deepStrictEqual(parseSpokenNumbers('um 42 uh 55 like 103'), [42, 55, 103]);
  });
  it('test_dashes_removed', () => {
    assert.deepStrictEqual(parseSpokenNumbers('42-55-103'), [42, 55, 103]);
  });
  it('test_common_misheard_words', () => {
    assert.deepStrictEqual(parseSpokenNumbers('won'), [1]);
    assert.deepStrictEqual(parseSpokenNumbers('for'), [4]);
    assert.deepStrictEqual(parseSpokenNumbers('ate'), [8]);
    assert.deepStrictEqual(parseSpokenNumbers('to'), [2]);
  });
  it('test_expanded_misheard_words', () => {
    assert.deepStrictEqual(parseSpokenNumbers('wan'), [1]);
    assert.deepStrictEqual(parseSpokenNumbers('wun'), [1]);
    assert.deepStrictEqual(parseSpokenNumbers('tu'), [2]);
    assert.deepStrictEqual(parseSpokenNumbers('tew'), [2]);
    assert.deepStrictEqual(parseSpokenNumbers('fo'), [4]);
    assert.deepStrictEqual(parseSpokenNumbers('sick'), [6]);
    assert.deepStrictEqual(parseSpokenNumbers('sicks'), [6]);
    assert.deepStrictEqual(parseSpokenNumbers('nein'), [9]);
    assert.deepStrictEqual(parseSpokenNumbers('tin'), [10]);
    assert.deepStrictEqual(parseSpokenNumbers('fourty'), [40]);
    assert.deepStrictEqual(parseSpokenNumbers('fitty'), [50]);
  });
  it('test_punctuation_stripped', () => {
    assert.deepStrictEqual(parseSpokenNumbers('42, 55. 103!'), [42, 55, 103]);
  });
  it('test_card_collector_speech', () => {
    assert.deepStrictEqual(
      parseSpokenNumbers('okay I have number 42 and 55 and number 103'),
      [42, 55, 103]
    );
  });
  it('test_rapid_fire_numbers', () => {
    const result = parseSpokenNumbers('1 1 1');
    assert.deepStrictEqual(result, [1, 1, 1]);
    assert.deepStrictEqual(countCards(result), { 1: 3 });
  });
  it('test_large_batch', () => {
    const text = Array.from({ length: 100 }, (_, i) => String(i + 1)).join(' ');
    const result = parseSpokenNumbers(text);
    assert.strictEqual(result.length, 100);
    assert.strictEqual(result[0], 1);
    assert.strictEqual(result[99], 100);
  });
});

// ============================================================
// TestCountTrigger
// ============================================================
describe('TestCountTrigger', () => {
  it('test_count_basic', () => {
    const result = parseSpokenNumbers('100 count 10');
    assert.deepStrictEqual(result, Array(10).fill(100));
    assert.deepStrictEqual(countCards(result), { 100: 10 });
  });
  it('test_count_multiple_cards', () => {
    const result = parseSpokenNumbers('100 count 10 55 count 3 42');
    assert.deepStrictEqual(countCards(result), { 100: 10, 55: 3, 42: 1 });
  });
  it('test_count_with_word_numbers', () => {
    const result = parseSpokenNumbers('fifty count five');
    assert.deepStrictEqual(countCards(result), { 50: 5 });
  });
  it('test_count_qty_one_default', () => {
    assert.deepStrictEqual(countCards(parseSpokenNumbers('42')), { 42: 1 });
  });
  it('test_count_at_end_ignored', () => {
    const result = parseSpokenNumbers('42 count');
    assert.ok(result.includes(42));
  });
  it('test_count_mixed_with_times', () => {
    const result = parseSpokenNumbers('100 count 5 55 times 3');
    assert.deepStrictEqual(countCards(result), { 100: 5, 55: 3 });
  });
});

// ============================================================
// TestCompoundAndFix
// ============================================================
describe('TestCompoundAndFix', () => {
  it('test_hundred_and_tens', () => {
    assert.deepStrictEqual(parseSpokenNumbers('three hundred and forty two'), [342]);
  });
  it('test_hundred_and_teens', () => {
    assert.deepStrictEqual(parseSpokenNumbers('five hundred and twelve'), [512]);
  });
  it('test_hundred_and_ones', () => {
    assert.deepStrictEqual(parseSpokenNumbers('two hundred and three'), [203]);
  });
  it('test_hundred_without_and_still_works', () => {
    assert.deepStrictEqual(parseSpokenNumbers('three hundred forty two'), [342]);
  });
  it('test_standalone_hundred', () => {
    assert.deepStrictEqual(parseSpokenNumbers('hundred'), [100]);
  });
  it('test_a_hundred', () => {
    assert.deepStrictEqual(parseSpokenNumbers('a hundred'), [100]);
  });
  it('test_of_multiplier', () => {
    assert.deepStrictEqual(countCards(parseSpokenNumbers('42 of 3')), { 42: 3 });
  });
  it('test_quantity_multiplier', () => {
    assert.deepStrictEqual(countCards(parseSpokenNumbers('307 quantity 2')), { 307: 2 });
  });
  it('test_stock_multiplier', () => {
    assert.deepStrictEqual(countCards(parseSpokenNumbers('307 stock 2')), { 307: 2 });
  });
  it('test_copies_multiplier', () => {
    assert.deepStrictEqual(countCards(parseSpokenNumbers('307 copies 3')), { 307: 3 });
  });
  it('test_ex_multiplier', () => {
    assert.deepStrictEqual(countCards(parseSpokenNumbers('307 ex 2')), { 307: 2 });
  });
});

// ============================================================
// TestWordDigitCompound
// ============================================================
describe('TestWordDigitCompound', () => {
  it('test_tens_word_digit_ones', () => {
    assert.deepStrictEqual(parseSpokenNumbers('forty 3'), [43]);
  });
  it('test_twenty_digit', () => {
    assert.deepStrictEqual(parseSpokenNumbers('twenty 1'), [21]);
  });
  it('test_fifty_digit', () => {
    assert.deepStrictEqual(parseSpokenNumbers('fifty 5'), [55]);
  });
  it('test_ninety_digit', () => {
    assert.deepStrictEqual(parseSpokenNumbers('ninety 9'), [99]);
  });
  it('test_hundred_digit_ones', () => {
    assert.deepStrictEqual(parseSpokenNumbers('one hundred 5'), [105]);
  });
  it('test_hundred_digit_teens', () => {
    assert.deepStrictEqual(parseSpokenNumbers('two hundred 12'), [212]);
  });
  it('test_hundred_and_digit', () => {
    assert.deepStrictEqual(parseSpokenNumbers('three hundred and 7'), [307]);
  });
  it('test_hundred_tens_word_digit_ones', () => {
    assert.deepStrictEqual(parseSpokenNumbers('three hundred forty 2'), [342]);
  });
  it('test_multiple_mixed_compounds', () => {
    assert.deepStrictEqual(parseSpokenNumbers('forty 3 twenty 1'), [43, 21]);
  });
  it('test_compound_with_count', () => {
    assert.deepStrictEqual(countCards(parseSpokenNumbers('forty 3 count 10')), { 43: 10 });
  });
});

// ============================================================
// TestFormatOutput
// ============================================================
describe('TestFormatOutput', () => {
  it('test_simple_output', () => {
    assert.strictEqual(formatOutput([1, 2, 3]), 'Have: 1, 2, 3');
  });
  it('test_with_duplicates', () => {
    assert.strictEqual(formatOutput([42, 42, 42, 55]), 'Have: 42 x3, 55');
  });
  it('test_sorted_output', () => {
    assert.strictEqual(formatOutput([103, 42, 55]), 'Have: 42, 55, 103');
  });
  it('test_empty', () => {
    assert.strictEqual(formatOutput([]), 'Have: ');
  });
});

// ============================================================
// TestCountCards
// ============================================================
describe('TestCountCards', () => {
  it('test_basic_count', () => {
    assert.deepStrictEqual(countCards([1, 2, 3, 1, 2, 1]), { 1: 3, 2: 2, 3: 1 });
  });
  it('test_single_card', () => {
    assert.deepStrictEqual(countCards([42]), { 42: 1 });
  });
  it('test_empty', () => {
    assert.deepStrictEqual(countCards([]), {});
  });
});
