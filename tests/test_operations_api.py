"""SQLite operational CRUD, session auth, RBAC, exports, and audit contracts."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from app.backend import create_app


class OperationalApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dineq-app-test-")
        self.fake = SimpleNamespace(
            gap1_tables={"menu_profitability": [{"menu_item_id": "M-1", "revenue": 120}], "customer_rfm": [{"customer_id": "PSEUDO-1"}]},
            tables={"restaurants": [{"restaurant_id": "R-1"}]},
        )
        self.app = create_app(service=self.fake, database_path=Path(self.temp.name) / "test.sqlite")
        self.app.testing = True
        self.client = self.app.test_client()
        self.store = self.app.extensions["dineiq_store"]
        self.csrf = self.client.get("/api/auth/session").get_json()["csrf_token"]

    def tearDown(self):
        self.temp.cleanup()

    def login(self, email, password):
        response = self.client.post("/api/auth/login", json={"email": email, "password": password}, headers={"X-CSRF-Token": self.csrf})
        if response.status_code == 200:
            self.csrf = response.get_json()["csrf_token"]
        return response

    def post(self, url, body):
        return self.client.post(url, json=body, headers={"X-CSRF-Token": self.csrf})

    def test_registration_password_hash_and_session_auth(self):
        self.assertEqual(self.client.get("/api/management/menu-items").status_code, 401)
        response = self.post("/api/auth/register", {"email": "analyst@example.test", "password": "long-safe-test-passphrase"})
        self.assertEqual(response.status_code, 201)
        user = self.store.user_by_id(response.get_json()["user"]["user_id"])
        self.assertEqual(user["role"], "analyst")
        self.assertEqual(self.client.get("/api/auth/me").get_json()["user"]["email"], "analyst@example.test")
        with self.store.connect() as conn:
            raw = conn.execute("SELECT password_hash FROM users WHERE email=?", (user["email"],)).fetchone()[0]
        self.assertNotIn("long-safe-test-passphrase", raw)
        self.assertTrue(raw.startswith("scrypt$"))
        self.assertEqual(self.login("analyst@example.test", "long-safe-test-passphrase").status_code, 200)
        self.assertEqual(self.client.get("/api/auth/me").get_json()["user"]["role"], "analyst")

    def test_customer_profiles_are_anonymized_and_nonidentifying(self):
        admin = self.store.create_user("privacy-admin@example.test", "long-safe-test-passphrase", "administrator")
        self.assertEqual(self.login(admin["email"], "long-safe-test-passphrase").status_code, 200)
        created = self.post("/api/management/customers", {"behavior_profile_json": {"favorite_category": "Mains", "visits_90d": 4}})
        self.assertEqual(created.status_code, 201, created.get_json())
        customer = created.get_json()["item"]
        self.assertRegex(customer["customer_id"], r"^anon_[a-f0-9]{32}$")
        rejected = self.post("/api/management/customers", {"behavior_profile_json": {"email": "person@example.test"}})
        self.assertEqual(rejected.status_code, 400)
        with self.store.connect() as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM customers").fetchone()[0], 1)

    def test_csrf_and_analyst_cannot_mutate(self):
        self.store.create_user("analyst@example.test", "long-safe-test-passphrase", "analyst")
        self.assertEqual(self.login("analyst@example.test", "long-safe-test-passphrase").status_code, 200)
        self.assertEqual(self.client.post("/api/management/locations", json={}).status_code, 403)
        self.assertEqual(self.post("/api/management/locations", {"restaurant_id": "R-1", "restaurant_name": "North", "city": "Lahore"}).status_code, 403)

    def test_invalid_session_and_stale_csrf_are_denied(self):
        with self.client.session_transaction() as session:
            session["user"] = {"user_id": 999999, "email": "disabled@example.test", "role": "administrator"}
            session["csrf_token"] = "stale-token"
        self.assertIsNone(self.client.get("/api/auth/me").get_json()["user"])
        self.assertEqual(self.client.get("/api/management/orders").status_code, 401)
        admin = self.store.create_user("stale-csrf-admin@example.test", "long-safe-test-passphrase", "administrator")
        self.assertEqual(self.login(admin["email"], "long-safe-test-passphrase").status_code, 200)
        response = self.client.post("/api/management/locations", json={"restaurant_id": "R-1", "restaurant_name": "North", "city": "Lahore"}, headers={"X-CSRF-Token": "wrong-token"})
        self.assertEqual(response.status_code, 403)

    def test_spark_job_start_completion_and_failure_events_are_durable(self):
        self.store.record_spark_job_event(job="fixture-job", run_id="run-success", phase="start", details={"source": "local-fixture"})
        self.store.record_spark_job_event(job="fixture-job", run_id="run-success", phase="complete", details={"rows": 5_000_000})
        self.store.record_spark_job_event(job="fixture-job", run_id="run-failure", phase="start")
        self.store.record_spark_job_event(job="fixture-job", run_id="run-failure", phase="failure", details={"error_type": "FixtureError"})
        events = [event for event in self.store.audit_rows() if event["entity"] == "spark_job"]
        self.assertEqual({(event["record_key"], event["action"], event["outcome"]) for event in events}, {
            ("run-success", "spark_job_start", "started"),
            ("run-success", "spark_job_complete", "success"),
            ("run-failure", "spark_job_start", "started"),
            ("run-failure", "spark_job_failure", "failure"),
        })

    def test_operational_dates_prices_and_promotion_periods_are_validated(self):
        admin = self.store.create_user("validation-admin@example.test", "long-safe-test-passphrase", "administrator")
        self.assertEqual(self.login(admin["email"], "long-safe-test-passphrase").status_code, 200)
        self.assertEqual(self.post("/api/management/locations", {"restaurant_id": "R-1", "restaurant_name": "North", "city": "Lahore"}).status_code, 201)
        bad_order = {"order_id": "O-BAD", "restaurant_id": "R-1", "order_datetime": "not-a-timestamp", "status": "Completed", "channel": "Dine-in"}
        self.assertEqual(self.post("/api/management/orders", bad_order).status_code, 400)
        bad_date_only = dict(bad_order, order_id="O-DATE", order_datetime="2026-09-01")
        self.assertEqual(self.post("/api/management/orders", bad_date_only).status_code, 400)
        valid_order = dict(bad_order, order_id="O-VALID", order_datetime="2026-09-01T10:30:00Z")
        self.assertEqual(self.post("/api/management/orders", valid_order).status_code, 201)
        reversed_promotion = {"promotion_id": "P-BAD", "promotion_name": "Bad period", "start_date": "2026-10-01", "end_date": "2026-09-01", "discount_pct": 10}
        self.assertEqual(self.post("/api/management/promotions", reversed_promotion).status_code, 400)
        invalid_promotion = dict(reversed_promotion, promotion_id="P-DATE", start_date="2026-02-30", end_date="2026-10-01")
        self.assertEqual(self.post("/api/management/promotions", invalid_promotion).status_code, 400)
        self.assertEqual(self.post("/api/management/menu-categories", {"category_id": "C-1", "category_name": "Mains"}).status_code, 201)
        invalid_price = {"menu_item_id": "M-BAD", "category_id": "C-1", "item_name": "Bad price", "price": -1, "cost": 5, "available": True}
        self.assertEqual(self.post("/api/management/menu-items", invalid_price).status_code, 400)

    def test_admin_and_location_manager_crud_and_price_history(self):
        admin = self.store.create_user("admin@example.test", "long-safe-test-passphrase", "administrator")
        self.assertEqual(self.login(admin["email"], "long-safe-test-passphrase").status_code, 200)
        created = self.post("/api/management/locations", {"restaurant_id": "R-1", "restaurant_name": "North", "city": "Lahore"})
        self.assertEqual(created.status_code, 201, created.get_json())
        self.assertEqual(self.post("/api/management/menu-categories", {"category_id": "C-1", "category_name": "Mains"}).status_code, 201)
        item = self.post("/api/management/menu-items", {"menu_item_id": "M-1", "category_id": "C-1", "item_name": "Test item", "price": 100, "cost": 45, "available": True})
        self.assertEqual(item.status_code, 201, item.get_json())
        updated = self.client.put("/api/management/menu-items/M-1", json={"price": 115}, headers={"X-CSRF-Token": self.csrf})
        self.assertEqual(updated.status_code, 200, updated.get_json())
        history = self.client.get("/api/management/pricing-history").get_json()["items"]
        self.assertEqual(len(history), 2)
        self.assertEqual((history[-1]["old_price"], history[-1]["new_price"]), (100, 115))
        manager = self.store.create_user("manager@example.test", "long-safe-test-passphrase", "restaurant_manager", "R-1")
        self.client.post("/api/auth/logout", headers={"X-CSRF-Token": self.csrf})
        self.csrf = self.client.get("/api/auth/session").get_json()["csrf_token"]
        self.assertEqual(self.login(manager["email"], "long-safe-test-passphrase").status_code, 200)
        order = self.post("/api/management/orders", {"order_id": "O-1", "restaurant_id": "R-1", "order_datetime": "2026-09-01T10:00:00Z", "status": "Completed", "channel": "Dine-in"})
        self.assertEqual(order.status_code, 201, order.get_json())
        denied = self.post("/api/management/orders", {"order_id": "O-2", "restaurant_id": "R-2", "order_datetime": "2026-09-01T10:00:00Z", "status": "Completed", "channel": "Dine-in"})
        self.assertEqual(denied.status_code, 403)

    def test_filtered_exports_reports_and_admin_audit(self):
        analyst = self.store.create_user("analyst@example.test", "long-safe-test-passphrase", "analyst")
        self.assertEqual(self.login(analyst["email"], "long-safe-test-passphrase").status_code, 200)
        export = self.client.get("/api/export/menu?format=csv&limit=10")
        self.assertEqual(export.status_code, 200)
        self.assertIn("menu_item_id,revenue", export.get_data(as_text=True))
        self.assertEqual(self.client.get("/api/export/menu?limit=5001").status_code, 400)
        self.assertEqual(self.client.get("/api/export/menu?format=exe").status_code, 400)
        self.assertEqual(self.client.get("/api/export/menu?restaurant_id=R-999").status_code, 400)
        self.assertEqual(self.client.get("/api/export/unknown").status_code, 404)
        self.assertEqual(self.client.get("/api/reports/menu").status_code, 200)
        self.assertEqual(self.client.get("/api/system/audit").status_code, 403)
        self.client.post("/api/auth/logout", headers={"X-CSRF-Token": self.csrf})
        self.csrf = self.client.get("/api/auth/session").get_json()["csrf_token"]
        admin = self.store.create_user("admin@example.test", "long-safe-test-passphrase", "administrator")
        self.assertEqual(self.login(admin["email"], "long-safe-test-passphrase").status_code, 200)
        events = self.client.get("/api/system/audit").get_json()["items"]
        self.assertTrue(any(e["action"] == "export" for e in events))
        self.assertTrue(all("password" not in e["details"] for e in events))
        self.assertNotIn("long-safe-test-passphrase", json.dumps(events))


if __name__ == "__main__":
    unittest.main()
