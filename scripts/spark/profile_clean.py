"""Validate CSV, quarantine rejected records and publish versioned Parquet."""
from __future__ import annotations
import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from common import RAW, PROCESSED, QUALITY, ROOT, save_json, spark
from quality_rules import TABLE_ORDER, read_quality_csv, validate_table


def location(value):
    return value.rstrip("/") if "://" in value else Path(value).resolve().as_uri()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="Fresh version, e.g. v5; existing output fails")
    parser.add_argument("--input-root", default=RAW)
    parser.add_argument("--processed-root", default=PROCESSED)
    parser.add_argument("--quality-root", default=QUALITY)
    parser.add_argument("--evidence-dir", default=str(ROOT / "results/submission/quality"))
    args = parser.parse_args()
    if not args.version.startswith("v") or not args.version[1:].isdigit():
        parser.error("--version must be v followed by a number")
    evidence_path = Path(args.evidence_dir) / args.version / "quality_cleaning.json"
    if evidence_path.exists():
        raise SystemExit(f"Evidence exists: {evidence_path}; choose a fresh version")
    source = location(args.input_root)
    dest = f"{location(args.processed_root)}/{args.version}"
    quality = f"{location(args.quality_root)}/{args.version}"
    started = time.perf_counter()
    sp = spark("DineIQ-Validated-Quarantine")
    sp.conf.set("spark.sql.csv.parser.columnPruning.enabled", "false")
    accepted, reports = {}, {}
    try:
        for uri in (dest, quality):
            path = sp._jvm.org.apache.hadoop.fs.Path(uri)
            if path.getFileSystem(sp._jsc.hadoopConfiguration()).exists(path):
                raise FileExistsError(f"Output exists: {uri}; choose a fresh version")
        for table in TABLE_ORDER:
            raw = read_quality_csv(sp, table, f"{source}/{table}.csv")
            good, bad, report = validate_table(table, raw, accepted)
            good_path, bad_path = f"{dest}/{table}", f"{quality}/quarantine/{table}"
            good.write.mode("errorifexists").parquet(good_path)
            bad.write.mode("errorifexists").parquet(bad_path)
            reread_good, reread_bad = sp.read.parquet(good_path), sp.read.parquet(bad_path)
            report.update(accepted_path=good_path, quarantine_path=bad_path,
                          readback_passed=(reread_good.count() == report["accepted_count"] and reread_bad.count() == report["quarantine_count"]))
            if not report["readback_passed"]:
                raise RuntimeError(f"Read-back mismatch: {table}")
            accepted[table] = reread_good
            reports[table] = report
            good.unpersist()
            bad.unpersist()
            print(f"{table}: {report['before_count']} raw = {report['accepted_count']} accepted + {report['quarantine_count']} quarantine + {report['exact_duplicate_copies_removed']} duplicate copies", flush=True)
        evidence = {"contract_version": "submission-quality-v1", "timestamp_utc": datetime.now(timezone.utc).isoformat(),
                    "source": source, "processed_root": dest, "quality_root": quality,
                    "canonical_v4_changed": False, "all_passed": True, "tables": reports,
                    "count_semantics": "Raw = accepted + quarantined unique source records + removed exact copies. Rule counts overlap; do not sum them.",
                    "elapsed_seconds": round(time.perf_counter() - started, 3)}
        sp.createDataFrame([(json.dumps(evidence),)], "value string").write.mode("errorifexists").text(f"{quality}/report")
        save_json(evidence_path, evidence)
        print(f"Evidence: {evidence_path}", flush=True)
    finally:
        sp.stop()


if __name__ == "__main__":
    main()
