import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'results' / 'analytics' / 'srs_completion' / 'v1'


class SrsCompletionTests(unittest.TestCase):
  def test_srs_feature_mart_is_complete_and_versioned(self):
    manifest = json.loads((OUT / 'features.json').read_text())
    self.assertEqual(manifest['status'], 'COMPLETE')
    self.assertGreaterEqual(len(manifest['outputs']), 18)
    self.assertTrue(manifest['source'].endswith('/processed/v4'))
    self.assertTrue(all(item['rows'] >= 0 for item in manifest['outputs'].values()))


  def test_independent_forecasts_beat_weekly_baseline(self):
    report = json.loads((OUT / 'independent_validation.json').read_text())
    for level, metrics in report['independent_forecasts']['levels'].items():
        self.assertLess(metrics['model']['mae'], metrics['seasonal_naive_7d']['mae'], level)
        self.assertLess(metrics['model']['rmse'], metrics['seasonal_naive_7d']['rmse'], level)


  def test_independent_basket_formula_reconciliation_and_churn_model(self):
    report = json.loads((OUT / 'independent_validation.json').read_text())
    self.assertEqual(report['basket_validation']['support_max_error'], 0)
    self.assertEqual(report['basket_validation']['lift_max_error'], 0)
    self.assertGreater(report['independent_churn_model']['roc_auc'], 0.5)
