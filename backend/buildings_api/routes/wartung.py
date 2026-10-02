"""Wartung ausführen: Wartungsaufträge, Ergebnisse, Messwerte, Kommentare und Fotos."""
import re
from datetime import datetime
from pathlib import Path

from flask import Blueprint, abort, current_app, g, request

from ..auth import has_full_access, login_required
from ..db import audit_user, get_db, row, rows
from .auftraege import LISTE_SQL
from .me import AKTIVER_STATUS_SQL

bp = Blueprint("wartung", __name__)

ERGEBNISSE = ("gut", "achtung", "schlecht", "neutral")
MESSTYPEN = ("fuehlerkalibrierung", "strommessung", "schaltschrankmessung", "trafomessung")
BILD_ENDUNGEN = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
MAX_KANTE = 2048
SCHALT_FELDER = {
    "u_l1_l2": "die Spannung L1-L2", "u_l2_l3": "die Spannung L2-L3", "u_l3_l1": "die Spannung L3-L1",
    "u_l1_n": "die Spannung L1-N", "u_l2_n": "die Spannung L2-N", "u_l3_n": "die Spannung L3-N",
    "i_l1": "den Strom L1", "i_l2": "den Strom L2", "i_l3": "den Strom L3", "i_n": "den Strom N",
}


class Eingabefehler(Exception):
    pass


@bp.errorhandler(Eingabefehler)
def _eingabefehler(err):
    return {"ok": False, "message": str(err)}, 400


@bp.get("/wartung")
@login_required
def liste():
    """Aufträge mit Wartungsaufgaben, eigene zuerst."""
    q = str(request.args.get("q") or "").strip()
    sql = LISTE_SQL + f"""
        WHERE EXISTS (SELECT 1 FROM wartungsaufgaben w WHERE w.auftrag_id=a.ATID)
    """
    params: list = []
    if request.args.get("alle") != "1":
        sql += f" AND {AKTIVER_STATUS_SQL}"
    if q:
        sql += """ AND (a.ATName LIKE ? OR s.KSKunde LIKE ? OR s.KSName LIKE ?)"""
        params += [f"%{q}%"] * 3
    sql += """ ORDER BY CASE WHEN a.ATVerantwortlicherTechniker=? THEN 0 ELSE 1 END,
               COALESCE(a.web_geaendert_am, a.web_erstellt_am) DESC"""
    params.append(g.user["TCID"])
    return {"ok": True, "auftraege": rows(get_db().execute(sql, params))}


def _auftrag(db, atid: int) -> dict:
    a = row(db.execute(LISTE_SQL + " WHERE a.ATID=?", (atid,)))
    if a is None:
        abort(404)
    return a


AUFGABE_SQL = """
    SELECT w.wartungsaufgabe_id AS id, w.aufgabenname AS name, w.beschreibung,
           LOWER(TRIM(COALESCE(w.status,'offen'))) AS status,
           LOWER(TRIM(COALESCE(w.ergebnis,'neutral'))) AS ergebnis,
           COALESCE(w.aufgabentyp,'standard') AS typ,
           w.erledigt_datum, w.erledigt_uhrzeit, w.zeitvorgabe,
           TRIM(COALESCE(t.TCVorname,'') || ' ' || COALESCE(t.TCNachname,'')) AS techniker,
           i.ISID AS isp_id, i.ISName AS isp, an.ANID AS anlage_id, an.ANName AS anlage,
           g.GRID AS geraet_id, g.GRName AS geraet, g.GRBMKZ AS bmkz, g.GREinbauort AS einbauort,
           w.kalibrierung_gemessen, w.kalibrierung_tatsaechlich, w.kalibrierung_offset_alt, w.kalibrierung_offset_neu,
           COALESCE(v.kalibrierung_warn_grenze, .5) AS warn_grenze,
           COALESCE(v.kalibrierung_rot_grenze, 1.0) AS rot_grenze,
           w.strom_spannung, w.strom_l1, w.strom_l2, w.strom_l3,
           w.schalt_u_l1_l2, w.schalt_u_l2_l3, w.schalt_u_l3_l1, w.schalt_u_l1_n, w.schalt_u_l2_n, w.schalt_u_l3_n,
           w.schalt_i_l1, w.schalt_i_l2, w.schalt_i_l3, w.schalt_i_n,
           w.trafo_primaer_spannung, w.trafo_primaer_strom, w.trafo_sekundaer_spannung,
           w.trafo_sekundaer_strom, w.trafo_sekundaer_art
    FROM wartungsaufgaben w
    JOIN "tblAnlagen" an ON an.ANID=w.anlage_id
    JOIN "tblISPs" i ON i.ISID=an.ANIS
    LEFT JOIN "tblGeRäte" g ON g.GRID=w.geraet_id
    LEFT JOIN "tblMitarbeiter" t ON t.TCID=w.techniker_id
    LEFT JOIN wartungsaufgabenvorlagen v ON v.vorlage_id=w.vorlage_id
"""


def _aufgabe(db, wid: int) -> dict:
    a = row(db.execute(AUFGABE_SQL + " WHERE w.wartungsaufgabe_id=?", (wid,)))
    if a is None:
        abort(404)
    return a


@bp.get("/wartung/<int:atid>")
@login_required
def detail(atid: int):
    db = get_db()
    auftrag = _auftrag(db, atid)
    aufgaben = rows(
        db.execute(
            AUFGABE_SQL
            + """ WHERE w.auftrag_id=?
                  ORDER BY i.ISName COLLATE NOCASE, an.ANName COLLATE NOCASE,
                           CASE WHEN w.geraet_id IS NULL THEN 0 ELSE 1 END,
                           g.GRName COLLATE NOCASE, w.wartungsaufgabe_id""",
            (atid,),
        )
    )
    kommentare = rows(
        db.execute(
            """SELECT k.kommentar_id AS id, k.wartungsaufgabe_id AS aufgabe_id, k.kommentar, k.intern,
                      k.name, k.datum, k.uhrzeit
               FROM wartungsaufgaben_kommentare k
               JOIN wartungsaufgaben w ON w.wartungsaufgabe_id=k.wartungsaufgabe_id
               WHERE w.auftrag_id=? ORDER BY k.kommentar_id""",
            (atid,),
        )
    )
    fotos = rows(
        db.execute(
            """SELECT f.foto_id AS id, f.wartungsaufgabe_id AS aufgabe_id, f.originalname, f.beschreibung,
                      f.aufnahmedatum, f.im_wartungsbericht
               FROM web_fotos f JOIN wartungsaufgaben w ON w.wartungsaufgabe_id=f.wartungsaufgabe_id
               WHERE w.auftrag_id=? ORDER BY f.foto_id""",
            (atid,),
        )
    )
    return {
        "ok": True,
        "auftrag": auftrag,
        "aufgaben": aufgaben,
        "kommentare": kommentare,
        "fotos": fotos,
        "ich": audit_user(),
        "darf_alles": has_full_access(),
    }


def _abschliessen(db, wid: int, ergebnis: str):
    jetzt = datetime.now()
    db.execute(
        """UPDATE wartungsaufgaben SET status='erledigt', ergebnis=?, erledigt_datum=?, erledigt_uhrzeit=?,
                  techniker_id=? WHERE wartungsaufgabe_id=?""",
        (ergebnis, jetzt.strftime("%Y-%m-%d"), jetzt.strftime("%H:%M:%S"), g.user["TCID"], wid),
    )


@bp.post("/wartungsaufgaben/<int:wid>/ergebnis")
@login_required
def ergebnis_setzen(wid: int):
    data = request.get_json(silent=True) or {}
    ergebnis = str(data.get("ergebnis") or "").strip().lower()
    if ergebnis not in ERGEBNISSE:
        raise Eingabefehler("Ungültiges Ergebnis.")
    db = get_db()
    _aufgabe(db, wid)
    _abschliessen(db, wid, ergebnis)
    db.commit()
    return {"ok": True, "aufgabe": _aufgabe(db, wid)}


@bp.post("/wartungsaufgaben/<int:wid>/oeffnen")
@login_required
def oeffnen(wid: int):
    db = get_db()
    _aufgabe(db, wid)
    db.execute(
        """UPDATE wartungsaufgaben SET status='offen', ergebnis='neutral', erledigt_datum=NULL,
                  erledigt_uhrzeit=NULL, techniker_id=NULL WHERE wartungsaufgabe_id=?""",
        (wid,),
    )
    db.commit()
    return {"ok": True, "aufgabe": _aufgabe(db, wid)}


def _zahl(data: dict, feld: str, label: str, pflicht: bool = True):
    raw = str(data.get(feld) if data.get(feld) is not None else "").strip().replace(",", ".")
    if raw == "":
        if pflicht:
            raise Eingabefehler(f"Bitte {label} eingeben.")
        return None
    try:
        return float(raw)
    except ValueError:
        raise Eingabefehler(f"{label} ist keine gültige Zahl.") from None


@bp.post("/wartungsaufgaben/<int:wid>/messung")
@login_required
def messung(wid: int):
    """Speichert die Messwerte der Aufgabe und setzt sie wie bisher auf „gut“ (änderbar)."""
    data = request.get_json(silent=True) or {}
    db = get_db()
    typ = _aufgabe(db, wid)["typ"]
    if typ == "fuehlerkalibrierung":
        gemessen = _zahl(data, "gemessen", "die gemessene Temperatur")
        angezeigt = _zahl(data, "angezeigt", "die angezeigte Temperatur")
        offset_alt = _zahl(data, "offset_alt", "das bisherige Offset")
        offset_neu = round(offset_alt + (gemessen - angezeigt), 3)
        db.execute(
            """UPDATE wartungsaufgaben SET kalibrierung_gemessen=?, kalibrierung_tatsaechlich=?,
                      kalibrierung_offset_alt=?, kalibrierung_offset_neu=? WHERE wartungsaufgabe_id=?""",
            (gemessen, angezeigt, offset_alt, offset_neu, wid),
        )
    elif typ == "strommessung":
        try:
            spannung = int(data.get("spannung") or 400)
        except (TypeError, ValueError):
            spannung = 0
        if spannung not in (230, 400):
            raise Eingabefehler("Die Spannung muss 230 V oder 400 V sein.")
        l1 = _zahl(data, "l1", "den Strom L1")
        l2 = _zahl(data, "l2", "den Strom L2") if spannung == 400 else None
        l3 = _zahl(data, "l3", "den Strom L3") if spannung == 400 else None
        db.execute(
            "UPDATE wartungsaufgaben SET strom_spannung=?, strom_l1=?, strom_l2=?, strom_l3=? WHERE wartungsaufgabe_id=?",
            (spannung, l1, l2, l3, wid),
        )
    elif typ == "schaltschrankmessung":
        werte = [_zahl(data, f, label) for f, label in SCHALT_FELDER.items()]
        spalten = ", ".join(f"schalt_{f}=?" for f in SCHALT_FELDER)
        db.execute(f"UPDATE wartungsaufgaben SET {spalten} WHERE wartungsaufgabe_id=?", (*werte, wid))
    elif typ == "trafomessung":
        art = str(data.get("sekundaer_art") or "AC").strip().upper()
        if art not in {"AC", "DC"}:
            raise Eingabefehler("Sekundär muss AC oder DC sein.")
        werte = [
            _zahl(data, "primaer_spannung", "die Primärspannung"),
            _zahl(data, "primaer_strom", "den Primärstrom"),
            _zahl(data, "sekundaer_spannung", "die Sekundärspannung"),
            _zahl(data, "sekundaer_strom", "den Sekundärstrom"),
        ]
        db.execute(
            """UPDATE wartungsaufgaben SET trafo_primaer_spannung=?, trafo_primaer_strom=?,
                      trafo_sekundaer_spannung=?, trafo_sekundaer_strom=?, trafo_sekundaer_art=?
               WHERE wartungsaufgabe_id=?""",
            (*werte, art, wid),
        )
    else:
        raise Eingabefehler("Diese Aufgabe hat keine Messwerte.")
    _abschliessen(db, wid, "gut")
    db.commit()
    return {"ok": True, "aufgabe": _aufgabe(db, wid)}


# ---------- Kommentare ----------

def _kommentar(db, kid: int):
    k = db.execute("SELECT * FROM wartungsaufgaben_kommentare WHERE kommentar_id=?", (kid,)).fetchone()
    if k is None:
        abort(404)
    if k["name"] != audit_user() and not has_full_access():
        abort(403, description="Nur eigene Kommentare können geändert werden.")
    return k


@bp.post("/wartungsaufgaben/<int:wid>/kommentare")
@login_required
def kommentar_anlegen(wid: int):
    data = request.get_json(silent=True) or {}
    text = str(data.get("kommentar") or "").strip()
    if not text:
        raise Eingabefehler("Bitte einen Kommentar eingeben.")
    db = get_db()
    _aufgabe(db, wid)
    jetzt = datetime.now()
    cur = db.execute(
        """INSERT INTO wartungsaufgaben_kommentare (wartungsaufgabe_id, kommentar, intern, name, datum, uhrzeit)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (wid, text, 1 if data.get("intern") else 0, audit_user(), jetzt.strftime("%Y-%m-%d"), jetzt.strftime("%H:%M:%S")),
    )
    db.commit()
    return {"ok": True, "id": cur.lastrowid}


@bp.put("/wartungskommentare/<int:kid>")
@login_required
def kommentar_aendern(kid: int):
    data = request.get_json(silent=True) or {}
    text = str(data.get("kommentar") or "").strip()
    if not text:
        raise Eingabefehler("Bitte einen Kommentar eingeben.")
    db = get_db()
    _kommentar(db, kid)
    db.execute(
        "UPDATE wartungsaufgaben_kommentare SET kommentar=?, intern=? WHERE kommentar_id=?",
        (text, 1 if data.get("intern") else 0, kid),
    )
    db.commit()
    return {"ok": True}


@bp.delete("/wartungskommentare/<int:kid>")
@login_required
def kommentar_loeschen(kid: int):
    db = get_db()
    _kommentar(db, kid)
    db.execute("DELETE FROM wartungsaufgaben_kommentare WHERE kommentar_id=?", (kid,))
    db.commit()
    return {"ok": True}


# ---------- Fotos ----------

def _pfadteil(text) -> str:
    text = str(text or "").strip()
    for alt, neu in {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue"}.items():
        text = text.replace(alt, neu)
    text = re.sub(r"\s+", "_", text)
    text = re.sub(r"[^A-Za-z0-9._-]+", "_", text)
    return re.sub(r"_+", "_", text).strip("._-") or "Unbenannt"


def _ordner(db, wid: int) -> tuple[list[str], dict]:
    r = db.execute(
        """SELECT w.wartungsaufgabe_id, w.aufgabenname, w.geraet_id, a.ATID, a.ATName,
                  an.ANID, i.ISID, s.KSID, s.KSKunde, s.KSName
           FROM wartungsaufgaben w
           JOIN "tblAufTräge" a ON a.ATID=w.auftrag_id
           JOIN "tblAnlagen" an ON an.ANID=w.anlage_id
           JOIN "tblISPs" i ON i.ISID=an.ANIS
           JOIN "tbKundenSysteme" s ON s.KSID=a.ATKS
           WHERE w.wartungsaufgabe_id=?""",
        (wid,),
    ).fetchone()
    if r is None:
        abort(404, description="Die Wartungsaufgabe gehört zu keinem Auftrag.")
    # Gleiche Ordnerstruktur wie in der bisherigen Anwendung.
    ordner = [
        f"{_pfadteil(r['KSKunde'] + '_' + r['KSName'])}_KS_{r['KSID']}",
        f"{_pfadteil(r['ATName'] or 'Auftrag')}_AT_{r['ATID']}",
        "Wartungsaufgaben",
        f"{_pfadteil(r['aufgabenname'] or 'Wartungsaufgabe')}_WA_{r['wartungsaufgabe_id']}",
    ]
    ids = {
        "kunden_system_id": r["KSID"], "isp_id": r["ISID"], "anlage_id": r["ANID"],
        "geraet_id": r["geraet_id"], "auftrag_id": r["ATID"], "wartungsaufgabe_id": wid,
    }
    return ordner, ids


def _bild_speichern(datei, ziel: Path) -> str | None:
    """Speichert verkleinert (max. 2048 px) und gibt das EXIF-Aufnahmedatum zurück."""
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        with Image.open(datei.stream) as quelle:
            datum = None
            exif = quelle.getexif()
            for tag in (36867, 36868, 306):
                wert = exif.get(tag) if exif else None
                m = re.match(r"(\d{4})[:\-](\d{2})[:\-](\d{2})", str(wert or ""))
                if m:
                    datum = "-".join(m.groups())
                    break
            if ziel.suffix == ".gif":
                datei.stream.seek(0)
                datei.save(ziel)
                return datum
            bild = ImageOps.exif_transpose(quelle)
            bild.thumbnail((MAX_KANTE, MAX_KANTE))
            if ziel.suffix in {".jpg", ".jpeg"} and bild.mode not in {"RGB", "L"}:
                bild = bild.convert("RGB")
            bild.save(ziel, quality=85, optimize=True)
            return datum
    except (UnidentifiedImageError, OSError, ValueError):
        raise Eingabefehler(f"„{datei.filename}“ ist kein lesbares Bild.") from None


@bp.post("/wartungsaufgaben/<int:wid>/fotos")
@login_required
def fotos_hochladen(wid: int):
    dateien = [d for d in request.files.getlist("fotos") if d and d.filename]
    if not dateien:
        raise Eingabefehler("Bitte mindestens ein Foto auswählen.")
    db = get_db()
    ordner, ids = _ordner(db, wid)
    neu = fotos_speichern(db, dateien, ordner, ids)
    db.commit()
    return {"ok": True, "ids": neu}


def fotos_speichern(db, dateien, ordner: list[str], ids: dict) -> list[int]:
    """Speichert Fotos im Fotoordner (gleiche Struktur wie bisher) und legt die web_fotos-Zeilen an."""
    root = current_app.config["SETTINGS"].photos_path
    zielordner = root.joinpath(*ordner)
    zielordner.mkdir(parents=True, exist_ok=True)
    neu = []
    for datei in dateien:
        endung = Path(datei.filename).suffix.lower()
        if endung not in BILD_ENDUNGEN:
            endung = ".jpg"
        stamm = _pfadteil(Path(datei.filename).stem)
        zeit = datetime.now().strftime("%Y%m%d_%H%M%S")
        name, n = f"{zeit}_{stamm}{endung}", 2
        while (zielordner / name).exists():
            name, n = f"{zeit}_{stamm}_{n}{endung}", n + 1
        ziel = zielordner / name
        try:
            datum = _bild_speichern(datei, ziel)
        except Eingabefehler:
            ziel.unlink(missing_ok=True)
            raise
        werte = {
            **ids,
            "originalname": datei.filename[:255],
            "dateiname": name,
            "relative_path": "/".join(["uploads", "fotos", *ordner, name]),
            "aufnahmedatum": datum,
            "hochgeladen_am": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }
        cur = db.execute(
            f"INSERT INTO web_fotos ({', '.join(werte)}) VALUES ({', '.join(':' + k for k in werte)})", werte
        )
        neu.append(cur.lastrowid)
    return neu


def _foto(db, fid: int):
    f = db.execute("SELECT * FROM web_fotos WHERE foto_id=?", (fid,)).fetchone()
    if f is None:
        abort(404)
    return f


@bp.patch("/fotos/<int:fid>")
@login_required
def foto_aendern(fid: int):
    data = request.get_json(silent=True) or {}
    db = get_db()
    _foto(db, fid)
    if "im_wartungsbericht" in data:
        db.execute("UPDATE web_fotos SET im_wartungsbericht=? WHERE foto_id=?", (1 if data["im_wartungsbericht"] else 0, fid))
    if "beschreibung" in data:
        db.execute("UPDATE web_fotos SET beschreibung=? WHERE foto_id=?", (str(data["beschreibung"] or "").strip() or None, fid))
    db.commit()
    return {"ok": True}


@bp.delete("/fotos/<int:fid>")
@login_required
def foto_loeschen(fid: int):
    db = get_db()
    f = _foto(db, fid)
    if f["web_erstellt_von"] != audit_user() and not has_full_access():
        abort(403, description="Nur eigene Fotos können gelöscht werden.")
    db.execute("DELETE FROM web_fotos WHERE foto_id=?", (fid,))
    db.commit()
    parts = [p for p in str(f["relative_path"] or "").replace("\\", "/").split("/") if p not in {"", "."}]
    if parts[:2] == ["uploads", "fotos"]:
        parts = parts[2:]
    root = current_app.config["SETTINGS"].photos_path
    if parts and ".." not in parts:
        pfad = root.joinpath(*parts).resolve()
        if root.resolve() in pfad.parents:
            pfad.unlink(missing_ok=True)
    return {"ok": True}
