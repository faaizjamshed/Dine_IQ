"""Render the human-readable SRS matrix from the audit JSON evidence."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / "results" / "audit"


def cell(value):
    return str(value).replace("|", "\\|").replace("\n", " ")


def main():
    main_matrix = json.loads((AUDIT / "srs_compliance.json").read_text(encoding="utf-8"))
    fr_matrix = json.loads((AUDIT / "functional_requirement_matrix.json").read_text(encoding="utf-8"))
    deliverables = json.loads((AUDIT / "deliverables_matrix.json").read_text(encoding="utf-8"))
    lines = [
        "# DineIQ Analytics — Final Pre-deployment SRS Compliance Audit",
        "",
        f"Audit date: **{main_matrix['audit_date']}**  ",
        f"Official source: `{main_matrix['source_srs']}` (SRS v{main_matrix['source_srs_version']})  ",
        "Scope: repository/evidence inspection plus fresh local API and rendered-browser verification. This is not an acceptance or competition-readiness claim.",
        "",
        "## Status summary",
        "",
        f"The {len(main_matrix['requirements']) + len(main_matrix['nonfunctional_requirements'])} cross-cutting and non-functional criteria in the main evidence matrix are counted as follows: "
        + ", ".join(f"**{count} {status}**" for status, count in main_matrix["status_counts"].items()) + ".",
        "The 66 individual functional requirements are itemized in [functional_requirement_matrix.json](functional_requirement_matrix.json).",
        "The SRS section 1.10/submission deliverables are itemized in [deliverables_matrix.json](deliverables_matrix.json).",
        "Counts are not weighted and are not a completion percentage.",
        "",
        "## Cross-cutting requirements",
        "",
        "| ID | SRS area | Status | Requirement | Evidence and verification | Remaining action |",
        "|---|---|---|---|---|---|",
    ]
    for row in main_matrix["requirements"]:
        paths = ", ".join(f"`{p}`" for p in row.get("paths", []))
        evidence = f"{row['evidence']} Paths: {paths}. Verification: {row['verification']}"
        lines.append("| " + " | ".join(cell(x) for x in (
            row["id"], row["section"], row["status"], row["requirement"], evidence, row["remaining_action"]
        )) + " |")
    lines += [
        "",
        "## Non-functional requirements (SRS 1.7)",
        "",
        "| ID | Status | Requirement | Evidence | Remaining action |",
        "|---|---|---|---|---|",
    ]
    for row in main_matrix["nonfunctional_requirements"]:
        paths = ", ".join(f"`{p}`" for p in row.get("paths", []))
        lines.append("| " + " | ".join(cell(x) for x in (
            row["id"], row["status"], row["requirement"], row["evidence"] + " Paths: " + paths + ". " + row["verification"], row["remaining_action"]
        )) + " |")
    lines += [
        "",
        "## Functional requirements (SRS 1.6, every item i–lxvi)",
        "",
        "| ID | Status | Requirement | Implementation evidence | Test/evidence | Remaining action |",
        "|---|---|---|---|---|---|",
    ]
    for row in fr_matrix["requirements"]:
        paths = ", ".join(f"`{p}`" for p in row.get("paths", []))
        lines.append("| " + " | ".join(cell(x) for x in (
            row["id"], row["status"], row["description"], row["evidence"] + " Paths: " + paths,
            row["test"], row["action"]
        )) + " |")
    lines += [
        "",
        "## Deliverables (SRS 1.10 and final checklist)",
        "",
        "| ID | Status | Deliverable | Evidence | Remaining action |",
        "|---|---|---|---|---|",
    ]
    for row in deliverables["deliverables"]:
        paths = ", ".join(f"`{p}`" for p in row.get("paths", []))
        lines.append("| " + " | ".join(cell(x) for x in (
            row["id"], row["status"], row["name"], row["evidence"] + (" Paths: " + paths if paths else ""), row["action"]
        )) + " |")
    lines += [
        "",
        "## Deployment and repository findings",
        "",
        "- Reproducible local Docker serving is verified with `results/submission/serving-v3`, Waitress, a hash-locked Linux serving dependency wheelhouse, read-only bundle mounting and no-network portable API/model checks. Public hosting, TLS endpoint, load/uptime evidence and external evaluator account provisioning remain outside the local workspace.",
        "- `D:/DineIQ` is not a Git checkout; public GitHub URL and five-day/team commit history are not available to inspect. Local evaluator instructions and submission assets are present.",
        "- See [deployment_readiness.json](deployment_readiness.json) and [repository_hygiene.md](repository_hygiene.md).",
        "- High-risk presentation/evidence findings: " + "; ".join(f"**{item['id']}** {item['finding']}" for item in main_matrix["integrity_findings"]),
        "",
        "## Browser verification",
        "",
        "Historical Edge/CDP browser evidence remains available under `results/app/`. The current fresh serving verification is API/model-focused: the no-network Docker portable verifier passed 10 authenticated integration checks against the relocated `serving-v3` bundle with HDFS disabled. See [portable_verification.json](../submission/portable_verification.json).",
        "",
        "## Canonical evidence policy",
        "",
        "Spark v4 remains the canonical dashboard analytical input and demand ML v1 remains unchanged. Supplemental quality validation, daily forecasts, aligned Python comparison evidence and Gap-1 analytics are versioned outputs. No raw data, Spark v4 outputs or persisted Spark demand model were overwritten.",
        "",
        "## Gap-closure reassessment (2026-09-26)",
        "",
        "Final local remediation update (2026-09-28): strict data-quality validation, daily item/category/location forecasting, aligned Spark/Python comparison, local project/intelligence reports, blog source, presentation, MP4 demo, hash locks, `serving-v3` export and no-network portable verification are complete. Public GitHub, five-day commit history, public deployment URL, public blog/video links, public dataset URL, production uptime/load evidence and real business-impact validation remain outside the completed local claims. The weekly wastage-risk classifier remains a low-precision screening signal; pricing/promotion analysis remains descriptive.",
        "",
    ]
    (AUDIT / "srs_compliance.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
