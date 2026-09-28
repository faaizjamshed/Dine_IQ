"""Create directional A->B/B->A bundle candidates from verified gap1 basket pairs."""
from __future__ import annotations
import argparse, json, os, sys, time
from pathlib import Path
from pyspark.sql import functions as F

ROOT=Path(__file__).resolve().parents[2]
os.environ.setdefault("HADOOP_USER_NAME","hadoop")
sys.path.insert(0,str(ROOT/"scripts"/"spark"))
from common import spark, save_json, HDFS

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--version",default="v8")
    parser.add_argument("--min-confidence",type=float,default=.10)
    parser.add_argument("--min-lift",type=float,default=1.0)
    args=parser.parse_args()
    if not args.version.startswith("v") or not args.version[1:].isdigit(): raise SystemExit("--version must be vN")
    if not 0<=args.min_confidence<=1 or args.min_lift<0: raise SystemExit("Invalid association thresholds")
    began=time.perf_counter(); sp=spark("DineIQ-Directional-Basket-Recommendations")
    try:
        source=f"{HDFS}/dineq/results/gap1/v6/basket_rules"
        pairs=sp.read.parquet(source)
        def direction(antecedent, consequent, antecedent_name, consequent_name, confidence, lift):
            return pairs.select(
                F.col(antecedent).alias("antecedent_id"),F.col(antecedent_name).alias("antecedent"),
                F.col(consequent).alias("consequent_id"),F.col(consequent_name).alias("consequent"),
                F.col("pair_count").cast("long").alias("pair_count"),F.col("support").cast("double").alias("support"),
                F.col(confidence).cast("double").alias("confidence"),F.col(lift).cast("double").alias("lift"),
                F.concat(F.lit("If a transaction contains "),F.col(antecedent_name),F.lit(", consider pairing "),F.col(consequent_name),F.lit("; observed directional confidence="),F.format_number(F.col(confidence),4),F.lit(", lift="),F.format_number(F.col(lift),4)).alias("recommendation"),
                F.lit("deterministic association-rule candidate; not causal").alias("interpretation")
            )
        rules=direction("item_a","item_b","item_a_name","item_b_name","confidence_a_to_b","lift_a_to_b").unionByName(
            direction("item_b","item_a","item_b_name","item_a_name","confidence_b_to_a","lift_b_to_a"))
        qualified=rules.where((F.col("confidence")>=F.lit(args.min_confidence))&(F.col("lift")>F.lit(args.min_lift))).orderBy(F.desc("lift"),F.desc("confidence"),F.desc("pair_count"))
        count=qualified.count()
        if count==0: raise RuntimeError("No observed directional recommendations satisfy the configured thresholds.")
        out=f"{HDFS}/dineq/results/gap1/{args.version}/directional_basket_recommendations"
        qualified.write.mode("errorifexists").parquet(out)
        rows=[r.asDict(recursive=True) for r in qualified.limit(100).collect()]
        evidence={"source":"/dineq/results/gap1/v6/basket_rules","output":out,"source_pairs":pairs.count(),"directional_candidates_before_threshold":rules.count(),"min_confidence":args.min_confidence,"min_lift_exclusive":args.min_lift,"qualifying_directional_recommendations":count,"method":"Each unordered pair produces two separately scored directions using the corresponding antecedent count, directional confidence and directional lift. Recommendations retain only confidence >= threshold and lift > threshold.","sample":rows[:30],"elapsed_seconds":round(time.perf_counter()-began,3),"spark_version":sp.version}
        local=ROOT/"results"/"analytics"/"gap1"/args.version;local.mkdir(parents=True,exist_ok=True)
        save_json(local/"directional_basket_recommendations.json",evidence)
        print(json.dumps(evidence,indent=2,default=str))
    finally: sp.stop()
if __name__=="__main__": main()
