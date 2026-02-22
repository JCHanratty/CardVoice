# TCDB-to-CardVoice Scraper Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Python scraper that extracts baseball card checklists from tcdb.com into a CardVoice-compatible catalog SQLite database, with thumbnail downloads and collection migration support.

**Architecture:** Two standalone Python scripts (`scraper.py` and `migrator.py`) output a `tcdb-catalog.db` file matching CardVoice's schema. CardVoice's existing `catalog-merge.js` imports the catalog. A new `image_path` column is added to CardVoice's `cards` table. A new `/api/import-qty` endpoint handles collection quantity migration.

**Tech Stack:** Python 3.10+, requests, BeautifulSoup4, sqlite3 (stdlib), python-dotenv. CardVoice side: Node.js, better-sqlite3, Express.

---

## Task 1: Project Scaffold & Dependencies

**Files:**
- Create: `tcdb-scraper/requirements.txt`
- Create: `tcdb-scraper/.env.example`
- Create: `tcdb-scraper/.gitignore`

**Step 1: Create project directory and files**

Create `tcdb-scraper/requirements.txt`:
```
requests>=2.31.0
beautifulsoup4>=4.12.0
python-dotenv>=1.0.0
```

Create `tcdb-scraper/.env.example`:
```
TCDB_USER=your_tcdb_username
TCDB_PASS=your_tcdb_password
```

Create `tcdb-scraper/.gitignore`:
```
.env
__pycache__/
*.pyc
output/
checkpoint.json
my_sets.json
qty_updates.json
scraper.log
errors.log
```

**Step 2: Install dependencies**

Run: `cd tcdb-scraper && pip install -r requirements.txt`
Expected: Successfully installed requests, beautifulsoup4, python-dotenv

**Step 3: Create .env with real credentials**

Copy `.env.example` to `.env` and fill in `TCDB_USER=Jhanratty` and the password.

**Step 4: Commit**

```bash
cd tcdb-scraper
git init
git add requirements.txt .env.example .gitignore
git commit -m "feat: scaffold tcdb-scraper project with dependencies"
```

---

## Task 2: Database Helper Module

**Files:**
- Create: `tcdb-scraper/db_helper.py`
- Test: `tcdb-scraper/test_db_helper.py`

This module creates/opens the output SQLite database matching CardVoice's schema exactly (see `server/db.js:69-126` for reference). It also provides insert helpers.

**Step 1: Write the failing test**

Create `tcdb-scraper/test_db_helper.py`:
```python
import os
import sqlite3
import pytest

def test_create_db_creates_tables():
    from db_helper import create_catalog_db
    db_path = "test_catalog.db"
    try:
        conn = create_catalog_db(db_path)
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = sorted([row[0] for row in cursor.fetchall()])
        assert "card_sets" in tables
        assert "cards" in tables
        assert "set_insert_types" in tables
        assert "set_parallels" in tables
        assert "app_meta" in tables
        conn.close()
    finally:
        os.remove(db_path)

def test_insert_set():
    from db_helper import create_catalog_db, insert_set
    db_path = "test_catalog.db"
    try:
        conn = create_catalog_db(db_path)
        set_id = insert_set(conn, name="2025 Topps", year=2025, brand="Topps", sport="Baseball")
        assert set_id is not None
        row = conn.execute("SELECT * FROM card_sets WHERE id = ?", (set_id,)).fetchone()
        assert row is not None
        conn.close()
    finally:
        os.remove(db_path)

def test_insert_card():
    from db_helper import create_catalog_db, insert_set, insert_card
    db_path = "test_catalog.db"
    try:
        conn = create_catalog_db(db_path)
        set_id = insert_set(conn, name="2025 Topps", year=2025, brand="Topps", sport="Baseball")
        card_id = insert_card(conn, set_id=set_id, card_number="1", player="Aaron Judge",
                              team="New York Yankees", rc_sp="", insert_type="Base",
                              parallel="", image_path="images/1/1.jpg")
        assert card_id is not None
        row = conn.execute("SELECT * FROM cards WHERE id = ?", (card_id,)).fetchone()
        assert row is not None
        conn.close()
    finally:
        os.remove(db_path)

def test_insert_card_duplicate_skips():
    from db_helper import create_catalog_db, insert_set, insert_card
    db_path = "test_catalog.db"
    try:
        conn = create_catalog_db(db_path)
        set_id = insert_set(conn, name="2025 Topps", year=2025, brand="Topps", sport="Baseball")
        id1 = insert_card(conn, set_id=set_id, card_number="1", player="Aaron Judge",
                          team="NYY", rc_sp="", insert_type="Base", parallel="", image_path="")
        id2 = insert_card(conn, set_id=set_id, card_number="1", player="Aaron Judge",
                          team="NYY", rc_sp="", insert_type="Base", parallel="", image_path="")
        assert id1 is not None
        assert id2 is None  # Duplicate — should return None, not crash
        count = conn.execute("SELECT COUNT(*) FROM cards WHERE set_id = ?", (set_id,)).fetchone()[0]
        assert count == 1
        conn.close()
    finally:
        os.remove(db_path)

def test_insert_insert_type():
    from db_helper import create_catalog_db, insert_set, upsert_insert_type
    db_path = "test_catalog.db"
    try:
        conn = create_catalog_db(db_path)
        set_id = insert_set(conn, name="2025 Topps", year=2025, brand="Topps", sport="Baseball")
        upsert_insert_type(conn, set_id=set_id, name="Autographs", card_count=50, odds="1:24")
        row = conn.execute("SELECT * FROM set_insert_types WHERE set_id = ? AND name = ?",
                           (set_id, "Autographs")).fetchone()
        assert row is not None
        conn.close()
    finally:
        os.remove(db_path)

def test_insert_parallel():
    from db_helper import create_catalog_db, insert_set, upsert_parallel
    db_path = "test_catalog.db"
    try:
        conn = create_catalog_db(db_path)
        set_id = insert_set(conn, name="2025 Topps", year=2025, brand="Topps", sport="Baseball")
        upsert_parallel(conn, set_id=set_id, name="Gold /2024", print_run=2024, exclusive="Hobby")
        row = conn.execute("SELECT * FROM set_parallels WHERE set_id = ? AND name = ?",
                           (set_id, "Gold /2024")).fetchone()
        assert row is not None
        conn.close()
    finally:
        os.remove(db_path)
```

**Step 2: Run tests to verify they fail**

Run: `cd tcdb-scraper && python -m pytest test_db_helper.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'db_helper'`

**Step 3: Implement db_helper.py**

Create `tcdb-scraper/db_helper.py`:
```python
"""
Database helper — creates and populates a CardVoice-compatible catalog SQLite database.
Schema matches CardVoice's server/db.js exactly.
"""
import sqlite3


def create_catalog_db(db_path: str) -> sqlite3.Connection:
    """Create/open catalog DB with CardVoice-compatible schema."""
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
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id          INTEGER NOT NULL REFERENCES card_sets(id) ON DELETE CASCADE,
            name            TEXT    NOT NULL,
            card_count      INTEGER DEFAULT 0,
            odds            TEXT    DEFAULT '',
            section_type    TEXT    DEFAULT 'base',
            pricing_enabled INTEGER DEFAULT 0,
            pricing_mode    TEXT    DEFAULT 'full_set',
            search_query_override TEXT DEFAULT '',
            UNIQUE(set_id, name)
        );

        CREATE TABLE IF NOT EXISTS set_parallels (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id         INTEGER NOT NULL REFERENCES card_sets(id) ON DELETE CASCADE,
            name           TEXT    NOT NULL,
            print_run      INTEGER,
            exclusive      TEXT    DEFAULT '',
            notes          TEXT    DEFAULT '',
            serial_max     INTEGER,
            channels       TEXT    DEFAULT '',
            variation_type TEXT    DEFAULT 'parallel',
            UNIQUE(set_id, name)
        );

        CREATE TABLE IF NOT EXISTS app_meta (
            key        TEXT PRIMARY KEY,
            value      TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    """)
    conn.commit()
    return conn


def insert_set(conn: sqlite3.Connection, *, name: str, year: int, brand: str,
               sport: str = "Baseball") -> int:
    """Insert a card set. Returns the set ID."""
    cursor = conn.execute(
        "INSERT INTO card_sets (name, year, brand, sport) VALUES (?, ?, ?, ?)",
        (name, year, brand, sport)
    )
    conn.commit()
    return cursor.lastrowid


def insert_card(conn: sqlite3.Connection, *, set_id: int, card_number: str,
                player: str, team: str, rc_sp: str, insert_type: str,
                parallel: str, image_path: str = "") -> int | None:
    """Insert a card. Returns card ID, or None if duplicate."""
    try:
        cursor = conn.execute(
            """INSERT INTO cards (set_id, card_number, player, team, rc_sp,
               insert_type, parallel, qty, image_path)
               VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)""",
            (set_id, card_number, player, team, rc_sp, insert_type, parallel, image_path)
        )
        conn.commit()
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        return None


def upsert_insert_type(conn: sqlite3.Connection, *, set_id: int, name: str,
                       card_count: int = 0, odds: str = "",
                       section_type: str = "base"):
    """Insert or update an insert type for a set."""
    conn.execute(
        """INSERT INTO set_insert_types (set_id, name, card_count, odds, section_type)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(set_id, name) DO UPDATE SET
             card_count = excluded.card_count,
             odds = excluded.odds,
             section_type = COALESCE(excluded.section_type, set_insert_types.section_type)""",
        (set_id, name, card_count, odds, section_type)
    )
    conn.commit()


def upsert_parallel(conn: sqlite3.Connection, *, set_id: int, name: str,
                    print_run: int = None, exclusive: str = "",
                    notes: str = "", serial_max: int = None,
                    channels: str = "", variation_type: str = "parallel"):
    """Insert or update a parallel for a set."""
    conn.execute(
        """INSERT INTO set_parallels (set_id, name, print_run, exclusive, notes,
           serial_max, channels, variation_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(set_id, name) DO UPDATE SET
             print_run = COALESCE(excluded.print_run, set_parallels.print_run),
             exclusive = CASE WHEN excluded.exclusive != '' THEN excluded.exclusive ELSE set_parallels.exclusive END,
             notes = CASE WHEN excluded.notes != '' THEN excluded.notes ELSE set_parallels.notes END,
             serial_max = COALESCE(excluded.serial_max, set_parallels.serial_max),
             channels = CASE WHEN excluded.channels != '' THEN excluded.channels ELSE set_parallels.channels END,
             variation_type = CASE WHEN excluded.variation_type != 'parallel' THEN excluded.variation_type ELSE set_parallels.variation_type END""",
        (set_id, name, print_run, exclusive, notes, serial_max, channels, variation_type)
    )
    conn.commit()


def update_set_total(conn: sqlite3.Connection, set_id: int):
    """Recount total cards in a set."""
    count = conn.execute(
        "SELECT COUNT(*) FROM cards WHERE set_id = ?", (set_id,)
    ).fetchone()[0]
    conn.execute("UPDATE card_sets SET total_cards = ? WHERE id = ?", (count, set_id))
    conn.commit()


def set_catalog_version(conn: sqlite3.Connection, version: str):
    """Set the catalog version in app_meta."""
    conn.execute(
        """INSERT INTO app_meta (key, value, updated_at)
           VALUES ('catalog_version', ?, datetime('now','localtime'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at""",
        (version,)
    )
    conn.commit()
```

**Step 4: Run tests to verify they pass**

Run: `cd tcdb-scraper && python -m pytest test_db_helper.py -v`
Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add db_helper.py test_db_helper.py
git commit -m "feat: add database helper with CardVoice-compatible schema"
```

---

## Task 3: HTTP Client with Rate Limiting & Retry

**Files:**
- Create: `tcdb-scraper/http_client.py`
- Test: `tcdb-scraper/test_http_client.py`

**Step 1: Write the failing test**

Create `tcdb-scraper/test_http_client.py`:
```python
import time
from unittest.mock import patch, MagicMock
import pytest

def test_client_creates_session_with_headers():
    from http_client import TcdbClient
    client = TcdbClient()
    assert "User-Agent" in client.session.headers
    assert "Mozilla" in client.session.headers["User-Agent"]

def test_client_delays_between_requests():
    from http_client import TcdbClient
    client = TcdbClient(min_delay=0.1, max_delay=0.2)
    with patch.object(client.session, 'get') as mock_get:
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.raise_for_status = MagicMock()
        mock_get.return_value = mock_response
        start = time.time()
        client.get("http://example.com/1")
        client.get("http://example.com/2")
        elapsed = time.time() - start
        assert elapsed >= 0.1  # At least one delay

def test_client_retries_on_server_error():
    from http_client import TcdbClient
    client = TcdbClient(min_delay=0, max_delay=0, retry_wait=0.01)
    with patch.object(client.session, 'get') as mock_get:
        error_resp = MagicMock()
        error_resp.status_code = 500
        error_resp.raise_for_status.side_effect = Exception("500 Server Error")
        ok_resp = MagicMock()
        ok_resp.status_code = 200
        ok_resp.raise_for_status = MagicMock()
        mock_get.side_effect = [error_resp, ok_resp]
        result = client.get("http://example.com/test")
        assert result.status_code == 200
        assert mock_get.call_count == 2

def test_client_raises_after_max_retries():
    from http_client import TcdbClient
    client = TcdbClient(min_delay=0, max_delay=0, retry_wait=0.01, max_retries=2)
    with patch.object(client.session, 'get') as mock_get:
        error_resp = MagicMock()
        error_resp.status_code = 503
        error_resp.raise_for_status.side_effect = Exception("503 Unavailable")
        mock_get.return_value = error_resp
        with pytest.raises(Exception, match="503"):
            client.get("http://example.com/test")
        assert mock_get.call_count == 3  # 1 initial + 2 retries
```

**Step 2: Run tests to verify they fail**

Run: `cd tcdb-scraper && python -m pytest test_http_client.py -v`
Expected: FAIL — `ModuleNotFoundError`

**Step 3: Implement http_client.py**

Create `tcdb-scraper/http_client.py`:
```python
"""
Rate-limited HTTP client for TCDB scraping.
Adds random delays, retries, and realistic headers.
"""
import time
import random
import logging
import requests

logger = logging.getLogger(__name__)

# Realistic browser User-Agent
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)


class TcdbClient:
    """HTTP client with rate limiting and retry logic for TCDB."""

    BASE_URL = "https://www.tcdb.com"

    def __init__(self, *, min_delay: float = 3.0, max_delay: float = 8.0,
                 retry_wait: float = 30.0, max_retries: int = 3,
                 timeout: float = 30.0):
        self.min_delay = min_delay
        self.max_delay = max_delay
        self.retry_wait = retry_wait
        self.max_retries = max_retries
        self.timeout = timeout
        self._last_request_time = 0.0

        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": _USER_AGENT,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
        })

    def _wait_for_rate_limit(self):
        """Wait random delay between requests to appear human."""
        now = time.time()
        elapsed = now - self._last_request_time
        delay = random.uniform(self.min_delay, self.max_delay)
        if elapsed < delay:
            wait = delay - elapsed
            logger.debug(f"Rate limit: waiting {wait:.1f}s")
            time.sleep(wait)

    def get(self, url: str) -> requests.Response:
        """GET with rate limiting and retry."""
        self._wait_for_rate_limit()

        last_error = None
        for attempt in range(1 + self.max_retries):
            try:
                self._last_request_time = time.time()
                resp = self.session.get(url, timeout=self.timeout)
                resp.raise_for_status()
                return resp
            except Exception as e:
                last_error = e
                status = getattr(resp, 'status_code', None) if 'resp' in dir() else None
                logger.warning(f"Request failed (attempt {attempt + 1}/{1 + self.max_retries}): "
                               f"{url} — {e}")
                if attempt < self.max_retries:
                    wait = self.retry_wait if (status and status == 403) else self.retry_wait
                    if status == 403 or status == 429:
                        wait = 60.0 if self.retry_wait > 1 else self.retry_wait
                    logger.info(f"Retrying in {wait:.0f}s...")
                    time.sleep(wait)

        raise last_error

    def login(self, username: str, password: str) -> bool:
        """Login to TCDB. Returns True on success."""
        # First GET the login page to pick up session cookies
        self._wait_for_rate_limit()
        self._last_request_time = time.time()
        login_page = self.session.get(f"{self.BASE_URL}/Login.cfm", timeout=self.timeout)

        self._wait_for_rate_limit()
        self._last_request_time = time.time()
        resp = self.session.post(
            f"{self.BASE_URL}/Login.cfm",
            data={"username": username, "password": password},
            timeout=self.timeout,
            allow_redirects=True
        )

        # Check if login succeeded by looking for signs of being logged in
        logged_in = "Logout" in resp.text or "MyProfile" in resp.text or "My Profile" in resp.text
        if logged_in:
            logger.info("Login successful")
        else:
            logger.error("Login failed — check credentials")
        return logged_in
```

**Step 4: Run tests to verify they pass**

Run: `cd tcdb-scraper && python -m pytest test_http_client.py -v`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add http_client.py test_http_client.py
git commit -m "feat: add rate-limited HTTP client with retry logic"
```

---

## Task 4: Checkpoint Manager

**Files:**
- Create: `tcdb-scraper/checkpoint.py`
- Test: `tcdb-scraper/test_checkpoint.py`

**Step 1: Write the failing test**

Create `tcdb-scraper/test_checkpoint.py`:
```python
import os
import json
import pytest

def test_checkpoint_save_and_load():
    from checkpoint import Checkpoint
    path = "test_checkpoint.json"
    try:
        cp = Checkpoint(path)
        cp.save_sets([{"id": 100, "name": "2025 Topps", "year": 2025}])
        cp.mark_set_done(100)
        cp2 = Checkpoint(path)
        assert cp2.is_set_done(100)
        assert not cp2.is_set_done(200)
        assert len(cp2.get_sets()) == 1
    finally:
        os.remove(path)

def test_checkpoint_fresh_start():
    from checkpoint import Checkpoint
    path = "test_checkpoint_fresh.json"
    cp = Checkpoint(path)
    assert cp.get_sets() == []
    assert not cp.is_set_done(1)
    # No file created until save
    assert not os.path.exists(path)

def test_checkpoint_preserves_existing_done():
    from checkpoint import Checkpoint
    path = "test_checkpoint_preserve.json"
    try:
        cp = Checkpoint(path)
        cp.save_sets([{"id": 1, "name": "A"}, {"id": 2, "name": "B"}])
        cp.mark_set_done(1)
        # Reload and add more sets — done set should persist
        cp2 = Checkpoint(path)
        assert cp2.is_set_done(1)
        cp2.mark_set_done(2)
        cp3 = Checkpoint(path)
        assert cp3.is_set_done(1)
        assert cp3.is_set_done(2)
    finally:
        os.remove(path)
```

**Step 2: Run tests to verify they fail**

Run: `cd tcdb-scraper && python -m pytest test_checkpoint.py -v`
Expected: FAIL — `ModuleNotFoundError`

**Step 3: Implement checkpoint.py**

Create `tcdb-scraper/checkpoint.py`:
```python
"""
Checkpoint manager — tracks scraper progress for resume support.
Stores discovered sets and which ones are fully scraped.
"""
import json
import os
import logging

logger = logging.getLogger(__name__)


class Checkpoint:
    """JSON-based checkpoint for scraper resume."""

    def __init__(self, path: str = "checkpoint.json"):
        self.path = path
        self._data = {"sets": [], "done": []}
        if os.path.exists(path):
            with open(path, "r") as f:
                self._data = json.load(f)
            logger.info(f"Loaded checkpoint: {len(self._data.get('done', []))} sets done "
                        f"of {len(self._data.get('sets', []))}")

    def _save(self):
        with open(self.path, "w") as f:
            json.dump(self._data, f, indent=2)

    def save_sets(self, sets: list[dict]):
        """Save the discovered set list."""
        self._data["sets"] = sets
        if "done" not in self._data:
            self._data["done"] = []
        self._save()

    def get_sets(self) -> list[dict]:
        """Get the discovered set list."""
        return self._data.get("sets", [])

    def mark_set_done(self, set_id: int):
        """Mark a set as fully scraped."""
        if set_id not in self._data["done"]:
            self._data["done"].append(set_id)
            self._save()

    def is_set_done(self, set_id: int) -> bool:
        """Check if a set has been fully scraped."""
        return set_id in self._data.get("done", [])
```

**Step 4: Run tests to verify they pass**

Run: `cd tcdb-scraper && python -m pytest test_checkpoint.py -v`
Expected: All 3 tests PASS

**Step 5: Commit**

```bash
git add checkpoint.py test_checkpoint.py
git commit -m "feat: add JSON checkpoint manager for scraper resume"
```

---

## Task 5: Brand Extractor Utility

**Files:**
- Create: `tcdb-scraper/utils.py`
- Test: `tcdb-scraper/test_utils.py`

**Step 1: Write the failing test**

Create `tcdb-scraper/test_utils.py`:
```python
def test_extract_brand():
    from utils import extract_brand
    assert extract_brand("2025 Topps Chrome") == "Topps"
    assert extract_brand("2025 Bowman Draft") == "Bowman"
    assert extract_brand("2024 Panini Prizm") == "Panini"
    assert extract_brand("2025 Upper Deck") == "Upper Deck"
    assert extract_brand("2023 Leaf Valiant") == "Leaf"
    assert extract_brand("2025 Donruss Optic") == "Donruss"
    assert extract_brand("2025 Topps") == "Topps"
    assert extract_brand("Some Unknown Set") == ""

def test_extract_brand_with_year_prefix():
    from utils import extract_brand
    # Years at start should be stripped for matching
    assert extract_brand("2025 Topps Series 1") == "Topps"
    assert extract_brand("2024-25 Bowman Chrome") == "Bowman"
```

**Step 2: Run tests to verify they fail**

Run: `cd tcdb-scraper && python -m pytest test_utils.py -v`
Expected: FAIL

**Step 3: Implement utils.py**

Create `tcdb-scraper/utils.py`:
```python
"""Utility functions for TCDB scraper."""
import re

# Known brands — ordered longest first to match "Upper Deck" before partial matches
_BRANDS = [
    "Upper Deck", "Topps", "Bowman", "Panini", "Donruss", "Leaf",
    "Fleer", "Score", "Stadium Club", "Prizm", "Select", "Mosaic",
    "Chronicles", "Absolute", "Contenders", "Immaculate", "National Treasures",
    "Spectra", "Obsidian", "Clearly Donruss", "Sage",
]


def extract_brand(set_name: str) -> str:
    """Extract the brand from a set name like '2025 Topps Chrome' -> 'Topps'."""
    # Strip leading year pattern
    stripped = re.sub(r"^\d{4}(-\d{2,4})?\s+", "", set_name)
    for brand in _BRANDS:
        if stripped.lower().startswith(brand.lower()):
            return brand
    return ""
```

**Step 4: Run tests to verify they pass**

Run: `cd tcdb-scraper && python -m pytest test_utils.py -v`
Expected: All 2 tests PASS

**Step 5: Commit**

```bash
git add utils.py test_utils.py
git commit -m "feat: add brand extraction utility"
```

---

## Task 6: TCDB Page Parsers — Set Discovery

**Files:**
- Create: `tcdb-scraper/parsers.py`
- Test: `tcdb-scraper/test_parsers.py`

This is the core parsing logic. TCDB's exact HTML structure will need to be discovered at runtime since the site blocks automated tools. The parser functions accept HTML strings so they can be tested with saved snapshots.

**IMPORTANT:** The parser implementations below are best-effort based on the existing TCDB-Scraper's XPath patterns and URL analysis. **The first run of the scraper will likely need parser adjustments** once we see the actual HTML. The structure is designed to make these adjustments easy — each parser is a standalone function that takes HTML and returns structured data.

**Step 1: Write the test with sample HTML**

Create `tcdb-scraper/test_parsers.py`:
```python
"""Tests for TCDB page parsers.
Uses sample HTML fragments based on known TCDB URL patterns.
These may need updating once we see real TCDB HTML.
"""

def test_parse_set_list_page():
    from parsers import parse_set_list_page
    # Sample HTML fragment matching TCDB's ViewAll.cfm pattern
    html = """
    <div id="content">
      <div><div><ul>
        <li><a href="/ViewSet.cfm/sid/482758/2025-Topps">2025 Topps</a> (660 cards)</li>
        <li><a href="/ViewSet.cfm/sid/500123/2025-Bowman">2025 Bowman</a> (300 cards)</li>
      </ul></div></div>
    </div>
    """
    sets = parse_set_list_page(html)
    assert len(sets) == 2
    assert sets[0]["tcdb_id"] == 482758
    assert sets[0]["name"] == "2025 Topps"
    assert sets[0]["url_slug"] == "/ViewSet.cfm/sid/482758/2025-Topps"
    assert sets[1]["tcdb_id"] == 500123

def test_parse_set_list_extracts_card_count():
    from parsers import parse_set_list_page
    html = """
    <div id="content">
      <div><div><ul>
        <li><a href="/ViewSet.cfm/sid/100/Test-Set">Test Set</a> (150 cards)</li>
      </ul></div></div>
    </div>
    """
    sets = parse_set_list_page(html)
    assert sets[0].get("card_count") == 150

def test_parse_set_detail_cards():
    from parsers import parse_set_detail_page
    # Sample based on TCDB's ViewSet.cfm card table structure
    html = """
    <h4 class="site">2025 Topps</h4>
    <p><strong>Total Cards:</strong> 660</p>
    <div class="col-md-6"><table class="block1">
      <tr><th>#</th><th>Name</th><th>Team</th></tr>
      <tr>
        <td valign="top">1</td>
        <td valign="top">Aaron Judge</td>
        <td valign="top">New York Yankees</td>
      </tr>
      <tr>
        <td valign="top">2</td>
        <td valign="top">Shohei Ohtani</td>
        <td valign="top">Los Angeles Dodgers</td>
      </tr>
    </table></div>
    """
    result = parse_set_detail_page(html)
    assert len(result["cards"]) == 2
    assert result["cards"][0]["card_number"] == "1"
    assert result["cards"][0]["player"] == "Aaron Judge"
    assert result["cards"][0]["team"] == "New York Yankees"
    assert result["total_cards"] == 660

def test_parse_set_detail_with_image_urls():
    from parsers import parse_set_detail_page
    html = """
    <h4 class="site">2025 Topps</h4>
    <p><strong>Total Cards:</strong> 2</p>
    <div class="col-md-6"><table class="block1">
      <tr><th>#</th><th>Name</th><th>Team</th></tr>
      <tr>
        <td valign="top"><img data-original="https://tcdb.com/Images/Cards/123.jpg" />1</td>
        <td valign="top">Aaron Judge</td>
        <td valign="top">New York Yankees</td>
      </tr>
    </table></div>
    """
    result = parse_set_detail_page(html)
    assert result["cards"][0].get("image_url") == "https://tcdb.com/Images/Cards/123.jpg"

def test_parse_set_id_from_url():
    from parsers import parse_set_id_from_url
    assert parse_set_id_from_url("/ViewSet.cfm/sid/482758/2025-Topps") == 482758
    assert parse_set_id_from_url("/ViewSet.cfm/sid/100/Test") == 100
    assert parse_set_id_from_url("/some/other/url") is None
```

**Step 2: Run tests to verify they fail**

Run: `cd tcdb-scraper && python -m pytest test_parsers.py -v`
Expected: FAIL

**Step 3: Implement parsers.py**

Create `tcdb-scraper/parsers.py`:
```python
"""
TCDB HTML page parsers.
Each function takes raw HTML and returns structured data.

NOTE: TCDB's exact HTML structure may change. These parsers are based on
patterns observed in the existing TCDB-Scraper repo and URL analysis.
If parsing fails, save the HTML to errors.log and adjust selectors.
"""
import re
import logging
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


def parse_set_id_from_url(url: str) -> int | None:
    """Extract set ID from a TCDB URL like /ViewSet.cfm/sid/482758/..."""
    match = re.search(r"/ViewSet\.cfm/sid/(\d+)", url)
    return int(match.group(1)) if match else None


def parse_set_list_page(html: str) -> list[dict]:
    """
    Parse a ViewAll.cfm year page to extract set listings.
    Returns list of {tcdb_id, name, url_slug, card_count}.
    """
    soup = BeautifulSoup(html, "html.parser")
    sets = []

    # TCDB lists sets as links inside the content area
    # Try multiple selectors since exact structure is uncertain
    links = soup.select('#content a[href*="/ViewSet.cfm/sid/"]')
    if not links:
        links = soup.find_all("a", href=re.compile(r"/ViewSet\.cfm/sid/\d+"))

    for link in links:
        href = link.get("href", "")
        tcdb_id = parse_set_id_from_url(href)
        if tcdb_id is None:
            continue

        name = link.get_text(strip=True)

        # Try to extract card count from surrounding text like "(660 cards)"
        card_count = 0
        parent_text = link.parent.get_text() if link.parent else ""
        count_match = re.search(r"\((\d+)\s+cards?\)", parent_text)
        if count_match:
            card_count = int(count_match.group(1))

        sets.append({
            "tcdb_id": tcdb_id,
            "name": name,
            "url_slug": href,
            "card_count": card_count,
        })

    logger.info(f"Parsed {len(sets)} sets from page")
    return sets


def parse_set_detail_page(html: str) -> dict:
    """
    Parse a ViewSet.cfm page to extract cards, inserts, parallels.
    Returns {title, total_cards, cards: [{card_number, player, team, image_url, rc_sp}],
             insert_sections: [...], parallels: [...]}.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Title
    title_el = soup.find("h4", class_="site")
    title = title_el.get_text(strip=True) if title_el else ""

    # Total cards
    total_cards = 0
    total_el = soup.find("strong", string=re.compile(r"Total Cards"))
    if total_el and total_el.next_sibling:
        count_match = re.search(r"(\d+)", total_el.next_sibling.strip() if isinstance(total_el.next_sibling, str) else "")
        if count_match:
            total_cards = int(count_match.group(1))

    # Cards — from tables with class "block1"
    cards = []
    tables = soup.select(".block1")
    if not tables:
        tables = soup.find_all("table")

    for table in tables:
        rows = table.find_all("tr")
        for row in rows[1:]:  # Skip header row
            cells = row.find_all("td")
            if len(cells) < 2:
                continue

            # Extract image URL if present
            image_url = ""
            img_tag = cells[0].find("img")
            if img_tag:
                image_url = img_tag.get("data-original") or img_tag.get("src") or ""

            # Extract text values from cells
            values = []
            for cell in cells:
                texts = cell.stripped_strings
                combined = " ".join(texts).strip()
                values.append(combined)

            values = [v for v in values if v]
            if len(values) < 2:
                continue

            # Determine card number, player, team from cell positions
            card_number = values[0] if values else ""
            player = values[1] if len(values) > 1 else ""
            team = values[2] if len(values) > 2 else ""

            # Check for RC/SP flags in player or team text
            rc_sp = ""
            for flag in ["RC", "SP", "SSP", "1st"]:
                if flag in player or flag in team:
                    rc_sp = flag
                    player = player.replace(flag, "").strip()
                    team = team.replace(flag, "").strip()
                    break

            cards.append({
                "card_number": card_number,
                "player": player,
                "team": team,
                "image_url": image_url,
                "rc_sp": rc_sp,
            })

    # TODO: Parse insert sections and parallels from the page
    # These will need adjustment once we see the actual TCDB HTML structure
    insert_sections = _parse_insert_sections(soup)
    parallels = _parse_parallels(soup)

    return {
        "title": title,
        "total_cards": total_cards,
        "cards": cards,
        "insert_sections": insert_sections,
        "parallels": parallels,
    }


def _parse_insert_sections(soup: BeautifulSoup) -> list[dict]:
    """Parse insert/subset sections from a set detail page.
    Returns [{name, card_count, odds}].
    NOTE: Selector needs tuning against real TCDB HTML."""
    sections = []
    # Look for section headers — TCDB often uses distinct heading elements for subsets
    # This is a best-effort parser that will need adjustment
    for heading in soup.find_all(["h3", "h4", "h5"], class_=re.compile(r"insert|subset|section", re.I)):
        name = heading.get_text(strip=True)
        if name and name != "Base":
            sections.append({"name": name, "card_count": 0, "odds": ""})
    return sections


def _parse_parallels(soup: BeautifulSoup) -> list[dict]:
    """Parse parallel/variant information from a set detail page.
    Returns [{name, print_run, exclusive}].
    NOTE: Selector needs tuning against real TCDB HTML."""
    parallels = []
    # Look for parallel listings — often in a specific div or list
    # This will need adjustment once we see actual structure
    return parallels


def parse_next_page_url(html: str) -> str | None:
    """Extract next page URL from pagination, if present."""
    soup = BeautifulSoup(html, "html.parser")
    # Look for common pagination patterns
    next_link = soup.find("a", string=re.compile(r"Next|»|›"))
    if next_link and next_link.get("href"):
        return next_link["href"]
    return None


def parse_collection_sets(html: str) -> list[dict]:
    """Parse a user's collection page to extract which sets they own cards in.
    Used by migrator.py --discover mode.
    Returns [{tcdb_id, name, owned_count}]."""
    soup = BeautifulSoup(html, "html.parser")
    sets = []
    links = soup.find_all("a", href=re.compile(r"/ViewSet\.cfm/sid/\d+"))
    for link in links:
        tcdb_id = parse_set_id_from_url(link["href"])
        if tcdb_id:
            name = link.get_text(strip=True)
            # Try to find count near the link
            parent_text = link.parent.get_text() if link.parent else ""
            count_match = re.search(r"(\d+)", parent_text.replace(name, ""))
            owned_count = int(count_match.group(1)) if count_match else 0
            sets.append({"tcdb_id": tcdb_id, "name": name, "owned_count": owned_count})
    return sets


def parse_collection_cards(html: str) -> list[dict]:
    """Parse a user's collection card list for a specific set.
    Used by migrator.py --migrate mode.
    Returns [{card_number, player, team, qty}]."""
    soup = BeautifulSoup(html, "html.parser")
    cards = []
    # This will use a similar table structure to set detail pages
    tables = soup.select(".block1")
    if not tables:
        tables = soup.find_all("table")
    for table in tables:
        rows = table.find_all("tr")
        for row in rows[1:]:
            cells = row.find_all("td")
            values = [c.get_text(strip=True) for c in cells if c.get_text(strip=True)]
            if len(values) >= 2:
                cards.append({
                    "card_number": values[0],
                    "player": values[1] if len(values) > 1 else "",
                    "team": values[2] if len(values) > 2 else "",
                    "qty": 1,  # Default to 1 — TCDB may show actual qty differently
                })
    return cards
```

**Step 4: Run tests to verify they pass**

Run: `cd tcdb-scraper && python -m pytest test_parsers.py -v`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add parsers.py test_parsers.py
git commit -m "feat: add TCDB HTML page parsers for sets, cards, and collections"
```

---

## Task 7: Main Scraper Script (scraper.py)

**Files:**
- Create: `tcdb-scraper/scraper.py`

This is the orchestrator that ties all modules together. No unit tests for this one — it's an integration script that's tested by running it.

**Step 1: Implement scraper.py**

Create `tcdb-scraper/scraper.py`:
```python
#!/usr/bin/env python3
"""
TCDB-to-CardVoice Catalog Scraper
Scrapes baseball card set checklists from tcdb.com and outputs a
CardVoice-compatible SQLite catalog database with thumbnail images.

Usage:
    python scraper.py                    # Full run (or resume from checkpoint)
    python scraper.py --start-year 2025  # Start from specific year
    python scraper.py --dry-run          # Discover sets only, don't scrape details
"""
import os
import sys
import json
import time
import logging
import argparse
import random
from pathlib import Path

from dotenv import load_dotenv

from db_helper import (create_catalog_db, insert_set, insert_card,
                       upsert_insert_type, upsert_parallel,
                       update_set_total, set_catalog_version)
from http_client import TcdbClient
from checkpoint import Checkpoint
from parsers import parse_set_list_page, parse_set_detail_page, parse_next_page_url, parse_set_id_from_url
from utils import extract_brand

load_dotenv()

# --- Config ---
OUTPUT_DIR = Path("output")
DB_PATH = OUTPUT_DIR / "tcdb-catalog.db"
IMAGES_DIR = OUTPUT_DIR / "images"
CHECKPOINT_PATH = "checkpoint.json"
MY_SETS_PATH = "my_sets.json"
TCDB_BASE = "https://www.tcdb.com"
START_YEAR = 2026
END_YEAR = 1900  # Go all the way back

# --- Logging ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("scraper.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


def discover_sets(client: TcdbClient, start_year: int) -> list[dict]:
    """Phase 1: Discover all baseball sets from start_year downward."""
    all_sets = []
    year = start_year

    while year >= END_YEAR:
        url = f"{TCDB_BASE}/ViewAll.cfm/sp/Baseball/year/{year}"
        logger.info(f"Discovering sets for {year}...")

        try:
            resp = client.get(url)
            sets = parse_set_list_page(resp.text)
            if not sets:
                logger.info(f"No sets found for {year}, stopping discovery")
                break
            for s in sets:
                s["year"] = year
            all_sets.extend(sets)
            logger.info(f"  Found {len(sets)} sets for {year} (total: {len(all_sets)})")
        except Exception as e:
            logger.error(f"Failed to fetch year {year}: {e}")
            # If we get blocked, stop discovery rather than hammering
            if "403" in str(e) or "429" in str(e):
                logger.warning("Rate limited during discovery — stopping")
                break

        year -= 1

    return all_sets


def prioritize_sets(all_sets: list[dict]) -> list[dict]:
    """Sort sets: owned sets first (2026→oldest), then remaining (2026→oldest)."""
    owned_ids = set()
    if os.path.exists(MY_SETS_PATH):
        with open(MY_SETS_PATH) as f:
            my_sets = json.load(f)
            owned_ids = {s["tcdb_id"] for s in my_sets}
        logger.info(f"Loaded {len(owned_ids)} owned set IDs for prioritization")

    owned = [s for s in all_sets if s["tcdb_id"] in owned_ids]
    others = [s for s in all_sets if s["tcdb_id"] not in owned_ids]

    # Both groups sorted by year descending
    owned.sort(key=lambda s: -s.get("year", 0))
    others.sort(key=lambda s: -s.get("year", 0))

    return owned + others


def scrape_set(client: TcdbClient, conn, set_info: dict) -> int:
    """Scrape a single set's cards, inserts, parallels, and images.
    Returns count of cards added."""
    tcdb_id = set_info["tcdb_id"]
    year = set_info.get("year", 0)
    name = set_info["name"]
    brand = extract_brand(name)

    logger.info(f"Scraping: {name} (ID: {tcdb_id})")

    # Create set in catalog DB
    try:
        set_id = insert_set(conn, name=name, year=year, brand=brand, sport="Baseball")
    except Exception:
        # Set might already exist from a partial previous run
        row = conn.execute("SELECT id FROM card_sets WHERE name = ? AND year = ?",
                           (name, year)).fetchone()
        if row:
            set_id = row[0]
        else:
            logger.error(f"Cannot create or find set: {name}")
            return 0

    # Ensure images directory exists
    set_image_dir = IMAGES_DIR / str(tcdb_id)
    set_image_dir.mkdir(parents=True, exist_ok=True)

    url = f"{TCDB_BASE}/ViewSet.cfm/sid/{tcdb_id}"
    total_cards_added = 0
    page_num = 1

    while url:
        try:
            resp = client.get(url)
        except Exception as e:
            logger.error(f"Failed to fetch set page {url}: {e}")
            break

        result = parse_set_detail_page(resp.text)

        # Insert insert types
        for section in result.get("insert_sections", []):
            upsert_insert_type(conn, set_id=set_id, name=section["name"],
                               card_count=section.get("card_count", 0),
                               odds=section.get("odds", ""))

        # Insert parallels
        for parallel in result.get("parallels", []):
            upsert_parallel(conn, set_id=set_id, name=parallel["name"],
                            print_run=parallel.get("print_run"),
                            exclusive=parallel.get("exclusive", ""))

        # Insert cards and download images
        for card in result.get("cards", []):
            image_path = ""
            image_url = card.get("image_url", "")

            # Download thumbnail if available
            if image_url:
                ext = os.path.splitext(image_url)[1] or ".jpg"
                safe_num = card["card_number"].replace("/", "_").replace("\\", "_")
                image_filename = f"{safe_num}{ext}"
                local_path = set_image_dir / image_filename
                image_path = f"images/{tcdb_id}/{image_filename}"

                if not local_path.exists():
                    try:
                        img_resp = client.session.get(image_url, timeout=15)
                        if img_resp.status_code == 200:
                            local_path.write_bytes(img_resp.content)
                        else:
                            image_path = ""
                            logger.debug(f"Image download failed ({img_resp.status_code}): {image_url}")
                    except Exception as e:
                        image_path = ""
                        logger.debug(f"Image download error: {e}")

            card_id = insert_card(
                conn, set_id=set_id,
                card_number=card["card_number"],
                player=card["player"],
                team=card.get("team", ""),
                rc_sp=card.get("rc_sp", ""),
                insert_type=card.get("insert_type", "Base"),
                parallel="",
                image_path=image_path,
            )
            if card_id:
                total_cards_added += 1

        # Check for next page
        next_url = parse_next_page_url(resp.text)
        if next_url:
            url = f"{TCDB_BASE}{next_url}" if next_url.startswith("/") else next_url
            page_num += 1
            logger.debug(f"  Page {page_num}...")
        else:
            url = None

    update_set_total(conn, set_id)
    logger.info(f"  Done: {total_cards_added} cards added")
    return total_cards_added


def main():
    parser = argparse.ArgumentParser(description="TCDB-to-CardVoice Catalog Scraper")
    parser.add_argument("--start-year", type=int, default=START_YEAR,
                        help=f"Year to start scraping from (default: {START_YEAR})")
    parser.add_argument("--dry-run", action="store_true",
                        help="Discover sets only, don't scrape details")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    client = TcdbClient()
    cp = Checkpoint(CHECKPOINT_PATH)
    conn = create_catalog_db(str(DB_PATH))

    # Phase 1: Discover sets (or resume from checkpoint)
    if cp.get_sets():
        all_sets = cp.get_sets()
        logger.info(f"Resuming with {len(all_sets)} sets from checkpoint")
    else:
        logger.info("Phase 1: Discovering sets...")
        all_sets = discover_sets(client, args.start_year)
        cp.save_sets(all_sets)
        logger.info(f"Discovered {len(all_sets)} total sets")

    if args.dry_run:
        logger.info("Dry run — stopping after discovery")
        conn.close()
        return

    # Phase 2: Scrape each set (priority order)
    ordered_sets = prioritize_sets(all_sets)
    done_count = sum(1 for s in ordered_sets if cp.is_set_done(s["tcdb_id"]))
    total_count = len(ordered_sets)

    logger.info(f"Phase 2: Scraping sets ({done_count}/{total_count} already done)")

    for i, set_info in enumerate(ordered_sets):
        tcdb_id = set_info["tcdb_id"]
        if cp.is_set_done(tcdb_id):
            continue

        progress = f"[{done_count + 1}/{total_count}]"
        logger.info(f"{progress} {set_info['name']} ({set_info.get('year', '?')})")

        try:
            scrape_set(client, conn, set_info)
            cp.mark_set_done(tcdb_id)
            done_count += 1
        except KeyboardInterrupt:
            logger.info("Interrupted — progress saved to checkpoint")
            break
        except Exception as e:
            logger.error(f"Failed to scrape set {set_info['name']}: {e}")
            # Continue to next set rather than stopping

    # Stamp catalog version
    from datetime import date
    version = date.today().strftime("%Y.%m.1")
    set_catalog_version(conn, version)

    conn.close()
    logger.info(f"Done! Catalog saved to {DB_PATH} ({done_count}/{total_count} sets)")


if __name__ == "__main__":
    main()
```

**Step 2: Smoke test (dry run)**

Run: `cd tcdb-scraper && python scraper.py --dry-run --start-year 2025`
Expected: Should attempt to discover sets for 2025, may succeed or get 403 (which is expected and logged). Checkpoint file should be created.

**Step 3: Commit**

```bash
git add scraper.py
git commit -m "feat: add main scraper script with discovery, parsing, and image download"
```

---

## Task 8: Migrator Script (migrator.py)

**Files:**
- Create: `tcdb-scraper/migrator.py`

**Step 1: Implement migrator.py**

Create `tcdb-scraper/migrator.py`:
```python
#!/usr/bin/env python3
"""
TCDB Collection Migrator
Logs into TCDB, reads your collection, and generates data for CardVoice import.

Usage:
    python migrator.py --discover     # Find which sets you own, save to my_sets.json
    python migrator.py --migrate      # Full migration: read all owned cards, output qty_updates.json
"""
import os
import sys
import json
import logging
import argparse

from dotenv import load_dotenv

from http_client import TcdbClient
from parsers import parse_collection_sets, parse_collection_cards, parse_set_id_from_url

load_dotenv()

TCDB_BASE = "https://www.tcdb.com"
MY_SETS_PATH = "my_sets.json"
QTY_UPDATES_PATH = "qty_updates.json"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("migrator.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)


def login(client: TcdbClient) -> bool:
    """Login to TCDB using .env credentials."""
    username = os.getenv("TCDB_USER")
    password = os.getenv("TCDB_PASS")
    if not username or not password:
        logger.error("TCDB_USER and TCDB_PASS must be set in .env file")
        return False
    return client.login(username, password)


def discover_owned_sets(client: TcdbClient, username: str) -> list[dict]:
    """Discover all sets the user has cards in."""
    # TCDB collection URL pattern — may need adjustment
    url = f"{TCDB_BASE}/Collection.cfm/{username}/Baseball"
    logger.info(f"Fetching collection page: {url}")

    all_sets = []
    page = 1

    while url:
        try:
            resp = client.get(url)
            sets = parse_collection_sets(resp.text)
            if not sets:
                break
            all_sets.extend(sets)
            logger.info(f"  Page {page}: found {len(sets)} sets (total: {len(all_sets)})")

            # Check for next page
            from parsers import parse_next_page_url
            next_url = parse_next_page_url(resp.text)
            if next_url:
                url = f"{TCDB_BASE}{next_url}" if next_url.startswith("/") else next_url
                page += 1
            else:
                url = None
        except Exception as e:
            logger.error(f"Failed to fetch collection page: {e}")
            break

    return all_sets


def migrate_collection(client: TcdbClient, username: str) -> list[dict]:
    """Read all owned cards and generate qty updates."""
    # Load owned sets
    if not os.path.exists(MY_SETS_PATH):
        logger.error(f"{MY_SETS_PATH} not found — run --discover first")
        return []

    with open(MY_SETS_PATH) as f:
        my_sets = json.load(f)

    all_updates = []
    total = len(my_sets)

    for i, set_info in enumerate(my_sets):
        tcdb_id = set_info["tcdb_id"]
        name = set_info.get("name", f"Set {tcdb_id}")
        logger.info(f"[{i + 1}/{total}] Reading collection for: {name}")

        # Fetch user's cards in this set
        # URL pattern may need adjustment
        url = f"{TCDB_BASE}/Collection.cfm/{username}/Baseball/{tcdb_id}"

        try:
            resp = client.get(url)
            cards = parse_collection_cards(resp.text)
            for card in cards:
                card["tcdb_set_id"] = tcdb_id
                card["set_name"] = name
            all_updates.extend(cards)
            logger.info(f"  Found {len(cards)} cards")
        except Exception as e:
            logger.error(f"  Failed: {e}")

    return all_updates


def main():
    parser = argparse.ArgumentParser(description="TCDB Collection Migrator")
    parser.add_argument("--discover", action="store_true",
                        help="Discover owned sets, save to my_sets.json")
    parser.add_argument("--migrate", action="store_true",
                        help="Full migration: read all owned cards")
    args = parser.parse_args()

    if not args.discover and not args.migrate:
        parser.print_help()
        return

    username = os.getenv("TCDB_USER")
    if not username:
        logger.error("TCDB_USER must be set in .env file")
        sys.exit(1)

    client = TcdbClient()

    if not login(client):
        sys.exit(1)

    if args.discover:
        logger.info("Mode: Discover owned sets")
        sets = discover_owned_sets(client, username)
        with open(MY_SETS_PATH, "w") as f:
            json.dump(sets, f, indent=2)
        logger.info(f"Saved {len(sets)} owned sets to {MY_SETS_PATH}")

    if args.migrate:
        logger.info("Mode: Full collection migration")
        updates = migrate_collection(client, username)
        with open(QTY_UPDATES_PATH, "w") as f:
            json.dump(updates, f, indent=2)
        logger.info(f"Saved {len(updates)} card updates to {QTY_UPDATES_PATH}")


if __name__ == "__main__":
    main()
```

**Step 2: Commit**

```bash
git add migrator.py
git commit -m "feat: add collection migrator with discover and migrate modes"
```

---

## Task 9: CardVoice Schema Migration — Add image_path Column

**Files:**
- Modify: `server/db.js:80-93` (cards table CREATE + migration block)
- Modify: `server/routes.js:82` (card SELECT query)

**Step 1: Add image_path to cards CREATE TABLE**

In `server/db.js`, the `cards` CREATE TABLE (line 80) does not include `image_path`. Add it after `qty`:

Find in `server/db.js` (lines 80-93):
```javascript
    CREATE TABLE IF NOT EXISTS cards (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      set_id      INTEGER NOT NULL REFERENCES card_sets(id) ON DELETE CASCADE,
      card_number TEXT    NOT NULL,
      player      TEXT    NOT NULL,
      team        TEXT    DEFAULT '',
      rc_sp       TEXT    DEFAULT '',
      insert_type TEXT    DEFAULT 'Base',
      parallel    TEXT    DEFAULT '',
      qty         INTEGER DEFAULT 0
    );
```

Replace with:
```javascript
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
```

**Step 2: Add migration for existing databases**

After the pricing migration block (around line 215), add:

```javascript
  // Migration: add image_path to cards
  const imageCols = [
    "ALTER TABLE cards ADD COLUMN image_path TEXT DEFAULT ''",
  ];
  for (const sql of imageCols) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
  }
```

**Step 3: Update card SELECT in GET /api/sets/:id**

In `server/routes.js` line 82, the card query needs to include `image_path`:

Find:
```javascript
      `SELECT id, card_number, player, team, rc_sp, insert_type, parallel, qty
       FROM cards WHERE set_id = ? ORDER BY card_number`
```

Replace with:
```javascript
      `SELECT id, card_number, player, team, rc_sp, insert_type, parallel, qty, image_path
       FROM cards WHERE set_id = ? ORDER BY card_number`
```

**Step 4: Run CardVoice server to verify migration works**

Run: `cd server && node -e "const {openDb} = require('./db'); const db = openDb(); console.log('OK'); db.close()"`
Expected: "OK" — no errors from migration

**Step 5: Commit**

```bash
git add server/db.js server/routes.js
git commit -m "feat: add image_path column to cards table with migration"
```

---

## Task 10: CardVoice Catalog Merge — Handle image_path

**Files:**
- Modify: `server/catalog-merge.js:95-96` (insertCard and updateCardMeta prepared statements)

**Step 1: Update catalog merge to handle image_path**

In `server/catalog-merge.js`, update the card merge statements:

Find (line 95):
```javascript
    const insertCard = db.prepare('INSERT INTO cards (set_id, card_number, player, team, rc_sp, insert_type, parallel, qty) VALUES (?, ?, ?, ?, ?, ?, ?, 0)');
    const updateCardMeta = db.prepare('UPDATE cards SET player = ?, team = ?, rc_sp = ? WHERE id = ?');
```

Replace with:
```javascript
    const insertCard = db.prepare('INSERT INTO cards (set_id, card_number, player, team, rc_sp, insert_type, parallel, qty, image_path) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)');
    const updateCardMeta = db.prepare('UPDATE cards SET player = ?, team = ?, rc_sp = ?, image_path = CASE WHEN ? != \'\' THEN ? ELSE cards.image_path END WHERE id = ?');
```

Find (lines 155-161):
```javascript
          if (existingCard) {
            updateCardMeta.run(card.player, card.team, card.rc_sp, existingCard.id);
            results.cards.updated++;
          } else {
            insertCard.run(userSetId, card.card_number, card.player, card.team, card.rc_sp, card.insert_type, card.parallel);
            results.cards.added++;
          }
```

Replace with:
```javascript
          if (existingCard) {
            const imgPath = card.image_path || '';
            updateCardMeta.run(card.player, card.team, card.rc_sp, imgPath, imgPath, existingCard.id);
            results.cards.updated++;
          } else {
            insertCard.run(userSetId, card.card_number, card.player, card.team, card.rc_sp, card.insert_type, card.parallel, card.image_path || '');
            results.cards.added++;
          }
```

**Step 2: Commit**

```bash
git add server/catalog-merge.js
git commit -m "feat: update catalog merge to handle image_path column"
```

---

## Task 11: CardVoice Qty Import Endpoint

**Files:**
- Modify: `server/routes.js` (add new endpoint after import-checklist)

**Step 1: Add POST /api/import-qty endpoint**

After the `import-checklist` route (around line 599 in `server/routes.js`), add:

```javascript
  // POST /api/import-qty — bulk import quantities from external source (e.g., TCDB migrator)
  router.post('/api/import-qty', (req, res) => {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ detail: 'updates array required' });
    }

    const findCard = db.prepare(
      `SELECT id, qty FROM cards
       WHERE set_id = (SELECT id FROM card_sets WHERE name = ? AND year = ?)
       AND card_number = ? AND insert_type = ? AND parallel = ?`
    );

    const updateQty = db.prepare('UPDATE cards SET qty = ? WHERE id = ?');

    let matched = 0;
    let unmatched = 0;

    const doImport = db.transaction(() => {
      for (const u of updates) {
        const card = findCard.get(
          u.set_name || '', u.year || null,
          u.card_number || '', u.insert_type || 'Base', u.parallel || ''
        );
        if (card) {
          updateQty.run(u.qty || 1, card.id);
          matched++;
        } else {
          unmatched++;
        }
      }
    });

    backupDb();
    doImport();

    res.json({ matched, unmatched, total: updates.length });
  });
```

**Step 2: Commit**

```bash
git add server/routes.js
git commit -m "feat: add POST /api/import-qty endpoint for collection migration"
```

---

## Task 12: Run All Tests & Final Verification

**Step 1: Run all Python tests**

Run: `cd tcdb-scraper && python -m pytest -v`
Expected: All tests pass (db_helper, http_client, checkpoint, utils, parsers)

**Step 2: Run scraper in dry-run mode**

Run: `cd tcdb-scraper && python scraper.py --dry-run --start-year 2025`
Expected: Attempts set discovery, logs progress. May get 403s from TCDB which is expected.

**Step 3: Verify CardVoice starts cleanly**

Run: `cd server && node -e "const {openDb} = require('./db'); const db = openDb(); console.log('Tables OK'); db.close()"`
Expected: "Tables OK"

**Step 4: Final commit if anything was adjusted**

```bash
git add -A
git commit -m "chore: final adjustments after test run"
```

---

## Task 13: Parser Tuning (Post-First-Run)

> **NOTE:** This task can only be completed after running the scraper against live TCDB pages. The parsers in Task 6 are best-effort guesses.

**Step 1: Run scraper against a single known set**

Manually test with a known set URL:
```python
# In Python REPL:
from http_client import TcdbClient
from parsers import parse_set_detail_page

client = TcdbClient()
resp = client.get("https://www.tcdb.com/ViewSet.cfm/sid/482758/2025-Topps")
# Save the HTML for analysis
with open("sample_set_page.html", "w") as f:
    f.write(resp.text)
# Parse and inspect
result = parse_set_detail_page(resp.text)
print(f"Cards found: {len(result['cards'])}")
print(f"First card: {result['cards'][0] if result['cards'] else 'NONE'}")
```

**Step 2: Adjust selectors in parsers.py**

Based on what the actual HTML looks like, update:
- `parse_set_list_page()` — set listing selectors
- `parse_set_detail_page()` — card table selectors, insert section parsing, parallel parsing
- `_parse_insert_sections()` — insert type discovery
- `_parse_parallels()` — parallel/variant discovery
- `parse_collection_sets()` — collection page structure
- `parse_collection_cards()` — owned cards page structure

**Step 3: Save sample HTML as test fixtures**

Save working HTML snippets to `tcdb-scraper/fixtures/` and update `test_parsers.py` to use real HTML patterns.

**Step 4: Commit**

```bash
git add parsers.py test_parsers.py fixtures/
git commit -m "fix: tune parsers to match actual TCDB HTML structure"
```

---

## Summary: Execution Order

| Task | Description | Depends On |
|------|-------------|-----------|
| 1 | Project scaffold & deps | — |
| 2 | Database helper module | 1 |
| 3 | HTTP client with rate limiting | 1 |
| 4 | Checkpoint manager | 1 |
| 5 | Brand extractor utility | 1 |
| 6 | TCDB page parsers | 1 |
| 7 | Main scraper script | 2, 3, 4, 5, 6 |
| 8 | Migrator script | 3, 6 |
| 9 | CardVoice schema: image_path | — (independent) |
| 10 | CardVoice catalog merge update | 9 |
| 11 | CardVoice qty import endpoint | 9 |
| 12 | Run all tests & verify | 7, 8, 9, 10, 11 |
| 13 | Parser tuning (post-first-run) | 12 |

**Parallelizable groups:**
- Tasks 2-6 can all run in parallel (independent modules)
- Tasks 9-11 (CardVoice changes) can run in parallel with tasks 2-8 (scraper)
