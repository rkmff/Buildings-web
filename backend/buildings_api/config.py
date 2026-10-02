"""Laufzeitkonfiguration: Pfade zu Datenbank, Fotos und Dokumenten.

Die Pfade kommen aus Umgebungsvariablen oder aus config/buildings_options.json
(dasselbe Format wie im bisherigen Programm), damit eine bestehende
Installation ohne Umbau weiterverwendet werden kann.
"""
import json
import os
import secrets
from dataclasses import dataclass
from pathlib import Path


@dataclass
class Settings:
    install_root: Path
    database_path: Path
    photos_path: Path
    documents_path: Path
    frontend_dist: Path
    secret_key: str


def _resolve(root: Path, value, fallback: Path) -> Path:
    raw = str(value or "").strip()
    if not raw:
        return fallback.resolve()
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = root / path
    return path.resolve()


def _secret_key(config_dir: Path) -> str:
    key_file = config_dir / ".buildings_secret_key"
    if key_file.exists():
        key = key_file.read_text(encoding="utf-8").strip()
        if key:
            return key
    config_dir.mkdir(parents=True, exist_ok=True)
    key = secrets.token_hex(32)
    key_file.write_text(key, encoding="utf-8")
    return key


def load_settings() -> Settings:
    root = Path(os.environ.get("BUILDINGS_ROOT") or Path(__file__).resolve().parents[2]).resolve()
    config_dir = Path(os.environ.get("BUILDINGS_CONFIG_DIR") or root / "config").resolve()
    data_dir = Path(os.environ.get("BUILDINGS_DATA_DIR") or root / "data").resolve()

    options = {}
    options_file = config_dir / "buildings_options.json"
    if options_file.exists():
        try:
            loaded = json.loads(options_file.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                options = loaded
        except (OSError, ValueError):
            options = {}

    database = os.environ.get("BUILDINGS_DB") or options.get("database_path")
    return Settings(
        install_root=root,
        database_path=_resolve(root, database, data_dir / "buildings.db"),
        photos_path=_resolve(root, options.get("photos_path"), data_dir / "fotos"),
        documents_path=_resolve(root, options.get("documents_path"), data_dir / "dokumente"),
        frontend_dist=Path(os.environ.get("BUILDINGS_FRONTEND_DIST") or root / "frontend" / "dist").resolve(),
        secret_key=os.environ.get("BUILDINGS_SECRET_KEY") or _secret_key(config_dir),
    )
