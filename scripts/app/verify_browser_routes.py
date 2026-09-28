"""Render each SPA page in headless Edge and record route smoke evidence."""
import json
import subprocess
import tempfile
import time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
EDGE=Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
ROUTES={
    "overview":"A clearer view of restaurant performance",
    "menu":"Understand what earns its place",
    "locations":"Performance by place and customer segment",
    "orders":"Read the rhythm of demand",
    "growth":"Measure offers and price movement",
    "operations":"Track guest feedback and operating signals",
    "forecast":"Explore an hourly order-arrival estimate",
    "system":"Know what powers each decision",
}

def main():
    if not EDGE.is_file(): raise FileNotFoundError(f"Headless Edge binary not found: {EDGE}")
    results=[]
    for route,expected in ROUTES.items():
        with tempfile.TemporaryDirectory(prefix="dineiq-edge-") as profile:
            cmd=[str(EDGE),"--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--disable-extensions","--disable-background-networking","--hide-scrollbars",f"--user-data-dir={profile}","--virtual-time-budget=7000","--dump-dom",f"http://127.0.0.1:5000/#/{route}"]
            started=time.perf_counter(); proc=subprocess.run(cmd,capture_output=True,text=True,timeout=35)
            dom=proc.stdout
            passed=proc.returncode==0 and expected in dom and "Loading verified DineIQ outputs" not in dom
            results.append({"route":route,"expected_heading":expected,"passed":passed,"elapsed_seconds":round(time.perf_counter()-started,2),"browser_exit_code":proc.returncode,"rendered_heading_found":expected in dom,"error_state":("Connection issue" in dom or "Service degraded" in dom)})
    out={"browser":"Microsoft Edge headless","route_count":len(results),"passed_routes":sum(r["passed"] for r in results),"all_passed":all(r["passed"] for r in results),"routes":results}
    path=ROOT/"results/app/browser_routes.json";path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(out,indent=2),encoding="utf-8")
    print(json.dumps(out,indent=2))
    if not out["all_passed"]: raise SystemExit(1)

if __name__=="__main__":main()
