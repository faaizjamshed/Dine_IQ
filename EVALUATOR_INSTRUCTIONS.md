# Evaluator instructions

The submitted position is **verified core analytics with documented remaining gaps**, not full SRS completion. Read [SUBMISSION_SUMMARY.md](SUBMISSION_SUMMARY.md) and [DATA_QUALITY_VALIDATION.md](DATA_QUALITY_VALIDATION.md) before interpreting metrics.

1. Extract the source and serving bundle together. Follow [INSTALLATION.md](INSTALLATION.md) to start `compose.serving.yml`.
2. Open http://127.0.0.1:5000/api/health. Confirm `ok`, `local_bundle`, 12 loaded aggregate tables and both model readiness through the checks below.
3. Open http://127.0.0.1:5000 and create your own analyst account. Registration creates an analyst, not an administrator. No preset credential is required or published.
4. Review overview, menu profitability/classes, location/channel views, promotions/pricing, forecast and intelligence. Amounts are PKR. Forecast input needs observed lag values; it is a restaurant-hour forecast, not an arbitrary item forecast.
5. Check recommendation evidence, thresholds and wastage warnings. These represent candidate associations and low-precision screening.
6. Inspect the quality report: raw = accepted + quarantined unique records + removed exact copies. The dashboard still serves historical v4; the new strict subset has not replaced its input.

If Docker is unavailable on Windows, set `DINEIQ_ARTIFACT_ROOT` to `results\submission\serving-v3` and run `python -m app.serve` (or `scripts/app/start_windows.ps1`). This portable native path loads verified Parquet through PyArrow and labels its bounded local predictors in `/api/health`; Docker/Linux remains the exact Spark-model path.

On every authenticated screen, the bottom-right **Ask DineIQ** button opens the grounded project guide. Try `Profit formula kya hai?`, an exact menu item such as `Smoky Chinese 1 ki performance batao`, `What pairs well with Smoky Chinese 1?`, or `Project limitations kya hain?`. The guide uses the same loaded evidence as the API and shows source references; it is intentionally not an unrestricted external-chat service.

## Re-run independent portable checks

Build the image, then run the verifier with no network. It copies the bundle to a fresh temporary path, disables the HDFS implementation, loads both models and runs the app integration tests, including prediction and authenticated APIs. No live server or shared user database is required.

PowerShell (from project root):

```powershell
docker build -t dineiq-serving:submission-v1 .
docker run --rm --network none --hostname localhost --mount "type=bind,source=$((Get-Location).Path)\results\submission\serving-v3,target=/bundle,readonly" --mount "type=bind,source=$((Get-Location).Path)\results\submission,target=/evidence" --entrypoint python dineiq-serving:submission-v1 scripts/app/verify_portable.py --bundle /bundle --report /evidence/portable_verification.json
```

Linux/WSL:

```sh
docker run --rm --network none --hostname localhost -v "$PWD/results/submission/serving-v3:/bundle:ro" -v "$PWD/results/submission:/evidence" --entrypoint python dineiq-serving:submission-v1 scripts/app/verify_portable.py --bundle /bundle --report /evidence/portable_verification.json
```

On Linux, make the evidence output directory writable by container UID 10001, or choose a dedicated correctly owned output directory. Do not change the source/bundle to world-writable permissions.

With the full native test environment:

```sh
python -m pytest tests/test_hidden_srs_cases.py tests/test_gap1_analytics.py -q
python -m pytest tests/test_quality_submission.py tests/test_deployment_submission.py -q --tb=short
```

Paths start with `tests/`; the earlier command omitting that directory does not match this workspace layout. Spark quarantine tests require a working Java runtime. Full regression additionally uses canonical HDFS and historical evidence; see [RUNBOOK.md](RUNBOOK.md).

## Administrator evaluation

Use a separate local instance and bootstrap your own administrator via `DINEIQ_BOOTSTRAP_ADMIN_EMAIL` plus a securely entered `DINEIQ_BOOTSTRAP_ADMIN_PASSWORD` or mounted `_FILE`. Do not place a reusable password in documentation or shell history. Remove bootstrap settings after initial provisioning; later startups do not rotate an existing account. Use normal admin management for role changes. See [deployment configuration](DEPLOYMENT.md).

## Evidence to inspect

| Evidence | Purpose |
|---|---|
| `results/submission/verification.json` | Fresh checks and exit codes |
| `results/submission/quality/v2/quality_cleaning.json` | All 11 tables, rule catalog, quarantine paths and read-back counts |
| `results/submission/portable_verification.json` | Relocated bundle, disabled HDFS, model/API verification |
| `results/submission/serving-v3/manifest.json` | Actual model/data inventory and SHA-256 checksums |
| `results/analytics/hidden_cases/hidden_case_harness_v1.json` | Named contradiction cases; not universal hidden-data coverage |
| `results/ml/gap1/verification_20260926/demand_model_comparison.json` | Baseline comparison and weekday caveat |
| `results/submission/aligned-comparison-v1/demand_model_comparison.json` | Feature-equivalent aligned Spark/Python comparison |
| `results/submission/forecast-v1/evaluation.json` | Daily item/category/location frozen-data forecast evidence |
| `results/audit/srs_compliance.md` | Requirement-specific statuses and remaining scope |

Historical browser screenshots and benchmark logs remain historical evidence; a fresh API run must not be described as a new browser or five-million-row benchmark run.
