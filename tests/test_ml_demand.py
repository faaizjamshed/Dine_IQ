"""Critical ML contract tests for target, leakage, splits, metrics and persistence."""
import json
import sys
import unittest
from pathlib import Path
import pandas as pd

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"scripts"/"ml"))
from demand_common import FEATURES,FEATURES_NUMERIC,LEAKAGE_EXCLUSIONS,TARGET,TARGET_DEFINITION,split_for_timestamp
from python_demand import build_pipeline,make_dataset
from sklearn.linear_model import Ridge
import joblib

class DemandMLTests(unittest.TestCase):
    def test_target_and_leakage_contract(self):
        self.assertEqual(TARGET,"order_count")
        self.assertIn("[hour_start, hour_start + 1 hour)",TARGET_DEFINITION)
        self.assertTrue({"order_status","final_amount","order items","ratings"}.issubset(LEAKAGE_EXCLUSIONS))
        self.assertFalse(set(FEATURES)&set(LEAKAGE_EXCLUSIONS))

    def test_features_are_pre_event_history_and_calendar(self):
        frame,train,val,test=make_dataset(ROOT/"data"/"generated"/"orders.csv")
        self.assertEqual(FEATURES[1:], ["hour_of_day","day_of_week","month","lag_1h","lag_24h","lag_168h"])
        self.assertTrue(frame.lag_168h.notna().all())
        self.assertTrue((frame.loc[train,"hour_start"].max()<pd.Timestamp("2026-04-01")))
        self.assertTrue((frame.loc[val,"hour_start"].min()>=pd.Timestamp("2026-04-01")))
        self.assertTrue((frame.loc[val,"hour_start"].max()<pd.Timestamp("2026-06-01")))
        self.assertTrue((frame.loc[test,"hour_start"].min()>=pd.Timestamp("2026-06-01")))
        self.assertEqual(int(train.sum()+val.sum()+test.sum()),len(frame))

    def test_split_boundaries(self):
        self.assertEqual(split_for_timestamp("2026-03-31"),"train")
        self.assertEqual(split_for_timestamp("2026-04-01"),"validation")
        self.assertEqual(split_for_timestamp("2026-05-31"),"validation")
        self.assertEqual(split_for_timestamp("2026-06-01"),"test")

    def test_metric_and_report_structure(self):
        for p in (ROOT/"results/ml/python/pipeline.json",ROOT/"results/ml/spark/pipeline.json"):
            if not p.exists(): continue
            item=json.loads(p.read_text(encoding="utf-8"))
            self.assertTrue({"rmse","mae","r2"}.issubset(item["test_metrics"]))
            self.assertGreater(item["split"]["train"],item["split"]["validation"])
            self.assertGreater(item["split"]["test"],0)

    def test_saved_python_model_reload_inference(self):
        path=ROOT/"results/ml/python/selected_model.joblib"
        if not path.exists(): self.skipTest("Python model artifact is not present")
        model=joblib.load(path)
        sample=pd.DataFrame([{"restaurant_id":"R001","hour_of_day":12.0,"day_of_week":1.0,"month":6.0,"lag_1h":3.0,"lag_24h":2.0,"lag_168h":4.0}])
        pred=model.predict(sample)
        self.assertEqual(len(pred),1)
        self.assertTrue(pd.notna(pred[0]))

    def test_saved_spark_model_reload_inference_evidence(self):
        path=ROOT/"results/ml/spark/reload_smoke.json"
        if not path.exists(): self.skipTest("Spark reload smoke evidence is not present")
        evidence=json.loads(path.read_text(encoding="utf-8"))
        self.assertTrue(evidence["passed"])
        self.assertEqual(evidence["rows_with_prediction"],8)
        self.assertEqual(len(evidence["predictions"]),8)

if __name__=="__main__": unittest.main()
