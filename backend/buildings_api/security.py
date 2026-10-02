"""Passwort-Hashing, kompatibel zu den vorhandenen pbkdf2_sha256-Hashes."""
import base64
import hashlib
import hmac
import secrets

PASSWORD_ROUNDS = 240000


def make_password_hash(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("ascii"), PASSWORD_ROUNDS)
    return f"pbkdf2_sha256${PASSWORD_ROUNDS}${salt}${base64.b64encode(digest).decode('ascii')}"


def verify_password(password: str, stored_hash: str | None) -> bool:
    try:
        algorithm, rounds, salt, encoded = (stored_hash or "").split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("ascii"), int(rounds))
        return hmac.compare_digest(digest, base64.b64decode(encoded.encode("ascii")))
    except (ValueError, TypeError):
        return False
