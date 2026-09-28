"""Explicit-schema multi-table HDFS ingestion and reproducible evidence."""
from __future__ import annotations
import sys, time
from pyspark.sql import functions as F
from common import (COUNTS, LOCAL_EVIDENCE, RAW, SCHEMAS, read_table, save_json, spark)

def main():
    started=time.perf_counter(); sp=spark("DineIQ-Explicit-Ingestion")
    evidence={"source":RAW,"schema_mode":"explicit StructType for production","tables":{},"inference_demo":{},"elapsed_seconds":None}
    failures=[]
    try:
        # Small dimension table: inference is shown as a comparison only.
        inferred=(sp.read.option("header",True).option("inferSchema",True).csv(f"{RAW}/menu_categories.csv"))
        explicit=read_table(sp,"menu_categories")
        evidence["inference_demo"]={"table":"menu_categories","inferred_schema":inferred.schema.jsonValue(),"explicit_schema":explicit.schema.jsonValue(),"schemas_equal":inferred.schema==explicit.schema,"production_uses_inference":False}
        for table,expected in COUNTS.items():
            df=read_table(sp,table).withColumn("_source_file",F.input_file_name())
            # Executing count validates actual HDFS load and drives file read.
            n=df.count()
            null_expr=[F.sum(F.when(F.col(c).isNull(),1).otherwise(0)).alias(c) for c in df.columns if c!="_source_file"]
            null_row=df.agg(*null_expr).first().asDict()
            sources=[r[0] for r in df.select("_source_file").distinct().collect()]
            schema_ok=all(df.schema[c].dataType==SCHEMAS[table][c].dataType for c in SCHEMAS[table].fieldNames())
            # CSV input is a single unpartitioned file per table; record Spark's read partition count.
            item={"expected_rows":expected,"actual_rows":n,"row_count_match":n==expected,"schema_valid":schema_ok,"schema":df.drop("_source_file").schema.jsonValue(),"input_partitions":df.rdd.getNumPartitions(),"source_files":sources,"null_observations":{k:int(v or 0) for k,v in null_row.items() if v}}
            evidence["tables"][table]=item
            if n!=expected or not schema_ok: failures.append(table)
            print(f"INGEST {table}: {n:,} rows, {item['input_partitions']} input partitions, schema_valid={schema_ok}",flush=True)
        evidence["elapsed_seconds"]=round(time.perf_counter()-started,3)
        save_json(LOCAL_EVIDENCE/"ingestion.json",evidence)
        print(f"Evidence: {LOCAL_EVIDENCE/'ingestion.json'}",flush=True)
        return 1 if failures else 0
    finally: sp.stop()

if __name__=="__main__": raise SystemExit(main())
