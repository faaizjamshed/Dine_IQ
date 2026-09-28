"""Deterministic TEST-02/TEST-03 harness for SRS business contradictions."""
from __future__ import annotations
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "tests" / "fixtures" / "srs_edge_cases.json"
OUT = ROOT / "results" / "analytics" / "hidden_cases" / "hidden_case_harness_v1.json"

def classify(c):
    if c.get("history_days", 999) < 30: return "Insufficient history"
    if c["units"] >= 75 and c["margin_pct"] >= .30: return "Volume Driver"
    if c["units"] < 75 and c["margin_pct"] >= .30: return "Hidden Opportunity"
    if c["margin_pct"] >= .30: return "Profit Driver"
    return "Volume Driver"

def findings(c):
    f = []
    if c["units"] >= 75 and c["margin_pct"] < 0: f.append("high_sales_loss_making")
    if c["units"] < 75 and c["margin_pct"] >= .30: f.append("low_sales_high_margin")
    if c["units"] >= 75 and c["waste_ratio"] > .25: f.append("popular_high_wastage")
    if c["rating"] >= 4.5 and c["margin_pct"] < .20: f.append("high_rating_low_profit")
    if c["rating"] <= 2.5 and c["units"] >= 75: f.append("low_rating_high_sales")
    if c.get("promo_share", 0) >= .75 and c.get("nonpromo_units", 0) <= .25 * max(c.get("promo_units", 0), 1): f.append("promotion_dependent")
    lm = c.get("location_margins", {})
    if lm and max(lm.values()) - min(lm.values()) >= .30: f.append("location_contradiction")
    weekend = c.get("weekend_units", 0); weekday = c.get("weekday_units", 0)
    if weekend + weekday and weekend / (weekend + weekday) >= .75: f.append("weekend_concentration")
    if c.get("peak_month_share", 0) >= .60: f.append("seasonal_menu")
    if c.get("history_days", 999) < 30: f.append("new_item_insufficient_history")
    p = abs(c.get("price_change_pct", 0)); u = abs(c.get("unit_change_pct", 0))
    if p >= .10 and u / p >= 1.0: f.append("high_price_sensitivity")
    if c.get("recent_rating", 0) - c.get("baseline_rating", 0) >= 1.0: f.append("rating_spike")
    if c.get("baseline_units", 0) > 0 and c.get("recent_units", 0) >= 2 * c["baseline_units"]: f.append("sales_spike")
    if c.get("recency_increase_days", 0) >= 30 and c.get("frequency_change", 0) <= -1 and c.get("monetary_change_pct", 0) <= -.25: f.append("churn_risk")
    if c.get("spark_label") != c.get("python_label") and c.get("spark_label") is not None: f.append("spark_python_disagreement")
    return f

def run_harness(fixture_path=FIXTURE):
    cases = json.loads(Path(fixture_path).read_text(encoding="utf-8"))
    results = []
    for c in cases:
        actual = sorted(findings(c)); expected = sorted(c["expected_findings"])
        cls = classify(c)
        results.append({"id": c["id"], "expected_class": c["expected_class"], "actual_class": cls,
                        "expected_findings": expected, "actual_findings": actual,
                        "passed": cls == c["expected_class"] and actual == expected})
    return {"version":"v1", "fixture_count":len(cases), "passed_count":sum(r["passed"] for r in results),
            "all_passed":all(r["passed"] for r in results), "cases":results}

def write_evidence():
    evidence = run_harness(); OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    md = OUT.with_suffix(".md")
    lines = ["# Hidden SRS Case Harness v1", "", f"Fixtures: {evidence['fixture_count']}", f"Passed: {evidence['passed_count']}", f"All passed: {evidence['all_passed']}", "", "| Case | Result | Findings |", "|---|---|---|"]
    lines += [f"| {r['id']} | {'PASS' if r['passed'] else 'FAIL'} | {', '.join(r['actual_findings'])} |" for r in evidence["cases"]]
    md.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return evidence

if __name__ == "__main__":
    print(json.dumps(write_evidence(), indent=2))
