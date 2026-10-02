import shutil
import sqlite3
from pathlib import Path

import pytest

from buildings_api import create_app
from buildings_api.config import Settings
from buildings_api.db import audit_now
from buildings_api.security import make_password_hash

FIXTURE_DB = Path(__file__).parent / "fixtures" / "buildings.db"


@pytest.fixture()
def app(tmp_path):
    if not FIXTURE_DB.exists():
        pytest.skip("Testdatenbank fehlt (tests/fixtures/buildings.db, nicht im Repo)")
    db_path = tmp_path / "buildings.db"
    shutil.copy(FIXTURE_DB, db_path)
    conn = sqlite3.connect(db_path)
    conn.create_function("audit_now", 0, audit_now)
    conn.create_function("audit_user", 0, lambda: "Test")
    conn.execute(
        'UPDATE "tblMitarbeiter" SET TCPasswortHash=?, TCMussPasswortAendern=0', (make_password_hash("geheim123"),)
    )
    conn.commit()
    conn.close()
    settings = Settings(
        install_root=tmp_path,
        database_path=db_path,
        photos_path=tmp_path / "fotos",
        documents_path=tmp_path / "dokumente",
        frontend_dist=tmp_path / "dist",
        secret_key="test",
    )
    return create_app(settings)


def login(client, benutzername):
    r = client.post("/api/auth/login", json={"benutzername": benutzername, "passwort": "geheim123"})
    assert r.status_code == 200, r.json
    return r.json["user"]


@pytest.fixture()
def client(app):
    return app.test_client()
