"""Aufträge: Liste/Board, Details, Anlegen, Bearbeiten, Status und Auftragsaufgaben."""
import re

from flask import Blueprint, abort, g, request

from ..auth import has_full_access, login_required
from ..db import get_db, row, rows

bp = Blueprint("auftraege", __name__)

AUFGABE_STATUS = ("offen", "in arbeit", "erledigt")

# Standard-Fortschritt, wenn ein Auftrag auf „in Arbeit“ wechselt und noch keinen hat
FORTSCHRITT_IN_ARBEIT = 10

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
           a.ATSalesforce AS link_salesforce, a.ATDokumente AS link_dokumente,
           COALESCE(a.ATFortschritt, 0) AS fortschritt,
           (SELECT GROUP_CONCAT(mv.mitarbeiter_id) FROM auftrag_mitverantwortliche mv WHERE mv.auftrag_id=a.ATID)
               AS mitverantwortliche_ids,
           (SELECT GROUP_CONCAT(TRIM(COALESCE(x.TCVorname,'') || ' ' || COALESCE(x.TCNachname,'')), ', ')
              FROM auftrag_mitverantwortliche mv JOIN "tblMitarbeiter" x ON x.TCID=mv.mitarbeiter_id
             WHERE mv.auftrag_id=a.ATID) AS mitverantwortliche,
           {WARTUNG_STATS_SQL}
    FROM "tblAufTräge" a
    LEFT JOIN "tbKundenSysteme" s ON s.KSID=a.ATKS
    LEFT JOIN "tblStatusAufträge" st ON st.SAID=a.ATStatus
    LEFT JOIN "tblTypenAufträge" ta ON ta.TAID=a.ATTyp
    LEFT JOIN "tblMitarbeiter" m ON m.TCID=a.ATVerantwortlicherTechniker
"""


def _ist_wartung(a: dict) -> bool:
    return str(a.get("typ") or "").strip().lower() == "wartung" or bool(a.get("wartung_gesamt"))


def _mit_listen(a: dict | None) -> dict | None:
    """mitverantwortliche_ids als Zahlenliste."""
    if a is not None:
        a["mitverantwortliche_ids"] = [int(x) for x in str(a.get("mitverantwortliche_ids") or "").split(",") if x]
    return a


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
        bedingungen.append(
            "(a.ATVerantwortlicherTechniker=? OR EXISTS (SELECT 1 FROM auftrag_mitverantwortliche mv "
            "WHERE mv.auftrag_id=a.ATID AND mv.mitarbeiter_id=?))"
        )
        params += [g.user["TCID"], g.user["TCID"]]
    if request.args.get("storniert") not in ("1", "true"):
        bedingungen.append("LOWER(COALESCE(st.SAName,'')) <> 'storniert'")
    where = f" WHERE {' AND '.join(bedingungen)}" if bedingungen else ""
    return {
        "ok": True,
        "auftraege": [_mit_listen(a) for a in rows(get_db().execute(LISTE_SQL + where + " ORDER BY geaendert_am DESC, a.ATID DESC", params))],
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
    a = _mit_listen(row(db.execute(LISTE_SQL + " WHERE a.ATID=?", (auftrag_id,))))
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
                   ORDER BY CASE WHEN LOWER(COALESCE(t.status,''))='erledigt' THEN 1 ELSE 0 END,
                            COALESCE(t.web_geaendert_am, t.web_erstellt_am) DESC, t.auftragsaufgabe_id DESC""",
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
        "anzahl": {
            "fotos": db.execute("SELECT COUNT(*) FROM web_fotos WHERE auftrag_id=? AND wartungsaufgabe_id IS NULL",
                                (auftrag_id,)).fetchone()[0],
            "dokumente": db.execute("SELECT COUNT(*) FROM web_attachments WHERE parent_table='tblAufTräge' AND parent_pk=?",
                                    (auftrag_id,)).fetchone()[0],
        },
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
    for key, tabelle, spalte in (("status_id", "tblStatusAufträge", "SAID"), ("typ_id", "tblTypenAufträge", "TAID"),
                                 ("techniker_id", "tblMitarbeiter", "TCID")):
        v = zahl(key)
        if v is not None and not db.execute(f'SELECT 1 FROM "{tabelle}" WHERE "{spalte}"=?', (v,)).fetchone():
            abort(400, description="Ungültige Auswahl.")
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
    for key, spalte in (("link_salesforce", "ATSalesforce"), ("link_dokumente", "ATDokumente")):
        if key in data or bestehend is None:
            werte[spalte] = _link(data.get(key))
    if bestehend is not None and "farbe" not in data:
        del werte["ATFarbe"]
    elif farbe is None:
        typ = db.execute('SELECT TAPlanungsfarbe FROM "tblTypenAufträge" WHERE TAID=?', (werte["ATTyp"],)).fetchone()
        werte["ATFarbe"] = (typ["TAPlanungsfarbe"] if typ else None) or "#16a34a"
    return werte


def _link(value) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if not re.match(r"^(https?://|file:|\\\\)", text, re.I):
        abort(400, description="Ein Link muss mit http://, https:// oder \\\\server beginnen.")
    return text[:2000]


def _mitverantwortliche_setzen(db, auftrag_id: int, data: dict, haupt):
    if "mitverantwortliche_ids" not in data:
        return
    ids = {int(x) for x in data.get("mitverantwortliche_ids") or [] if str(x).isdigit()}
    ids.discard(int(haupt or 0))
    db.execute("DELETE FROM auftrag_mitverantwortliche WHERE auftrag_id=?", (auftrag_id,))
    for mid in ids:
        if db.execute('SELECT 1 FROM "tblMitarbeiter" WHERE TCID=?', (mid,)).fetchone():
            db.execute("INSERT INTO auftrag_mitverantwortliche (auftrag_id, mitarbeiter_id) VALUES (?, ?)", (auftrag_id, mid))


def _fortschritt_bei_status(db, auftrag_id: int):
    """Wechselt ein Auftrag (außer Wartung) auf „in Arbeit“ und hat noch keinen Fortschritt, gilt er als zu 10 % erledigt."""
    a = _detail(db, auftrag_id)
    if str(a["status"] or "").strip().lower() == "in arbeit" and not a["fortschritt"] and not _ist_wartung(a):
        db.execute('UPDATE "tblAufTräge" SET ATFortschritt=? WHERE ATID=?', (FORTSCHRITT_IN_ARBEIT, auftrag_id))


@bp.post("/auftraege")
@login_required
def anlegen():
    _voll()
    db = get_db()
    werte = _werte(request.get_json(silent=True) or {}, db)
    spalten = ", ".join(f'"{k}"' for k in werte)
    data = request.get_json(silent=True) or {}
    cur = db.execute(
        f'INSERT INTO "tblAufTräge" ({spalten}) VALUES ({", ".join("?" for _ in werte)})', list(werte.values())
    )
    _mitverantwortliche_setzen(db, cur.lastrowid, data, werte["ATVerantwortlicherTechniker"])
    _fortschritt_bei_status(db, cur.lastrowid)
    db.commit()
    return {"ok": True, "auftrag": _detail(db, cur.lastrowid)}


@bp.put("/auftraege/<int:auftrag_id>")
@login_required
def bearbeiten(auftrag_id: int):
    _voll()
    db = get_db()
    data = request.get_json(silent=True) or {}
    werte = _werte(data, db, _detail(db, auftrag_id))
    db.execute(
        f'UPDATE "tblAufTräge" SET {", ".join(f"{k}=?" for k in werte)} WHERE ATID=?',
        [*werte.values(), auftrag_id],
    )
    _mitverantwortliche_setzen(db, auftrag_id, data, werte["ATVerantwortlicherTechniker"])
    _fortschritt_bei_status(db, auftrag_id)
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
    _fortschritt_bei_status(db, auftrag_id)
    db.commit()
    return {"ok": True, "auftrag": _detail(db, auftrag_id)}


@bp.patch("/auftraege/<int:auftrag_id>/felder")
@login_required
def felder_setzen(auftrag_id: int):
    """Fortschritt und Links dürfen alle angemeldeten Mitarbeiter setzen, auch Techniker."""
    db = get_db()
    a = _detail(db, auftrag_id)
    data = request.get_json(silent=True) or {}
    werte = {}
    if "fortschritt" in data:
        if _ist_wartung(a):
            abort(400, description="Bei Wartungen ergibt sich der Fortschritt aus den Wartungsaufgaben.")
        try:
            werte["ATFortschritt"] = max(0, min(100, int(data["fortschritt"])))
        except (TypeError, ValueError):
            abort(400, description="Der Fortschritt muss eine Zahl zwischen 0 und 100 sein.")
    for key, spalte in (("link_salesforce", "ATSalesforce"), ("link_dokumente", "ATDokumente")):
        if key in data:
            werte[spalte] = _link(data[key])
    if werte:
        db.execute(f'UPDATE "tblAufTräge" SET {", ".join(f"{k}=?" for k in werte)} WHERE ATID=?', [*werte.values(), auftrag_id])
        db.commit()
    return {"ok": True, "auftrag": _detail(db, auftrag_id)}


# ---------- Auftragsaufgaben ----------

def _aufgabe_darf(aufgabe_mitarbeiter_id) -> bool:
    return has_full_access() or aufgabe_mitarbeiter_id == g.user["TCID"]


@bp.post("/auftraege/<int:auftrag_id>/aufgaben")
@login_required
def aufgabe_anlegen(auftrag_id: int):
    db = get_db()
    a = _detail(db, auftrag_id)
    data = request.get_json(silent=True) or {}
    titel = str(data.get("titel") or "").strip()
    if not titel:
        abort(400, description="Bitte einen Titel eingeben.")
    mitarbeiter_id = data.get("mitarbeiter_id") if has_full_access() else g.user["TCID"]
    status = data.get("status") if data.get("status") in AUFGABE_STATUS else "offen"
    cur = db.execute(
        """INSERT INTO auftragsaufgaben (auftrag_id, kunden_system_id, titel, beschreibung, mitarbeiter_id, status)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (auftrag_id, a["system_id"], titel[:200], str(data.get("beschreibung") or "").strip() or None,
         mitarbeiter_id or None, status),
    )
    db.commit()
    return {"ok": True, "id": cur.lastrowid}


AUFGABE_SQL = """
    SELECT t.auftragsaufgabe_id AS id, t.titel, t.beschreibung, t.status, t.ergebnis, t.mitarbeiter_id,
           TRIM(COALESCE(m.TCVorname,'') || ' ' || COALESCE(m.TCNachname,'')) AS mitarbeiter,
           t.auftrag_id, a.ATName AS auftrag, COALESCE(t.kunden_system_id, a.ATKS) AS system_id,
           s.KSKunde AS kunde, s.KSName AS system,
           t.web_erstellt_am AS erstellt_am, t.web_erstellt_von AS erstellt_von,
           t.web_geaendert_am AS geaendert_am, t.web_geaendert_von AS geaendert_von
    FROM auftragsaufgaben t
    LEFT JOIN "tblMitarbeiter" m ON m.TCID=t.mitarbeiter_id
    LEFT JOIN "tblAufTräge" a ON a.ATID=t.auftrag_id
    LEFT JOIN "tbKundenSysteme" s ON s.KSID=COALESCE(t.kunden_system_id, a.ATKS)
"""


def _bezug(db, data: dict, alt: dict | None = None) -> tuple:
    """Auftrag und/oder Kundensystem einer Aufgabe. Ein Auftrag bestimmt das System mit."""
    def zahl(key):
        v = data.get(key, (alt or {}).get(key))
        try:
            return int(v) if v not in (None, "", 0, "0") else None
        except (TypeError, ValueError):
            abort(400, description="Ungültige Zuordnung.")
    auftrag_id, system_id = zahl("auftrag_id"), zahl("system_id")
    if auftrag_id:
        a = db.execute('SELECT ATKS FROM "tblAufTräge" WHERE ATID=?', (auftrag_id,)).fetchone()
        if a is None:
            abort(400, description="Der Auftrag wurde nicht gefunden.")
        system_id = a["ATKS"]
    elif system_id and not db.execute('SELECT 1 FROM "tbKundenSysteme" WHERE KSID=?', (system_id,)).fetchone():
        abort(400, description="Das Kundensystem wurde nicht gefunden.")
    return auftrag_id, system_id


@bp.get("/aufgaben/<int:aufgabe_id>")
@login_required
def aufgabe_detail(aufgabe_id: int):
    db = get_db()
    t = row(db.execute(AUFGABE_SQL + " WHERE t.auftragsaufgabe_id=?", (aufgabe_id,)))
    if t is None:
        abort(404, description="Die Aufgabe wurde nicht gefunden.")
    return {"ok": True, "aufgabe": t, "darf_bearbeiten": _aufgabe_darf(t["mitarbeiter_id"]),
            "darf_zuweisen": has_full_access()}


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
    auftrag_id, system_id = _bezug(db, data, {"auftrag_id": a["auftrag_id"], "system_id": a["kunden_system_id"]})
    db.execute(
        """UPDATE auftragsaufgaben SET titel=?, beschreibung=?, status=?, ergebnis=?, mitarbeiter_id=?,
                  auftrag_id=?, kunden_system_id=? WHERE auftragsaufgabe_id=?""",
        (
            titel[:200],
            str(data.get("beschreibung", a["beschreibung"]) or "").strip() or None,
            status,
            str(data.get("ergebnis", a["ergebnis"]) or "").strip() or None,
            mitarbeiter_id or None,
            auftrag_id,
            system_id,
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
