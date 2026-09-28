"""Environment or mounted secret files; production settings fail closed."""
import os
import secrets
from pathlib import Path


def read_secret(name):
    value, filename = os.environ.get(name), os.environ.get(name + "_FILE")
    if value and filename:
        raise RuntimeError(f"Configure only {name} or {name}_FILE")
    if filename:
        value = Path(filename).read_text(encoding="utf-8").strip()
    return value


def configure_security(app):
    production = os.environ.get("DINEIQ_ENV", "development").casefold() == "production"
    secret = read_secret("DINEIQ_SESSION_SECRET")
    secure = os.environ.get("DINEIQ_COOKIE_SECURE", "1" if production else "0") == "1"
    if production and (not secret or len(secret) < 32):
        raise RuntimeError("Production requires DINEIQ_SESSION_SECRET (or _FILE) with at least 32 characters")
    if production and not secure:
        raise RuntimeError("Production requires Secure cookies and HTTPS at the reverse proxy")
    hosts = [h.strip() for h in os.environ.get("DINEIQ_TRUSTED_HOSTS", "").split(",") if h.strip()]
    if production and not hosts:
        raise RuntimeError("Production requires DINEIQ_TRUSTED_HOSTS (comma-separated hostnames)")
    app.secret_key = secret or secrets.token_urlsafe(48)
    app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                      SESSION_COOKIE_SECURE=secure, MAX_CONTENT_LENGTH=1024 * 1024)
    if hosts:
        app.config["TRUSTED_HOSTS"] = hosts
    if os.environ.get("DINEIQ_TRUST_PROXY", "0") == "1":
        from werkzeug.middleware.proxy_fix import ProxyFix
        # Only enable when exactly one trusted proxy is the sole path to the app.
        app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=0, x_port=0, x_prefix=0)

    @app.after_request
    def security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        if production:
            response.headers["Strict-Transport-Security"] = "max-age=31536000"
        if __import__("flask").request.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response
