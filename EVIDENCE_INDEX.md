# Evidence index

Use this page to locate the evidence behind the submission claims.

| Area | Evidence | Purpose |
|---|---|---|
| Full regression | `results/submission/verification.json` | 14 checks, current 81/81 test result and exit codes |
| Portable serving | `results/submission/portable_verification.json` | Relocated bundle, HDFS-disabled API/model checks |
| Bundle inventory | `results/submission/serving-v3/manifest.json` | Files, hashes, source paths and versions |
| Spark ingestion | `results/spark/ingestion.json` | 11 source schemas and row counts |
| Quality cleaning | `results/spark/quality_cleaning.json` | Canonical cleaning evidence |
| Strict validation | `results/submission/quality/v2/quality_cleaning.json` | Rule catalog, accepted/quarantine counts and read-back checks |
| Analytics | `results/spark/analytics.json` | Canonical v4 output paths and aggregate counts |
| Demand models | `results/submission/aligned-comparison-v1/demand_model_comparison.json` | Baseline, Spark/Python comparison and semantic caveat |
| Wastage | `results/analytics/gap1/wastage_risk_v3/pipeline.json` | Screening metrics and model reload evidence |
| Recommendations | `results/analytics/gap1/v11/directional_basket_recommendations.json` | Candidate rules and thresholds |
| Browser/API | `results/app/phase2/browser_verification.json` | Historical authenticated route and responsive checks |
| SRS audit | `results/audit/srs_compliance.json` and `results/audit/srs_compliance.md` | Requirement-level status and remaining action |

The evidence is dated and scoped. Historical browser captures and benchmark logs must not be described as a new run. Read [ASSUMPTIONS_LIMITATIONS.md](ASSUMPTIONS_LIMITATIONS.md) before turning any metric into a production claim.
