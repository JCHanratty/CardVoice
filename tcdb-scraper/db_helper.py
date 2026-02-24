"""
Database helper for the TCDB scraper.

Creates and manages a SQLite catalog database whose schema matches
CardVoice's server/db.js (including all migration columns).
"""

import sqlite3
from datetime import datetime


# ---------------------------------------------------------------------------
# Database creation
# ---------------------------------------------------------------------------

def create_catalog_db(db_path: str) -> sqlite3.Connection:
    """Create (or open) the catalog database and ensure all tables exist.

    The schema mirrors CardVoice server/db.js exactly, with one addition:
    ``cards.image_path`` for storing scraped card images.

    Parameters
    ----------
    db_path : str
        Path to the SQLite file (use ``:memory:`` for tests).

    Returns
    -------
    sqlite3.Connection
    """
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")

    conn.executescript("""
        CREATE TABLE IF NOT EXISTS card_sets (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            year        INTEGER,
            brand       TEXT,
            sport       TEXT    DEFAULT 'Baseball',
            total_cards INTEGER DEFAULT 0,
            sync_enabled INTEGER DEFAULT 1,
            UNIQUE(name, year)
        );

        CREATE TABLE IF NOT EXISTS cards (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id      INTEGER NOT NULL REFERENCES card_sets(id) ON DELETE CASCADE,
            card_number TEXT    NOT NULL,
            player      TEXT    NOT NULL,
            team        TEXT    DEFAULT '',
            rc_sp       TEXT    DEFAULT '',
            insert_type TEXT    DEFAULT 'Base',
            parallel    TEXT    DEFAULT '',
            qty         INTEGER DEFAULT 0,
            image_path  TEXT    DEFAULT ''
        );

        CREATE UNIQUE INDEX IF NOT EXISTS uq_card_variant
            ON cards(set_id, card_number, insert_type, parallel);

        CREATE TABLE IF NOT EXISTS set_insert_types (
            id                     INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id                 INTEGER NOT NULL REFERENCES card_sets(id) ON DELETE CASCADE,
            name                   TEXT    NOT NULL,
            card_count             INTEGER DEFAULT 0,
            odds                   TEXT    DEFAULT '',
            section_type           TEXT    DEFAULT 'base',
            pricing_enabled        INTEGER DEFAULT 0,
            pricing_mode           TEXT    DEFAULT 'full_set',
            search_query_override  TEXT    DEFAULT '',
            UNIQUE(set_id, name)
        );

        CREATE TABLE IF NOT EXISTS set_parallels (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id          INTEGER NOT NULL REFERENCES card_sets(id) ON DELETE CASCADE,
            name            TEXT    NOT NULL,
            print_run       INTEGER,
            exclusive       TEXT    DEFAULT '',
            notes           TEXT    DEFAULT '',
            serial_max      INTEGER,
            channels        TEXT    DEFAULT '',
            variation_type  TEXT    DEFAULT 'parallel',
            UNIQUE(set_id, name)
        );

        CREATE TABLE IF NOT EXISTS insert_type_parallels (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            insert_type_id  INTEGER NOT NULL REFERENCES set_insert_types(id) ON DELETE CASCADE,
            parallel_id     INTEGER NOT NULL REFERENCES set_parallels(id) ON DELETE CASCADE,
            UNIQUE(insert_type_id, parallel_id)
        );

        CREATE TABLE IF NOT EXISTS app_meta (
            key        TEXT PRIMARY KEY,
            value      TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    return conn


# ---------------------------------------------------------------------------
# Inserts / upserts
# ---------------------------------------------------------------------------

def insert_set(conn: sqlite3.Connection, *, name: str, year: int,
               brand: str, sport: str = "Baseball") -> int:
    """Insert a card set and return its ``id``."""
    cur = conn.execute(
        """INSERT INTO card_sets (name, year, brand, sport)
           VALUES (?, ?, ?, ?)""",
        (name, year, brand, sport),
    )
    conn.commit()
    return cur.lastrowid


def insert_card(conn: sqlite3.Connection, *, set_id: int, card_number: str,
                player: str, team: str = "", rc_sp: str = "",
                insert_type: str = "Base", parallel: str = "",
                image_path: str = ""):
    """Insert a card row. Returns the new ``id`` or ``None`` if duplicate."""
    try:
        cur = conn.execute(
            """INSERT INTO cards
                   (set_id, card_number, player, team, rc_sp,
                    insert_type, parallel, image_path)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (set_id, card_number, player, team, rc_sp,
             insert_type, parallel, image_path),
        )
        conn.commit()
        return cur.lastrowid
    except sqlite3.IntegrityError:
        return None


def upsert_insert_type(conn: sqlite3.Connection, *, set_id: int, name: str,
                       card_count: int = 0, odds: str = "",
                       section_type: str = "base"):
    """Insert or update an insert-type row for a set. Returns the row id."""
    conn.execute(
        """INSERT INTO set_insert_types (set_id, name, card_count, odds, section_type)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(set_id, name) DO UPDATE SET
               card_count   = excluded.card_count,
               odds         = excluded.odds,
               section_type = excluded.section_type""",
        (set_id, name, card_count, odds, section_type),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id FROM set_insert_types WHERE set_id = ? AND name = ?",
        (set_id, name),
    ).fetchone()
    return row[0] if row else None


def upsert_parallel(conn: sqlite3.Connection, *, set_id: int, name: str,
                    print_run=None, exclusive: str = "",
                    notes: str = "", serial_max=None,
                    channels: str = "",
                    variation_type: str = "parallel"):
    """Insert or update a parallel row for a set."""
    conn.execute(
        """INSERT INTO set_parallels
               (set_id, name, print_run, exclusive, notes,
                serial_max, channels, variation_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(set_id, name) DO UPDATE SET
               print_run      = excluded.print_run,
               exclusive      = excluded.exclusive,
               notes          = excluded.notes,
               serial_max     = excluded.serial_max,
               channels       = excluded.channels,
               variation_type = excluded.variation_type""",
        (set_id, name, print_run, exclusive, notes,
         serial_max, channels, variation_type),
    )
    conn.commit()
    row = conn.execute(
        "SELECT id FROM set_parallels WHERE set_id = ? AND name = ?",
        (set_id, name),
    ).fetchone()
    return row[0] if row else None


def link_parallel_to_insert(conn: sqlite3.Connection, *, insert_type_id: int, parallel_id: int):
    """Link a parallel to an insert type (idempotent)."""
    conn.execute(
        """INSERT OR IGNORE INTO insert_type_parallels (insert_type_id, parallel_id)
           VALUES (?, ?)""",
        (insert_type_id, parallel_id),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def update_set_total(conn: sqlite3.Connection, set_id: int):
    """Recount cards for *set_id* and update ``card_sets.total_cards``."""
    conn.execute(
        """UPDATE card_sets
           SET total_cards = (SELECT COUNT(*) FROM cards WHERE set_id = ?)
           WHERE id = ?""",
        (set_id, set_id),
    )
    conn.commit()


def set_catalog_version(conn: sqlite3.Connection, version: str):
    """Write (or overwrite) the ``catalog_version`` key in ``app_meta``."""
    conn.execute(
        """INSERT INTO app_meta (key, value, updated_at)
           VALUES ('catalog_version', ?, datetime('now','localtime'))
           ON CONFLICT(key) DO UPDATE SET
               value      = excluded.value,
               updated_at = excluded.updated_at""",
        (version,),
    )
    conn.commit()
