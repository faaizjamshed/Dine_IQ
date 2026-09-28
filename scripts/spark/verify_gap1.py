"""Read back and validate versioned SRS gap-closure Parquet outputs."""
from __future__ import annotations
import argparse,json,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from common import HDFS,spark,save_json

ROOT=Path(__file__).resolve().parents[2]
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--version',default='v5');version=ap.parse_args().version
    started=time.perf_counter(); sp=spark('DineIQ-Gap1-Readback-Verification')
    sp.sparkContext.setLogLevel('ERROR'); source=ROOT/'results'/'analytics'/'gap1'/version/'spark_gap1.json'
    evidence=json.loads(source.read_text(encoding='utf-8')); checks={}; failed=[]
    try:
        for name,meta in evidence['outputs'].items():
            frame=sp.read.parquet(meta['path']); count=frame.count(); fields=set(frame.columns)
            expected={f['name'] for f in meta['schema']['fields']}
            ok=count==meta['rows'] and fields==expected
            checks[name]={'path':meta['path'],'declared_rows':meta['rows'],'readback_rows':count,'schema_matches':fields==expected,'passed':ok}
            if not ok: failed.append(name)
        # Domain invariants, read from written output rather than in-memory frames.
        menu=sp.read.parquet(evidence['outputs']['menu_profitability']['path'])
        checks['menu_all_catalog_items']={'expected':200,'actual':menu.count(),'passed':menu.count()==200}
        if menu.count()!=200: failed.append('menu_all_catalog_items')
        location=sp.read.parquet(evidence['outputs']['menu_by_location']['path'])
        loc_rows=location.count(); unique_pairs=location.select('restaurant_id','menu_item_id').distinct().count()
        restaurants=location.select('restaurant_id').distinct().count(); menu_items=location.select('menu_item_id').distinct().count()
        checks['menu_all_restaurant_item_pairs']={'rows':loc_rows,'unique_pairs':unique_pairs,'restaurants':restaurants,'menu_items':menu_items,'expected_pairs':restaurants*menu_items,'passed':loc_rows==unique_pairs==restaurants*menu_items==5000}
        if not checks['menu_all_restaurant_item_pairs']['passed']: failed.append('menu_all_restaurant_item_pairs')
        rules=sp.read.parquet(evidence['outputs']['basket_rules']['path'])
        checks['basket_thresholds']={'min_pair_count':rules.agg({'pair_count':'min'}).first()[0],'min_confidence':evidence['basket']['min_confidence'],'passed':rules.agg({'pair_count':'min'}).first()[0]>=evidence['basket']['min_pair_count']}
        if not checks['basket_thresholds']['passed']: failed.append('basket_thresholds')
        summaries={}
        for name,column in [('menu_profitability','performance_class'),('customer_rfm','behavior_segment'),('price_sensitivity','sensitivity'),('promotion_intelligence','promo_trap_signal')]:
            frame=sp.read.parquet(evidence['outputs'][name]['path'])
            summaries[name]={r[column]:r['count'] for r in frame.groupBy(column).count().collect()}
        summaries['basket_rules_top_lift']=[r.asDict() for r in rules.orderBy('lift_a_to_b',ascending=False).select('item_a_name','item_b_name','pair_count','support','confidence_a_to_b','lift_a_to_b').limit(10).collect()]
        summaries['sales_anomaly_samples']=[r.asDict(recursive=True) for r in sp.read.parquet(evidence['outputs']['sales_anomalies']['path']).limit(10).collect()]
        summaries['rating_anomalies_detected']=checks['rating_anomalies']['readback_rows']
        result={'status':'PASS' if not failed else 'FAIL','version':version,'source_evidence':str(source),'checks':checks,'failed_checks':failed,'elapsed_seconds':round(time.perf_counter()-started,3)}
        result['summaries']=summaries
        save_json(ROOT/'results'/'analytics'/'gap1'/version/'readback_verification.json',result)
        print(json.dumps(result,indent=2,default=str));
        if failed: raise SystemExit(1)
    finally: sp.stop()
if __name__=='__main__':main()
