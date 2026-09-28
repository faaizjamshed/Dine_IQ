"""Write an evidence-based SRS gap reassessment for the new analytics marts."""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'results' / 'analytics' / 'srs_completion' / 'v1'
features = json.loads((OUT / 'features.json').read_text())
independent = json.loads((OUT / 'independent_validation.json').read_text())
forecast = independent['independent_forecasts']['levels']
report = {
    'version': 'v1',
    'scope': 'New versioned Spark feature marts and independent Python validation; backend API files were not changed.',
    'source': 'hdfs://localhost:9000/dineq/processed/v4',
    'new_evidence': ['results/analytics/srs_completion/v1/features.json', 'results/analytics/srs_completion/v1/independent_validation.json'],
    'requirements': {
        'ANALYTICS-01': {'status': 'IMPROVED_PARTIAL', 'evidence': f"{len(features['outputs'])} versioned feature marts cover menu, customer, basket, demand, wastage, rating, price/promotion and transaction quality families.", 'remaining': 'Expose new marts through authenticated API/UI without changing the existing backend contract.'},
        'ANALYTICS-02': {'status': 'IMPROVED_PARTIAL', 'evidence': '200 item rows include margin, rating proxy, repeat buyers, promotion dependency, 90-day trend, waste and location marts.', 'remaining': 'Rating is order-associated, not item-direct; add UI/API exposure and validate tricky cases end to end.'},
        'ANALYTICS-03': {'status': 'IMPROVED_PARTIAL', 'evidence': f"{independent['counts']['customer_features']} full customer rows include RFM, category/channel/time preference, promotion and visit features; {independent['independent_segments']['zero_order']} zero-order customers retained.", 'remaining': 'Independent segmentation agrees on dimensions but no UI/API surface or acceptance study yet.'},
        'ANALYTICS-04': {'status': 'IMPROVED_PARTIAL', 'evidence': f"{independent['basket_validation']['rows']} persisted pair rows; support/lift formulas independently recomputed with zero maximum error.", 'remaining': 'Recommendation acceptance and cost/impact tracking remain unavailable.'},
        'ANALYTICS-05': {'status': 'IMPROVED_PARTIAL', 'evidence': 'Independent chronological item/category/location forecasts beat the 7-day seasonal-naive baseline on MAE and RMSE for all three levels.', 'metrics': forecast, 'remaining': 'Persist forecast artifacts and expose configurable horizons through the backend/UI.'},
        'ANALYTICS-06': {'status': 'IMPROVED_PARTIAL', 'evidence': f"Daily, weekly, reason and inventory-aligned wastage marts generated ({independent['wastage_dimensions']['daily_rows']} daily rows; {independent['wastage_dimensions']['inventory_aligned_rows']} inventory-aligned rows).", 'remaining': 'Preparation quantity is absent from canonical schema; predictive risk output is still the prior screening model.'},
        'ANALYTICS-07': {'status': 'IMPROVED_PARTIAL', 'evidence': 'Price events, promotion flags, customer repeat, margin, wastage and post-period monthly behavior are now joined in versioned marts.', 'remaining': 'Effects remain observational; no causal claim is made and API/UI exposure is pending.'},
        'ANALYTICS-08': {'status': 'IMPROVED_PARTIAL', 'evidence': 'Rating context by item/location/month/promotion and transaction-quality candidates are persisted for anomaly rules.', 'remaining': 'Add persisted rule thresholds/adjudication labels and expose anomaly evidence through API/UI.'},
        'ANALYTICS-10': {'status': 'IMPROVED_PARTIAL', 'evidence': f"Independent chronological disengagement model: ROC-AUC {independent['independent_churn_model'].get('roc_auc'):.4f}, F1 {independent['independent_churn_model'].get('threshold_0_5_f1'):.4f}; label uses >45-day gap to next observed customer month.", 'remaining': 'This is an observational next-gap model; validate future labels and expose it through API/UI before claiming production churn.'},
    },
    'limitations': ['No preparation quantity exists in the canonical source schema.', 'Ratings are order-associated item proxies because source ratings have order/restaurant keys but no menu_item_id.', 'Promotion and price estimates are observational.', 'The application backend was deliberately left unchanged; new marts are evidence artifacts until a separately authorized API integration phase.'],
}
(OUT / 'srs_completion_report.json').write_text(json.dumps(report, indent=2, default=str))
lines = ['# SRS Analytics Completion Reassessment', '', 'This report covers new versioned Spark marts and independent Python validation. The existing backend was not changed.', '']
for key, value in report['requirements'].items():
    lines += [f'## {key}: {value["status"]}', '', value['evidence'], '', f'Remaining: {value["remaining"]}', '']
(OUT / 'srs_completion_report.md').write_text('\n'.join(lines), encoding='utf-8')
print(json.dumps({'output': str((OUT / 'srs_completion_report.json').relative_to(ROOT)), 'requirements': len(report['requirements'])}, indent=2))
