"""Build an honest, machine-readable Spark/Python ML comparison report."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
SPARK=ROOT/"results/ml/spark/pipeline.json"
PYTHON=ROOT/"results/ml/python/pipeline.json"
OUT=ROOT/"results/ml/comparison"

def main():
    s=json.loads(SPARK.read_text(encoding="utf-8")); p=json.loads(PYTHON.read_text(encoding="utf-8"))
    def sample_map(record,py=False):
        rows={}
        for x in record["sample_predictions"]:
            ts=x.get("hour_start",x.get("timestamp")); actual=x.get("actual",x.get("order_count")); pred=x["prediction"]
            rows[(x["restaurant_id"],ts)]={"actual":actual,"prediction":pred}
        return rows
    ss,pp=sample_map(s),sample_map(p,True); keys=sorted(set(ss)&set(pp))
    pairs=[{"restaurant_id":r,"hour_start":ts,"spark_actual":ss[(r,ts)]["actual"],"python_actual":pp[(r,ts)]["actual"],"spark_prediction":ss[(r,ts)]["prediction"],"python_prediction":pp[(r,ts)]["prediction"],"prediction_difference_spark_minus_python":ss[(r,ts)]["prediction"]-pp[(r,ts)]["prediction"]} for r,ts in keys]
    comparisons={"target_definition":{"spark":s["target"],"python":p["target"],"same":s["target"]==p["target"]},
      "feature_definitions":{"spark":s["features"],"python":p["features"],"same":s["features"]==p["features"]},
      "dataset":{"spark":{"source":s["source"],"panel_rows":s["panel_rows"],"usable_rows":s["usable_rows"],"split":s["split"]},"python":{"source":p["source"],"panel_rows":p["panel_rows"],"usable_rows":p["usable_rows"],"split":p["split"]},"same_panel_and_splits":s["panel_rows"]==p["panel_rows"] and s["split"]==p["split"]},
      "algorithm_mapping":{"spark":list(s["models"]),"python":list(p["models"]),"notes":"Linear regression vs Ridge (regularized linear baseline); tree ensembles are related model families with different implementations/hyperparameters, not identical estimators."},
      "hyperparameters":{"spark":{k:v["hyperparameters"] for k,v in s["models"].items()},"python":{k:v["hyperparameters"] for k,v in p["models"].items()}},
      "validation_metrics":{"spark":{k:v["validation"] for k,v in s["models"].items()},"python":{k:v["validation"] for k,v in p["models"].items()}},
      "selected_models":{"spark":s["selected_model"],"python":p["selected_model"],"selection":"lowest validation MAE, separately within each framework"},
      "test_metrics":{"spark":s["test_metrics"],"python":p["test_metrics"],"difference_spark_minus_python":{m:s["test_metrics"][m]-p["test_metrics"][m] for m in ("rmse","mae","r2")}},
      "runtime_versions":{"spark":{"spark":s.get("spark_version")},"python":{"python":p.get("python_version"),"scikit_learn":p.get("sklearn_version"),"pandas":p.get("pandas_version"),"numpy":p.get("numpy_version"),"joblib":p.get("joblib_version")}},
      "execution_seconds":{"spark":s["elapsed_seconds"],"python":p["elapsed_seconds"],"interpretation":"Measured in distinct runtimes; Spark timing includes model and feature persistence but excludes the separate fresh-process reload smoke test. Not a controlled framework speed benchmark."},
      "sample_prediction_behavior":{"matched_sample_rows":len(pairs),"rows":pairs,"mean_absolute_prediction_difference":sum(abs(x["prediction_difference_spark_minus_python"]) for x in pairs)/len(pairs) if pairs else None},
      "interpretation":"Metrics need not match: preprocessing implementations, random forest parameterization, and boosting algorithms differ. Do not infer framework superiority from these runs."}
    OUT.mkdir(parents=True,exist_ok=True); (OUT/"spark_vs_python.json").write_text(json.dumps(comparisons,indent=2,default=str),encoding="utf-8")
    print(json.dumps({"comparison_path":str(OUT/"spark_vs_python.json"),"matched_samples":len(pairs),"same_split":comparisons["dataset"]["same_panel_and_splits"]},indent=2))

if __name__=="__main__": main()
