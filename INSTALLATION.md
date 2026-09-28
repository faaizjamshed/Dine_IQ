# Installation and local run

Run commands from the project root; no drive letter or fixed checkout path is required. Obtain the source folder and its `results/submission/serving-v3` bundle together from the submission package. A public Git URL is not currently available.

## Recommended evaluator path: Docker

Prerequisites: Docker Engine with Compose v2 (Docker Desktop with Linux containers on Windows), internet for the first build, a free local port 5000, and about 8 GB available RAM for Docker. The image uses Python 3.11, Spark 3.5.7 and its supplied Java runtime. Allocate additional disk space for image layers. These resource suggestions are not a measured minimum.

```sh
docker compose -f compose.serving.yml config
docker compose -f compose.serving.yml up --build -d
docker compose -f compose.serving.yml ps
docker compose -f compose.serving.yml logs --tail 80 web
```

Wait for startup/model loading, then visit http://127.0.0.1:5000/api/health. Expected: `status: ok`, `storage_backend: local_bundle`, `bundle_verified: true`, `analytics_tables_loaded: 12`, and `model_loaded: true`. Open http://127.0.0.1:5000 and register a unique analyst account. No shared password is included.

The app runs through Waitress as a non-root container user. The bundle is mounted read-only. SQLite lives in the `serving_state` named volume and survives container restarts. `docker compose -f compose.serving.yml down` stops serving without deleting that volume. Do not add `--volumes` unless you intend to erase local accounts and management data.

For a different host port, change only the left side of `127.0.0.1:5000:5000` in `compose.serving.yml`. For a relocated bundle, change its volume source. Do not edit manifest paths/checksums to hide missing files.

## Bundle accessibility and reproduction

`results/submission/serving-v3/manifest.json` lists all files, SHA-256 hashes, byte lengths, canonical source paths and versions. It contains model files and served data, not merely pointers to the author's HDFS. Checksums detect corruption; the manifest must itself come from a trusted submission source.

With Python 3.11 available, verification needs only the standard library:

```sh
python scripts/app/artifact_bundle.py verify --bundle results/submission/serving-v3
```

If the bundle is absent but the author's canonical HDFS/evidence is available, install the full Python runtime below, start HDFS, then export to a fresh directory:

```sh
python scripts/app/artifact_bundle.py export --bundle results/submission/serving-v3
```

Update the Compose mount accordingly. Export does not train models or change HDFS. It refuses to overwrite an existing directory. If both the bundle and canonical HDFS are absent, obtain the submission bundle; starting empty Hadoop containers cannot recreate saved models. The batch runbook describes new processing separately from reproduction of historical v4 evidence.

## Native Python development and batch processing

The tested host interpreter is Python 3.11.9 with Java 17 and PySpark 3.5.7. `requirements.txt` pins the verified environment, including transitive packages. `requirements-app.txt` is the smaller container serving set; the Dockerfile supplies Spark separately. For Windows Python 3.11, `requirements-windows-py311.lock` is a hash-checked lock generated from `results/submission/dependencies/windows-py311`. For Linux serving dependencies, `requirements-app-linux-py311.lock` is generated from `results/submission/dependencies/linux-py311`. Pip dry-runs with `--require-hashes` passed for both locks on 2026-09-28.

PowerShell:

```powershell
py -3.11 -m venv .venv-eval
.\.venv-eval\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m pip check
$env:JAVA_TOOL_OPTIONS = '-XX:ActiveProcessorCount=2 -XX:CICompilerCount=2'
$env:OPENBLAS_NUM_THREADS = '1'
$env:OMP_NUM_THREADS = '1'
$env:HADOOP_USER_NAME = 'hadoop'
java -version
```

For the local Windows wheelhouse:

```powershell
python -m pip install --require-hashes -r requirements-windows-py311.lock
```

Linux/WSL:

```sh
python3.11 -m venv .venv-eval
. .venv-eval/bin/activate
python -m pip install -r requirements.txt
python -m pip check
export JAVA_TOOL_OPTIONS='-XX:ActiveProcessorCount=2 -XX:CICompilerCount=2'
export OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1 HADOOP_USER_NAME=hadoop
java -version
```

Set `JAVA_HOME` to your actual JDK directory if Java is not on PATH. Remove a stale `SPARK_HOME` if it points to another Spark installation; pip PySpark includes its own distribution. The helper selects the running interpreter for Spark workers.

Native Linux serving with a verified bundle:

```sh
export DINEIQ_ARTIFACT_ROOT="$(pwd)/results/submission/serving-v3"
python -m app.serve
```

Native Windows serving with the verified bundle:

```powershell
$env:DINEIQ_ARTIFACT_ROOT = "$PWD\results\submission\serving-v3"
$env:DINEIQ_PORT = "5000"
python -m app.serve
```

This path reads the 12 verified Parquet tables with PyArrow when Windows Hadoop native helpers are unavailable, and uses a bounded local demand/wastage screening fallback so the dashboard remains usable. `/api/health` reports `analytics_runtime: python-parquet-fallback` and `model_runtime: bounded-local-fallback` in this mode. Docker/Linux remains the verified Spark/HDFS model path for exact persisted-model parity and batch processing. `scripts/app/start_windows.ps1` wraps the same command for a one-click local launch.

## Frontend build

The backend serves `frontend/dist/`; the submission includes this build and Docker copies it into the image. The installed Vite package declares Node `^18.0.0 || >=20.0.0`; use a compatible Node runtime and the included npm lockfile to rebuild. Run from `frontend/`:

```sh
npm ci
npm run build
```

Return to the project root before building the container or launching Python. Node is only needed for rebuilding the frontend, not for running the supplied build. A missing build produces an explicit 503 message instead of a dashboard.

## Troubleshooting

| Symptom | Action |
|---|---|
| Image download fails | Check Docker network/proxy access; rerun the build. A cached image can run offline. |
| Bundle/manifest missing or checksum error | Re-extract a complete trusted bundle; never replace real data with mocks. |
| App exits before serving | Read Compose logs. The WSGI entry point refuses to start with unavailable analytics/models. |
| Port in use | Select another loopback host port. |
| Java gateway or wrong Python worker | Check Java, the activated venv and stale `SPARK_HOME` / `PYSPARK_PYTHON`. |
| HDFS connection fails during batch work | Use `docker compose ps`, NameNode http://127.0.0.1:9870, and the raw-upload steps in the runbook. HDFS is unnecessary for bundle serving. |
| Secure cookie cannot log in over HTTP | Use development mode for localhost; production mode requires HTTPS. |
| Existing version/output error | Choose a new version. Partial outputs are never silently overwritten. |

See [runbook](RUNBOOK.md) for processing/tests and [deployment](DEPLOYMENT.md) for secrets/TLS configuration.
