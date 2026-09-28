"""Local Flask integration tests against canonical HDFS v4 outputs and model."""
import math
import re
import tempfile
import unittest
from urllib.parse import quote

from app.backend import app, create_app


class DineIQAppIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="dineq-integration-")
        cls.app = create_app(service=app.extensions["dineiq_service"], database_path=f"{cls.temp.name}/integration.sqlite")
        cls.app.testing = True
        cls.client = cls.app.test_client()
        store = cls.app.extensions["dineiq_store"]
        admin = store.create_user("integration-admin@example.test", "test-only-strong-password", "administrator")
        csrf = cls.client.get("/api/auth/session").get_json()["csrf_token"]
        login = cls.client.post("/api/auth/login", json={"email": admin["email"], "password": "test-only-strong-password"}, headers={"X-CSRF-Token": csrf})
        if login.status_code != 200:
            raise RuntimeError("Could not authenticate integration-test administrator.")

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_health_reports_real_canonical_services(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200, response.get_json())
        data = response.get_json()
        self.assertEqual(data["status"], "ok")
        self.assertEqual(data["canonical_version"], "v4")
        self.assertEqual(data["analytics_tables_loaded"], 12)
        self.assertTrue(data["model_loaded"])
        self.assertIn("/dineq/results/v4", data["analytics_source"])

    def test_analytics_endpoints_serve_real_precomputed_rows(self):
        expected = {"/api/menu": 200, "/api/categories": 15, "/api/restaurants": 25,
                    "/api/channels": 6, "/api/promotions": 80, "/api/ratings": 25,
                    "/api/wastage": 5, "/api/inventory": 2, "/api/pricing": 5,
                    "/api/demand/monthly": 18, "/api/demand/peak-hours": 168,
                    "/api/customer-segments": 5}
        for path, count in expected.items():
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                body = response.get_json()
                records = body.get("items", body.get("count"))
                self.assertEqual(len(records) if isinstance(records, list) else records, count)

    def test_supported_filters_and_invalid_filter_handling(self):
        menu = self.client.get("/api/menu?category=Burgers&limit=1000").get_json()
        self.assertTrue(menu["items"])
        self.assertTrue(all(item["category_name"] == "Burgers" for item in menu["items"]))
        supported_city = self.client.get("/api/filters").get_json()["cities"][0]
        city = self.client.get("/api/restaurants?city=" + quote(supported_city)).get_json()
        self.assertTrue(city["items"])
        self.assertTrue(all(item["city"].casefold() == supported_city.casefold() for item in city["items"]))
        period = self.client.get("/api/demand/monthly?from=2026-01&to=2026-03").get_json()
        self.assertEqual([item["order_month"] for item in period["items"]], ["2026-01", "2026-02", "2026-03"])
        self.assertEqual(self.client.get("/api/demand/monthly?from=2026-13").status_code, 400)
        self.assertEqual(self.client.get("/api/menu?sort=unknown").status_code, 400)
        self.assertEqual(self.client.get("/api/categories?sort=unknown").status_code, 400)
        self.assertEqual(self.client.get("/api/restaurants?limit=0").status_code, 400)

    def test_prediction_validation_and_model_output(self):
        self.assertEqual(self.client.post("/api/ml/predict", json=[]).status_code, 400)
        base = {"restaurant_id": "R001", "target_hour": "2026-09-01T00:00:00Z",
                "lag_1h": 2, "lag_24h": 3, "lag_168h": 4}
        bad = dict(base, lag_24h=-1)
        self.assertEqual(self.client.post("/api/ml/predict", json=bad).status_code, 400)
        bad = dict(base, target_hour="2026-09-01T00:30:00Z")
        self.assertEqual(self.client.post("/api/ml/predict", json=bad).status_code, 400)
        bad = dict(base, target_hour="2026-09-01")
        self.assertEqual(self.client.post("/api/ml/predict", json=bad).status_code, 400)
        bad = dict(base, target_hour="2026-09-01T00:00:00+05:30")
        self.assertEqual(self.client.post("/api/ml/predict", json=bad).status_code, 400)
        bad = dict(base, restaurant_id="NOT-A-RESTAURANT")
        self.assertEqual(self.client.post("/api/ml/predict", json=bad).status_code, 400)
        response = self.client.post("/api/ml/predict", json=base)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        result = response.get_json()
        self.assertEqual(result["model"], "gradient_boosted_trees")
        self.assertEqual(result["target_hour_utc"], "2026-09-01T00:00:00Z")
        self.assertTrue(math.isfinite(result["predicted_order_arrivals"]))
        self.assertEqual(set(result["features"]), {"restaurant_id", "hour_of_day", "day_of_week", "month", "lag_1h", "lag_24h", "lag_168h"})
        self.assertEqual(result["features"]["day_of_week"], 2.0)  # Tuesday, saved Spark encoding Sunday=0
        self.assertIsNotNone(response.headers.get("X-Response-Time-ms"))

    def test_gap1_analytics_endpoints_serve_versioned_results(self):
        menu = self.client.get("/api/intelligence/menu?class=Profit%20Driver").get_json()
        self.assertGreater(menu["count"], 0)
        self.assertTrue(all(row["performance_class"] == "Profit Driver" for row in menu["items"]))
        baskets = self.client.get("/api/intelligence/baskets?min_confidence=0.10").get_json()
        self.assertGreater(baskets["directional_rules"], 0)
        first = baskets["items"][0]
        self.assertTrue({"antecedent_id", "consequent_id", "support", "confidence", "lift", "pair_count"}.issubset(first))
        rfm = self.client.get("/api/intelligence/customers?segment=At%20risk%20(90d%20inactive)").get_json()
        self.assertGreater(rfm["count"], 0)
        churn = self.client.get("/api/intelligence/churn-risk").get_json()
        self.assertFalse(churn["is_predictive"])
        self.assertGreater(churn["count"], 0)
        for path in ("/api/intelligence/wastage", "/api/intelligence/wastage-risk", "/api/intelligence/pricing", "/api/intelligence/promotions", "/api/intelligence/anomalies", "/api/intelligence/recommendations", "/api/ml/demand-comparison", "/api/system/spark-jobs"):
            with self.subTest(path=path): self.assertEqual(self.client.get(path).status_code, 200)
        recommendation=self.client.get("/api/intelligence/recommendations?limit=1").get_json()["items"][0]
        self.assertEqual(recommendation["source"],"directional basket association")
        self.assertIn(" -> ",recommendation["subject"])
        self.assertIn("directional confidence",recommendation["evidence"])
        db_evidence=self.client.get("/api/system/analytics-artifacts").get_json()
        self.assertGreater(db_evidence["persisted_recommendation_rows"],0)
        expected_backend = self.app.extensions["dineiq_service"].storage_backend
        self.assertEqual(db_evidence["storage_backend"], expected_backend)
        self.assertEqual(db_evidence["analytical_data_remains_in_hdfs"], expected_backend == "hdfs")
        monitor=self.client.get("/api/system/spark-jobs").get_json()
        self.assertEqual(monitor["monitoring_mode"],"historical evidence; no claim of live job state")
        self.assertIsNone(monitor["active_jobs"])
        self.assertEqual(len(monitor["jobs"]),3)
        self.assertTrue(all(job["live"] is False for job in monitor["jobs"]))
        self.assertTrue(all(job["status"] in {"historical-success","unknown"} for job in monitor["jobs"]))

    def test_daily_forecast_endpoint_is_authenticated_and_serves_aligned_scope(self):
        fresh = create_app(service=app.extensions["dineiq_service"], database_path=f"{self.temp.name}/unauthenticated.sqlite")
        fresh.testing = True
        self.assertEqual(fresh.test_client().get("/api/ml/daily-forecast").status_code, 401)

        response = self.client.get("/api/ml/daily-forecast?level=category&horizon=14")
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["level"], "category")
        self.assertEqual(body["horizon"], 14)
        self.assertEqual(len(body["entities"]), 15)
        self.assertEqual(len(body["history"]), 28)
        self.assertEqual(len(body["forecasts"]), 14)
        self.assertIn("Item/category forecasts aggregate all restaurants", body["note"])
        self.assertGreater(body["backtest"]["seasonal_naive"]["mae"], body["backtest"]["model"]["mae"])

    def test_wastage_risk_model_prediction_contract(self):
        body={"restaurant_id":"R001","category_id":"CAT001","prediction_week_start":"2026-09-07","waste_qty_lag_1w":1.0,"waste_cost_lag_1w":100.0,"waste_cost_mean_prev4w":80.0,"waste_cost_mean_prev12w":70.0,"demand_units_lag_1w":20.0,"demand_mean_prev4w":22.0,"demand_mean_prev12w":19.0}
        response=self.client.post("/api/ml/wastage-risk/predict",json=body)
        self.assertEqual(response.status_code,200,response.get_data(as_text=True))
        result=response.get_json();self.assertEqual(result["target_week"],"2026-09-14")
        self.assertGreaterEqual(result["probability_high_risk"],0);self.assertLessEqual(result["probability_high_risk"],1)
        self.assertIn("Low-precision",result["warning"])
        self.assertEqual(self.client.post("/api/ml/wastage-risk/predict",json=dict(body,prediction_week_start="2026-09-08")).status_code,400)

    def test_model_and_system_evidence_are_read_from_files(self):
        model = self.client.get("/api/ml/model").get_json()
        self.assertEqual(model["model_path"], "hdfs://localhost:9000/dineq/models/v1/selected_demand_model")
        self.assertAlmostEqual(model["test_metrics"]["mae"], 1.0232209696775245)
        evidence = self.client.get("/api/system/evidence").get_json()
        self.assertEqual(evidence["production_tables"], 11)
        self.assertEqual(evidence["order_items"]["raw_rows"], 3000600)
        self.assertEqual(evidence["order_items"]["processed_rows"], 3000000)
        self.assertEqual(evidence["python_spark_comparison"]["matched_metrics"], 2347)
        self.assertEqual(evidence["python_spark_comparison"]["mismatched_metrics"], 0)
        self.assertEqual(evidence["canonical_layers"]["analytics"], "hdfs://localhost:9000/dineq/results/v4")
        performance = self.client.get("/api/system/performance").get_json()
        self.assertIn("in-memory", performance["serving_mode"])
        self.assertGreaterEqual(performance["startup_load_seconds"], 0)

    def test_demand_comparison_uses_feature_equivalent_aligned_evidence(self):
        response = self.client.get("/api/ml/demand-comparison")
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertEqual(body["keyed_cases"], 500)
        self.assertIn("Both models use Sunday=0", body["feature_semantics_note"])
        self.assertEqual(body["models_retrained"], "python_only_for_aligned_evidence")

    def test_frontend_routes_assets_and_no_mock_fallback_contract(self):
        home = self.client.get("/")
        self.assertEqual(home.status_code, 200)
        html = home.get_data(as_text=True)
        self.assertIn("DineIQ Analytics", html)
        self.assertIn('id="root"', html)
        assets = re.findall(r'(?:src|href)="(/assets/[^\"]+)"', html)
        self.assertTrue(any(path.endswith(".js") for path in assets))
        self.assertTrue(any(path.endswith(".css") for path in assets))
        for path in assets:
            with self.subTest(asset=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                self.assertNotIn("text/html", response.content_type)
                response.close()
        for route in ("/login", "/dashboard", "/forecasting"):
            response = self.client.get(route)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_data(as_text=True), html)
            response.close()
        self.assertEqual(self.client.get("/assets/missing.js").status_code, 404)
        self.assertEqual(self.client.get("/api/missing").status_code, 404)
        home.close()


if __name__ == "__main__":
    unittest.main()
