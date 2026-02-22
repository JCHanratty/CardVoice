"""Tests for utility helpers."""

from utils import extract_brand


def test_extract_brand():
    """Common set names should resolve to the correct brand."""
    assert extract_brand("2025 Topps Chrome") == "Topps"
    assert extract_brand("2025 Bowman Draft") == "Bowman"
    assert extract_brand("2024 Panini Prizm") == "Panini"
    assert extract_brand("2023 Upper Deck Series 1") == "Upper Deck"
    assert extract_brand("2024 Donruss Optic") == "Donruss"
    assert extract_brand("Unknown Set Name") == ""


def test_extract_brand_with_year_prefix():
    """Year patterns like YYYY-YY should be stripped before matching."""
    assert extract_brand("2024-25 Bowman Chrome") == "Bowman"
    assert extract_brand("2023-24 Upper Deck MVP") == "Upper Deck"
    assert extract_brand("2024-25 Topps Stadium Club") == "Topps"
