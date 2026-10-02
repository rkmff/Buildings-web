"""Idempotente Schema-Ergänzungen der neuen Oberfläche.

Jede Migration läuft genau einmal und wird in app_migrations vermerkt.
Bestehende Tabellen und Daten bleiben unverändert.
"""
MIGRATIONS = [
    (
        "001_benutzer_einstellungen",
        """
        CREATE TABLE IF NOT EXISTS app_benutzer_einstellungen (
            mitarbeiter_id INTEGER NOT NULL REFERENCES "tblMitarbeiter"(TCID) ON DELETE CASCADE,
            schluessel TEXT NOT NULL,
            wert TEXT,
            PRIMARY KEY (mitarbeiter_id, schluessel)
        )
        """,
    ),
    (
        "002_wartung_vdma",
        """
        ALTER TABLE wartungsaufgabenvorlagen ADD COLUMN vdma_position TEXT;
        ALTER TABLE wartungsaufgabenvorlagen ADD COLUMN taetigkeit TEXT;
        ALTER TABLE "tblAufTräge" ADD COLUMN wartung_status TEXT;
        CREATE TABLE IF NOT EXISTS wartung_zeiten (
            zeit_id INTEGER PRIMARY KEY AUTOINCREMENT,
            auftrag_id INTEGER NOT NULL REFERENCES "tblAufTräge"(ATID) ON DELETE CASCADE,
            mitarbeiter_id INTEGER REFERENCES "tblMitarbeiter"(TCID) ON DELETE SET NULL,
            start TEXT NOT NULL,
            ende TEXT
        );
        CREATE INDEX IF NOT EXISTS ix_wartung_zeiten_auftrag ON wartung_zeiten(auftrag_id);
        """,
    ),
]


def run_migrations(conn):
    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_migrations (key TEXT PRIMARY KEY, ausgefuehrt_am TEXT NOT NULL)"
    )
    done = {r[0] for r in conn.execute("SELECT key FROM app_migrations")}
    for key, sql in MIGRATIONS:
        if key in done:
            continue
        conn.executescript(sql)
        conn.execute(
            "INSERT INTO app_migrations (key, ausgefuehrt_am) VALUES (?, datetime('now','localtime'))", (key,)
        )
    conn.commit()
