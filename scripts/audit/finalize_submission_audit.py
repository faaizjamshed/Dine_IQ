"""Synchronize final audit matrices with the latest submission evidence."""
from __future__ import annotations

import json
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / "results" / "audit"
DATE = "2026-09-28"


def load(name: str) -> dict:
    return json.loads((AUDIT / name).read_text(encoding="utf-8"))


def save(name: str, data: dict) -> None:
    (AUDIT / name).write_text(json.dumps(data, indent=2), encoding="utf-8")


def rows_by_id(data: dict, key: str) -> dict[str, dict]:
    return {row["id"]: row for row in data[key]}


def count_status(rows: list[dict]) -> dict[str, int]:
    counter = Counter(row["status"] for row in rows)
    order = ["COMPLETE", "PARTIAL", "MISSING", "DEFERRED_BY_USER", "NOT_APPLICABLE", "NOT_APPLICABLE_CURRENT_APP"]
    return {status: counter[status] for status in order if status in counter or any(row["status"] == status for row in rows)}


def update_main() -> None:
    data = load("srs_compliance.json")
    data["audit_date"] = DATE
    rows = rows_by_id(data, "requirements")
    updates = {
        "DQ-01": ("COMPLETE", "Strict submission-quality v2 validation provides a 233-entry table-specific rule catalog, quarantine policy, malformed/invalid/reference/duplicate handling, before/after counts and read-back checks across all 11 source tables.", ["DATA_QUALITY_VALIDATION.md", "results/submission/quality/v2/quality_cleaning.json", "tests/test_quality_submission.py"], "Maintain this catalog for any regenerated dataset; canonical v4 dashboards are still historical."),
        "ANALYTICS-05": ("COMPLETE", "Demand evidence now covers restaurant-hour Spark forecasting with a seasonal baseline plus frozen daily item/category/location forecasts for 7, 14 and 28 days. Peak-hour/monthly seasonality analytics are present.", ["scripts/ml/daily_forecast.py", "results/submission/forecast-v1/evaluation.json", "app/daily_forecasts.py", "frontend/src/features/forecast/DailyOutlook.tsx"], "Future production work: live current-data ingestion, reconciled hierarchy and item-by-location forecasting."),
        "ML-03": ("COMPLETE", "Aligned comparison verifies 55,200 common held-out rows and 500 sampled unseen cases after matching Sunday-zero weekday semantics; 100% of sampled cases are within one order.", ["scripts/ml/python_demand.py", "scripts/ml/demand_baseline_comparison.py", "results/submission/aligned-python-v1/pipeline.json", "results/submission/aligned-comparison-v1/demand_model_comparison.json"], "Treat this as technical agreement evidence, not business-impact validation."),
        "TEST-03": ("COMPLETE", "Hidden contradiction fixtures and harness cover high-selling loss-making, low-selling high-margin, high-demand high-waste, promotion trap and other named SRS edge cases; focused tests pass.", ["tests/test_hidden_srs_cases.py", "tests/fixtures/srs_edge_cases.json", "scripts/analytics/hidden_case_harness.py", "results/analytics/hidden_cases/hidden_case_harness_v1.json"], "This is named-case readiness, not proof against every possible hidden dataset."),
        "DOC-02": ("PARTIAL", "Project report, restaurant intelligence report, local MP4 demo, editable presentation and 2,000+ word blog source now exist locally. Public blog/demo/project URLs are not configured.", ["PROJECT_REPORT.md", "RESTAURANT_INTELLIGENCE_REPORT.md", "Documentation/TECHNICAL_BLOG.md", "Documentation/submission_media/DineIQ_Demo.mp4", "Documentation/submission_media/DineIQ_Submission_Presentation.pptx"], "Publish externally if the submission portal requires public URLs."),
        "DOC-03": ("COMPLETE", "Spark/Python source, model generation/load instructions, aligned 500-case comparison report, hash-locked dependency artifacts and evaluator instructions are present.", ["RUNBOOK.md", "INSTALLATION.md", "requirements-windows-py311.lock", "requirements-app-linux-py311.lock", "results/submission/aligned-comparison-v1/demand_model_comparison.json"], "Keep locks and instructions synchronized with future dependency changes."),
        "DEPLOY-01": ("PARTIAL", "Reproducible local Docker serving path is verified with a hash-locked Linux dependency wheelhouse, Waitress, read-only serving-v3 bundle and no-network portable verification. Public URL, TLS endpoint and uptime evidence remain absent.", ["Dockerfile", "compose.serving.yml", "requirements-app-linux-py311.lock", "results/submission/serving-v3/manifest.json", "results/submission/portable_verification.json", "DEPLOYMENT.md"], "Provision public hosting/TLS and collect uptime/load evidence only if required by the final venue."),
    }
    for ident, (status, evidence, paths, action) in updates.items():
        rows[ident].update(status=status, evidence=evidence, paths=paths, verification=evidence, remaining_action=action)
    all_rows = data["requirements"] + data["nonfunctional_requirements"]
    data["status_counts"] = count_status(all_rows)
    save("srs_compliance.json", data)


def update_functional() -> None:
    data = load("functional_requirement_matrix.json")
    data["audit_date"] = DATE
    rows = rows_by_id(data, "requirements")
    updates = {
        "FR-xiv": ("COMPLETE", "Submission-quality v2 catalog identifies missing, duplicate, inconsistent, invalid, anomalous and referential problems.", ["DATA_QUALITY_VALIDATION.md", "results/submission/quality/v2/quality_cleaning.json"], "Passed quality submission tests and read-back checks."),
        "FR-xv": ("COMPLETE", "Accepted/quarantine/deduplicate/repair rules are documented and persisted with before/after accounting.", ["DATA_QUALITY_VALIDATION.md", "scripts/spark/profile_clean.py"], "Malformed and invalid-case coverage is implemented."),
        "FR-xix": ("COMPLETE", "Spark and ML feature generation exists for analytics, demand forecasting, wastage risk, RFM and baskets.", ["scripts/analytics/spark_features.py", "scripts/ml/spark_demand.py", "scripts/ml/daily_forecast.py"], "Fresh forecast and app integration checks passed."),
        "FR-xxviii": ("COMPLETE", "Future demand is predicted at restaurant-hour scope and frozen item/category/location daily scopes.", ["results/ml/spark/pipeline.json", "results/submission/forecast-v1/evaluation.json", "app/daily_forecasts.py"], "Live/reconciled production forecasting remains future work."),
        "FR-xliv": ("COMPLETE", "Spark and Python predictions are compared on an aligned common held-out panel.", ["results/submission/aligned-comparison-v1/demand_model_comparison.json"], "500 sampled cases and 55,200 verified common rows."),
        "FR-xlv": ("COMPLETE", "Agreement/disagreement rates and major differences are reported.", ["results/submission/aligned-comparison-v1/demand_model_comparison.json", "results/submission/aligned-comparison-v1/demand_model_comparison_cases.csv"], "100% within one order on sampled cases."),
        "FR-lvi": ("COMPLETE", "Dashboard/API expose historical demand, restaurant-hour prediction and frozen daily item/category/location outlook.", ["frontend/src/features/forecast/DailyOutlook.tsx", "app/daily_forecasts.py", "tests/test_app_integration.py"], "App integration tests verify the authenticated route."),
    }
    for ident, (status, evidence, paths, test) in updates.items():
        rows[ident].update(status=status, evidence=evidence, paths=paths, test=test, action="Maintain evidence if the model/data snapshot changes.")
    data["status_counts"] = count_status(data["requirements"])
    save("functional_requirement_matrix.json", data)


def update_deliverables() -> None:
    data = load("deliverables_matrix.json")
    data["audit_date"] = DATE
    rows = rows_by_id(data, "deliverables")
    updates = {
        "DEL-01": ("COMPLETE", "Project report with business problem, scope, architecture diagram, analytics, ML, tests, security and limitations exists.", ["PROJECT_REPORT.md", "ARCHITECTURE.md", "ASSUMPTIONS_LIMITATIONS.md"], "Keep reports aligned with future code/evidence."),
        "DEL-05": ("COMPLETE", "Pinned requirements plus hash-checked Windows full-stack and Linux serving locks are present; dry-runs passed.", ["requirements.txt", "requirements-app.txt", "requirements-windows-py311.lock", "requirements-app-linux-py311.lock"], "Regenerate locks if dependencies change."),
        "DEL-08": ("PARTIAL", "Local data access, generation and serving-bundle instructions are documented. Public dataset URL is still absent.", ["DATA_ACCESS.md", "data/generated/", "results/submission/serving-v3/manifest.json"], "Publish full data externally if required."),
        "DEL-11": ("COMPLETE", "Spark ingestion, schemas, quality, cleaning, joins, analytics, partitioned Parquet and bundle export evidence are documented.", ["RUNBOOK.md", "DATA_QUALITY_VALIDATION.md", "scripts/spark/", "results/spark/", "results/submission/serving-v3/manifest.json"], "Use fresh versions for reruns."),
        "DEL-12": ("COMPLETE", "Spark MLlib model evidence, persisted model files, version metadata, sample predictions and portable bundle access are present.", ["results/ml/spark/pipeline.json", "results/ml/spark/reload_smoke.json", "results/submission/serving-v3/manifest.json"], "No production monitoring claim."),
        "DEL-13": ("COMPLETE", "Python model scripts, evidence, aligned retrained artifact and dependency instructions are present.", ["scripts/ml/python_demand.py", "results/submission/aligned-python-v1/pipeline.json", "requirements-windows-py311.lock"], "Historical model remains separate from aligned evidence artifact."),
        "DEL-14": ("COMPLETE", "Aligned dual-pipeline report includes 500 unseen cases, common-panel verification and agreement/disagreement fields.", ["results/submission/aligned-comparison-v1/demand_model_comparison.json", "results/submission/aligned-comparison-v1/demand_model_comparison_cases.csv"], "Agreement is technical consistency evidence, not business impact."),
        "DEL-15": ("COMPLETE", "Restaurant intelligence report exists with menu, customer, basket, forecast, wastage, pricing, promotion, anomaly and recommendation sections.", ["RESTAURANT_INTELLIGENCE_REPORT.md"], "Publish/format externally if required."),
        "DEL-16": ("COMPLETE", "Functional/integration/domain/difficult-case evidence includes full regression, hidden-case harness, quality tests, daily forecast tests and portable integration.", ["results/submission/verification.json", "tests/test_hidden_srs_cases.py", "tests/test_daily_forecast.py", "results/submission/portable_verification.json"], "Named hidden cases do not prove universal hidden-data coverage."),
        "DEL-20": ("COMPLETE", "Evaluator access uses local registration for analyst accounts and documented admin bootstrap variables; no shared password is published.", ["EVALUATOR_INSTRUCTIONS.md", "DEPLOYMENT.md"], "For a hosted deployment, provision evaluator accounts through the selected platform."),
        "DEL-23": ("PARTIAL", "Reproducible local Docker path is complete and verified. Public deployment URL is not configured.", ["compose.serving.yml", "Dockerfile", "results/submission/portable_verification.json"], "Needs external hosting account and TLS setup."),
        "DEL-24": ("COMPLETE", "Local MP4 demo artifact generated from verified evidence slides.", ["Documentation/submission_media/DineIQ_Demo.mp4"], "Publish externally if the portal requires a public video link."),
        "DEL-25": ("PARTIAL", "Technical blog source is 2,000+ words and local; public blog URL/project link is absent.", ["Documentation/TECHNICAL_BLOG.md"], "Publish the blog and add the URL."),
        "DEL-26": ("COMPLETE", "Editable presentation generated locally.", ["Documentation/submission_media/DineIQ_Submission_Presentation.pptx"], "Export to PDF if required by the portal."),
        "DEL-30": ("PARTIAL", "Local/reproducible data access is documented, but no public full-dataset URL exists.", ["DATA_ACCESS.md"], "Publish externally if required."),
    }
    for ident, (status, evidence, paths, action) in updates.items():
        rows[ident].update(status=status, evidence=evidence, paths=paths, action=action)
    data["status_counts"] = count_status(data["deliverables"])
    save("deliverables_matrix.json", data)


def main() -> None:
    update_main()
    update_functional()
    update_deliverables()
    print("updated final audit matrices")


if __name__ == "__main__":
    main()
