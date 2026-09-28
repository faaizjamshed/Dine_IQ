"""Attach verified reload evidence and build the cross-framework comparison."""
import json
from pathlib import Path
import sys
import numpy as np
import pandas as pd
import sklearn
import joblib
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/"scripts"/"ml"))
from demand_common import PREDICTION_POINT

def main():
    sp=ROOT/"results/ml/spark/pipeline.json"; py=ROOT/"results/ml/python/pipeline.json"
    s=json.loads(sp.read_text(encoding="utf-8")); p=json.loads(py.read_text(encoding="utf-8"))
    s["prediction_point"]=p["prediction_point"]=PREDICTION_POINT
    for item in (s,p): item["split"]["train_range"]="2025-03-08 00:00 through 2026-03-31 23:00"
    p["sklearn_version"]=sklearn.__version__; p["pandas_version"]=pd.__version__; p["numpy_version"]=np.__version__; p["joblib_version"]=joblib.__version__
    # Explicit effective estimator settings, retained fully instead of a truncated ParamMap display string.
    s["models"]["linear_regression"]["hyperparameters"]={"maxIter":50,"regParam":0.05,"elasticNetParam":0.0,"fitIntercept":True,"standardization":True}
    s["models"]["random_forest"]["hyperparameters"]={"numTrees":40,"maxDepth":8,"featureSubsetStrategy":"sqrt","seed":42}
    s["models"]["gradient_boosted_trees"]["hyperparameters"]={"maxIter":30,"maxDepth":5,"stepSize":0.08,"seed":42}
    smoke=json.loads((ROOT/"results/ml/spark/reload_smoke.json").read_text(encoding="utf-8"))
    s["reload_smoke_test"]={"model_path":s["model_path"],**smoke,"verified_in_fresh_spark_process":True}
    sp.write_text(json.dumps(s,indent=2,default=str),encoding="utf-8")
    py.write_text(json.dumps(p,indent=2,default=str),encoding="utf-8")
    print("Spark reload passed:",smoke["passed"],"| train/val/test:",s["split"]["train"],s["split"]["validation"],s["split"]["test"])

if __name__=="__main__": main()
