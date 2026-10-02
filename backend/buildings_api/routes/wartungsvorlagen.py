"""Wartungsvorlagen und die beiden Zuordnungsmatrizen (Vorlage × Anlagentyp, Vorlage × Geräteart).

Pflegen dürfen Admins und Dispatcher, alle anderen sehen die Vorlagen nur. Die Lückenliste
(Anlagen ohne Anlagentyp, Geräte nicht wartungspflichtig) dürfen auch Techniker bearbeiten,
weil sie Anlagen und Geräte ohnehin pflegen.
"""
from flask import Blueprint, abort, request

from ..auth import has_full_access, login_required
from ..db import get_db, row, rows

bp = Blueprint("wartungsvorlagen", __name__)

AUFGABENTYPEN = {
    "standard": "Standard",
    "fuehlerkalibrierung": "Fühlerkalibrierung",
    "strommessung": "Strommessung",
    "schaltschrankmessung": "Schaltschrankmessung",
    "trafomessung": "Trafomessung",
}
# Tätigkeiten nach DIN 31051, auf die sich das VDMA-Leistungsprogramm 24186 stützt
TAETIGKEITEN = ["Inspektion", "Wartung", "Instandsetzung", "Messung"]

MATRIX = {
    "anlagen": ("wartungsaufgabenvorlage_anlagentypen", "anlagentyp_id", "tblAnlagentypen", "ANTID", "gilt_fuer_anlagen"),
    "geraete": ("wartungsaufgabenvorlage_geraetearten", "geraeteart_id", "tblGeräteArten", "GAID", "gilt_fuer_geraete"),
}

VORLAGE_SQL = """
    SELECT v.vorlage_id AS id, v.kurzbezeichnung, v.langtext, v.zeitvorgabe, v.aufgabentyp,
           v.kalibrierung_warn_grenze AS warn_grenze, v.kalibrierung_rot_grenze AS rot_grenze,
           COALESCE(v.gilt_fuer_anlagen,0) AS gilt_fuer_anlagen, COALESCE(v.gilt_fuer_geraete,0) AS gilt_fuer_geraete,
           v.vdma_position, v.taetigkeit,
           (SELECT COUNT(*) FROM wartungsaufgaben w WHERE w.vorlage_id=v.vorlage_id) AS verwendet
    FROM wartungsaufgabenvorlagen v
"""


def _nur_berechtigt():
    if not has_full_access():
        abort(403, description="Wartungsvorlagen pflegen nur Admins und Dispatcher.")


def _luecken_zahlen(db) -> dict:
    return {
        "anlagen_ohne_typ": db.execute('SELECT COUNT(*) FROM "tblAnlagen" WHERE ANAnlagentyp IS NULL').fetchone()[0],
        "geraete_ohne_art": db.execute('SELECT COUNT(*) FROM "tblGeRäte" WHERE GRArt IS NULL').fetchone()[0],
        "geraete_nicht_pflichtig": db.execute(
            """SELECT COUNT(*) FROM "tblGeRäte" g WHERE COALESCE(g.GRWartungspflichtig,0)=0
               AND EXISTS (SELECT 1 FROM wartungsaufgabenvorlage_geraetearten x WHERE x.geraeteart_id=g.GRArt)"""
        ).fetchone()[0],
    }


@bp.get("/wartungsvorlagen")
@login_required
def uebersicht():
    db = get_db()
    return {
        "ok": True,
        "darf_bearbeiten": has_full_access(),
        "aufgabentypen": [{"id": k, "label": v} for k, v in AUFGABENTYPEN.items()],
        "taetigkeiten": TAETIGKEITEN,
        "vorlagen": rows(db.execute(VORLAGE_SQL + " ORDER BY v.kurzbezeichnung COLLATE NOCASE")),
        "anlagentypen": rows(db.execute(
            """SELECT t.ANTID AS id, t.ANTName AS name, t.ANTKurzzeichen AS kurz,
                      (SELECT COUNT(*) FROM "tblAnlagen" a WHERE a.ANAnlagentyp=t.ANTID) AS anzahl
               FROM tblAnlagentypen t ORDER BY t.ANTName COLLATE NOCASE"""
        )),
        "geraetearten": rows(db.execute(
            """SELECT ga.GAID AS id, ga.GAName AS name,
                      (SELECT COUNT(*) FROM "tblGeRäte" g WHERE g.GRArt=ga.GAID) AS anzahl,
                      (SELECT COUNT(*) FROM "tblGeRäte" g WHERE g.GRArt=ga.GAID AND COALESCE(g.GRWartungspflichtig,0)<>0) AS pflichtig
               FROM "tblGeräteArten" ga ORDER BY ga.GAName COLLATE NOCASE"""
        )),
        "matrix": {
            "anlagen": [[r[0], r[1]] for r in db.execute("SELECT vorlage_id, anlagentyp_id FROM wartungsaufgabenvorlage_anlagentypen")],
            "geraete": [[r[0], r[1]] for r in db.execute("SELECT vorlage_id, geraeteart_id FROM wartungsaufgabenvorlage_geraetearten")],
        },
        "luecken": _luecken_zahlen(db),
    }


def _zahl(v, label: str, standard=None):
    if v in (None, ""):
        return standard
    try:
        return float(str(v).replace(",", "."))
    except ValueError:
        abort(400, description=f"{label}: bitte eine Zahl eingeben.")


def _werte(data: dict) -> dict:
    kurz = str(data.get("kurzbezeichnung") or "").strip()
    if not kurz:
        abort(400, description="Bitte eine Kurzbezeichnung eingeben.")
    typ = data.get("aufgabentyp") or "standard"
    if typ not in AUFGABENTYPEN:
        abort(400, description="Ungültiger Aufgabentyp.")
    taetigkeit = (data.get("taetigkeit") or None)
    if taetigkeit is not None and taetigkeit not in TAETIGKEITEN:
        abort(400, description="Ungültige Tätigkeit.")
    anlagen, geraete = bool(data.get("gilt_fuer_anlagen")), bool(data.get("gilt_fuer_geraete"))
    if not anlagen and not geraete:
        abort(400, description="Die Vorlage muss für Anlagen oder Geräte gelten.")
    w = {
        "kurzbezeichnung": kurz,
        "langtext": str(data.get("langtext") or "").strip() or None,
        "zeitvorgabe": _zahl(data.get("zeitvorgabe"), "Zeitvorgabe", 0),
        "aufgabentyp": typ,
        "gilt_fuer_anlagen": int(anlagen),
        "gilt_fuer_geraete": int(geraete),
        "vdma_position": str(data.get("vdma_position") or "").strip() or None,
        "taetigkeit": taetigkeit,
    }
    if typ == "fuehlerkalibrierung":
        w["kalibrierung_warn_grenze"] = _zahl(data.get("warn_grenze"), "Warngrenze", 0.5)
        w["kalibrierung_rot_grenze"] = _zahl(data.get("rot_grenze"), "Rote Grenze", 1.0)
        if w["kalibrierung_rot_grenze"] < w["kalibrierung_warn_grenze"]:
            abort(400, description="Die rote Grenze muss größer als die Warngrenze sein.")
    return w


def _zuordnungen_bereinigen(db, vid: int, w: dict):
    """Gilt eine Vorlage nicht mehr für Anlagen oder Geräte, fallen deren Matrix-Häkchen weg."""
    if not w["gilt_fuer_anlagen"]:
        db.execute("DELETE FROM wartungsaufgabenvorlage_anlagentypen WHERE vorlage_id=?", (vid,))
    if not w["gilt_fuer_geraete"]:
        db.execute("DELETE FROM wartungsaufgabenvorlage_geraetearten WHERE vorlage_id=?", (vid,))


@bp.post("/wartungsvorlagen")
@login_required
def anlegen():
    _nur_berechtigt()
    db = get_db()
    w = _werte(request.get_json(silent=True) or {})
    cur = db.execute(f"INSERT INTO wartungsaufgabenvorlagen ({', '.join(w)}) VALUES ({', '.join('?' for _ in w)})",
                     tuple(w.values()))
    db.commit()
    return {"ok": True, "vorlage": row(db.execute(VORLAGE_SQL + " WHERE v.vorlage_id=?", (cur.lastrowid,)))}, 201


@bp.put("/wartungsvorlagen/<int:vid>")
@login_required
def aendern(vid: int):
    _nur_berechtigt()
    db = get_db()
    if db.execute("SELECT 1 FROM wartungsaufgabenvorlagen WHERE vorlage_id=?", (vid,)).fetchone() is None:
        abort(404)
    w = _werte(request.get_json(silent=True) or {})
    db.execute(f"UPDATE wartungsaufgabenvorlagen SET {', '.join(f'{k}=?' for k in w)} WHERE vorlage_id=?", (*w.values(), vid))
    _zuordnungen_bereinigen(db, vid, w)
    db.commit()
    return {"ok": True, "vorlage": row(db.execute(VORLAGE_SQL + " WHERE v.vorlage_id=?", (vid,)))}


@bp.delete("/wartungsvorlagen/<int:vid>")
@login_required
def loeschen(vid: int):
    _nur_berechtigt()
    db = get_db()
    v = row(db.execute(VORLAGE_SQL + " WHERE v.vorlage_id=?", (vid,)))
    if v is None:
        abort(404)
    if v["verwendet"]:
        abort(409, description=f"Die Vorlage steckt in {v['verwendet']} Wartungsaufgaben. Nimm sie stattdessen aus den Matrizen, "
                               "dann wird sie nicht mehr erzeugt.")
    db.execute("DELETE FROM wartungsaufgabenvorlage_anlagentypen WHERE vorlage_id=?", (vid,))
    db.execute("DELETE FROM wartungsaufgabenvorlage_geraetearten WHERE vorlage_id=?", (vid,))
    db.execute("DELETE FROM wartungsaufgabenvorlagen WHERE vorlage_id=?", (vid,))
    db.commit()
    return {"ok": True}


@bp.put("/wartungsvorlagen/matrix/<art>")
@login_required
def matrix_setzen(art: str):
    """Ein Häkchen setzen oder entfernen: {vorlage_id, typ_id, an}."""
    _nur_berechtigt()
    if art not in MATRIX:
        abort(404)
    tabelle, spalte, typ_tabelle, typ_pk, gilt = MATRIX[art]
    db = get_db()
    data = request.get_json(silent=True) or {}
    try:
        vid, tid = int(data.get("vorlage_id")), int(data.get("typ_id"))
    except (TypeError, ValueError):
        abort(400, description="Vorlage und Typ fehlen.")
    v = db.execute(f"SELECT COALESCE({gilt},0) FROM wartungsaufgabenvorlagen WHERE vorlage_id=?", (vid,)).fetchone()
    if v is None or db.execute(f'SELECT 1 FROM "{typ_tabelle}" WHERE "{typ_pk}"=?', (tid,)).fetchone() is None:
        abort(404)
    if data.get("an"):
        if not v[0]:
            abort(400, description=f"Die Vorlage gilt nicht für {'Anlagen' if art == 'anlagen' else 'Geräte'}.")
        db.execute(f"INSERT OR IGNORE INTO {tabelle} (vorlage_id, {spalte}) VALUES (?,?)", (vid, tid))
    else:
        db.execute(f"DELETE FROM {tabelle} WHERE vorlage_id=? AND {spalte}=?", (vid, tid))
    db.commit()
    return {"ok": True}


@bp.get("/wartungsvorlagen/luecken")
@login_required
def luecken():
    """Anlagen ohne Anlagentyp und Geräte, die eine Vorlage hätten, aber nicht wartungspflichtig sind."""
    db = get_db()
    return {
        "ok": True,
        "anlagen": rows(db.execute(
            """SELECT a.ANID AS id, a.ANName AS name, a.ANBeschreibung AS beschreibung, i.ISName AS isp,
                      s.KSID AS system_id, s.KSKunde || ' · ' || s.KSName AS system
               FROM "tblAnlagen" a JOIN "tblISPs" i ON i.ISID=a.ANIS JOIN "tbKundenSysteme" s ON s.KSID=i.ISKS
               WHERE a.ANAnlagentyp IS NULL
               ORDER BY s.KSKunde COLLATE NOCASE, s.KSName COLLATE NOCASE, i.ISName COLLATE NOCASE, a.ANName COLLATE NOCASE"""
        )),
        "geraete": rows(db.execute(
            """SELECT g.GRID AS id, g.GRName AS name, g.GRBMKZ AS bmkz, ga.GAName AS art, a.ANName AS anlage,
                      s.KSID AS system_id, s.KSKunde || ' · ' || s.KSName AS system
               FROM "tblGeRäte" g JOIN "tblGeräteArten" ga ON ga.GAID=g.GRArt
               JOIN "tblAnlagen" a ON a.ANID=g.GRAN JOIN "tblISPs" i ON i.ISID=a.ANIS JOIN "tbKundenSysteme" s ON s.KSID=i.ISKS
               WHERE COALESCE(g.GRWartungspflichtig,0)=0
                 AND EXISTS (SELECT 1 FROM wartungsaufgabenvorlage_geraetearten x WHERE x.geraeteart_id=g.GRArt)
               ORDER BY s.KSKunde COLLATE NOCASE, s.KSName COLLATE NOCASE, a.ANName COLLATE NOCASE, g.GRBMKZ, g.GRName"""
        )),
    }


@bp.post("/wartungsvorlagen/luecken")
@login_required
def luecken_schliessen():
    """{anlagentypen: {anlage_id: typ_id}, wartungspflichtig: [geraet_id, ...]}"""
    db = get_db()
    data = request.get_json(silent=True) or {}
    typen = {r[0] for r in db.execute("SELECT ANTID FROM tblAnlagentypen")}
    n = 0
    for anid, tid in (data.get("anlagentypen") or {}).items():
        if tid is None or int(tid) not in typen:
            abort(400, description="Ungültiger Anlagentyp.")
        n += db.execute('UPDATE "tblAnlagen" SET ANAnlagentyp=? WHERE ANID=?', (int(tid), int(anid))).rowcount
    for gid in data.get("wartungspflichtig") or []:
        n += db.execute('UPDATE "tblGeRäte" SET GRWartungspflichtig=1 WHERE GRID=?', (int(gid),)).rowcount
    db.commit()
    return {"ok": True, "geaendert": n, "luecken": _luecken_zahlen(db)}
