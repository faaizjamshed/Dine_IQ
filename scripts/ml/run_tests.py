"""Run ML contract tests and preserve stdout/stderr with the true test exit code."""
import subprocess,sys
from pathlib import Path
root=Path(__file__).resolve().parents[2]
result=subprocess.run([sys.executable,"-m","unittest","discover","-s","tests","-p","test_ml_demand.py","-v"],cwd=root,capture_output=True,text=True)
log=root/"results/ml/tests.log"; log.parent.mkdir(parents=True,exist_ok=True)
log.write_text(result.stdout+result.stderr,encoding="utf-8")
print(result.stdout+result.stderr,end="")
raise SystemExit(result.returncode)
