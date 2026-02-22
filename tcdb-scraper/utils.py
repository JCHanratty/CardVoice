"""Utility helpers for the TCDB scraper."""

import re

# Brands to match, ordered longest-first so "Upper Deck" wins over a
# hypothetical shorter prefix.  All comparisons are case-insensitive.
_KNOWN_BRANDS: list[str] = [
    "Upper Deck",
    "Stadium Club",
    "Topps",
    "Bowman",
    "Panini",
    "Donruss",
    "Leaf",
    "Fleer",
    "Score",
    "Prizm",
    "Select",
    "Mosaic",
]

# Pre-compiled pattern: optional 4-digit year (with optional -YY suffix)
# followed by whitespace.
_YEAR_RE = re.compile(r"^\d{4}(?:-\d{2})?\s+")


def extract_brand(set_name: str) -> str:
    """Return the brand from *set_name*, or ``""`` if none is recognised.

    The function first strips a leading year pattern (``YYYY`` or
    ``YYYY-YY``) then checks whether the remainder starts with one of
    the known brand strings (case-insensitive).
    """
    name = _YEAR_RE.sub("", set_name).strip()
    name_lower = name.lower()
    for brand in _KNOWN_BRANDS:
        if name_lower.startswith(brand.lower()):
            return brand
    return ""
