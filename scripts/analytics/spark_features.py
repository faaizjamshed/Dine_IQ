"""Extract SRS feature marts from immutable canonical v4 HDFS tables.

Run with --version v1. Existing output versions are never overwritten.
All joins and large transaction aggregations run in Spark. Compact marts are
also exported as local Parquet for reproducible analysis and model evaluation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

from pyspark import StorageLevel
from pyspark.sql import functions as F, Window

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts' / 'spark'))
from common import spark, HDFS, PROCESSED


def safe_ratio(numerator, denominator):
    return F.when(denominator > 0, numerator / denominator)


def favourite(frame, key, value, weight=None):
    grouped = frame.groupBy(key, value).agg((F.sum(weight) if weight else F.count('*')).alias('_n'))
    window = Window.partitionBy(key).orderBy(F.desc('_n'), F.col(value).asc_nulls_last())
    return grouped.withColumn('_rank', F.row_number().over(window)).where('_rank = 1').select(key, F.col(value).alias('preferred_' + value))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', default='v1')
    args = parser.parse_args()
    if not re.fullmatch(r'v[0-9]+', args.version):
        parser.error('version must be vN')
    out = ROOT / 'results' / 'analytics' / 'srs_completion' / args.version
    if out.exists():
        raise SystemExit(f'Output already exists: {out}; use a new version')
    out.mkdir(parents=True)
    started = time.perf_counter()
    manifest = {'version': args.version, 'status': 'RUNNING', 'source': f'{PROCESSED}/v4',
                'hdfs_output': f'{HDFS}/dineq/results/srs_completion/{args.version}', 'outputs': {}}
    sp = spark('DineIQ-SRS-Feature-Completion-' + args.version, master='local[2]', shuffle_partitions=8)
    sp.sparkContext.setLogLevel('ERROR')
    sp.conf.set('spark.sql.execution.arrow.pyspark.enabled', 'true')
    sp.conf.set('spark.sql.execution.arrow.maxRecordsPerBatch', '10000')

    def save(name, frame, keys=None):
        destination = manifest['hdfs_output'] + '/' + name
        frame.write.mode('errorifexists').parquet(destination)
        persisted = sp.read.parquet(destination)
        pdf = persisted.toPandas()
        if keys and pdf.duplicated(keys).any():
            raise ValueError(f'{name}: duplicate keys {keys}')
        path = out / (name + '.parquet')
        pdf.to_parquet(path, index=False)
        manifest['outputs'][name] = {'rows': len(pdf), 'columns': list(pdf.columns), 'keys': keys,
                                     'hdfs': destination, 'local': str(path.relative_to(ROOT)),
                                     'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        (out / 'features.json').write_text(json.dumps(manifest, indent=2, default=str))
        print(f'SAVED {name}: {len(pdf):,} rows', flush=True)
        return persisted

    try:
        names = ['orders', 'order_items', 'menu_items', 'menu_categories', 'restaurants', 'customers',
                 'ratings', 'wastage', 'inventory', 'pricing_history', 'promotions']
        t = {name: sp.read.parquet(f'{PROCESSED}/v4/{name}') for name in names}
        orders = (t['orders'].where((F.col('order_status') == 'Completed') & F.col('order_datetime').isNotNull())
                  .withColumn('day', F.to_date('order_datetime'))
                  .withColumn('month', F.date_format('order_datetime', 'yyyy-MM'))
                  .withColumn('hour', F.hour('order_datetime'))
                  .withColumn('weekday', F.pmod(F.dayofweek('order_datetime') + 5, F.lit(7)))
                  .withColumn('weekend', (F.col('weekday') >= 5).cast('int'))
                  .withColumn('promoted', F.col('promotion_id').isNotNull().cast('int'))
                  .withColumn('discount_pct', safe_ratio(F.col('discount_amount'), F.col('subtotal')))
                  .persist(StorageLevel.MEMORY_AND_DISK))
        bounds = orders.agg(F.min('day').alias('start'), F.max('day').alias('end')).first()
        start, end = bounds['start'], bounds['end']
        manifest.update({'start': str(start), 'as_of': str(end), 'weekday_encoding': 'Monday=0',
                         'source_orders': orders.count(),
                         'rating_semantics': 'Order-associated food_rating proxy, not direct item ratings; future-dated ratings excluded.',
                         'inventory_semantics': 'Dated source snapshots, not daily consumption flows. No forward-fill in descriptive totals.',
                         'preparation_quantity': 'Unavailable in canonical schema; never imputed as actual preparation.',
                         'revenue_semantics': 'line_total - order_discount * line_total / source subtotal; static menu cost; positive quantity/nonnegative line values.'})
        menu = t['menu_items'].join(t['menu_categories'].select('category_id', 'category_name'), 'category_id')
        line = (t['order_items'].where((F.col('quantity') > 0) & (F.col('unit_price') >= 0) & (F.col('line_total') >= 0))
                .join(orders.select('order_id', 'customer_id', 'restaurant_id', 'promotion_id', 'order_datetime', 'day', 'month',
                                    'weekday', 'weekend', 'hour', 'ordering_channel', 'subtotal', 'discount_amount', 'promoted'), 'order_id')
                .join(menu.select('menu_item_id', 'item_name', 'category_id', 'category_name', 'cost_price', 'base_price', 'launch_date'), 'menu_item_id')
                .withColumn('net_revenue', F.when((F.col('discount_amount') >= 0) & (F.col('subtotal') > 0),
                                                 F.col('line_total') - F.col('discount_amount') * F.col('line_total') / F.col('subtotal')))
                .withColumn('estimated_cost', F.when(F.col('cost_price') >= 0, F.col('quantity') * F.col('cost_price')))
                .withColumn('margin', F.col('net_revenue') - F.col('estimated_cost'))
                .persist(StorageLevel.MEMORY_AND_DISK))
        save('catalog', menu, ['menu_item_id'])
        save('customers', t['customers'].select('customer_id', 'signup_date'), ['customer_id'])
        save('promotions', t['promotions'], ['promotion_id'])
        save('price_events', t['pricing_history'], ['price_history_id'])
        save('inventory_snapshots', t['inventory'], ['inventory_id'])

        # Distinct membership prevents multiple lines from multiplying ratings and repeat counts.
        membership = line.select('order_id', 'menu_item_id', 'customer_id', 'category_id', 'category_name').distinct().persist(StorageLevel.MEMORY_AND_DISK)
        repeat = membership.groupBy('menu_item_id', 'customer_id').agg(F.countDistinct('order_id').alias('purchases'))
        repeat = repeat.groupBy('menu_item_id').agg(F.count('*').alias('buyers'), F.sum((F.col('purchases') >= 2).cast('int')).alias('repeat_buyers'))
        item = line.groupBy('menu_item_id').agg(
            F.sum('quantity').alias('units'), F.countDistinct('order_id').alias('orders'), F.sum('net_revenue').alias('revenue'),
            F.sum('estimated_cost').alias('cost'), F.sum('margin').alias('margin'), F.sum('line_total').alias('gross_revenue'),
            F.sum(F.col('quantity') * F.col('unit_price')).alias('before_item_discount_revenue'),
            F.countDistinct(F.when(F.col('promoted') == 1, F.col('order_id'))).alias('promo_orders'),
            F.sum(F.when(F.col('promoted') == 1, F.col('net_revenue')).otherwise(0)).alias('promo_revenue'),
            F.sum(F.when(F.col('weekend') == 1, F.col('quantity')).otherwise(0)).alias('weekend_units'),
            F.min('day').alias('first_sale'), F.max('day').alias('last_sale'),
            F.sum(F.when(F.col('day') > F.date_sub(F.lit(end), 90), F.col('quantity')).otherwise(0)).alias('units_recent_90d'),
            F.sum(F.when((F.col('day') > F.date_sub(F.lit(end), 180)) & (F.col('day') <= F.date_sub(F.lit(end), 90)), F.col('quantity')).otherwise(0)).alias('units_previous_90d'),
            F.sum(F.col('net_revenue').isNull().cast('int')).alias('invalid_revenue_lines'),
            F.sum(F.col('estimated_cost').isNull().cast('int')).alias('invalid_cost_lines'))
        rating_base = t['ratings'].where(F.col('rating').between(1, 5) & (F.col('rating_date') <= F.lit(end)))
        linked_ratings = (rating_base.join(orders.select('order_id', F.col('customer_id').alias('order_customer_id'),
                                                       F.col('restaurant_id').alias('order_restaurant_id'), 'day', 'promoted'), 'order_id')
                          .withColumn('identity_mismatch', (F.col('customer_id') != F.col('order_customer_id')) | (F.col('restaurant_id') != F.col('order_restaurant_id')))
                          .withColumn('before_purchase', F.col('rating_date') < F.col('day')))
        valid_ratings = linked_ratings.where(~F.col('identity_mismatch') & ~F.col('before_purchase'))
        item_ratings = valid_ratings.join(membership.select('order_id', 'menu_item_id').distinct(), 'order_id')
        rating_metrics = item_ratings.groupBy('menu_item_id').agg(
            F.avg('food_rating').alias('order_associated_rating'), F.count('food_rating').alias('rated_orders'),
            F.avg(F.when(F.col('rating_date') > F.date_sub(F.lit(end), 90), F.col('food_rating'))).alias('rating_recent_90d'),
            F.avg(F.when((F.col('rating_date') > F.date_sub(F.lit(end), 180)) & (F.col('rating_date') <= F.date_sub(F.lit(end), 90)), F.col('food_rating'))).alias('rating_previous_90d'))
        waste = t['wastage'].where((F.col('quantity_wasted') >= 0) & (F.col('wastage_cost') >= 0) & (F.col('wastage_date') <= F.lit(end)))
        waste_item = waste.groupBy('menu_item_id').agg(F.sum('quantity_wasted').alias('waste_units'), F.sum('wastage_cost').alias('waste_cost'))
        save('menu_features', menu.join(item, 'menu_item_id', 'left').join(repeat, 'menu_item_id', 'left')
             .join(rating_metrics, 'menu_item_id', 'left').join(waste_item, 'menu_item_id', 'left'), ['menu_item_id'])

        daily = (line.groupBy('restaurant_id', 'menu_item_id', 'category_id', 'day').agg(
            F.sum('quantity').alias('units'), F.countDistinct('order_id').alias('orders'), F.sum('net_revenue').alias('revenue'),
            F.sum('margin').alias('margin'), F.sum('estimated_cost').alias('cost'),
            F.sum(F.when(F.col('promoted') == 1, F.col('quantity')).otherwise(0)).alias('promo_units'),
            F.sum(F.col('quantity') * F.col('unit_price')).alias('list_value'),
            F.countDistinct('customer_id').alias('buyers')).persist(StorageLevel.MEMORY_AND_DISK))
        save('daily_item_location', daily, ['restaurant_id', 'menu_item_id', 'day'])
        save('daily_demand', daily.groupBy('menu_item_id', 'day').agg(F.sum('units').alias('units'))
             .select(F.lit('item').alias('level'), F.col('menu_item_id').alias('entity'), 'day', 'units')
             .unionByName(daily.groupBy('category_id', 'day').agg(F.sum('units').alias('units'))
                          .select(F.lit('category').alias('level'), F.col('category_id').alias('entity'), 'day', 'units'))
             .unionByName(daily.groupBy('restaurant_id', 'day').agg(F.sum('units').alias('units'))
                          .select(F.lit('location').alias('level'), F.col('restaurant_id').alias('entity'), 'day', 'units')), ['level', 'entity', 'day'])
        save('location_menu', daily.groupBy('restaurant_id', 'menu_item_id').agg(
            F.sum('units').alias('units'), F.sum('revenue').alias('revenue'), F.sum('margin').alias('margin'), F.sum('cost').alias('cost')),
             ['restaurant_id', 'menu_item_id'])
        save('peak_periods', orders.groupBy('restaurant_id', 'ordering_channel', 'month', 'weekday', 'hour').agg(
            F.count('*').alias('orders'), F.sum('final_amount').alias('revenue')), ['restaurant_id', 'ordering_channel', 'month', 'weekday', 'hour'])

        # Full-customer behavioral feature coverage, including non-purchasers.
        customer_activity = orders.groupBy('customer_id').agg(
            F.countDistinct('order_id').alias('frequency'), F.sum('final_amount').alias('monetary'), F.avg('final_amount').alias('aov'),
            F.min('order_datetime').alias('first_order'), F.max('order_datetime').alias('last_order'), F.countDistinct('day').alias('visit_days'),
            F.sum('promoted').alias('promo_orders'), F.avg('discount_pct').alias('mean_discount_pct'),
            F.sum('weekend').alias('weekend_orders'), F.countDistinct('restaurant_id').alias('locations'))
        diversity = membership.groupBy('customer_id').agg(F.countDistinct('category_id').alias('category_diversity'), F.countDistinct('menu_item_id').alias('item_diversity'))
        customer = (t['customers'].select('customer_id', 'signup_date').join(customer_activity, 'customer_id', 'left')
                    .join(diversity, 'customer_id', 'left').join(favourite(orders, 'customer_id', 'ordering_channel'), 'customer_id', 'left')
                    .join(favourite(orders, 'customer_id', 'hour'), 'customer_id', 'left')
                    .join(favourite(membership, 'customer_id', 'category_name'), 'customer_id', 'left'))
        save('customer_features', customer, ['customer_id'])
        cm = orders.groupBy('customer_id', 'month').agg(F.count('*').alias('orders'), F.sum('final_amount').alias('spend'),
             F.countDistinct('day').alias('visit_days'), F.max('day').alias('last_order_day'), F.sum('promoted').alias('promo_orders'))
        cm_categories = (membership.select('order_id', 'customer_id', 'category_id').join(orders.select('order_id', 'month'), 'order_id')
                         .groupBy('customer_id', 'month').agg(F.collect_set('category_id').alias('categories')))
        save('customer_month', cm.join(cm_categories, ['customer_id', 'month'], 'left'), ['customer_id', 'month'])
        save('customer_order_history', orders.select('order_id', 'customer_id', 'restaurant_id', 'promotion_id', 'order_datetime',
             'day', 'month', 'ordering_channel', 'final_amount', 'subtotal', 'discount_amount'), ['order_id'])

        # Independent Python verification reconstructs all pair counts from raw CSV.
        baskets = membership.select('order_id', 'menu_item_id').distinct()
        basket_n = baskets.select('order_id').distinct().count()
        freq = baskets.groupBy('menu_item_id').count()
        pairs = (baskets.alias('a').join(baskets.alias('b'), (F.col('a.order_id') == F.col('b.order_id')) & (F.col('a.menu_item_id') < F.col('b.menu_item_id')))
                 .select(F.col('a.menu_item_id').alias('item_a'), F.col('b.menu_item_id').alias('item_b')).groupBy('item_a', 'item_b').count()
                 .withColumnRenamed('count', 'pair_count')
                 .join(freq.select(F.col('menu_item_id').alias('item_a'), F.col('count').alias('count_a')), 'item_a')
                 .join(freq.select(F.col('menu_item_id').alias('item_b'), F.col('count').alias('count_b')), 'item_b')
                 .withColumn('basket_count', F.lit(basket_n)).withColumn('support', F.col('pair_count') / basket_n)
                 .withColumn('confidence_a_to_b', F.col('pair_count') / F.col('count_a'))
                 .withColumn('confidence_b_to_a', F.col('pair_count') / F.col('count_b'))
                 .withColumn('lift', F.col('pair_count') * basket_n / (F.col('count_a') * F.col('count_b'))))
        save('basket_pairs', pairs, ['item_a', 'item_b'])
        save('basket_sizes', baskets.groupBy('order_id').agg(F.count('*').alias('distinct_items')).groupBy('distinct_items').count(), ['distinct_items'])
        manifest['basket_count'] = basket_n

        # Align waste and demand at exact item/location/day; snapshot availability stays explicit.
        wd = waste.groupBy('restaurant_id', 'menu_item_id', F.col('wastage_date').alias('day')).agg(
            F.sum('quantity_wasted').alias('waste_units'), F.sum('wastage_cost').alias('waste_cost'))
        aligned = daily.join(wd, ['restaurant_id', 'menu_item_id', 'day'], 'full')
        aligned = aligned.drop('category_id').join(menu.select('menu_item_id', 'category_id'), 'menu_item_id', 'left')
        aligned = aligned.fillna({'units': 0, 'orders': 0, 'promo_units': 0, 'revenue': 0, 'margin': 0, 'cost': 0, 'waste_units': 0, 'waste_cost': 0})
        save('wastage_daily', wd.join(menu.select('menu_item_id', 'category_id'), 'menu_item_id'), ['restaurant_id', 'menu_item_id', 'day'])
        save('wastage_reasons', waste.groupBy('restaurant_id', 'menu_item_id', 'reason').agg(
            F.sum('quantity_wasted').alias('waste_units'), F.sum('wastage_cost').alias('waste_cost')), ['restaurant_id', 'menu_item_id', 'reason'])
        save('weekly_operations', aligned.withColumn('week', F.to_date(F.date_trunc('week', 'day')))
             .groupBy('restaurant_id', 'menu_item_id', 'category_id', 'week').agg(
                 *[F.sum(c).alias(c) for c in ['units', 'orders', 'promo_units', 'revenue', 'margin', 'waste_units', 'waste_cost']]),
             ['restaurant_id', 'menu_item_id', 'week'])
        inv = t['inventory'].groupBy('restaurant_id', 'menu_item_id', F.col('record_date').alias('day')).agg(
            F.sum('stock_used').alias('snapshot_stock_used'), F.sum('opening_stock').alias('snapshot_opening'),
            F.sum('stock_received').alias('snapshot_received'), F.sum('closing_stock').alias('snapshot_closing'))
        save('wastage_inventory_alignment', wd.join(inv, ['restaurant_id', 'menu_item_id', 'day'], 'left')
             .join(daily.select('restaurant_id', 'menu_item_id', 'day', 'units', 'promo_units'), ['restaurant_id', 'menu_item_id', 'day'], 'left')
             .withColumn('preparation_quantity', F.lit(None).cast('double')), ['restaurant_id', 'menu_item_id', 'day'])
        save('rating_events', linked_ratings.select('rating_id', 'order_id', 'customer_id', 'restaurant_id', 'rating', 'food_rating',
             'rating_date', 'day', 'promoted', 'identity_mismatch', 'before_purchase'), ['rating_id'])
        save('rating_context', item_ratings.withColumn('month', F.date_format('rating_date', 'yyyy-MM'))
             .groupBy('menu_item_id', 'restaurant_id', 'month', 'promoted').agg(F.avg('food_rating').alias('order_associated_rating'),
             F.count('food_rating').alias('rating_count')), ['menu_item_id', 'restaurant_id', 'month', 'promoted'])
        # Keep suspicious transactions observable without changing canonical cleaning policy.
        save('transaction_quality_candidates', t['orders'].where((F.col('discount_amount') < 0) | (F.col('discount_amount') > F.col('subtotal')) |
             (F.col('final_amount') < 0) | F.col('order_datetime').isNull()), ['order_id'])
        manifest['source_quality_evidence'] = 'results/spark/quality_cleaning.json'
        manifest['status'] = 'COMPLETE'
    except Exception as exc:
        manifest['status'] = 'FAILED'
        manifest['error'] = f'{type(exc).__name__}: {exc}'
        raise
    finally:
        manifest['elapsed_seconds'] = round(time.perf_counter() - started, 3)
        (out / 'features.json').write_text(json.dumps(manifest, indent=2, default=str))
        sp.stop()


if __name__ == '__main__':
    main()
