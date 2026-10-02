"""Ablauf einer Wartung: Status (geplant, gestartet, pausiert, fertig) und
Erzeugen der Wartungsaufgaben aus den beiden Matrizen.

Die Erzeugung folgt dem bisherigen Programm: Für jede Anlage des Kundensystems mit passendem
Anlagentyp und jedes wartungspflichtige Gerät mit passender Geräteart entsteht je zugeordneter
Vorlage eine Aufgabe. Vorhandene Aufgaben (gleicher Auftrag, gleiches Objekt, gleiche Vorlage)
werden nicht doppelt angelegt; deshalb kann „Aufgaben aktualisieren“ beliebig oft laufen.
"""

from flask import Blueprint, abort, request

from ..auth import has_full_access, login_required
from ..db import get_db, row, rows
from .auftraege import LISTE_SQL

bp = Blueprint("wartung_ablauf", __name__)

STATUS = ("geplant", "gestartet", "pausiert", "fertig")
# erlaubte Wechsel; „fertig“ lässt sich wieder öffnen
UEBERGAENGE = {
    "geplant": {"gestartet"},
    "gestartet": {"pausiert", "fertig"},
    "pausiert": {"gestartet", "fertig"},
    "fertig": {"gestartet"},
}
# Auftragsstatus, der mit dem Wartungsstatus mitläuft (Name aus tblStatusAufträge)
AUFTRAGSSTATUS = {"gestartet": "in arbeit", "pausiert": "in arbeit", "fertig": "erledigt"}

ANLAGEN_SQL = """
    SELECT a.ANID AS anlage_id, NULL AS geraet_id, v.vorlage_id, v.kurzbezeichnung, v.langtext,
           COALESCE(v.zeitvorgabe,0) AS zeitvorgabe, COALESCE(v.aufgabentyp,'standard') AS aufgabentyp
    FROM "tblAnlagen" a
    JOIN "tblISPs" i ON i.ISID=a.ANIS
    JOIN wartungsaufgabenvorlage_anlagentypen x ON x.anlagentyp_id=a.ANAnlagentyp
    JOIN wartungsaufgabenvorlagen v ON v.vorlage_id=x.vorlage_id
    WHERE i.ISKS=:system AND COALESCE(v.gilt_fuer_anlagen,0)=1
      AND NOT EXISTS (SELECT 1 FROM wartungsaufgaben w WHERE w.auftrag_id=:auftrag AND w.anlage_id=a.ANID
                      AND w.geraet_id IS NULL AND w.vorlage_id=v.vorlage_id)
    ORDER BY i.ISName COLLATE NOCASE, a.ANName COLLATE NOCASE, v.kurzbezeichnung COLLATE NOCASE
"""

GERAETE_SQL = """
    SELECT g.GRAN AS anlage_id, g.GRID AS geraet_id, v.vorlage_id, v.kurzbezeichnung, v.langtext,
           COALESCE(v.zeitvorgabe,0) AS zeitvorgabe, COALESCE(v.aufgabentyp,'standard') AS aufgabentyp
    FROM "tblGeRäte" g
    JOIN "tblAnlagen" a ON a.ANID=g.GRAN
    JOIN "tblISPs" i ON i.ISID=a.ANIS
    JOIN wartungsaufgabenvorlage_geraetearten x ON x.geraeteart_id=g.GRArt
    JOIN wartungsaufgabenvorlagen v ON v.vorlage_id=x.vorlage_id
    WHERE i.ISKS=:system AND COALESCE(g.GRWartungspflichtig,0)<>0 AND COALESCE(v.gilt_fuer_geraete,0)=1
      AND NOT EXISTS (SELECT 1 FROM wartungsaufgaben w WHERE w.auftrag_id=:auftrag AND w.geraet_id=g.GRID
                      AND w.vorlage_id=v.vorlage_id)
    ORDER BY i.ISName COLLATE NOCASE, a.ANName COLLATE NOCASE, g.GRName COLLATE NOCASE, v.kurzbezeichnung COLLATE NOCASE
"""

# Offene Aufgaben, deren Vorlage laut Matrix nicht mehr zum Objekt passt
VERALTET_SQL = """
    SELECT w.wartungsaufgabe_id FROM wartungsaufgaben w
    LEFT JOIN "tblAnlagen" a ON a.ANID=w.anlage_id
    LEFT JOIN "tblGeRäte" g ON g.GRID=w.geraet_id
    WHERE w.auftrag_id=? AND w.vorlage_id IS NOT NULL
      AND LOWER(TRIM(COALESCE(w.status,'offen')))<>'erledigt'
      AND CASE WHEN w.geraet_id IS NULL THEN NOT EXISTS (
                   SELECT 1 FROM wartungsaufgabenvorlage_anlagentypen x JOIN wartungsaufgabenvorlagen v ON v.vorlage_id=x.vorlage_id
                   WHERE x.vorlage_id=w.vorlage_id AND x.anlagentyp_id=a.ANAnlagentyp AND COALESCE(v.gilt_fuer_anlagen,0)=1)
               ELSE COALESCE(g.GRWartungspflichtig,0)=0 OR NOT EXISTS (
                   SELECT 1 FROM wartungsaufgabenvorlage_geraetearten x JOIN wartungsaufgabenvorlagen v ON v.vorlage_id=x.vorlage_id
                   WHERE x.vorlage_id=w.vorlage_id AND x.geraeteart_id=g.GRArt AND COALESCE(v.gilt_fuer_geraete,0)=1)
          END
"""


def _auftrag(db, atid: int) -> dict:
    a = row(db.execute(LISTE_SQL + " WHERE a.ATID=?", (atid,)))
    if a is None:
        abort(404)
    return a


def _ist_wartung(a: dict) -> bool:
    return str(a.get("typ") or "").strip().casefold() == "wartung" or bool(a.get("wartung_gesamt"))


def fehlende_aufgaben(db, a: dict, anlagen: bool, geraete: bool) -> list[dict]:
    if not a["system_id"]:
        return []
    p = {"system": a["system_id"], "auftrag": a["id"]}
    out = rows(db.execute(ANLAGEN_SQL, p)) if anlagen else []
    if geraete:
        out += rows(db.execute(GERAETE_SQL, p))
    return out


def aufgaben_erzeugen(db, a: dict, anlagen: bool, geraete: bool) -> int:
    neu = fehlende_aufgaben(db, a, anlagen, geraete)
    for t in neu:
        db.execute(
            """INSERT INTO wartungsaufgaben (anlage_id, geraet_id, auftrag_id, vorlage_id, aufgabenname, beschreibung,
                      zeitvorgabe, aufgabentyp, status, ergebnis)
               VALUES (?,?,?,?,?,?,?,?,'offen','neutral')""",
            (t["anlage_id"], t["geraet_id"], a["id"], t["vorlage_id"], t["kurzbezeichnung"], t["langtext"] or "",
             t["zeitvorgabe"], t["aufgabentyp"]),
        )
    return len(neu)


def veraltete(db, atid: int) -> list[int]:
    return [r[0] for r in db.execute(VERALTET_SQL, (atid,))]


def zeiten(db, atid: int) -> dict:
    """Summe der Zeitvorgaben. Eine Ist-Zeit wird bewusst nicht erfasst."""
    soll = db.execute("SELECT COALESCE(SUM(zeitvorgabe),0) FROM wartungsaufgaben WHERE auftrag_id=?", (atid,)).fetchone()[0]
    return {"soll_minuten": round(soll or 0)}


def _auftragsstatus_setzen(db, atid: int, wartungsstatus: str):
    name = AUFTRAGSSTATUS.get(wartungsstatus)
    if not name:
        return
    r = db.execute('SELECT SAID FROM "tblStatusAufträge" WHERE LOWER(TRIM(SAName))=?', (name,)).fetchone()
    if r:
        db.execute('UPDATE "tblAufTräge" SET ATStatus=? WHERE ATID=?', (r[0], atid))


def _status_wechseln(db, a: dict, neu: str):
    alt = a["wartung_status"] or "geplant"
    if neu == alt:
        return
    if neu not in UEBERGAENGE.get(alt, set()):
        abort(409, description=f"Eine Wartung im Status „{alt}“ kann nicht auf „{neu}“ wechseln.")
    if neu == "fertig":
        offen = db.execute(
            "SELECT COUNT(*) FROM wartungsaufgaben WHERE auftrag_id=? AND LOWER(TRIM(COALESCE(status,'offen')))<>'erledigt'",
            (a["id"],),
        ).fetchone()[0]
        if offen:
            abort(409, description=f"Es sind noch {offen} Aufgaben ohne Ergebnis. Erst wenn alle bewertet sind, ist die Wartung fertig.")
    db.execute('UPDATE "tblAufTräge" SET wartung_status=? WHERE ATID=?', (neu, a["id"]))
    _auftragsstatus_setzen(db, a["id"], neu)


def _auswahl(data: dict) -> tuple[bool, bool]:
    anlagen, geraete = bool(data.get("anlagen", True)), bool(data.get("geraete", True))
    return anlagen, geraete


@bp.get("/wartung/<int:atid>/vorschau")
@login_required
def vorschau(atid: int):
    """Was „Wartung ausführen“ bzw. „Aufgaben aktualisieren“ anlegen würde."""
    db = get_db()
    a = _auftrag(db, atid)
    if not _ist_wartung(a):
        abort(400, description="Wartungsaufgaben gibt es nur bei Aufträgen vom Typ „Wartung“.")
    anl = fehlende_aufgaben(db, a, True, False)
    ger = fehlende_aufgaben(db, a, False, True)
    return {
        "ok": True,
        "status": a["wartung_status"],
        "vorhanden": a["wartung_gesamt"],
        "anlagen": {"aufgaben": len(anl), "objekte": len({t["anlage_id"] for t in anl}),
                    "minuten": round(sum(t["zeitvorgabe"] for t in anl))},
        "geraete": {"aufgaben": len(ger), "objekte": len({t["geraet_id"] for t in ger}),
                    "minuten": round(sum(t["zeitvorgabe"] for t in ger))},
        "veraltet": veraltete(db, atid),
        "luecken": {
            "anlagen_ohne_typ": db.execute(
                'SELECT COUNT(*) FROM "tblAnlagen" a JOIN "tblISPs" i ON i.ISID=a.ANIS WHERE i.ISKS=? AND a.ANAnlagentyp IS NULL',
                (a["system_id"],)).fetchone()[0],
            "geraete_nicht_pflichtig": db.execute(
                """SELECT COUNT(*) FROM "tblGeRäte" g JOIN "tblAnlagen" a ON a.ANID=g.GRAN JOIN "tblISPs" i ON i.ISID=a.ANIS
                   WHERE i.ISKS=? AND COALESCE(g.GRWartungspflichtig,0)=0
                     AND EXISTS (SELECT 1 FROM wartungsaufgabenvorlage_geraetearten x WHERE x.geraeteart_id=g.GRArt)""",
                (a["system_id"],)).fetchone()[0],
        },
    }


@bp.post("/wartung/<int:atid>/ausfuehren")
@login_required
def ausfuehren(atid: int):
    """Erzeugt die fehlenden Aufgaben (Anlagen und/oder Geräte) und startet die Wartung."""
    db = get_db()
    a = _auftrag(db, atid)
    if not _ist_wartung(a):
        abort(400, description="Wartungsaufgaben gibt es nur bei Aufträgen vom Typ „Wartung“.")
    anlagen, geraete = _auswahl(request.get_json(silent=True) or {})
    neu = aufgaben_erzeugen(db, a, anlagen, geraete)
    if (a["wartung_status"] or "geplant") != "gestartet":
        _status_wechseln(db, a, "gestartet")
    db.commit()
    return {"ok": True, "neu": neu}


@bp.post("/wartung/<int:atid>/aufgaben-aktualisieren")
@login_required
def aktualisieren(atid: int):
    db = get_db()
    a = _auftrag(db, atid)
    if (a["wartung_status"] or "geplant") == "fertig":
        abort(409, description="Die Wartung ist fertig. Öffne sie wieder, um Aufgaben zu ergänzen.")
    anlagen, geraete = _auswahl(request.get_json(silent=True) or {})
    neu = aufgaben_erzeugen(db, a, anlagen, geraete)
    db.commit()
    return {"ok": True, "neu": neu, "veraltet": veraltete(db, atid)}


@bp.post("/wartung/<int:atid>/status")
@login_required
def status_setzen(atid: int):
    db = get_db()
    a = _auftrag(db, atid)
    neu = (request.get_json(silent=True) or {}).get("status")
    if neu not in STATUS:
        abort(400, description="Ungültiger Status.")
    _status_wechseln(db, a, neu)
    db.commit()
    return {"ok": True, "status": neu}


@bp.delete("/wartungsaufgaben/<int:wid>")
@login_required
def aufgabe_entfernen(wid: int):
    """Nur offene Aufgaben ohne Messwerte, Kommentare und Fotos lassen sich entfernen."""
    db = get_db()
    w = db.execute("SELECT status, auftrag_id FROM wartungsaufgaben WHERE wartungsaufgabe_id=?", (wid,)).fetchone()
    if w is None:
        abort(404)
    if str(w["status"] or "offen").strip().lower() == "erledigt":
        abort(409, description="Bewertete Aufgaben bleiben erhalten.")
    if db.execute("SELECT 1 FROM wartungsaufgaben_kommentare WHERE wartungsaufgabe_id=?", (wid,)).fetchone() or \
            db.execute("SELECT 1 FROM web_fotos WHERE wartungsaufgabe_id=?", (wid,)).fetchone():
        abort(409, description="An der Aufgabe hängen Kommentare oder Fotos, sie bleibt erhalten.")
    if not has_full_access() and wid not in veraltete(db, w["auftrag_id"]):
        abort(403, description="Techniker können nur Aufgaben entfernen, die nicht mehr zur Matrix passen.")
    db.execute("DELETE FROM wartungsaufgaben WHERE wartungsaufgabe_id=?", (wid,))
    db.commit()
    return {"ok": True}
