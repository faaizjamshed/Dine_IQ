"""Run real HDFS-backed Flask integration tests and preserve their log."""
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
result=subprocess.run([sys.executable,"-m","unittest","discover","-s","tests","-p","test_app_integration.py","-v"],cwd=ROOT,capture_output=True,text=True)
path=ROOT/"results/app/tests.log";path.parent.mkdir(parents=True,exist_ok=True);path.write_text(result.stdout+result.stderr,encoding="utf-8")
print(result.stdout+result.stderr,end="")
raise SystemExit(result.returncode)
