"""Ausrüstung: Messgeräte, Maschinen und Werkzeug mit Übergaben, Kalibrierungen, Fotos und Dokumenten.

Jeder Gegenstand gehört einem Mitarbeiter. Den Besitzer wechselt man über eine Übergabe,
die der Empfänger annehmen muss (wie bisher). Admins und Dispatcher dürfen alles ändern und
den Besitzer auch direkt setzen.
"""
from datetime import date, datetime, timedelta

from flask import Blueprint, abort, current_app, g, request, send_file

from ..auth import has_full_access, login_required
from ..db import get_db, row, rows
from .wartung import Eingabefehler, _pfadteil, fotos_speichern

bp = Blueprint("ausruestung", __name__)

STATUS = {"aktiv": "Aktiv", "reparatur": "Reparatur", "ausgemustert": "Ausgemustert"}

FELDER = [
    ("AUName", "name"), ("AUAusruestungstyp", "typ_id"), ("AUHersteller", "hersteller"), ("AUTyp", "modell"),
    ("AUSeriennummer", "seriennummer"), ("AUInventarnummer", "inventarnummer"), ("AUBaujahr", "baujahr"),
    ("AUAnschaffungsdatum", "anschaffungsdatum"), ("AUNaechstePruefung", "naechste_pruefung"),
    ("AUBeschreibung", "beschreibung"), ("AUKommentar", "kommentar"), ("AUStatus", "status"),
]

NAME_SQL = "TRIM(COALESCE({a}.TCVorname,'') || ' ' || COALESCE({a}.TCNachname,''))"

LISTE_SQL = f"""
    SELECT a.AUID AS id, a.AUName AS name, a.AUHersteller AS hersteller, a.AUTyp AS modell,
           a.AUInventarnummer AS inventarnummer, a.AUSeriennummer AS seriennummer,
           LOWER(COALESCE(a.AUStatus,'aktiv')) AS status, a.AUNaechstePruefung AS naechste_pruefung,
           a.AUAusruestungstyp AS typ_id, t.AUTName AS typ, a.AUMitarbeiter AS besitzer_id,
           {NAME_SQL.format(a='m')} AS besitzer,
           (SELECT {NAME_SQL.format(a='e')} FROM tblAusruestungUebergaben u JOIN "tblMitarbeiter" e ON e.TCID=u.AUGAnMitarbeiter
            WHERE u.AUGAusruestung=a.AUID AND u.AUGStatus='offen' LIMIT 1) AS uebergabe_an
    FROM tblAusruestung a
    LEFT JOIN tblAusruestungstypen t ON t.AUTID=a.AUAusruestungstyp
    LEFT JOIN "tblMitarbeiter" m ON m.TCID=a.AUMitarbeiter
"""


def _ich() -> int:
    return int(g.user["TCID"])


def pruefung_status(datum: str | None) -> str | None:
    """faellig (überschritten), bald (innerhalb 30 Tagen) oder None."""
    if not datum:
        return None
    heute = date.today().isoformat()
    if datum[:10] < heute:
        return "faellig"
    if datum[:10] <= (date.today() + timedelta(days=30)).isoformat():
        return "bald"
    return None


def _mit_status(liste: list[dict]) -> list[dict]:
    for e in liste:
        e["pruefung"] = pruefung_status(e.get("naechste_pruefung"))
    return liste


def _laden(db, auid: int) -> dict:
    a = row(db.execute(LISTE_SQL + " WHERE a.AUID=?", (auid,)))
    if a is None:
        abort(404)
    return a


def _darf(a: dict) -> bool:
    return has_full_access() or int(a["besitzer_id"] or 0) == _ich()


def _nur_wenn_darf(a: dict):
    if not _darf(a):
        abort(403, description="Nur der Besitzer, Admins und Dispatcher können diese Ausrüstung ändern.")


@bp.errorhandler(Eingabefehler)
def eingabefehler(err):
    return {"ok": False, "message": str(err)}, 400


@bp.get("/ausruestung")
@login_required
def liste():
    db = get_db()
    sql, args = LISTE_SQL + " WHERE 1=1", []
    if request.args.get("ansicht") != "alle":
        sql += " AND a.AUMitarbeiter=?"
        args.append(_ich())
    if request.args.get("ausgemusterte") != "1":
        sql += " AND LOWER(COALESCE(a.AUStatus,'aktiv'))<>'ausgemustert'"
    q = (request.args.get("q") or "").strip()
    if q:
        like = f"%{q}%"
        sql += """ AND (a.AUName LIKE ? OR a.AUHersteller LIKE ? OR a.AUTyp LIKE ? OR a.AUInventarnummer LIKE ?
                        OR a.AUSeriennummer LIKE ? OR m.TCVorname LIKE ? OR m.TCNachname LIKE ?)"""
        args += [like] * 7
    for param, spalte in (("typ", "a.AUAusruestungstyp"), ("mitarbeiter", "a.AUMitarbeiter")):
        v = request.args.get(param, type=int)
        if v:
            sql += f" AND {spalte}=?"
            args.append(v)
    sql += " ORDER BY t.AUTName COLLATE NOCASE, a.AUName COLLATE NOCASE"
    an_mich = rows(db.execute(
        f"""SELECT u.AUGID AS id, u.AUGAusruestung AS ausruestung_id, a.AUName AS name, u.AUGGestartetAm AS gestartet_am,
                   u.AUGNotiz AS notiz, {NAME_SQL.format(a='v')} AS von
            FROM tblAusruestungUebergaben u
            JOIN tblAusruestung a ON a.AUID=u.AUGAusruestung
            LEFT JOIN "tblMitarbeiter" v ON v.TCID=u.AUGVonMitarbeiter
            WHERE u.AUGAnMitarbeiter=? AND u.AUGStatus='offen' ORDER BY u.AUGGestartetAm""",
        (_ich(),),
    ))
    return {"ok": True, "eintraege": _mit_status(rows(db.execute(sql, args))), "an_mich": an_mich}


@bp.get("/ausruestung/stammdaten")
@login_required
def stammdaten():
    db = get_db()
    return {
        "ok": True,
        "ich": _ich(),
        "darf_alles": has_full_access(),
        "status": [{"id": k, "label": v} for k, v in STATUS.items()],
        "typen": rows(db.execute(
            "SELECT AUTID AS id, AUTName AS name, COALESCE(AUTKalibrierung,0) AS kalibrierung FROM tblAusruestungstypen "
            "ORDER BY AUTName COLLATE NOCASE"
        )),
        "mitarbeiter": rows(db.execute(
            f"""SELECT TCID AS id, {NAME_SQL.format(a='m')} AS name FROM "tblMitarbeiter" m
                WHERE COALESCE(TCAktiv,1)<>0 ORDER BY TCNachname COLLATE NOCASE, TCVorname COLLATE NOCASE"""
        )),
    }


@bp.get("/ausruestung/<int:auid>")
@login_required
def detail(auid: int):
    db = get_db()
    a = _laden(db, auid)
    voll = dict(db.execute("SELECT * FROM tblAusruestung WHERE AUID=?", (auid,)).fetchone())
    a.update({
        "baujahr": voll["AUBaujahr"], "anschaffungsdatum": voll["AUAnschaffungsdatum"],
        "beschreibung": voll["AUBeschreibung"], "kommentar": voll["AUKommentar"],
        "erstellt_am": voll["web_erstellt_am"], "erstellt_von": voll["web_erstellt_von"],
        "geaendert_am": voll["web_geaendert_am"], "geaendert_von": voll["web_geaendert_von"],
        "pruefung": pruefung_status(a["naechste_pruefung"]),
    })
    typ = db.execute("SELECT COALESCE(AUTKalibrierung,0) FROM tblAusruestungstypen WHERE AUTID=?", (a["typ_id"],)).fetchone()
    a["kalibrierpflichtig"] = bool(typ and typ[0])
    uebergaben = rows(db.execute(
        f"""SELECT u.AUGID AS id, u.AUGStatus AS status, u.AUGGestartetAm AS gestartet_am, u.AUGBestaetigtAm AS bestaetigt_am,
                   u.AUGNotiz AS notiz, u.AUGVonMitarbeiter AS von_id, u.AUGAnMitarbeiter AS an_id,
                   {NAME_SQL.format(a='v')} AS von, {NAME_SQL.format(a='e')} AS an
            FROM tblAusruestungUebergaben u
            LEFT JOIN "tblMitarbeiter" v ON v.TCID=u.AUGVonMitarbeiter
            LEFT JOIN "tblMitarbeiter" e ON e.TCID=u.AUGAnMitarbeiter
            WHERE u.AUGAusruestung=? ORDER BY u.AUGGestartetAm DESC, u.AUGID DESC""",
        (auid,),
    ))
    return {
        "ok": True,
        "ausruestung": a,
        "darf_bearbeiten": _darf(a),
        "uebergaben": uebergaben,
        "kalibrierungen": rows(db.execute(
            """SELECT AKID AS id, AKDatum AS datum, AKGueltigBis AS gueltig_bis, AKZertifikatNr AS zertifikat,
                      AKErgebnis AS ergebnis, AKBemerkung AS bemerkung
               FROM tblAusruestungKalibrierungen WHERE AKAusruestung=? ORDER BY AKDatum DESC, AKID DESC""",
            (auid,),
        )),
        "fotos": rows(db.execute(
            """SELECT foto_id AS id, originalname, beschreibung, aufnahmedatum, web_erstellt_von AS erstellt_von
               FROM web_fotos WHERE ausruestung_id=? ORDER BY foto_id DESC""",
            (auid,),
        )),
        "dokumente": rows(db.execute(
            """SELECT id, filename AS name, beschreibung, hochgeladen_am FROM web_attachments
               WHERE parent_table='tblAusruestung' AND parent_pk=? ORDER BY id DESC""",
            (auid,),
        )),
    }


def _datum(v, label: str):
    if v in (None, ""):
        return None
    try:
        return date.fromisoformat(str(v)[:10]).isoformat()
    except ValueError:
        raise Eingabefehler(f"{label}: ungültiges Datum.") from None


def _werte(db, data: dict) -> dict:
    w = {}
    for spalte, key in FELDER:
        if key not in data:
            continue
        v = data[key]
        v = v.strip() if isinstance(v, str) else v
        if v in ("", None):
            v = None
        if key == "name" and not v:
            raise Eingabefehler("Bitte einen Namen eingeben.")
        if key == "typ_id":
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise Eingabefehler("Bitte einen Ausrüstungstyp wählen.") from None
            if db.execute("SELECT 1 FROM tblAusruestungstypen WHERE AUTID=?", (v,)).fetchone() is None:
                raise Eingabefehler("Der gewählte Ausrüstungstyp ist ungültig.")
        elif key == "baujahr" and v is not None:
            try:
                v = int(v)
            except (TypeError, ValueError):
                raise Eingabefehler("Baujahr: bitte eine Jahreszahl eingeben.") from None
        elif key in ("anschaffungsdatum", "naechste_pruefung"):
            v = _datum(v, "Anschaffung" if key == "anschaffungsdatum" else "Nächste Prüfung")
        elif key == "status":
            v = v or "aktiv"
            if v not in STATUS:
                raise Eingabefehler("Ungültiger Status.")
        w[spalte] = v
    return w


def _mitarbeiter_pruefen(db, mid) -> int:
    try:
        mid = int(mid)
    except (TypeError, ValueError):
        raise Eingabefehler("Bitte einen Mitarbeiter wählen.") from None
    if db.execute('SELECT 1 FROM "tblMitarbeiter" WHERE TCID=? AND COALESCE(TCAktiv,1)<>0', (mid,)).fetchone() is None:
        raise Eingabefehler("Der ausgewählte Mitarbeiter ist nicht verfügbar.")
    return mid


@bp.post("/ausruestung")
@login_required
def anlegen():
    db = get_db()
    data = request.get_json(silent=True) or {}
    for pflicht in ("name", "typ_id"):
        data.setdefault(pflicht, None)
    w = _werte(db, data)
    w.setdefault("AUStatus", "aktiv")
    besitzer = data.get("besitzer_id")
    w["AUMitarbeiter"] = _mitarbeiter_pruefen(db, besitzer) if besitzer and has_full_access() else _ich()
    cur = db.execute(
        f"INSERT INTO tblAusruestung ({', '.join(w)}) VALUES ({', '.join('?' for _ in w)})", tuple(w.values())
    )
    db.commit()
    return {"ok": True, "id": cur.lastrowid}, 201


@bp.put("/ausruestung/<int:auid>")
@login_required
def aendern(auid: int):
    db = get_db()
    a = _laden(db, auid)
    _nur_wenn_darf(a)
    data = request.get_json(silent=True) or {}
    w = _werte(db, data)
    if "besitzer_id" in data and data["besitzer_id"] and int(data["besitzer_id"]) != a["besitzer_id"]:
        if not has_full_access():
            abort(403, description="Den Besitzer wechselst du über eine Übergabe.")
        w["AUMitarbeiter"] = _mitarbeiter_pruefen(db, data["besitzer_id"])
        # Eine offene Übergabe passt nicht mehr zum neuen Besitzer
        db.execute(
            "UPDATE tblAusruestungUebergaben SET AUGStatus='storniert', AUGBestaetigtAm=? "
            "WHERE AUGAusruestung=? AND AUGStatus='offen'",
            (_jetzt(), auid),
        )
    if w:
        db.execute(f"UPDATE tblAusruestung SET {', '.join(f'{k}=?' for k in w)} WHERE AUID=?", (*w.values(), auid))
    db.commit()
    return {"ok": True}


@bp.delete("/ausruestung/<int:auid>")
@login_required
def loeschen(auid: int):
    db = get_db()
    _laden(db, auid)
    if not has_full_access():
        abort(403, description="Löschen dürfen nur Admins und Dispatcher. Setze den Status sonst auf „Ausgemustert“.")
    if db.execute("SELECT 1 FROM web_fotos WHERE ausruestung_id=?", (auid,)).fetchone() or db.execute(
        "SELECT 1 FROM web_attachments WHERE parent_table='tblAusruestung' AND parent_pk=?", (auid,)
    ).fetchone():
        abort(409, description="Die Ausrüstung hat noch Fotos oder Dokumente. Setze den Status auf „Ausgemustert“.")
    db.execute("DELETE FROM tblAusruestung WHERE AUID=?", (auid,))
    db.commit()
    return {"ok": True}


def _jetzt() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


@bp.post("/ausruestung/<int:auid>/uebergabe")
@login_required
def uebergabe_starten(auid: int):
    db = get_db()
    a = _laden(db, auid)
    _nur_wenn_darf(a)
    if a["uebergabe_an"]:
        raise Eingabefehler("Für diese Ausrüstung ist bereits eine Übergabe offen.")
    data = request.get_json(silent=True) or {}
    an = _mitarbeiter_pruefen(db, data.get("an_id"))
    if an == a["besitzer_id"]:
        raise Eingabefehler("Bitte einen anderen Mitarbeiter auswählen.")
    db.execute(
        """INSERT INTO tblAusruestungUebergaben (AUGAusruestung, AUGVonMitarbeiter, AUGAnMitarbeiter, AUGStatus,
                  AUGGestartetAm, AUGNotiz) VALUES (?,?,?,'offen',?,?)""",
        (auid, a["besitzer_id"], an, _jetzt(), (str(data.get("notiz") or "").strip() or None)),
    )
    db.commit()
    return {"ok": True}


def _offene_uebergabe(db, augid: int) -> dict:
    u = row(db.execute("SELECT * FROM tblAusruestungUebergaben WHERE AUGID=?", (augid,)))
    if u is None:
        abort(404)
    if u["AUGStatus"] != "offen":
        abort(409, description="Diese Übergabe ist nicht mehr offen.")
    return u


@bp.post("/uebergaben/<int:augid>/<aktion>")
@login_required
def uebergabe_abschliessen(augid: int, aktion: str):
    db = get_db()
    u = _offene_uebergabe(db, augid)
    if aktion in ("annehmen", "ablehnen"):
        if int(u["AUGAnMitarbeiter"]) != _ich():
            abort(403, description="Nur der Empfänger kann die Übergabe annehmen oder ablehnen.")
    elif aktion == "stornieren":
        if int(u["AUGVonMitarbeiter"]) != _ich() and not has_full_access():
            abort(403, description="Nur wer übergibt, kann die Übergabe zurückziehen.")
    else:
        abort(404)
    status = {"annehmen": "angenommen", "ablehnen": "abgelehnt", "stornieren": "storniert"}[aktion]
    if aktion == "annehmen":
        besitzer = db.execute("SELECT AUMitarbeiter FROM tblAusruestung WHERE AUID=?", (u["AUGAusruestung"],)).fetchone()
        if besitzer is None or besitzer[0] != u["AUGVonMitarbeiter"]:
            db.execute("UPDATE tblAusruestungUebergaben SET AUGStatus='storniert', AUGBestaetigtAm=? WHERE AUGID=?",
                       (_jetzt(), augid))
            db.commit()
            abort(409, description="Die Ausrüstung gehört inzwischen jemand anderem. Die Übergabe wurde storniert.")
        db.execute("UPDATE tblAusruestung SET AUMitarbeiter=? WHERE AUID=?", (_ich(), u["AUGAusruestung"]))
    db.execute("UPDATE tblAusruestungUebergaben SET AUGStatus=?, AUGBestaetigtAm=? WHERE AUGID=?", (status, _jetzt(), augid))
    db.commit()
    return {"ok": True, "status": status}


@bp.post("/ausruestung/<int:auid>/kalibrierungen")
@login_required
def kalibrierung_anlegen(auid: int):
    db = get_db()
    a = _laden(db, auid)
    _nur_wenn_darf(a)
    data = request.get_json(silent=True) or {}
    datum = _datum(data.get("datum"), "Datum")
    if not datum:
        raise Eingabefehler("Bitte das Kalibrierdatum angeben.")
    bis = _datum(data.get("gueltig_bis"), "Gültig bis")
    if bis and bis < datum:
        raise Eingabefehler("„Gültig bis“ liegt vor dem Kalibrierdatum.")
    text = lambda k: (str(data.get(k) or "").strip() or None)  # noqa: E731
    db.execute(
        """INSERT INTO tblAusruestungKalibrierungen (AKAusruestung, AKDatum, AKGueltigBis, AKZertifikatNr, AKErgebnis, AKBemerkung)
           VALUES (?,?,?,?,?,?)""",
        (auid, datum, bis, text("zertifikat"), text("ergebnis"), text("bemerkung")),
    )
    # Die nächste Prüfung ergibt sich aus der neuesten Gültigkeit
    if bis and (not a["naechste_pruefung"] or bis > a["naechste_pruefung"][:10]):
        db.execute("UPDATE tblAusruestung SET AUNaechstePruefung=? WHERE AUID=?", (bis, auid))
    db.commit()
    return {"ok": True}


@bp.delete("/kalibrierungen/<int:akid>")
@login_required
def kalibrierung_loeschen(akid: int):
    db = get_db()
    k = db.execute("SELECT AKAusruestung FROM tblAusruestungKalibrierungen WHERE AKID=?", (akid,)).fetchone()
    if k is None:
        abort(404)
    _nur_wenn_darf(_laden(db, k[0]))
    if db.execute("SELECT 1 FROM web_attachments WHERE parent_table='tblAusruestungKalibrierungen' AND parent_pk=?",
                  (akid,)).fetchone():
        abort(409, description="An dieser Kalibrierung hängt ein Zertifikat und sie kann hier nicht gelöscht werden.")
    db.execute("DELETE FROM tblAusruestungKalibrierungen WHERE AKID=?", (akid,))
    db.commit()
    return {"ok": True}


@bp.post("/ausruestung/<int:auid>/fotos")
@login_required
def fotos_hochladen(auid: int):
    db = get_db()
    a = _laden(db, auid)
    _nur_wenn_darf(a)
    dateien = [d for d in request.files.getlist("fotos") if d and d.filename]
    if not dateien:
        raise Eingabefehler("Bitte mindestens ein Foto auswählen.")
    ordner = ["Ausrüstung", f"{_pfadteil(a['name'] or 'Ausruestung')}_AU_{auid}"]
    neu = fotos_speichern(db, dateien, ordner, {"ausruestung_id": auid})
    db.commit()
    return {"ok": True, "ids": neu}


@bp.get("/dokumente/<int:did>/datei")
@login_required
def dokument_datei(did: int):
    r = get_db().execute("SELECT relative_path, filename FROM web_attachments WHERE id=?", (did,)).fetchone()
    if r is None:
        abort(404)
    parts = [p for p in str(r["relative_path"] or "").replace("\\", "/").split("/") if p not in {"", "."}]
    if parts[:1] == ["attachments"]:
        parts = parts[1:]
    if not parts or ".." in parts:
        abort(404)
    root = current_app.config["SETTINGS"].documents_path.resolve()
    pfad = root.joinpath(*parts).resolve()
    if root not in pfad.parents or not pfad.is_file():
        abort(404, description="Die Datei wurde nicht gefunden.")
    return send_file(pfad, download_name=r["filename"] or pfad.name, max_age=3600)
