"""Startet Buildings im Netzwerk (waitress). Port über BUILDINGS_PORT, Standard 2912."""
import os

from waitress import serve

from buildings_api import create_app

if __name__ == "__main__":
    host = os.environ.get("BUILDINGS_HOST", "0.0.0.0")
    port = int(os.environ.get("BUILDINGS_PORT", "2912"))
    print(f"Buildings läuft auf http://{host}:{port}")
    serve(create_app(), host=host, port=port, threads=8)
