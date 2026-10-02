"""SQLite-Zugriff.

Die Datenbank enthält Audit-Trigger, die die SQL-Funktionen audit_user() und
audit_now() aufrufen. Beide werden deshalb auf jeder Verbindung registriert.
"""
import sqlite3
from datetime import datetime

from flask import current_app, g, has_request_context


def audit_user() -> str:
    if has_request_context():
        user = g.get("user")
        if user is not None:
            name = " ".join(
                str(user[k] or "").strip() for k in ("TCVorname", "TCNachname")
            ).strip()
            return name or str(user["TCBenutzername"] or "") or f"Mitarbeiter {user['TCID']}"
    return "System"


def audit_now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def connect(path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.create_function("audit_user", 0, audit_user)
    conn.create_function("audit_now", 0, audit_now)
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def get_db() -> sqlite3.Connection:
    if "db" not in g:
        g.db = connect(current_app.config["SETTINGS"].database_path)
    return g.db


def close_db(_exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def rows(cursor) -> list[dict]:
    return [dict(r) for r in cursor.fetchall()]


def row(cursor):
    r = cursor.fetchone()
    return dict(r) if r is not None else None
