"""Build a versioned, full-customer RFM supplement from canonical v4."""
from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from datetime import date
from pathlib import Path

from pyspark.sql import DataFrame, Window, functions as F

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts" / "spark"))
from common import HDFS, PROCESSED, spark
from app.operational_store import OperationalStore

JOB_NAME = "phase3_customer_rfm_coverage"


def build_customer_rfm(customers: DataFrame, completed_orders: DataFrame, as_of_date: str | None = None) -> DataFrame:
    customer_ids = customers.select("customer_id")
    if customer_ids.count() != customer_ids.select("customer_id").distinct().count():
        raise ValueError("canonical customer_id keys must be unique")
    if as_of_date is None:
        maximum = completed_orders.agg(F.max("order_datetime").alias("max_datetime")).first()["max_datetime"]
        as_of_date = maximum.date().isoformat() if maximum else "2026-08-31"
    activity = (completed_orders.groupBy("customer_id")
                .agg(F.max("order_datetime").alias("last_order"),
                     F.countDistinct("order_id").alias("frequency"),
                     F.sum("final_amount").alias("monetary_value"),
                     F.avg("final_amount").alias("avg_order_value"),
                     F.countDistinct("restaurant_id").alias("restaurant_diversity")))
    all_customers = (customer_ids.join(activity, "customer_id", "left")
                     .withColumn("frequency", F.coalesce(F.col("frequency"), F.lit(0)).cast("long"))
                     .withColumn("monetary_value", F.coalesce(F.col("monetary_value"), F.lit(0.0)))
                     .withColumn("restaurant_diversity", F.coalesce(F.col("restaurant_diversity"), F.lit(0)).cast("long"))
                     .withColumn("recency_days", F.when(F.col("last_order").isNotNull(), F.datediff(F.lit(as_of_date).cast("date"), F.to_date("last_order"))))
                     .withColumn("analysis_as_of", F.lit(as_of_date)))
    purchasers = all_customers.where(F.col("frequency") > 0)
    no_completed_orders = all_customers.where(F.col("frequency") == 0)
    recency_window = Window.orderBy(F.col("recency_days").desc())
    frequency_window = Window.orderBy("frequency")
    monetary_window = Window.orderBy("monetary_value")
    purchasers = (purchasers
                  .withColumn("r_score", 6 - F.ntile(5).over(recency_window))
                  .withColumn("f_score", F.ntile(5).over(frequency_window))
                  .withColumn("m_score", F.ntile(5).over(monetary_window))
                  .withColumn("behavior_segment", F.when((F.col("recency_days") >= 90) & (F.col("frequency") >= 2), "At risk (90d inactive)")
                              .when((F.col("r_score") >= 4) & (F.col("f_score") >= 4) & (F.col("m_score") >= 4), "High-value loyal")
                              .when(F.col("frequency") == 1, "One-time customer")
                              .when(F.col("r_score") >= 4, "Recent customer")
                              .otherwise("Established / lower engagement")))
    no_completed_orders = (no_completed_orders
                           .withColumn("avg_order_value", F.lit(None).cast("double"))
                           .withColumn("r_score", F.lit(None).cast("integer"))
                           .withColumn("f_score", F.lit(None).cast("integer"))
                           .withColumn("m_score", F.lit(None).cast("integer"))
                           .withColumn("behavior_segment", F.lit("No completed orders")))
    return purchasers.unionByName(no_completed_orders)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default="v1")
    version = parser.parse_args().version
    if not version.startswith("v") or not version[1:].isdigit():
        raise SystemExit("--version must be v followed by a number")
    run_id = str(uuid.uuid4())
    store = OperationalStore()
    store.record_spark_job_event(job=JOB_NAME, run_id=run_id, phase="start", details={"source": f"{PROCESSED}/v4/customers,orders", "version": version})
    root = f"{HDFS}/dineq/results/phase3/customer_rfm/{version}"
    local_output = ROOT / "results" / "phase3" / "analytics" / f"customer_rfm_{version}.json"
    if local_output.exists():
        raise FileExistsError(f"Refusing to overwrite Phase 3 evidence: {local_output}")
    session = None
    started = time.perf_counter()
    try:
        session = spark("DineIQ-Phase3-Customer-RFM")
        session.sparkContext.setLogLevel("WARN")
        customers = session.read.parquet(f"{PROCESSED}/v4/customers").select("customer_id")
        orders = session.read.parquet(f"{PROCESSED}/v4/orders").where(F.col("order_status") == "Completed")
        output = build_customer_rfm(customers, orders)
        source_customer_count = customers.count()
        purchased_count = output.where(F.col("frequency") > 0).count()
        no_completed_order_count = output.where(F.col("frequency") == 0).count()
        output.write.mode("errorifexists").parquet(root)
        readback = session.read.parquet(root)
        readback_count = readback.count()
        duplicate_ids = readback.count() - readback.select("customer_id").distinct().count()
        sensitive_columns = sorted(set(readback.columns) & {"customer_name", "email", "phone", "address"})
        valid = (readback_count == source_customer_count and duplicate_ids == 0 and not sensitive_columns
                 and purchased_count + no_completed_order_count == source_customer_count)
        groups = {row["behavior_segment"]: int(row["count"]) for row in readback.groupBy("behavior_segment").count().collect()}
        evidence = {
            "status": "PASS" if valid else "FAIL",
            "job_run_id": run_id,
            "source": f"{PROCESSED}/v4/customers,orders",
            "output": root,
            "requirement_ids": ["FR-xxiv", "ANALYTICS-03"],
            "as_of": readback.select("analysis_as_of").first()[0],
            "source_customer_count": source_customer_count,
            "customers_with_completed_orders": purchased_count,
            "customers_without_completed_orders": no_completed_order_count,
            "output_rows": readback_count,
            "duplicate_customer_ids": duplicate_ids,
            "customers_without_orders_policy": "recency and RFM scores are null; frequency, monetary_value and restaurant_diversity are zero; segment is 'No completed orders'. This is not a churn label.",
            "segment_counts": groups,
            "sensitive_columns_exposed": sensitive_columns,
            "schema": readback.schema.jsonValue(),
            "runtime_seconds": round(time.perf_counter() - started, 3),
            "models_retrained": False,
            "canonical_v4_modified": False,
        }
        local_output.parent.mkdir(parents=True, exist_ok=True)
        local_output.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        store.record_spark_job_event(job=JOB_NAME, run_id=run_id, phase="complete" if valid else "failure", details={"source_customers": source_customer_count, "output_rows": readback_count, "evidence_path": str(local_output.relative_to(ROOT)).replace("\\", "/")})
        print(json.dumps(evidence, indent=2))
        return 0 if valid else 1
    except Exception as exc:
        store.record_spark_job_event(job=JOB_NAME, run_id=run_id, phase="failure", details={"error_type": type(exc).__name__, "message": str(exc)[:240]})
        raise
    finally:
        if session is not None:
            session.stop()


if __name__ == "__main__":
    raise SystemExit(main())