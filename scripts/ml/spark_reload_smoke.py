"""Fresh-process load and inference check for the persisted Spark model."""
from pathlib import Path
import sys,json,os
from pyspark.sql import functions as F
from pyspark.ml import PipelineModel
ROOT=Path(__file__).resolve().parents[2]
os.environ["PYSPARK_PYTHON"]=sys.executable
sys.path.insert(0,str(ROOT/"scripts"/"spark"))
from common import spark

def main():
    sp=spark("DineIQ-MLlib-Reload-Smoke"); sp.sparkContext.setLogLevel("ERROR")
    try:
        base="hdfs://localhost:9000/dineq"
        model=PipelineModel.load(base+"/models/v1/selected_demand_model")
        inputs=sp.read.parquet(base+"/features/v1/hourly_demand").where(F.col("hour_start")>=F.to_timestamp(F.lit("2026-06-01"))).limit(8)
        outputs=model.transform(inputs).select("prediction").collect()
        evidence_lines=[r.value for r in sp.read.text(base+"/results/ml/v1/pipeline_evidence_final").collect()]
        hdfs_evidence=json.loads("\n".join(evidence_lines))
        result={"rows_with_prediction":sum(x.prediction is not None for x in outputs),"predictions":[float(x.prediction) for x in outputs],"hdfs_evidence_readable":hdfs_evidence.get("selected_model")=="gradient_boosted_trees","passed":len(outputs)==8 and all(x.prediction is not None for x in outputs) and hdfs_evidence.get("selected_model")=="gradient_boosted_trees"}
        path=ROOT/"results/ml/spark/reload_smoke.json"; path.write_text(json.dumps(result,indent=2),encoding="utf-8"); print(json.dumps(result),flush=True)
    finally: sp.stop()
if __name__=="__main__": main()
