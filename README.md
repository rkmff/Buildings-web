# Buildings (neue Oberfläche)

Neuaufbau der Buildings-Webanwendung (Gebäudeautomation: Kunden, Systeme, ISPs, Anlagen, Geräte,
Aufträge, Wartung, Planung). Die bestehende SQLite-Datenbank wird weiterverwendet.

## Aufbau

- `backend/` – Python/Flask-JSON-API (`/api/...`) und Auslieferung der gebauten Oberfläche.
  Läuft im Netzwerk mit `waitress` auf Port 2912.
- `frontend/` – React-Oberfläche (Vite, TypeScript). Wird einmal gebaut (`frontend/dist`);
  auf dem Server ist danach kein Node.js nötig.

Datenbank, Fotos und Dokumente liegen wie bisher in `data/` bzw. dort, wo
`config/buildings_options.json` hinzeigt (`database_path`, `photos_path`, `documents_path`).
Beim Start werden fehlende Zusatztabellen der neuen Oberfläche angelegt (`app_migrations`,
`app_benutzer_einstellungen`); bestehende Daten bleiben unverändert.

## Entwicklung

```bash
# Backend
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
BUILDINGS_DB=/pfad/zu/buildings.db .venv/bin/flask --app buildings_api:create_app run --port 5000

# Oberfläche (zweites Terminal, leitet /api an Port 5000 weiter)
cd frontend
npm install
npm run dev
```

Tests: Kopie einer Datenbank nach `backend/tests/fixtures/buildings.db` legen (wird nicht
eingecheckt), dann `cd backend && .venv/bin/python -m pytest`.

## Betrieb unter Windows

1. `cd frontend && npm install && npm run build` (auf dem Entwicklungsrechner).
2. Programmordner mit `backend/`, `frontend/dist/`, `START_BUILDINGS.bat` auf den Server kopieren,
   daneben `data/`, `config/` und `runtime/python` aus der bisherigen Installation.
3. In der portablen Python-Laufzeit `pip install -r backend/requirements.txt` ausführen
   (Flask und waitress sind dort meist schon vorhanden).
4. `START_BUILDINGS.bat` starten und `http://<server>:2912` öffnen.

Umgebungsvariablen: `BUILDINGS_ROOT`, `BUILDINGS_DB`, `BUILDINGS_DATA_DIR`, `BUILDINGS_CONFIG_DIR`,
`BUILDINGS_PORT`, `BUILDINGS_HOST`.

## Stand

Fertig: Anmeldung (bestehende Passwörter), Seitenleiste, Einstellungen pro Benutzer
(Hell/Dunkel/System, Akzentfarbe, Anzahl Wochen), **Meine Seite** (Planung per Drag & Drop),
**Kunden & Anlagen** (Objektbaum; Kunden, Systeme und Ansprechpartner pflegen Admins und Dispatcher, ISPs, Anlagen und Geräte auch die Techniker; Erstellt/Geändert wird je Datensatz angezeigt), **Aufträge** (Board, Liste, Detailspalte),
**Wartung** (Ausführung mit Ergebnissen, Messwerten, Kommentaren und Fotos),
**Wochenplanung** (Team-Raster mit Aufträgen zum Ziehen), **Mitarbeiter** (Person, Zugang,
Reihenfolge der Wochenplanung, Schulungen, Systeme, Ausrüstung) und **Stammdaten**
(Auswahllisten mit Verwendungsanzeige), **Ausrüstung** (meine und alle, Übergaben mit Annahme, Kalibrierungen, Fotos, Dokumente).

Als Nächstes: Wartungsplanung, Berichte, Wartungsvorlagen, Excel-Import.
