"""Persönliche Daten: Einstellungen, eigene Aufgaben, Aufträge und Ausrüstung."""
import re

from flask import Blueprint, abort, g, request

from ..auth import login_required
from ..db import get_db, rows

bp = Blueprint("me", __name__)

DEFAULT_AKZENT = "#16a34a"
THEMES = {"hell", "dunkel", "system"}
WOCHEN_OPTIONEN = (1, 2, 3, 4, 5, 6, 8, 10, 12)

AKTIVER_STATUS_SQL = (
    "LOWER(TRIM(COALESCE(st.SAName,''))) NOT IN ('erledigt','abgeschlossen','storniert','storniert / erledigt')"
)


def _kv(mitarbeiter_id: int) -> dict:
    return {
        r["schluessel"]: r["wert"]
        for r in get_db().execute(
            "SELECT schluessel, wert FROM app_benutzer_einstellungen WHERE mitarbeiter_id=?", (mitarbeiter_id,)
        )
    }


def einstellungen_lesen(user) -> dict:
    theme = str(user["TCTheme"] or "hell").strip().lower()
    akzent = str(user["TCAkzentFarbe"] or "").strip().lower()
    kv = _kv(user["TCID"])
    try:
        wochen = int(kv.get("planung_wochen") or 6)
    except ValueError:
        wochen = 6
    return {
        "theme": theme if theme in THEMES else "hell",
        "akzentfarbe": akzent if re.fullmatch(r"#[0-9a-f]{6}", akzent) else DEFAULT_AKZENT,
        "planung_wochen": wochen if wochen in WOCHEN_OPTIONEN else 6,
    }


@bp.get("/me/einstellungen")
@login_required
def einstellungen_get():
    return {"ok": True, "einstellungen": einstellungen_lesen(g.user), "wochen_optionen": WOCHEN_OPTIONEN}


@bp.put("/me/einstellungen")
@login_required
def einstellungen_put():
    data = request.get_json(silent=True) or {}
    aktuell = einstellungen_lesen(g.user)
    theme = str(data.get("theme", aktuell["theme"])).strip().lower()
    akzent = str(data.get("akzentfarbe", aktuell["akzentfarbe"])).strip().lower()
    try:
        wochen = int(data.get("planung_wochen", aktuell["planung_wochen"]))
    except (TypeError, ValueError):
        wochen = 0
    if theme not in THEMES:
        return {"ok": False, "message": "Unbekannter Modus."}, 400
    if not re.fullmatch(r"#[0-9a-f]{6}", akzent):
        return {"ok": False, "message": "Die Farbe muss als #rrggbb angegeben werden."}, 400
    if wochen not in WOCHEN_OPTIONEN:
        return {"ok": False, "message": "Ungültige Anzahl Wochen."}, 400

    db = get_db()
    db.execute(
        'UPDATE "tblMitarbeiter" SET TCTheme=?, TCAkzentFarbe=? WHERE TCID=?', (theme, akzent, g.user["TCID"])
    )
    db.execute(
        """INSERT INTO app_benutzer_einstellungen (mitarbeiter_id, schluessel, wert) VALUES (?, 'planung_wochen', ?)
           ON CONFLICT(mitarbeiter_id, schluessel) DO UPDATE SET wert=excluded.wert""",
        (g.user["TCID"], str(wochen)),
    )
    db.commit()
    user = db.execute('SELECT * FROM "tblMitarbeiter" WHERE TCID=?', (g.user["TCID"],)).fetchone()
    return {"ok": True, "einstellungen": einstellungen_lesen(user)}


def meine_auftraege(db, tcid: int) -> list[dict]:
    return rows(
        db.execute(
            f"""
            SELECT a.ATID AS id, a.ATName AS name, st.SAName AS status, ta.TAName AS typ,
                   s.KSID AS system_id, s.KSKunde AS kunde, s.KSName AS system,
                   COALESCE(NULLIF(a.ATFarbe,''), ta.TAPlanungsfarbe, '#16a34a') AS farbe,
                   (SELECT COUNT(*) FROM wartungsaufgaben w WHERE w.auftrag_id=a.ATID) AS wartung_gesamt,
                   (SELECT COUNT(*) FROM wartungsaufgaben w WHERE w.auftrag_id=a.ATID
                       AND LOWER(TRIM(COALESCE(w.status,'')))='erledigt') AS wartung_erledigt
            FROM "tblAufTräge" a
            LEFT JOIN "tbKundenSysteme" s ON s.KSID=a.ATKS
            LEFT JOIN "tblStatusAufträge" st ON st.SAID=a.ATStatus
            LEFT JOIN "tblTypenAufträge" ta ON ta.TAID=a.ATTyp
            WHERE a.ATVerantwortlicherTechniker=? AND {AKTIVER_STATUS_SQL}
            ORDER BY COALESCE(a.web_geaendert_am, a.web_erstellt_am) DESC
            """,
            (tcid,),
        )
    )


@bp.get("/me/uebersicht")
@login_required
def uebersicht():
    db = get_db()
    tcid = g.user["TCID"]
    aufgaben = rows(
        db.execute(
            """
            SELECT t.auftragsaufgabe_id AS id, t.titel, t.beschreibung, t.status,
                   a.ATID AS auftrag_id, a.ATName AS auftrag
            FROM auftragsaufgaben t
            LEFT JOIN "tblAufTräge" a ON a.ATID=t.auftrag_id
            WHERE t.mitarbeiter_id=? AND LOWER(TRIM(COALESCE(t.status,'')))<>'erledigt'
            ORDER BY t.auftragsaufgabe_id DESC
            """,
            (tcid,),
        )
    )
    ausruestung = rows(
        db.execute(
            """
            SELECT u.AUID AS id, u.AUName AS name, u.AUTyp AS typ, u.AUHersteller AS hersteller,
                   u.AUNaechstePruefung AS naechste_pruefung, t.AUTName AS ausruestungstyp
            FROM tblAusruestung u
            LEFT JOIN tblAusruestungstypen t ON t.AUTID=u.AUAusruestungstyp
            WHERE u.AUMitarbeiter=? AND LOWER(COALESCE(u.AUStatus,'aktiv'))<>'ausgemustert'
            ORDER BY u.AUName COLLATE NOCASE
            """,
            (tcid,),
        )
    )
    uebergaben = rows(
        db.execute(
            """
            SELECT x.AUGID AS id, u.AUName AS name, x.AUGGestartetAm AS gestartet_am,
                   v.TCVorname || ' ' || v.TCNachname AS von
            FROM tblAusruestungUebergaben x
            JOIN tblAusruestung u ON u.AUID=x.AUGAusruestung
            LEFT JOIN "tblMitarbeiter" v ON v.TCID=x.AUGVonMitarbeiter
            WHERE x.AUGAnMitarbeiter=? AND x.AUGStatus='offen'
            """,
            (tcid,),
        )
    )
    return {
        "ok": True,
        "aufgaben": aufgaben,
        "auftraege": meine_auftraege(db, tcid),
        "ausruestung": ausruestung,
        "uebergaben": uebergaben,
    }


@bp.post("/me/aufgaben")
@login_required
def aufgabe_anlegen():
    data = request.get_json(silent=True) or {}
    titel = str(data.get("titel") or "").strip()
    if not titel:
        return {"ok": False, "message": "Bitte einen Titel eingeben."}, 400
    auftrag_id = data.get("auftrag_id") or None
    db = get_db()
    if auftrag_id is None:
        return {"ok": False, "message": "Bitte einen Auftrag wählen."}, 400
    if not db.execute('SELECT 1 FROM "tblAufTräge" WHERE ATID=?', (auftrag_id,)).fetchone():
        return {"ok": False, "message": "Der Auftrag wurde nicht gefunden."}, 404
    cur = db.execute(
        "INSERT INTO auftragsaufgaben (auftrag_id, titel, beschreibung, mitarbeiter_id, status) VALUES (?, ?, ?, ?, 'offen')",
        (auftrag_id, titel[:200], str(data.get("beschreibung") or "").strip() or None, g.user["TCID"]),
    )
    db.commit()
    return {"ok": True, "id": cur.lastrowid}


@bp.patch("/me/aufgaben/<int:aufgabe_id>")
@login_required
def aufgabe_status(aufgabe_id: int):
    data = request.get_json(silent=True) or {}
    status = str(data.get("status") or "").strip().lower()
    if status not in {"offen", "erledigt"}:
        return {"ok": False, "message": "Ungültiger Status."}, 400
    db = get_db()
    aufgabe = db.execute(
        "SELECT mitarbeiter_id FROM auftragsaufgaben WHERE auftragsaufgabe_id=?", (aufgabe_id,)
    ).fetchone()
    if aufgabe is None:
        abort(404)
    if aufgabe["mitarbeiter_id"] != g.user["TCID"]:
        abort(403)
    db.execute("UPDATE auftragsaufgaben SET status=? WHERE auftragsaufgabe_id=?", (status, aufgabe_id))
    db.commit()
    return {"ok": True}
