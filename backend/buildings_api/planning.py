"""Planungslogik: Arbeitstage, Konflikte und das Freimachen von Zeiträumen.

Übernommen aus dem bisherigen Programm (buildings/services/planning.py), damit
sich Einträge genauso verhalten: Wochenenden und aktive Feiertage sind nicht
planbar, Überschneidungen werden nur nach Bestätigung ersetzt.
"""
from datetime import date, timedelta


class PlanungFehler(Exception):
    def __init__(self, message: str, status: int = 400, konflikt: dict | None = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.konflikt = konflikt


def iso(value) -> date | None:
    try:
        return date.fromisoformat(str(value or "").strip())
    except (TypeError, ValueError):
        return None


def tag_gesperrt(conn, d: date) -> bool:
    if d.weekday() >= 5:
        return True
    return bool(
        conn.execute(
            "SELECT 1 FROM feiertage WHERE datum=? AND COALESCE(aktiv,1)<>0 LIMIT 1", (d.isoformat(),)
        ).fetchone()
    )


def gesperrt_text(conn, d: date) -> str:
    if d.weekday() >= 5:
        return "An Wochenenden können keine Planungseinträge liegen."
    r = conn.execute(
        "SELECT GROUP_CONCAT(bezeichnung, ' / ') FROM feiertage WHERE datum=? AND COALESCE(aktiv,1)<>0",
        (d.isoformat(),),
    ).fetchone()
    if r and r[0]:
        return f"Am Feiertag „{r[0]}“ können keine Planungseinträge liegen."
    return "Dieser Tag ist für die Planung gesperrt."


def arbeitstag_verschieben(conn, d: date, arbeitstage: int) -> date:
    cursor, rest = d, abs(arbeitstage)
    schritt = 1 if arbeitstage > 0 else -1
    while rest:
        cursor += timedelta(days=schritt)
        if not tag_gesperrt(conn, cursor):
            rest -= 1
    return cursor


def arbeitstage_zwischen(conn, start: date, ende: date) -> int:
    """Anzahl planbarer Tage von start bis ende (beide inklusive)."""
    n, cursor = 0, start
    while cursor <= ende:
        if not tag_gesperrt(conn, cursor):
            n += 1
        cursor += timedelta(days=1)
    return n


def konflikte(conn, mitarbeiter_id: int, start: date, ende: date, exclude_id=None):
    sql = """
        SELECT p.*, a.ATName, aw.bezeichnung AS AbwesenheitName
        FROM mitarbeiter_planung p
        LEFT JOIN "tblAufTräge" a ON a.ATID=p.auftrag_id
        LEFT JOIN abwesenheitsarten aw ON aw.abwesenheitsart_id=p.abwesenheitsart_id
        WHERE p.mitarbeiter_id=? AND p.start_datum<=? AND p.ende_datum>=?
    """
    params = [mitarbeiter_id, ende.isoformat(), start.isoformat()]
    if exclude_id is not None:
        sql += " AND p.planung_id<>?"
        params.append(exclude_id)
    return conn.execute(sql + " ORDER BY p.start_datum, p.planung_id", params).fetchall()


def konflikt_info(rows) -> dict:
    r = rows[0]
    if r["auftrag_id"]:
        name = r["ATName"] or f"Auftrag #{r['auftrag_id']}"
    elif str(r["AbwesenheitName"] or "").strip().casefold() == "manuell":
        name = r["anzeigetext"] or "Manuell"
    else:
        name = r["AbwesenheitName"] or "Abwesenheit"
    return {
        "anzahl": len(rows),
        "name": name,
        "start_datum": r["start_datum"],
        "ende_datum": r["ende_datum"],
    }


def zeitraum_freimachen(conn, mitarbeiter_id: int, start: date, ende: date, exclude_id=None):
    """Entfernt nur den überschneidenden Teil bestehender Planungen (teilt sie bei Bedarf)."""
    for r in konflikte(conn, mitarbeiter_id, start, ende, exclude_id):
        alt_start, alt_ende = date.fromisoformat(r["start_datum"]), date.fromisoformat(r["ende_datum"])
        links_ende = arbeitstag_verschieben(conn, start, -1)
        rechts_start = arbeitstag_verschieben(conn, ende, 1)
        if alt_start < start and alt_ende > ende:
            conn.execute(
                "UPDATE mitarbeiter_planung SET ende_datum=? WHERE planung_id=?",
                (links_ende.isoformat(), r["planung_id"]),
            )
            conn.execute(
                """INSERT INTO mitarbeiter_planung
                   (mitarbeiter_id, start_datum, ende_datum, auftrag_id, abwesenheitsart_id, anzeigetext, bemerkung)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (r["mitarbeiter_id"], rechts_start.isoformat(), alt_ende.isoformat(), r["auftrag_id"],
                 r["abwesenheitsart_id"], r["anzeigetext"], r["bemerkung"]),
            )
        elif alt_start < start <= alt_ende:
            conn.execute(
                "UPDATE mitarbeiter_planung SET ende_datum=? WHERE planung_id=?",
                (links_ende.isoformat(), r["planung_id"]),
            )
        elif start <= alt_start <= ende < alt_ende:
            conn.execute(
                "UPDATE mitarbeiter_planung SET start_datum=? WHERE planung_id=?",
                (rechts_start.isoformat(), r["planung_id"]),
            )
        else:
            conn.execute("DELETE FROM mitarbeiter_planung WHERE planung_id=?", (r["planung_id"],))


def zeitraum_pruefen(conn, mitarbeiter_id: int, start: date, ende: date, ersetzen: bool, exclude_id=None):
    """Prüft Sperrtage und Konflikte; macht den Zeitraum frei, wenn ersetzt werden soll."""
    if ende < start:
        raise PlanungFehler("Der Zeitraum ist ungültig.")
    for d in (start, ende):
        if tag_gesperrt(conn, d):
            raise PlanungFehler(gesperrt_text(conn, d))
    rows = konflikte(conn, mitarbeiter_id, start, ende, exclude_id)
    if rows and not ersetzen:
        info = konflikt_info(rows)
        raise PlanungFehler(
            f"Im Zeitraum ist bereits „{info['name']}“ eingetragen. Soll der Eintrag ersetzt werden?",
            409,
            info,
        )
    if rows:
        zeitraum_freimachen(conn, mitarbeiter_id, start, ende, exclude_id)
