"""Angemeldeter Benutzer, Rollen und Berechtigungs-Decorator."""
from functools import wraps

from flask import abort, g, session

from .db import get_db

ROLES = {"admin", "dispatcher", "mitarbeiter"}


def load_user():
    g.user = None
    tcid = session.get("user_id")
    if not tcid:
        return
    user = get_db().execute(
        'SELECT * FROM "tblMitarbeiter" WHERE TCID=? AND COALESCE(TCAktiv,1)<>0', (tcid,)
    ).fetchone()
    if user is None:
        session.clear()
        return
    g.user = user


def role(user=None) -> str:
    user = user if user is not None else g.get("user")
    if user is None:
        return ""
    value = str(user["TCRolle"] or "mitarbeiter").strip().lower()
    return value if value in ROLES else "mitarbeiter"


def has_full_access() -> bool:
    """Admins und Dispatcher dürfen operative Daten aller Mitarbeiter ändern."""
    return role() in {"admin", "dispatcher"}


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if g.get("user") is None:
            abort(401)
        if g.user["TCMussPasswortAendern"]:
            abort(403, description="Bitte zuerst das Passwort ändern.")
        return fn(*args, **kwargs)
    return wrapper
