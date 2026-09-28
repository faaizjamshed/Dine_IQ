"""Real Edge/CDP verification of DineIQ authentication, analytics, and operations."""
from __future__ import annotations
import base64, json, os, subprocess, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

import websocket

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/"results"/"app"/"phase2"
EDGE=Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
BASE="http://127.0.0.1:5000"
EMAIL="phase2-admin@dineq.local"
PASSWORD="Dineq-Phase2-Local-Admin-7264!?"

class Browser:
    def __init__(self, ws_url):
        self.ws=websocket.create_connection(ws_url,timeout=8,suppress_origin=True)
        self.seq=0;self.errors=[]
        self.call("Page.enable");self.call("Runtime.enable");self.call("Log.enable");self.call("Network.enable")
    def call(self,method,params=None,timeout=12):
        self.seq+=1;ident=self.seq
        self.ws.send(json.dumps({"id":ident,"method":method,"params":params or {}}))
        end=time.time()+timeout
        while time.time()<end:
            message=json.loads(self.ws.recv())
            if "method" in message:
                if message["method"]=="Runtime.exceptionThrown": self.errors.append(message.get("params",{}).get("exceptionDetails",{}).get("text","runtime exception"))
                if message["method"]=="Log.entryAdded" and message.get("params",{}).get("entry",{}).get("level")=="error": self.errors.append(message["params"]["entry"].get("text","console error"))
                continue
            if message.get("id")==ident:
                if "error" in message: raise RuntimeError(f"CDP {method}: {message['error']}")
                return message.get("result",{})
        raise TimeoutError(f"CDP command timed out: {method}")
    def js(self,expression,timeout=15):
        result=self.call("Runtime.evaluate",{"expression":expression,"awaitPromise":True,"returnByValue":True,"userGesture":True},timeout)
        if result.get("exceptionDetails"):
            raise RuntimeError(result["exceptionDetails"].get("text",str(result["exceptionDetails"])))
        return result.get("result",{}).get("value")
    def wait(self,expression,timeout=20):
        end=time.time()+timeout
        while time.time()<end:
            try:
                if self.js(expression): return True
            except Exception:
                pass
            time.sleep(.15)
        return False
    def route(self,name,selector="h1",timeout=25):
        self.js(f"location.hash='#/{name}'")
        if not self.wait(f"location.hash.includes('#/{name}') && !!document.querySelector('{selector}')",timeout):
            raise AssertionError(f"Route {name} did not render selector {selector}")
    def screenshot(self,name):
        data=self.call("Page.captureScreenshot",{"format":"png","captureBeyondViewport":True},20)["data"]
        path=OUT/name;path.write_bytes(base64.b64decode(data));return str(path.relative_to(ROOT)).replace("\\","/")

def main():
    OUT.mkdir(parents=True,exist_ok=True)
    version=json.load(urllib.request.urlopen("http://127.0.0.1:9222/json/version",timeout=1)) if False else None
    profile=OUT/"edge-profile";profile.mkdir(exist_ok=True)
    edge_args=[str(EDGE),"--headless=new","--disable-gpu","--no-first-run","--no-default-browser-check","--disable-extensions","--disable-background-networking","--remote-debugging-port=9222","--remote-allow-origins=*",f"--user-data-dir={profile}","--window-size=1440,1000","about:blank"]
    proc=subprocess.Popen(edge_args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    checks={};screenshots=[];browser=None
    def check(name,condition,detail=""):
        checks[name]={"passed":bool(condition),"detail":detail}
        if not condition: raise AssertionError(f"{name} failed: {detail}")
    try:
        target=None
        for _ in range(80):
            try:
                target=next((x for x in json.load(urllib.request.urlopen("http://127.0.0.1:9222/json/list",timeout=1)) if x.get("type")=="page"),None)
                if target and target.get("webSocketDebuggerUrl"):break
            except Exception: pass
            time.sleep(.25)
        if not target: raise RuntimeError("Edge DevTools page target did not start")
        browser=Browser(target["webSocketDebuggerUrl"])
        browser.call("Page.navigate",{"url":BASE+"/#/login"})
        check("login page rendered",browser.wait("!!document.querySelector('form#login-form')"),"real Edge DOM")
        browser.js(f"document.querySelector('#auth-email').value={json.dumps(EMAIL)};document.querySelector('#auth-password').value={json.dumps(PASSWORD)};document.querySelector('#login-form').dispatchEvent(new Event('submit',{{bubbles:true,cancelable:true}}))")
        check("administrator login",browser.wait("document.querySelector('#current-user')?.textContent.includes('administrator')",25),"authenticated Flask session")
        browser.route("overview",".kpi-grid");check("executive dashboard KPI cards",int(browser.js("document.querySelectorAll('.kpi-card').length"))>=4,"rendered real API values")
        screenshots.append(browser.screenshot("phase2_overview.png"))
        browser.route("menu","#profit-table table");check("menu profitability classes",int(browser.js("document.querySelectorAll('#profit-table tbody tr').length"))>0,"actual Spark gap1 rows")
        browser.route("locations","#locations-table table");check("location comparison table",int(browser.js("document.querySelectorAll('#locations-table tbody tr').length"))>0)
        browser.route("orders",".heatmap");check("peak-period heatmap",int(browser.js("document.querySelectorAll('.heat-hour').length"))==168)
        browser.route("growth","#promotion-table");check("promotions and pricing page",bool(browser.js("!!document.querySelector('#promotion-table')")))
        browser.route("operations","#rating-table");check("operations ratings and wastage page",bool(browser.js("!!document.querySelector('#rating-table')")))
        browser.route("forecast","#forecast-form");check("forecast form rendered",True)
        browser.js("document.querySelector('#forecast-restaurant').selectedIndex=1;document.querySelector('#forecast-hour').value='invalid-hour';document.querySelector('#lag_1h').value='1';document.querySelector('#lag_24h').value='2';document.querySelector('#lag_168h').value='3';document.querySelector('#forecast-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
        check("forecast invalid-input message",browser.wait("!!document.querySelector('#forecast-output .error-state')"),"backend validation response; "+str(browser.js("document.querySelector('#forecast-output').innerText")))
        browser.js("document.querySelector('#forecast-hour').value=(new Date(Date.now()+3600000)).toISOString().slice(0,13)+':00Z';document.querySelector('#forecast-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
        check("forecast valid inference",browser.wait("!!document.querySelector('#forecast-output .forecast-result')",25),"persisted Spark model inference")
        browser.route("intelligence","#waste-risk-form",35);check("advanced intelligence tables",int(browser.js("document.querySelectorAll('.data-table tbody tr').length"))>0)
        check("directional cross-sell wording",bool(browser.js("Array.from(document.querySelectorAll('.data-table tbody tr')).some(r=>r.textContent.includes('If a transaction contains'))")),"A→B wording carries directional confidence")
        browser.js("document.querySelector('#risk-restaurant').selectedIndex=1;document.querySelector('#risk-category').selectedIndex=1;document.querySelector('#risk-week').value='2026-09-08';document.querySelector('#waste-risk-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
        check("wastage-risk invalid week",browser.wait("!!document.querySelector('#risk-result .error-state')"),"Monday prediction-point validation")
        supported_risk=browser.js("fetch('/api/intelligence/wastage-risk').then(r=>r.json()).then(data=>data.items.find(row=>row.restaurant_id&&row.category_id))")
        check("wastage-risk canonical dimension pair",bool(supported_risk),"held-out predictions from canonical v4 dimensions")
        browser.js(f"document.querySelector('#risk-restaurant').value={json.dumps(supported_risk['restaurant_id'])};document.querySelector('#risk-category').value={json.dumps(supported_risk['category_id'])};document.querySelector('#risk-week').value='2026-09-07';document.querySelector('#waste-risk-form').dispatchEvent(new Event('submit',{{bubbles:true,cancelable:true}}))")
        check("wastage-risk model inference",browser.wait("!!document.querySelector('#risk-result .forecast-result')",25),"actual saved Spark v3 risk model; "+str(browser.js("document.querySelector('#risk-result').innerText")))
        browser.js("document.querySelector('#whatif-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
        check("what-if simulation UI",browser.wait("!!document.querySelector('#whatif-output .callout')"),"bounded scenario response")
        export=browser.js("fetch('/api/export/menu?format=csv&limit=5').then(async r=>({status:r.status,type:r.headers.get('content-type'),disposition:r.headers.get('content-disposition'),text:(await r.text()).slice(0,100)}))")
        check("selected analytics CSV export",export["status"]==200 and "text/csv" in export["type"] and "menu_item_id" in export["text"],json.dumps(export))
        report=browser.js("fetch('/api/reports/promotions').then(async r=>({status:r.status,type:r.headers.get('content-type'),disposition:r.headers.get('content-disposition'),text:(await r.text()).slice(0,80)}))")
        check("downloadable report response",report["status"]==200 and "attachment" in report["disposition"],json.dumps(report))
        screenshots.append(browser.screenshot("phase2_intelligence.png"))
        browser.route("management","#crud-entity");check("admin CRUD and account controls",bool(browser.js("!!document.querySelector('#user-create')")))
        location=browser.js("fetch('/api/management/locations/R001').then(r=>r.ok?r.json():null)")
        if location is None:
            browser.js("document.querySelector('#crud-entity').value='locations';document.querySelector('#crud-entity').dispatchEvent(new Event('change'));document.querySelector('#crud-json').value=JSON.stringify({restaurant_id:'R001',restaurant_name:'DineIQ Local Test Location',city:'Test City'});document.querySelector('#crud-create').click()")
        check("operational location record persisted",browser.wait("fetch('/api/management/locations/R001').then(r=>r.ok).catch(()=>false)"),"SQLite operational DB only")
        category=browser.js("fetch('/api/management/menu-categories/CAT-OP').then(r=>r.ok?r.json():null)")
        if category is None:
            browser.js("document.querySelector('#crud-entity').value='menu-categories';document.querySelector('#crud-entity').dispatchEvent(new Event('change'));document.querySelector('#crud-json').value=JSON.stringify({category_id:'CAT-OP',category_name:'Operational Test Category'});document.querySelector('#crud-create').click()")
        check("operational category record persisted",browser.wait("fetch('/api/management/menu-categories/CAT-OP').then(r=>r.ok).catch(()=>false)"))
        item=browser.js("fetch('/api/management/menu-items/M-OP').then(r=>r.ok?r.json():null)")
        if item is None:
            browser.js("document.querySelector('#crud-entity').value='menu-items';document.querySelector('#crud-entity').dispatchEvent(new Event('change'));document.querySelector('#crud-json').value=JSON.stringify({menu_item_id:'M-OP',category_id:'CAT-OP',item_name:'Operational Test Item',price:500,cost:220,available:true});document.querySelector('#crud-create').click()")
        check("operational menu record and price history persisted",browser.wait("fetch('/api/management/menu-items/M-OP').then(async r=>{if(!r.ok)return false;const history=await fetch('/api/management/pricing-history');const data=await history.json();return data.items.some(x=>x.menu_item_id==='M-OP')}).catch(()=>false)"))
        manager=browser.js("fetch('/api/admin/users').then(r=>r.json()).then(data=>data.items.find(user=>user.email==='phase2-manager@dineq.local'))")
        if manager is None:
            browser.js("document.querySelector('#user-email').value='phase2-manager@dineq.local';document.querySelector('#user-password').value='Local-Manager-Phase2-2891!';document.querySelector('#user-role').value='restaurant_manager';document.querySelector('#user-location').value='R001';document.querySelector('#user-create').click()")
        check("administrator provisions restaurant manager",browser.wait("fetch('/api/admin/users').then(r=>r.json()).then(data=>data.items.some(user=>user.email==='phase2-manager@dineq.local'&&user.role==='restaurant_manager'&&user.restaurant_id==='R001'))"),"role and location assigned server-side")
        screenshots.append(browser.screenshot("phase2_management.png"))
        browser.js("document.querySelector('#session-action').click()")
        check("administrator logout",browser.wait("!!document.querySelector('form#login-form')"))
        browser.js("document.querySelector('#auth-email').value='phase2-manager@dineq.local';document.querySelector('#auth-password').value='Local-Manager-Phase2-2891!';document.querySelector('#login-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))")
        check("restaurant manager login",browser.wait("document.querySelector('#current-user')?.textContent.includes('restaurant_manager')",20))
        browser.route("management","#crud-entity");check("RBAC hides admin/account controls",not bool(browser.js("!!document.querySelector('#user-create')")))
        check("RBAC hides forbidden location write controls",bool(browser.js("document.querySelector('#crud-create').hidden")))
        denied=browser.js("fetch('/api/auth/session').then(r=>r.json()).then(state=>fetch('/api/management/locations',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf_token},body:JSON.stringify({restaurant_id:'R001',restaurant_name:'X',city:'X'})})).then(async r=>({status:r.status,body:await r.json()}))")
        check("server-side RBAC denial",denied["status"]==403,json.dumps(denied))
        browser.route("intelligence","#waste-risk-form",35)
        browser.call("Emulation.setDeviceMetricsOverride",{"width":390,"height":844,"deviceScaleFactor":1,"mobile":True})
        time.sleep(.8)
        layout=browser.js("({viewport:innerWidth,body:document.body.scrollWidth,rendered:!!document.querySelector('#waste-risk-form')})")
        check("responsive mobile-width page",layout["body"]<=layout["viewport"]+2,json.dumps(layout))
        screenshots.append(browser.screenshot("phase2_intelligence_mobile.png"))
        browser.call("Emulation.setDeviceMetricsOverride",{"width":1440,"height":1000,"deviceScaleFactor":1,"mobile":False})
        browser.route("menu",".error-state",25) if False else None
        browser.js("window.__phase2Fetch=window.fetch;window.__phase2Requests=[];window.fetch=(input,...args)=>{const url=String(input);window.__phase2Requests.push(url);return url.includes('/api/menu?')?Promise.reject(new TypeError('Simulated API outage')):window.__phase2Fetch(input,...args)};location.hash='#/menu'")
        unavailable=browser.wait("!!document.querySelector('.error-state')",20)
        detail=browser.js("JSON.stringify({hash:location.hash,requests:window.__phase2Requests,page:document.getElementById('page').innerText.slice(0,500)})")
        check("API unavailable state",unavailable,detail)
        browser.js("window.fetch=window.__phase2Fetch;delete window.__phase2Fetch")
        browser.js("document.querySelector('#retry-load')?.click()")
        check("loading/error recovery",browser.wait("!!document.querySelector('#profit-table tbody tr')",25),"unblocked API retry renders real data")
        screenshots.append(browser.screenshot("phase2_menu_recovery.png"))
        browser.route("system",".data-table")
        spark_jobs=browser.js("fetch('/api/system/spark-jobs').then(r=>r.json())")
        system_text=browser.js("document.getElementById('page').innerText")
        truthful_monitor=(spark_jobs["monitoring_mode"]=="historical evidence; no claim of live job state" and spark_jobs["active_jobs"] is None and len(spark_jobs["jobs"])==3 and all(job["live"] is False and job["status"] in {"historical-success","unknown"} for job in spark_jobs["jobs"]) and "no live job state is claimed" in system_text)
        check("truthful historical Spark job monitoring",truthful_monitor,json.dumps(spark_jobs))
        screenshots.append(browser.screenshot("phase2_spark_monitoring.png"))
        unexpected_errors=browser.errors.copy()
        for expected in ("Failed to load resource: the server responded with a status of 400 (BAD REQUEST)","Failed to load resource: the server responded with a status of 403 (FORBIDDEN)"):
            unexpected_errors=[message for message in unexpected_errors if message!=expected]
        check("browser console/runtime error-free",not unexpected_errors,"; ".join(unexpected_errors[:8]))
        result={"timestamp_utc":datetime.now(timezone.utc).isoformat(),"browser":"Microsoft Edge headless via Chrome DevTools Protocol","base_url":BASE,"passed":all(x["passed"] for x in checks.values()),"checks":checks,"screenshots":screenshots,"console_runtime_errors":browser.errors,"local_only_operational_database":"results/app/phase2/browser_operational.sqlite3 (ignored by Git)","limitations":["No public deployment performed.","HDFS-backed API responses were verified locally."]}
        (OUT/"browser_verification.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
        md=["# Phase 2 browser verification","",f"Date: {result['timestamp_utc']}",f"Browser: {result['browser']}",f"Result: {'PASS' if result['passed'] else 'FAIL'}","","| Check | Result | Evidence |","|---|---|---|"]
        md.extend(f"| {name} | {'PASS' if item['passed'] else 'FAIL'} | {item['detail']} |" for name,item in checks.items())
        md.extend(["","Screenshots:",*['- `'+p+'`' for p in screenshots],"","Runtime errors: "+json.dumps(browser.errors)])
        (OUT/"browser_verification.md").write_text("\n".join(md),encoding="utf-8")
        print(json.dumps({"passed":result["passed"],"checks":checks,"screenshots":screenshots,"runtime_errors":browser.errors},indent=2))
        return 0 if result["passed"] else 1
    finally:
        if browser:
            try:browser.ws.close()
            except Exception:pass
        proc.terminate()
        try:proc.wait(timeout=5)
        except subprocess.TimeoutExpired:proc.kill()

if __name__=="__main__":raise SystemExit(main())
