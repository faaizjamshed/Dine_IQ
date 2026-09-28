# DineIQ operator runbook

Run commands from the project root. Keep canonical evidence versions immutable; use a new version directory for experiments.

## Evaluator serving

Recommended local path:

```sh
docker compose -f compose.serving.yml up --build -d
docker compose -f compose.serving.yml ps
```

Check `http://127.0.0.1:5000/api/health` for `status: ok`, 12 loaded tables, a loaded model and `local_bundle`. Stop with `docker compose -f compose.serving.yml down`; do not add `--volumes` unless the local operational database may be removed.

On Windows without Docker, use the verified bundle launcher:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/app/start_windows.ps1
```

The native health response identifies the PyArrow and bounded local fallback runtime. It is a dashboard portability path; Docker/Linux remains the exact persisted Spark model path.

## Batch pipeline

The historical batch path uses Docker-backed HDFS and Spark. Check the service state before running jobs:

```sh
docker compose up -d namenode datanode resourcemanager nodemanager
docker compose ps
```

Follow the versioned script help for generation, ingestion, quality cleaning and analytics. Do not overwrite canonical v4 outputs. The generated source and evidence manifests record their own row counts and paths.

## Verification

```sh
python scripts/app/artifact_bundle.py verify --bundle results/submission/serving-v3
python -m pytest -q
```

The saved submission report at `results/submission/verification.json` is the authoritative dated regression record. A full run currently records 81 passing tests across 14 checks. The portable verifier can be run inside the built image as documented in [EVALUATOR_INSTRUCTIONS.md](EVALUATOR_INSTRUCTIONS.md).

## Troubleshooting

- If the API is degraded, read `/api/health` and the container or terminal log before changing evidence paths.
- If Spark reports `NativeIO$Windows.access0`, use Docker/Linux or the native Windows bundle launcher; do not point the app at an empty HDFS directory.
- If a manifest checksum fails, re-extract the complete trusted bundle.
- If login fails over a shared HTTPS deployment, check the session secret, secure-cookie setting, TLS termination and proxy configuration in [DEPLOYMENT.md](DEPLOYMENT.md).
- If a port is occupied, change the host-side port in Compose or pass `-Port` to `start_windows.ps1`.
