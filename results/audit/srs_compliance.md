# DineIQ SRS compliance report

Audit date: **2026-09-28**  
Source: `official_srs_extracted.txt` and the machine-readable [srs_compliance.json](srs_compliance.json)

This report is an evidence index for the submission. A requirement is marked complete only where an execution result, test, or persisted artifact supports the claim. The full requirement-level records, paths, verification text and remaining actions are in the JSON report.

## Current status

| Scope | Complete | Partial | Missing | Total |
|---|---:|---:|---:|---:|
| Cross-cutting SRS audit | 22 | 22 | 2 | 46 |
| Functional requirement matrix | See [functional matrix](functional_requirement_matrix.json) | | | |
| Submission deliverables matrix | See [deliverables matrix](deliverables_matrix.json) | | | |

The core product is implemented and regression-tested. The remaining status reflects evidence boundaries and submission packaging, rather than an empty or non-working application.

## Verified areas

- Synthetic related restaurant data, controlled dirty records, Spark ingestion and Parquet processing.
- Menu profitability, category and restaurant performance, customer RFM, basket analysis and exports.
- Authenticated Flask APIs, role-based operations, SQLite audit records and the React dashboard.
- Restaurant-hour demand forecasting with a baseline comparison and persisted model evidence.
- Wastage screening, directional basket recommendations and descriptive pricing/promotion analysis.
- Grounded DineIQ Guide for formula explanations, item/outlet questions, evidence links and limitations.
- Strict validation v2 with accepted/quarantine/duplicate reconciliation and malformed-record fixtures.
- Checksum-verified `serving-v3` bundle and no-network portable serving verification.

## Submission boundaries to disclose

- The dataset is synthetic; public hosting and an externally hosted full-data URL are not supplied.
- Docker/Linux loads the persisted Spark pipelines. Native Windows bundle serving uses PyArrow and bounded local predictors when Hadoop native helpers are unavailable; `/api/health` labels that runtime explicitly.
- Forecast evidence is strongest at restaurant-hour scope. Broader item/category/location production forecasting remains a wider scope than the current verified model evidence.
- Wastage is a low-precision screening signal. Pricing and promotion results are descriptive, and recommendations are candidate associations without business-impact or causal uplift validation.
- Public deployment, managed TLS/secrets, uptime guarantees and canonical persisted five-million-row HDFS validation remain outside the completed claims.

## Verification pointers

- [Submission verification](../submission/verification.json) — current full regression and check exit codes.
- [Portable verification](../submission/portable_verification.json) — relocated bundle and HDFS-disabled serving checks.
- [Quality validation catalog](../../DATA_QUALITY_VALIDATION.md) — executed rules, quarantine policy and before/after counts.
- [Installation](../../INSTALLATION.md) — Docker and native Windows startup paths.
- [Assumptions and limitations](../../ASSUMPTIONS_LIMITATIONS.md) — model and deployment boundaries.
