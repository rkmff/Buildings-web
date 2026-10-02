"""Stammdaten: kleine Auswahllisten, die an anderen Stellen verwendet werden.

Kunden, Systeme, ISPs, Anlagen und Geräte gehören in „Kunden & Anlagen“,
Mitarbeiter in „Mitarbeiter“. Hier bleiben nur die Listen, aus denen dort gewählt wird.
"""
import re

from flask import Blueprint, abort, request

from ..auth import has_full_access, login_required, role
from ..db import get_db, rows

bp = Blueprint("stammdaten", __name__)

# typ: text, lang, farbe, datum, bool, zahl
LISTEN = {
    "niederlassungen": {
        "gruppe": "Organisation", "titel": "Niederlassungen", "tabelle": "tblNiederlassungen", "pk": "NLID",
        "felder": [("NLKurzzeichen", "Kürzel", "text", False), ("NLName", "Name", "text", True), ("NLBeschreibung", "Beschreibung", "lang", False)],
        "sortierung": "NLName COLLATE NOCASE",
        "verwendung": [
            ('SELECT COUNT(*) FROM "tblMitarbeiter" WHERE TCNiederlassung=?', "Mitarbeiter", "/mitarbeiter?niederlassung_id={id}"),
            ('SELECT COUNT(*) FROM "tbKundenSysteme" WHERE KSNiederlassung=?', "Systeme", None),
        ],
        "nur_admin": True,
    },
    "abwesenheitsarten": {
        "gruppe": "Planung", "titel": "Abwesenheitsarten", "tabelle": "abwesenheitsarten", "pk": "abwesenheitsart_id",
        "felder": [("bezeichnung", "Bezeichnung", "text", True), ("kuerzel", "Kürzel", "text", True), ("farbe", "Farbe", "farbe", True),
                   ("sortierung", "Reihenfolge", "zahl", True), ("aktiv", "Aktiv", "bool", True)],
        "sortierung": "sortierung, bezeichnung COLLATE NOCASE",
        "verwendung": [("SELECT COUNT(*) FROM mitarbeiter_planung WHERE abwesenheitsart_id=?", "Planungseinträge", None)],
        "nur_admin": True,
    },
    "feiertage": {
        "gruppe": "Planung", "titel": "Feiertage", "tabelle": "feiertage", "pk": "feiertag_id",
        "felder": [("datum", "Datum", "datum", True), ("bezeichnung", "Bezeichnung", "text", True), ("farbe", "Farbe", "farbe", True),
                   ("aktiv", "Aktiv", "bool", True)],
        "sortierung": "datum DESC",
        "verwendung": [],
        "nur_admin": True,
    },
    "auftragstypen": {
        "gruppe": "Aufträge", "titel": "Auftragstypen", "tabelle": "tblTypenAufträge", "pk": "TAID",
        "felder": [("TAName", "Name", "text", True), ("TAPlanungsfarbe", "Planungsfarbe", "farbe", True), ("TABeschreibung", "Beschreibung", "lang", False)],
        "sortierung": "TAName COLLATE NOCASE",
        "verwendung": [('SELECT COUNT(*) FROM "tblAufTräge" WHERE ATTyp=?', "Aufträge", None)],
    },
    "auftragsstatus": {
        "gruppe": "Aufträge", "titel": "Auftragsstatus", "tabelle": "tblStatusAufträge", "pk": "SAID",
        "felder": [("SAName", "Name", "text", True), ("SABeschreibung", "Beschreibung", "lang", False)],
        "sortierung": "SAID",
        "verwendung": [('SELECT COUNT(*) FROM "tblAufTräge" WHERE ATStatus=?', "Aufträge", None)],
    },
    "anlagentypen": {
        "gruppe": "Anlagen", "titel": "Anlagentypen", "tabelle": "tblAnlagentypen", "pk": "ANTID",
        "felder": [("ANTKurzzeichen", "Kürzel", "text", True), ("ANTName", "Name", "text", True), ("ANTBeschreibung", "Beschreibung", "lang", False)],
        "sortierung": "ANTName COLLATE NOCASE",
        "verwendung": [('SELECT COUNT(*) FROM "tblAnlagen" WHERE ANAnlagentyp=?', "Anlagen", None)],
    },
    "isp-typen": {
        "gruppe": "Anlagen", "titel": "ISP-Typen", "tabelle": "tblTypenISPs", "pk": "TIID",
        "felder": [("TIName", "Name", "text", True), ("TIBeschreibung", "Beschreibung", "lang", False)],
        "sortierung": "TIName COLLATE NOCASE",
        "verwendung": [('SELECT COUNT(*) FROM "tblISPs" WHERE ISTyp=?', "ISPs", None)],
    },
    "bms-typen": {
        "gruppe": "Anlagen", "titel": "BMS-Typen", "tabelle": "tblTypenBMS", "pk": "TBID",
        "felder": [("TBName", "Name", "text", True), ("TBBeschreibung", "Beschreibung", "lang", False)],
        "sortierung": "TBName COLLATE NOCASE",
        "verwendung": [
            ('SELECT COUNT(*) FROM "tblISPs" WHERE ISBMS=?', "ISPs", None),
            ('SELECT COUNT(*) FROM "tbKundenSysteme" WHERE KSDDC=? OR KSLeitebene=?', "Systeme", None),
        ],
    },
    "geraetearten": {
        "gruppe": "Anlagen", "titel": "Gerätearten", "tabelle": "tblGeräteArten", "pk": "GAID",
        "felder": [("GAName", "Name", "text", True), ("GABeschreibung", "Beschreibung", "lang", False)],
        "sortierung": "GAName COLLATE NOCASE",
        "verwendung": [('SELECT COUNT(*) FROM "tblGeRäte" WHERE GRArt=?', "Geräte", None)],
    },
    "ausruestungstypen": {
        "gruppe": "Ausrüstung", "titel": "Ausrüstungstypen", "tabelle": "tblAusruestungstypen", "pk": "AUTID",
        "felder": [("AUTName", "Name", "text", True), ("AUTKalibrierung", "Kalibrierpflichtig", "bool", True),
                   ("AUTBeschreibung", "Beschreibung", "lang", False)],
        "sortierung": "AUTName COLLATE NOCASE",
        "verwendung": [("SELECT COUNT(*) FROM tblAusruestung WHERE AUAusruestungstyp=?", "Ausrüstung", None)],
    },
}


def _liste(slug: str) -> dict:
    cfg = LISTEN.get(slug)
    if cfg is None:
        abort(404)
    return cfg


def _darf(cfg) -> bool:
    return role() == "admin" if cfg.get("nur_admin") else has_full_access()


def _verwendung(db, cfg, pk) -> list[dict]:
    out = []
    for sql, label, link in cfg["verwendung"]:
        n = db.execute(sql, (pk,) * sql.count("?")).fetchone()[0]
        if n:
            out.append({"label": label, "anzahl": n, "link": link.format(id=pk) if link else None})
    return out


@bp.get("/stammdaten")
@login_required
def uebersicht():
    db = get_db()
    return {
        "ok": True,
        "listen": [
            {
                "slug": slug,
                "gruppe": cfg["gruppe"],
                "titel": cfg["titel"],
                "anzahl": db.execute(f'SELECT COUNT(*) FROM "{cfg["tabelle"]}"').fetchone()[0],
                "darf_bearbeiten": _darf(cfg),
            }
            for slug, cfg in LISTEN.items()
        ],
    }


@bp.get("/stammdaten/<slug>")
@login_required
def liste(slug: str):
    cfg = _liste(slug)
    db = get_db()
    spalten = ", ".join(f'"{f[0]}"' for f in cfg["felder"])
    eintraege = rows(db.execute(f'SELECT "{cfg["pk"]}" AS id, {spalten} FROM "{cfg["tabelle"]}" ORDER BY {cfg["sortierung"]}'))
    for e in eintraege:
        e["verwendung"] = _verwendung(db, cfg, e["id"])
    return {
        "ok": True,
        "titel": cfg["titel"],
        "darf_bearbeiten": _darf(cfg),
        "felder": [{"name": n, "label": l, "typ": t, "pflicht": p} for n, l, t, p in cfg["felder"]],
        "eintraege": eintraege,
    }


def _werte(cfg, data: dict) -> dict:
    werte = {}
    for name, label, typ, pflicht in cfg["felder"]:
        v = data.get(name)
        if typ == "bool":
            werte[name] = 1 if v in (True, 1, "1", "true") else 0
            continue
        text = str(v if v is not None else "").strip()
        if typ == "farbe":
            text = text.lower()
            if text and not re.fullmatch(r"#[0-9a-f]{6}", text):
                abort(400, description=f"{label}: bitte als #rrggbb angeben.")
        elif typ == "datum":
            if text and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
                abort(400, description=f"{label}: ungültiges Datum.")
        elif typ == "zahl":
            if text:
                try:
                    text = int(text)
                except ValueError:
                    abort(400, description=f"{label}: bitte eine ganze Zahl eingeben.")
        if pflicht and text in ("", None):
            abort(400, description=f"Bitte {label} ausfüllen.")
        werte[name] = text if text != "" else None
    return werte


@bp.post("/stammdaten/<slug>")
@login_required
def anlegen(slug: str):
    cfg = _liste(slug)
    if not _darf(cfg):
        abort(403)
    werte = _werte(cfg, request.get_json(silent=True) or {})
    db = get_db()
    spalten = ", ".join(f'"{k}"' for k in werte)
    cur = db.execute(
        f'INSERT INTO "{cfg["tabelle"]}" ({spalten}) VALUES ({", ".join("?" * len(werte))})', tuple(werte.values())
    )
    db.commit()
    return {"ok": True, "id": cur.lastrowid}


@bp.put("/stammdaten/<slug>/<int:pk>")
@login_required
def aendern(slug: str, pk: int):
    cfg = _liste(slug)
    if not _darf(cfg):
        abort(403)
    werte = _werte(cfg, request.get_json(silent=True) or {})
    db = get_db()
    gesetzt = ", ".join(f'"{k}"=?' for k in werte)
    if db.execute(f'UPDATE "{cfg["tabelle"]}" SET {gesetzt} WHERE "{cfg["pk"]}"=?', (*werte.values(), pk)).rowcount == 0:
        abort(404)
    db.commit()
    return {"ok": True}


@bp.delete("/stammdaten/<slug>/<int:pk>")
@login_required
def loeschen(slug: str, pk: int):
    cfg = _liste(slug)
    if not _darf(cfg):
        abort(403)
    db = get_db()
    verwendet = _verwendung(db, cfg, pk)
    if verwendet:
        text = ", ".join(f"{v['anzahl']} {v['label']}" for v in verwendet)
        abort(409, description=f"Wird noch verwendet ({text}) und kann nicht gelöscht werden.")
    if db.execute(f'DELETE FROM "{cfg["tabelle"]}" WHERE "{cfg["pk"]}"=?', (pk,)).rowcount == 0:
        abort(404)
    db.commit()
    return {"ok": True}
