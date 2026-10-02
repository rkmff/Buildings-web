"""Anmeldung, Abmeldung und Passwortwechsel."""
from flask import Blueprint, abort, g, request, session

from ..auth import role
from ..db import audit_now, get_db
from ..security import make_password_hash, verify_password
from .me import einstellungen_lesen

bp = Blueprint("auth", __name__)


def user_json(user) -> dict:
    return {
        "id": user["TCID"],
        "vorname": user["TCVorname"] or "",
        "nachname": user["TCNachname"] or "",
        "benutzername": user["TCBenutzername"] or "",
        "funktion": user["TCFunktion"] or "",
        "rolle": role(user),
        "niederlassung_id": user["TCNiederlassung"],
        "muss_passwort_aendern": bool(user["TCMussPasswortAendern"]),
        "einstellungen": einstellungen_lesen(user),
    }


@bp.post("/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    benutzername = str(data.get("benutzername") or "").strip()
    passwort = str(data.get("passwort") or "")
    db = get_db()
    user = db.execute(
        'SELECT * FROM "tblMitarbeiter" WHERE LOWER(TCBenutzername)=LOWER(?) AND COALESCE(TCAktiv,1)<>0',
        (benutzername,),
    ).fetchone()
    if not benutzername or user is None or not verify_password(passwort, user["TCPasswortHash"]):
        return {"ok": False, "message": "Benutzername oder Passwort ist falsch."}, 401
    session.clear()
    session.permanent = True
    session["user_id"] = user["TCID"]
    g.user = user
    db.execute('UPDATE "tblMitarbeiter" SET TCLetzterLogin=? WHERE TCID=?', (audit_now(), user["TCID"]))
    db.commit()
    return {"ok": True, "user": user_json(user)}


@bp.post("/auth/logout")
def logout():
    session.clear()
    return {"ok": True}


@bp.get("/auth/me")
def me():
    if g.user is None:
        abort(401)
    return {"ok": True, "user": user_json(g.user)}


@bp.post("/auth/passwort")
def passwort_aendern():
    if g.user is None:
        abort(401)
    data = request.get_json(silent=True) or {}
    alt = str(data.get("alt") or "")
    neu = str(data.get("neu") or "")
    if not verify_password(alt, g.user["TCPasswortHash"]):
        return {"ok": False, "message": "Das bisherige Passwort ist falsch."}, 400
    if len(neu) < 8:
        return {"ok": False, "message": "Das neue Passwort muss mindestens 8 Zeichen haben."}, 400
    db = get_db()
    db.execute(
        'UPDATE "tblMitarbeiter" SET TCPasswortHash=?, TCMussPasswortAendern=0 WHERE TCID=?',
        (make_password_hash(neu), g.user["TCID"]),
    )
    db.commit()
    user = db.execute('SELECT * FROM "tblMitarbeiter" WHERE TCID=?', (g.user["TCID"],)).fetchone()
    return {"ok": True, "user": user_json(user)}
