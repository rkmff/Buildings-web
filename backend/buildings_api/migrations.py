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
    (
        "003_notizen",
        """
        ALTER TABLE "tblAufTräge" ADD COLUMN ATSalesforce TEXT;
        ALTER TABLE "tblAufTräge" ADD COLUMN ATFortschritt INTEGER;
        CREATE TABLE IF NOT EXISTS auftrag_mitverantwortliche (
            auftrag_id INTEGER NOT NULL REFERENCES "tblAufTräge"(ATID) ON DELETE CASCADE,
            mitarbeiter_id INTEGER NOT NULL REFERENCES "tblMitarbeiter"(TCID) ON DELETE CASCADE,
            PRIMARY KEY (auftrag_id, mitarbeiter_id)
        );
        CREATE INDEX IF NOT EXISTS ix_mitverantwortliche_mitarbeiter ON auftrag_mitverantwortliche(mitarbeiter_id);

        -- Status „angeboten“ entfällt: betroffene Aufträge gelten als beauftragt
        UPDATE "tblAufTräge" SET ATStatus=(SELECT SAID FROM "tblStatusAufträge" WHERE LOWER(TRIM(SAName))='beauftragt')
         WHERE ATStatus IN (SELECT SAID FROM "tblStatusAufträge" WHERE LOWER(TRIM(SAName))='angeboten');
        DELETE FROM "tblStatusAufträge" WHERE LOWER(TRIM(SAName))='angeboten';

        -- Aufgaben auch ohne Auftrag und mit Bezug zu einem Kundensystem
        CREATE TABLE auftragsaufgaben_neu (
            auftragsaufgabe_id INTEGER PRIMARY KEY AUTOINCREMENT,
            auftrag_id INTEGER REFERENCES "tblAufTräge"(ATID) ON DELETE CASCADE,
            kunden_system_id INTEGER REFERENCES "tbKundenSysteme"(KSID) ON DELETE SET NULL,
            titel TEXT NOT NULL,
            beschreibung TEXT,
            mitarbeiter_id INTEGER REFERENCES "tblMitarbeiter"(TCID) ON DELETE SET NULL,
            status TEXT NOT NULL DEFAULT 'offen' CHECK (status IN ('offen','in arbeit','erledigt')),
            web_erstellt_am TEXT,
            web_erstellt_von TEXT,
            web_geaendert_am TEXT,
            web_geaendert_von TEXT,
            kommentare TEXT,
            ergebnis TEXT
        );
        INSERT INTO auftragsaufgaben_neu (auftragsaufgabe_id, auftrag_id, kunden_system_id, titel, beschreibung, mitarbeiter_id,
                                          status, web_erstellt_am, web_erstellt_von, web_geaendert_am, web_geaendert_von,
                                          kommentare, ergebnis)
            SELECT t.auftragsaufgabe_id, t.auftrag_id, a.ATKS, t.titel, t.beschreibung, t.mitarbeiter_id, t.status,
                   t.web_erstellt_am, t.web_erstellt_von, t.web_geaendert_am, t.web_geaendert_von, t.kommentare, t.ergebnis
              FROM auftragsaufgaben t LEFT JOIN "tblAufTräge" a ON a.ATID=t.auftrag_id;
        DROP TABLE auftragsaufgaben;
        ALTER TABLE auftragsaufgaben_neu RENAME TO auftragsaufgaben;
        CREATE INDEX idx_auftragsaufgaben_auftrag ON auftragsaufgaben(auftrag_id);
        CREATE INDEX idx_auftragsaufgaben_mitarbeiter ON auftragsaufgaben(mitarbeiter_id);
        CREATE INDEX idx_auftragsaufgaben_status ON auftragsaufgaben(status);
        CREATE INDEX idx_auftragsaufgaben_system ON auftragsaufgaben(kunden_system_id);
        CREATE TRIGGER web_audit_insert_auftragsaufgaben AFTER INSERT ON auftragsaufgaben FOR EACH ROW
        BEGIN
            UPDATE auftragsaufgaben SET
                web_erstellt_am = COALESCE(NEW.web_erstellt_am, audit_now()),
                web_erstellt_von = COALESCE(NULLIF(NEW.web_erstellt_von, ''), audit_user()),
                web_geaendert_am = COALESCE(NEW.web_geaendert_am, NEW.web_erstellt_am, audit_now()),
                web_geaendert_von = COALESCE(NULLIF(NEW.web_geaendert_von, ''), NULLIF(NEW.web_erstellt_von, ''), audit_user())
            WHERE rowid = NEW.rowid;
        END;
        CREATE TRIGGER web_audit_update_auftragsaufgaben
            AFTER UPDATE OF auftrag_id, kunden_system_id, titel, beschreibung, mitarbeiter_id, status, kommentare, ergebnis
            ON auftragsaufgaben FOR EACH ROW
        BEGIN
            UPDATE auftragsaufgaben SET web_geaendert_am = audit_now(), web_geaendert_von = audit_user()
            WHERE rowid = NEW.rowid;
        END;
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
