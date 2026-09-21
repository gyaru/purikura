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

from fastapi import APIRouter, HTTPException

router = APIRouter()

_PLUGIN_ID = "speaker-identity"
_ID_RE = re.compile(r"^[a-z][a-z0-9_:-]{0,63}$")
_DEFAULT_IDENTITIES = (
    ("person:user", "User"),
)


def _hermes_home() -> Path:
    return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")).expanduser()


def _db_path() -> Path:
    path = _hermes_home() / "plugin-data" / f"{_PLUGIN_ID}.sqlite3"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(_db_path(), timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA busy_timeout = 10000")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS identities (
            id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS devices (
            id TEXT PRIMARY KEY,
            default_identity_id TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(default_identity_id) REFERENCES identities(id)
        );
        """
    )
    for identity_id, display_name in _DEFAULT_IDENTITIES:
        connection.execute(
            """
            INSERT INTO identities (id, display_name)
            VALUES (?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            (identity_id, display_name),
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
                "SELECT default_identity_id FROM devices WHERE id = ?",
                (device_id,),
            ).fetchone()
            default_identity_id = row["default_identity_id"] if row else None
    return {"identities": identities, "default_identity_id": default_identity_id}


@router.put("/identities/{identity_id}")
def upsert_identity(identity_id: str, body: dict[str, Any]) -> dict[str, Any]:
    """Create or rename an identity in the shared roster."""
    identity_id = _valid_id(identity_id, "identity_id")
    display_name = body.get("display_name")
    if not isinstance(display_name, str) or not display_name.strip() or len(display_name) > 80:
        raise HTTPException(status_code=400, detail="display_name must be 1-80 characters")
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
