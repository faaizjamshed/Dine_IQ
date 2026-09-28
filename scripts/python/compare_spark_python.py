"""Compare independent Python CSV analytics against canonical Spark v4 Parquet."""
from __future__ import annotations

import argparse
import io
import json
import math
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

ROOT=Path(__file__).resolve().parents[2]
PYTHON_DIR=ROOT/"results"/"python"
OUT=ROOT/"results"/"comparison"
SPARK_ROOT="/dineq/results/v4"
WEBHDFS="http://localhost:9870/webhdfs/v1"

# Keys and rounding precision are taken from the published Spark v4 SQL outputs.
SPECS={
 "menu_item_performance":{"keys":["menu_item_id"],"tolerances":{"order_count":0,"units_sold":0,"gross_sales":0.005,"avg_unit_price":0.005}},
 "category_performance":{"keys":["category_name"],"tolerances":{"order_count":0,"units_sold":0,"gross_sales":0.005,"avg_line_value":0.005}},
 "restaurant_performance":{"keys":["restaurant_id"],"tolerances":{"order_count":0,"revenue":0.005,"avg_order_value":0.005}},
 "channel_performance":{"keys":["ordering_channel"],"tolerances":{"orders":0,"avg_order_value":0.005,"completed_revenue":0.005}},
 "monthly_demand":{"keys":["order_month"],"tolerances":{"total_orders":0,"completed_orders":0,"completed_revenue":0.005}},
 "customer_segment_behavior":{"keys":["customer_segment"],"tolerances":{"customers":0,"total_orders":0,"avg_order_value":0.005,"revenue":0.005}},
 "restaurant_ratings":{"keys":["restaurant_id"],"tolerances":{"rating_count":0,"avg_rating":0.0005,"avg_food_rating":0.0005,"avg_service_rating":0.0005}},
 "wastage_by_reason":{"keys":["reason"],"tolerances":{"records":0,"quantity_wasted":0.005,"wastage_cost":0.005}},
 "promotion_effectiveness":{"keys":["promotion_id"],"tolerances":{"used_orders":0,"avg_subtotal":0.005,"avg_discount":0.005,"final_revenue":0.005}},
 "pricing_changes":{"keys":["change_reason"],"tolerances":{"changes":0,"avg_price_change":0.005,"avg_percent_change":0.005}},
 "inventory_status":{"keys":["stock_status"],"tolerances":{"observations":0,"avg_closing_stock":0.005}},
 "weekday_peak_hour":{"keys":["weekday","hour_of_day"],"tolerances":{"orders":0,"avg_order_value":0.005}},
}


def fetch_spark_table(name: str, session=requests):
    path=f"{SPARK_ROOT}/{name}"
    response=session.get(f"{WEBHDFS}{path}?op=LISTSTATUS&user.name=hadoop",timeout=30)
    response.raise_for_status()
    statuses=response.json()["FileStatuses"]["FileStatus"]
    frames=[]
    for status in statuses:
        filename=status["pathSuffix"]
        if status["type"]!="FILE" or not filename.endswith(".parquet"): continue
        r=session.get(f"{WEBHDFS}{path}/{filename}?op=OPEN&user.name=hadoop",timeout=60)
        r.raise_for_status()
        frames.append(pd.read_parquet(io.BytesIO(r.content),engine="pyarrow"))
    if not frames: raise RuntimeError(f"No canonical Parquet part files found for {path}")
    return pd.concat(frames,ignore_index=True)


def is_null(value):
    return value is None or (not isinstance(value,(list,dict)) and pd.isna(value))


def compare_analysis(name: str, spark_df: pd.DataFrame, python_df: pd.DataFrame):
    spec=SPECS[name]; keys=spec["keys"]
    for key in keys:
        if key not in spark_df or key not in python_df: raise KeyError(f"Missing join key {key} in {name}")
    spark_df=spark_df.copy(); python_df=python_df.copy()
    # Normalize join keys only; values retain their natural numeric/null type.
    for key in keys:
        spark_df[key]=spark_df[key].astype("string")
        python_df[key]=python_df[key].astype("string")
    if spark_df.duplicated(keys).any() or python_df.duplicated(keys).any():
        raise ValueError(f"Result keys are not unique for {name}: {keys}")
    s_metrics=[c for c in spark_df.columns if c not in keys]
    p_metrics=[c for c in python_df.columns if c not in keys]
    if set(s_metrics)!=set(p_metrics): raise ValueError(f"Metric columns differ for {name}: Spark={s_metrics}, Python={p_metrics}")
    joined=spark_df.merge(python_df,on=keys,how="outer",suffixes=("__spark","__python"),indicator=True)
    records=[]
    for _,row in joined.iterrows():
        key_record={k:(None if is_null(row[k]) else str(row[k])) for k in keys}
        row_side=row["_merge"]
        for metric in s_metrics:
            sv=row.get(f"{metric}__spark"); pv=row.get(f"{metric}__python")
            sv=None if is_null(sv) else sv.item() if isinstance(sv,np.generic) else sv
            pv=None if is_null(pv) else pv.item() if isinstance(pv,np.generic) else pv
            tol=float(spec["tolerances"].get(metric,0))
            numeric=isinstance(sv,(int,float,np.number)) and not isinstance(sv,bool) and isinstance(pv,(int,float,np.number)) and not isinstance(pv,bool)
            diff=None
            if row_side!="both":
                passed=False; explanation=f"group exists only on {row_side} side"
                if numeric: diff=abs(float(sv)-float(pv))
            elif sv is None or pv is None:
                passed=sv is None and pv is None
                explanation="both null after SQL-compatible null aggregation" if passed else "null handling differs between cleaned Spark and Python groups"
            elif numeric:
                diff=abs(float(sv)-float(pv)); passed=diff<=tol
                explanation="within declared rounding tolerance" if passed else "difference exceeds tolerance; inspect aggregation/cleaning semantics"
            else:
                passed=str(sv)==str(pv)
                explanation="exact categorical/dimension match" if passed else "dimension value differs"
            records.append({"analysis":name,"metric":metric,"key":key_record,"spark_result":sv,"python_result":pv,"absolute_difference":diff,"tolerance":tol,"pass":bool(passed),"explanation":explanation})
    return records


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python-dir",type=Path,default=PYTHON_DIR)
    parser.add_argument("--output-dir",type=Path,default=OUT)
    parser.add_argument("--reference-dir",type=Path,default=OUT/"spark_reference")
    args=parser.parse_args()
    started=time.perf_counter(); args.output_dir.mkdir(parents=True,exist_ok=True); args.reference_dir.mkdir(parents=True,exist_ok=True)
    all_records=[]; per_analysis={}
    for name in SPECS:
        spark_df=fetch_spark_table(name)
        python_df=pd.read_csv(args.python_dir/f"{name}.csv",low_memory=False)
        spark_df.to_csv(args.reference_dir/f"{name}.csv",index=False)
        records=compare_analysis(name,spark_df,python_df)
        passed=sum(r["pass"] for r in records); failed=len(records)-passed
        per_analysis[name]={"spark_rows":len(spark_df),"python_rows":len(python_df),"metric_comparisons":len(records),"passed":passed,"failed":failed}
        all_records.extend(records)
        print(f"COMPARE {name}: Spark={len(spark_df)} Python={len(python_df)} metrics_pass={passed}/{len(records)}",flush=True)
    failures=[r for r in all_records if not r["pass"]]
    summary={"status":"PASS" if not failures else "FAIL","spark_reference_root":f"hdfs://localhost:9000{SPARK_ROOT}","spark_reference_method":"WebHDFS Parquet read; no Spark calculations used by this comparison or the Python pipeline","python_output_root":str(args.python_dir.resolve()),"tolerance_policy":"exact counts and labels; 0.005 for metrics rounded to 2 decimals; 0.0005 for ratings rounded to 3 decimals","analyses":per_analysis,"comparison_records":len(all_records),"matched_metrics":len(all_records)-len(failures),"mismatched_metrics":len(failures),"elapsed_seconds":round(time.perf_counter()-started,3),"mismatches":failures,"records":all_records}
    (args.output_dir/"spark_vs_python.json").write_text(json.dumps(summary,indent=2,ensure_ascii=False,default=str),encoding="utf-8")
    pd.DataFrame(all_records).to_csv(args.output_dir/"spark_vs_python.csv",index=False)
    print(json.dumps({k:summary[k] for k in ["status","comparison_records","matched_metrics","mismatched_metrics","elapsed_seconds","analyses"]},indent=2))
    return 0 if not failures else 1


if __name__=="__main__": raise SystemExit(main())
