"""Unit tests for Spark/Python comparison null, tolerance and grouping semantics."""
from __future__ import annotations
import sys
import unittest
from pathlib import Path
import pandas as pd

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"/"python"))
from compare_spark_python import compare_analysis


class ComparisonTests(unittest.TestCase):
    def test_exact_count_and_within_rounding_tolerance(self):
        spark=pd.DataFrame([{"ordering_channel":"Web","orders":12,"avg_order_value":10.01,"completed_revenue":120.12}])
        python=pd.DataFrame([{"ordering_channel":"Web","orders":12,"avg_order_value":10.014,"completed_revenue":120.12}])
        records=compare_analysis("channel_performance",spark,python)
        self.assertEqual(len(records),3)
        self.assertTrue(all(r["pass"] for r in records))
        avg=next(r for r in records if r["metric"]=="avg_order_value")
        self.assertAlmostEqual(avg["absolute_difference"],0.004)

    def test_difference_over_tolerance_fails(self):
        spark=pd.DataFrame([{"order_month":"2026-01","total_orders":100,"completed_orders":90,"completed_revenue":1000.00}])
        python=pd.DataFrame([{"order_month":"2026-01","total_orders":101,"completed_orders":90,"completed_revenue":1000.00}])
        records=compare_analysis("monthly_demand",spark,python)
        total=next(r for r in records if r["metric"]=="total_orders")
        self.assertFalse(total["pass"])
        self.assertEqual(total["absolute_difference"],1)

    def test_matching_nulls_pass_and_one_sided_null_fails(self):
        spark=pd.DataFrame([{"promotion_id":"P1","promotion_name":"One","used_orders":0,"avg_subtotal":None,"avg_discount":None,"final_revenue":None}])
        python=pd.DataFrame([{"promotion_id":"P1","promotion_name":"One","used_orders":0,"avg_subtotal":None,"avg_discount":None,"final_revenue":None}])
        same=compare_analysis("promotion_effectiveness",spark,python)
        self.assertTrue(all(r["pass"] for r in same))
        python.loc[0,"avg_discount"]=0.0
        changed=compare_analysis("promotion_effectiveness",spark,python)
        field=next(r for r in changed if r["metric"]=="avg_discount")
        self.assertFalse(field["pass"])
        self.assertIn("null handling differs",field["explanation"])

    def test_missing_group_fails(self):
        spark=pd.DataFrame([{"stock_status":"Low","observations":2,"avg_closing_stock":10.0}])
        python=pd.DataFrame([{"stock_status":"Normal","observations":2,"avg_closing_stock":10.0}])
        records=compare_analysis("inventory_status",spark,python)
        self.assertEqual(len(records),4)
        self.assertFalse(any(r["pass"] for r in records))
        self.assertTrue(all("group exists only" in r["explanation"] for r in records))

    def test_dimension_text_compared_exactly(self):
        spark=pd.DataFrame([{"restaurant_id":"R1","restaurant_name":"Name A","city":"Lahore","order_count":2,"revenue":10.0,"avg_order_value":5.0}])
        python=spark.copy(); python.loc[0,"city"]="Lahore "
        records=compare_analysis("restaurant_performance",spark,python)
        city=next(r for r in records if r["metric"]=="city")
        self.assertFalse(city["pass"])
        self.assertEqual(city["explanation"],"dimension value differs")


if __name__=="__main__": unittest.main(verbosity=2)
