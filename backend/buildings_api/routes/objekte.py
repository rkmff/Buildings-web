"""Kunden & Anlagen: Objektbaum und Detailansichten (Kunde, System, ISP, Anlage, Gerät)."""
from flask import Blueprint, abort, current_app, send_file

from ..auth import login_required
from ..db import get_db, row, rows
from .objekte_bearbeiten import rechte

bp = Blueprint("objekte", __name__)


def _fotos(db, where: str, value: int) -> list[dict]:
    return rows(
        db.execute(
            f"""SELECT foto_id AS id, originalname, beschreibung, aufnahmedatum,
                       COALESCE(ist_uebersichtsfoto,0) AS ist_uebersichtsfoto
                FROM web_fotos WHERE {where} ORDER BY COALESCE(ist_uebersichtsfoto,0) DESC, foto_id DESC""",
            (value,),
        )
    )


def _dokumente(db, tabelle: str, pk: int) -> int:
    return db.execute("SELECT COUNT(*) FROM web_attachments WHERE parent_table=? AND parent_pk=?",
                      (tabelle, pk)).fetchone()[0]


@bp.get("/baum")
@login_required
def baum():
    """Kunden → Systeme → ISPs → Anlagen. Geräte lädt die Anlagenansicht nach."""
    db = get_db()
    kunden = rows(db.execute("SELECT KUID AS id, KUName AS name FROM tblKunden ORDER BY KUName COLLATE NOCASE"))
    systeme = rows(
        db.execute(
            """SELECT KSID AS id, KSKundeID AS kunde_id, KSKunde AS kunde_name, KSName AS name, KSOrt AS ort,
                      KSNiederlassung AS niederlassung_id
               FROM "tbKundenSysteme" ORDER BY KSName COLLATE NOCASE"""
        )
    )
    isps = rows(
        db.execute(
            'SELECT ISID AS id, ISKS AS system_id, ISName AS name, ISBeschreibung AS beschreibung FROM "tblISPs" '
            "ORDER BY ISName COLLATE NOCASE"
        )
    )
    anlagen = rows(
        db.execute(
            """SELECT a.ANID AS id, a.ANIS AS isp_id, a.ANName AS name, a.ANBeschreibung AS beschreibung,
                      (SELECT COUNT(*) FROM "tblGeRäte" g WHERE g.GRAN=a.ANID) AS geraete
               FROM "tblAnlagen" a ORDER BY a.ANName COLLATE NOCASE"""
        )
    )
    by_isp: dict = {}
    for a in anlagen:
        by_isp.setdefault(a["isp_id"], []).append(a)
    by_system: dict = {}
    for i in isps:
        i["anlagen"] = by_isp.get(i["id"], [])
        by_system.setdefault(i["system_id"], []).append(i)
    by_kunde: dict = {}
    for s in systeme:
        s["isps"] = by_system.get(s["id"], [])
        by_kunde.setdefault(s["kunde_id"], []).append(s)
    for k in kunden:
        k["systeme"] = by_kunde.pop(k["id"], [])
    ohne_kunde = [s for liste in by_kunde.values() for s in liste]
    if ohne_kunde:
        kunden.append({"id": None, "name": "Ohne Kunde", "systeme": ohne_kunde})
    return {"ok": True, "kunden": kunden, "rechte": rechte()}


@bp.get("/kunden/<int:kunde_id>")
@login_required
def kunde(kunde_id: int):
    db = get_db()
    k = row(db.execute("SELECT * FROM tblKunden WHERE KUID=?", (kunde_id,)))
    if k is None:
        abort(404)
    return {
        "ok": True,
        "kunde": k,
        "systeme": rows(
            db.execute(
                """SELECT s.KSID AS id, s.KSName AS name, s.KSOrt AS ort, n.NLName AS niederlassung,
                          (SELECT COUNT(*) FROM "tblISPs" i WHERE i.ISKS=s.KSID) AS isps
                   FROM "tbKundenSysteme" s LEFT JOIN tblNiederlassungen n ON n.NLID=s.KSNiederlassung
                   WHERE s.KSKundeID=? ORDER BY s.KSName COLLATE NOCASE""",
                (kunde_id,),
            )
        ),
        "ansprechpartner": rows(
            db.execute(
                """SELECT APID AS id, APVorname AS vorname, APNachname AS nachname, APFunktion AS funktion,
                          APTelefon AS telefon, APMobiltelefon AS mobil, APEmail AS email, APKommentar AS kommentar
                   FROM tblAnsprechpartner WHERE APKunde=? ORDER BY APNachname COLLATE NOCASE""",
                (kunde_id,),
            )
        ),
    }


@bp.get("/systeme/<int:system_id>")
@login_required
def system(system_id: int):
    db = get_db()
    s = row(
        db.execute(
            """SELECT s.*, le.TBName AS leitebene, ddc.TBName AS ddc, n.NLName AS niederlassung
               FROM "tbKundenSysteme" s
               LEFT JOIN "tblTypenBMS" le ON le.TBID=s.KSLeitebene
               LEFT JOIN "tblTypenBMS" ddc ON ddc.TBID=s.KSDDC
               LEFT JOIN tblNiederlassungen n ON n.NLID=s.KSNiederlassung
               WHERE s.KSID=?""",
            (system_id,),
        )
    )
    if s is None:
        abort(404)
    return {
        "ok": True,
        "system": s,
        "isps": rows(
            db.execute(
                """SELECT i.ISID AS id, i.ISName AS name, i.ISBeschreibung AS beschreibung, i.ISOrt AS ort,
                          t.TIName AS typ, b.TBName AS bms,
                          (SELECT COUNT(*) FROM "tblAnlagen" a WHERE a.ANIS=i.ISID) AS anlagen
                   FROM "tblISPs" i
                   LEFT JOIN "tblTypenISPs" t ON t.TIID=i.ISTyp
                   LEFT JOIN "tblTypenBMS" b ON b.TBID=i.ISBMS
                   WHERE i.ISKS=? ORDER BY i.ISName COLLATE NOCASE""",
                (system_id,),
            )
        ),
        "auftraege": rows(
            db.execute(
                """SELECT a.ATID AS id, a.ATName AS name, st.SAName AS status, ta.TAName AS typ,
                          m.TCVorname || ' ' || m.TCNachname AS techniker
                   FROM "tblAufTräge" a
                   LEFT JOIN "tblStatusAufträge" st ON st.SAID=a.ATStatus
                   LEFT JOIN "tblTypenAufträge" ta ON ta.TAID=a.ATTyp
                   LEFT JOIN "tblMitarbeiter" m ON m.TCID=a.ATVerantwortlicherTechniker
                   WHERE a.ATKS=? ORDER BY COALESCE(a.web_geaendert_am, a.web_erstellt_am) DESC, a.ATID DESC""",
                (system_id,),
            )
        ),
        "ansprechpartner": rows(
            db.execute(
                """SELECT APID AS id, APVorname AS vorname, APNachname AS nachname, APFunktion AS funktion,
                          APTelefon AS telefon, APMobiltelefon AS mobil, APEmail AS email, APKommentar AS kommentar
                   FROM tblAnsprechpartner WHERE APKS=? ORDER BY APNachname COLLATE NOCASE""",
                (system_id,),
            )
        ),
        "mitarbeiter": rows(
            db.execute(
                """SELECT ms.TSID AS zuordnung_id, m.TCID AS id, m.TCVorname || ' ' || m.TCNachname AS name,
                          COALESCE(ms.TSPrimary,0) AS primaer, m.TCEmail AS email, m.TCTelefon AS telefon,
                          ms.TSKommentar AS kommentar
                   FROM tblMitarbeiterSysteme ms JOIN "tblMitarbeiter" m ON m.TCID=ms.TSTechniker
                   WHERE ms.TSSystem=? ORDER BY ms.TSPrimary DESC, m.TCNachname""",
                (system_id,),
            )
        ),
        "aufgaben": rows(
            db.execute(
                """SELECT t.auftragsaufgabe_id AS id, t.titel, t.status, a.ATName AS auftrag,
                          TRIM(COALESCE(m.TCVorname,'') || ' ' || COALESCE(m.TCNachname,'')) AS mitarbeiter
                   FROM auftragsaufgaben t
                   LEFT JOIN "tblAufTräge" a ON a.ATID=t.auftrag_id
                   LEFT JOIN "tblMitarbeiter" m ON m.TCID=t.mitarbeiter_id
                   WHERE COALESCE(t.kunden_system_id, a.ATKS)=?
                   ORDER BY CASE WHEN t.status='erledigt' THEN 1 ELSE 0 END,
                            COALESCE(t.web_geaendert_am, t.web_erstellt_am) DESC""",
                (system_id,),
            )
        ),
        "fotos": _fotos(
            db,
            "kunden_system_id=? AND isp_id IS NULL AND anlage_id IS NULL AND geraet_id IS NULL "
            "AND auftrag_id IS NULL AND wartungsaufgabe_id IS NULL",
            system_id,
        ),
    }


@bp.get("/isps/<int:isp_id>")
@login_required
def isp(isp_id: int):
    db = get_db()
    i = row(
        db.execute(
            """SELECT i.*, t.TIName AS typ, b.TBName AS bms, s.KSName AS system_name, s.KSKunde AS kunde_name
               FROM "tblISPs" i
               LEFT JOIN "tblTypenISPs" t ON t.TIID=i.ISTyp
               LEFT JOIN "tblTypenBMS" b ON b.TBID=i.ISBMS
               LEFT JOIN "tbKundenSysteme" s ON s.KSID=i.ISKS
               WHERE i.ISID=?""",
            (isp_id,),
        )
    )
    if i is None:
        abort(404)
    return {
        "ok": True,
        "isp": i,
        "anlagen": rows(
            db.execute(
                """SELECT a.ANID AS id, a.ANName AS name, a.ANBeschreibung AS beschreibung, t.ANTName AS typ,
                          (SELECT COUNT(*) FROM "tblGeRäte" g WHERE g.GRAN=a.ANID) AS geraete
                   FROM "tblAnlagen" a LEFT JOIN tblAnlagentypen t ON t.ANTID=a.ANAnlagentyp
                   WHERE a.ANIS=? ORDER BY a.ANName COLLATE NOCASE""",
                (isp_id,),
            )
        ),
        "fotos": _fotos(db, "isp_id=? AND anlage_id IS NULL AND geraet_id IS NULL AND auftrag_id IS NULL "
                            "AND wartungsaufgabe_id IS NULL", isp_id),
        "dokumente_anzahl": _dokumente(db, "tblISPs", isp_id),
    }


ERGEBNIS_SQL = """
    SELECT w.ergebnis FROM wartungsaufgaben w
    WHERE w.geraet_id=g.GRID AND LOWER(TRIM(COALESCE(w.status,'')))='erledigt'
    ORDER BY COALESCE(w.erledigt_datum,'') DESC, w.wartungsaufgabe_id DESC LIMIT 1
"""


@bp.get("/anlagen/<int:anlage_id>")
@login_required
def anlage(anlage_id: int):
    db = get_db()
    a = row(
        db.execute(
            """SELECT a.*, t.ANTName AS typ, i.ISID AS isp_id, i.ISName AS isp_name,
                      s.KSID AS system_id, s.KSName AS system_name, s.KSKunde AS kunde_name
               FROM "tblAnlagen" a
               LEFT JOIN tblAnlagentypen t ON t.ANTID=a.ANAnlagentyp
               LEFT JOIN "tblISPs" i ON i.ISID=a.ANIS
               LEFT JOIN "tbKundenSysteme" s ON s.KSID=i.ISKS
               WHERE a.ANID=?""",
            (anlage_id,),
        )
    )
    if a is None:
        abort(404)
    geraete = rows(
        db.execute(
            f"""SELECT g.GRID AS id, g.GRName AS name, g.GRBMKZ AS bmkz, g.GRHersteller AS hersteller,
                       g.GRTyp AS typ, ga.GAName AS art, g.GREinbauort AS einbauort,
                       COALESCE(g.GRWartungspflichtig,0) AS wartungspflichtig,
                       ({ERGEBNIS_SQL}) AS letztes_ergebnis
                FROM "tblGeRäte" g LEFT JOIN "tblGeräteArten" ga ON ga.GAID=g.GRArt
                WHERE g.GRAN=? ORDER BY g.GRBMKZ, g.GRName COLLATE NOCASE""",
            (anlage_id,),
        )
    )
    return {
        "ok": True,
        "anlage": a,
        "geraete": geraete,
        "fotos": _fotos(db, "anlage_id=? AND geraet_id IS NULL AND auftrag_id IS NULL "
                            "AND wartungsaufgabe_id IS NULL", anlage_id),
        "dokumente_anzahl": _dokumente(db, "tblAnlagen", anlage_id),
    }


@bp.get("/geraete/<int:geraet_id>")
@login_required
def geraet(geraet_id: int):
    db = get_db()
    g_ = row(
        db.execute(
            """SELECT g.*, ga.GAName AS art, a.ANID AS anlage_id, a.ANName AS anlage_name,
                      i.ISID AS isp_id, i.ISName AS isp_name, s.KSID AS system_id, s.KSName AS system_name,
                      s.KSKunde AS kunde_name
               FROM "tblGeRäte" g
               LEFT JOIN "tblGeräteArten" ga ON ga.GAID=g.GRArt
               LEFT JOIN "tblAnlagen" a ON a.ANID=g.GRAN
               LEFT JOIN "tblISPs" i ON i.ISID=a.ANIS
               LEFT JOIN "tbKundenSysteme" s ON s.KSID=i.ISKS
               WHERE g.GRID=?""",
            (geraet_id,),
        )
    )
    if g_ is None:
        abort(404)
    return {
        "ok": True,
        "geraet": g_,
        "wartungsaufgaben": rows(
            db.execute(
                """SELECT w.wartungsaufgabe_id AS id, w.aufgabenname, w.status, w.ergebnis, w.erledigt_datum,
                          a.ATName AS auftrag, m.TCVorname || ' ' || m.TCNachname AS techniker
                   FROM wartungsaufgaben w
                   LEFT JOIN "tblAufTräge" a ON a.ATID=w.auftrag_id
                   LEFT JOIN "tblMitarbeiter" m ON m.TCID=w.techniker_id
                   WHERE w.geraet_id=? ORDER BY COALESCE(w.erledigt_datum,'9999') DESC, w.wartungsaufgabe_id DESC""",
                (geraet_id,),
            )
        ),
        "fotos": _fotos(db, "geraet_id=? AND wartungsaufgabe_id IS NULL", geraet_id),
        "dokumente_anzahl": _dokumente(db, "tblGeRäte", geraet_id),
    }


@bp.get("/fotos/<int:foto_id>/datei")
@login_required
def foto_datei(foto_id: int):
    r = get_db().execute("SELECT relative_path FROM web_fotos WHERE foto_id=?", (foto_id,)).fetchone()
    if r is None:
        abort(404)
    parts = [p for p in str(r["relative_path"] or "").replace("\\", "/").split("/") if p not in {"", "."}]
    if parts[:2] == ["uploads", "fotos"]:
        parts = parts[2:]
    if not parts or ".." in parts:
        abort(404)
    root = current_app.config["SETTINGS"].photos_path
    path = root.joinpath(*parts).resolve()
    if root not in path.parents or not path.is_file():
        abort(404, description="Die Fotodatei wurde nicht gefunden.")
    return send_file(path, max_age=86400)
