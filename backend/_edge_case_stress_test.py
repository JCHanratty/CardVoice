"""
Comprehensive edge-case stress test for parse_spoken_numbers() in voice/engine.py
"""
import sys
import os
import io

# Fix Windows console encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# Ensure we can import from the voice module
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from voice.engine import parse_spoken_numbers, _parse_single_number, _parse_compound_number

# Track results
total = 0
passed = 0
failed = 0
bugs = []

def test(category, description, input_text, expected, comparator=None):
    """Run a single test case."""
    global total, passed, failed, bugs
    total += 1
    try:
        actual = parse_spoken_numbers(input_text)
    except Exception as e:
        actual = f"EXCEPTION: {e}"

    if comparator:
        ok = comparator(actual, expected)
    else:
        ok = (actual == expected)

    status = "PASS" if ok else "FAIL"
    if ok:
        passed += 1
    else:
        failed += 1
        bugs.append((category, description, input_text, expected, actual))

    # Truncate long representations for display
    input_repr = repr(input_text) if len(repr(input_text)) < 70 else repr(input_text)[:67] + "..."
    expected_repr = repr(expected)
    actual_repr = repr(actual)
    print(f"  [{status}] {description}")
    print(f"         INPUT:    {input_repr}")
    print(f"         EXPECTED: {expected_repr}")
    print(f"         ACTUAL:   {actual_repr}")
    if not ok:
        print(f"         *** MISMATCH ***")
    print()


def test_note(category, description, input_text, note):
    """Run a test where we just want to observe behavior (no expected value)."""
    global total
    total += 1
    try:
        actual = parse_spoken_numbers(input_text)
    except Exception as e:
        actual = f"EXCEPTION: {e}"

    input_repr = repr(input_text)
    actual_repr = repr(actual)
    print(f"  [NOTE] {description}")
    print(f"         INPUT:    {input_repr}")
    print(f"         ACTUAL:   {actual_repr}")
    print(f"         NOTE:     {note}")
    print()


# ============================================================================
print("=" * 80)
print("CATEGORY 1: BOUNDARY NUMBERS")
print("=" * 80)
print()

test("Boundary", "Zero (number 0) - should be rejected (1 <= n <= 9999)",
     "0", [])

test("Boundary", "One (number 1) - minimum valid",
     "1", [1])

test("Boundary", "Word 'zero' - should be rejected",
     "zero", [])

test("Boundary", "Word 'one' - minimum valid word",
     "one", [1])

test("Boundary", "9999 - maximum valid",
     "9999", [9999])

test("Boundary", "10000 - should be rejected (exceeds 9999)",
     "10000", [])

test("Boundary", "99999 - way over limit",
     "99999", [])

test("Boundary", "'negative five' - after dash removal, should parse 'five'",
     "negative five", [5])

test("Boundary", "'-5' - dash removed, should parse 5",
     "-5", [5])

test("Boundary", "'--42--' - multiple dashes removed",
     "--42--", [42])

test("Boundary", "9999 and 10000 together",
     "9999 10000", [9999])

# ============================================================================
print("=" * 80)
print("CATEGORY 2: 'COUNT' EDGE CASES")
print("=" * 80)
print()

test("Count", "'count 5' with no preceding number - count is MULT_WORDS, needs last_number",
     "count 5", [5])

test("Count", "'100 count 0' - mult must be 1-50, 0 fails, skip",
     "100 count 0", [100])

test("Count", "'100 count 1' - multiply by 1 (add 0 more copies)",
     "100 count 1", [100])

test("Count", "'100 count 2' - multiply by 2",
     "100 count 2", [100, 100])

test("Count", "'100 count 50' - max multiplier (50)",
     "100 count 50", [100] * 50)

test("Count", "'100 count 51' - exceeds max multiplier, should NOT multiply",
     "100 count 51", [100, 51])

test("Count", "'100 count 100' - exceeds max multiplier 50",
     "100 count 100", [100, 100])

test("Count", "'100 count count 5' - double count keyword",
     "100 count count 5", None)
# This one is unpredictable, let's just observe
test_note("Count", "'100 count count 5' - OBSERVATION",
          "100 count count 5",
          "Double 'count' - first count sees last_number=100, tries to parse next token 'count' as number, fails. Then second 'count' sees last_number=100, parses 5. Result likely [100, 100,100,100,100,100]?")

test("Count", "'100 count 5 count 3' - double multiplier, chained",
     "100 count 5 count 3", None)
test_note("Count", "'100 count 5 count 3' - OBSERVATION",
          "100 count 5 count 3",
          "After 'count 5' produces [100]*5, last_number=100, then 'count 3' adds 2 more copies. Expected [100]*7?")

test("Count", "'count' alone - no number, no argument",
     "count", [])

test("Count", "'42 count' at end of input - no mult value after count",
     "42 count", [42])

test("Count", "'count count count' - all skip/mult words, no numbers",
     "count count count", [])

# ============================================================================
print("=" * 80)
print("CATEGORY 3: RAPID-FIRE REALISTIC SPEECH")
print("=" * 80)
print()

test("Rapid", "15 numbers spoken fast: '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15'",
     "1 2 3 4 5 6 7 8 9 10 11 12 13 14 15",
     [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])

test("Rapid", "Same number repeated: '42 42 42 42 42'",
     "42 42 42 42 42",
     [42, 42, 42, 42, 42])

test("Rapid", "Descending: '100 50 25 10 5 1'",
     "100 50 25 10 5 1",
     [100, 50, 25, 10, 5, 1])

test("Rapid", "Large list of words: 'one two three four five six seven eight nine ten'",
     "one two three four five six seven eight nine ten",
     [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

# ============================================================================
print("=" * 80)
print("CATEGORY 4: WHISPER/CHROME GARBAGE OUTPUT")
print("=" * 80)
print()

test("Garbage", "Filler words only: 'uh um like okay so yeah'",
     "uh um like okay so yeah", [])

test("Garbage", "Repeated filler: 'the the the'",
     "the the the", [])

test("Garbage", "Empty string",
     "", [])

test("Garbage", "Just spaces",
     "   ", [])

test("Garbage", "Just punctuation: '...!!!'",
     "...!!!", [])

test("Garbage", "Partial speech: 'I have cards number uh'",
     "I have cards number uh", [])

test("Garbage", "Unicode characters: '\u00e9\u00e8\u00ea\u00eb'",
     "\u00e9\u00e8\u00ea\u00eb", [])

test("Garbage", "Unicode with numbers: '42 \u2603 55'",
     "42 \u2603 55", [42, 55])

test("Garbage", "Tab and newline: '42\\t55\\n100'",
     "42\t55\n100", [42, 55, 100])

test("Garbage", "None input (should handle gracefully or raise)",
     None, [])

test("Garbage", "Very long garbage string",
     "blah " * 1000, [])

test("Garbage", "Number buried in garbage: 'the the the 42 the the the'",
     "the the the 42 the the the", [42])

# ============================================================================
print("=" * 80)
print("CATEGORY 5: COMPOUND NUMBER EDGE CASES")
print("=" * 80)
print()

test("Compound", "'one hundred' - basic compound",
     "one hundred", [100])

test("Compound", "'one hundred twenty three' - full compound",
     "one hundred twenty three", [123])

test("Compound", "'one hundred hundred' - double hundred (bug probe)",
     "one hundred hundred", None)
test_note("Compound", "'one hundred hundred' - OBSERVATION",
          "one hundred hundred",
          "After parsing 'one hundred' (=100), 'hundred' alone is not in WORD_TO_NUM, so it should be skipped")

test("Compound", "'twenty twenty' - should be two separate 20s, not 2020",
     "twenty twenty", [20, 20])

test("Compound", "'ninety nine hundred' - what happens?",
     "ninety nine hundred", None)
test_note("Compound", "'ninety nine hundred' - OBSERVATION",
          "ninety nine hundred",
          "Parser: 'ninety' (90) + 'nine' (9) -> 99 consumed 2 tokens. Then 'hundred' alone. Expected [99] with 'hundred' ignored")

test("Compound", "'hundred' alone - not in WORD_TO_NUM",
     "hundred", [])

test("Compound", "'thousand' alone - not in WORD_TO_NUM",
     "thousand", [])

test("Compound", "'fifty five' - compound tens",
     "fifty five", [55])

test("Compound", "'twenty one' - compound tens",
     "twenty one", [21])

test("Compound", "'nine hundred ninety nine' - max compound word number",
     "nine hundred ninety nine", [999])

test("Compound", "'one two three' - should be 3 separate numbers, not 123",
     "one two three", [1, 2, 3])

test("Compound", "'five hundred' - exactly 500",
     "five hundred", [500])

test("Compound", "'five hundred and twelve' - with 'and' filler",
     "five hundred and twelve", [500, 12])
# Note: 'and' is a SKIP_WORD, so after consuming "five hundred" (500),
# "and" is skipped, then "twelve" becomes a new number.
# This is actually a bug: "five hundred and twelve" should ideally be 512.

test("Compound", "'three hundred forty' - no ones digit",
     "three hundred forty", [340])

test("Compound", "'three hundred and forty two' - 'and' as filler mid-compound",
     "three hundred and forty two", None)
test_note("Compound", "'three hundred and forty two' - OBSERVATION",
          "three hundred and forty two",
          "'and' is a SKIP_WORD so 'three hundred' = 300, skip 'and', then 'forty two' = 42. Likely [300, 42] not [342].")

# ============================================================================
print("=" * 80)
print("CATEGORY 6: MIXED COUNT AND TIMES")
print("=" * 80)
print()

test("Mixed", "'42 times 3' - basic times multiplier",
     "42 times 3", [42, 42, 42])

test("Mixed", "'42 x 3' - x as multiplier",
     "42 x 3", [42, 42, 42])

test("Mixed", "'42 count 3 times 2' - what happens with chained mult?",
     "42 count 3 times 2", None)
test_note("Mixed", "'42 count 3 times 2' - OBSERVATION",
          "42 count 3 times 2",
          "42 parsed, last_number=42. 'count' sees last_number=42, mult=3 (valid). Adds 2 more 42s -> [42,42,42]. Then 'times' sees last_number=42, mult=2 -> adds 1 more 42 -> [42,42,42,42]?")

test("Mixed", "'42 times 3 count 2' - reversed order",
     "42 times 3 count 2", None)
test_note("Mixed", "'42 times 3 count 2' - OBSERVATION",
          "42 times 3 count 2",
          "42 parsed, 'times 3' -> [42,42,42], last=42. 'count 2' -> adds 1 more -> [42,42,42,42]?")

test("Mixed", "'42 times 0' - mult=0, outside 1-50 range",
     "42 times 0", [42])

test("Mixed", "'42 times -1' - negative, dash removed by preprocessing",
     "42 times -1", None)
test_note("Mixed", "'42 times -1' - OBSERVATION",
          "42 times -1",
          "Dash removed, becomes '42 times 1'. So [42]? (mult=1, add 0 copies)")

test("Mixed", "'42 times 50' - max multiplier",
     "42 times 50", [42] * 50)

test("Mixed", "'42 times 51' - over max multiplier",
     "42 times 51", [42, 51])

# ============================================================================
print("=" * 80)
print("CATEGORY 7: REAL CHROME WEB SPEECH API OUTPUTS")
print("=" * 80)
print()

test("Chrome", "'42 55 103' - clean digit output",
     "42 55 103", [42, 55, 103])

test("Chrome", "'forty-two fifty-five one hundred three' - hyphenated words",
     "forty-two fifty-five one hundred three", None)
test_note("Chrome", "'forty-two fifty-five one hundred three' - OBSERVATION",
          "forty-two fifty-five one hundred three",
          "Hyphens removed -> 'forty two fifty five one hundred three'. Parser: forty+two=42, fifty+five=55, one hundred+three=103. Expected [42,55,103]")

test("Chrome", "'4255103' - numbers merged no spaces",
     "4255103", None)
test_note("Chrome", "'4255103' - OBSERVATION",
          "4255103",
          "Single token '4255103' = 4255103 which is > 9999, fails. Falls to regex findall: finds '4255103'. int('4255103') > 9999. So []?")

test("Chrome", "'four to fifty five one oh three' - misheard digits",
     "four to fifty five one oh three", None)
test_note("Chrome", "'four to fifty five one oh three' - OBSERVATION",
          "four to fifty five one oh three",
          "'four'=4, 'to'=2 (misheard mapping), 'fifty'+'five'=55, 'one'=1, 'oh' not in WORD_TO_NUM, 'three'=3. Expected [4,2,55,1,3]")

test("Chrome", "'1,234' - comma in number (real speech output)",
     "1,234", [1, 234])

test("Chrome", "'42.' - trailing period",
     "42.", [42])

test("Chrome", "'number 42' - 'number' is in SKIP_WORDS",
     "number 42", [42])

test("Chrome", "'card 100 card 200 card 300' - 'card' is in SKIP_WORDS",
     "card 100 card 200 card 300", [100, 200, 300])

# ============================================================================
print("=" * 80)
print("CATEGORY 8: 'OF' AS MULTIPLIER")
print("=" * 80)
print()

test("Of-mult", "'42 of 3' - 'of' is in MULT_WORDS",
     "42 of 3", [42, 42, 42])

test("Of-mult", "'55 of 1' - multiply by 1",
     "55 of 1", [55])

test("Of-mult", "'100 of 10' - of as multiplier",
     "100 of 10", [100] * 10)

test("Of-mult", "'of 5' - no preceding number",
     "of 5", [5])

# ============================================================================
print("=" * 80)
print("CATEGORY 9: LARGE QUANTITIES")
print("=" * 80)
print()

test("Large", "'100 count 50' - max allowed multiplier",
     "100 count 50", [100] * 50)

test("Large", "'100 count 51' - one over max mult (should reject mult)",
     "100 count 51", [100, 51])

test("Large", "'1 count 50' - smallest card, max mult",
     "1 count 50", [1] * 50)

test("Large", "'9999 count 50' - largest card, max mult",
     "9999 count 50", [9999] * 50)

test("Large", "'500 count 25' - mid-range",
     "500 count 25", [500] * 25)

# ============================================================================
print("=" * 80)
print("CATEGORY 10: WORD NUMBERS FOLLOWED BY COUNT")
print("=" * 80)
print()

test("WordCount", "'fifty five count twenty' - word number with word multiplier",
     "fifty five count twenty", None)
test_note("WordCount", "'fifty five count twenty' - OBSERVATION",
          "fifty five count twenty",
          "'fifty'+'five'=55, 'count' sees last_number=55, tries to parse 'twenty' as mult -> 20 (1<=20<=50) -> adds 19 more 55s -> [55]*20")

test("WordCount", "'one hundred count three' - compound word number with count",
     "one hundred count three", None)
test_note("WordCount", "'one hundred count three' - OBSERVATION",
          "one hundred count three",
          "'one hundred'=100, 'count' sees last_number=100, 'three'=3 -> [100,100,100]")

test("WordCount", "'twenty count five' - word tens with count",
     "twenty count five", None)
test_note("WordCount", "'twenty count five' - OBSERVATION",
          "twenty count five",
          "'twenty'=20, 'count' mult='five'=5 -> [20]*5")

test("WordCount", "'five count ten' - both words",
     "five count ten", [5] * 10)

# ============================================================================
# BONUS: Additional edge cases discovered during analysis
print("=" * 80)
print("BONUS: ADDITIONAL EDGE CASES")
print("=" * 80)
print()

test("Bonus", "Misheard words: 'won too tree for fife'",
     "won too tree for fife", [1, 2, 3, 4, 5])

test("Bonus", "Misheard 'nein' = 9",
     "nein", [9])

test("Bonus", "Misheard 'ate' = 8",
     "ate", [8])

test("Bonus", "'for' = 4 (misheard mapping) - but 'for' is not in SKIP_WORDS",
     "for", [4])

test("Bonus", "'no' is in SKIP_WORDS, not parsed as number",
     "no", [])

test("Bonus", "'oh' - not in WORD_TO_NUM or SKIP_WORDS",
     "oh", [])

test("Bonus", "Very long valid input: 50 numbers",
     " ".join(str(i) for i in range(1, 51)),
     list(range(1, 51)))

test("Bonus", "Alternating words and digits: 'one 2 three 4 five 6'",
     "one 2 three 4 five 6", [1, 2, 3, 4, 5, 6])

test("Bonus", "'ten twenty thirty forty fifty sixty seventy eighty ninety'",
     "ten twenty thirty forty fifty sixty seventy eighty ninety",
     [10, 20, 30, 40, 50, 60, 70, 80, 90])

test("Bonus", "'twenty twenty twenty' - should be three 20s",
     "twenty twenty twenty", [20, 20, 20])

test("Bonus", "'forty two hundred' - ambiguous: is it 42, 100 or 4200?",
     "forty two hundred", None)
test_note("Bonus", "'forty two hundred' - OBSERVATION",
          "forty two hundred",
          "'forty'+'two'=42 (compound tens consumes 2 tokens, returns immediately). Then 'hundred' alone is not in WORD_TO_NUM -> ignored. Likely [42].")

test("Bonus", "'eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'",
     "eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen",
     [11, 12, 13, 14, 15, 16, 17, 18, 19])

test("Bonus", "'one one one one one' - repeated ones",
     "one one one one one", [1, 1, 1, 1, 1])

test("Bonus", "Digit string '0042' - leading zeros",
     "0042", [42])

test("Bonus", "'10 hundred' - 10 is not 1-9, so no hundred pattern",
     "10 hundred", [10])

test("Bonus", "'ten hundred' - ten=10, not 1-9 so no hundred pattern",
     "ten hundred", [10])

test("Bonus", "'ninety nine' - max compound tens",
     "ninety nine", [99])

test("Bonus", "'nine hundred' - max hundreds",
     "nine hundred", [900])

test("Bonus", "'nine hundred ninety nine' - 999",
     "nine hundred ninety nine", [999])

test("Bonus", "Just 'and' - skip word, empty result",
     "and", [])

test("Bonus", "'is that a one or a two' - skip words surrounding numbers",
     "is that a one or a two", None)
test_note("Bonus", "'is that a one or a two' - OBSERVATION",
          "is that a one or a two",
          "'is','that','a' skipped, 'one'=1, 'or' not skip/num -> ignored, 'a' skipped, 'two'=2. Likely [1,2]")

test("Bonus", "'fourty' (common misspelling) - is in WORD_TO_NUM",
     "fourty two", [42])

test("Bonus", "'fitty' (slang for fifty) - is in WORD_TO_NUM",
     "fitty five", [55])


# ============================================================================
# SUMMARY
# ============================================================================
print()
print("=" * 80)
print("SUMMARY")
print("=" * 80)
print(f"Total tests:  {total}")
print(f"Passed:       {passed}")
print(f"Failed:       {failed}")
print(f"Notes/Obs:    {total - passed - failed} (tests with None expected, observation only)")
print()

if bugs:
    print("=" * 80)
    print("BUGS / UNEXPECTED BEHAVIORS FOUND")
    print("=" * 80)
    for cat, desc, inp, exp, act in bugs:
        print(f"\n  [{cat}] {desc}")
        print(f"    INPUT:    {repr(inp)}")
        print(f"    EXPECTED: {repr(exp)}")
        print(f"    ACTUAL:   {repr(act)}")
    print()
else:
    print("No bugs found - all tests passed!")
