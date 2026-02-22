"""Tests for db_helper — catalog database for the TCDB scraper."""

import sqlite3
import pytest
from db_helper import (
    create_catalog_db,
    insert_set,
    insert_card,
    upsert_insert_type,
    upsert_parallel,
)


@pytest.fixture
def conn():
    """Yield an in-memory catalog database, closed after each test."""
    db = create_catalog_db(":memory:")
    yield db
    db.close()


# ------------------------------------------------------------------
# Tests
# ------------------------------------------------------------------

def test_create_db_creates_tables(conn):
    """All five core tables must exist after create_catalog_db."""
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    table_names = {row["name"] for row in rows}

    for expected in ("card_sets", "cards", "set_insert_types",
                     "set_parallels", "app_meta"):
        assert expected in table_names, f"Missing table: {expected}"


def test_insert_set(conn):
    """insert_set should return a positive id and the row must be readable."""
    set_id = insert_set(conn, name="2024 Topps Series 1", year=2024,
                        brand="Topps", sport="Baseball")
    assert isinstance(set_id, int) and set_id > 0

    row = conn.execute("SELECT * FROM card_sets WHERE id = ?",
                       (set_id,)).fetchone()
    assert row["name"] == "2024 Topps Series 1"
    assert row["year"] == 2024
    assert row["brand"] == "Topps"
    assert row["sport"] == "Baseball"


def test_insert_card(conn):
    """insert_card should store the card including its image_path."""
    set_id = insert_set(conn, name="2024 Topps Series 1", year=2024,
                        brand="Topps", sport="Baseball")
    card_id = insert_card(conn, set_id=set_id, card_number="1",
                          player="Julio Rodriguez", team="Mariners",
                          image_path="/images/card_001.jpg")
    assert isinstance(card_id, int) and card_id > 0

    row = conn.execute("SELECT * FROM cards WHERE id = ?",
                       (card_id,)).fetchone()
    assert row["player"] == "Julio Rodriguez"
    assert row["image_path"] == "/images/card_001.jpg"
    assert row["insert_type"] == "Base"
    assert row["parallel"] == ""


def test_insert_card_duplicate_skips(conn):
    """A duplicate (set_id, card_number, insert_type, parallel) must return
    None and not increase the row count."""
    set_id = insert_set(conn, name="2024 Topps Series 1", year=2024,
                        brand="Topps", sport="Baseball")
    insert_card(conn, set_id=set_id, card_number="1",
                player="Julio Rodriguez", team="Mariners")

    dup = insert_card(conn, set_id=set_id, card_number="1",
                      player="Julio Rodriguez", team="Mariners")
    assert dup is None

    count = conn.execute("SELECT COUNT(*) AS n FROM cards").fetchone()["n"]
    assert count == 1


def test_insert_insert_type(conn):
    """upsert_insert_type should insert, then update on conflict."""
    set_id = insert_set(conn, name="2024 Topps Series 1", year=2024,
                        brand="Topps", sport="Baseball")

    upsert_insert_type(conn, set_id=set_id, name="Gold Foil",
                       card_count=50, odds="1:5",
                       section_type="insert")

    row = conn.execute(
        "SELECT * FROM set_insert_types WHERE set_id = ? AND name = ?",
        (set_id, "Gold Foil"),
    ).fetchone()
    assert row["card_count"] == 50
    assert row["odds"] == "1:5"
    assert row["section_type"] == "insert"

    # Upsert with new values
    upsert_insert_type(conn, set_id=set_id, name="Gold Foil",
                       card_count=100, odds="1:10",
                       section_type="insert")
    row = conn.execute(
        "SELECT * FROM set_insert_types WHERE set_id = ? AND name = ?",
        (set_id, "Gold Foil"),
    ).fetchone()
    assert row["card_count"] == 100
    assert row["odds"] == "1:10"


def test_insert_parallel(conn):
    """upsert_parallel should insert, then update on conflict."""
    set_id = insert_set(conn, name="2024 Topps Series 1", year=2024,
                        brand="Topps", sport="Baseball")

    upsert_parallel(conn, set_id=set_id, name="Gold /2024",
                    print_run=2024, exclusive="Hobby",
                    notes="Numbered to 2024", serial_max=2024,
                    channels="hobby", variation_type="parallel")

    row = conn.execute(
        "SELECT * FROM set_parallels WHERE set_id = ? AND name = ?",
        (set_id, "Gold /2024"),
    ).fetchone()
    assert row["print_run"] == 2024
    assert row["exclusive"] == "Hobby"
    assert row["serial_max"] == 2024
    assert row["variation_type"] == "parallel"

    # Upsert with changed print_run
    upsert_parallel(conn, set_id=set_id, name="Gold /2024",
                    print_run=500, exclusive="Retail",
                    notes="Updated", serial_max=500,
                    channels="retail", variation_type="parallel")
    row = conn.execute(
        "SELECT * FROM set_parallels WHERE set_id = ? AND name = ?",
        (set_id, "Gold /2024"),
    ).fetchone()
    assert row["print_run"] == 500
    assert row["exclusive"] == "Retail"
