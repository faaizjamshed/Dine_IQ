"""Run submission regression checks and retain exact output/status, without secrets."""
import json
import argparse
import os
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "results/submission"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--module", action="append", help="Recheck a changed test module; combine with saved full regression XML")
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("JAVA_TOOL_OPTIONS", "-XX:ActiveProcessorCount=2 -XX:CICompilerCount=2")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("HADOOP_USER_NAME", "hadoop")
    checks = [("dependency_check", [sys.executable, "-m", "pip", "check"])]
    # Isolate each module's Spark lifecycle and retain a separate evidence file.
    paths = sorted((ROOT / "tests").glob("test_*.py"))
    if args.module:
        paths = [path for path in paths if path.name in args.module]
        if len(paths) != len(set(args.module)):
            parser.error("Unknown test module")
    for path in paths:
        checks.append((path.stem, [sys.executable, "-m", "pytest", str(path.relative_to(ROOT)), "-q", "--tb=short", "-p", "no:cacheprovider", f"--junitxml=results/submission/{path.stem}.xml"]))
    report = {"timestamp_utc": datetime.now(timezone.utc).isoformat(), "python": sys.version.split()[0],
              "scope": "Python regression, live HDFS API/model tests, malformed quality fixtures and production configuration checks. Targeted reruns replace matching cases in the saved full regression XML. No new browser or 5M benchmark run.", "checks": []}
    for name, command in checks:
        began = time.perf_counter()
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, encoding="utf-8", errors="replace")
        (OUT / f"{name}.log").write_text(result.stdout + result.stderr, encoding="utf-8")
        record = {"name": name, "command": ["python" if x == sys.executable else x for x in command],
                  "returncode": result.returncode, "elapsed_seconds": round(time.perf_counter() - began, 3),
                  "log": f"results/submission/{name}.log"}
        report["checks"].append(record)
        report["complete"] = len(report["checks"]) == len(checks)
        report["passed"] = report["complete"] and all(x["returncode"] == 0 for x in report["checks"])
        (OUT / "verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(record), flush=True)
        print(result.stdout[-2400:], flush=True)
    cases = {}
    sources = ([OUT / "regression.xml"] if args.module else []) + [OUT / f"{p.stem}.xml" for p in paths]
    for source in sources:
        if not source.is_file():
            raise FileNotFoundError(source)
        for case in ET.parse(source).iter("testcase"):
            cases[(case.get("classname"), case.get("name"))] = not any(case.find(tag) is not None for tag in ("failure", "error", "skipped"))
    report["latest_test_results"] = {"tests": len(cases), "passed": sum(cases.values()), "failed_or_skipped": sum(not x for x in cases.values()), "evidence_xml": [str(p.relative_to(ROOT)) for p in sources]}
    report["passed"] = report["passed"] and all(cases.values())
    (OUT / "verification.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    raise SystemExit(0 if report["passed"] else 1)


if __name__ == "__main__":
    main()
