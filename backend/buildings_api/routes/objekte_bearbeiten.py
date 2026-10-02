"""Kunden & Anlagen bearbeiten: Kunden, Systeme, ISPs, Anlagen, Geräte und Ansprechpartner.

Ändern dürfen Admins und Dispatcher. Gelöscht wird nur, was nirgends mehr verwendet wird;
die Prüfung liest dazu alle Fremdschlüssel der Datenbank, damit keine Fotos oder
Wartungsaufgaben unbemerkt mitgelöscht werden.
"""
from flask import Blueprint, abort, request

from ..auth import has_full_access, login_required
from ..db import get_db, rows

bp = Blueprint("objekte_bearbeiten", __name__)

# Auswahllisten: (Tabelle, Schlüssel, Anzeige)
AUSWAHL = {
    "niederlassungen": ("tblNiederlassungen", "NLID", "NLName"),
    "bms": ("tblTypenBMS", "TBID", "TBName"),
    "isp_typen": ("tblTypenISPs", "TIID", "TIName"),
    "anlagentypen": ("tblAnlagentypen", "ANTID", "ANTName"),
    "geraetearten": ("tblGeräteArten", "GAID", "GAName"),
}

# Feld: (Spalte, Label, Typ, Pflicht[, Auswahlliste]); Typ text, lang, zahl, ganzzahl, bool, auswahl
OBJEKTE = {
    "kunde": {
        "name": "Kunde", "tabelle": "tblKunden", "pk": "KUID", "eltern": None,
        "felder": [
            ("KUName", "Name", "text", True), ("KUStrasse", "Straße", "text", False),
            ("KUPLZ", "PLZ", "text", False), ("KUOrt", "Ort", "text", False), ("KULand", "Land", "text", False),
            ("KUTelefon", "Telefon", "text", False), ("KUEmail", "E-Mail", "text", False),
            ("KUWebseite", "Webseite", "text", False), ("KUBeschreibung", "Beschreibung", "lang", False),
        ],
    },
    "system": {
        "name": "Kundensystem", "tabelle": "tbKundenSysteme", "pk": "KSID",
        "eltern": ("KSKundeID", "kunde", "Kunde"),
        "felder": [
            ("KSName", "Name", "text", True), ("KSOrt", "Ort", "text", False), ("KSAdresse", "Adresse", "text", False),
            ("KSNiederlassung", "Niederlassung", "auswahl", False, "niederlassungen"),
            ("KSLeitebene", "Leitebene", "auswahl", False, "bms"), ("KSDDC", "DDC", "auswahl", False, "bms"),
            ("KSBeschreibung", "Beschreibung", "lang", False),
        ],
    },
    "isp": {
        "name": "ISP", "tabelle": "tblISPs", "pk": "ISID", "eltern": ("ISKS", "system", "System"),
        "felder": [
            ("ISName", "Name", "text", True), ("ISBeschreibung", "Beschreibung", "text", False),
            ("ISTyp", "Typ", "auswahl", False, "isp_typen"), ("ISBMS", "BMS", "auswahl", False, "bms"),
            ("ISOrt", "Ort", "text", False),
        ],
    },
    "anlage": {
        "name": "Anlage", "tabelle": "tblAnlagen", "pk": "ANID", "eltern": ("ANIS", "isp", "ISP"),
        "felder": [
            ("ANName", "Name", "text", True), ("ANBeschreibung", "Beschreibung", "text", False),
            ("ANAnlagentyp", "Anlagentyp", "auswahl", False, "anlagentypen"),
        ],
    },
    "geraet": {
        "name": "Gerät", "tabelle": "tblGeRäte", "pk": "GRID", "eltern": ("GRAN", "anlage", "Anlage"),
        "felder": [
            ("GRName", "Name", "text", True), ("GRBMKZ", "BMKZ", "text", False),
            ("GRArt", "Geräteart", "auswahl", False, "geraetearten"), ("GRHersteller", "Hersteller", "text", False),
            ("GRTyp", "Typ", "text", False), ("GREinbauort", "Einbauort", "text", False),
            ("GRBaujahr", "Baujahr", "ganzzahl", False), ("GRLeistung", "Leistung", "text", False),
            ("GRNennleistung", "Nennleistung (kW)", "zahl", False), ("GRNennstrom", "Nennstrom (A)", "zahl", False),
            ("GRSpannung", "Spannung (V)", "zahl", False), ("GRWartungspflichtig", "Wartungspflichtig", "bool", False),
        ],
    },
    "ansprechpartner": {
        "name": "Ansprechpartner", "tabelle": "tblAnsprechpartner", "pk": "APID", "eltern": None,
        "felder": [
            ("APVorname", "Vorname", "text", False), ("APNachname", "Nachname", "text", True),
            ("APFunktion", "Funktion", "text", False), ("APTelefon", "Telefon", "text", False),
            ("APMobiltelefon", "Mobil", "text", False), ("APEmail", "E-Mail", "text", False),
            ("APKommentar", "Kommentar", "lang", False),
        ],
    },
}

# Bezeichnungen für die Verwendungsprüfung (Tabelle -> Label)
VERWENDUNG_LABEL = {
    "tbKundenSysteme": ("System", "Systeme"), "tblISPs": ("ISP", "ISPs"), "tblAnlagen": ("Anlage", "Anlagen"),
    "tblGeRäte": ("Gerät", "Geräte"), "tblAufTräge": ("Auftrag", "Aufträge"),
    "tblMitarbeiterSysteme": ("Techniker-Zuordnung", "Techniker-Zuordnungen"),
    "tblZugangsDaten": ("Zugangsdaten", "Zugangsdaten"), "tblAnsprechpartner": ("Ansprechpartner", "Ansprechpartner"),
    "web_fotos": ("Foto", "Fotos"), "wartungsaufgaben": ("Wartungsaufgabe", "Wartungsaufgaben"),
}

# Mögliche Eltern: Liste (id, Label), damit ein Objekt auch umgehängt werden kann
ELTERN_SQL = {
    "kunde": 'SELECT KUID AS id, KUName AS label FROM tblKunden ORDER BY KUName COLLATE NOCASE',
    "system": """SELECT KSID AS id, COALESCE(KSKunde || ' · ', '') || COALESCE(KSName,'') AS label
                 FROM "tbKundenSysteme" ORDER BY KSKunde COLLATE NOCASE, KSName COLLATE NOCASE""",
    "isp": """SELECT i.ISID AS id, COALESCE(s.KSName || ' · ', '') || COALESCE(i.ISName,'') AS label
              FROM "tblISPs" i LEFT JOIN "tbKundenSysteme" s ON s.KSID=i.ISKS
              ORDER BY s.KSName COLLATE NOCASE, i.ISName COLLATE NOCASE""",
    "anlage": """SELECT a.ANID AS id, COALESCE(s.KSName || ' · ', '') || COALESCE(i.ISName || ' · ', '') || COALESCE(a.ANName,'') AS label
                 FROM "tblAnlagen" a LEFT JOIN "tblISPs" i ON i.ISID=a.ANIS LEFT JOIN "tbKundenSysteme" s ON s.KSID=i.ISKS
                 ORDER BY s.KSName COLLATE NOCASE, i.ISName COLLATE NOCASE, a.ANName COLLATE NOCASE""",
}


def _cfg(typ: str) -> dict:
    cfg = OBJEKTE.get(typ)
    if cfg is None:
        abort(404)
    return cfg


def _nur_berechtigt():
    if not has_full_access():
        abort(403, description="Kunden und Anlagen können nur Admins und Dispatcher ändern.")


def _laden(db, cfg, pk: int) -> dict:
    r = db.execute(f'SELECT * FROM "{cfg["tabelle"]}" WHERE "{cfg["pk"]}"=?', (pk,)).fetchone()
    if r is None:
        abort(404)
    return dict(r)


def verwendung(db, tabelle: str, pk) -> list[dict]:
    """Zählt alle Zeilen in anderen Tabellen, die per Fremdschlüssel auf diesen Eintrag zeigen."""
    out: dict[str, int] = {}
    for (t,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall():
        for fk in db.execute(f'PRAGMA foreign_key_list("{t}")').fetchall():
            if fk["table"] != tabelle:
                continue
            n = db.execute(f'SELECT COUNT(*) FROM "{t}" WHERE "{fk["from"]}"=?', (pk,)).fetchone()[0]
            if n:
                out[t] = out.get(t, 0) + n
    return [
        {"label": VERWENDUNG_LABEL.get(t, (t, t))[0 if n == 1 else 1], "anzahl": n} for t, n in out.items()
    ]


def _werte(db, cfg, data: dict, neu: bool) -> dict:
    werte = {}
    for f in cfg["felder"]:
        spalte, label, typ, pflicht = f[:4]
        if spalte not in data:
            if neu and pflicht:
                abort(400, description=f"Bitte {label} ausfüllen.")
            continue
        v = data.get(spalte)
        if isinstance(v, str):
            v = v.strip()
        if v in ("", None):
            if pflicht:
                abort(400, description=f"Bitte {label} ausfüllen.")
            werte[spalte] = 0 if typ == "bool" else None
            continue
        if typ == "bool":
            v = 1 if v in (True, 1, "1", "true", "ja") else 0
        elif typ in ("zahl", "ganzzahl"):
            try:
                v = float(str(v).replace(",", "."))
            except ValueError:
                abort(400, description=f"{label}: bitte eine Zahl eingeben.")
            if typ == "ganzzahl":
                if v != int(v):
                    abort(400, description=f"{label}: bitte eine ganze Zahl eingeben.")
                v = int(v)
        elif typ == "auswahl":
            tabelle, schluessel, _ = AUSWAHL[f[4]]
            try:
                v = int(v)
            except (TypeError, ValueError):
                abort(400, description=f"{label}: ungültige Auswahl.")
            if db.execute(f'SELECT 1 FROM "{tabelle}" WHERE "{schluessel}"=?', (v,)).fetchone() is None:
                abort(400, description=f"{label}: ungültige Auswahl.")
        else:
            v = str(v)
        werte[spalte] = v
    return werte


def _eltern_pruefen(db, cfg, eltern_id):
    """Prüft die Eltern-ID (Pflicht für System, ISP, Anlage, Gerät)."""
    spalte, eltern_typ, label = cfg["eltern"]
    try:
        eltern_id = int(eltern_id)
    except (TypeError, ValueError):
        abort(400, description=f"Bitte {label} wählen.")
    ecfg = OBJEKTE[eltern_typ]
    if db.execute(f'SELECT 1 FROM "{ecfg["tabelle"]}" WHERE "{ecfg["pk"]}"=?', (eltern_id,)).fetchone() is None:
        abort(400, description=f"{label} nicht gefunden.")
    return spalte, eltern_id


@bp.get("/objekt-formular/<typ>")
@login_required
def formular(typ: str):
    """Felder, Auswahllisten und (beim Bearbeiten) aktuelle Werte samt Verwendung."""
    cfg = _cfg(typ)
    db = get_db()
    auswahl = {}
    felder = []
    for f in cfg["felder"]:
        feld = {"name": f[0], "label": f[1], "typ": f[2], "pflicht": f[3]}
        if f[2] == "auswahl":
            feld["auswahl"] = f[4]
            if f[4] not in auswahl:
                tabelle, schluessel, anzeige = AUSWAHL[f[4]]
                auswahl[f[4]] = rows(db.execute(
                    f'SELECT "{schluessel}" AS id, "{anzeige}" AS label FROM "{tabelle}" ORDER BY "{anzeige}" COLLATE NOCASE'
                ))
        felder.append(feld)
    out = {"ok": True, "typ": typ, "name": cfg["name"], "felder": felder, "auswahl": auswahl,
           "darf_bearbeiten": has_full_access(), "eltern": None}
    if cfg["eltern"]:
        spalte, eltern_typ, label = cfg["eltern"]
        out["eltern"] = {"spalte": spalte, "typ": eltern_typ, "label": label,
                         "optionen": rows(db.execute(ELTERN_SQL[eltern_typ]))}
    pk = request.args.get("id", type=int)
    if pk is not None:
        obj = _laden(db, cfg, pk)
        out["werte"] = {f[0]: obj.get(f[0]) for f in cfg["felder"]}
        if out["werte"].get("GRBaujahr") == 0:  # Altdaten: 0 steht für „unbekannt“
            out["werte"]["GRBaujahr"] = None
        if cfg["eltern"]:
            out["eltern_id"] = obj.get(cfg["eltern"][0])
        out["verwendung"] = verwendung(db, cfg["tabelle"], pk)
    return out


@bp.post("/objekte/<typ>")
@login_required
def anlegen(typ: str):
    cfg = _cfg(typ)
    _nur_berechtigt()
    db = get_db()
    data = request.get_json(silent=True) or {}
    werte = _werte(db, cfg, data.get("werte") or {}, neu=True)
    if cfg["eltern"]:
        spalte, eltern_id = _eltern_pruefen(db, cfg, data.get("eltern_id"))
        werte[spalte] = eltern_id
    elif typ == "ansprechpartner":
        kunde_id, system_id = data.get("kunde_id"), data.get("system_id")
        if bool(kunde_id) == bool(system_id):
            abort(400, description="Ansprechpartner gehören entweder zu einem Kunden oder zu einem System.")
        if kunde_id:
            _, werte["APKunde"] = _eltern_pruefen(db, {"eltern": ("APKunde", "kunde", "Kunde")}, kunde_id)
        else:
            _, werte["APKS"] = _eltern_pruefen(db, {"eltern": ("APKS", "system", "System")}, system_id)
    spalten = ", ".join(f'"{s}"' for s in werte)
    cur = db.execute(
        f'INSERT INTO "{cfg["tabelle"]}" ({spalten}) VALUES ({", ".join("?" for _ in werte)})', tuple(werte.values())
    )
    db.commit()
    return {"ok": True, "id": cur.lastrowid}, 201


@bp.put("/objekte/<typ>/<int:pk>")
@login_required
def aendern(typ: str, pk: int):
    cfg = _cfg(typ)
    _nur_berechtigt()
    db = get_db()
    _laden(db, cfg, pk)
    data = request.get_json(silent=True) or {}
    werte = _werte(db, cfg, data.get("werte") or {}, neu=False)
    if cfg["eltern"] and "eltern_id" in data:
        spalte, eltern_id = _eltern_pruefen(db, cfg, data.get("eltern_id"))
        werte[spalte] = eltern_id
    if werte:
        setzen = ", ".join(f'"{s}"=?' for s in werte)
        db.execute(f'UPDATE "{cfg["tabelle"]}" SET {setzen} WHERE "{cfg["pk"]}"=?', (*werte.values(), pk))
        db.commit()
    return {"ok": True, "id": pk}


@bp.delete("/objekte/<typ>/<int:pk>")
@login_required
def loeschen(typ: str, pk: int):
    cfg = _cfg(typ)
    _nur_berechtigt()
    db = get_db()
    _laden(db, cfg, pk)
    benutzt = verwendung(db, cfg["tabelle"], pk)
    if benutzt:
        text = ", ".join(f'{v["anzahl"]} {v["label"]}' for v in benutzt)
        abort(409, description=f"{cfg['name']} wird noch verwendet ({text}). Bitte zuerst diese Einträge entfernen.")
    db.execute(f'DELETE FROM "{cfg["tabelle"]}" WHERE "{cfg["pk"]}"=?', (pk,))
    db.commit()
    return {"ok": True}
