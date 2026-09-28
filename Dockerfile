FROM apache/spark:3.5.7 AS spark_runtime
FROM python:3.11-slim-bookworm
COPY --from=spark_runtime /opt/java/openjdk /opt/java/openjdk
COPY --from=spark_runtime /opt/spark /opt/spark
ENV JAVA_HOME=/opt/java/openjdk SPARK_HOME=/opt/spark \
    PATH=/opt/java/openjdk/bin:/opt/spark/bin:$PATH \
    PYTHONPATH=/opt/spark/python:/opt/spark/python/lib/py4j-0.10.9.7-src.zip \
    PYSPARK_PYTHON=/usr/local/bin/python PYSPARK_DRIVER_PYTHON=/usr/local/bin/python \
    SPARK_LOCAL_IP=127.0.0.1 SPARK_LOCAL_HOSTNAME=localhost \
    DINEIQ_BIND=0.0.0.0 DINEIQ_PORT=5000 DINEIQ_ARTIFACT_ROOT=/bundle \
    DINEIQ_DATABASE_PATH=/state/operations.sqlite3 \
    JAVA_TOOL_OPTIONS="-XX:ActiveProcessorCount=2 -XX:CICompilerCount=2" \
    OPENBLAS_NUM_THREADS=1 OMP_NUM_THREADS=1
WORKDIR /app
COPY requirements-app.txt requirements-app-linux-py311.lock ./
COPY results/submission/dependencies/linux-py311 ./results/submission/dependencies/linux-py311
RUN python -m pip install --no-cache-dir --require-hashes -r requirements-app-linux-py311.lock \
    && useradd --uid 10001 --create-home dineiq \
    && mkdir /state && chown dineiq:dineiq /state
COPY app ./app
COPY frontend/dist ./frontend/dist
COPY scripts/spark/common.py ./scripts/spark/common.py
COPY scripts/app/verify_portable.py ./scripts/app/verify_portable.py
COPY tests/test_app_integration.py ./tests/test_app_integration.py
USER dineiq
EXPOSE 5000
HEALTHCHECK --interval=30s --start-period=90s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5000/api/health', timeout=4)"
ENTRYPOINT ["python", "-m", "app.serve"]
