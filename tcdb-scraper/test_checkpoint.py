"""Tests for the Checkpoint manager."""

import os
import json
import tempfile

import pytest

from checkpoint import Checkpoint


@pytest.fixture()
def tmp_checkpoint(tmp_path):
    """Yield a path inside a temporary directory for the checkpoint file."""
    return str(tmp_path / "checkpoint.json")


def test_checkpoint_save_and_load(tmp_checkpoint):
    """save sets, mark done, reload, verify."""
    cp = Checkpoint(path=tmp_checkpoint)
    sets = [
        {"id": "1", "name": "2025 Topps Chrome"},
        {"id": "2", "name": "2025 Bowman Draft"},
    ]
    cp.save_sets(sets)
    cp.mark_set_done("1")

    # Reload from disk
    cp2 = Checkpoint(path=tmp_checkpoint)
    assert cp2.get_sets() == sets
    assert cp2.is_set_done("1") is True
    assert cp2.is_set_done("2") is False


def test_checkpoint_fresh_start(tmp_checkpoint):
    """No file = empty sets, nothing done."""
    cp = Checkpoint(path=tmp_checkpoint)
    assert cp.get_sets() == []
    assert cp.is_set_done("anything") is False


def test_checkpoint_preserves_existing_done(tmp_checkpoint):
    """Reload preserves done status even after saving new sets."""
    cp = Checkpoint(path=tmp_checkpoint)
    sets = [{"id": "A"}, {"id": "B"}, {"id": "C"}]
    cp.save_sets(sets)
    cp.mark_set_done("A")
    cp.mark_set_done("B")

    # Reload, save a refreshed set list, and confirm done flags survive
    cp2 = Checkpoint(path=tmp_checkpoint)
    cp2.save_sets(sets)  # re-save same sets
    assert cp2.is_set_done("A") is True
    assert cp2.is_set_done("B") is True
    assert cp2.is_set_done("C") is False
