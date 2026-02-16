"""
Tests for CardVoice number parser.
Run: python -m pytest tests/test_parser.py -v
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from voice.engine import parse_spoken_numbers, count_cards, format_output


class TestBasicNumbers:
    """Test basic number recognition."""
    
    def test_digit_strings(self):
        assert parse_spoken_numbers("42 55 103") == [42, 55, 103]
    
    def test_single_digits(self):
        assert parse_spoken_numbers("1 2 3 4 5") == [1, 2, 3, 4, 5]
    
    def test_word_numbers(self):
        assert parse_spoken_numbers("one two three four five") == [1, 2, 3, 4, 5]
    
    def test_teens(self):
        assert parse_spoken_numbers("eleven twelve thirteen") == [11, 12, 13]
    
    def test_compound_tens(self):
        assert parse_spoken_numbers("twenty three forty two") == [23, 42]
    
    def test_hundreds(self):
        assert parse_spoken_numbers("one hundred") == [100]
        assert parse_spoken_numbers("one hundred fifty") == [150]
        assert parse_spoken_numbers("two hundred thirty five") == [235]
        assert parse_spoken_numbers("three hundred") == [300]
    
    def test_mixed_words_and_digits(self):
        assert parse_spoken_numbers("42 fifty five 103") == [42, 55, 103]


class TestDuplicates:
    """Test duplicate/quantity handling."""
    
    def test_repeated_numbers(self):
        result = parse_spoken_numbers("42 42 42")
        assert result == [42, 42, 42]
        assert count_cards(result) == {42: 3}
    
    def test_times_multiplier(self):
        result = parse_spoken_numbers("42 times 3")
        assert result == [42, 42, 42]
    
    def test_x_multiplier(self):
        result = parse_spoken_numbers("55 x 2")
        assert result == [55, 55]
    
    def test_mixed_with_multiplier(self):
        result = parse_spoken_numbers("42 times 3 55 103")
        assert result == [42, 42, 42, 55, 103]


class TestEdgeCases:
    """Test edge cases and common speech recognition quirks."""
    
    def test_empty_string(self):
        assert parse_spoken_numbers("") == []
    
    def test_filler_words(self):
        assert parse_spoken_numbers("um 42 uh 55 like 103") == [42, 55, 103]
    
    def test_dashes_removed(self):
        assert parse_spoken_numbers("42-55-103") == [42, 55, 103]
    
    def test_common_misheard_words(self):
        assert parse_spoken_numbers("won") == [1]  # "one" → "won"
        assert parse_spoken_numbers("for") == [4]  # "four" → "for"
        assert parse_spoken_numbers("ate") == [8]  # "eight" → "ate"
        assert parse_spoken_numbers("to") == [2]   # "two" → "to"

    def test_expanded_misheard_words(self):
        assert parse_spoken_numbers("wan") == [1]
        assert parse_spoken_numbers("wun") == [1]
        assert parse_spoken_numbers("tu") == [2]
        assert parse_spoken_numbers("tew") == [2]
        assert parse_spoken_numbers("fo") == [4]
        assert parse_spoken_numbers("sick") == [6]
        assert parse_spoken_numbers("sicks") == [6]
        assert parse_spoken_numbers("nein") == [9]
        assert parse_spoken_numbers("tin") == [10]
        assert parse_spoken_numbers("fourty") == [40]
        assert parse_spoken_numbers("fitty") == [50]
    
    def test_punctuation_stripped(self):
        assert parse_spoken_numbers("42, 55. 103!") == [42, 55, 103]
    
    def test_card_collector_speech(self):
        """Simulate real collector speech patterns."""
        result = parse_spoken_numbers("okay I have number 42 and 55 and number 103")
        assert result == [42, 55, 103]
    
    def test_rapid_fire_numbers(self):
        """The Chrome problem - rapid numbers shouldn't merge."""
        result = parse_spoken_numbers("1 1 1")
        assert result == [1, 1, 1]  # NOT [111]
        assert count_cards(result) == {1: 3}
    
    def test_large_batch(self):
        """Simulate a big voice session."""
        text = " ".join([str(i) for i in range(1, 101)])
        result = parse_spoken_numbers(text)
        assert len(result) == 100
        assert result[0] == 1
        assert result[99] == 100


class TestCountTrigger:
    """Test the 'count' quantity trigger word."""

    def test_count_basic(self):
        result = parse_spoken_numbers("100 count 10")
        assert result == [100] * 10
        assert count_cards(result) == {100: 10}

    def test_count_multiple_cards(self):
        result = parse_spoken_numbers("100 count 10 55 count 3 42")
        counts = count_cards(result)
        assert counts == {100: 10, 55: 3, 42: 1}

    def test_count_with_word_numbers(self):
        result = parse_spoken_numbers("fifty count five")
        assert count_cards(result) == {50: 5}

    def test_count_qty_one_default(self):
        """No count word = qty 1."""
        result = parse_spoken_numbers("42")
        assert count_cards(result) == {42: 1}

    def test_count_at_end_ignored(self):
        """'count' at end of input with no following number is ignored."""
        result = parse_spoken_numbers("42 count")
        assert 42 in result

    def test_count_mixed_with_times(self):
        """Mix 'count' and 'times' in same input."""
        result = parse_spoken_numbers("100 count 5 55 times 3")
        counts = count_cards(result)
        assert counts == {100: 5, 55: 3}


class TestCompoundAndFix:
    """Test 'and' in compound numbers and standalone 'hundred'."""

    def test_hundred_and_tens(self):
        assert parse_spoken_numbers("three hundred and forty two") == [342]

    def test_hundred_and_teens(self):
        assert parse_spoken_numbers("five hundred and twelve") == [512]

    def test_hundred_and_ones(self):
        assert parse_spoken_numbers("two hundred and three") == [203]

    def test_hundred_without_and_still_works(self):
        assert parse_spoken_numbers("three hundred forty two") == [342]

    def test_standalone_hundred(self):
        assert parse_spoken_numbers("hundred") == [100]

    def test_a_hundred(self):
        """'a' is a skip word, so 'a hundred' = just 'hundred' = 100."""
        assert parse_spoken_numbers("a hundred") == [100]

    def test_of_multiplier(self):
        result = parse_spoken_numbers("42 of 3")
        assert count_cards(result) == {42: 3}

    def test_quantity_multiplier(self):
        assert count_cards(parse_spoken_numbers("307 quantity 2")) == {307: 2}

    def test_stock_multiplier(self):
        assert count_cards(parse_spoken_numbers("307 stock 2")) == {307: 2}

    def test_copies_multiplier(self):
        assert count_cards(parse_spoken_numbers("307 copies 3")) == {307: 3}

    def test_ex_multiplier(self):
        """Chrome often hears 'ex' instead of 'x'."""
        assert count_cards(parse_spoken_numbers("307 ex 2")) == {307: 2}


class TestWordDigitCompound:
    """Test mixed word+digit compound numbers (Chrome outputs)."""

    def test_tens_word_digit_ones(self):
        assert parse_spoken_numbers("forty 3") == [43]

    def test_twenty_digit(self):
        assert parse_spoken_numbers("twenty 1") == [21]

    def test_fifty_digit(self):
        assert parse_spoken_numbers("fifty 5") == [55]

    def test_ninety_digit(self):
        assert parse_spoken_numbers("ninety 9") == [99]

    def test_hundred_digit_ones(self):
        assert parse_spoken_numbers("one hundred 5") == [105]

    def test_hundred_digit_teens(self):
        assert parse_spoken_numbers("two hundred 12") == [212]

    def test_hundred_and_digit(self):
        assert parse_spoken_numbers("three hundred and 7") == [307]

    def test_hundred_tens_word_digit_ones(self):
        """three hundred forty 2 → 342"""
        assert parse_spoken_numbers("three hundred forty 2") == [342]

    def test_multiple_mixed_compounds(self):
        assert parse_spoken_numbers("forty 3 twenty 1") == [43, 21]

    def test_compound_with_count(self):
        """forty 3 count 10 should parse as card 43, qty 10."""
        result = parse_spoken_numbers("forty 3 count 10")
        assert count_cards(result) == {43: 10}


class TestFormatOutput:
    """Test output formatting."""
    
    def test_simple_output(self):
        assert format_output([1, 2, 3]) == "Have: 1, 2, 3"
    
    def test_with_duplicates(self):
        assert format_output([42, 42, 42, 55]) == "Have: 42 x3, 55"
    
    def test_sorted_output(self):
        assert format_output([103, 42, 55]) == "Have: 42, 55, 103"
    
    def test_empty(self):
        assert format_output([]) == "Have: "


class TestCountCards:
    """Test card counting."""
    
    def test_basic_count(self):
        assert count_cards([1, 2, 3, 1, 2, 1]) == {1: 3, 2: 2, 3: 1}
    
    def test_single_card(self):
        assert count_cards([42]) == {42: 1}
    
    def test_empty(self):
        assert count_cards([]) == {}


if __name__ == '__main__':
    # Quick manual test
    test_cases = [
        "42 55 103",
        "one two three",
        "twenty three forty two",
        "one hundred fifty",
        "42 times 3 55",
        "um okay I have 42 and 55 and 103",
        "1 1 1",
        "won for ate",
    ]
    
    for text in test_cases:
        result = parse_spoken_numbers(text)
        print(f"'{text}' → {result} → {count_cards(result)}")
