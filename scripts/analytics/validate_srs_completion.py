"""Independent pandas/sklearn validation for the SRS completion feature mart.

This reads the compact local Parquet marts produced by spark_features.py and
recomputes model/evaluation logic in Python. It never imports Spark outputs as
predictions and never modifies HDFS or backend files.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import time

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, mean_squared_error, roc_auc_score
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline

ROOT = Path(__file__).resolve().parents[2]


def load(out: Path, name: str) -> pd.DataFrame:
    return pd.read_parquet(out / f'{name}.parquet')


def safe_float(value):
    return None if pd.isna(value) else float(value)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--version', default='v1')
    args = parser.parse_args()
    out = ROOT / 'results' / 'analytics' / 'srs_completion' / args.version
    started = time.perf_counter()
    manifest = json.loads((out / 'features.json').read_text())
    menu = load(out, 'menu_features')
    customers = load(out, 'customer_features')
    customer_month = load(out, 'customer_month')
    daily = load(out, 'daily_demand')
    pairs = load(out, 'basket_pairs')
    basket_sizes = load(out, 'basket_sizes')
    weekly = load(out, 'weekly_operations')
    ratings = load(out, 'rating_context')
    quality = load(out, 'transaction_quality_candidates')

    report: dict[str, object] = {
        'version': args.version,
        'source_manifest': str((out / 'features.json').relative_to(ROOT)),
        'independent_pipeline': 'pandas + scikit-learn; no Spark model/prediction loaded',
        'counts': {name: int(len(frame)) for name, frame in [('menu_features', menu), ('customer_features', customers),
            ('customer_month', customer_month), ('daily_demand', daily), ('basket_pairs', pairs), ('weekly_operations', weekly)]},
        'menu_dimensions': {
            'item_count': int(len(menu)),
            'rating_coverage': float(menu.order_associated_rating.notna().mean()),
            'repeat_rate_coverage': float(menu.buyers.notna().mean()),
            'promotion_dependency_coverage': float(menu.promo_orders.notna().mean()),
            'trend_coverage': float(menu.units_previous_90d.notna().mean()),
            'wastage_coverage': float(menu.waste_cost.notna().mean()),
            'location_rows': int(len(load(out, 'location_menu'))),
            'classification_inputs': ['units', 'revenue', 'cost', 'margin', 'order_associated_rating', 'repeat_buyers', 'waste_cost', 'promo_orders', 'units_recent_90d', 'units_previous_90d'],
        },
        'customer_dimensions': {
            'customers_including_zero_order': int(len(customers)),
            'frequency_coverage': float(customers.frequency.notna().mean()),
            'category_preference_coverage': float(customers.preferred_category_name.notna().mean()),
            'channel_preference_coverage': float(customers.preferred_ordering_channel.notna().mean()),
            'time_preference_coverage': float(customers.preferred_hour.notna().mean()),
            'monthly_snapshots': int(len(customer_month)),
        },
        'wastage_dimensions': {
            'daily_rows': int(len(load(out, 'wastage_daily'))),
            'reason_rows': int(len(load(out, 'wastage_reasons'))),
            'weekly_rows': int(len(weekly)),
            'inventory_aligned_rows': int(len(load(out, 'wastage_inventory_alignment'))),
            'preparation_quantity_status': 'unavailable in canonical source schema',
        },
        'rating_anomaly_inputs': {
            'context_rows': int(len(ratings)),
            'quality_candidate_rows': int(len(quality)),
            'rating_dimensions': ['menu_item_id', 'restaurant_id', 'month', 'promotion_status'],
        },
    }

    # Independent customer segmentation, using all behavioral dimensions where present.
    c = customers.copy()
    c['frequency'] = c.frequency.fillna(0)
    c['monetary'] = c.monetary.fillna(0)
    c['aov'] = c.aov.fillna(0)
    c['recency_days'] = (pd.Timestamp(manifest['as_of']) - pd.to_datetime(c.last_order)).dt.days
    c.loc[c.frequency.eq(0), 'recency_days'] = np.nan
    active = c.frequency.gt(0)
    c['r_score'] = 0; c['f_score'] = 0; c['m_score'] = 0
    c.loc[active, 'r_score'] = pd.qcut(c.loc[active, 'recency_days'].rank(method='first'), 5, labels=False) + 1
    c.loc[active, 'r_score'] = 6 - c.loc[active, 'r_score']
    c.loc[active, 'f_score'] = pd.qcut(c.loc[active, 'frequency'].rank(method='first'), 5, labels=False) + 1
    c.loc[active, 'm_score'] = pd.qcut(c.loc[active, 'monetary'].rank(method='first'), 5, labels=False) + 1
    c['behavior_segment'] = 'No completed orders'
    c.loc[active & (c.recency_days >= 90) & (c.frequency >= 2), 'behavior_segment'] = 'At risk'
    c.loc[active & (c.r_score >= 4) & (c.f_score >= 4) & (c.m_score >= 4), 'behavior_segment'] = 'High-value loyal'
    c.loc[active & c.frequency.eq(1), 'behavior_segment'] = 'One-time'
    c.loc[active & c.r_score.ge(4) & ~c.behavior_segment.isin(['At risk', 'High-value loyal', 'One-time']), 'behavior_segment'] = 'Recent'
    c.loc[active & c.behavior_segment.eq('No completed orders'), 'behavior_segment'] = 'Established / lower engagement'
    report['independent_segments'] = {'counts': {str(k): int(v) for k, v in c.behavior_segment.value_counts().items()}, 'zero_order': int((c.frequency == 0).sum())}

    # Independent temporal forecast: global item/category/location daily demand with lag/calendar features.
    d = daily.copy(); d['day'] = pd.to_datetime(d.day)
    d = d.sort_values(['level', 'entity', 'day'])
    d['lag_1'] = d.groupby(['level', 'entity']).units.shift(1)
    d['lag_7'] = d.groupby(['level', 'entity']).units.shift(7)
    d['lag_28'] = d.groupby(['level', 'entity']).units.shift(28)
    d['dow'] = d.day.dt.dayofweek; d['month'] = d.day.dt.month
    d = d.dropna(subset=['lag_1', 'lag_7', 'lag_28'])
    cutoff = pd.Timestamp('2026-06-01')
    train, test = d[d.day < cutoff], d[d.day >= cutoff]
    features = ['lag_1', 'lag_7', 'lag_28', 'dow', 'month']
    forecast_metrics = {}
    for level in sorted(d.level.unique()):
        tr = train[train.level.eq(level)]; te = test[test.level.eq(level)]
        if len(tr) < 100 or len(te) < 30: continue
        model = HistGradientBoostingRegressor(max_iter=120, max_leaf_nodes=15, learning_rate=.08, random_state=42)
        model.fit(tr[features], tr.units)
        pred = np.maximum(0, model.predict(te[features]))
        baseline = te.lag_7.to_numpy()
        forecast_metrics[level] = {'rows_train': int(len(tr)), 'rows_test': int(len(te)),
            'model': {'mae': float(mean_absolute_error(te.units, pred)), 'rmse': float(np.sqrt(mean_squared_error(te.units, pred)))},
            'seasonal_naive_7d': {'mae': float(mean_absolute_error(te.units, baseline)), 'rmse': float(np.sqrt(mean_squared_error(te.units, baseline)))}}
    report['independent_forecasts'] = {'cutoff': str(cutoff.date()), 'levels': forecast_metrics, 'features': features}

    # Independent next-month engagement model. Rows with a known next month label are chronological observations.
    cm = customer_month.copy(); cm['month_date'] = pd.to_datetime(cm.month + '-01'); cm = cm.sort_values(['customer_id', 'month_date'])
    cm['next_month_date'] = cm.groupby('customer_id').month_date.shift(-1)
    cm = cm[cm.next_month_date.notna()].copy()
    # The source mart stores active months only. A gap greater than 45 days is
    # therefore the observable next-period disengagement label.
    cm['label_no_next_month'] = ((cm.next_month_date - cm.month_date).dt.days > 45).astype(int)
    cm['promo_share'] = cm.promo_orders / cm.orders.clip(lower=1)
    cm['category_count'] = cm.categories.fillna('').map(lambda x: len(x) if isinstance(x, (list, np.ndarray)) else 0)
    cols = ['orders', 'spend', 'visit_days', 'promo_share', 'category_count']
    cm[cols] = cm[cols].replace([np.inf, -np.inf], np.nan)
    cm = cm.dropna(subset=cols)
    if len(cm) >= 100 and cm.label_no_next_month.nunique() == 2:
        split = cm.month_date < cm.month_date.quantile(.75)
        model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=300, class_weight='balanced', random_state=42))
        model.fit(cm.loc[split, cols], cm.loc[split, 'label_no_next_month'])
        score = model.predict_proba(cm.loc[~split, cols])[:, 1]
        actual = cm.loc[~split, 'label_no_next_month']
        report['independent_churn_model'] = {'label': 'no orders in next observed month', 'features': cols, 'train_rows': int(split.sum()), 'test_rows': int((~split).sum()),
            'positive_rate_test': float(actual.mean()), 'roc_auc': float(roc_auc_score(actual, score)),
            'threshold_0_5_f1': float(f1_score(actual, score >= .5)), 'accuracy': float(accuracy_score(actual, score >= .5))}
    else:
        report['independent_churn_model'] = {'status': 'insufficient labelled chronological rows'}

    # Basket sanity: support/lift identities recomputed from persisted counts (no recommendation reuse).
    if len(pairs):
        pairs['support_recomputed'] = pairs.pair_count / pairs.basket_count
        pairs['lift_recomputed'] = pairs.pair_count * pairs.basket_count / (pairs.count_a * pairs.count_b)
        report['basket_validation'] = {'rows': int(len(pairs)), 'support_max_error': float((pairs.support - pairs.support_recomputed).abs().max()),
            'lift_max_error': float((pairs.lift - pairs.lift_recomputed).abs().max()), 'basket_size_rows': int(len(basket_sizes)),
            'independent_formula_check': True}

    report['elapsed_seconds'] = round(time.perf_counter() - started, 3)
    (out / 'independent_validation.json').write_text(json.dumps(report, indent=2, default=str))
    print(json.dumps(report, indent=2, default=str))


if __name__ == '__main__':
    main()
