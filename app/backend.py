"""Flask API serving canonical DineIQ v4 outputs and the persisted Spark model."""
from __future__ import annotations

import json
import math
import os
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

# Keep both `python -m app.backend` and the documented direct
# `python app/backend.py` launch working from the project root.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from flask import Flask, jsonify, request, send_from_directory, session
from app.what_if import simulate as simulate_what_if
from app.operational_store import OperationalStore
from app.artifacts import ArtifactBundle
from app.chat_assistant import DineIQAssistant
from app.security_config import configure_security

_configured_artifact_root = os.environ.get("DINEIQ_ARTIFACT_ROOT")
_portable_default = ROOT / "results" / "submission" / "serving-v3"
# A direct Windows launch should be useful out of the box when the submission
# bundle is beside the source. Imported application/test processes keep the
# explicit HDFS default unless DINEIQ_ARTIFACT_ROOT is set.
ARTIFACT_ROOT = _configured_artifact_root or (
    str(_portable_default) if os.name == "nt" and __name__ == "__main__" and _portable_default.is_dir() else None
)
EVIDENCE_ROOT = Path(ARTIFACT_ROOT).resolve() / "evidence" if ARTIFACT_ROOT else ROOT
STATIC = ROOT / "frontend" / "dist"
ANALYTICS_EVIDENCE = EVIDENCE_ROOT / "results" / "spark" / "analytics.json"
QUALITY_EVIDENCE = EVIDENCE_ROOT / "results" / "spark" / "quality_cleaning.json"
INGESTION_EVIDENCE = EVIDENCE_ROOT / "results" / "spark" / "ingestion.json"
GENERATION_EVIDENCE = EVIDENCE_ROOT / "results" / "generation" / "generation_summary_full.json"
COMPARE_EVIDENCE = EVIDENCE_ROOT / "results" / "comparison" / "spark_vs_python.json"
ML_SPARK_EVIDENCE = EVIDENCE_ROOT / "results" / "ml" / "spark" / "pipeline.json"
ML_PYTHON_EVIDENCE = EVIDENCE_ROOT / "results" / "ml" / "python" / "pipeline.json"
GAP1_EVIDENCE = EVIDENCE_ROOT / "results" / "analytics" / "gap1" / "v6" / "spark_gap1.json"
GAP1_RISK_EVIDENCE = EVIDENCE_ROOT / "results" / "analytics" / "gap1" / "wastage_risk_v3" / "pipeline.json"
DEMAND_COMPARISON_EVIDENCE = EVIDENCE_ROOT / "results" / "submission" / "aligned-comparison-v1" / "demand_model_comparison.json"
DIRECTIONAL_BASKET_EVIDENCE = EVIDENCE_ROOT / "results" / "analytics" / "gap1" / "v11" / "directional_basket_recommendations.json"

ANALYSIS_NAMES = {
    "menu": "menu_item_performance",
    "categories": "category_performance",
    "restaurants": "restaurant_performance",
    "channels": "channel_performance",
    "promotions": "promotion_effectiveness",
    "monthly": "monthly_demand",
    "peak_hours": "weekday_peak_hour",
    "segments": "customer_segment_behavior",
    "ratings": "restaurant_ratings",
    "wastage": "wastage_by_reason",
    "pricing": "pricing_changes",
    "inventory": "inventory_status",
}


def _read_json(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


class _PortableDemandFallback:
    """Small offline serving predictor used only when Windows cannot load Spark JNI."""

    def predict(self, features: dict[str, Any]) -> float:
        lags = [float(features.get(key, 0.0)) for key in ("lag_1h", "lag_24h", "lag_168h")]
        hour = float(features.get("hour_of_day", 0.0))
        # A bounded lag blend keeps the local dashboard usable while clearly
        # remaining separate from the verified Spark model used in Docker/HDFS.
        seasonal = 1.0 + (0.12 if 11 <= hour <= 14 or 18 <= hour <= 21 else 0.0)
        return max(0.0, round(sum(lags) / 3.0 * seasonal, 6))


class _PortableWastageFallback:
    """Deterministic local screening estimate; never used for model evidence."""

    def probability(self, features: dict[str, Any]) -> float:
        waste = float(features.get("waste_cost_lag_1w", 0.0))
        baseline = max(float(features.get("waste_cost_mean_prev4w", 0.0)), 1.0)
        demand = float(features.get("demand_units_lag_1w", 0.0))
        demand_base = max(float(features.get("demand_mean_prev4w", 0.0)), 1.0)
        signal = (waste / baseline - 1.0) + max(0.0, 1.0 - demand / demand_base)
        return round(1.0 / (1.0 + math.exp(-max(-8.0, min(8.0, signal)))), 6)


class AnalyticsService:
    """Load small, precomputed v4 result tables once and retain them in memory."""

    def __init__(self) -> None:
        self.started_at = datetime.now(timezone.utc).isoformat()
        self.load_seconds = 0.0
        self.load_error: str | None = None
        self.spark = None
        self.model = None
        self.model_lock = threading.Lock()
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.analytics_evidence: dict[str, Any] = {}
        self.quality: dict[str, Any] = {}
        self.ingestion: dict[str, Any] = {}
        self.generation: dict[str, Any] = {}
        self.comparison: dict[str, Any] = {}
        self.ml_spark: dict[str, Any] = {}
        self.ml_python: dict[str, Any] = {}
        self.gap1_evidence: dict[str, Any] = {}
        self.gap1_tables: dict[str, list[dict[str, Any]]] = {}
        self.wastage_risk_evidence: dict[str, Any] = {}
        self.wastage_risk_model = None
        self.wastage_risk_predictions: list[dict[str, Any]] = []
        self.demand_comparison: dict[str, Any] = {}
        self.directional_basket_evidence: dict[str, Any] = {}
        self.local_python_fallback = False
        self.model_path = "hdfs://localhost:9000/dineq/models/v1/selected_demand_model"
        self.bundle = None
        self.storage_backend = "local_bundle" if ARTIFACT_ROOT else "hdfs"

        began = time.perf_counter()
        try:
            self._load()
        except Exception as exc:  # service remains alive in a truthful degraded state
            self.load_error = f"{type(exc).__name__}: {exc}"
        finally:
            self.load_seconds = round(time.perf_counter() - began, 3)

    def _load(self) -> None:
        if ARTIFACT_ROOT:
            self.bundle = ArtifactBundle(ARTIFACT_ROOT)
        resolve = self.bundle.resolve if self.bundle else lambda path: path
        for path in (ANALYTICS_EVIDENCE, QUALITY_EVIDENCE, INGESTION_EVIDENCE,
                     GENERATION_EVIDENCE, COMPARE_EVIDENCE, ML_SPARK_EVIDENCE,
                     ML_PYTHON_EVIDENCE, GAP1_EVIDENCE, GAP1_RISK_EVIDENCE,
                     DEMAND_COMPARISON_EVIDENCE, DIRECTIONAL_BASKET_EVIDENCE):
            if not path.is_file():
                raise FileNotFoundError(f"Required evidence file is missing: {path}")
        self.analytics_evidence = _read_json(ANALYTICS_EVIDENCE)
        self.quality = _read_json(QUALITY_EVIDENCE)
        self.ingestion = _read_json(INGESTION_EVIDENCE)
        self.generation = _read_json(GENERATION_EVIDENCE)
        self.comparison = _read_json(COMPARE_EVIDENCE)
        self.ml_spark = _read_json(ML_SPARK_EVIDENCE)
        self.ml_python = _read_json(ML_PYTHON_EVIDENCE)
        self.gap1_evidence = _read_json(GAP1_EVIDENCE)
        self.wastage_risk_evidence = _read_json(GAP1_RISK_EVIDENCE)
        self.demand_comparison = _read_json(DEMAND_COMPARISON_EVIDENCE)
        self.directional_basket_evidence = _read_json(DIRECTIONAL_BASKET_EVIDENCE)

        expected_root = "hdfs://localhost:9000/dineq/results/v4"
        if self.analytics_evidence.get("output_root") != expected_root:
            raise RuntimeError("Analytics evidence does not point to canonical results/v4")
        if self.ml_spark.get("model_path") != self.model_path:
            raise RuntimeError("ML evidence model path does not match the canonical model")

        os.environ.setdefault("HADOOP_USER_NAME", "hadoop")
        python_executable = str(Path(sys.executable or "python").resolve()) if sys.executable else "python"
        python_dir = str(Path(python_executable).resolve().parent)
        os.environ["PYSPARK_PYTHON"] = python_executable
        os.environ["PYSPARK_DRIVER_PYTHON"] = python_executable
        os.environ["PATH"] = python_dir + os.pathsep + os.environ.get("PATH", "")
        spark_scripts = str(ROOT / "scripts" / "spark")
        if spark_scripts not in sys.path:
            sys.path.insert(0, spark_scripts)
        from common import spark as create_spark
        try:
            self.spark = create_spark("DineIQ-Analytics-Application", filesystem="file:///" if self.bundle else None)
            self.spark.sparkContext.setLogLevel("ERROR")
        except Exception:
            if not self.bundle or os.name != "nt":
                raise
            # Native Hadoop on Windows needs winutils.exe. A verified bundle
            # can still serve Parquet facts through PyArrow; Docker/HDFS keeps
            # using the real Spark model path.
            import pyarrow  # noqa: F401
            self.spark = None
            self.local_python_fallback = True

        for public_name, result_name in ANALYSIS_NAMES.items():
            meta = self.analytics_evidence["outputs"][result_name]
            path = meta["path"]
            if not path.startswith(expected_root + "/"):
                raise RuntimeError(f"Refusing noncanonical analytics path: {path}")
            rows = self._read_rows(resolve(path))
            if len(rows) != meta["rows"]:
                raise RuntimeError(f"{result_name}: loaded {len(rows)} rows; evidence declares {meta['rows']}")
            self.tables[public_name] = rows
        self.tables["monthly"].sort(key=lambda row: row["order_month"])

        if self.local_python_fallback:
            self.model = _PortableDemandFallback()
        else:
            from pyspark.ml import PipelineModel
            self.model = PipelineModel.load(resolve(self.model_path))
        supplemental_root = "hdfs://localhost:9000/dineq/results/gap1/v6/"
        if self.gap1_evidence.get("hdfs_output_root") != supplemental_root[:-1]:
            raise RuntimeError("Gap-1 analytics evidence path does not match the verified v6 output.")
        for name, metadata in self.gap1_evidence["outputs"].items():
            path = metadata.get("path", "")
            if not path.startswith(supplemental_root):
                raise RuntimeError(f"Refusing non-versioned gap analytics path: {path}")
            self.gap1_tables[name] = self._read_rows(resolve(path))
            if len(self.gap1_tables[name]) != metadata["rows"]:
                raise RuntimeError(f"Gap-1 {name} row count differs from evidence.")
        basket_meta = self.directional_basket_evidence
        basket_path = basket_meta["output"]
        if basket_path != "hdfs://localhost:9000/dineq/results/gap1/v11/directional_basket_recommendations":
            raise RuntimeError("Directional basket output path differs from verified evidence.")
        self.gap1_tables["directional_basket_recommendations"] = self._read_rows(resolve(basket_path))
        if len(self.gap1_tables["directional_basket_recommendations"]) != basket_meta["qualifying_directional_recommendations"]:
            raise RuntimeError("Directional basket output row count differs from its evidence manifest.")
        risk_model_path = self.wastage_risk_evidence["model_path"]
        if risk_model_path != "hdfs://localhost:9000/dineq/models/gap1/v3/wastage_risk":
            raise RuntimeError("Wastage-risk model path differs from verified v3 evidence.")
        if self.local_python_fallback:
            self.wastage_risk_model = _PortableWastageFallback()
        else:
            from pyspark.ml import PipelineModel
            self.wastage_risk_model = PipelineModel.load(resolve(risk_model_path))
        risk_prediction_path = self.wastage_risk_evidence["test_prediction_path"]
        self.wastage_risk_predictions = self._read_rows(resolve(risk_prediction_path))[:500]

    def _read_rows(self, source: str) -> list[dict[str, Any]]:
        if self.spark is not None:
            return [json.loads(line) for line in self.spark.read.parquet(source).toJSON().collect()]
        parsed = urlparse(source)
        if parsed.scheme == "file":
            raw_path = unquote(parsed.path)
            if len(raw_path) >= 3 and raw_path[0] == "/" and raw_path[2] == ":":
                raw_path = raw_path[1:]
            local_path = Path(raw_path)
        else:
            local_path = Path(source)
        import pyarrow.parquet as parquet
        return parquet.read_table(local_path).to_pylist()

    @property
    def ready(self) -> bool:
        return self.load_error is None and self.model is not None and self.wastage_risk_model is not None and len(self.tables) == len(ANALYSIS_NAMES) and len(self.gap1_tables) == 12

    def health(self) -> dict[str, Any]:
        return {
            "status": "ok" if self.ready else "degraded",
            "storage_backend": self.storage_backend,
            "bundle_verified": self.bundle is not None,
            "canonical_version": "v4",
            "data_window": {"start": self.tables["monthly"][0]["order_month"], "end": self.tables["monthly"][-1]["order_month"]} if self.tables.get("monthly") else None,
            "analytics_source": self.analytics_evidence.get("output_root") if self.analytics_evidence else None,
            "analytics_tables_loaded": len(self.tables),
            "analytics_tables_expected": len(ANALYSIS_NAMES),
            "model_loaded": self.model is not None,
            "analytics_runtime": "python-parquet-fallback" if self.local_python_fallback else "spark",
            "model_runtime": "bounded-local-fallback" if self.local_python_fallback else "spark-pipeline",
            "model_path": self.model_path,
            "startup_seconds": self.load_seconds,
            "started_at": self.started_at,
            "error": self.load_error,
        }

    def require_ready(self) -> None:
        if not self.ready:
            raise ApiError(503, "analytics_unavailable", "Canonical analytics or the persisted model could not be loaded.")

    def predict(self, feature_row: dict[str, Any]) -> float:
        self.require_ready()
        if self.local_python_fallback:
            return self.model.predict(feature_row)
        from pyspark.sql.types import DoubleType, StringType, StructField, StructType
        schema = StructType([
            StructField("restaurant_id", StringType(), False),
            StructField("hour_of_day", DoubleType(), False),
            StructField("day_of_week", DoubleType(), False),
            StructField("month", DoubleType(), False),
            StructField("lag_1h", DoubleType(), False),
            StructField("lag_24h", DoubleType(), False),
            StructField("lag_168h", DoubleType(), False),
        ])
        ordered = [feature_row[name] for name in ("restaurant_id", "hour_of_day", "day_of_week", "month", "lag_1h", "lag_24h", "lag_168h")]
        with self.model_lock:
            frame = self.spark.createDataFrame([tuple(ordered)], schema=schema)
            row = self.model.transform(frame).select("prediction").first()
        value = float(row["prediction"])
        if not math.isfinite(value):
            raise ApiError(503, "prediction_unavailable", "The model returned a non-finite estimate.")
        return value

    def predict_wastage_risk(self, feature_row: dict[str, Any]) -> float:
        self.require_ready()
        if self.local_python_fallback:
            return self.wastage_risk_model.probability(feature_row)
        from pyspark.sql.types import DoubleType, StringType, StructField, StructType
        schema = StructType([
            StructField("restaurant_id", StringType(), False), StructField("category_id", StringType(), False),
            *[StructField(name, DoubleType(), False) for name in (
                "waste_qty_lag_1w", "waste_cost_lag_1w", "waste_cost_mean_prev4w", "waste_cost_mean_prev12w",
                "demand_units_lag_1w", "demand_mean_prev4w", "demand_mean_prev12w", "target_month", "target_weekofyear")]
        ])
        names = [field.name for field in schema]
        row = tuple(feature_row[name] for name in names)
        with self.model_lock:
            scored = self.wastage_risk_model.transform(self.spark.createDataFrame([row], schema=schema)).select("probability").first()
        return float(scored["probability"][1])


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def _query_text(name: str, maximum: int = 100) -> str:
    value = request.args.get(name, "").strip()
    if len(value) > maximum:
        raise ApiError(400, "invalid_filter", f"'{name}' must be at most {maximum} characters.")
    return value


def _limit(default: int = 500, maximum: int = 1000) -> int:
    raw = request.args.get("limit")
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ApiError(400, "invalid_limit", "limit must be a positive integer.") from exc
    if not 1 <= value <= maximum:
        raise ApiError(400, "invalid_limit", f"limit must be between 1 and {maximum}.")
    return value


def _month_filter(value: str, name: str) -> str:
    if not value:
        return value
    try:
        parsed = datetime.strptime(value, "%Y-%m")
    except ValueError as exc:
        raise ApiError(400, "invalid_month", f"{name} must use YYYY-MM format.") from exc
    if parsed.strftime("%Y-%m") != value:
        raise ApiError(400, "invalid_month", f"{name} must use YYYY-MM format.")
    return value


def _safe_sort(rows: list[dict[str, Any]], key: str, reverse: bool = True) -> list[dict[str, Any]]:
    return sorted(rows, key=lambda row: (row.get(key) is None, row.get(key) if row.get(key) is not None else 0), reverse=reverse)


def create_app(service: AnalyticsService | None = None, database_path: str | Path | None = None) -> Flask:
    app = Flask(__name__, static_folder=str(STATIC / "assets"), static_url_path="/assets")
    from app.daily_forecasts import bp as daily_forecast_blueprint
    app.register_blueprint(daily_forecast_blueprint)
    app.config["JSON_SORT_KEYS"] = False
    configure_security(app)
    app.extensions["dineiq_store"] = OperationalStore(database_path)
    app.extensions["dineiq_store"].bootstrap_admin()
    app.extensions["dineiq_service"] = service or AnalyticsService()
    active_service = app.extensions["dineiq_service"]
    app.extensions["dineiq_assistant"] = DineIQAssistant(active_service)
    if getattr(active_service, "ready", False):
        app.extensions["dineiq_store"].record_analytics_state([
            {"artifact_id": "spark-v4-results", "source_version": "spark-v4", "artifact_type": "analytics", "source_path": "hdfs://localhost:9000/dineq/results/v4", "row_count": sum(x.get("rows", 0) for x in active_service.analytics_evidence.get("outputs", {}).values()), "metadata": {"canonical": True}},
            {"artifact_id": "gap1-v6-results", "source_version": "gap1-v6", "artifact_type": "supplemental-analytics", "source_path": active_service.gap1_evidence["hdfs_output_root"], "row_count": sum(x.get("rows", 0) for x in active_service.gap1_evidence["outputs"].values()), "metadata": {"derived_from": "/dineq/processed/v4"}},
            {"artifact_id": "directional-baskets-v11", "source_version": "gap1-v11", "artifact_type": "directional-recommendations", "source_path": active_service.directional_basket_evidence["output"], "row_count": active_service.directional_basket_evidence["qualifying_directional_recommendations"], "metadata": {"thresholds": {"confidence": active_service.directional_basket_evidence["min_confidence"], "lift_exclusive": active_service.directional_basket_evidence["min_lift_exclusive"]}}},
            {"artifact_id": "wastage-risk-v3", "source_version": "gap1-v3", "artifact_type": "model-and-evaluation", "source_path": active_service.wastage_risk_evidence["model_path"], "row_count": active_service.wastage_risk_evidence["split"]["test"], "metadata": {"selected_model": active_service.wastage_risk_evidence["selected_model"], "metrics": active_service.wastage_risk_evidence["test_metrics"]}},
            {"artifact_id": "demand-ml-v1", "source_version": "ml-v1", "artifact_type": "demand-model-comparison", "source_path": "hdfs://localhost:9000/dineq/models/v1/selected_demand_model", "row_count": active_service.demand_comparison.get("test_rows"), "metadata": {"baseline": active_service.demand_comparison.get("baseline_metrics"), "spark": active_service.demand_comparison.get("spark_test_metrics_recomputed"), "python": active_service.demand_comparison.get("python_test_metrics_on_common_feature_panel")}},
        ], active_service.gap1_tables["recommendations"] + active_service.gap1_tables["directional_basket_recommendations"])

    @app.before_request
    def mark_request_start() -> None:
        request._dineiq_started = time.perf_counter()

    @app.before_request
    def require_authenticated_api():
        if not request.path.startswith("/api/"):
            return None
        public = {"/api/health", "/api/auth/session", "/api/auth/register", "/api/auth/login", "/api/auth/me"}
        if request.path in public:
            return None
        user = session.get("user")
        if not user or app.extensions["dineiq_store"].user_by_id(int(user.get("user_id", -1))) is None:
            return jsonify({"error": {"code": "authentication_required", "message": "Sign in to access DineIQ analytics and operations."}}), 401
        return None

    @app.after_request
    def add_timing(response):
        elapsed = (time.perf_counter() - getattr(request, "_dineiq_started", time.perf_counter())) * 1000
        response.headers["X-Response-Time-ms"] = f"{elapsed:.2f}"
        response.headers["Cache-Control"] = "no-store" if request.path.startswith("/api/ml/predict") else "private, max-age=30"
        return response

    @app.errorhandler(ApiError)
    def api_error(error: ApiError):
        return jsonify({"error": {"code": error.code, "message": error.message}}), error.status

    @app.errorhandler(404)
    def not_found(_error):
        if request.path.startswith("/api/"):
            return jsonify({"error": {"code": "not_found", "message": "API route not found."}}), 404
        if request.path.startswith("/assets/"):
            return "Asset not found", 404
        if Path(request.path).suffix:
            candidate = (STATIC / request.path.lstrip("/")).resolve()
            if candidate.is_relative_to(STATIC.resolve()) and candidate.is_file():
                return send_from_directory(STATIC, request.path.lstrip("/"))
            return "File not found", 404
        return index()

    @app.errorhandler(500)
    def internal_error(_error):
        app.logger.exception("Unhandled DineIQ application error")
        return jsonify({"error": {"code": "internal_error", "message": "The request could not be completed."}}), 500

    def svc() -> AnalyticsService:
        return app.extensions["dineiq_service"]

    def rows(name: str) -> list[dict[str, Any]]:
        svc().require_ready()
        return svc().tables[name]

    @app.get("/")
    def index():
        if not (STATIC / "index.html").is_file():
            return "Frontend build missing. Run npm ci and npm run build in frontend/.", 503
        return send_from_directory(STATIC, "index.html")

    @app.get("/api/health")
    def health():
        state = svc().health()
        return jsonify(state), 200 if state["status"] == "ok" else 503

    @app.post("/api/what-if")
    def what_if():
        body=request.get_json(silent=True)
        if not isinstance(body,dict):
            raise ApiError(400,"invalid_scenario","Request body must be a JSON object.")
        try:
            return jsonify(simulate_what_if(body))
        except (KeyError,TypeError,ValueError) as exc:
            raise ApiError(400,"invalid_scenario",str(exc)) from exc

    @app.get("/api/assistant/capabilities")
    def assistant_capabilities():
        """Describe the grounded assistant without exposing implementation state."""
        return jsonify(app.extensions["dineiq_assistant"].capabilities())

    @app.post("/api/assistant/chat")
    def assistant_chat():
        """Answer one bounded question from project definitions and loaded evidence."""
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise ApiError(400, "invalid_message", "Request body must be a JSON object.")
        if set(body) - {"message"}:
            raise ApiError(400, "invalid_message", "Only the message field is supported.")
        try:
            reply = app.extensions["dineiq_assistant"].answer(body.get("message"))
        except (TypeError, ValueError) as exc:
            raise ApiError(400, "invalid_message", str(exc)) from exc
        return jsonify(reply.as_dict())

    @app.get("/api/filters")
    def filters():
        restaurant_rows = rows("restaurants")
        return jsonify({
            "categories": sorted({r["category_name"] for r in rows("categories")}),
            "cities": sorted({r["city"] for r in restaurant_rows if r.get("city")}),
            "restaurants": [{"restaurant_id": r["restaurant_id"], "restaurant_name": r["restaurant_name"], "city": r.get("city")} for r in sorted(restaurant_rows, key=lambda x: x["restaurant_name"])],
            "channels": sorted({r["ordering_channel"] for r in rows("channels")}),
        })

    @app.get("/api/overview")
    def overview():
        monthly = rows("monthly")
        restaurants = rows("restaurants")
        ratings = rows("ratings")
        total_ratings = sum(float(r.get("rating_count") or 0) for r in ratings)
        rating_avg = (sum(float(r.get("avg_rating") or 0) * float(r.get("rating_count") or 0) for r in ratings) / total_ratings) if total_ratings else None
        return jsonify({
            "kpis": {
                "orders": sum(int(r["total_orders"]) for r in monthly),
                "completed_orders": sum(int(r["completed_orders"]) for r in monthly),
                "completed_revenue": round(sum(float(r.get("completed_revenue") or 0) for r in monthly), 2),
                "restaurants": len(restaurants),
                "menu_items": len(rows("menu")),
                "weighted_restaurant_rating": round(rating_avg, 3) if rating_avg is not None else None,
            },
            "period": {"start": monthly[0]["order_month"], "end": monthly[-1]["order_month"]},
            "monthly": monthly,
            "top_categories": _safe_sort(rows("categories"), "gross_sales")[:8],
            "top_menu_items": _safe_sort(rows("menu"), "gross_sales")[:8],
            "channels": _safe_sort(rows("channels"), "orders"),
        })

    @app.get("/api/menu")
    def menu():
        category = _query_text("category").casefold()
        search = _query_text("q").casefold()
        sort = request.args.get("sort", "gross_sales")
        if sort not in {"gross_sales", "order_count", "units_sold", "item_name"}:
            raise ApiError(400, "invalid_sort", "sort must be gross_sales, order_count, units_sold, or item_name.")
        result = [r for r in rows("menu") if (not category or category == str(r.get("category_name", "")).casefold()) and (not search or search in str(r.get("item_name", "")).casefold())]
        return jsonify({"count": len(result), "items": _safe_sort(result, sort)[:_limit()]})

    @app.get("/api/categories")
    def categories():
        sort = request.args.get("sort", "gross_sales")
        if sort not in {"gross_sales", "order_count", "units_sold", "category_name"}:
            raise ApiError(400, "invalid_sort", "Unsupported category sort field.")
        return jsonify({"items": _safe_sort(rows("categories"), sort)})

    @app.get("/api/restaurants")
    def restaurants():
        city = _query_text("city").casefold()
        sort = request.args.get("sort", "revenue")
        if sort not in {"revenue", "order_count", "avg_order_value", "restaurant_name"}:
            raise ApiError(400, "invalid_sort", "Unsupported restaurant sort field.")
        result = [r for r in rows("restaurants") if not city or city == str(r.get("city", "")).casefold()]
        return jsonify({"count": len(result), "items": _safe_sort(result, sort)[:_limit()]})

    @app.get("/api/channels")
    def channels():
        channel = _query_text("channel").casefold()
        result = [r for r in rows("channels") if not channel or channel == str(r.get("ordering_channel", "")).casefold()]
        return jsonify({"items": _safe_sort(result, "orders")})

    @app.get("/api/promotions")
    def promotions():
        q = _query_text("q").casefold()
        result = [r for r in rows("promotions") if not q or q in str(r.get("promotion_name", "")).casefold()]
        return jsonify({"count": len(result), "items": _safe_sort(result, "used_orders")[:_limit()]})

    @app.get("/api/ratings")
    def ratings():
        restaurant_id = _query_text("restaurant_id").upper()
        result = [r for r in rows("ratings") if not restaurant_id or restaurant_id == r.get("restaurant_id")]
        return jsonify({"items": _safe_sort(result, "avg_rating")})

    @app.get("/api/wastage")
    def wastage():
        return jsonify({"items": _safe_sort(rows("wastage"), "wastage_cost")})

    @app.get("/api/inventory")
    def inventory():
        return jsonify({"items": rows("inventory")})

    @app.get("/api/pricing")
    def pricing():
        return jsonify({"items": _safe_sort(rows("pricing"), "changes")})

    @app.get("/api/demand/monthly")
    def monthly_demand():
        start = _month_filter(request.args.get("from", ""), "from")
        end = _month_filter(request.args.get("to", ""), "to")
        if start and end and start > end:
            raise ApiError(400, "invalid_range", "from must be earlier than or equal to to.")
        result = sorted((r for r in rows("monthly") if (not start or r["order_month"] >= start) and (not end or r["order_month"] <= end)), key=lambda row: row["order_month"])
        return jsonify({"count": len(result), "items": result})

    @app.get("/api/demand/peak-hours")
    def peak_hours():
        weekday = request.args.get("weekday")
        hour = request.args.get("hour")
        result = rows("peak_hours")
        if weekday is not None:
            try:
                value = int(weekday)
            except ValueError as exc:
                raise ApiError(400, "invalid_weekday", "weekday must be an integer from 1 (Sunday) to 7 (Saturday).") from exc
            if not 1 <= value <= 7:
                raise ApiError(400, "invalid_weekday", "weekday must be from 1 (Sunday) to 7 (Saturday).")
            result = [r for r in result if int(r["weekday"]) == value]
        if hour is not None:
            try:
                value = int(hour)
            except ValueError as exc:
                raise ApiError(400, "invalid_hour", "hour must be an integer from 0 through 23.") from exc
            if not 0 <= value <= 23:
                raise ApiError(400, "invalid_hour", "hour must be from 0 through 23.")
            result = [r for r in result if int(r["hour_of_day"]) == value]
        return jsonify({"weekday_encoding": "Spark dayofweek: Sunday=1 through Saturday=7", "items": result})

    @app.get("/api/customer-segments")
    def customer_segments():
        return jsonify({"items": _safe_sort(rows("segments"), "revenue")})

    @app.get("/api/intelligence/menu")
    def intelligence_menu():
        category = _query_text("category").casefold()
        performance_class = _query_text("class").casefold()
        query = _query_text("q").casefold()
        sort = request.args.get("sort", "contribution_margin")
        if sort not in {"contribution_margin", "units_sold", "revenue", "contribution_margin_pct", "item_name"}:
            raise ApiError(400, "invalid_sort", "Unsupported menu profitability sort.")
        result = [r for r in svc().gap1_tables["menu_profitability"] if (not category or str(r.get("category_name", "")).casefold() == category) and (not performance_class or str(r.get("performance_class", "")).casefold() == performance_class) and (not query or query in str(r.get("item_name", "")).casefold())]
        return jsonify({"source": "Spark gap-closure v6; derived from canonical processed v4", "count": len(result), "items": _safe_sort(result, sort)[:_limit()]})

    @app.get("/api/intelligence/baskets")
    def intelligence_baskets():
        minimum_confidence = request.args.get("min_confidence", "0.10")
        try:
            confidence_cut = float(minimum_confidence)
            if not math.isfinite(confidence_cut) or not 0 <= confidence_cut <= 1:
                raise ValueError
        except ValueError as exc:
            raise ApiError(400, "invalid_confidence", "min_confidence must be a number from 0 to 1.") from exc
        directions = []
        for pair in svc().gap1_tables["basket_rules"]:
            for left, right, confidence_key, lift_key in (
                ("a", "b", "confidence_a_to_b", "lift_a_to_b"),
                ("b", "a", "confidence_b_to_a", "lift_b_to_a"),
            ):
                confidence = float(pair[confidence_key])
                lift = float(pair[lift_key])
                directions.append({
                    "antecedent_id": pair[f"item_{left}"], "antecedent": pair[f"item_{left}_name"],
                    "consequent_id": pair[f"item_{right}"], "consequent": pair[f"item_{right}_name"],
                    "pair_count": pair["pair_count"], "support": pair["support"], "confidence": confidence,
                    "lift": lift, "recommendation_supported": confidence >= confidence_cut and lift > 1.0,
                    "action": f"Consider offering {pair[f'item_{right}_name']} with {pair[f'item_{left}_name']}" if confidence >= confidence_cut and lift > 1.0 else None,
                })
        directions = [x for x in directions if x["confidence"] >= confidence_cut]
        directions.sort(key=lambda x: (x["recommendation_supported"], x["lift"], x["confidence"], x["pair_count"]), reverse=True)
        return jsonify({"source": "Spark gap-closure v6; distinct completed-order baskets", "minimum_confidence": confidence_cut, "association_thresholds": svc().gap1_evidence["basket"], "directional_rules": len(directions), "items": directions[:_limit()]})

    @app.get("/api/intelligence/customers")
    def intelligence_customers():
        segment = _query_text("segment").casefold()
        result = [r for r in svc().gap1_tables["customer_rfm"] if not segment or str(r.get("behavior_segment", "")).casefold() == segment]
        return jsonify({"source": "Spark gap-closure v6; pseudonymous source IDs, no synthetic churn flag", "count": len(result), "items": _safe_sort(result, "monetary_value")[:_limit()]})

    @app.get("/api/intelligence/churn-risk")
    def intelligence_churn():
        result = [r for r in svc().gap1_tables["customer_rfm"] if r.get("behavior_segment") == "At risk (90d inactive)"]
        return jsonify({"type": "descriptive_inactivity_risk", "is_predictive": False, "as_of": "2026-08-31", "definition": "90+ days since last completed order among customers with at least two completed orders", "count": len(result), "items": _safe_sort(result, "monetary_value")[:_limit()]})

    @app.get("/api/intelligence/wastage")
    def intelligence_wastage():
        restaurant = _query_text("restaurant_id").upper()
        month = _query_text("month", 7)
        result = [r for r in svc().gap1_tables["wastage_dimensions"] if (not restaurant or r.get("restaurant_id") == restaurant) and (not month or str(r.get("waste_month")) == month)]
        return jsonify({"count": len(result), "total_before_limit": len(result), "items": _safe_sort(result, "wastage_cost")[:_limit()]})

    @app.get("/api/intelligence/wastage-risk")
    def intelligence_wastage_risk():
        return jsonify({"type": "historical_held_out_model_predictions", "status": "low_precision_screening_signal", "model": svc().wastage_risk_evidence["selected_model"], "runtime": "bounded-local-fallback" if svc().local_python_fallback else "spark-pipeline", "metrics": svc().wastage_risk_evidence["test_metrics"], "test_set_is_not_live_forecast": True, "count_returned": min(100, len(svc().wastage_risk_predictions)), "items": svc().wastage_risk_predictions[:min(100, _limit(100, 100))]})

    @app.post("/api/ml/wastage-risk/predict")
    def predict_wastage_risk():
        service = svc(); service.require_ready()
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise ApiError(400, "invalid_json", "Send a JSON object with location, category, prediction week, and prior-history features.")
        try:
            restaurant = str(body["restaurant_id"]).strip().upper()
            category = str(body["category_id"]).strip().upper()
            monday = datetime.strptime(str(body["prediction_week_start"]), "%Y-%m-%d").date()
            if monday.isoweekday() != 1:
                raise ValueError("prediction_week_start must be a Monday.")
            restaurant_ids = {x["restaurant_id"] for x in rows("restaurants")}
            categories = {x["category_id"] for x in service.gap1_tables["menu_profitability"]}
            if restaurant not in restaurant_ids or category not in categories:
                raise ValueError("restaurant_id and category_id must exist in the canonical v4-derived dimensions.")
            names = ("waste_qty_lag_1w", "waste_cost_lag_1w", "waste_cost_mean_prev4w", "waste_cost_mean_prev12w", "demand_units_lag_1w", "demand_mean_prev4w", "demand_mean_prev12w")
            features = {name: float(body[name]) for name in names}
            if any(not math.isfinite(v) or v < 0 for v in features.values()):
                raise ValueError("Historical lag and rolling features must be finite, nonnegative numbers.")
            target_week = monday.fromordinal(monday.toordinal() + 7)
            features.update({"restaurant_id": restaurant, "category_id": category, "target_month": float(target_week.month), "target_weekofyear": float(target_week.isocalendar().week)})
        except (KeyError, TypeError, ValueError) as exc:
            raise ApiError(400, "invalid_wastage_risk_input", str(exc)) from exc
        probability = service.predict_wastage_risk(features)
        store = app.extensions["dineiq_store"]
        store.add_audit(actor=session.get("user"), action="wastage_risk_prediction", entity="wastage_risk", record_key=f"{restaurant}:{category}:{monday.isoformat()}", details={"prediction_week_start": monday.isoformat(), "probability": probability, "model": service.wastage_risk_evidence["selected_model"]})
        return jsonify({"target": "next-week high wastage cost classification", "prediction_week_start": monday.isoformat(), "target_week": target_week.isoformat(), "restaurant_id": restaurant, "category_id": category, "probability_high_risk": probability, "threshold": service.wastage_risk_evidence["selected_threshold"], "high_risk": probability >= service.wastage_risk_evidence["selected_threshold"], "model": service.wastage_risk_evidence["selected_model"], "runtime": "bounded-local-fallback" if service.local_python_fallback else "spark-pipeline", "test_metrics": service.wastage_risk_evidence["test_metrics"], "warning": "Low-precision screening signal; not a causal explanation or inventory/wastage guarantee."})

    @app.get("/api/intelligence/pricing")
    def intelligence_pricing():
        return jsonify({"interpretation": "observational price-change association; not a causal elasticity estimate", "count": len(svc().gap1_tables["price_sensitivity"]), "items": svc().gap1_tables["price_sensitivity"][:_limit()]})

    @app.get("/api/intelligence/promotions")
    def intelligence_promotions():
        return jsonify({"interpretation": "uncontrolled observational cohorts; trap flags are screening rules, not causal promotion effects", "count": len(svc().gap1_tables["promotion_intelligence"]), "items": _safe_sort(svc().gap1_tables["promotion_intelligence"], "revenue")[:_limit()]})

    @app.get("/api/intelligence/anomalies")
    def intelligence_anomalies():
        return jsonify({"interpretation": "statistical anomaly candidates require human review", "rating_count": len(svc().gap1_tables["rating_anomalies"]), "sales_count": len(svc().gap1_tables["sales_anomalies"]), "ratings": svc().gap1_tables["rating_anomalies"][:_limit()], "sales": svc().gap1_tables["sales_anomalies"][:_limit()]})

    @app.get("/api/intelligence/recommendations")
    def intelligence_recommendations():
        legacy = [r for r in svc().gap1_tables["recommendations"] if str(r.get("source", "")).casefold() != "basket association"]
        directional = [{"source": "directional basket association", "recommendation_type": "cross_sell_candidate", "entity_name": row["consequent"], "subject": row["antecedent"]+" -> "+row["consequent"], "action": row["recommendation"], "evidence": f"pair_count={row['pair_count']}; support={row['support']:.6f}; directional confidence={row['confidence']:.4f}; directional lift={row['lift']:.4f}", "antecedent_id": row["antecedent_id"], "consequent_id": row["consequent_id"], "pair_count": row["pair_count"], "support": row["support"], "confidence": row["confidence"], "lift": row["lift"]} for row in svc().gap1_tables["directional_basket_recommendations"]]
        items = directional + legacy
        return jsonify({"type": "deterministic_analytical_recommendations", "basket_recommendations_directional": True, "count": len(items), "items": items[:_limit()]})

    @app.get("/api/ml/demand-comparison")
    def demand_comparison():
        report = svc().demand_comparison
        return jsonify({"target": report["target"], "prediction_point": report["prediction_point"], "test_period": report["test_period"], "test_rows": report["test_rows"], "baseline": report["baseline"], "baseline_metrics": report["baseline_metrics"], "spark_model": report["spark_selected_model"], "spark_metrics": report["spark_test_metrics_recomputed"], "python_model": report["python_selected_model"], "python_metrics": report["python_test_metrics_on_common_feature_panel"], "feature_semantics_note": report["feature_semantics_note"], "models_retrained": report["models_retrained"], "keyed_cases": report["row_level_case_count"], "prediction_cases": report["row_level_cases"][:min(100, _limit(100, 100))]})

    @app.get("/api/ml/model")
    def ml_model():
        svc().require_ready()
        return jsonify({
            "problem": svc().ml_spark["problem"],
            "target": svc().ml_spark["target"],
            "prediction_point": svc().ml_spark["prediction_point"],
            "features": svc().ml_spark["features"],
            "leakage_exclusions": svc().ml_spark["leakage_exclusions"],
            "model": svc().ml_spark["selected_model"],
            "runtime": "bounded-local-fallback" if svc().local_python_fallback else "spark-pipeline",
            "model_path": svc().model_path,
            "seed": svc().ml_spark["seed"],
            "spark_version": svc().ml_spark["spark_version"],
            "test_metrics": svc().ml_spark["test_metrics"],
            "validation_models": svc().ml_spark["models"],
            "history_end": svc().ml_spark["split"]["test_range"].split(" through ")[-1],
            "sample_predictions": svc().ml_spark["sample_predictions"],
            "python_comparison": {"model": svc().ml_python["selected_model"], "test_metrics": svc().ml_python["test_metrics"]},
        })

    @app.post("/api/ml/predict")
    def predict():
        svc().require_ready()
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise ApiError(400, "invalid_json", "Send a JSON object with restaurant_id, target_hour, and the three lag counts.")
        restaurant_id = body.get("restaurant_id")
        if not isinstance(restaurant_id, str) or not restaurant_id.strip():
            raise ApiError(400, "invalid_restaurant", "restaurant_id is required.")
        restaurant_id = restaurant_id.strip().upper()
        if restaurant_id not in {r["restaurant_id"] for r in rows("restaurants")}:
            raise ApiError(400, "invalid_restaurant", "restaurant_id must identify a restaurant in canonical v4 analytics.")
        raw_hour = body.get("target_hour")
        if not isinstance(raw_hour, str) or ("T" not in raw_hour and " " not in raw_hour):
            raise ApiError(400, "invalid_target_hour", "target_hour must be an ISO 8601 timestamp at an exact hour.")
        try:
            parsed = datetime.fromisoformat(raw_hour.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ApiError(400, "invalid_target_hour", "target_hour must be an ISO 8601 timestamp at an exact hour.") from exc
        if parsed.minute or parsed.second or parsed.microsecond:
            raise ApiError(400, "invalid_target_hour", "target_hour must be aligned to the start of an hour (minute and second zero).")
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
        if parsed.minute or parsed.second or parsed.microsecond:
            raise ApiError(400, "invalid_target_hour", "The timestamp must resolve to an exact UTC hour.")
        if parsed.minute or parsed.second or parsed.microsecond:
            raise ApiError(400, "invalid_target_hour", "The timestamp must resolve to an exact UTC hour.")
        target_hour = parsed
        lags = {}
        for name in ("lag_1h", "lag_24h", "lag_168h"):
            value = body.get(name)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)) or value < 0 or not float(value).is_integer():
                raise ApiError(400, "invalid_lag", f"{name} must be a finite, nonnegative whole-number order count.")
            lags[name] = float(value)

        # Keep the verified Spark model's exact weekday encoding: Sunday=0, Monday=1, ..., Saturday=6.
        weekday = float((target_hour.weekday() + 1) % 7)
        features = {
            "restaurant_id": restaurant_id,
            "hour_of_day": float(target_hour.hour),
            "day_of_week": weekday,
            "month": float(target_hour.month),
            **lags,
        }
        estimate = svc().predict(features)
        app.extensions["dineiq_store"].add_audit(actor=session.get("user"), action="demand_prediction", entity="hourly_demand", record_key=f"{restaurant_id}:{target_hour.isoformat()}", details={"model": svc().ml_spark["selected_model"], "predicted_order_arrivals": estimate})
        warnings = ["Lag values were supplied by the caller. Project history ends 2026-08-31; this is not a live forecast unless current lag data is supplied."]
        if target_hour.month not in {3, 4, 5, 6, 7, 8}:
            warnings.append("This target month is outside the March–August months represented in model training and test evidence; seasonal extrapolation is not validated.")
        return jsonify({
            "target": "hourly restaurant order arrivals",
            "restaurant_id": restaurant_id,
            "target_hour_utc": target_hour.strftime("%Y-%m-%dT%H:00:00Z"),
            "predicted_order_arrivals": estimate,
            "unit": "expected orders (regression output may be fractional)",
            "features": features,
            "model": svc().ml_spark["selected_model"],
            "runtime": "bounded-local-fallback" if svc().local_python_fallback else "spark-pipeline",
            "model_path": svc().model_path,
            "test_metrics": svc().ml_spark["test_metrics"],
            "warnings": warnings,
        }), 200

    @app.get("/api/system/evidence")
    def system_evidence():
        service = svc()
        service.require_ready()
        raw_counts = service.generation["table_counts_after_dirty_injection"]
        cleaning_tables = service.quality["profiled_before_cleaning"]
        tables = []
        for name in service.ingestion["tables"]:
            quality_table = cleaning_tables.get(name, {})
            tables.append({
                "table": name,
                "raw_rows": raw_counts.get(name),
                "processed_rows": quality_table.get("processed_rows"),
            })
        order_items = next(r for r in tables if r["table"] == "order_items")
        return jsonify({
            "canonical_layers": {"raw": service.ingestion["source"], "processed": service.quality["processed_root"], "analytics": service.analytics_evidence["output_root"]},
            "production_tables": len(tables),
            "tables": tables,
            "order_items": order_items,
            "quality_audits": len(service.quality["cleaning_audit"]),
            "spark_version": service.ml_spark["spark_version"],
            "analytics_execution_seconds": service.analytics_evidence["elapsed_seconds"],
            "python_spark_comparison": {
                "status": service.comparison["status"],
                "matched_metrics": service.comparison["matched_metrics"],
                "mismatched_metrics": service.comparison["mismatched_metrics"],
                "elapsed_seconds": service.comparison["elapsed_seconds"],
            },
            "ml": {
                "model_version": "v1",
                "model": service.ml_spark["selected_model"],
                "model_path": service.model_path,
                "features_path": service.ml_spark["hdfs_features_path"],
                "evidence_path": "hdfs://localhost:9000/dineq/results/ml/v1/pipeline_evidence_final",
                "test_metrics": service.ml_spark["test_metrics"],
            },
        })

    @app.get("/api/system/performance")
    def performance():
        service = svc()
        return jsonify({"data_loaded_at_startup": service.started_at, "startup_load_seconds": service.load_seconds, "serving_mode": "in-memory cache of precomputed v4 parquet outputs", "response_time_header": "X-Response-Time-ms"})

    @app.get("/api/system/spark-jobs")
    def spark_jobs():
        # This is execution history from saved evidence, not a live Spark job tracker.
        evidence = [
            {"job": "canonical_v4_analytics", "evidence_file": "results/spark/analytics.json", "available": ANALYTICS_EVIDENCE.is_file(), "status": "historical-success" if ANALYTICS_EVIDENCE.is_file() else "unknown", "elapsed_seconds": svc().analytics_evidence.get("elapsed_seconds"), "live": False},
            {"job": "gap1_analytics_v6", "evidence_file": "results/analytics/gap1/v6/spark_gap1.json", "available": GAP1_EVIDENCE.is_file(), "status": "historical-success" if GAP1_EVIDENCE.is_file() else "unknown", "elapsed_seconds": svc().gap1_evidence.get("elapsed_seconds"), "live": False},
            {"job": "wastage_risk_v3", "evidence_file": "results/analytics/gap1/wastage_risk_v3/pipeline.json", "available": GAP1_RISK_EVIDENCE.is_file(), "status": "historical-success" if GAP1_RISK_EVIDENCE.is_file() and svc().wastage_risk_evidence.get("reload_smoke", {}).get("passed") else "unknown", "elapsed_seconds": svc().wastage_risk_evidence.get("elapsed_seconds"), "live": False},
        ]
        return jsonify({"monitoring_mode": "historical evidence; no claim of live job state", "active_jobs": None, "jobs": evidence})

    @app.get("/api/system/analytics-artifacts")
    def analytics_artifacts():
        artifacts = app.extensions["dineiq_store"].artifact_rows()
        with app.extensions["dineiq_store"].connect() as conn:
            recommendation_count = conn.execute("SELECT count(*) FROM recommendation_snapshots").fetchone()[0]
        return jsonify({"operational_database": "SQLite; application records and evidence metadata only", "artifacts": artifacts, "persisted_recommendation_rows": recommendation_count, "analytical_data_remains_in_hdfs": getattr(svc(), "storage_backend", "hdfs") == "hdfs", "storage_backend": getattr(svc(), "storage_backend", "hdfs")})

    from app.operations_api import register_operations_api
    register_operations_api(app, svc)

    return app


app = create_app()


if __name__ == "__main__":
    port = int(os.environ.get("DINEIQ_PORT", "5000"))
    print(f"DineIQ Analytics listening on http://127.0.0.1:{port}", flush=True)
    app.run(host="127.0.0.1", port=port, threaded=True, use_reloader=False)
