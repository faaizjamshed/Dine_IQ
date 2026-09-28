# Development log

## 2026-09-28 submission hardening

- Audited the source, serving bundle, SRS matrices and operator documentation.
- Added the grounded DineIQ Guide for formula, item, outlet, forecast, quality and limitation questions.
- Added the 3D geometric login presentation and rebuilt the React bundle.
- Fixed native Windows serving when Hadoop `NativeIO` is unavailable: verified Parquet tables now load through PyArrow and bounded local predictors keep dashboard inference available. The health API labels this runtime.
- Added `scripts/app/start_windows.ps1` and direct `python app/backend.py` bundle auto-detection for a clean local launch.
- Added missing submission documents: data access, evidence index, SRS compliance Markdown, project report and intelligence report.
- Updated installation, architecture, evaluator and limitation notes to distinguish Docker/Spark model parity from the native Windows portability path.

## Verification

- Full saved submission verification: **81/81 tests passed**, 14 checks, no failures or skips.
- Chat assistant regression: 9 tests passed.
- Frontend TypeScript/Vite production build passed.
- Native Windows bundle smoke test: `/api/health` returned `ok`, 12/12 tables, PyArrow fallback runtime and bounded predictors; authenticated overview, menu, assistant and demand prediction endpoints returned successfully.

## Known external actions

Publishing a public GitHub repository, public dataset URL, public deployment URL and hosted blog still requires the submission owner’s external accounts. No fabricated links or credentials are included.
