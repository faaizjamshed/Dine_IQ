"""Run a disposable 5-million-order-line Spark scalability benchmark."""
from __future__ import annotations

import csv
import json
import math
import os
import platform
import shutil
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

import psutil
from pyspark.sql import DataFrame, functions as F

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts" / "spark"))
from common import spark
from app.operational_store import OperationalStore

SOURCE = "hdfs://localhost:9000/dineq/processed/v4/order_items"
TARGET_ROWS = 5_000_000
OUTPUT = ROOT / "results" / "phase3" / "scalability"
JOB_NAME = "phase3_order_items_5m_scalability"


def expand_order_items(source: DataFrame, target_rows: int) -> tuple[DataFrame, int, int]:
    """Append deterministic copies with unique benchmark-only line IDs."""
    if "order_item_id" not in source.columns:
        raise ValueError("order_items must include order_item_id")
    source_rows = source.count()
    if target_rows < source_rows:
        raise ValueError("target_rows cannot shrink the source workload")
    copied_rows = target_rows - source_rows
    if not copied_rows:
        return source, source_rows, 0
    if source_rows == 0:
        raise ValueError("cannot expand an empty source into a benchmark workload")
    if source.filter(F.col("order_item_id").isNull()).limit(1).count():
        raise ValueError("order_item_id must be non-null to create unique benchmark IDs")
    workload = source
    remaining = copied_rows
    pass_number = 1
    id_position = source.columns.index("order_item_id")
    while remaining:
        pass_rows = min(remaining, source_rows)
        def prefix_benchmark_id(indexed_row):
            row, row_index = indexed_row
            if row_index >= pass_rows:
                return None
            values = list(row)
            values[id_position] = f"PHASE3-{pass_number:03d}-{values[id_position]}"
            return tuple(values)

        copies = source.sparkSession.createDataFrame(
            source.rdd.zipWithIndex()
            .filter(lambda indexed_row: indexed_row[1] < pass_rows)
            .map(prefix_benchmark_id),
            schema=source.schema,
        )
        workload = workload.unionByName(copies)
        remaining -= pass_rows
        pass_number += 1
    return workload, source_rows, copied_rows


def _directory_size(path: str) -> int:
    total = 0
    for folder, _, filenames in os.walk(path):
        for name in filenames:
            try:
                total += os.path.getsize(os.path.join(folder, name))
            except OSError:
                pass
    return total


class ResourceSampler:
    def __init__(self, scratch: str):
        self.scratch = scratch
        self.process = psutil.Process()
        self.peak_process_rss = 0
        self.minimum_available_memory = psutil.virtual_memory().available
        self.peak_scratch_bytes = 0
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._sample, daemon=True)

    def _sample(self):
        while not self.stop_event.is_set():
            try:
                processes = [self.process, *self.process.children(recursive=True)]
                rss = sum(process.memory_info().rss for process in processes if process.is_running())
                self.peak_process_rss = max(self.peak_process_rss, rss)
            except (psutil.Error, OSError):
                pass
            try:
                self.minimum_available_memory = min(self.minimum_available_memory, psutil.virtual_memory().available)
                self.peak_scratch_bytes = max(self.peak_scratch_bytes, _directory_size(self.scratch))
            except OSError:
                pass
            self.stop_event.wait(0.2)

    def start(self):
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.thread.join()


def _hdfs_footprint(session, source_path: str) -> dict:
    jvm = session.sparkContext._jvm
    hadoop_conf = session.sparkContext._jsc.hadoopConfiguration()
    path = jvm.org.apache.hadoop.fs.Path(source_path)
    filesystem = path.getFileSystem(hadoop_conf)
    summary = filesystem.getContentSummary(path)
    files = [status for status in filesystem.listStatus(path) if status.isFile()]
    return {
        "logical_bytes": int(summary.getLength()),
        "replicated_bytes": int(summary.getSpaceConsumed()),
        "file_count_including_success_marker": len(files),
        "parquet_data_file_count": sum(status.getPath().getName().endswith(".parquet") for status in files),
    }


def _write_aggregates(path: Path, rows: list[dict]):
    fields = list(rows[0]) if rows else []
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    run_id = str(uuid.uuid4())
    store = OperationalStore()
    actor = {"role": "system"}
    store.record_spark_job_event(job=JOB_NAME, run_id=run_id, phase="start",
                                 details={"source": SOURCE, "target_rows": TARGET_ROWS})
    started_utc = datetime.now(timezone.utc).isoformat()
    total_started = time.perf_counter()
    disk_before = psutil.disk_usage(str(ROOT))
    memory_before = psutil.virtual_memory()
    output_csv = OUTPUT / "order_items_5m_by_menu_item.csv"
    output_json = OUTPUT / "order_items_5m_benchmark.json"
    sampler = None
    session = None
    try:
        with tempfile.TemporaryDirectory(prefix="dineq-phase3-spark-") as scratch:
            os.environ["SPARK_LOCAL_DIRS"] = scratch
            sampler = ResourceSampler(scratch)
            sampler.start()
            startup_started = time.perf_counter()
            session = spark("DineIQ-Phase3-Scale-Benchmark")
            session.sparkContext.setLogLevel("WARN")
            startup_seconds = time.perf_counter() - startup_started
            benchmark_started = time.perf_counter()

            canonical = session.read.parquet(SOURCE)
            canonical_rows = canonical.count()
            source_schema = canonical.schema.jsonValue()
            source_partitions = canonical.rdd.getNumPartitions()
            source_footprint = _hdfs_footprint(session, SOURCE)
            quality = json.loads((ROOT / "results" / "spark" / "quality_cleaning.json").read_text(encoding="utf-8"))
            source_quality = quality["profiled_before_cleaning"]["order_items"]
            workload, expanded_rows, copied_rows = expand_order_items(canonical, TARGET_ROWS)
            schema_matches = workload.schema == canonical.schema
            prefix_collisions = canonical.filter(F.col("order_item_id").startswith("PHASE3-")).limit(1).count()
            workload_partitions = workload.rdd.getNumPartitions()
            shuffle_partitions = int(session.conf.get("spark.sql.shuffle.partitions"))
            grouped = (workload.groupBy("menu_item_id")
                       .agg(F.count(F.lit(1)).alias("order_line_rows"),
                           F.sum("quantity").alias("units"),
                           F.sum("line_total").alias("line_total_units"))
                       .orderBy("menu_item_id"))
            aggregates = [row.asDict(recursive=True) for row in grouped.collect()]
            aggregate_seconds = time.perf_counter() - benchmark_started

            input_rows = sum(int(row["order_line_rows"]) for row in aggregates)
            numeric_values = [row[key] for row in aggregates for key in ("units", "line_total_units")]
            source_keys_clean = (
                "order_item_id" not in source_quality.get("nulls", {})
                and int(source_quality["processed_rows"]) == canonical_rows
            )
            validation = {
                "source_rows_are_canonical_v4": canonical_rows == 3_000_000,
                "benchmark_rows_exact": input_rows == TARGET_ROWS,
                "schema_unchanged": schema_matches,
                "source_primary_keys_verified_by_v4_cleaning": source_keys_clean,
                "benchmark_prefix_does_not_collide_with_canonical_ids": prefix_collisions == 0,
                "aggregate_rows_match_canonical_menu_size": len(aggregates) == 200,
                "all_aggregate_values_finite": all(value is None or math.isfinite(float(value)) for value in numeric_values),
            }
            passed = all(validation.values())
            conf = dict(session.sparkContext.getConf().getAll())
            java_version = session.sparkContext._jvm.java.lang.System.getProperty("java.version")
            _write_aggregates(output_csv, aggregates)
            sampler.stop()
            peak_process_rss = sampler.peak_process_rss
            minimum_available_memory = sampler.minimum_available_memory
            peak_scratch_bytes = sampler.peak_scratch_bytes
            session.stop()
            session = None

        disk_after = psutil.disk_usage(str(ROOT))
        finished_utc = datetime.now(timezone.utc).isoformat()
        evidence = {
            "status": "PASS" if passed else "FAIL",
            "benchmark_id": run_id,
            "started_utc": started_utc,
            "finished_utc": finished_utc,
            "classification": "disposable scalability-test workload; not competition or canonical data",
            "source": SOURCE,
            "source_rows": canonical_rows,
            "expansion_method": "Keep every canonical v4 order-item row; select the required supplemental rows by stable partition and row index, preserving source partitions without a global sort or single-partition limit; clone their values and prefix only order_item_id with PHASE3- to preserve the exact schema and unique line IDs.",
            "canonical_dataset_modified": False,
            "canonical_spark_v4_modified": False,
            "benchmark_rows": input_rows,
            "supplemental_rows": copied_rows,
            "schema": source_schema,
            "schema_unchanged": schema_matches,
            "line_id_uniqueness_basis": "Canonical v4 profile_clean removes duplicate order_item_id values before Parquet write; each test copy receives a PHASE3-nnn- prefix and therefore cannot collide with a canonical key.",
            "materialized_benchmark_rows": False,
            "benchmark_fixture_disk_bytes": 0,
            "canonical_hdfs_footprint": source_footprint,
            "spark": {
                "version": session.version if session is not None else __import__("pyspark").__version__,
                "java_version": java_version,
                "master": "local[4]",
                "driver_memory": conf.get("spark.driver.memory"),
                "shuffle_partitions": shuffle_partitions,
                "default_parallelism": conf.get("spark.default.parallelism"),
                "timezone": conf.get("spark.sql.session.timeZone"),
                "canonical_input_partitions": source_partitions,
                "expanded_input_partitions": workload_partitions,
                "aggregation_input_partitions": shuffle_partitions,
            },
            "workload": "Repartition the 5M-row order_items DataFrame and aggregate line count, distinct line IDs, units, line total and distinct orders by menu_item_id.",
            "operation_runtime_seconds": round(aggregate_seconds, 3),
            "spark_startup_seconds": round(startup_seconds, 3),
            "total_runtime_seconds": round(time.perf_counter() - total_started, 3),
            "machine": {
                "hostname": platform.node(),
                "platform": platform.platform(),
                "logical_cpus": psutil.cpu_count(logical=True),
                "physical_memory_bytes": memory_before.total,
                "available_memory_before_bytes": memory_before.available,
                "minimum_available_memory_during_run_bytes": minimum_available_memory,
                "peak_python_and_spark_child_rss_bytes": peak_process_rss,
                "local_spark_scratch_peak_bytes": peak_scratch_bytes,
                "d_drive_free_before_bytes": disk_before.free,
                "d_drive_free_after_scratch_cleanup_bytes": disk_after.free,
            },
            "output": {
                "path": str(output_csv.relative_to(ROOT)).replace("\\", "/"),
                "aggregate_rows": len(aggregates),
                "csv_bytes": output_csv.stat().st_size,
                "hdfs_paths_written": [],
            },
            "validation": validation,
        }
        output_json.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        store.record_spark_job_event(job=JOB_NAME, run_id=run_id, phase="complete" if passed else "failure",
                         details={"benchmark_rows": input_rows, "aggregate_rows": len(aggregates),
                              "runtime_seconds": evidence["total_runtime_seconds"],
                              "evidence_path": str(output_json.relative_to(ROOT)).replace("\\", "/")})
        print(json.dumps(evidence, indent=2))
        return 0 if passed else 1
    except KeyboardInterrupt as exc:
        store.record_spark_job_event(job=JOB_NAME, run_id=run_id, phase="interrupted",
                                     details={"error_type": type(exc).__name__, "message": str(exc)[:240]})
        raise
    except Exception as exc:
        store.record_spark_job_event(job=JOB_NAME, run_id=run_id, phase="failure",
                                     details={"error_type": type(exc).__name__, "message": str(exc)[:240]})
        raise
    finally:
        if sampler is not None and sampler.thread.is_alive():
            sampler.stop()
        if session is not None:
            try:
                session.stop()
            except Exception:
                pass


if __name__ == "__main__":
    raise SystemExit(main())