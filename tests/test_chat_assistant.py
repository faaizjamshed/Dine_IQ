import tempfile
import unittest

from app.backend import create_app
from app.chat_assistant import DineIQAssistant


class FixtureService:
    ready = False
    tables = {
        "restaurants": [
            {
                "restaurant_id": "R001",
                "restaurant_name": "DineIQ Gulberg",
                "city": "Lahore",
                "revenue": 500000.0,
                "order_count": 1000,
                "avg_order_value": 500.0,
            }
        ],
        "menu": [{"menu_item_id": "M001"}, {"menu_item_id": "M002"}],
        "monthly": [{"order_month": "2026-01", "completed_orders": 100, "completed_revenue": 50000.0}],
        "categories": [{"category_id": "CAT001", "category_name": "Burgers", "menu_items": 2, "units_sold": 500, "order_count": 300, "gross_sales": 250000.0, "avg_order_value": 833.33}],
    }
    gap1_tables = {
        "menu_profitability": [
            {
                "menu_item_id": "M001",
                "item_name": "Smoky Chicken Burger",
                "category_name": "Burgers",
                "performance_class": "Profit Driver",
                "base_price": 900.0,
                "units_sold": 2000,
                "order_count": 1500,
                "revenue": 1_700_000.0,
                "estimated_cost": 900_000.0,
                "contribution_margin": 800_000.0,
                "contribution_margin_pct": 0.470588,
                "wastage_cost": 9000.0,
                "wastage_cost_ratio": 0.01,
            },
            {
                "menu_item_id": "M002",
                "item_name": "Classic Chicken Burger",
                "category_name": "Burgers",
                "performance_class": "Volume Driver",
                "base_price": 700.0,
                "units_sold": 3000,
                "order_count": 2200,
                "revenue": 1_900_000.0,
                "estimated_cost": 1_200_000.0,
                "contribution_margin": 700_000.0,
                "contribution_margin_pct": 0.368421,
                "wastage_cost": 15000.0,
                "wastage_cost_ratio": 0.0125,
            },
        ],
        "wastage_risk_ranking": [
            {
                "restaurant_id": "R001",
                "menu_item_id": "M002",
                "item_name": "Classic Chicken Burger",
                "historical_quantity_wasted": 20.0,
                "historical_wastage_cost": 15000.0,
            }
        ],
        "menu_by_location": [
            {
                "restaurant_id": "R001",
                "menu_item_id": "M001",
                "item_name": "Smoky Chicken Burger",
                "units_sold": 2000,
                "contribution_margin": 800000.0,
                "contribution_margin_pct": 0.470588,
            }
        ],
        "basket_rules": [
            {
                "item_a": "M001",
                "item_b": "M002",
                "item_a_name": "Smoky Chicken Burger",
                "item_b_name": "Classic Chicken Burger",
                "pair_count": 120,
                "confidence_a_to_b": 0.12,
                "confidence_b_to_a": 0.08,
                "lift_a_to_b": 1.2,
                "lift_b_to_a": 1.2,
            }
        ],
        "recommendations": [
            {
                "subject": "Smoky Chicken Burger + Mint Drink",
                "action": "bundle/cross-sell",
                "evidence": "lift=1.2",
            }
        ],
    }


class AssistantLogicTests(unittest.TestCase):
    def setUp(self):
        self.assistant = DineIQAssistant(FixtureService())

    def test_formula_explains_scope_not_accounting_profit(self):
        reply = self.assistant.answer("profit formula kya hai?")
        self.assertEqual(reply.topic, "formula:profit")
        self.assertIn("Contribution margin =", reply.answer)
        self.assertIn("not accounting net profit", reply.answer)
        self.assertTrue(reply.as_dict()["grounded"])

    def test_exact_product_question_returns_loaded_metrics(self):
        reply = self.assistant.answer("Smoky Chicken Burger ki performance batao")
        self.assertEqual(reply.topic, "menu:item")
        self.assertIn("PKR 800,000.00", reply.answer)
        self.assertIn("47.06%", reply.answer)
        self.assertIn("Profit Driver", reply.answer)
        self.assertEqual(reply.navigation, "/menu")

    def test_ambiguous_product_question_requests_exact_name(self):
        reply = self.assistant.answer("chicken burger product batao")
        self.assertEqual(reply.topic, "menu:item-clarification")
        self.assertIn("several possible", reply.answer)

    def test_rankings_and_limitations_are_truthful(self):
        ranked = self.assistant.answer("top selling items dikhao")
        self.assertIn("Classic Chicken Burger", ranked.answer)
        limitation = self.assistant.answer("can I trust wastage prediction?")
        self.assertIn("low precision", limitation.answer)

    def test_product_follow_ups_use_basket_and_location_evidence(self):
        basket = self.assistant.answer("What pairs well with Smoky Chicken Burger?")
        self.assertEqual(basket.topic, "menu:item-baskets")
        self.assertIn("lift 1.200", basket.answer)
        location = self.assistant.answer("Which outlet performs best for Smoky Chicken Burger?")
        self.assertEqual(location.topic, "menu:item-locations")
        self.assertIn("DineIQ Gulberg", location.answer)

    def test_snapshot_and_category_answer_use_loaded_aggregates(self):
        snapshot = self.assistant.answer("overall project snapshot dikhao")
        self.assertEqual(snapshot.topic, "project:snapshot")
        self.assertIn("Completed revenue: PKR 50,000.00", snapshot.answer)
        category = self.assistant.answer("Burgers category ki summary")
        self.assertEqual(category.topic, "category")
        self.assertIn("Gross sales: PKR 250,000.00", category.answer)

    def test_rejects_empty_and_oversized_messages(self):
        with self.assertRaises(ValueError):
            self.assistant.answer("  ")
        with self.assertRaises(ValueError):
            self.assistant.answer("x" * 801)


class AssistantApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="dineq-assistant-")
        cls.app = create_app(service=FixtureService(), database_path=f"{cls.temp.name}/assistant.sqlite")
        cls.app.testing = True
        cls.client = cls.app.test_client()

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_assistant_requires_authentication(self):
        response = self.client.post("/api/assistant/chat", json={"message": "profit formula"})
        self.assertEqual(response.status_code, 401)

    def test_authenticated_contract_and_validation(self):
        store = self.app.extensions["dineiq_store"]
        user = store.create_user("guide-user@example.test", "assistant-test-password", "analyst")
        csrf = self.client.get("/api/auth/session").get_json()["csrf_token"]
        login = self.client.post(
            "/api/auth/login",
            json={"email": user["email"], "password": "assistant-test-password"},
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(login.status_code, 200, login.get_data(as_text=True))

        capabilities = self.client.get("/api/assistant/capabilities")
        self.assertEqual(capabilities.status_code, 200)
        self.assertIn("Roman Urdu", capabilities.get_json()["languages"])

        response = self.client.post(
            "/api/assistant/chat",
            json={"message": "Smoky Chicken Burger ki performance batao"},
            headers={"X-CSRF-Token": login.get_json()["csrf_token"]},
        )
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        body = response.get_json()
        self.assertTrue(body["grounded"])
        self.assertEqual(body["topic"], "menu:item")
        self.assertTrue(body["sources"])

        bad = self.client.post(
            "/api/assistant/chat",
            json={"message": "profit", "unsupported": True},
            headers={"X-CSRF-Token": login.get_json()["csrf_token"]},
        )
        self.assertEqual(bad.status_code, 400)


if __name__ == "__main__":
    unittest.main()
