"""Dokumente (PDF, Pläne, Datenblätter …) an Ausrüstung, ISPs, Anlagen, Geräten, Aufträgen und Aufgaben.

Die Dateien liegen im Dokumentenordner, die Verwaltung in web_attachments (parent_table/parent_pk),
wie im bisherigen Programm.
"""
from datetime import datetime
from pathlib import Path

from flask import Blueprint, abort, current_app, g, request, send_file

from ..auth import has_full_access, login_required
from ..db import audit_user, get_db, rows
from .wartung import _pfadteil

bp = Blueprint("dokumente", __name__)

# Kurzname der Objektart → (Tabelle, Primärschlüssel, Ordner, Kürzel)
ZIELE = {
    "ausruestung": ("tblAusruestung", "AUID", "Ausrüstung", "AU"),
    "isp": ("tblISPs", "ISID", "ISPs", "IS"),
    "anlage": ("tblAnlagen", "ANID", "Anlagen", "AN"),
    "geraet": ("tblGeRäte", "GRID", "Geraete", "GR"),
    "auftrag": ("tblAufTräge", "ATID", "Auftraege", "AT"),
    "aufgabe": ("auftragsaufgaben", "auftragsaufgabe_id", "Aufgaben", "AF"),
}

MAX_DATEIEN = 20


def _ziel(art: str, pk: int):
    if art not in ZIELE:
        abort(404)
    tabelle, spalte, ordner, kuerzel = ZIELE[art]
    db = get_db()
    if not db.execute(f'SELECT 1 FROM "{tabelle}" WHERE "{spalte}"=?', (pk,)).fetchone():
        abort(404, description="Das Objekt wurde nicht gefunden.")
    return db, tabelle, ordner, kuerzel


def _darf_hochladen(db, art: str, pk: int) -> bool:
    if art == "ausruestung" and not has_full_access():
        r = db.execute("SELECT AUMitarbeiter FROM tblAusruestung WHERE AUID=?", (pk,)).fetchone()
        return bool(r) and int(r[0] or 0) == int(g.user["TCID"])
    return True


def liste(db, tabelle: str, pk: int) -> list[dict]:
    eintraege = rows(db.execute(
        """SELECT id, filename AS name, file_type AS typ, beschreibung, hochgeladen_am,
                  web_erstellt_von AS erstellt_von
           FROM web_attachments WHERE parent_table=? AND parent_pk=?
           ORDER BY COALESCE(hochgeladen_am, web_erstellt_am) DESC, id DESC""",
        (tabelle, pk),
    ))
    ich = audit_user()
    for e in eintraege:
        e["darf_loeschen"] = has_full_access() or e["erstellt_von"] == ich
    return eintraege


@bp.get("/dokumente/<art>/<int:pk>")
@login_required
def dokumente(art: str, pk: int):
    db, tabelle, _, _ = _ziel(art, pk)
    return {"ok": True, "dokumente": liste(db, tabelle, pk), "darf_hochladen": _darf_hochladen(db, art, pk)}


@bp.post("/dokumente/<art>/<int:pk>")
@login_required
def hochladen(art: str, pk: int):
    db, tabelle, ordner, kuerzel = _ziel(art, pk)
    if not _darf_hochladen(db, art, pk):
        abort(403, description="Dokumente an dieser Ausrüstung kann nur der Besitzer hinzufügen.")
    dateien = [d for d in request.files.getlist("dateien") if d and d.filename]
    if not dateien:
        abort(400, description="Bitte mindestens eine Datei auswählen.")
    if len(dateien) > MAX_DATEIEN:
        abort(400, description=f"Höchstens {MAX_DATEIEN} Dateien auf einmal.")
    teile = [ordner, f"{kuerzel}_{pk}"]
    if art == "ausruestung":
        name = db.execute("SELECT AUName FROM tblAusruestung WHERE AUID=?", (pk,)).fetchone()[0]
        teile = [ordner, f"{_pfadteil(name or 'Ausruestung')}_AU_{pk}"]
    root = current_app.config["SETTINGS"].documents_path
    zielordner = root.joinpath(*teile)
    zielordner.mkdir(parents=True, exist_ok=True)
    beschreibung = str(request.form.get("beschreibung") or "").strip()[:500] or None
    neu = []
    for datei in dateien:
        original = Path(datei.filename).name[:255]
        endung = Path(original).suffix.lower()
        zeit = datetime.now().strftime("%Y%m%d_%H%M%S")
        dateiname, n = f"{zeit}_{_pfadteil(Path(original).stem)}{endung}", 2
        while (zielordner / dateiname).exists():
            dateiname, n = f"{zeit}_{_pfadteil(Path(original).stem)}_{n}{endung}", n + 1
        datei.save(zielordner / dateiname)
        cur = db.execute(
            """INSERT INTO web_attachments (parent_table, parent_pk, field_name, filename, file_type, relative_path,
                                            beschreibung, hochgeladen_am)
               VALUES (?, ?, 'web_upload', ?, ?, ?, ?, ?)""",
            (tabelle, pk, original, endung.lstrip(".") or None, "/".join([*teile, dateiname]), beschreibung,
             datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
        )
        neu.append(cur.lastrowid)
    db.commit()
    return {"ok": True, "ids": neu, "dokumente": liste(db, tabelle, pk)}


def _pfad(relative_path: str) -> Path | None:
    parts = [p for p in str(relative_path or "").replace("\\", "/").split("/") if p not in {"", "."}]
    if parts[:1] == ["attachments"]:
        parts = parts[1:]
    if not parts or ".." in parts:
        return None
    root = current_app.config["SETTINGS"].documents_path.resolve()
    pfad = root.joinpath(*parts).resolve()
    return pfad if root in pfad.parents else None


@bp.get("/dokumente/<int:did>/datei")
@login_required
def datei(did: int):
    r = get_db().execute("SELECT relative_path, filename FROM web_attachments WHERE id=?", (did,)).fetchone()
    if r is None:
        abort(404)
    pfad = _pfad(r["relative_path"])
    if pfad is None or not pfad.is_file():
        abort(404, description="Die Datei wurde nicht gefunden.")
    inline = request.args.get("anzeigen") == "1"
    return send_file(pfad, download_name=r["filename"] or pfad.name, as_attachment=not inline, max_age=3600)


@bp.delete("/dokumente/<int:did>")
@login_required
def loeschen(did: int):
    db = get_db()
    r = db.execute("SELECT relative_path, web_erstellt_von FROM web_attachments WHERE id=?", (did,)).fetchone()
    if r is None:
        abort(404)
    if not has_full_access() and r["web_erstellt_von"] != audit_user():
        abort(403, description="Dokumente löschen nur Admins, Dispatcher oder wer sie hochgeladen hat.")
    db.execute("DELETE FROM web_attachments WHERE id=?", (did,))
    db.commit()
    pfad = _pfad(r["relative_path"])
    if pfad is not None and pfad.is_file():
        pfad.unlink(missing_ok=True)
    return {"ok": True}
