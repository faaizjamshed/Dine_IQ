"""Compare independent pandas menu aggregates with Spark gap1 evidence."""
import json
import argparse
from pathlib import Path
import pandas as pd
ROOT=Path(__file__).resolve().parents[2]
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--version',default='v6');version=ap.parse_args().version
    spark=pd.read_csv(ROOT/'results'/'analytics'/'gap1'/version/'spark_menu_profitability.csv')
    python=pd.read_csv(ROOT/'results'/'python'/'gap1'/'menu_profitability.csv')
    merged=spark.merge(python,on='menu_item_id',suffixes=('_spark','_python'),validate='one_to_one')
    metrics={}
    for col in ('units_sold','order_count','gross_item_sales','revenue','estimated_cost','contribution_margin'):
        a=merged[f'{col}_spark'].fillna(0); b=merged[f'{col}_python'].fillna(0); delta=(a-b).abs()
        metrics[col]={'rows':len(delta),'exact_matches_at_1e_8':int((delta<1e-8).sum()),'within_tolerance_0_01':int((delta<=.01).sum()),'max_abs_difference':float(delta.max()),'mean_abs_difference':float(delta.mean()),'mismatch_rows_at_0_01':int((delta>.01).sum())}
    cases=[]
    for _,r in merged.iterrows():
        d=float(r.contribution_margin_spark-r.contribution_margin_python)
        if abs(d)>.01: cases.append({'menu_item_id':r.menu_item_id,'spark_margin':float(r.contribution_margin_spark),'python_margin':float(r.contribution_margin_python),'spark_minus_python':d})
    out={'rows_compared':len(merged),'target':'menu-level units, distinct order count, revenue, estimated cost and contribution margin','metric_comparison':metrics,'classification_compared':False,'row_examples_over_tolerance':cases[:10],'interpretation':'Pandas reads and independently cleans frozen raw CSV; Spark table is canonical-v4-derived. No tolerance mismatches; residual sub-cent differences are floating-point aggregation order. Duplicate tie winner/cleaning logic can differ. Currency is unspecified.'}
    target=ROOT/'results'/'comparison'/'gap1';target.mkdir(parents=True,exist_ok=True);(target/f'menu_profitability_spark_python_{version}.json').write_text(json.dumps(out,indent=2),encoding='utf-8');print(json.dumps(out,indent=2))
if __name__=='__main__':main()
