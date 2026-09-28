"""Domain contracts for SRS gap-closure calculations and scenario API."""
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from app.backend import create_app
from app.what_if import simulate
from scripts.python.gap1_independent import allocate_net_revenue


def classify(popularity, margin_pct, pop_cut, margin_cut, *, cost, has_sales=True,
             recent=False, waste_ratio=0.0, waste_cut=.75):
    if recent:
        return 'Insufficient history'
    if cost is None or cost <= 0:
        return 'Insufficient cost data'
    if not has_sales:
        return 'Low Performer'
    if popularity >= pop_cut and margin_pct >= margin_cut and waste_ratio <= waste_cut:
        return 'Profit Driver'
    if popularity >= pop_cut:
        return 'Volume Driver'
    if margin_pct >= margin_cut:
        return 'Hidden Opportunity'
    return 'Low Performer'


def pair_metrics(pair, a, b, baskets):
    support = pair / baskets
    return {
        'support': support,
        'confidence_a_to_b': pair / a,
        'confidence_b_to_a': pair / b,
        'lift_a_to_b': (pair / a) / (b / baskets),
    }


class Gap1DomainTests(unittest.TestCase):
    def test_empty_analytics_groups_return_empty_results(self):
        temp = tempfile.TemporaryDirectory(prefix='dineq-empty-analytics-test-')
        self.addCleanup(temp.cleanup)
        fake = SimpleNamespace(gap1_tables={'menu_profitability': [], 'basket_rules': []}, gap1_evidence={'basket': {'min_confidence': .1}})
        app = create_app(service=fake, database_path=Path(temp.name) / 'empty.sqlite')
        client = app.test_client()
        store = app.extensions['dineiq_store']
        user = store.create_user('empty@example.test', 'strong-test-password', 'analyst')
        csrf = client.get('/api/auth/session').get_json()['csrf_token']
        login = client.post('/api/auth/login', json={'email': user['email'], 'password': 'strong-test-password'}, headers={'X-CSRF-Token': csrf})
        self.assertEqual(login.status_code, 200)
        menu = client.get('/api/intelligence/menu?class=Profit%20Driver').get_json()
        baskets = client.get('/api/intelligence/baskets?min_confidence=0.1').get_json()
        self.assertEqual((menu['count'], menu['items']), (0, []))
        self.assertEqual((baskets['directional_rules'], baskets['items']), (0, []))

    def test_menu_contradictory_cases_and_invalids(self):
        self.assertEqual(classify(90, .1, 75, .3, cost=5), 'Volume Driver')
        self.assertEqual(classify(10, .5, 75, .3, cost=5), 'Hidden Opportunity')
        self.assertEqual(classify(90, .5, 75, .3, cost=5, waste_ratio=.9, waste_cut=.75), 'Volume Driver')
        self.assertEqual(classify(1, .1, 75, .3, cost=5, has_sales=False), 'Low Performer')
        self.assertEqual(classify(1, .1, 75, .3, cost=None), 'Insufficient cost data')
        self.assertEqual(classify(1, .8, 75, .3, cost=5, recent=True), 'Insufficient history')

    def test_association_metrics_are_keyed_to_basket_universe(self):
        m = pair_metrics(200, 400, 500, 1000)
        self.assertAlmostEqual(m['support'], .2)
        self.assertAlmostEqual(m['confidence_a_to_b'], .5)
        self.assertAlmostEqual(m['confidence_b_to_a'], .4)
        self.assertAlmostEqual(m['lift_a_to_b'], 1.0)

    def test_order_discount_is_proportionally_allocated(self):
        net = [allocate_net_revenue(60, 10, 100), allocate_net_revenue(40, 10, 100)]
        self.assertEqual(sum(net), 90)
        self.assertIsNone(allocate_net_revenue(25, 5, 0))

    def test_what_if_bounded_and_explicit(self):
        out = simulate({'scenario': 'price', 'price': 100, 'unit_cost': 40, 'units': 10, 'price_change_pct': .1, 'elasticity': -1})
        self.assertAlmostEqual(out['scenario']['units'], 9)
        self.assertAlmostEqual(out['scenario']['revenue'], 990)
        self.assertIn('not a causal estimate', out['interpretation'])
        with self.assertRaises(ValueError):
            simulate({'scenario': 'demand', 'baseline_demand': 10, 'contribution_per_unit': 5, 'demand_change_pct': -2})
        prep = simulate({'scenario': 'preparation', 'prepared_units': 120, 'expected_demand_units': 90, 'wastage_rate': .1, 'preparation_reduction_pct': .2})
        self.assertAlmostEqual(prep['scenario']['estimated_waste_units'], 9.6)
        self.assertAlmostEqual(prep['scenario']['shortfall_units'], 3.6)

    def test_what_if_api_validation_and_output_shape(self):
        temp = tempfile.TemporaryDirectory(prefix='dineq-whatif-test-')
        self.addCleanup(temp.cleanup)
        app = create_app(service=object(), database_path=Path(temp.name) / 'app.sqlite')
        app.testing = True
        client = app.test_client()
        store = app.extensions['dineiq_store']
        user = store.create_user('whatif@example.test', 'strong-test-password', 'analyst')
        csrf = client.get('/api/auth/session').get_json()['csrf_token']
        login = client.post('/api/auth/login', json={'email': user['email'], 'password': 'strong-test-password'}, headers={'X-CSRF-Token': csrf})
        self.assertEqual(login.status_code, 200)
        ok = client.post('/api/what-if', json={'scenario': 'inventory', 'expected_demand_units': 100, 'on_hand_units': 95, 'wastage_rate': .1})
        self.assertEqual(ok.status_code, 200)
        self.assertAlmostEqual(ok.get_json()['scenario']['shortfall_units'], 15)
        self.assertEqual(client.post('/api/what-if', json=[]).status_code, 400)
        self.assertEqual(client.post('/api/what-if', json={'scenario': 'inventory', 'expected_demand_units': 100, 'on_hand_units': 95, 'wastage_rate': 2}).status_code, 400)

    def test_existing_demand_contract_and_gap_evidence(self):
        root = Path(__file__).resolve().parents[1]
        sys_path = root / 'scripts' / 'ml' / 'demand_common.py'
        self.assertTrue(sys_path.is_file())
        demand = json.loads((root / 'results' / 'ml' / 'gap1' / 'demand_baseline_comparison.json').read_text(encoding='utf-8'))
        gap = json.loads((root / 'results' / 'analytics' / 'gap1' / 'v6' / 'readback_verification.json').read_text(encoding='utf-8'))
        self.assertEqual(demand['test_rows'], 55200)
        self.assertGreaterEqual(demand['row_level_case_count'], 100)
        self.assertEqual(len({(x['restaurant_id'], x['hour_start']) for x in demand['row_level_cases']}), demand['row_level_case_count'])
        self.assertFalse(demand['models_retrained'])
        self.assertIn('not an exact controlled model comparison', demand['feature_semantics_note'])
        self.assertTrue(gap['checks']['menu_all_restaurant_item_pairs']['passed'])

    def test_independent_menu_metrics_compare_with_numeric_tolerance(self):
        root = Path(__file__).resolve().parents[1]
        report = json.loads((root / 'results' / 'comparison' / 'gap1' / 'menu_profitability_spark_python_v6.json').read_text(encoding='utf-8'))
        self.assertEqual(report['rows_compared'], 200)
        for name in ('units_sold', 'order_count', 'gross_item_sales', 'revenue', 'estimated_cost', 'contribution_margin'):
            self.assertEqual(report['metric_comparison'][name]['within_tolerance_0_01'], 200)

    def test_basket_recommendation_confidence_is_directional(self):
        temp = tempfile.TemporaryDirectory(prefix='dineq-basket-test-')
        self.addCleanup(temp.cleanup)
        pair = {'item_a': 'A', 'item_b': 'B', 'item_a_name': 'Alpha', 'item_b_name': 'Beta', 'pair_count': 40, 'count_a': 200, 'count_b': 50, 'support': .04, 'confidence_a_to_b': .2, 'confidence_b_to_a': .8, 'lift_a_to_b': 2.0, 'lift_b_to_a': 2.0}
        fake = SimpleNamespace(gap1_tables={'basket_rules': [pair]}, gap1_evidence={'basket': {'min_pair_count': 100, 'min_confidence': .1}})
        app = create_app(service=fake, database_path=Path(temp.name) / 'app.sqlite')
        client = app.test_client()
        store = app.extensions['dineiq_store']
        user = store.create_user('basket@example.test', 'strong-test-password', 'analyst')
        csrf = client.get('/api/auth/session').get_json()['csrf_token']
        login = client.post('/api/auth/login', json={'email': user['email'], 'password': 'strong-test-password'}, headers={'X-CSRF-Token': csrf})
        self.assertEqual(login.status_code, 200)
        rows = client.get('/api/intelligence/baskets?min_confidence=0.5').get_json()['items']
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['antecedent_id'], rows[0]['consequent_id']), ('B', 'A'))
        self.assertEqual(rows[0]['confidence'], .8)
        self.assertEqual(rows[0]['pair_count'], 40)
        self.assertEqual(rows[0]['support'], .04)
        self.assertTrue(rows[0]['recommendation_supported'])
        self.assertEqual(client.get('/api/intelligence/baskets?min_confidence=1.1').status_code, 400)

    def test_wastage_risk_temporal_evidence_and_reload(self):
        root = Path(__file__).resolve().parents[1]
        report = json.loads((root / 'results' / 'analytics' / 'gap1' / 'wastage_risk_v3' / 'pipeline.json').read_text(encoding='utf-8'))
        self.assertEqual(report['split']['train'], 280000)
        self.assertEqual(report['split']['validation'], 40000)
        self.assertEqual(report['split']['test'], 70000)
        self.assertEqual(report['split']['boundary_by_target_week'], {'train': '<2026-04-01', 'validation': '[2026-04-01,2026-06-01)', 'test': '>=2026-06-01'})
        self.assertEqual(len(report['models']), 3)
        self.assertEqual(report['selected_model'], 'logistic_regression')
        self.assertGreater(report['test_metrics']['recall'], 0)
        self.assertIn('pr_auc', report['test_metrics'])
        self.assertIn('confusion_matrix', report['test_metrics'])
        self.assertEqual(report['reload_smoke'], {'rows_with_probability': 16, 'expected': 16, 'passed': True})
        self.assertEqual(len(report['test_sample_predictions']), 100)
        exclusions = ' '.join(report['leakage_exclusions']).lower()
        self.assertIn('target-week', exclusions)
        self.assertIn('future wastage', exclusions)


if __name__ == '__main__':
    unittest.main()
