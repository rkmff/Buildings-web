"""Buildings: JSON-API und Auslieferung der Oberfläche."""
from datetime import timedelta

from flask import Flask, jsonify, send_from_directory
from werkzeug.exceptions import HTTPException

from .auth import load_user
from .config import Settings, load_settings
from .db import close_db, connect
from .migrations import run_migrations
from .planning import PlanungFehler

APP_VERSION = "4.0.0-dev"


def create_app(settings: Settings | None = None) -> Flask:
    settings = settings or load_settings()
    app = Flask(__name__, static_folder=None)
    app.config.update(
        SETTINGS=settings,
        SECRET_KEY=settings.secret_key,
        SESSION_COOKIE_HTTPONLY=True,
        SESSION_COOKIE_SAMESITE="Lax",
        PERMANENT_SESSION_LIFETIME=timedelta(days=30),
        MAX_CONTENT_LENGTH=64 * 1024 * 1024,
        JSON_SORT_KEYS=False,
    )

    with connect(settings.database_path) as conn:
        run_migrations(conn)
    conn.close()

    app.before_request(load_user)
    app.teardown_appcontext(close_db)

    from .routes import auftraege, ausruestung, auth, dokumente, wartung_ablauf, wartungsvorlagen, me, mitarbeiter, objekte, objekte_bearbeiten, planung, stammdaten, wartung

    for module in (auth, me, planung, objekte, objekte_bearbeiten, auftraege, wartung, mitarbeiter, stammdaten, ausruestung, wartungsvorlagen, wartung_ablauf, dokumente):
        app.register_blueprint(module.bp, url_prefix="/api")

    @app.get("/api/version")
    def version():
        return {"version": APP_VERSION}

    @app.errorhandler(PlanungFehler)
    def planung_fehler(err: PlanungFehler):
        return jsonify({"ok": False, "message": err.message, "konflikt": err.konflikt}), err.status

    @app.errorhandler(HTTPException)
    def http_fehler(err: HTTPException):
        texte = {401: "Bitte anmelden.", 403: "Keine Berechtigung.", 404: "Nicht gefunden."}
        eigener_text = err.description and err.description != type(err).description
        message = err.description if eigener_text else texte.get(err.code, err.name)
        return jsonify({"ok": False, "message": message}), err.code

    dist = settings.frontend_dist

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def frontend(path):
        if path.startswith("api/"):
            return jsonify({"ok": False, "message": "Nicht gefunden."}), 404
        if path and (dist / path).is_file():
            return send_from_directory(dist, path)
        if (dist / "index.html").is_file():
            return send_from_directory(dist, "index.html")
        return "Die Oberfläche wurde noch nicht gebaut (frontend/dist fehlt).", 503

    return app
