"""Executable quarantine contracts: source preservation, bad data, and accounting."""
import csv
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/spark"))
from common import SCHEMAS, spark
from quality_rules import read_quality_csv, validate_table, TABLE_ORDER, validation_catalog


VALID = {
    "customers": ["C1", "Fixture", "Other", "30", "Lahore", "2026-01-01", "New", "Website", "0", "false", "2026-09-01"],
    "restaurants": ["R1", "Fixture", "Lahore", "Area", "2025-01-01", "10", "Mall", "true"],
    "menu_categories": ["K1", "Pizza", "Fixture", "true"],
    "menu_items": ["M1", "K1", "Fixture", "100", "40", "10", "false", "true", "2026-01-01"],
    "promotions": ["P1", "Fixture", "Seasonal", "Percentage", "10", "2026-01-01", "2026-12-31", "0", "All", "true"],
    "orders": ["O1", "C1", "R1", "", "2026-09-01 12:00:00", "Website", "Completed", "100", "10", "5", "0", "95", "Cash"],
    "order_items": ["I1", "O1", "M1", "2", "100", "10", "190", ""],
    "pricing_history": ["H1", "M1", "R1", "90", "100", "2026-01-01", "", "Menu Review"],
    "ratings": ["T1", "O1", "C1", "R1", "5", "5", "4", "", "", "2026-09-01"],
    "inventory": ["V1", "R1", "M1", "2026-09-01", "10", "5", "3", "12", "2", "Normal"],
    "wastage": ["W1", "R1", "M1", "2026-09-01", "2", "40", "80", "Unsold"],
}


class SubmissionQualityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sp = spark("DineIQ-Quality-Tests", master="local[2]", shuffle_partitions=2)
        cls.sp.sparkContext.setLogLevel("ERROR")
        cls.sp.conf.set("spark.sql.csv.parser.columnPruning.enabled", "false")
        cls.parents = {t: cls.raw(t, [row]) for t, row in VALID.items()}

    @classmethod
    def tearDownClass(cls):
        cls.sp.stop()

    @classmethod
    def raw(cls, table, rows):
        schema = ", ".join(f"{c} string" for c in SCHEMAS[table].fieldNames())
        return cls.sp.createDataFrame([tuple(None if x == "" else x for x in row) for row in rows], schema)

    def changed(self, table, identifier, **values):
        row = dict(zip(SCHEMAS[table].fieldNames(), VALID[table]))
        row[SCHEMAS[table].fieldNames()[0]] = identifier
        row.update(values)
        return list(row.values())

    def validate(self, table, rows, parents=None):
        good, bad, report = validate_table(table, self.raw(table, rows), self.parents if parents is None else parents)
        self.addCleanup(good.unpersist)
        self.addCleanup(bad.unpersist)
        self.assertTrue(report["accounting_passed"])
        return good, bad, report

    def test_valid_rows_for_every_table_and_complete_catalog(self):
        for table in TABLE_ORDER:
            with self.subTest(table=table):
                good, bad, report = self.validate(table, [VALID[table]])
                self.assertEqual((report["accepted_count"], report["quarantine_count"]), (1, 0))
                ids = [r["id"] for r in validation_catalog(table)]
                self.assertEqual(len(ids), len(set(ids)))
                self.assertTrue(set(report["rule_counts"]).issubset(ids))
                good.unpersist()
                bad.unpersist()

    def test_duplicates_conflicts_numeric_and_foreign_keys(self):
        rows = [VALID["order_items"], VALID["order_items"],
                self.changed("order_items", "conflict", quantity="1"),
                self.changed("order_items", "conflict", quantity="3"),
                self.changed("order_items", "zero", quantity="0"),
                self.changed("order_items", "negative", quantity="-1"),
                self.changed("order_items", "nan", unit_price="NaN"),
                self.changed("order_items", "infinity", unit_price="Infinity"),
                self.changed("order_items", "fraction", quantity="1.5"),
                self.changed("order_items", "missing", quantity=""),
                self.changed("order_items", "orphan", order_id="NOT-FOUND"),
                self.changed("order_items", "discount", item_discount="201"),
                self.changed("order_items", "repair", line_total="999"),
                self.changed("order_items", "", line_total="190")]
        good, bad, report = self.validate("order_items", rows)
        self.assertEqual((report["before_count"], report["accepted_count"], report["quarantine_count"], report["exact_duplicate_copies_removed"]), (14, 2, 11, 1))
        self.assertEqual(report["rule_counts"]["conflicting_primary_key"], 2)
        self.assertEqual(report["repair_counts"]["recompute:line_total"], 1)
        self.assertEqual({r.line_total for r in good.collect()}, {190.0})
        self.assertIn('"quantity":"-1"', next(r._raw_record for r in bad.collect() if r.order_item_id == "negative"))

    def test_bad_dates_status_discount_and_parent_cascade(self):
        rows = [VALID["orders"],
                self.changed("orders", "date", order_datetime="2026-02-30 12:00:00"),
                self.changed("orders", "time", order_datetime="2026-09-01 25:00:00"),
                self.changed("orders", "status", order_status="Pending Mystery"),
                self.changed("orders", "discount", discount_amount="101"),
                self.changed("orders", "total", final_amount="3"),
                self.changed("orders", "optional", ordering_channel=""),
                self.changed("orders", "cancelled", order_status="Cancelled", final_amount="0")]
        good, bad, report = self.validate("orders", rows)
        self.assertEqual((report["accepted_count"], report["quarantine_count"]), (3, 5))
        self.assertEqual(report["rule_counts"]["invalid_type:order_datetime"], 2)
        child = self.changed("order_items", "child", order_id="date")
        _, _, child_report = self.validate("order_items", [child], dict(self.parents, orders=good))
        self.assertEqual(child_report["rule_counts"]["foreign_key:order_id"], 1)
        with self.assertRaises(ValueError):
            validate_table("orders", self.parents["orders"], {})

    def test_bounds_dates_booleans_and_balances(self):
        cases = [
            ("customers", {"is_churned": "perhaps"}, "invalid_type:is_churned"),
            ("promotions", {"discount_value": "101"}, "percentage_over_100"),
            ("promotions", {"end_date": "2025-01-01"}, "date_order"),
            ("ratings", {"rating": "6"}, "rating_range:rating"),
            ("inventory", {"closing_stock": "99"}, "stock_balance"),
            ("wastage", {"quantity_wasted": "-1"}, "nonnegative:quantity_wasted"),
            ("orders", {"order_status": "Cancelled", "final_amount": "95"}, "cancelled_settlement"),
            ("order_items", {"unit_price": "1e308", "quantity": "2"}, "derived_nonfinite"),
        ]
        for table, changes, reason in cases:
            with self.subTest(table=table, reason=reason):
                _, _, report = self.validate(table, [self.changed(table, "invalid", **changes)])
                self.assertEqual(report["quarantine_count"], 1)
                self.assertEqual(report["rule_counts"][reason], 1)

    def test_csv_malformed_structure_and_source_tokens(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "order_items.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(SCHEMAS["order_items"].fieldNames())
                writer.writerow(VALID["order_items"])
                writer.writerow(self.changed("order_items", "extra") + ["unexpected"])
                writer.writerow(self.changed("order_items", "short")[:4])
                writer.writerow(self.changed("order_items", "text", unit_price="bad-number"))
                writer.writerow(self.changed("order_items", "quoted", special_request="less salt, please\nand no sauce"))
            raw = read_quality_csv(self.sp, "order_items", str(path.resolve()))
            good, bad, report = validate_table("order_items", raw, self.parents)
            try:
                self.assertEqual((report["before_count"], report["accepted_count"], report["quarantine_count"]), (5, 2, 3))
                self.assertEqual(report["rule_counts"]["malformed_csv"], 2)
                self.assertIn("unexpected", next(r._corrupt_record for r in bad.collect() if r.order_item_id == "extra"))
            finally:
                good.unpersist()
                bad.unpersist()

    def test_empty_table_has_zero_counts(self):
        _, _, report = self.validate("order_items", [])
        self.assertEqual((report["before_count"], report["accepted_count"], report["quarantine_count"]), (0, 0, 0))


if __name__ == "__main__":
    unittest.main()
