"""Hidden/malformed-data contracts exercised on disposable local fixtures."""
import os
import sys
import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path

os.environ["PYSPARK_PYTHON"] = sys.executable

from pyspark.sql import SparkSession

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts" / "spark"))
from common import SCHEMAS, read_csv_table, spark as create_spark
from phase3_customer_rfm import build_customer_rfm
from quality_rules import (
    apply_cleaning_rules,
    build_quarantine_policy,
    count_foreign_key_orphans,
    profile_table,
)


class AdversarialDataTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        python_executable = str(Path(sys.executable or "python").resolve()) if sys.executable else "python"
        python_dir = str(Path(python_executable).resolve().parent)
        os.environ["PYSPARK_PYTHON"] = python_executable
        os.environ["PYSPARK_DRIVER_PYTHON"] = python_executable
        os.environ["PATH"] = python_dir + os.pathsep + os.environ.get("PATH", "")
        cls.spark = (SparkSession.builder.master("local[2]")
                     .appName("DineIQ-Phase3-Adversarial-Contracts")
                     .config("spark.ui.enabled", "false")
                     .config("spark.sql.shuffle.partitions", "2")
                     .config("spark.executorEnv.PYSPARK_PYTHON", python_executable)
                     .config("spark.executorEnv.PYSPARK_DRIVER_PYTHON", python_executable)
                     .config("spark.executorEnv.PATH", os.environ["PATH"])
                     .getOrCreate())
        cls.spark.sparkContext.setLogLevel("ERROR")

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "spark") and cls.spark is not None:
            cls.spark.stop()
            cls.spark = None

    def test_order_line_invalid_components_duplicates_and_raw_preservation(self):
        raw = self.spark.createDataFrame([
            ("OI-1", "O-1", "M-1", -1, 5.0, 0.0, -5.0, None),
            ("OI-2", "O-1", "M-2", 2, -5.0, 0.0, -10.0, None),
            ("OI-3", "O-2", "M-3", 2, 5.0, 1.0, 99.0, None),
            ("OI-4", "O-2", "M-4", 1, 10.0, 0.0, 10.0, None),
            ("OI-4", "O-2", "M-4", 1, 10.0, 0.0, 10.0, None),
            ("OI-5", "O-3", "M-5", 1, 8.0, None, 8.0, None),
        ], SCHEMAS["order_items"])
        audit = []
        cleaned, duplicate_rows = apply_cleaning_rules("order_items", raw, audit, raw.count())
        rows = {row.order_item_id: row for row in cleaned.collect()}
        self.assertEqual(raw.count(), 6)
        self.assertEqual(duplicate_rows, 1)
        self.assertEqual(len(rows), 5)
        self.assertIsNone(rows["OI-1"].quantity)
        self.assertIsNone(rows["OI-1"].line_total)
        self.assertIsNone(rows["OI-2"].unit_price)
        self.assertIsNone(rows["OI-2"].line_total)
        self.assertEqual(rows["OI-3"].line_total, 9.0)
        self.assertIsNone(rows["OI-5"].line_total)
        self.assertTrue({"deduplicate_primary_key", "null_invalid_quantity", "null_invalid_unit_price", "recompute_line_total", "null_unverifiable_line_total"}.issubset({event["rule"] for event in audit}))

    def test_orders_duplicates_missing_channel_negative_discount_and_unseen_category(self):
        valid_time = datetime(2026, 9, 1, 12)
        rows = [
            ("O-1", "C-1", "R-1", None, valid_time, None, "Completed", 100.0, -5.0, 0.0, 0.0, 100.0, "Cash"),
            ("O-2", "C-1", "R-1", None, valid_time, "Hovercraft", "Completed", 100.0, 0.0, 0.0, 0.0, 100.0, "Cash"),
            ("O-2", "C-1", "R-1", None, valid_time, "Hovercraft", "Completed", 100.0, 0.0, 0.0, 0.0, 100.0, "Cash"),
        ]
        raw = self.spark.createDataFrame(rows, SCHEMAS["orders"])
        profile = profile_table("orders", raw)
        self.assertEqual(profile["duplicate_pk_rows_in_groups"], 2)
        self.assertEqual(profile["anomalies"]["unexpected_categorical:ordering_channel"], 2)
        audit = []
        cleaned, excess_rows_removed = apply_cleaning_rules("orders", raw, audit, profile["rows"])
        output = {row.order_id: row for row in cleaned.collect()}
        self.assertEqual(excess_rows_removed, 1)
        self.assertEqual(len(output), 2)
        self.assertEqual(output["O-1"].ordering_channel, "Unknown")
        self.assertIsNone(output["O-1"].discount_amount)
        self.assertEqual(output["O-2"].ordering_channel, "Hovercraft")
        self.assertEqual(raw.count(), 3)

    def test_invalid_timestamp_is_preserved_as_null_and_profiled(self):
        header = "order_id,customer_id,restaurant_id,promotion_id,order_datetime,ordering_channel,order_status,subtotal,discount_amount,tax_amount,delivery_fee,final_amount,payment_method"
        rows = [
            "O-BAD,C-1,R-1,,not-a-timestamp,Dine-In,Completed,100,0,0,0,100,Cash",
            "O-GOOD,C-1,R-1,,2026-09-01T12:00:00Z,Dine-In,Completed,100,0,0,0,100,Cash",
        ]
        with tempfile.TemporaryDirectory(prefix="dineq-phase3-dates-") as temp:
            path = Path(temp) / "orders.csv"
            original = header + "\n" + "\n".join(rows) + "\n"
            path.write_text(original, encoding="utf-8")
            parsed = read_csv_table(self.spark, "orders", path)
            parsed_rows = {row.order_id: row for row in parsed.collect()}
            self.assertEqual(len(parsed_rows), 2)
            self.assertIsNone(parsed_rows["O-BAD"].order_datetime)
            self.assertIsNotNone(parsed_rows["O-GOOD"].order_datetime)
            self.assertEqual(profile_table("orders", parsed)["nulls"]["order_datetime"], 1)
            self.assertEqual(path.read_text(encoding="utf-8"), original)

    def test_rating_boundaries_invalid_scores_and_missing_values(self):
        raw = self.spark.createDataFrame([
            ("RT-1", "O-1", "C-1", "R-1", 0, 4.0, 4.0, 4.0, None, date(2026, 9, 1)),
            ("RT-2", "O-2", "C-1", "R-1", 1, 1.0, 1.0, None, None, date(2026, 9, 1)),
            ("RT-3", "O-3", "C-1", "R-1", 5, 5.0, 5.0, 5.0, None, date(2026, 9, 1)),
            ("RT-4", "O-4", "C-1", "R-1", 6, 6.0, 4.0, 4.0, None, date(2026, 9, 1)),
        ], SCHEMAS["ratings"])
        audit = []
        cleaned, _ = apply_cleaning_rules("ratings", raw, audit, raw.count())
        rows = {row.rating_id: row for row in cleaned.collect()}
        self.assertIsNone(rows["RT-1"].rating)
        self.assertEqual(rows["RT-2"].rating, 1)
        self.assertEqual(rows["RT-3"].rating, 5)
        self.assertIsNone(rows["RT-4"].rating)
        self.assertIsNone(rows["RT-4"].food_rating)
        self.assertIsNone(rows["RT-2"].delivery_rating)

    def test_unseen_customer_behavior_and_unusual_promotions_are_flagged_not_rewritten(self):
        customer = self.spark.createDataFrame([
            ("C-1", "Synthetic Fixture", "Other", 31, None, date(2026, 1, 1), "Unexpected Cohort", "Unknown App", 0, False, None),
        ], SCHEMAS["customers"])
        customer_profile = profile_table("customers", customer)
        self.assertEqual(customer_profile["anomalies"]["unexpected_categorical:customer_segment"], 1)
        self.assertEqual(customer_profile["anomalies"]["unexpected_categorical:preferred_channel"], 1)
        customer_audit = []
        cleaned_customer, _ = apply_cleaning_rules("customers", customer, customer_audit, 1)
        customer_row = cleaned_customer.collect()[0]
        self.assertEqual(customer_row.city, "Unknown")
        self.assertEqual(customer_row.customer_segment, "Unexpected Cohort")
        self.assertEqual(customer_row.preferred_channel, "Unknown App")

        promotion = self.spark.createDataFrame([
            ("P-1", "Unexpected campaign", "Surprise Mechanic", "Coupon", 5000.0, date(2026, 9, 1), date(2026, 9, 2), 0.0, "All", True),
        ], SCHEMAS["promotions"])
        promotion_profile = profile_table("promotions", promotion)
        self.assertEqual(promotion_profile["anomalies"]["unexpected_categorical:promotion_type"], 1)
        self.assertEqual(promotion_profile["anomalies"]["unexpected_categorical:discount_type"], 1)
        cleaned_promotion, _ = apply_cleaning_rules("promotions", promotion, [], 1)
        promotion_row = cleaned_promotion.collect()[0]
        self.assertEqual(promotion_row.promotion_type, "Surprise Mechanic")
        self.assertEqual(promotion_row.discount_type, "Coupon")
        self.assertEqual(promotion_row.discount_value, 5000.0)

    def test_broken_references_are_reported_without_mutating_raw_rows(self):
        customers = self.spark.createDataFrame([("C-1",)], ["customer_id"])
        restaurants = self.spark.createDataFrame([("R-1",)], ["restaurant_id"])
        promotions = self.spark.createDataFrame([], SCHEMAS["promotions"])
        orders = self.spark.createDataFrame([
            ("O-1", "C-UNKNOWN", "R-NEW", "P-UNKNOWN", datetime(2026, 9, 1), "Dine-In", "Completed", 0.0, 0.0, 0.0, 0.0, 0.0, "Cash"),
        ], SCHEMAS["orders"])
        menu_items = self.spark.createDataFrame([("M-1",)], ["menu_item_id"])
        order_items = self.spark.createDataFrame([("OI-1", "O-1", "M-UNKNOWN", 1, 5.0, 0.0, 5.0, None)], SCHEMAS["order_items"])
        tables = {"customers": customers, "restaurants": restaurants, "promotions": promotions, "orders": orders, "menu_items": menu_items, "order_items": order_items}
        orphans = count_foreign_key_orphans(tables)
        self.assertEqual(orphans["orders.customer_id->customers"], 1)
        self.assertEqual(orphans["orders.restaurant_id->restaurants"], 1)
        self.assertEqual(orphans["orders.promotion_id->promotions"], 1)
        self.assertEqual(orphans["order_items.menu_item_id->menu_items"], 1)
        self.assertEqual(orders.count(), 1)
        self.assertEqual(order_items.collect()[0].menu_item_id, "M-UNKNOWN")

    def test_extreme_nonnegative_wastage_is_preserved_by_documented_rules(self):
        raw = self.spark.createDataFrame([
            ("W-NEG", "R-1", "M-1", date(2026, 9, 1), -1.0, 4.0, 4.0, "Unsold"),
            ("W-EXTREME", "R-1", "M-1", date(2026, 9, 1), 100000.0, 4.0, 400000.0, "Overproduction"),
        ], SCHEMAS["wastage"])
        audit = []
        cleaned, _ = apply_cleaning_rules("wastage", raw, audit, raw.count())
        output = {row.wastage_id: row for row in cleaned.collect()}
        self.assertIsNone(output["W-NEG"].quantity_wasted)
        self.assertEqual(output["W-EXTREME"].quantity_wasted, 100000.0)

    def test_invalid_dates_excessive_discounts_and_orphan_fks_are_identified(self):
        orders = self.spark.createDataFrame([
            ("O-1", "C-1", "R-1", "P-1", "2026-13-01T12:00:00Z", "Dine-In", "Completed", 250.0, 300.0, 0.0, 0.0, 75.0, "Cash"),
            ("O-2", "C-UNKNOWN", "R-1", "P-1", "2026-09-01T12:00:00Z", "Dine-In", "Completed", 500.0, 10.0, 0.0, 0.0, 490.0, "Cash"),
        ], ["order_id", "customer_id", "restaurant_id", "promotion_id", "order_datetime", "ordering_channel", "order_status", "subtotal", "discount_amount", "tax_amount", "delivery_fee", "final_amount", "payment_method"])
        customers = self.spark.createDataFrame([("C-1",)], ["customer_id"])
        restaurants = self.spark.createDataFrame([("R-1",)], ["restaurant_id"])
        promotions = self.spark.createDataFrame([("P-1",)], ["promotion_id"])

        profile = profile_table("orders", orders)
        self.assertEqual(profile["anomalies"]["invalid_date:order_datetime"], 1)
        self.assertEqual(profile["anomalies"]["discount_exceeds_subtotal"], 1)

        cleaned, _ = apply_cleaning_rules("orders", orders, [], orders.count())
        rendered = {row.order_id: row for row in cleaned.collect()}
        self.assertIsNone(rendered["O-1"].order_datetime)
        self.assertIsNone(rendered["O-1"].discount_amount)

        orphans = count_foreign_key_orphans({"orders": orders, "customers": customers, "restaurants": restaurants, "promotions": promotions})
        self.assertEqual(orphans["orders.customer_id->customers"], 1)

    def test_quarantine_policy_and_hidden_edge_cases_are_documented(self):
        policy = build_quarantine_policy("orders")
        self.assertIn("invalid_date", policy["quarantine_rules"])
        self.assertIn("discount_exceeds_subtotal", policy["quarantine_rules"])

        raw = self.spark.createDataFrame([
            ("O-EDGE", "C-1", "R-1", "P-1", "2026-13-01T12:00:00Z", "Dine-In", "Completed", 120.0, 200.0, 0.0, 0.0, 80.0, "Cash"),
            ("O-OK", "C-1", "R-1", "P-1", "2026-09-01T12:00:00Z", "Dine-In", "Completed", 120.0, 10.0, 0.0, 0.0, 110.0, "Cash"),
        ], ["order_id", "customer_id", "restaurant_id", "promotion_id", "order_datetime", "ordering_channel", "order_status", "subtotal", "discount_amount", "tax_amount", "delivery_fee", "final_amount", "payment_method"])
        profile = profile_table("orders", raw)
        self.assertEqual(profile["anomalies"]["invalid_date:order_datetime"], 1)
        self.assertEqual(profile["anomalies"]["discount_exceeds_subtotal"], 1)

    def test_rfm_includes_customers_without_completed_orders_without_calling_them_churned(self):
        customers = self.spark.createDataFrame([
            ("C-1", "Synthetic One", "Other", 30, "Lahore", date(2025, 1, 1), "Synthetic", "Dine-In", 0, False, None),
            ("C-2", "Synthetic Two", "Other", 31, "Lahore", date(2025, 1, 1), "Synthetic", "Dine-In", 0, False, None),
            ("C-3", "Synthetic Three", "Other", 32, "Lahore", date(2025, 1, 1), "Synthetic", "Dine-In", 0, False, None),
        ], SCHEMAS["customers"])
        orders = self.spark.createDataFrame([
            ("O-1", "C-1", "R-1", None, datetime(2026, 5, 30, 12), "Dine-In", "Completed", 100.0, 0.0, 0.0, 0.0, 100.0, "Cash"),
            ("O-2", "C-1", "R-1", None, datetime(2026, 6, 1, 12), "Dine-In", "Completed", 200.0, 0.0, 0.0, 0.0, 200.0, "Cash"),
        ], SCHEMAS["orders"])
        rfm = build_customer_rfm(customers, orders, "2026-08-31")
        rows = {row.customer_id: row for row in rfm.collect()}
        self.assertEqual(len(rows), 3)
        self.assertEqual((rows["C-1"].frequency, rows["C-1"].monetary_value), (2, 300.0))
        self.assertEqual(rows["C-1"].recency_days, 91)
        for customer_id in ("C-2", "C-3"):
            self.assertIsNone(rows[customer_id].recency_days)
            self.assertEqual(rows[customer_id].frequency, 0)
            self.assertEqual(rows[customer_id].monetary_value, 0.0)
            self.assertEqual(rows[customer_id].behavior_segment, "No completed orders")
        self.assertNotIn("customer_name", rfm.columns)

    def test_spark_helper_restarts_stale_active_session_for_new_app_context(self):
        stale = create_spark("DineIQ-Stale-Session-Test", master="local[1]")
        self.assertIsNotNone(SparkSession.getActiveSession())
        fresh = create_spark("DineIQ-Fresh-Session-Test", master="local[1]")
        self.assertIsNotNone(SparkSession.getActiveSession())
        self.assertIsNot(stale, fresh)
        fresh.stop()


if __name__ == "__main__":
    unittest.main()