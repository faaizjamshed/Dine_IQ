# DineIQ

DineIQ is a restaurant intelligence project built around synthetic restaurant data for Pakistan. The system combines data generation, Spark-based analytics, machine learning, operational management, and a lightweight web UI to support menu performance review, customer behavior analysis, pricing insights, and operational decision support.

The web app also includes **DineIQ Guide**, an authenticated conversational assistant for non-technical users. It explains project formulas and limitations in simple English or Roman Urdu, answers questions about loaded menu items and outlets, and can drill into item-level basket, location and wastage evidence. It is deliberately grounded in reviewed project logic and the loaded analytics bundle; it does not call an external AI service or invent unavailable figures.

This repository is structured around a real project workflow:
- generate and validate restaurant data
- clean and profile large datasets in Spark
- compute operational and business analytics
- train and compare demand models
- expose insights through a local web app
- guide non-technical users through formulas, products and analytical evidence

## Core project areas

- `app/` — Flask backend and operational APIs
- `frontend/` — web interface for analytics and admin workflows
- `scripts/` — data generation, validation, Spark, and ML pipelines
- `tests/` — regression, security, analytics, and edge-case validation
- `data/` — sample and generated datasets
- `results/` — verification and model evidence outputs

## Quick start

### 1) Set up environment

```bash
python -m venv .venv
. .venv\Scripts\activate
pip install -r requirements.txt
```

### 2) Run the validation suite

```bash
python -m pytest -q
```

### 3) Start the app locally

For the reproducible evaluator path, use Docker:

```bash
docker compose -f compose.serving.yml up --build -d
```

On Windows, a checked-out submission bundle can also be served directly without HDFS:

```powershell
$env:DINEIQ_ARTIFACT_ROOT = "$PWD\results\submission\serving-v3"
python -m app.serve
```

Alternatively run `powershell -ExecutionPolicy Bypass -File scripts/app/start_windows.ps1`. The native Windows path keeps the dashboard available through PyArrow and reports its bounded fallback runtime in `/api/health`; Docker/Linux is the exact Spark-model path. When launched directly on Windows, `python app/backend.py` auto-detects the adjacent `serving-v3` bundle; imported application processes still require an explicit `DINEIQ_ARTIFACT_ROOT` for bundle serving.

For deployment and environment notes, see [INSTALLATION.md](INSTALLATION.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

After signing in, use the **Ask DineIQ** button at the bottom-right of any screen. Example questions include:

- `Profit formula kya hai?`
- `Smoky Chinese 1 ki performance batao`
- `What pairs well with Smoky Chinese 1?`
- `Which items have the highest margin?`
- `Wastage risk samjhao`
- `Project limitations kya hain?`

The assistant API is authenticated: `GET /api/assistant/capabilities` describes its scope and `POST /api/assistant/chat` accepts `{"message": "..."}`. Questions are limited to 800 characters.

## Project documentation

The project docs kept for normal submission use are:
- [INSTALLATION.md](INSTALLATION.md)
- [ARCHITECTURE.md](ARCHITECTURE.md)
- [DATA_DICTIONARY.md](DATA_DICTIONARY.md)
- [DATA_ACCESS.md](DATA_ACCESS.md)
- [DATA_QUALITY_VALIDATION.md](DATA_QUALITY_VALIDATION.md)
- [ASSUMPTIONS_LIMITATIONS.md](ASSUMPTIONS_LIMITATIONS.md)
- [PROJECT_REPORT.md](PROJECT_REPORT.md)
- [RESTAURANT_INTELLIGENCE_REPORT.md](RESTAURANT_INTELLIGENCE_REPORT.md)
- [EVALUATOR_INSTRUCTIONS.md](EVALUATOR_INSTRUCTIONS.md)
- [SUBMISSION_SUMMARY.md](SUBMISSION_SUMMARY.md)
- [PROJECT_REPORT.md](PROJECT_REPORT.md)
- [RESTAURANT_INTELLIGENCE_REPORT.md](RESTAURANT_INTELLIGENCE_REPORT.md)
- [EVIDENCE_INDEX.md](EVIDENCE_INDEX.md)
- [DEVELOPMENT_LOG.md](DEVELOPMENT_LOG.md)
- [SRS compliance report](results/audit/srs_compliance.md)
- [Technical blog](Documentation/TECHNICAL_BLOG.md)

The AI disclosure file remains separate at [AI_USAGE.md](AI_USAGE.md).

## Scope and limitations

This project is designed for a controlled synthetic dataset and research-style analytics workflow. It includes verified local analytics and validation, but it does not claim production-scale deployment, public hosting, or unrestricted external live operations without additional hardening and review.

For the reported constraints and assumptions, see [ASSUMPTIONS_LIMITATIONS.md](ASSUMPTIONS_LIMITATIONS.md).
