"""Run browser-rendered DineIQ SPA checks through installed Microsoft Edge/CDP."""
from __future__ import annotations

import json
import base64
import os
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket
from verify_phase2_browser import EMAIL as LOGIN_EMAIL, PASSWORD as LOGIN_PASSWORD

ROOT = Path(__file__).resolve().parents[2]
EDGE = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
BASE = os.environ.get("DINEIQ_BASE_URL", "http://127.0.0.1:5000")
ROUTES = {
    "overview": "A clearer view of restaurant performance",
    "menu": "Understand what earns its place",
    "locations": "Performance by place and customer segment",
    "orders": "Read the rhythm of demand",
    "growth": "Measure offers and price movement",
    "operations": "Track guest feedback and operating signals",
    "forecast": "Explore an hourly order-arrival estimate",
    "system": "Know what powers each decision",
}


class DevTools:
    def __init__(self, ws_url: str):
        self.ws = websocket.create_connection(ws_url, timeout=1, suppress_origin=True)
        self.seq = 0
        self.events: list[dict] = []

    def call(self, method: str, params: dict | None = None, timeout: float = 15):
        self.seq += 1
        call_id = self.seq
        self.ws.send(json.dumps({"id": call_id, "method": method, "params": params or {}}))
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                value = json.loads(self.ws.recv())
            except websocket.WebSocketTimeoutException:
                continue
            if value.get("id") == call_id:
                if "error" in value:
                    raise RuntimeError(value["error"])
                return value.get("result", {})
            if "method" in value:
                self.events.append(value)
        raise TimeoutError(f"DevTools call timed out: {method}")

    def evaluate(self, expression: str, timeout: float = 15):
        result = self.call("Runtime.evaluate", {
            "expression": expression,
            "returnByValue": True,
            "awaitPromise": True,
            "userGesture": True,
        }, timeout=timeout)
        if result.get("exceptionDetails"):
            raise RuntimeError(result["exceptionDetails"].get("text", "browser evaluation failed"))
        remote = result.get("result", {})
        return remote.get("value")


def pick_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def main() -> int:
    if not EDGE.is_file():
        raise FileNotFoundError(f"Microsoft Edge not found at {EDGE}")
    port = pick_port()
    profile = tempfile.mkdtemp(prefix="dineq-cdp-")
    command = [str(EDGE), "--headless=new", "--disable-gpu", "--disable-software-rasterizer",
               "--disable-features=VizDisplayCompositor", "--no-first-run", "--no-default-browser-check",
               "--disable-extensions", "--disable-background-networking", "--remote-allow-origins=*",
               f"--remote-debugging-port={port}", f"--user-data-dir={profile}", "about:blank"]
    browser = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    devtools = None
    try:
        version_url = f"http://127.0.0.1:{port}/json/version"
        end = time.monotonic() + 20
        version = None
        while time.monotonic() < end:
            if browser.poll() is not None:
                raise RuntimeError(f"Edge exited during startup with code {browser.returncode}")
            try:
                with urllib.request.urlopen(version_url, timeout=1) as response:
                    version = json.load(response)
                break
            except Exception:
                time.sleep(.2)
        if not version:
            raise TimeoutError("Edge DevTools endpoint did not become ready")
        new_target = urllib.request.Request(f"http://127.0.0.1:{port}/json/new?about:blank", method="PUT")
        with urllib.request.urlopen(new_target, timeout=3) as response:
            target = json.load(response)
        devtools = DevTools(target["webSocketDebuggerUrl"])
        devtools.call("Page.enable")
        devtools.call("Runtime.enable")
        devtools.call("Log.enable")
        devtools.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
        devtools.call("Page.navigate", {"url": f"{BASE}/#/login"})
        login_form_deadline = time.monotonic() + 15
        while time.monotonic() < login_form_deadline:
            if devtools.evaluate("!!document.querySelector('#login-form')"):
                break
            time.sleep(.15)
        else:
            raise RuntimeError("The browser did not render the local administrator login form.")
        devtools.evaluate(
            f"document.querySelector('#auth-email').value={json.dumps(LOGIN_EMAIL)};"
            f"document.querySelector('#auth-password').value={json.dumps(LOGIN_PASSWORD)};"
            "document.querySelector('#login-form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}))"
        )
        login_deadline = time.monotonic() + 25
        while time.monotonic() < login_deadline:
            if devtools.evaluate("document.querySelector('#current-user')?.textContent.includes('administrator')"):
                break
            time.sleep(.2)
        else:
            raise RuntimeError("The configured local administrator could not authenticate in Edge.")
        devtools.evaluate("window.location.hash='#/overview'")
        time.sleep(.3)

        route_results = []
        visual = {}
        for route, expected in ROUTES.items():
            if route != "overview":
                devtools.evaluate(f"document.querySelector('.primary-nav a[data-route=\\\"{route}\\\"]')?.click()")
            time.sleep(1.3)
            snapshot = devtools.evaluate("""(() => ({
              heading: document.querySelector('#page h1')?.textContent?.trim() || '',
              loading: !!document.querySelector('#page .loading-state'),
              apiError: !!document.querySelector('#page .error-state'),
              svgCount: document.querySelectorAll('#page svg').length,
              tableCount: document.querySelectorAll('#page table tbody tr').length,
              heatmapCount: document.querySelectorAll('#page .heatmap').length,
              navActive: document.querySelector('.primary-nav a.active')?.dataset.route || '',
              filterIds: [...document.querySelectorAll('#page select, #page input')].map(x=>x.id),
              bodyWidth: document.body.scrollWidth,
              viewportWidth: innerWidth
            }))()""")
            route_results.append({"route": route, "expected_heading": expected,
                                  "actual_heading": snapshot["heading"],
                                  "passed": snapshot["heading"] == expected and not snapshot["loading"] and not snapshot["apiError"],
                                  "snapshot": snapshot})
            if route in ("overview", "orders", "forecast"):
                visual[route] = snapshot

        # Exercise a real interactive filter (category) and verify its request updates rows.
        devtools.evaluate("window.location.hash = '#/menu'")
        time.sleep(1.3)
        filter_result = devtools.evaluate("""(() => {
          const select=document.querySelector('#menu-category');
          if (!select || select.options.length < 2) return {present:!!select, changed:false};
          select.value=select.options[1].value; select.dispatchEvent(new Event('change',{bubbles:true}));
          return {present:true, changed:true, value:select.value};
        })()""")
        time.sleep(.7)
        filter_result["visible_rows_after_filter"] = devtools.evaluate("document.querySelectorAll('#menu-table tbody tr').length")

        # Trigger invalid target-hour input through the actual rendered forecast form.
        devtools.evaluate("window.location.hash = '#/forecast'")
        time.sleep(1.3)
        forecast_form = devtools.evaluate("""(() => {
          const put=(id,value)=>{const el=document.getElementById(id); if(el){el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));}};
          const restaurant=document.querySelector('#forecast-restaurant');
          if(restaurant && restaurant.options.length>1) restaurant.value=restaurant.options[1].value;
          put('forecast-hour','not-a-valid-hour'); put('lag_1h','1'); put('lag_24h','2'); put('lag_168h','3');
          document.querySelector('#forecast-form')?.requestSubmit();
          return {formPresent:!!document.querySelector('#forecast-form'), targetValue:document.querySelector('#forecast-hour')?.value||'', restaurantSelected:!!restaurant?.value};
        })()""")
        time.sleep(1.2)
        invalid_forecast = {**forecast_form,
                            "error_text": devtools.evaluate("document.querySelector('#forecast-output .error-state')?.textContent?.trim()||''"),
                            "loading_visible": devtools.evaluate("!!document.querySelector('#forecast-output .loading-state')")}

        # Check real responsive CSS layout at a narrow viewport.
        devtools.call("Emulation.setDeviceMetricsOverride", {"width": 390, "height": 844, "deviceScaleFactor": 1, "mobile": True})
        time.sleep(.3)
        responsive = devtools.evaluate("""(() => ({viewport:innerWidth, bodyWidth:document.body.scrollWidth,
          sidebarPosition:getComputedStyle(document.querySelector('#sidebar')).position,
          menuButtonVisible:getComputedStyle(document.querySelector('#mobile-menu')).display !== 'none'}))()""")

        # Save a rendered desktop screenshot as visual audit evidence.
        devtools.call("Emulation.setDeviceMetricsOverride", {"width": 1440, "height": 1000, "deviceScaleFactor": 1, "mobile": False})
        devtools.evaluate("document.querySelector('.primary-nav a[data-route=\\\"overview\\\"]')?.click()")
        time.sleep(1.3)
        screenshot = devtools.call("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})
        screenshot_path = ROOT / "results" / "app" / "browser_overview.png"
        screenshot_path.write_bytes(base64.b64decode(screenshot["data"]))

        # Simulate API unavailability at the browser fetch boundary (no mock response/data).
        devtools.evaluate("window.__realFetch=window.fetch; window.fetch=()=>Promise.reject(new TypeError('Failed to fetch')); window.location.hash = '#/menu'; setTimeout(()=>document.querySelector('.primary-nav a[data-route=\\\"overview\\\"]')?.click(),50)")
        time.sleep(.8)
        api_outage = devtools.evaluate("""(() => ({visible:!!document.querySelector('#page .error-state'),
          text:document.querySelector('#page .error-state')?.textContent?.trim()||''}))()""")

        # Delay genuine API fetches to observe the transient loading state without substitute data.
        devtools.evaluate("window.fetch=(...args)=>new Promise((resolve,reject)=>setTimeout(()=>window.__realFetch(...args).then(resolve,reject),500)); document.querySelector('.primary-nav a[data-route=\\\"menu\\\"]')?.click()")
        time.sleep(.18)
        loading_observation = devtools.evaluate("!!document.querySelector('#page .loading-state')")
        time.sleep(1.5)
        delayed_result = devtools.evaluate("""(() => ({heading:document.querySelector('#page h1')?.textContent?.trim()||'',
          rows:document.querySelectorAll('#menu-table tbody tr').length, error:!!document.querySelector('#page .error-state')}))()""")
        loaded_after_delay = delayed_result.get("heading") == ROUTES["menu"] and delayed_result.get("rows") == 200 and not delayed_result.get("error")
        devtools.evaluate("window.fetch=window.__realFetch")

        errors = []
        expected_validation_messages = []
        for event in devtools.events:
            method = event.get("method", "")
            params = event.get("params", {})
            if method == "Runtime.exceptionThrown":
                errors.append({"type": "runtime_exception", "text": params.get("exceptionDetails", {}).get("text", "")})
            elif method == "Log.entryAdded" and params.get("entry", {}).get("level") == "error":
                entry = params["entry"]
                message = entry.get("text", "")
                if "status of 400 (BAD REQUEST)" in message or "ERR_INTERNET_DISCONNECTED" in message:
                    expected_validation_messages.append(message)
                else:
                    errors.append({"type": "console_or_browser_error", "text": message})

        result = {
            "verified_at_local": time.strftime("%Y-%m-%d %H:%M:%S"),
            "browser": version.get("Browser"),
            "method": "Headless Edge via Chrome DevTools Protocol",
            "url": BASE,
            "routes": route_results,
            "navigation_present": bool(devtools.evaluate("document.querySelectorAll('.primary-nav a').length >= 8")),
            "interactive_category_filter": filter_result,
            "forecast_invalid_input": invalid_forecast,
            "responsive_mobile": responsive,
            "api_unavailable_error_state": api_outage,
            "delayed_api_loading_state": {"visible_during_delayed_fetch": loading_observation,
                                           "loaded_real_data_after_delay": loaded_after_delay,
                                           "result": delayed_result},
            "screenshot": str(screenshot_path.relative_to(ROOT)).replace("\\", "/"),
            "expected_client_error_messages": expected_validation_messages,
            "browser_runtime_errors": errors,
            "all_routes_passed": all(row["passed"] for row in route_results),
            "all_checks_passed": all(row["passed"] for row in route_results)
                                    and filter_result.get("changed") and filter_result.get("visible_rows_after_filter", 0) > 0
                                    and bool(invalid_forecast["error_text"]) and api_outage.get("visible")
                                    and loading_observation and loaded_after_delay and not errors,
            "notes": ["API outage UI was tested by rejecting browser fetch requests; no analytical response/data was mocked.",
                      "Browser errors include Edge runtime/browser log errors and page JavaScript exceptions.",
                      "This is a local rendered smoke check, not a cross-browser or accessibility audit."]
        }
        out = ROOT / "results" / "app" / "browser_verification.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf-8")
        markdown = [
            "# Browser verification",
            "",
            f"Date: {result['verified_at_local']}",
            f"Browser: {result['browser']} via {result['method']}",
            f"Result: {'PASS' if result['all_checks_passed'] else 'FAIL'}",
            f"URL: {result['url']}",
            "",
            "## Routes",
            "",
            "| Route | Result | Rendered heading |",
            "|---|---|---|",
        ]
        markdown.extend(
            f"| {route['route']} | {'PASS' if route['passed'] else 'FAIL'} | {route['actual_heading']} |"
            for route in route_results
        )
        markdown.extend([
            "",
            "## Interaction checks",
            "",
            f"- Category filter changed: {filter_result.get('changed')}; visible rows: {filter_result.get('visible_rows_after_filter', 0)}.",
            f"- Invalid forecast input rendered an error: {bool(invalid_forecast['error_text'])}.",
            f"- Mobile width: {responsive['bodyWidth']}px document / {responsive['viewport']}px viewport.",
            f"- API outage state rendered: {api_outage.get('visible')}; delayed real-data recovery: {loaded_after_delay}.",
            f"- Unexpected browser/runtime errors: {len(errors)}.",
            f"- Screenshot: `{result['screenshot']}`",
            "",
            "The API outage was simulated at the browser fetch boundary; no analytical response or data was mocked.",
        ])
        (out.parent / "browser_verification.md").write_text("\n".join(markdown) + "\n", encoding="utf-8")
        print(json.dumps(result, indent=2, ensure_ascii=True))
        return 0 if result["all_checks_passed"] else 1
    finally:
        if devtools:
            devtools.ws.close()
        browser.terminate()
        try:
            browser.wait(timeout=5)
        except subprocess.TimeoutExpired:
            browser.kill()
            browser.wait(timeout=5)


if __name__ == "__main__":
    raise SystemExit(main())
