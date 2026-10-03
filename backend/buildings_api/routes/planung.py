"""Planung je Mitarbeiter: lesen, anlegen, verschieben, Dauer ändern, löschen."""
from datetime import date, timedelta

from flask import Blueprint, abort, g, request

from ..auth import has_full_access, login_required
from ..db import get_db, rows
from ..planning import PlanungFehler, arbeitstag_verschieben, arbeitstage_zwischen, iso, tag_gesperrt, zeitraum_pruefen
from .me import AKTIVER_STATUS_SQL, meine_auftraege

bp = Blueprint("planung", __name__)


def _darf_bearbeiten(mitarbeiter_id: int) -> bool:
    return has_full_access() or int(mitarbeiter_id) == int(g.user["TCID"])


def _darf_lesen(db, mitarbeiter_id: int) -> bool:
    if has_full_access() or int(mitarbeiter_id) == int(g.user["TCID"]):
        return True
    ziel = db.execute('SELECT TCNiederlassung FROM "tblMitarbeiter" WHERE TCID=?', (mitarbeiter_id,)).fetchone()
    return ziel is not None and ziel["TCNiederlassung"] == g.user["TCNiederlassung"]


def _ist(text, wert: str) -> bool:
    return str(text or "").strip().casefold() == wert


def _eintrag_json(r) -> dict:
    if r["auftrag_id"]:
        typ = "auftrag"
        # Oben (fett) Kunde – Kundensystem, darunter der Auftrag
        auftrag = r["ATName"] or f"Auftrag #{r['auftrag_id']}"
        kunde, system = (r["KSKunde"] or "").strip(), (r["KSName"] or "").strip()
        ort = " – ".join(x for x in (kunde, system if system.casefold() != kunde.casefold() else "") if x)
        titel, untertitel = (ort, auftrag) if ort else (auftrag, "")
        farbe = r["Planungsfarbe"] or "#16a34a"
    else:
        typ = "manuell" if _ist(r["AbwesenheitName"], "manuell") else "abwesenheit"
        titel = (r["anzeigetext"] if typ == "manuell" else r["AbwesenheitName"]) or "Abwesenheit"
        untertitel = r["bemerkung"] or ""
        farbe = r["AbwesenheitFarbe"] or "#64748b"
    return {
        "id": r["planung_id"],
        "mitarbeiter_id": r["mitarbeiter_id"],
        "start_datum": r["start_datum"],
        "ende_datum": r["ende_datum"],
        "typ": typ,
        "titel": titel,
        "untertitel": untertitel,
        "farbe": farbe,
        "auftrag_id": r["auftrag_id"],
        "system_id": r["KSID"],
        "abwesenheitsart_id": r["abwesenheitsart_id"],
        "bemerkung": r["bemerkung"] or "",
        "anzeigetext": r["anzeigetext"] or "",
    }


EINTRAG_SQL = """
    SELECT p.*, a.ATName, s.KSID, s.KSKunde, s.KSName,
           aw.bezeichnung AS AbwesenheitName, aw.farbe AS AbwesenheitFarbe,
           COALESCE(NULLIF(a.ATFarbe,''), ta.TAPlanungsfarbe, '#16a34a') AS Planungsfarbe
    FROM mitarbeiter_planung p
    LEFT JOIN "tblAufTräge" a ON a.ATID=p.auftrag_id
    LEFT JOIN "tblTypenAufträge" ta ON ta.TAID=a.ATTyp
    LEFT JOIN "tbKundenSysteme" s ON s.KSID=a.ATKS
    LEFT JOIN abwesenheitsarten aw ON aw.abwesenheitsart_id=p.abwesenheitsart_id
"""


def _eintrag(db, planung_id: int):
    r = db.execute(EINTRAG_SQL + " WHERE p.planung_id=?", (planung_id,)).fetchone()
    if r is None:
        abort(404, description="Die Planung wurde nicht gefunden.")
    return r


@bp.get("/planung")
@login_required
def planung_lesen():
    db = get_db()
    try:
        mitarbeiter_id = int(request.args.get("mitarbeiter_id") or g.user["TCID"])
        wochen = max(1, min(52, int(request.args.get("wochen") or 6)))
    except ValueError:
        abort(400, description="Ungültige Parameter.")
    if not _darf_lesen(db, mitarbeiter_id):
        abort(403)
    von = iso(request.args.get("von")) or date.today()
    von = von - timedelta(days=von.weekday())
    bis = von + timedelta(days=wochen * 7 - 1)
    zeitraum = (mitarbeiter_id, bis.isoformat(), von.isoformat())
    eintraege = db.execute(
        EINTRAG_SQL + " WHERE p.mitarbeiter_id=? AND p.start_datum<=? AND p.ende_datum>=? ORDER BY p.start_datum",
        zeitraum,
    ).fetchall()
    return {
        "ok": True,
        "mitarbeiter_id": mitarbeiter_id,
        "von": von.isoformat(),
        "bis": bis.isoformat(),
        "darf_bearbeiten": _darf_bearbeiten(mitarbeiter_id),
        "eintraege": [_eintrag_json(r) for r in eintraege],
        "feiertage": rows(
            db.execute(
                "SELECT datum, bezeichnung FROM feiertage WHERE COALESCE(aktiv,1)<>0 AND datum BETWEEN ? AND ? ORDER BY datum",
                (von.isoformat(), bis.isoformat()),
            )
        ),
        "bereitschaften": rows(
            db.execute(
                """SELECT bereitschaft_id AS id, start_datum, ende_datum FROM bereitschaften
                   WHERE mitarbeiter_id=? AND start_datum<=? AND ende_datum>=? ORDER BY start_datum""",
                zeitraum,
            )
        ),
    }


@bp.get("/team-planung")
@login_required
def team_planung():
    """Wochenplanung aller Techniker: Admin/Disposition sehen alle, Mitarbeiter ihre Niederlassung."""
    db = get_db()
    try:
        wochen = max(1, min(12, int(request.args.get("wochen") or 2)))
    except ValueError:
        abort(400, description="Ungültige Parameter.")
    von = iso(request.args.get("von")) or date.today()
    von = von - timedelta(days=von.weekday())
    bis = von + timedelta(days=wochen * 7 - 1)

    voll = has_full_access()
    nl = request.args.get("niederlassung_id")
    sql = """SELECT TCID AS id, TCVorname AS vorname, TCNachname AS nachname, TCFunktion AS funktion,
                    TCNiederlassung AS niederlassung_id
             FROM "tblMitarbeiter"
             WHERE COALESCE(TCAktiv,1)<>0 AND COALESCE(TCInWochenplanung,1)<>0"""
    params: list = []
    if not voll:
        sql += " AND TCNiederlassung IS ?"
        params.append(g.user["TCNiederlassung"])
    elif nl:
        sql += " AND TCNiederlassung=?"
        params.append(int(nl) if nl.isdigit() else -1)
    sql += """ ORDER BY COALESCE(TCNiederlassung,999999), COALESCE(TCWochenplanungSortierung,999999),
                        TCNachname COLLATE NOCASE, TCVorname COLLATE NOCASE"""
    mitarbeiter = rows(db.execute(sql, params))
    ids = [m["id"] for m in mitarbeiter] or [0]
    platz = ",".join("?" * len(ids))
    eintraege = db.execute(
        EINTRAG_SQL + f" WHERE p.mitarbeiter_id IN ({platz}) AND p.start_datum<=? AND p.ende_datum>=? ORDER BY p.start_datum",
        (*ids, bis.isoformat(), von.isoformat()),
    ).fetchall()
    niederlassungen = rows(
        db.execute(
            "SELECT NLID AS id, NLKurzzeichen AS kurz, NLName AS name FROM tblNiederlassungen"
            + ("" if voll else " WHERE NLID IS ?")
            + " ORDER BY NLName COLLATE NOCASE",
            () if voll else (g.user["TCNiederlassung"],),
        )
    )
    for m in mitarbeiter:
        m["darf_bearbeiten"] = _darf_bearbeiten(m["id"])
    return {
        "ok": True,
        "von": von.isoformat(),
        "bis": bis.isoformat(),
        "voll": voll,
        "mitarbeiter": mitarbeiter,
        "niederlassungen": niederlassungen,
        "eintraege": [_eintrag_json(r) for r in eintraege],
        "feiertage": rows(
            db.execute(
                "SELECT datum, bezeichnung FROM feiertage WHERE COALESCE(aktiv,1)<>0 AND datum BETWEEN ? AND ? ORDER BY datum",
                (von.isoformat(), bis.isoformat()),
            )
        ),
        "bereitschaften": rows(
            db.execute(
                f"""SELECT bereitschaft_id AS id, mitarbeiter_id, start_datum, ende_datum FROM bereitschaften
                    WHERE mitarbeiter_id IN ({platz}) AND start_datum<=? AND ende_datum>=? ORDER BY start_datum""",
                (*ids, bis.isoformat(), von.isoformat()),
            )
        ),
    }


@bp.get("/planung/bausteine")
@login_required
def bausteine():
    db = get_db()
    return {
        "ok": True,
        "abwesenheiten": rows(
            db.execute(
                """SELECT abwesenheitsart_id AS id, bezeichnung, kuerzel, farbe FROM abwesenheitsarten
                   WHERE COALESCE(aktiv,1)<>0 ORDER BY COALESCE(sortierung, 9999), bezeichnung"""
            )
        ),
        "auftraege": meine_auftraege(db, g.user["TCID"]),
    }


@bp.get("/auftraege/suche")
@login_required
def auftraege_suche():
    q = str(request.args.get("q") or "").strip()
    like = f"%{q}%"
    return {
        "ok": True,
        "auftraege": rows(
            get_db().execute(
                f"""
                SELECT a.ATID AS id, a.ATName AS name, st.SAName AS status, ta.TAName AS typ,
                       s.KSKunde AS kunde, s.KSName AS system,
                       COALESCE(NULLIF(a.ATFarbe,''), ta.TAPlanungsfarbe, '#16a34a') AS farbe,
                       m.TCVorname || ' ' || m.TCNachname AS techniker
                FROM "tblAufTräge" a
                LEFT JOIN "tbKundenSysteme" s ON s.KSID=a.ATKS
                LEFT JOIN "tblStatusAufträge" st ON st.SAID=a.ATStatus
                LEFT JOIN "tblTypenAufträge" ta ON ta.TAID=a.ATTyp
                LEFT JOIN "tblMitarbeiter" m ON m.TCID=a.ATVerantwortlicherTechniker
                WHERE {AKTIVER_STATUS_SQL}
                  AND (? = '' OR a.ATName LIKE ? OR s.KSKunde LIKE ? OR s.KSName LIKE ?
                       OR (m.TCVorname || ' ' || m.TCNachname) LIKE ?)
                ORDER BY COALESCE(a.web_geaendert_am, a.web_erstellt_am) DESC, a.ATID DESC
                LIMIT 100
                """,
                (q, like, like, like, like),
            )
        ),
    }


@bp.post("/planung")
@login_required
def planung_anlegen():
    data = request.get_json(silent=True) or {}
    db = get_db()
    try:
        mitarbeiter_id = int(data.get("mitarbeiter_id") or g.user["TCID"])
        quelle_id = int(data.get("quelle_id"))
    except (TypeError, ValueError):
        raise PlanungFehler("Mitarbeiter oder Baustein ist ungültig.")
    datum = iso(data.get("datum"))
    if datum is None:
        raise PlanungFehler("Das Datum ist ungültig.")
    if not _darf_bearbeiten(mitarbeiter_id):
        raise PlanungFehler("Du darfst nur deine eigene Planung bearbeiten.", 403)
    if not db.execute(
        'SELECT 1 FROM "tblMitarbeiter" WHERE TCID=? AND COALESCE(TCAktiv,1)<>0', (mitarbeiter_id,)
    ).fetchone():
        raise PlanungFehler("Der Mitarbeiter wurde nicht gefunden.", 404)

    anzeigetext = bemerkung = None
    auftrag_id = abwesenheitsart_id = None
    quelle_typ = str(data.get("quelle_typ") or "").strip().lower()
    if quelle_typ == "auftrag":
        if not db.execute('SELECT 1 FROM "tblAufTräge" WHERE ATID=?', (quelle_id,)).fetchone():
            raise PlanungFehler("Der Auftrag wurde nicht gefunden.", 404)
        auftrag_id = quelle_id
    elif quelle_typ == "abwesenheit":
        art = db.execute(
            "SELECT bezeichnung FROM abwesenheitsarten WHERE abwesenheitsart_id=? AND COALESCE(aktiv,1)<>0",
            (quelle_id,),
        ).fetchone()
        if art is None:
            raise PlanungFehler("Die Abwesenheitsart wurde nicht gefunden.", 404)
        abwesenheitsart_id = quelle_id
        bemerkung = str(data.get("bemerkung") or "").strip()[:160] or None
        if _ist(art["bezeichnung"], "manuell"):
            anzeigetext = str(data.get("anzeigetext") or "").strip()[:120]
            if not anzeigetext:
                raise PlanungFehler("Für einen manuellen Eintrag wird ein Text benötigt.")
    else:
        raise PlanungFehler("Unbekannter Baustein.")

    ende = datum
    try:
        tage = max(1, min(60, int(data.get("arbeitstage") or 1)))
    except (TypeError, ValueError):
        tage = 1
    if tage > 1 and not tag_gesperrt(db, datum):
        ende = arbeitstag_verschieben(db, datum, tage - 1)
    zeitraum_pruefen(db, mitarbeiter_id, datum, ende, bool(data.get("replace")))
    cur = db.execute(
        """INSERT INTO mitarbeiter_planung
           (mitarbeiter_id, start_datum, ende_datum, auftrag_id, abwesenheitsart_id, anzeigetext, bemerkung)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (mitarbeiter_id, datum.isoformat(), ende.isoformat(), auftrag_id, abwesenheitsart_id, anzeigetext, bemerkung),
    )
    db.commit()
    return {"ok": True, "eintrag": _eintrag_json(_eintrag(db, cur.lastrowid))}


@bp.patch("/planung/<int:planung_id>")
@login_required
def planung_aendern(planung_id: int):
    """Zeitraum (Ränder ziehen) und/oder Texte eines Eintrags ändern."""
    data = request.get_json(silent=True) or {}
    db = get_db()
    r = _eintrag(db, planung_id)
    if not _darf_bearbeiten(r["mitarbeiter_id"]):
        raise PlanungFehler("Du darfst nur deine eigene Planung bearbeiten.", 403)

    start = iso(data.get("start_datum")) or date.fromisoformat(r["start_datum"])
    ende = iso(data.get("ende_datum")) or date.fromisoformat(r["ende_datum"])
    if (start.isoformat(), ende.isoformat()) != (r["start_datum"], r["ende_datum"]):
        zeitraum_pruefen(db, r["mitarbeiter_id"], start, ende, bool(data.get("replace")), exclude_id=planung_id)

    bemerkung = str(data.get("bemerkung", r["bemerkung"] or "")).strip()[:10000] or None
    anzeigetext = r["anzeigetext"]
    abwesenheitsart_id = r["abwesenheitsart_id"]
    if r["auftrag_id"] is None:
        if data.get("abwesenheitsart_id") not in (None, ""):
            try:
                abwesenheitsart_id = int(data["abwesenheitsart_id"])
            except (TypeError, ValueError):
                raise PlanungFehler("Die Abwesenheitsart ist ungültig.")
        art = db.execute(
            "SELECT bezeichnung FROM abwesenheitsarten WHERE abwesenheitsart_id=?", (abwesenheitsart_id,)
        ).fetchone()
        if art is None:
            raise PlanungFehler("Die Abwesenheitsart wurde nicht gefunden.", 404)
        if _ist(art["bezeichnung"], "manuell"):
            anzeigetext = str(data.get("anzeigetext", anzeigetext or "")).strip()[:120]
            if not anzeigetext:
                raise PlanungFehler("Für einen manuellen Eintrag wird ein Text benötigt.")
        else:
            anzeigetext = None

    db.execute(
        """UPDATE mitarbeiter_planung SET start_datum=?, ende_datum=?, bemerkung=?, anzeigetext=?, abwesenheitsart_id=?
           WHERE planung_id=?""",
        (start.isoformat(), ende.isoformat(), bemerkung, anzeigetext, abwesenheitsart_id, planung_id),
    )
    db.commit()
    return {"ok": True, "eintrag": _eintrag_json(_eintrag(db, planung_id))}


@bp.post("/planung/<int:planung_id>/verschieben")
@login_required
def planung_verschieben(planung_id: int):
    """Verschiebt einen Eintrag auf einen neuen Starttag und behält die Zahl der Arbeitstage."""
    data = request.get_json(silent=True) or {}
    db = get_db()
    r = _eintrag(db, planung_id)
    if not _darf_bearbeiten(r["mitarbeiter_id"]):
        raise PlanungFehler("Du darfst nur deine eigene Planung bearbeiten.", 403)
    start = iso(data.get("start_datum"))
    if start is None:
        raise PlanungFehler("Das Datum ist ungültig.")
    try:
        ziel = int(data.get("mitarbeiter_id") or r["mitarbeiter_id"])
    except (TypeError, ValueError):
        raise PlanungFehler("Ungültiger Mitarbeiter.") from None
    if ziel != r["mitarbeiter_id"]:
        if not _darf_bearbeiten(ziel):
            raise PlanungFehler("Du darfst nur deine eigene Planung bearbeiten.", 403)
        if not db.execute('SELECT 1 FROM "tblMitarbeiter" WHERE TCID=?', (ziel,)).fetchone():
            raise PlanungFehler("Der Mitarbeiter wurde nicht gefunden.", 404)
    if tag_gesperrt(db, start):
        raise PlanungFehler("Einträge können nur auf Arbeitstage gezogen werden.")
    tage = max(1, arbeitstage_zwischen(db, date.fromisoformat(r["start_datum"]), date.fromisoformat(r["ende_datum"])))
    ende = arbeitstag_verschieben(db, start, tage - 1)
    zeitraum_pruefen(db, ziel, start, ende, bool(data.get("replace")), exclude_id=planung_id)
    db.execute(
        "UPDATE mitarbeiter_planung SET mitarbeiter_id=?, start_datum=?, ende_datum=? WHERE planung_id=?",
        (ziel, start.isoformat(), ende.isoformat(), planung_id),
    )
    db.commit()
    return {"ok": True, "eintrag": _eintrag_json(_eintrag(db, planung_id))}


@bp.delete("/planung/<int:planung_id>")
@login_required
def planung_loeschen(planung_id: int):
    db = get_db()
    r = _eintrag(db, planung_id)
    if not _darf_bearbeiten(r["mitarbeiter_id"]):
        raise PlanungFehler("Du darfst nur deine eigene Planung bearbeiten.", 403)
    db.execute("DELETE FROM mitarbeiter_planung WHERE planung_id=?", (planung_id,))
    db.commit()
    return {"ok": True}
