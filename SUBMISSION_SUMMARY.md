# Submission-safe checklist

The supported claim is **verified core analytics with documented remaining gaps**. This checklist closes the requested local submission preparation; it does not claim full SRS completion or public production deployment.

Verification on 2026-09-28: **81/81 tests passed** across 14 submission checks, with no failures, errors or skips; `pip check` and both hash-lock dry-runs passed. The quality catalog lists **233 table-specific rule entries**. The fresh `serving-v3` bundle has **238 files** and passed checksum verification. The no-network Docker portable verifier also passed against `serving-v3`.

| Requested area | Current position | Review |
|---|---|---|
| Hidden SRS contradictions and Gap-1 | Implemented; named cases and analytics regression checks | [Verification](results/submission/verification.json) |
| Data quality | Full executed rule catalog, quarantine policy, all 11 tables' before/after counts, malformed-record fixtures | [Quality catalog](DATA_QUALITY_VALIDATION.md) |
| Operator documentation | Installation, batch execution, architecture, dependencies, evaluator workflow and troubleshooting documented | [Install](INSTALLATION.md), [runbook](RUNBOOK.md), [architecture](ARCHITECTURE.md), [evaluator](EVALUATOR_INSTRUCTIONS.md) |
| Portable local serving | Exported data/models, checksums, Linux container and relocated-bundle/API checks with HDFS disabled; native Windows bundle mode also serves through PyArrow with explicit bounded fallback runtime | [Portable evidence](results/submission/portable_verification.json), [manifest](results/submission/serving-v3/manifest.json), [installation](INSTALLATION.md) |
| Managed secrets / TLS | Configuration and operator instructions supplied; public infrastructure and HTTPS not provisioned or validated | [Deployment boundaries](DEPLOYMENT.md) |
| Forecasting | Verified restaurant-hour forecasting with baseline plus frozen daily item/category/location outlooks; live item-by-location/reconciled production forecasting remains broader than evidence | [Aligned comparison](results/submission/aligned-comparison-v1/demand_model_comparison.json), [daily forecast](results/submission/forecast-v1/evaluation.json) |
| Wastage intelligence | Risk screening only, about 9.1% test precision; not operational-grade production prediction | [Model evidence](results/analytics/gap1/wastage_risk_v3/pipeline.json) |
| Pricing / promotions | Descriptive analysis; not causal or a fully validated decision engine | [Limitations](ASSUMPTIONS_LIMITATIONS.md) |
| Recommendations | Candidate recommendation engine; business impact not validated | [Directional evidence](results/analytics/gap1/v11/directional_basket_recommendations.json) |

Strict validation v2 reconciles **4,148,987 raw = 3,741,941 accepted + 406,371 quarantined + 675 duplicate copies removed**. Rule counts overlap. All persisted accepted/quarantine counts passed read-back. Historical canonical v4 still supplies the app and trained models; these have not been recomputed on the stricter subset.

Start evaluation with `docker compose -f compose.serving.yml up --build -d`, then follow the evaluator guide. Keep `frontend/dist/` and the complete serving bundle with the source package. No preset evaluator password is needed; register a local analyst.

Public deployment, public dataset/GitHub links, production guarantees, a canonical persisted 5M-row dataset, business-impact validation and broader forecast scope remain outside the completed claims. Historical PDF reports, browser captures and older audit matrices are dated evidence; use the current Markdown guides and the dated update in [SRS compliance](results/audit/srs_compliance.md) for this submission.

## DineIQ Guide

The authenticated app includes a persistent **Ask DineIQ** assistant for non-technical evaluators. It answers in simple English or Roman Urdu using reviewed formula definitions and the loaded analytical bundle. It supports project overview, formula explanations, item/category/outlet lookups, item-level basket and wastage drill-downs, rankings, forecasting, data quality, architecture and limitations. It returns source references and links to the relevant dashboard. The implementation is deterministic and has no external model or API-key dependency; it refuses to invent numbers when evidence is unavailable.
