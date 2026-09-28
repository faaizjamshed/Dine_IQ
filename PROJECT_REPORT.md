# DineIQ project report

## Problem and solution

DineIQ turns restaurant order, menu, customer, inventory, rating, promotion and wastage records into operational views for a non-technical restaurant user. Spark performs the canonical ingestion and analytics work; the Flask API and React dashboard expose verified results; the grounded DineIQ Guide explains formulas and evidence in simple English or Roman Urdu.

## Data and architecture

The dataset is seeded synthetic data covering 11 related entities. Raw CSVs are validated and cleaned into Parquet through Spark/HDFS. Analytical result tables and model artifacts are exported into a checksum-verified serving bundle. The application keeps operational SQLite records separate from analytical evidence. See [ARCHITECTURE.md](ARCHITECTURE.md) and [DATA_DICTIONARY.md](DATA_DICTIONARY.md).

## Analytics and models

The application includes menu profitability and performance classes, category and restaurant comparisons, customer RFM, basket associations, ratings, inventory and wastage views, pricing/promotion descriptions, and forecast screens. Demand forecasting is verified at restaurant-hour scope with a baseline comparison. Wastage is a low-precision screening signal; recommendations are candidate associations; pricing and promotion outputs are descriptive rather than causal.

## Quality and security

The strict validation pipeline records rule-level outcomes, quarantine paths and accepted/duplicate counts for all 11 tables. The API requires authentication for analytics and operational routes, separates analyst/admin permissions, records audit actions and applies secure session configuration for deployed environments. See [DATA_QUALITY_VALIDATION.md](DATA_QUALITY_VALIDATION.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

## Verification and limitations

The current saved regression has 81 passing tests across 14 checks. The evaluator bundle passes checksum and portable serving verification. Docker/Linux loads the persisted Spark pipelines. Native Windows bundle mode is a dashboard portability fallback using PyArrow and bounded predictors; it is explicitly identified by `/api/health` and is not claimed as Spark model parity. Public hosting, managed TLS/secrets, a public dataset URL and business-impact validation remain external or future work.
