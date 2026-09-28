# Data access and reproducibility

DineIQ uses a seeded synthetic restaurant dataset. The repository contains the small sample files under `data/sample/`, the generated working CSVs under `data/generated/`, and a checksum-verified evaluator bundle under `results/submission/serving-v3/`.

## What an evaluator can use immediately

- `data/sample/` contains one representative CSV for each of the 11 source entities.
- `data/generated/` contains the frozen generated source tables used for the canonical evidence.
- `results/submission/serving-v3/` contains the served Parquet aggregates, evidence and model artifacts; `manifest.json` records SHA-256 hashes, byte lengths and canonical provenance.
- `results/submission/quality/v2/` contains accepted and quarantined strict-validation outputs.

The application does not require HDFS when the serving bundle is used. Follow [INSTALLATION.md](INSTALLATION.md) for Docker/Linux or native Windows bundle serving. The full source dataset is not hosted at a public URL in this submission; no public link is implied by the local paths.

## Reproduce the synthetic source

Run from the project root with the locked Python environment:

```powershell
python scripts/data_generation/generate_dineq_dataset.py --help
python scripts/data_generation/validate_generated_dataset.py
```

The generator uses a fixed seed and deliberately injects controlled null, duplicate, invalid-value and formula-deviation cases. Do not overwrite the frozen `results/` evidence while reproducing; choose a new output/version directory for an experiment.

## Verify the supplied bundle

```powershell
python scripts/app/artifact_bundle.py verify --bundle results/submission/serving-v3
```

The bundle is the evaluator access path. It is not a replacement for the canonical HDFS batch history and it does not expose a public dataset URL.
