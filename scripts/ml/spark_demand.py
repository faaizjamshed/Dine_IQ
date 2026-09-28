"""Train and evaluate Spark MLlib hourly demand regressors on canonical v4 input."""
from __future__ import annotations
import json, sys, time, os
from datetime import datetime, timezone
from pathlib import Path

from pyspark.sql import functions as F, Window
from pyspark.ml import Pipeline
from pyspark.ml.feature import StringIndexer, OneHotEncoder, VectorAssembler, Imputer
from pyspark.ml.regression import LinearRegression, RandomForestRegressor, GBTRegressor
from pyspark.ml.evaluation import RegressionEvaluator

ROOT=Path(__file__).resolve().parents[2]
os.environ["PYSPARK_PYTHON"]=sys.executable
sys.path.insert(0,str(ROOT/"scripts"/"spark"))
from common import spark
from demand_common import *

def metrics(pred):
    out={}
    for name,metric in (("rmse","rmse"),("mae","mae"),("r2","r2")):
        out[name]=float(RegressionEvaluator(labelCol=TARGET,predictionCol="prediction",metricName=metric).evaluate(pred))
    return out

def main():
    began=time.perf_counter(); sp=spark("DineIQ-MLlib-Demand-v1"); sp.sparkContext.setLogLevel("WARN")
    try:
        raw=sp.read.parquet("hdfs://localhost:9000/dineq/processed/v4/orders").select("order_id","restaurant_id","order_datetime")
        counts=(raw.where(F.col("order_datetime").isNotNull())
            .groupBy("restaurant_id",F.date_trunc("hour","order_datetime").alias("hour_start"))
            .agg(F.count("*").cast("double").alias(TARGET)))
        rests=counts.select("restaurant_id").distinct()
        lo=int(datetime.fromisoformat(START).replace(tzinfo=timezone.utc).timestamp())
        hi=int(datetime.fromisoformat(END).replace(tzinfo=timezone.utc).timestamp())
        panel=(rests.withColumn("hour_start",F.explode(F.sequence(F.to_timestamp(F.lit(START)),F.to_timestamp(F.lit(END)),F.expr("INTERVAL 1 HOUR"))))
            .join(counts,["restaurant_id","hour_start"],"left").fillna({TARGET:0.0}))
        w=Window.partitionBy("restaurant_id").orderBy("hour_start")
        data=(panel.withColumn("lag_1h",F.lag(TARGET,1).over(w)).withColumn("lag_24h",F.lag(TARGET,24).over(w)).withColumn("lag_168h",F.lag(TARGET,168).over(w))
            .withColumn("hour_of_day",F.hour("hour_start").cast("double")).withColumn("day_of_week",(F.dayofweek("hour_start")-1).cast("double"))
            .withColumn("month",F.month("hour_start").cast("double")).withColumn("timestamp",F.date_format("hour_start","yyyy-MM-dd HH:mm:ss"))
            .where(F.col("lag_168h").isNotNull()).cache())
        # Chronological holdout: training < Apr, validation Apr-May, untouched test Jun-Aug 2026.
        train=data.where(F.col("hour_start")<F.to_timestamp(F.lit("2026-04-01"))).cache()
        val=data.where((F.col("hour_start")>=F.to_timestamp(F.lit("2026-04-01")))&(F.col("hour_start")<F.to_timestamp(F.lit("2026-06-01")))).cache()
        test=data.where(F.col("hour_start")>=F.to_timestamp(F.lit("2026-06-01"))).cache()
        train_n,val_n,test_n=train.count(),val.count(),test.count()
        idx=StringIndexer(inputCol="restaurant_id",outputCol="restaurant_index",handleInvalid="keep")
        enc=OneHotEncoder(inputCols=["restaurant_index"],outputCols=["restaurant_ohe"],handleInvalid="keep")
        imp=Imputer(inputCols=FEATURES_NUMERIC,outputCols=[x+"_imputed" for x in FEATURES_NUMERIC],strategy="median")
        assembler=VectorAssembler(inputCols=["restaurant_ohe"]+[x+"_imputed" for x in FEATURES_NUMERIC],outputCol="features",handleInvalid="keep")
        definitions=[("linear_regression",LinearRegression(featuresCol="features",labelCol=TARGET,maxIter=50,regParam=0.05,elasticNetParam=0.0)),
          ("random_forest",RandomForestRegressor(featuresCol="features",labelCol=TARGET,numTrees=40,maxDepth=8,featureSubsetStrategy="sqrt",seed=SEED)),
          ("gradient_boosted_trees",GBTRegressor(featuresCol="features",labelCol=TARGET,maxIter=30,maxDepth=5,stepSize=0.08,seed=SEED))]
        comparisons={}; fitted={}
        for name,est in definitions:
            pipe=Pipeline(stages=[idx,enc,imp,assembler,est]); model=pipe.fit(train); vp=model.transform(val).cache()
            comparisons[name]={"validation":metrics(vp),"hyperparameters":{p.name:v for p,v in est.extractParamMap().items()}}
            vp.unpersist(); fitted[name]=model
            print("VALIDATION",name,comparisons[name]["validation"],flush=True)
        selected=min(comparisons,key=lambda n:comparisons[n]["validation"]["mae"])
        # Refit only the selected algorithm with training + validation. Test remains unseen.
        all_train=train.unionByName(val)
        chosen=dict(definitions)[selected]
        final_model=Pipeline(stages=[idx,enc,imp,assembler,chosen]).fit(all_train)
        tp=final_model.transform(test).cache(); test_metrics=metrics(tp)
        sample=[r.asDict(recursive=True) for r in tp.select("restaurant_id","timestamp",TARGET,"prediction").orderBy("timestamp","restaurant_id").limit(25).collect()]
        # Save compact, reproducible artifacts in local evidence and existing HDFS hierarchy.
        out=ROOT/"results"/"ml"/"spark"; out.mkdir(parents=True,exist_ok=True)
        spark_base="hdfs://localhost:9000/dineq"
        final_model.write().overwrite().save(f"{spark_base}/models/v1/selected_demand_model")
        data.select("restaurant_id","hour_start",TARGET,*FEATURES_NUMERIC).write.mode("overwrite").parquet(f"{spark_base}/features/v1/hourly_demand")
        result={"problem":"hourly restaurant demand regression","target":TARGET_DEFINITION,"prediction_point":PREDICTION_POINT,"features":FEATURES,"leakage_exclusions":LEAKAGE_EXCLUSIONS,
          "source":"/dineq/processed/v4/orders","panel_rows":329400,"usable_rows":train_n+val_n+test_n,"split":{"train":train_n,"validation":val_n,"test":test_n,"train_range":"2025-03-08 00:00 through 2026-03-31 23:00","validation_range":"2026-04-01 through 2026-05-31","test_range":"2026-06-01 through 2026-08-31"},
          "seed":SEED,"feature_preprocessing":"lag history (1h/24h/168h), median imputation, restaurant StringIndexer + OneHotEncoder, VectorAssembler","models":comparisons,"selected_model":selected,"selection_basis":"lowest validation MAE; test set was not used for selection","test_metrics":test_metrics,"sample_predictions":sample,"model_path":f"{spark_base}/models/v1/selected_demand_model","hdfs_model_path":f"{spark_base}/models/v1/selected_demand_model","hdfs_features_path":f"{spark_base}/features/v1/hourly_demand","spark_version":sp.version,"timestamp_utc":datetime.now(timezone.utc).isoformat(),"elapsed_seconds":round(time.perf_counter()-began,3)}
        (out/"pipeline.json").write_text(json.dumps(result,indent=2,default=str),encoding="utf-8")
        # Reload and validate inference on held-out examples.
        from pyspark.ml import PipelineModel
        reloaded=PipelineModel.load(f"{spark_base}/models/v1/selected_demand_model"); reload_n=reloaded.transform(test.limit(8)).where(F.col("prediction").isNotNull()).count()
        result["reload_smoke_test"]={"rows_with_prediction":reload_n,"passed":reload_n==8}
        (out/"pipeline.json").write_text(json.dumps(result,indent=2,default=str),encoding="utf-8")
        print("TEST_METRICS",test_metrics,"SELECTED",selected,"ELAPSED",result["elapsed_seconds"],"RELOAD",reload_n,flush=True)
        tp.unpersist(); train.unpersist(); val.unpersist(); test.unpersist(); data.unpersist()
    finally: sp.stop()
if __name__=="__main__": main()
