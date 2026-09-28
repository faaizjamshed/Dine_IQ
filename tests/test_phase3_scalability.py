"""Small deterministic contracts for the disposable Phase 3 scale workload."""
import os
import sys
import unittest
from pyspark.sql import SparkSession

os.environ["PYSPARK_PYTHON"] = sys.executable

from scripts.spark.common import SCHEMAS
from scripts.spark.phase3_scalability_benchmark import expand_order_items


class ScalabilityWorkloadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spark = (SparkSession.builder.master("local[2]")
                     .appName("DineIQ-Phase3-Scale-Contract-Test")
                     .config("spark.ui.enabled", "false")
                     .config("spark.sql.shuffle.partitions", "2")
                     .getOrCreate())
        cls.spark.sparkContext.setLogLevel("ERROR")

    @classmethod
    def tearDownClass(cls):
        if hasattr(cls, "spark") and cls.spark is not None:
            cls.spark.stop()
            cls.spark = None

    def source(self):
        return self.spark.createDataFrame([
            ("OI-3", "O-2", "M-1", 1, 10.0, 0.0, 10.0, None),
            ("OI-1", "O-1", "M-2", 2, 5.0, 0.0, 10.0, None),
            ("OI-2", "O-1", "M-1", 1, 4.0, 0.0, 4.0, None),
        ], SCHEMAS["order_items"])

    def test_expansion_preserves_schema_and_unique_prefixed_ids(self):
        source = self.source()
        original_schema = source.schema
        benchmark, source_rows, copied_rows = expand_order_items(source, 7)
        rows = benchmark.select("order_item_id").collect()
        identifiers = [row.order_item_id for row in rows]
        self.assertEqual((source_rows, copied_rows), (3, 4))
        self.assertEqual(benchmark.schema, original_schema)
        self.assertEqual(len(identifiers), 7)
        self.assertEqual(len(set(identifiers)), 7)
        self.assertEqual(sum(value.startswith("PHASE3-") for value in identifiers), 4)
        self.assertEqual(source.count(), 3)

    def test_expansion_rejects_shrinking_the_source(self):
        with self.assertRaisesRegex(ValueError, "cannot shrink"):
            expand_order_items(self.source(), 2)

    def test_expansion_rejects_missing_line_key(self):
        source = self.spark.createDataFrame([(1, "M-1")], ["quantity", "menu_item_id"])
        with self.assertRaisesRegex(ValueError, "order_item_id"):
            expand_order_items(source, 2)


if __name__ == "__main__":
    unittest.main()