"""Browser/API integration checks against the unmodified running backend.

Run from frontend with ..\.venv\Scripts\python.exe -B scripts\verify-integration.py.
Uses only the isolated runtime.sqlite3 created for verification. No mocked routes.
"""
from __future__ import annotations
import base64
import json
import os
import re
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path
import websocket

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(os.environ.get('DINEIQ_VERIFICATION_OUTPUT', str(ROOT / 'verification')))
STATE = Path(os.environ.get('DINEIQ_VERIFICATION_STATE', str(ROOT / 'verification' / 'backend-process.json')))
BASE = os.environ.get('DINEIQ_FRONTEND_URL', 'http://127.0.0.1:3000').rstrip('/')
BACKEND = os.environ.get('DINEIQ_BACKEND_URL', 'http://127.0.0.1:5000').rstrip('/')
EDGE = Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe')

class CDP:
    def __init__(self, url):
        self.ws = websocket.create_connection(url, timeout=1, suppress_origin=True)
        self.seq = 0
        self.events = []
    def call(self, method, params=None, timeout=40):
        self.seq += 1
        self.ws.send(json.dumps({'id':self.seq,'method':method,'params':params or {}}))
        end = time.monotonic()+timeout
        while time.monotonic()<end:
            try: result=json.loads(self.ws.recv())
            except websocket.WebSocketTimeoutException: continue
            if result.get('id')==self.seq:
                if 'error' in result: raise RuntimeError(result['error'])
                return result.get('result',{})
            self.events.append(result)
        raise TimeoutError(method)
    def js(self, expression):
        r=self.call('Runtime.evaluate',{'expression':expression,'returnByValue':True,'awaitPromise':True,'userGesture':True})
        if 'exceptionDetails' in r: raise RuntimeError(r['exceptionDetails'])
        return r.get('result',{}).get('value')
    def until(self, expression, seconds=35):
        end=time.monotonic()+seconds
        while time.monotonic()<end:
            if self.js(expression): return
            time.sleep(.2)
        raise TimeoutError(expression)
    def screenshot(self, name):
        r=self.call('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False})
        (OUT/name).write_bytes(base64.b64decode(r['data']))

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    state=json.loads(STATE.read_text())
    assert Path(state['database']).resolve()==(ROOT/'verification'/'runtime.sqlite3').resolve()
    credentials=json.loads(Path(state['credentials_file']).read_text())
    with socket.socket() as s:
        s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    profile=tempfile.mkdtemp(prefix='dineiq-frontend-edge-')
    browser=subprocess.Popen([str(EDGE),'--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--remote-allow-origins=*',f'--remote-debugging-port={port}',f'--user-data-dir={profile}','about:blank'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,creationflags=subprocess.CREATE_NO_WINDOW)
    result={'routes':[],'checks':{},'console_errors':[],'api_requests':[]}
    c=None
    try:
        end=time.monotonic()+20
        while time.monotonic()<end:
            try:
                targets=json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list',timeout=1))
                if targets:break
            except Exception:time.sleep(.2)
        c=CDP(next(t['webSocketDebuggerUrl'] for t in targets if t['type']=='page'))
        for method in ['Page.enable','Runtime.enable','Network.enable','Log.enable']:c.call(method)
        c.call('Emulation.setDeviceMetricsOverride',{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False})
        c.call('Page.navigate',{'url':BASE+'/dashboard'})
        c.until("location.pathname==='/login' && !!document.querySelector('#email')")
        c.screenshot('login.png')
        result['checks']['protected_route_redirect']=True
        # Fill the real React login form, then submit it.
        c.js("(()=>{const set=(id,v)=>{const e=document.getElementById(id);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}))};set('email',"+json.dumps(credentials['email'])+");set('password',"+json.dumps(credentials['password'])+");})()")
        c.js("document.querySelector('form').requestSubmit()")
        c.until("location.pathname==='/dashboard' && document.body.innerText.includes('Completed revenue')")
        result['checks']['login_form']=True
        c.call('Page.reload')
        c.until("location.pathname==='/dashboard' && document.body.innerText.includes('Completed revenue')")
        result['checks']['session_restored_on_refresh']=True
        routes=['dashboard','menu','customers','basket','forecast','wastage','locations','channels','pricing','anomalies','recommendations','what-if','models','reports','admin']
        for route in routes:
            c.js("history.pushState({},'',"+json.dumps('/'+route)+");window.dispatchEvent(new PopStateEvent('popstate'))")
            time.sleep(.6)
            c.until("!document.querySelector('[aria-busy=\"true\"],.animate-pulse') && !document.body.innerText.includes('Loading your session')")
            text=c.js('document.body.innerText')
            bad=re.findall(r'\bNaN\b|\bundefined\b|Something went wrong|Unexpected client error',text)
            result['routes'].append({'route':route,'loaded':c.js('location.pathname')=='/'+route,'invalid_text':bad,'body_characters':len(text),'unavailable_disclosure':'unavailable' in text.lower()})
            (OUT/f'page-{route}.txt').write_text(text,encoding='utf-8')
            if route in ['dashboard','menu','locations']:c.screenshot(route+'.png')
            print('Route',route,'loaded; invalid values:',len(bad),flush=True)
        # Direct URL navigation exercises Vite history fallback as well as session restore.
        c.call('Page.navigate',{'url':BASE+'/menu'})
        c.until("document.body.innerText.includes('Classic Burger 1')")
        result['checks']['direct_menu_navigation']=True
        c.call('Emulation.setDeviceMetricsOverride',{'width':390,'height':844,'deviceScaleFactor':1,'mobile':True})
        c.screenshot('mobile-menu.png')
        result['checks']['mobile_no_document_overflow']=c.js('document.documentElement.scrollWidth<=window.innerWidth')
        c.call('Emulation.setDeviceMetricsOverride',{'width':1440,'height':1000,'deviceScaleFactor':1,'mobile':False})
        # Compare adapter values to real API responses. Dynamic import works in Vite dev.
        checks=c.js("""(async()=>{
          const e=await import('/src/api/endpoints.ts'); const get=async p=>(await fetch(p)).json();
          const [raw,adapted,menu,rows,baskets]=await Promise.all([get('/api/overview'),e.fetchKpis({},{}),get('/api/intelligence/menu?limit=1000'),e.fetchMenuItems({},{}),e.fetchBasketAnalysis({}, {})]);
          const item=rows.data.items[0],m=menu.items.find(r=>r.menu_item_id===item.itemId);
          const {DISH_IMAGES}=await import('/src/generated/dishImages.generated.ts');
          const photoCoverage=menu.items.every(r=>DISH_IMAGES[r.menu_item_id]?.name===r.item_name&&DISH_IMAGES[r.menu_item_id]?.category===r.category_name);
          const photoSources=[...new Set(menu.items.map(r=>DISH_IMAGES[r.menu_item_id]?.src))];
          const photosLoaded=await Promise.all(photoSources.map(src=>new Promise(resolve=>{if(!src)return resolve(false);const img=new Image();img.onload=()=>resolve(img.naturalWidth===256&&img.naturalHeight===256);img.onerror=()=>resolve(false);img.src=src})));
          const unsupported=await e.fetchMenuItems({channel:'Mobile App'},{}).then(()=>false,x=>x.kind==='no_data');
          const scenario=await e.runWhatIfSimulation({itemId:item.itemId,priceChangePct:10,discountPct:0,prepChangePct:0,horizonDays:7,elasticity:0},{},{});
          const report=await e.runReport('menu',{},{});
          const forecasts=await e.fetchForecastOverview({},{});
          const response=await e.apiPost('/api/ml/predict',{restaurant_id:'R001',target_hour:'2026-08-31T12:00:00Z',lag_1h:2,lag_24h:2,lag_168h:2});
          return {menu_photo_coverage:photoCoverage,menu_photos_decode:photosLoaded.every(Boolean),menu_photo_elements:document.querySelectorAll('tbody img[src*="/images/dishes/catalog/"]').length===menu.items.length,dashboard_revenue_exact:adapted.data.kpis.find(k=>k.id==='revenue').value===raw.kpis.completed_revenue,menu_revenue_exact:item.revenue===m.revenue,margin_fraction_converted:item.marginPct===m.contribution_margin_pct*100,unknown_rating_is_missing:!Number.isFinite(item.rating),basket_real_rules:baskets.data.rules.length>0,unsupported_scope_rejected:unsupported,whatif_real_response:Math.abs(scenario.data.scenario.price-m.base_price*1.1)<1e-7,report_real_rows:report.data.rows.length===menu.count,forecast_not_fabricated:forecasts.data.daily.length===0&&!Number.isFinite(forecasts.data.kpis.forecastOrders),hourly_model_prediction:Number.isFinite(response.predicted_order_arrivals)};
        })()""")
        result['checks'].update(checks)
        c.js("document.querySelector('input[placeholder^=\"Search items or categories\"]').scrollIntoView({block:'start'})")
        c.until("Array.from(document.querySelectorAll('tbody img')).slice(0,6).every(i=>i.complete&&i.naturalWidth>0)")
        c.screenshot('menu-with-photos.png')
        # Existing backend's legacy UI is still served unchanged.
        with urllib.request.urlopen(BACKEND+'/') as response:
            result['checks']['legacy_ui_accessible']=response.status==200 and b'<!' in response.read(100)
        # Honest empty scope, loading, and offline states. No fabricated responses are supplied.
        c.js("history.pushState({},'','/menu?channel=Mobile+App');window.dispatchEvent(new PopStateEvent('popstate'))")
        c.until("document.body.innerText.includes('Data unavailable for these filters')")
        result['checks']['unsupported_scope_empty_state']=True
        c.call('Network.emulateNetworkConditions',{'offline':False,'latency':800,'downloadThroughput':-1,'uploadThroughput':-1})
        c.js("history.pushState({},'','/channels?channel=Dine-in');window.dispatchEvent(new PopStateEvent('popstate'))")
        result['checks']['loading_state']=c.js("!!document.querySelector('[aria-busy=\"true\"],.animate-pulse')")
        c.call('Network.emulateNetworkConditions',{'offline':False,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1})
        c.until("!document.querySelector('[aria-busy=\"true\"],.animate-pulse')")
        c.call('Network.emulateNetworkConditions',{'offline':True,'latency':0,'downloadThroughput':0,'uploadThroughput':0})
        c.js("history.pushState({},'','/channels?channel=Takeaway');window.dispatchEvent(new PopStateEvent('popstate'))")
        c.until("document.body.innerText.includes('Network unavailable')")
        result['checks']['offline_error_state']=True
        c.call('Network.emulateNetworkConditions',{'offline':False,'latency':0,'downloadThroughput':-1,'uploadThroughput':-1})
        # Verify real server logout removes API access.
        result['checks']['server_logout']=c.js("(async()=>{await (await import('/src/api/endpoints.ts')).postLogout();const r=await fetch('/api/overview');return r.status===401})()")
        c.call('Page.reload');c.until("location.pathname==='/login'")
        result['checks']['logout_survives_refresh']=True
        request_methods={}
        for ev in c.events:
            method=ev.get('method');p=ev.get('params',{})
            if method=='Network.requestWillBeSent':request_methods[p['requestId']]=p['request']['method']
            if method=='Network.responseReceived' and '/api/' in p.get('response',{}).get('url',''):
                r=p['response'];result['api_requests'].append({'url':r['url'],'status':r['status'],'method':request_methods.get(p['requestId'])})
            if method=='Runtime.exceptionThrown':result['console_errors'].append(p['exceptionDetails'].get('text','Exception'))
            if method=='Runtime.consoleAPICalled' and p.get('type')=='error':result['console_errors'].append(' '.join(str(a.get('value',a.get('description',''))) for a in p.get('args',[])))
        result['all_passed']=all(result['checks'].values()) and all(r['loaded'] and not r['invalid_text'] for r in result['routes']) and not result['console_errors']
    except Exception as exc:
        result['error']=str(exc);result['all_passed']=False
        if c:
            try:(OUT/'failure-page.txt').write_text(c.js('document.body.innerText'),encoding='utf-8');c.screenshot('failure.png')
            except Exception:pass
    finally:
        (OUT/'browser-verification.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        if c:
            try:c.call('Browser.close')
            except Exception:pass
            c.ws.close()
        if browser.poll() is None:browser.terminate()
    print(json.dumps({k:v for k,v in result.items() if k!='api_requests'},indent=2))
    return 0 if result['all_passed'] else 1

if __name__=='__main__':raise SystemExit(main())
