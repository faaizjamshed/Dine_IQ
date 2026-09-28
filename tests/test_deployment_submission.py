import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from flask import Flask
from app.artifacts import contained, sha256
from app.security_config import configure_security, read_secret


class DeploymentConfigurationTests(unittest.TestCase):
    def test_production_fails_without_secret_secure_cookie_or_hosts(self):
        cases = [{"DINEIQ_ENV": "production"},
                 {"DINEIQ_ENV": "production", "DINEIQ_SESSION_SECRET": "x" * 48, "DINEIQ_COOKIE_SECURE": "0"},
                 {"DINEIQ_ENV": "production", "DINEIQ_SESSION_SECRET": "x" * 48}]
        for env in cases:
            with patch.dict(os.environ, env, clear=True), self.assertRaises(RuntimeError):
                configure_security(Flask(__name__))

    def test_mounted_secret_headers_and_host_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "secret"
            path.write_text("test-only-" + "a" * 48, encoding="utf-8")
            env = {"DINEIQ_ENV": "production", "DINEIQ_SESSION_SECRET_FILE": str(path), "DINEIQ_TRUSTED_HOSTS": "localhost"}
            with patch.dict(os.environ, env, clear=True):
                app = Flask(__name__)
                configure_security(app)
                app.add_url_rule("/api/test", view_func=lambda: "ok")
                response = app.test_client().get("/api/test")
                self.assertEqual(response.status_code, 200)
                self.assertTrue(app.config["SESSION_COOKIE_SECURE"])
                self.assertEqual(response.headers["Cache-Control"], "no-store")
                self.assertIn("max-age", response.headers["Strict-Transport-Security"])
                self.assertEqual(app.test_client().get("/api/test", base_url="https://evil.example").status_code, 400)
                with patch.dict(os.environ, {"DINEIQ_SESSION_SECRET": "also-set"}), self.assertRaises(RuntimeError):
                    read_secret("DINEIQ_SESSION_SECRET")

    def test_bundle_paths_cannot_escape_and_hash_detects_change(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for path in ("../outside", "../../outside", "C:/Windows/file", "/etc/passwd", "a\\..\\b"):
                with self.assertRaises(ValueError):
                    contained(root, path)
            file = root / "sample"
            file.write_bytes(b"before")
            first = sha256(file)
            file.write_bytes(b"after")
            self.assertNotEqual(first, sha256(file))
