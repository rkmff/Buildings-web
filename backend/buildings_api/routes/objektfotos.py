"""Fotos an Kunden, Kundensystemen, ISPs, Anlagen, Geräten, Aufträgen, Aufgaben und Ausrüstung.

Hochladen per Dateiauswahl, Drag & Drop oder Screenshot aus der Zwischenablage; gespeichert wie die
Wartungsfotos (verkleinert, im Fotoordner, Zeile in web_fotos). Löschen und Beschreibung über /api/fotos/<id>.
"""
from flask import Blueprint, abort, g, request

from ..auth import has_full_access, login_required
from ..db import audit_user, get_db, rows
from .wartung import Eingabefehler, _pfadteil, fotos_speichern

bp = Blueprint("objektfotos", __name__)

# Fotos, die direkt am Objekt hängen (nicht an untergeordneten Objekten oder Wartungsaufgaben)
FILTER = {
    "kunde": "kunde_id=?",
    "system": "kunden_system_id=? AND isp_id IS NULL AND anlage_id IS NULL AND geraet_id IS NULL "
              "AND auftrag_id IS NULL AND wartungsaufgabe_id IS NULL AND aufgabe_id IS NULL",
    "isp": "isp_id=? AND anlage_id IS NULL AND geraet_id IS NULL AND auftrag_id IS NULL AND wartungsaufgabe_id IS NULL",
    "anlage": "anlage_id=? AND geraet_id IS NULL AND auftrag_id IS NULL AND wartungsaufgabe_id IS NULL",
    "geraet": "geraet_id=? AND wartungsaufgabe_id IS NULL",
    "auftrag": "auftrag_id=? AND wartungsaufgabe_id IS NULL",
    "aufgabe": "aufgabe_id=?",
    "ausruestung": "ausruestung_id=?",
}

MAX_FOTOS = 20


@bp.errorhandler(Eingabefehler)
def eingabefehler(err):
    return {"ok": False, "message": str(err)}, 400


def _ks(r) -> str:
    return f"{_pfadteil((r['KSKunde'] or '') + '_' + (r['KSName'] or ''))}_KS_{r['KSID']}"


def _ziel(db, art: str, pk: int) -> tuple[list[str], dict]:
    """Ordner (gleiche Struktur wie bisher) und Bezugsspalten für neue Fotos."""
    def eins(sql):
        r = db.execute(sql, (pk,)).fetchone()
        if r is None:
            abort(404, description="Das Objekt wurde nicht gefunden.")
        return r

    if art == "kunde":
        r = eins("SELECT KUID, KUName FROM tblKunden WHERE KUID=?")
        return [f"{_pfadteil(r['KUName'] or 'Kunde')}_KU_{pk}"], {"kunde_id": pk}
    if art == "system":
        r = eins('SELECT KSID, KSKunde, KSName FROM "tbKundenSysteme" WHERE KSID=?')
        return [_ks(r)], {"kunden_system_id": pk}
    if art == "isp":
        r = eins('''SELECT i.ISID, i.ISName, s.KSID, s.KSKunde, s.KSName FROM "tblISPs" i
                    LEFT JOIN "tbKundenSysteme" s ON s.KSID=i.ISKS WHERE i.ISID=?''')
        return [_ks(r), f"{_pfadteil(r['ISName'] or 'ISP')}_IS_{pk}"], {"kunden_system_id": r["KSID"], "isp_id": pk}
    if art == "anlage":
        r = eins('''SELECT a.ANID, a.ANName, i.ISID, i.ISName, s.KSID, s.KSKunde, s.KSName FROM "tblAnlagen" a
                    LEFT JOIN "tblISPs" i ON i.ISID=a.ANIS LEFT JOIN "tbKundenSysteme" s ON s.KSID=i.ISKS WHERE a.ANID=?''')
        return ([_ks(r), f"{_pfadteil(r['ISName'] or 'ISP')}_IS_{r['ISID']}", f"{_pfadteil(r['ANName'] or 'Anlage')}_AN_{pk}"],
                {"kunden_system_id": r["KSID"], "isp_id": r["ISID"], "anlage_id": pk})
    if art == "geraet":
        r = eins('''SELECT g.GRID, g.GRName, a.ANID, a.ANName, i.ISID, i.ISName, s.KSID, s.KSKunde, s.KSName
                    FROM "tblGeRäte" g LEFT JOIN "tblAnlagen" a ON a.ANID=g.GRAN LEFT JOIN "tblISPs" i ON i.ISID=a.ANIS
                    LEFT JOIN "tbKundenSysteme" s ON s.KSID=i.ISKS WHERE g.GRID=?''')
        return ([_ks(r), f"{_pfadteil(r['ISName'] or 'ISP')}_IS_{r['ISID']}", f"{_pfadteil(r['ANName'] or 'Anlage')}_AN_{r['ANID']}",
                 f"{_pfadteil(r['GRName'] or 'Geraet')}_GR_{pk}"],
                {"kunden_system_id": r["KSID"], "isp_id": r["ISID"], "anlage_id": r["ANID"], "geraet_id": pk})
    if art == "auftrag":
        r = eins('''SELECT a.ATID, a.ATName, s.KSID, s.KSKunde, s.KSName FROM "tblAufTräge" a
                    LEFT JOIN "tbKundenSysteme" s ON s.KSID=a.ATKS WHERE a.ATID=?''')
        ordner = [_ks(r)] if r["KSID"] else []
        return [*ordner, f"{_pfadteil(r['ATName'] or 'Auftrag')}_AT_{pk}"], {"auftrag_id": pk}
    if art == "aufgabe":
        r = eins("SELECT auftragsaufgabe_id, titel FROM auftragsaufgaben WHERE auftragsaufgabe_id=?")
        return ["Aufgaben", f"{_pfadteil(r['titel'] or 'Aufgabe')}_AF_{pk}"], {"aufgabe_id": pk}
    if art == "ausruestung":
        r = eins("SELECT AUID, AUName FROM tblAusruestung WHERE AUID=?")
        return ["Ausrüstung", f"{_pfadteil(r['AUName'] or 'Ausruestung')}_AU_{pk}"], {"ausruestung_id": pk}
    abort(404)


def _darf_hochladen(db, art: str, pk: int) -> bool:
    if art == "ausruestung" and not has_full_access():
        r = db.execute("SELECT AUMitarbeiter FROM tblAusruestung WHERE AUID=?", (pk,)).fetchone()
        return bool(r) and int(r[0] or 0) == int(g.user["TCID"])
    return True


def liste(db, art: str, pk: int) -> list[dict]:
    fotos = rows(db.execute(
        f"""SELECT foto_id AS id, originalname, beschreibung, aufnahmedatum, hochgeladen_am,
                   web_erstellt_von AS erstellt_von, COALESCE(ist_uebersichtsfoto,0) AS ist_uebersichtsfoto
            FROM web_fotos WHERE {FILTER[art]} ORDER BY COALESCE(ist_uebersichtsfoto,0) DESC, foto_id DESC""",
        (pk,),
    ))
    ich = audit_user()
    for f in fotos:
        f["darf_loeschen"] = has_full_access() or f["erstellt_von"] == ich
    return fotos


@bp.get("/objektfotos/<art>/<int:pk>")
@login_required
def fotos(art: str, pk: int):
    if art not in FILTER:
        abort(404)
    db = get_db()
    _ziel(db, art, pk)
    return {"ok": True, "fotos": liste(db, art, pk), "darf_hochladen": _darf_hochladen(db, art, pk)}


@bp.post("/objektfotos/<art>/<int:pk>")
@login_required
def hochladen(art: str, pk: int):
    if art not in FILTER:
        abort(404)
    db = get_db()
    ordner, ids = _ziel(db, art, pk)
    if not _darf_hochladen(db, art, pk):
        abort(403, description="Fotos an dieser Ausrüstung kann nur der Besitzer hinzufügen.")
    dateien = [d for d in request.files.getlist("fotos") if d and d.filename]
    if not dateien:
        raise Eingabefehler("Bitte mindestens ein Foto auswählen.")
    if len(dateien) > MAX_FOTOS:
        raise Eingabefehler(f"Höchstens {MAX_FOTOS} Fotos auf einmal.")
    neu = fotos_speichern(db, dateien, ordner, ids)
    db.commit()
    return {"ok": True, "ids": neu, "fotos": liste(db, art, pk)}
