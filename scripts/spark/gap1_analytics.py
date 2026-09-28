"""Versioned SRS gap-closure analytics over canonical Spark v4 Parquet.

No v4 path is written. Monetary columns are unitless because the source has
no evidenced currency. Outputs are deterministic Spark aggregates/rules.
"""
from __future__ import annotations
import argparse, json, sys, time
from pathlib import Path
from pyspark.sql import functions as F, Window
from pyspark.sql.types import DoubleType

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import HDFS, PROCESSED, spark, save_json

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "results" / "analytics" / "gap1"

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--version',default='v1'); ap.add_argument('--min-pair-count',type=int,default=100); ap.add_argument('--min-confidence',type=float,default=.10)
    a=ap.parse_args()
    if not a.version.startswith('v') or not a.version[1:].isdigit(): raise SystemExit('version must be vN')
    started=time.perf_counter(); sp=spark('DineIQ-Gap1-Analytics'); root=f'{HDFS}/dineq/results/gap1/{a.version}'
    try:
        tables={n:sp.read.parquet(f'{PROCESSED}/v4/{n}') for n in ['orders','order_items','menu_items','menu_categories','restaurants','customers','ratings','wastage','inventory','pricing_history','promotions']}
        orders=tables['orders'].where(F.col('order_status')=='Completed').select('order_id','customer_id','restaurant_id','promotion_id','order_datetime','ordering_channel','subtotal','discount_amount','final_amount')
        items=tables['order_items'].where((F.col('quantity')>0)&(F.col('unit_price')>=0)&(F.col('line_total')>=0)).select('order_id','menu_item_id','quantity','unit_price','item_discount','line_total')
        menu=tables['menu_items'].select('menu_item_id','category_id','item_name','base_price','cost_price','launch_date')
        cats=tables['menu_categories'].select('category_id','category_name')
        valid=items.join(orders,'order_id').join(menu,'menu_item_id')
        valid=(valid.where(F.col('discount_amount').isNotNull()&(F.col('discount_amount')>=0)&(F.col('subtotal')>0))
          .withColumn('gross_item_sales',F.col('line_total'))
          .withColumn('net_item_revenue',F.col('line_total')-(F.col('discount_amount')*F.col('line_total')/F.col('subtotal'))))
        item_stats=valid.groupBy('menu_item_id','item_name','category_id').agg(
            F.sum('quantity').alias('units_sold'),F.countDistinct('order_id').alias('order_count'),F.sum('gross_item_sales').alias('gross_item_sales'),F.sum('net_item_revenue').alias('revenue'),
            F.sum(F.col('quantity')*F.col('cost_price')).alias('estimated_cost'),F.min('cost_price').alias('unit_cost'),F.min('launch_date').alias('launch_date'))
        item_stats=item_stats.withColumn('contribution_margin',F.col('revenue')-F.col('estimated_cost')).withColumn('contribution_margin_pct',F.when(F.col('revenue')>0,(F.col('revenue')-F.col('estimated_cost'))/F.col('revenue')))
        waste=tables['wastage'].where(F.col('quantity_wasted')>=0).groupBy('menu_item_id').agg(F.sum('quantity_wasted').alias('quantity_wasted'),F.sum('wastage_cost').alias('wastage_cost'))
        ratings=tables['ratings'].groupBy('restaurant_id').agg(F.avg('rating').alias('restaurant_rating'),F.count('*').alias('rating_count'))
        # Percentile thresholds are empirical within this frozen observation window.
        eligible=item_stats.where(F.col('revenue')>0)
        cuts=eligible.agg(F.expr('percentile_approx(units_sold, 0.75)').alias('pop_cut'),F.expr('percentile_approx(contribution_margin_pct, 0.75)').alias('margin_cut')).first()
        popcut=cuts['pop_cut'] or 0; margincut=cuts['margin_cut'] or 0
        waste_cut=(item_stats.join(waste,'menu_item_id','left').where(F.col('estimated_cost')>0)
          .select((F.coalesce(F.col('wastage_cost'),F.lit(0.0))/F.col('estimated_cost')).alias('waste_ratio'))
          .agg(F.expr('percentile_approx(waste_ratio, 0.75)').alias('cut')).first()['cut']) or 0
        menu_out=(tables['menu_items'].join(item_stats.drop('item_name','launch_date','category_id'), 'menu_item_id','left').join(cats,'category_id','left').join(waste,'menu_item_id','left')
          .withColumn('popularity_threshold_units_p75',F.lit(float(popcut))).withColumn('margin_threshold_pct_p75',F.lit(float(margincut)))
          .withColumn('wastage_cost_ratio',F.when(F.col('estimated_cost')>0,F.coalesce(F.col('wastage_cost'),F.lit(0.0))/F.col('estimated_cost')))
          .withColumn('performance_class',F.when(F.col('launch_date')>F.date_sub(F.lit('2026-08-31').cast('date'),90),'Insufficient history')
            .when(F.col('cost_price').isNull() | (F.col('cost_price')<=0),'Insufficient cost data')
            .when(F.col('revenue').isNull(),'Low Performer')
            .when(F.col('unit_cost').isNull(),'Insufficient cost data')
            .when((F.col('units_sold')>=popcut)&(F.col('contribution_margin_pct')>=margincut)&(F.coalesce(F.col('wastage_cost_ratio'),F.lit(0))<=waste_cut),'Profit Driver')
            .when(F.col('units_sold')>=popcut,'Volume Driver')
            .when(F.col('contribution_margin_pct')>=margincut,'Hidden Opportunity').otherwise('Low Performer'))
          .withColumn('classification_method',F.lit('within-catalog 75th percentile units and margin%; profit-driver wastage-cost <= 10% of estimated cost; as-of 2026-08-31; descriptive')))
        menu_location=(valid.groupBy('restaurant_id','menu_item_id','item_name').agg(F.sum('quantity').alias('units_sold'),F.sum('gross_item_sales').alias('gross_item_sales'),F.sum('net_item_revenue').alias('revenue'),F.sum(F.col('quantity')*F.col('cost_price')).alias('estimated_cost'),F.countDistinct('order_id').alias('orders'))
          .withColumn('contribution_margin',F.col('revenue')-F.col('estimated_cost'))
          .withColumn('contribution_margin_pct',F.when(F.col('revenue')>0,F.col('contribution_margin')/F.col('revenue'))))
        # Pair basket counts: each distinct item is present at most once per completed order.
        basket=valid.select('order_id','menu_item_id').dropDuplicates()
        basket_n=basket.select('order_id').distinct().count()
        item_freq=basket.groupBy('menu_item_id').agg(F.countDistinct('order_id').alias('item_count'))
        left=basket.alias('l'); right=basket.alias('r')
        pairs=(left.join(right,(F.col('l.order_id')==F.col('r.order_id'))&(F.col('l.menu_item_id')<F.col('r.menu_item_id')))
          .select(F.col('l.menu_item_id').alias('item_a'),F.col('r.menu_item_id').alias('item_b'),F.col('l.order_id').alias('order_id'))
          .groupBy('item_a','item_b').agg(F.countDistinct('order_id').alias('pair_count'))
          .where(F.col('pair_count')>=a.min_pair_count)
          .join(item_freq.withColumnRenamed('menu_item_id','item_a').withColumnRenamed('item_count','count_a'),'item_a')
          .join(item_freq.withColumnRenamed('menu_item_id','item_b').withColumnRenamed('item_count','count_b'),'item_b'))
        rules=(pairs.withColumn('support',F.col('pair_count')/F.lit(max(basket_n,1)))
          .withColumn('confidence_a_to_b',F.col('pair_count')/F.col('count_a')).withColumn('confidence_b_to_a',F.col('pair_count')/F.col('count_b'))
          .withColumn('lift_a_to_b',F.col('confidence_a_to_b')/(F.col('count_b')/F.lit(max(basket_n,1))))
          .withColumn('lift_b_to_a',F.col('confidence_b_to_a')/(F.col('count_a')/F.lit(max(basket_n,1))))
          .where((F.col('confidence_a_to_b')>=a.min_confidence)|(F.col('confidence_b_to_a')>=a.min_confidence))
          .join(menu.select(F.col('menu_item_id').alias('item_a'),'item_name').withColumnRenamed('item_name','item_a_name'),'item_a')
          .join(menu.select(F.col('menu_item_id').alias('item_b'),'item_name').withColumnRenamed('item_name','item_b_name'),'item_b'))
        # RFM and behavior segments, independent of synthetic source segment labels.
        asof=orders.agg(F.max('order_datetime').alias('maxdt')).first()['maxdt']
        asof_date=asof.date().isoformat() if asof else '2026-08-31'
        rfm=orders.groupBy('customer_id').agg(F.max('order_datetime').alias('last_order'),F.countDistinct('order_id').alias('frequency'),F.sum('final_amount').alias('monetary_value'),F.avg('final_amount').alias('avg_order_value'),F.countDistinct('restaurant_id').alias('restaurant_diversity'))
        rfm=rfm.withColumn('recency_days',F.datediff(F.lit(asof_date).cast('date'),F.to_date('last_order')))
        w=Window.orderBy(F.col('recency_days').desc()); wf=Window.orderBy('frequency'); wm=Window.orderBy('monetary_value')
        rfm=rfm.withColumn('r_score',6-F.ntile(5).over(w)).withColumn('f_score',F.ntile(5).over(wf)).withColumn('m_score',F.ntile(5).over(wm))
        rfm=rfm.withColumn('behavior_segment',F.when((F.col('recency_days')>=90)&(F.col('frequency')>=2),'At risk (90d inactive)')
          .when((F.col('r_score')>=4)&(F.col('f_score')>=4)&(F.col('m_score')>=4),'High-value loyal')
          .when((F.col('frequency')==1),'One-time customer').when(F.col('r_score')>=4,'Recent customer').otherwise('Established / lower engagement'))
        rfm=rfm.withColumn('analysis_as_of',F.lit(asof_date))
        # Wastage dimensional rollups; inventory relationship is explicitly by same restaurant/item/date.
        wdf=tables['wastage'].where((F.col('quantity_wasted')>=0)&(F.col('wastage_cost')>=0)).alias('w')
        md=menu.select('menu_item_id','category_id','item_name'); cd=cats
        wastage_dim=(wdf.join(md,'menu_item_id','left').join(cd,'category_id','left').join(tables['restaurants'].select('restaurant_id','restaurant_name','city'),'restaurant_id','left')
          .withColumn('waste_month',F.date_format('wastage_date','yyyy-MM')).withColumn('weekday',F.date_format('wastage_date','EEEE'))
          .groupBy('restaurant_id','restaurant_name','city','menu_item_id','item_name','category_name','waste_month','weekday','reason')
          .agg(F.sum('quantity_wasted').alias('quantity_wasted'),F.sum('wastage_cost').alias('wastage_cost'),F.count('*').alias('records')))
        # Inventory descriptive risk ranking only: no held-out outcome model is claimed.
        waste_risk=(wastage_dim.groupBy('restaurant_id','menu_item_id','item_name').agg(F.sum('quantity_wasted').alias('historical_quantity_wasted'),F.sum('wastage_cost').alias('historical_wastage_cost'),F.count('*').alias('waste_periods'))
          .withColumn('risk_rank',F.dense_rank().over(Window.orderBy(F.desc('historical_wastage_cost')))).withColumn('method',F.lit('historical burden ranking; descriptive, not predictive')))
        # Price elasticity: before/after 30-day unit rates, by item/location. Non-causal association.
        ph=tables['pricing_history'].where((F.col('old_price')>0)&(F.col('new_price')>0)).select('menu_item_id','restaurant_id','old_price','new_price','effective_from')
        daily=(valid.withColumn('order_date',F.to_date('order_datetime')).groupBy('restaurant_id','menu_item_id','order_date').agg(F.sum('quantity').alias('units')))
        pre=daily.alias('d').join(ph.alias('p'),(F.col('d.restaurant_id')==F.col('p.restaurant_id'))&(F.col('d.menu_item_id')==F.col('p.menu_item_id'))&(F.col('d.order_date')>=F.date_sub(F.col('p.effective_from'),30))&(F.col('d.order_date')<F.col('p.effective_from')),'inner').groupBy('p.menu_item_id','p.restaurant_id','p.old_price','p.new_price','p.effective_from').agg(F.sum('d.units').alias('pre_units'))
        post=daily.alias('d').join(ph.alias('p'),(F.col('d.restaurant_id')==F.col('p.restaurant_id'))&(F.col('d.menu_item_id')==F.col('p.menu_item_id'))&(F.col('d.order_date')>=F.col('p.effective_from'))&(F.col('d.order_date')<F.date_add(F.col('p.effective_from'),30)),'inner').groupBy('p.menu_item_id','p.restaurant_id','p.old_price','p.new_price','p.effective_from').agg(F.sum('d.units').alias('post_units'))
        price=(pre.join(post,['menu_item_id','restaurant_id','old_price','new_price','effective_from']).where((F.col('pre_units')>0)&(F.col('post_units')>0))
          .withColumn('price_change_pct',(F.col('new_price')-F.col('old_price'))/F.col('old_price'))
          .withColumn('demand_change_pct',(F.col('post_units')-F.col('pre_units'))/F.col('pre_units'))
          .withColumn('observational_arc_elasticity',F.when(F.col('price_change_pct')!=0,F.col('demand_change_pct')/F.col('price_change_pct')))
          .withColumn('sensitivity',F.when(F.abs('observational_arc_elasticity')>=1,'Highly Price Sensitive').when(F.abs('observational_arc_elasticity')>=.5,'Moderately Price Sensitive').otherwise('Low Price Sensitivity'))
          .withColumn('interpretation',F.lit('uncontrolled pre/post association; not causal; each window 30 days')))
        # Promotion outcomes: observational, estimated contribution after menu item cost.
        order_cost=valid.groupBy('order_id').agg(F.sum(F.col('quantity')*F.col('cost_price')).alias('estimated_item_cost'),F.sum('net_item_revenue').alias('item_revenue'))
        promo=(orders.join(order_cost,'order_id','left').where(F.col('promotion_id').isNotNull()).groupBy('promotion_id').agg(F.countDistinct('order_id').alias('orders'),F.countDistinct('customer_id').alias('customers'),F.avg('final_amount').alias('avg_order_value'),F.sum('final_amount').alias('revenue'),F.sum(F.col('item_revenue')-F.col('estimated_item_cost')).alias('estimated_contribution_margin'),F.avg(F.col('item_revenue')-F.col('estimated_item_cost')).alias('avg_estimated_margin'))
          .join(tables['promotions'].select('promotion_id','promotion_name','start_date','end_date'),'promotion_id','left'))
        # Detected traps are risk signals only where margin data exists; compares promo cohort to all non-promo cohort.
        nonpromo=orders.where(F.col('promotion_id').isNull()).join(order_cost,'order_id').agg(F.countDistinct('order_id').alias('baseline_orders'),F.countDistinct('customer_id').alias('baseline_customers'),F.avg('final_amount').alias('baseline_aov'),F.avg(F.col('item_revenue')-F.col('estimated_item_cost')).alias('baseline_margin'))
        promo=promo.crossJoin(nonpromo).withColumn('promo_trap_signal',F.when((F.col('avg_order_value')>F.col('baseline_aov'))&(F.col('avg_estimated_margin')<F.col('baseline_margin')),'Sales value higher, average estimated item margin lower').otherwise('No configured trap signal'))
        # Rating time anomalies: restaurant-day with minimum 30 observations; robust MAD threshold.
        rd=tables['ratings'].groupBy('restaurant_id',F.to_date('rating_date').alias('event_date')).agg(F.avg('rating').alias('mean_rating'),F.count('*').alias('n')).where('n>=30')
        rw=Window.partitionBy('restaurant_id')
        rating_anom=(rd.withColumn('median_rating',F.expr('percentile_approx(mean_rating, 0.5)').over(rw)).withColumn('mad',F.expr('percentile_approx(abs(mean_rating - median_rating), 0.5)').over(rw))
          .where((F.col('mad')>0)&(F.abs(F.col('mean_rating')-F.col('median_rating'))>3*1.4826*F.col('mad'))).withColumn('method',F.lit('restaurant daily mean; n>=30; modified-z robust threshold >3')))
        # Sales anomaly: restaurant-hour, compare same hour-of-week observations, robust deviations.
        hourly=(orders.withColumn('hour_start',F.date_trunc('hour','order_datetime')).groupBy('restaurant_id','hour_start').agg(F.countDistinct('order_id').alias('orders'))
          .withColumn('hour_of_week',F.dayofweek('hour_start')*24+F.hour('hour_start')))
        hw=Window.partitionBy('restaurant_id','hour_of_week')
        sales_anom=(hourly.withColumn('median_orders',F.expr('percentile_approx(orders, 0.5)').over(hw)).withColumn('mad',F.expr('percentile_approx(abs(orders - median_orders),0.5)').over(hw))
          .where((F.col('mad')>0)&(F.abs(F.col('orders')-F.col('median_orders'))>3*1.4826*F.col('mad'))).withColumn('method',F.lit('same restaurant/hour-of-week robust modified-z >3')))
        rec_basket=(rules.where(F.col('lift_a_to_b')>1).select(F.lit('basket association').alias('source'),F.lit('bundle/cross-sell').alias('action'),F.concat_ws(' + ',F.col('item_a_name'),F.col('item_b_name')).alias('subject'),F.concat(F.lit('Observed pair_count='),F.col('pair_count'),F.lit('; support='),F.round('support',5),F.lit('; confidence='),F.round('confidence_a_to_b',4),F.lit('; lift='),F.round('lift_a_to_b',4)).alias('evidence')).orderBy(F.desc('lift_a_to_b'),F.desc('pair_count')).limit(100))
        rec_menu=(menu_out.where(F.col('performance_class').isin('Hidden Opportunity','Low Performer','Volume Driver')).select(F.lit('menu profitability').alias('source'),F.when(F.col('performance_class')=='Hidden Opportunity','test targeted visibility').when(F.col('performance_class')=='Volume Driver','review portion/cost margin').otherwise('review menu placement, cost, and demand before removal').alias('action'),F.col('item_name').alias('subject'),F.concat(F.lit('Class='),F.col('performance_class'),F.lit('; units='),F.coalesce(F.col('units_sold').cast('string'),F.lit('0')),F.lit('; margin='),F.coalesce(F.round('contribution_margin_pct',4).cast('string'),F.lit('unknown'))).alias('evidence')))
        rec_customer=(rfm.groupBy('behavior_segment').agg(F.count('*').alias('customers')).select(F.lit('customer behavior').alias('source'),F.when(F.col('behavior_segment')=='At risk (90d inactive)','review engagement with a retention offer').when(F.col('behavior_segment')=='High-value loyal','consider loyalty recognition').when(F.col('behavior_segment')=='One-time customer','consider a measured repeat-visit offer').otherwise('tailor communication to observed engagement').alias('action'),F.col('behavior_segment').alias('subject'),F.concat(F.lit('Customers='),F.col('customers').cast('string'),F.lit('; deterministic RFM segment; no synthetic source segment used')).alias('evidence')))
        latest_stock=(tables['inventory'].withColumn('rn',F.row_number().over(Window.partitionBy('restaurant_id','menu_item_id').orderBy(F.desc('record_date')))).where('rn=1').join(menu.select('menu_item_id','item_name'),'menu_item_id','left'))
        rec_inventory=(latest_stock.where(F.col('stock_status')=='Low').select(F.lit('inventory status').alias('source'),F.lit('review replenishment against recent consumption').alias('action'),F.concat_ws(' @ ',F.col('item_name'),F.col('restaurant_id')).alias('subject'),F.concat(F.lit('Latest record='),F.col('record_date').cast('string'),F.lit('; closing_stock='),F.col('closing_stock').cast('string'),F.lit('; reorder_level='),F.col('reorder_level').cast('string')).alias('evidence')))
        recommendations=rec_basket.unionByName(rec_menu).unionByName(rec_customer).unionByName(rec_inventory)
        outputs={'menu_profitability':menu_out,'menu_by_location':menu_location,'basket_rules':rules,'customer_rfm':rfm,'wastage_dimensions':wastage_dim,'wastage_risk_ranking':waste_risk,'price_sensitivity':price,'promotion_intelligence':promo,'rating_anomalies':rating_anom,'sales_anomalies':sales_anom,'recommendations':recommendations}
        evidence={'requirement_map':{'menu_profitability':['FR-xx','FR-xxi'],'menu_by_location':['FR-xxxix'],'basket_rules':['FR-xxv','FR-xxvi','FR-xxvii','FR-xlvii'],'customer_rfm':['FR-xxiii','FR-xxiv','FR-xli'],'wastage_dimensions':['FR-xxx'],'wastage_risk_ranking':['FR-xxxi'],'price_sensitivity':['FR-xxxii'],'promotion_intelligence':['FR-xxxiii','FR-xxxiv'],'rating_anomalies':['FR-xxxv','FR-xxxvi'],'sales_anomalies':['FR-xxxvii']},'source':f'{PROCESSED}/v4','hdfs_output_root':root,'version':a.version,'net_revenue_method':'canonical cleaned item line revenue less order-level discount allocated proportional to line value using source order subtotal; rows with invalid/null discount or nonpositive subtotal excluded from profitability','basket':{'basket_count':basket_n,'min_pair_count':a.min_pair_count,'min_confidence':a.min_confidence,'pair_unit':'distinct completed order x menu item'},'menu_classification':{'popularity_quantile':.75,'margin_quantile':.75,'wastage_ratio_quantile':.75,'popularity_cut':popcut,'margin_pct_cut':margincut,'wastage_ratio_cut':float(waste_cut),'as_of':'2026-08-31','labels_follow_srs':'Profit Driver, Volume Driver, Hidden Opportunity, Low Performer; explicit insufficient-history/cost exceptions'},'churn':{'target':'no orders in 90+ days as of max completed-order date; customers need >=2 completed orders','is_predictive_model':False,'source_is_churned_excluded':True},'price':{'before_after_window_days':30,'causal_claim':False},'promotion':{'method':'promotional cohort vs non-promotion overall baseline','causal_claim':False},'anomalies':{'method':'per-restaurant modified z score >3, minimum rating daily count=30'},'elapsed_seconds':None,'outputs':{}}
        for name,df in outputs.items():
            path=f'{root}/{name}'; df.write.mode('errorifexists').parquet(path); n=df.count(); evidence['outputs'][name]={'path':path,'rows':n,'schema':df.schema.jsonValue(),'sample':[json.loads(x) for x in df.limit(8).toJSON().collect()]}; print(name,n,flush=True)
        evidence['elapsed_seconds']=round(time.perf_counter()-started,3); local_out=OUT/a.version; local_out.mkdir(parents=True,exist_ok=True); save_json(local_out/'spark_gap1.json',evidence); print('EVIDENCE',local_out/'spark_gap1.json',flush=True)
    finally: sp.stop()
if __name__=='__main__': main()
