"""Relocate a serving bundle, disable HDFS access, run actual API/model checks."""
import argparse
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "scripts/spark"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", required=True)
    parser.add_argument("--report", default="results/submission/portable_verification.json")
    args = parser.parse_args()
    os.environ.setdefault("SPARK_LOCAL_IP", "127.0.0.1")
    os.environ.setdefault("SPARK_LOCAL_HOSTNAME", "localhost")
    from app.artifacts import ArtifactBundle
    original = ArtifactBundle(args.bundle)
    report = {"timestamp_utc": datetime.now(timezone.utc).isoformat(), "hdfs_protocol_disabled": True,
              "relocated_bundle": True, "artifact_count": len(original.manifest["artifacts"])}
    with tempfile.TemporaryDirectory(prefix="dineiq-portable-") as tmp:
        relocated = Path(tmp) / "serving"
        shutil.copytree(original.root, relocated)
        checked = ArtifactBundle(relocated)
        # Corruption, omitted required files and unlisted injection all fail closed.
        file = relocated / next(iter(checked.manifest["files"]))
        before = file.read_bytes()
        file.write_bytes(before + b"corrupted")
        try:
            ArtifactBundle(relocated)
            raise AssertionError("Corrupt bundle was accepted")
        except ValueError:
            report["corruption_rejected"] = True
        file.write_bytes(before)
        extra = relocated / "unlisted.parquet"
        extra.write_bytes(b"untrusted")
        try:
            ArtifactBundle(relocated)
            raise AssertionError("Injected file was accepted")
        except ValueError:
            report["injected_file_rejected"] = True
        extra.unlink()
        os.environ["DINEIQ_ARTIFACT_ROOT"] = str(relocated)
        os.environ["DINEIQ_DATABASE_PATH"] = str(Path(tmp) / "operations.sqlite3")
        os.environ["DINEIQ_ENV"] = "development"
        for name in ("DINEIQ_BOOTSTRAP_ADMIN_EMAIL", "DINEIQ_BOOTSTRAP_ADMIN_PASSWORD", "DINEIQ_BOOTSTRAP_ADMIN_PASSWORD_FILE"):
            os.environ.pop(name, None)
        import common
        real_spark = common.spark
        def without_hdfs(*args, **kwargs):
            sp = real_spark(*args, **kwargs)
            sp._jsc.hadoopConfiguration().set("fs.hdfs.impl", "verification.HdfsDisabled")
            return sp
        common.spark = without_hdfs
        from app.backend import app
        service = app.extensions["dineiq_service"]
        report["health"] = service.health()
        log = io.StringIO()
        suite = unittest.defaultTestLoader.discover(str(ROOT / "tests"), pattern="test_app_integration.py")
        result = unittest.TextTestRunner(stream=log, verbosity=2).run(suite)
        report.update(tests_run=result.testsRun, failures=len(result.failures), errors=len(result.errors),
                      passed=result.wasSuccessful() and service.ready and service.storage_backend == "local_bundle")
        path = Path(args.report)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        path.with_suffix(".log").write_text(log.getvalue(), encoding="utf-8")
        print(log.getvalue())
        print(json.dumps(report, indent=2))
        if service.spark:
            service.spark.stop()
        if not report["passed"]:
            raise SystemExit(1)


if __name__ == "__main__":
    main()
