"""Checkpoint manager for resumable scraping runs."""

import json
import os
from pathlib import Path


class Checkpoint:
    """Tracks which sets have been discovered and which are done."""

    def __init__(self, path: str = "checkpoint.json") -> None:
        self._path = Path(path)
        self._sets: list[dict] = []
        self._done: set[str] = set()
        self._load()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def save_sets(self, sets: list[dict]) -> None:
        """Persist the discovered set list (replaces previous list)."""
        self._sets = list(sets)
        self._persist()

    def get_sets(self) -> list[dict]:
        """Return the stored set list."""
        return list(self._sets)

    def mark_set_done(self, set_id: str) -> None:
        """Mark *set_id* as complete and auto-save."""
        self._done.add(str(set_id))
        self._persist()

    def is_set_done(self, set_id: str) -> bool:
        """Return whether *set_id* has already been processed."""
        return str(set_id) in self._done

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load(self) -> None:
        """Load state from disk if the checkpoint file exists."""
        if not self._path.exists():
            return
        with open(self._path, "r", encoding="utf-8") as fh:
            data = json.load(fh)
        self._sets = data.get("sets", [])
        self._done = set(data.get("done", []))

    def _persist(self) -> None:
        """Write current state to disk."""
        data = {
            "sets": self._sets,
            "done": sorted(self._done),
        }
        with open(self._path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
