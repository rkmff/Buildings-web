"""Mitarbeiter an einer Stelle: Person, Zugang, Wochenplanung, Schulungen, Systeme und Ausrüstung."""
import re

from flask import Blueprint, abort, g, request

from ..auth import ROLES, has_full_access, login_required, role
from ..db import get_db, row, rows
from ..security import make_password_hash

bp = Blueprint("mitarbeiter", __name__)

LISTE_SQL = """
    SELECT m.TCID AS id, m.TCVorname AS vorname, m.TCNachname AS nachname, m.TCFunktion AS funktion,
           m.TCTelefon AS telefon, m.TCEmail AS email, m.TCNiederlassung AS niederlassung_id,
           nl.NLName AS niederlassung, nl.NLKurzzeichen AS niederlassung_kurz,
           COALESCE(m.TCAktiv,1) AS aktiv, COALESCE(m.TCInWochenplanung,1) AS in_wochenplanung,
           m.TCWochenplanungSortierung AS sortierung, m.TCRolle AS rolle,
           CASE WHEN COALESCE(TRIM(m.TCBenutzername),'')<>'' THEN 1 ELSE 0 END AS hat_zugang,
           (SELECT COUNT(*) FROM tblAusruestung a WHERE a.AUMitarbeiter=m.TCID
                AND LOWER(COALESCE(a.AUStatus,'aktiv'))<>'ausgemustert') AS ausruestung_anzahl,
           (SELECT COUNT(*) FROM tblMitarbeiterSchulungen s WHERE s.MSMitarbeiter=m.TCID) AS schulungen_anzahl,
           (SELECT COUNT(*) FROM tblMitarbeiterSysteme t WHERE t.TSTechniker=m.TCID) AS systeme_anzahl
    FROM "tblMitarbeiter" m
    LEFT JOIN tblNiederlassungen nl ON nl.NLID=m.TCNiederlassung
"""

SORTIERUNG_SQL = """ ORDER BY COALESCE(nl.NLName,'~') COLLATE NOCASE, COALESCE(m.TCWochenplanungSortierung,999999),
                     m.TCNachname COLLATE NOCASE, m.TCVorname COLLATE NOCASE, m.TCID"""


def _voll():
    if not has_full_access():
        abort(403, description="Nur Admin und Disposition dürfen Mitarbeiter ändern.")


def _mitarbeiter(db, tcid: int):
    m = row(db.execute(LISTE_SQL + " WHERE m.TCID=?", (tcid,)))
    if m is None:
        abort(404)
    return m


@bp.get("/mitarbeiter")
@login_required
def liste():
    q = str(request.args.get("q") or "").strip()
    sql = LISTE_SQL + " WHERE 1=1"
    params: list = []
    if request.args.get("inaktive") != "1":
        sql += " AND COALESCE(m.TCAktiv,1)<>0"
    nl = str(request.args.get("niederlassung_id") or "")
    if nl.isdigit():
        sql += " AND m.TCNiederlassung=?"
        params.append(int(nl))
    if q:
        sql += """ AND (m.TCVorname LIKE ? OR m.TCNachname LIKE ? OR m.TCFunktion LIKE ? OR m.TCTelefon LIKE ?
                       OR m.TCEmail LIKE ? OR (COALESCE(m.TCVorname,'') || ' ' || COALESCE(m.TCNachname,'')) LIKE ?)"""
        params += [f"%{q}%"] * 6
    return {"ok": True, "mitarbeiter": rows(get_db().execute(sql + SORTIERUNG_SQL, params))}


@bp.get("/mitarbeiter/stammdaten")
@login_required
def stammdaten():
    db = get_db()
    return {
        "ok": True,
        "darf_bearbeiten": has_full_access(),
        "darf_zugang": role() == "admin",
        "rollen": [
            {"wert": "mitarbeiter", "label": "Mitarbeiter"},
            {"wert": "dispatcher", "label": "Disposition"},
            {"wert": "admin", "label": "Administrator"},
        ],
        "niederlassungen": rows(
            db.execute("SELECT NLID AS id, NLKurzzeichen AS kurz, NLName AS name FROM tblNiederlassungen ORDER BY NLName COLLATE NOCASE")
        ),
        "systeme": rows(
            db.execute(
                """SELECT KSID AS id, KSKunde AS kunde, KSName AS name FROM "tbKundenSysteme"
                   ORDER BY KSKunde COLLATE NOCASE, KSName COLLATE NOCASE"""
            )
        ),
    }


@bp.get("/mitarbeiter/<int:tcid>")
@login_required
def detail(tcid: int):
    db = get_db()
    m = _mitarbeiter(db, tcid)
    roh = db.execute(
        """SELECT TCEintrittsdatum, TCKommentar, TCBenutzername, TCLetzterLogin, TCMussPasswortAendern
           FROM "tblMitarbeiter" WHERE TCID=?""",
        (tcid,),
    ).fetchone()
    m.update(eintrittsdatum=roh["TCEintrittsdatum"], kommentar=roh["TCKommentar"])
    if role() == "admin" or tcid == g.user["TCID"]:
        m.update(
            benutzername=roh["TCBenutzername"],
            letzter_login=roh["TCLetzterLogin"],
            muss_passwort_aendern=bool(roh["TCMussPasswortAendern"]),
        )
    return {
        "ok": True,
        "mitarbeiter": m,
        "schulungen": rows(
            db.execute(
                """SELECT MSID AS id, MSSchulungsbezeichnung AS bezeichnung, MSAbschlussdatum AS datum,
                          MSBeschreibung AS beschreibung
                   FROM tblMitarbeiterSchulungen WHERE MSMitarbeiter=?
                   ORDER BY COALESCE(MSAbschlussdatum,'') DESC, MSID DESC""",
                (tcid,),
            )
        ),
        "systeme": rows(
            db.execute(
                """SELECT t.TSID AS id, t.TSSystem AS system_id, s.KSKunde AS kunde, s.KSName AS system,
                          COALESCE(t.TSPrimary,0) AS hauptverantwortlich, t.TSKommentar AS kommentar
                   FROM tblMitarbeiterSysteme t LEFT JOIN "tbKundenSysteme" s ON s.KSID=t.TSSystem
                   WHERE t.TSTechniker=? ORDER BY COALESCE(t.TSPrimary,0) DESC, s.KSKunde COLLATE NOCASE""",
                (tcid,),
            )
        ),
        "ausruestung": rows(
            db.execute(
                """SELECT u.AUID AS id, u.AUName AS name, t.AUTName AS typ, u.AUStatus AS status,
                          u.AUNaechstePruefung AS naechste_pruefung
                   FROM tblAusruestung u LEFT JOIN tblAusruestungstypen t ON t.AUTID=u.AUAusruestungstyp
                   WHERE u.AUMitarbeiter=? ORDER BY t.AUTName COLLATE NOCASE, u.AUName COLLATE NOCASE""",
                (tcid,),
            )
        ),
    }


def _text(data: dict, feld: str, laenge: int = 200):
    return str(data.get(feld) or "").strip()[:laenge] or None


def _person_werte(db, data: dict) -> dict:
    nachname, vorname = _text(data, "nachname", 80), _text(data, "vorname", 80)
    if not nachname and not vorname:
        abort(400, description="Bitte Vor- oder Nachnamen eingeben.")
    email = _text(data, "email", 120)
    if email and not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        abort(400, description="Die E-Mail-Adresse ist ungültig.")
    datum = _text(data, "eintrittsdatum", 10)
    if datum and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", datum):
        abort(400, description="Das Eintrittsdatum ist ungültig.")
    nl = data.get("niederlassung_id") or None
    if nl is not None and not db.execute("SELECT 1 FROM tblNiederlassungen WHERE NLID=?", (nl,)).fetchone():
        abort(400, description="Unbekannte Niederlassung.")
    return {
        "TCNachname": nachname,
        "TCVorname": vorname,
        "TCFunktion": _text(data, "funktion", 80),
        "TCTelefon": _text(data, "telefon", 60),
        "TCEmail": email,
        "TCEintrittsdatum": datum,
        "TCKommentar": _text(data, "kommentar", 4000),
        "TCNiederlassung": nl,
        "TCInWochenplanung": 1 if data.get("in_wochenplanung", True) else 0,
        "TCAktiv": 1 if data.get("aktiv", True) else 0,
    }


@bp.post("/mitarbeiter")
@login_required
def anlegen():
    _voll()
    db = get_db()
    werte = _person_werte(db, request.get_json(silent=True) or {})
    werte["TCWochenplanungSortierung"] = (
        db.execute('SELECT COALESCE(MAX(TCWochenplanungSortierung),0)+10 FROM "tblMitarbeiter"').fetchone()[0]
    )
    spalten = ", ".join(werte)
    cur = db.execute(
        f'INSERT INTO "tblMitarbeiter" ({spalten}) VALUES ({", ".join("?" * len(werte))})', tuple(werte.values())
    )
    db.commit()
    return {"ok": True, "mitarbeiter": _mitarbeiter(db, cur.lastrowid)}


@bp.put("/mitarbeiter/<int:tcid>")
@login_required
def aendern(tcid: int):
    _voll()
    db = get_db()
    _mitarbeiter(db, tcid)
    werte = _person_werte(db, request.get_json(silent=True) or {})
    if tcid == g.user["TCID"] and not werte["TCAktiv"]:
        abort(400, description="Du kannst dich nicht selbst deaktivieren.")
    db.execute(
        f'UPDATE "tblMitarbeiter" SET {", ".join(f"{k}=?" for k in werte)} WHERE TCID=?', (*werte.values(), tcid)
    )
    db.commit()
    return {"ok": True, "mitarbeiter": _mitarbeiter(db, tcid)}


@bp.put("/mitarbeiter/<int:tcid>/zugang")
@login_required
def zugang(tcid: int):
    if role() != "admin":
        abort(403, description="Nur Administratoren dürfen Zugänge ändern.")
    data = request.get_json(silent=True) or {}
    db = get_db()
    _mitarbeiter(db, tcid)
    benutzername = str(data.get("benutzername") or "").strip()
    rolle = str(data.get("rolle") or "mitarbeiter").strip().lower()
    passwort = str(data.get("passwort") or "")
    if rolle not in ROLES:
        abort(400, description="Unbekannte Rolle.")
    if tcid == g.user["TCID"] and (not benutzername or rolle != "admin"):
        abort(400, description="Den eigenen Administrator-Zugang kannst du nicht entfernen oder herabstufen.")
    if not benutzername:
        db.execute(
            """UPDATE "tblMitarbeiter" SET TCBenutzername=NULL, TCPasswortHash=NULL, TCRolle='mitarbeiter',
                      TCMussPasswortAendern=0 WHERE TCID=?""",
            (tcid,),
        )
        db.commit()
        return {"ok": True}
    if len(benutzername) < 3:
        abort(400, description="Der Benutzername muss mindestens 3 Zeichen haben.")
    doppelt = db.execute(
        """SELECT 1 FROM "tblMitarbeiter" WHERE LOWER(TRIM(COALESCE(TCBenutzername,'')))=LOWER(?) AND TCID<>?""",
        (benutzername, tcid),
    ).fetchone()
    if doppelt:
        abort(409, description="Dieser Benutzername ist bereits vergeben.")
    hat_passwort = db.execute('SELECT TCPasswortHash FROM "tblMitarbeiter" WHERE TCID=?', (tcid,)).fetchone()[0]
    if not hat_passwort and not passwort:
        abort(400, description="Für einen neuen Zugang bitte ein Startpasswort vergeben.")
    if passwort and len(passwort) < 8:
        abort(400, description="Das Startpasswort muss mindestens 8 Zeichen haben.")
    db.execute('UPDATE "tblMitarbeiter" SET TCBenutzername=?, TCRolle=? WHERE TCID=?', (benutzername, rolle, tcid))
    if passwort:
        db.execute(
            'UPDATE "tblMitarbeiter" SET TCPasswortHash=?, TCMussPasswortAendern=? WHERE TCID=?',
            (make_password_hash(passwort), 0 if tcid == g.user["TCID"] else 1, tcid),
        )
    db.commit()
    return {"ok": True}


@bp.post("/mitarbeiter/reihenfolge")
@login_required
def reihenfolge():
    """Speichert die Reihenfolge der Techniker in der Wochenplanung."""
    _voll()
    ids = (request.get_json(silent=True) or {}).get("ids") or []
    if not isinstance(ids, list) or not all(isinstance(i, int) for i in ids):
        abort(400, description="Ungültige Reihenfolge.")
    db = get_db()
    for pos, tcid in enumerate(ids, start=1):
        db.execute('UPDATE "tblMitarbeiter" SET TCWochenplanungSortierung=? WHERE TCID=?', (pos * 10, tcid))
    db.commit()
    return {"ok": True}


@bp.post("/mitarbeiter/<int:tcid>/schulungen")
@login_required
def schulung_anlegen(tcid: int):
    _voll()
    data = request.get_json(silent=True) or {}
    bezeichnung = _text(data, "bezeichnung")
    if not bezeichnung:
        abort(400, description="Bitte die Schulung benennen.")
    datum = _text(data, "datum", 10)
    if datum and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", datum):
        abort(400, description="Das Datum ist ungültig.")
    db = get_db()
    _mitarbeiter(db, tcid)
    cur = db.execute(
        """INSERT INTO tblMitarbeiterSchulungen (MSMitarbeiter, MSSchulungsbezeichnung, MSAbschlussdatum, MSBeschreibung)
           VALUES (?, ?, ?, ?)""",
        (tcid, bezeichnung, datum, _text(data, "beschreibung", 2000)),
    )
    db.commit()
    return {"ok": True, "id": cur.lastrowid}


@bp.delete("/schulungen/<int:msid>")
@login_required
def schulung_loeschen(msid: int):
    _voll()
    db = get_db()
    if db.execute("DELETE FROM tblMitarbeiterSchulungen WHERE MSID=?", (msid,)).rowcount == 0:
        abort(404)
    db.commit()
    return {"ok": True}


@bp.post("/mitarbeiter/<int:tcid>/systeme")
@login_required
def system_zuordnen(tcid: int):
    _voll()
    data = request.get_json(silent=True) or {}
    db = get_db()
    _mitarbeiter(db, tcid)
    system_id = data.get("system_id")
    if not system_id or not db.execute('SELECT 1 FROM "tbKundenSysteme" WHERE KSID=?', (system_id,)).fetchone():
        abort(400, description="Bitte ein System wählen.")
    if db.execute("SELECT 1 FROM tblMitarbeiterSysteme WHERE TSTechniker=? AND TSSystem=?", (tcid, system_id)).fetchone():
        abort(409, description="Das System ist bereits zugeordnet.")
    cur = db.execute(
        "INSERT INTO tblMitarbeiterSysteme (TSSystem, TSTechniker, TSPrimary, TSKommentar) VALUES (?, ?, ?, ?)",
        (system_id, tcid, 1 if data.get("hauptverantwortlich") else 0, _text(data, "kommentar", 500)),
    )
    db.commit()
    return {"ok": True, "id": cur.lastrowid}


@bp.delete("/mitarbeiter-systeme/<int:tsid>")
@login_required
def system_entfernen(tsid: int):
    _voll()
    db = get_db()
    if db.execute("DELETE FROM tblMitarbeiterSysteme WHERE TSID=?", (tsid,)).rowcount == 0:
        abort(404)
    db.commit()
    return {"ok": True}


@bp.post("/systeme/<int:system_id>/techniker")
@login_required
def system_techniker_zuordnen(system_id: int):
    """Techniker einem Kundensystem zuordnen (primär oder sekundär)."""
    _voll()
    data = request.get_json(silent=True) or {}
    db = get_db()
    if not db.execute('SELECT 1 FROM "tbKundenSysteme" WHERE KSID=?', (system_id,)).fetchone():
        abort(404)
    tcid = data.get("mitarbeiter_id")
    _mitarbeiter(db, tcid)
    vorhanden = db.execute("SELECT TSID FROM tblMitarbeiterSysteme WHERE TSTechniker=? AND TSSystem=?",
                           (tcid, system_id)).fetchone()
    primaer = 1 if data.get("primaer") else 0
    if vorhanden:
        db.execute("UPDATE tblMitarbeiterSysteme SET TSPrimary=? WHERE TSID=?", (primaer, vorhanden[0]))
        tsid = vorhanden[0]
    else:
        tsid = db.execute("INSERT INTO tblMitarbeiterSysteme (TSSystem, TSTechniker, TSPrimary) VALUES (?, ?, ?)",
                          (system_id, tcid, primaer)).lastrowid
    db.commit()
    return {"ok": True, "id": tsid}


@bp.patch("/mitarbeiter-systeme/<int:tsid>")
@login_required
def system_zuordnung_aendern(tsid: int):
    """Primär-Kennzeichen und/oder Kommentar einer Zuordnung ändern."""
    _voll()
    data = request.get_json(silent=True) or {}
    db = get_db()
    if not db.execute("SELECT 1 FROM tblMitarbeiterSysteme WHERE TSID=?", (tsid,)).fetchone():
        abort(404)
    if "primaer" in data:
        db.execute("UPDATE tblMitarbeiterSysteme SET TSPrimary=? WHERE TSID=?", (1 if data["primaer"] else 0, tsid))
    if "kommentar" in data:
        kommentar = str(data["kommentar"] or "").strip()[:500] or None
        db.execute("UPDATE tblMitarbeiterSysteme SET TSKommentar=? WHERE TSID=?", (kommentar, tsid))
    db.commit()
    return {"ok": True}


@bp.get("/systeme/<int:system_id>/techniker-auswahl")
@login_required
def system_techniker_auswahl(system_id: int):
    """Aktive Techniker der Niederlassung des Kundensystems (ohne Niederlassung am System: alle)."""
    db = get_db()
    s = db.execute('SELECT KSNiederlassung FROM "tbKundenSysteme" WHERE KSID=?', (system_id,)).fetchone()
    if s is None:
        abort(404)
    sql = """SELECT m.TCID AS id, TRIM(COALESCE(m.TCVorname,'') || ' ' || COALESCE(m.TCNachname,'')) AS name
             FROM "tblMitarbeiter" m WHERE COALESCE(m.TCAktiv,1)<>0"""
    args: list = []
    if s[0]:
        sql += " AND m.TCNiederlassung=?"
        args.append(s[0])
    sql += " ORDER BY m.TCNachname COLLATE NOCASE, m.TCVorname COLLATE NOCASE"
    return {"ok": True, "techniker": rows(db.execute(sql, args)), "nur_niederlassung": bool(s[0])}
