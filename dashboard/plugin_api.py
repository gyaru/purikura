"""Shared Purikura identity registry for a Hermes gateway.

The Desktop plugin remains responsible for the active identity on each client.
This API stores the shared people list and each client's default identity so
all Desktop installations connected to the same Hermes instance agree on the
available identities.
"""

from __future__ import annotations

import os
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException


async def _request_profile(profile: str | None = None):
    """Plugin routes are not auto-scoped by the dashboard's management API.

    Keep the ContextVar on the async request task; sync generator dependencies
    run in separate worker contexts and cannot safely propagate/reset it.
    """
    if not profile:
        yield
        return
    try:
        from hermes_cli.web_server_profiles import _config_profile_scope
        from hermes_cli.plugins_cmd import _get_enabled_set, _get_disabled_set
    except ImportError:
        raise HTTPException(400, 'Explicit profiles require a current Hermes dashboard')
    with _config_profile_scope(profile):
        if 'purikura' not in _get_enabled_set() or 'purikura' in _get_disabled_set():
            raise HTTPException(403, 'Enable Purikura in the selected profile first')
        yield


router = APIRouter(dependencies=[Depends(_request_profile)])

_LEGACY_DB_NAME = "speaker-identity.sqlite3"
_ID_RE = re.compile(r"^[a-z][a-z0-9_:-]{0,63}$")


def _hermes_home() -> Path:
    # Hermes can scope a request using ContextVar, not just process environment.
    try:
        from hermes_constants import get_hermes_home
    except ImportError:
        # Standalone API tests; a real gateway supplies hermes_constants.
        return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")).expanduser()
    return Path(get_hermes_home())


def _db_path() -> Path:
    path = _hermes_home() / "plugin-data" / _LEGACY_DB_NAME
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(_db_path(), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 10000")
    connection.execute("PRAGMA journal_mode = WAL")
    # Keep the legacy filename: changing the public plugin slug must not orphan data.
    connection.execute("BEGIN IMMEDIATE")
    fresh = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='identities'"
    ).fetchone() is None
    connection.execute(
        """CREATE TABLE IF NOT EXISTS identities (
            id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )"""
    )
    connection.execute(
        """CREATE TABLE IF NOT EXISTS devices (
            id TEXT PRIMARY KEY,
            default_identity_id TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(default_identity_id) REFERENCES identities(id)
        )"""
    )
    if fresh:
        connection.execute(
            "INSERT INTO identities (id, display_name) VALUES (?, ?)",
            ("person:user", "User"),
        )
    connection.commit()
    return connection


def _valid_id(value: Any, field: str) -> str:
    if not isinstance(value, str) or not _ID_RE.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"invalid {field}")
    return value


def _identity(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "display_name": row["display_name"],
        "enabled": bool(row["enabled"]),
    }


@router.get("/state")
def state(device_id: str | None = None) -> dict[str, Any]:
    """Return the shared roster and this device's optional default."""
    with closing(_connect()) as connection:
        identities = [
            _identity(row)
            for row in connection.execute(
                "SELECT id, display_name, enabled FROM identities "
                "WHERE enabled = 1 ORDER BY display_name COLLATE NOCASE"
            )
        ]
        default_identity_id = None
        if device_id:
            device_id = _valid_id(device_id, "device_id")
            row = connection.execute(
                "SELECT d.default_identity_id FROM devices d "
                "JOIN identities i ON i.id = d.default_identity_id "
                "WHERE d.id = ? AND i.enabled = 1",
                (device_id,),
            ).fetchone()
            default_identity_id = row["default_identity_id"] if row else None
    return {"identities": identities, "default_identity_id": default_identity_id}


@router.put("/identities/{identity_id}")
def upsert_identity(identity_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """Create or rename an identity in the shared roster."""
    identity_id = _valid_id(identity_id, "identity_id")
    display_name = body.get("display_name")
    if (not isinstance(display_name, str) or not display_name.strip()
            or len(display_name) > 80 or re.search(r"[\x00-\x1f\x7f\[\]]", display_name)):
        raise HTTPException(status_code=400, detail="display_name must be 1-80 characters without brackets or control characters")
    display_name = display_name.strip()

    with closing(_connect()) as connection:
        connection.execute(
            """
            INSERT INTO identities (id, display_name)
            VALUES (?, ?)
            ON CONFLICT(id) DO UPDATE SET
                display_name = excluded.display_name,
                updated_at = CURRENT_TIMESTAMP
            """,
            (identity_id, display_name),
        )
        connection.commit()
        row = connection.execute(
            "SELECT id, display_name, enabled FROM identities WHERE id = ?",
            (identity_id,),
        ).fetchone()
    return _identity(row)


@router.put("/devices/{device_id}")
def set_device_default(device_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """Set the default identity for one Desktop installation."""
    device_id = _valid_id(device_id, "device_id")
    identity_id = _valid_id(body.get("default_identity_id"), "default_identity_id")

    with closing(_connect()) as connection:
        if not connection.execute(
            "SELECT 1 FROM identities WHERE id = ? AND enabled = 1", (identity_id,)
        ).fetchone():
            raise HTTPException(status_code=404, detail="identity not found")
        connection.execute(
            """
            INSERT INTO devices (id, default_identity_id)
            VALUES (?, ?)
            ON CONFLICT(id) DO UPDATE SET
                default_identity_id = excluded.default_identity_id,
                updated_at = CURRENT_TIMESTAMP
            """,
            (device_id, identity_id),
        )
        connection.commit()
    return {"device_id": device_id, "default_identity_id": identity_id}
