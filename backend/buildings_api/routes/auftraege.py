"""Aufträge: Liste/Board, Details, Anlegen, Bearbeiten, Status und Auftragsaufgaben."""
import re

from flask import Blueprint, abort, g, request

from ..auth import has_full_access, login_required
from ..db import get_db, row, rows

bp = Blueprint("auftraege", __name__)

AUFGABE_STATUS = ("offen", "in arbeit", "erledigt")

WARTUNG_STATS_SQL = """
    (SELECT COUNT(*) FROM wartungsaufgaben w WHERE w.auftrag_id=a.ATID) AS wartung_gesamt,
    (SELECT COUNT(*) FROM wartungsaufgaben w WHERE w.auftrag_id=a.ATID
        AND LOWER(TRIM(COALESCE(w.status,'')))='erledigt') AS wartung_erledigt,
    (SELECT COUNT(*) FROM wartungsaufgaben w WHERE w.auftrag_id=a.ATID
        AND LOWER(TRIM(COALESCE(w.status,'')))='erledigt' AND LOWER(COALESCE(w.ergebnis,''))='gut') AS wartung_gut,
    (SELECT COUNT(*) FROM wartungsaufgaben w WHERE w.auftrag_id=a.ATID
        AND LOWER(TRIM(COALESCE(w.status,'')))='erledigt' AND LOWER(COALESCE(w.ergebnis,''))='achtung') AS wartung_achtung,
    (SELECT COUNT(*) FROM wartungsaufgaben w WHERE w.auftrag_id=a.ATID
        AND LOWER(TRIM(COALESCE(w.status,'')))='erledigt' AND LOWER(COALESCE(w.ergebnis,''))='schlecht') AS wartung_schlecht
"""

LISTE_SQL = f"""
    SELECT a.ATID AS id, a.ATName AS name, a.ATBeschreibung AS beschreibung,
           a.ATStatus AS status_id, st.SAName AS status, a.ATTyp AS typ_id, ta.TAName AS typ,
           s.KSID AS system_id, s.KSKunde AS kunde, s.KSName AS system, s.KSNiederlassung AS niederlassung_id,
           a.ATVerantwortlicherTechniker AS techniker_id,
           TRIM(COALESCE(m.TCVorname,'') || ' ' || COALESCE(m.TCNachname,'')) AS techniker,
           COALESCE(NULLIF(a.ATFarbe,''), ta.TAPlanungsfarbe, '#16a34a') AS farbe,
           a.ATPlanTage AS plan_tage, a.ATPlanStunden AS plan_stunden,
           COALESCE(a.web_geaendert_am, a.web_erstellt_am) AS geaendert_am,
           COALESCE(a.wartung_status, 'geplant') AS wartung_status,
           {WARTUNG_STATS_SQL}
    FROM "tblAufTräge" a
    LEFT JOIN "tbKundenSysteme" s ON s.KSID=a.ATKS
    LEFT JOIN "tblStatusAufträge" st ON st.SAID=a.ATStatus
    LEFT JOIN "tblTypenAufträge" ta ON ta.TAID=a.ATTyp
    LEFT JOIN "tblMitarbeiter" m ON m.TCID=a.ATVerantwortlicherTechniker
"""


def _voll():
    if not has_full_access():
        abort(403, description="Aufträge dürfen nur Administratoren und Dispatcher ändern.")


@bp.get("/auftraege")
@login_required
def liste():
    bedingungen, params = [], []
    q = str(request.args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        bedingungen.append(
            "(a.ATName LIKE ? OR a.ATBeschreibung LIKE ? OR s.KSKunde LIKE ? OR s.KSName LIKE ? "
            "OR (COALESCE(m.TCVorname,'') || ' ' || COALESCE(m.TCNachname,'')) LIKE ?)"
        )
        params += [like] * 5
    for arg, spalte in (("typ_id", "a.ATTyp"), ("niederlassung_id", "s.KSNiederlassung"), ("techniker_id", "a.ATVerantwortlicherTechniker")):
        value = request.args.get(arg)
        if value:
            try:
                params.append(int(value))
            except ValueError:
                abort(400)
            bedingungen.append(f"{spalte}=?")
    if request.args.get("nur_meine") in ("1", "true"):
        bedingungen.append("a.ATVerantwortlicherTechniker=?")
        params.append(g.user["TCID"])
    if request.args.get("storniert") not in ("1", "true"):
        bedingungen.append("LOWER(COALESCE(st.SAName,'')) <> 'storniert'")
    where = f" WHERE {' AND '.join(bedingungen)}" if bedingungen else ""
    return {
        "ok": True,
        "auftraege": rows(get_db().execute(LISTE_SQL + where + " ORDER BY geaendert_am DESC, a.ATID DESC", params)),
    }


@bp.get("/auftraege/stammdaten")
@login_required
def stammdaten():
    db = get_db()
    return {
        "ok": True,
        "darf_bearbeiten": has_full_access(),
        "status": rows(db.execute('SELECT SAID AS id, SAName AS name FROM "tblStatusAufträge" ORDER BY SAID')),
        "typen": rows(
            db.execute(
                'SELECT MIN(TAID) AS id, TAName AS name, TAPlanungsfarbe AS farbe FROM "tblTypenAufträge" '
                "GROUP BY TAName ORDER BY MIN(TAID)"
            )
        ),
        "niederlassungen": rows(db.execute("SELECT NLID AS id, NLName AS name FROM tblNiederlassungen ORDER BY NLName")),
        "techniker": rows(
            db.execute(
                """SELECT TCID AS id, TRIM(COALESCE(TCVorname,'') || ' ' || COALESCE(TCNachname,'')) AS name
                   FROM "tblMitarbeiter" WHERE COALESCE(TCAktiv,1)<>0 ORDER BY TCNachname COLLATE NOCASE, TCVorname"""
            )
        ),
        "systeme": rows(
            db.execute(
                """SELECT KSID AS id, KSKunde AS kunde, KSName AS name FROM "tbKundenSysteme"
                   ORDER BY KSKunde COLLATE NOCASE, KSName COLLATE NOCASE"""
            )
        ),
    }


def _detail(db, auftrag_id: int) -> dict:
    a = row(db.execute(LISTE_SQL + " WHERE a.ATID=?", (auftrag_id,)))
    if a is None:
        abort(404, description="Der Auftrag wurde nicht gefunden.")
    return a


@bp.get("/auftraege/<int:auftrag_id>")
@login_required
def detail(auftrag_id: int):
    db = get_db()
    a = _detail(db, auftrag_id)
    return {
        "ok": True,
        "darf_bearbeiten": has_full_access(),
        "auftrag": a,
        "aufgaben": rows(
            db.execute(
                """SELECT t.auftragsaufgabe_id AS id, t.titel, t.beschreibung, t.status, t.ergebnis, t.mitarbeiter_id,
                          TRIM(COALESCE(m.TCVorname,'') || ' ' || COALESCE(m.TCNachname,'')) AS mitarbeiter
                   FROM auftragsaufgaben t LEFT JOIN "tblMitarbeiter" m ON m.TCID=t.mitarbeiter_id
                   WHERE t.auftrag_id=?
                   ORDER BY CASE LOWER(COALESCE(t.status,'')) WHEN 'in arbeit' THEN 1 WHEN 'offen' THEN 2
                            WHEN 'erledigt' THEN 3 ELSE 4 END, t.auftragsaufgabe_id DESC""",
                (auftrag_id,),
            )
        ),
        "planung": rows(
            db.execute(
                """SELECT p.planung_id AS id, p.start_datum, p.ende_datum, p.mitarbeiter_id,
                          TRIM(COALESCE(m.TCVorname,'') || ' ' || COALESCE(m.TCNachname,'')) AS mitarbeiter
                   FROM mitarbeiter_planung p JOIN "tblMitarbeiter" m ON m.TCID=p.mitarbeiter_id
                   WHERE p.auftrag_id=? ORDER BY p.start_datum DESC""",
                (auftrag_id,),
            )
        ),
        "ansprechpartner": rows(
            db.execute(
                """SELECT APID AS id, APVorname AS vorname, APNachname AS nachname, APFunktion AS funktion,
                          APTelefon AS telefon, APMobiltelefon AS mobil, APEmail AS email
                   FROM tblAnsprechpartner WHERE APKS=? ORDER BY APNachname COLLATE NOCASE""",
                (a["system_id"],),
            )
        ),
    }


def _werte(data: dict, db, bestehend: dict | None = None) -> dict:
    """Prüft die Formularwerte eines Auftrags und liefert die Spaltenwerte."""
    def zahl(key, erlaubt_leer=True):
        value = data.get(key, None if bestehend is None else bestehend.get(key))
        if value in (None, ""):
            if erlaubt_leer:
                return None
            abort(400, description="Pflichtfeld fehlt.")
        try:
            return int(value)
        except (TypeError, ValueError):
            abort(400, description="Ungültige Zahl.")

    name = str(data.get("name", (bestehend or {}).get("name") or "")).strip()
    if not name:
        abort(400, description="Bitte einen Namen für den Auftrag eingeben.")
    system_id = zahl("system_id", erlaubt_leer=False)
    if not db.execute('SELECT 1 FROM "tbKundenSysteme" WHERE KSID=?', (system_id,)).fetchone():
        abort(400, description="Das Kundensystem wurde nicht gefunden.")
    farbe = str(data.get("farbe") or "").strip().lower() or None
    if farbe and not re.fullmatch(r"#[0-9a-f]{6}", farbe):
        abort(400, description="Die Farbe muss als #rrggbb angegeben werden.")
    werte = {
        "ATName": name[:200],
        "ATBeschreibung": str(data.get("beschreibung", (bestehend or {}).get("beschreibung") or "")).strip() or None,
        "ATKS": system_id,
        "ATTyp": zahl("typ_id"),
        "ATStatus": zahl("status_id"),
        "ATVerantwortlicherTechniker": zahl("techniker_id"),
        "ATPlanTage": zahl("plan_tage"),
        "ATPlanStunden": zahl("plan_stunden"),
        "ATFarbe": farbe,
    }
    if bestehend is not None and "farbe" not in data:
        del werte["ATFarbe"]
    elif farbe is None:
        typ = db.execute('SELECT TAPlanungsfarbe FROM "tblTypenAufträge" WHERE TAID=?', (werte["ATTyp"],)).fetchone()
        werte["ATFarbe"] = (typ["TAPlanungsfarbe"] if typ else None) or "#16a34a"
    return werte


@bp.post("/auftraege")
@login_required
def anlegen():
    _voll()
    db = get_db()
    werte = _werte(request.get_json(silent=True) or {}, db)
    spalten = ", ".join(f'"{k}"' for k in werte)
    cur = db.execute(
        f'INSERT INTO "tblAufTräge" ({spalten}) VALUES ({", ".join("?" for _ in werte)})', list(werte.values())
    )
    db.commit()
    return {"ok": True, "auftrag": _detail(db, cur.lastrowid)}


@bp.put("/auftraege/<int:auftrag_id>")
@login_required
def bearbeiten(auftrag_id: int):
    _voll()
    db = get_db()
    werte = _werte(request.get_json(silent=True) or {}, db, _detail(db, auftrag_id))
    db.execute(
        f'UPDATE "tblAufTräge" SET {", ".join(f"{k}=?" for k in werte)} WHERE ATID=?',
        [*werte.values(), auftrag_id],
    )
    db.commit()
    return {"ok": True, "auftrag": _detail(db, auftrag_id)}


@bp.patch("/auftraege/<int:auftrag_id>/status")
@login_required
def status_setzen(auftrag_id: int):
    _voll()
    db = get_db()
    _detail(db, auftrag_id)
    status_id = (request.get_json(silent=True) or {}).get("status_id")
    if status_id is not None and not db.execute('SELECT 1 FROM "tblStatusAufträge" WHERE SAID=?', (status_id,)).fetchone():
        abort(400, description="Unbekannter Status.")
    db.execute('UPDATE "tblAufTräge" SET ATStatus=? WHERE ATID=?', (status_id, auftrag_id))
    db.commit()
    return {"ok": True, "auftrag": _detail(db, auftrag_id)}


# ---------- Auftragsaufgaben ----------

def _aufgabe_darf(aufgabe_mitarbeiter_id) -> bool:
    return has_full_access() or aufgabe_mitarbeiter_id == g.user["TCID"]


@bp.post("/auftraege/<int:auftrag_id>/aufgaben")
@login_required
def aufgabe_anlegen(auftrag_id: int):
    db = get_db()
    _detail(db, auftrag_id)
    data = request.get_json(silent=True) or {}
    titel = str(data.get("titel") or "").strip()
    if not titel:
        abort(400, description="Bitte einen Titel eingeben.")
    mitarbeiter_id = data.get("mitarbeiter_id") if has_full_access() else g.user["TCID"]
    status = data.get("status") if data.get("status") in AUFGABE_STATUS else "offen"
    cur = db.execute(
        "INSERT INTO auftragsaufgaben (auftrag_id, titel, beschreibung, mitarbeiter_id, status) VALUES (?, ?, ?, ?, ?)",
        (auftrag_id, titel[:200], str(data.get("beschreibung") or "").strip() or None, mitarbeiter_id or None, status),
    )
    db.commit()
    return {"ok": True, "id": cur.lastrowid}


@bp.patch("/aufgaben/<int:aufgabe_id>")
@login_required
def aufgabe_aendern(aufgabe_id: int):
    db = get_db()
    a = row(db.execute("SELECT * FROM auftragsaufgaben WHERE auftragsaufgabe_id=?", (aufgabe_id,)))
    if a is None:
        abort(404)
    if not _aufgabe_darf(a["mitarbeiter_id"]):
        abort(403, description="Du darfst nur deine eigenen Aufgaben ändern.")
    data = request.get_json(silent=True) or {}
    status = data.get("status", a["status"])
    if status not in AUFGABE_STATUS:
        abort(400, description="Ungültiger Status.")
    titel = str(data.get("titel", a["titel"]) or "").strip()
    if not titel:
        abort(400, description="Bitte einen Titel eingeben.")
    mitarbeiter_id = data.get("mitarbeiter_id", a["mitarbeiter_id"]) if has_full_access() else a["mitarbeiter_id"]
    db.execute(
        "UPDATE auftragsaufgaben SET titel=?, beschreibung=?, status=?, ergebnis=?, mitarbeiter_id=? WHERE auftragsaufgabe_id=?",
        (
            titel[:200],
            str(data.get("beschreibung", a["beschreibung"]) or "").strip() or None,
            status,
            str(data.get("ergebnis", a["ergebnis"]) or "").strip() or None,
            mitarbeiter_id or None,
            aufgabe_id,
        ),
    )
    db.commit()
    return {"ok": True}


@bp.delete("/aufgaben/<int:aufgabe_id>")
@login_required
def aufgabe_loeschen(aufgabe_id: int):
    db = get_db()
    a = db.execute("SELECT mitarbeiter_id FROM auftragsaufgaben WHERE auftragsaufgabe_id=?", (aufgabe_id,)).fetchone()
    if a is None:
        abort(404)
    if not _aufgabe_darf(a["mitarbeiter_id"]):
        abort(403, description="Du darfst nur deine eigenen Aufgaben löschen.")
    db.execute("DELETE FROM auftragsaufgaben WHERE auftragsaufgabe_id=?", (aufgabe_id,))
    db.commit()
    return {"ok": True}
