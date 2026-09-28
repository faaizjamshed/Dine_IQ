"""Exercise the running DineIQ HTTP application and record real timings."""
from __future__ import annotations
import json
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
BASE="http://127.0.0.1:5000"

def request(path: str, body=None):
    data=json.dumps(body).encode("utf-8") if body is not None else None
    req=urllib.request.Request(BASE+path,data=data,headers={"Accept":"application/json","Content-Type":"application/json"},method="POST" if body is not None else "GET")
    started=time.perf_counter()
    with urllib.request.urlopen(req,timeout=40) as response:
        payload=response.read()
        elapsed=(time.perf_counter()-started)*1000
        parsed=json.loads(payload) if response.headers.get("Content-Type","").startswith("application/json") else payload.decode("utf-8")
        return {"status":response.status,"elapsed_ms":round(elapsed,2),"server_elapsed_ms":response.headers.get("X-Response-Time-ms"),"bytes":len(payload),"data":parsed}

def main():
    results={}
    results["health"]=request("/api/health"); assert results["health"]["data"]["status"]=="ok"
    results["overview_samples"]=[request("/api/overview") for _ in range(5)]
    assert results["overview_samples"][-1]["data"]["kpis"]["orders"]==650000
    results["menu_filter"]=request("/api/menu?category=Burgers&limit=10"); assert results["menu_filter"]["data"]["items"]
    assert all(x["category_name"]=="Burgers" for x in results["menu_filter"]["data"]["items"])
    for key,path in (("categories","/api/categories"),("locations","/api/restaurants"),("channels","/api/channels"),("promotions","/api/promotions"),("ratings","/api/ratings"),("wastage","/api/wastage"),("inventory","/api/inventory"),("pricing","/api/pricing"),("monthly","/api/demand/monthly"),("peak_hours","/api/demand/peak-hours"),("segments","/api/customer-segments"),("model","/api/ml/model"),("evidence","/api/system/evidence"),("performance","/api/system/performance")):
        results[key]=request(path)
        assert results[key]["status"]==200
    results["prediction"]=request("/api/ml/predict",{"restaurant_id":"R001","target_hour":"2026-09-01T00:00:00Z","lag_1h":2,"lag_24h":3,"lag_168h":4})
    assert results["prediction"]["status"]==200 and isinstance(results["prediction"]["data"]["predicted_order_arrivals"],(int,float))
    for path in ("/","/assets/app.js","/assets/app.css"):
        r=request(path); assert r["status"]==200; results["frontend"+path.replace("/","_")]=r
    summary={"base_url":BASE,"verified_at_local":time.strftime("%Y-%m-%d %H:%M:%S"),"health":results["health"]["data"],"verified_endpoints":{k:{k2:v for k2,v in val.items() if k2!="data"} for k,val in results.items() if isinstance(val,dict) and "status" in val},"overview_repeated_latency_ms":[x["elapsed_ms"] for x in results["overview_samples"]],"overview_payload_bytes":results["overview_samples"][-1]["bytes"],"menu_filter_returned":len(results["menu_filter"]["data"]["items"]),"prediction":results["prediction"]["data"],"all_checks_passed":True}
    out=ROOT/"results"/"app";out.mkdir(parents=True,exist_ok=True);(out/"api_performance.json").write_text(json.dumps(summary,indent=2),encoding="utf-8")
    print(json.dumps(summary,indent=2))

if __name__=="__main__": main()
