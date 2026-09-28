"""Shared explicit schemas and Spark helpers for DineIQ batch jobs."""
from __future__ import annotations
import json
import os
import sys
import types
from pathlib import Path
from pyspark.sql import SparkSession
from pyspark.sql.types import (StructType, StructField, StringType, IntegerType,
    DoubleType, BooleanType, DateType, TimestampType)

ROOT = Path(__file__).resolve().parents[2]
LOCAL_EVIDENCE = ROOT / "results" / "spark"
HDFS = "hdfs://localhost:9000"
RAW = f"{HDFS}/dineq/raw"
PROCESSED = f"{HDFS}/dineq/processed"
QUALITY = f"{HDFS}/dineq/quality"

def schema(fields):
    types={"s":StringType(),"i":IntegerType(),"d":DoubleType(),"b":BooleanType(),"date":DateType(),"ts":TimestampType()}
    return StructType([StructField(name,types[kind],True) for name,kind in fields])

SCHEMAS={
"customers":schema([("customer_id","s"),("customer_name","s"),("gender","s"),("age","i"),("city","s"),("signup_date","date"),("customer_segment","s"),("preferred_channel","s"),("loyalty_points","i"),("is_churned","b"),("last_order_date","date")]),
"restaurants":schema([("restaurant_id","s"),("restaurant_name","s"),("city","s"),("area","s"),("opening_date","date"),("seating_capacity","i"),("location_type","s"),("is_active","b")]),
"menu_categories":schema([("category_id","s"),("category_name","s"),("description","s"),("is_active","b")]),
"menu_items":schema([("menu_item_id","s"),("category_id","s"),("item_name","s"),("base_price","d"),("cost_price","d"),("preparation_time_min","i"),("is_vegetarian","b"),("is_available","b"),("launch_date","date")]),
"promotions":schema([("promotion_id","s"),("promotion_name","s"),("promotion_type","s"),("discount_type","s"),("discount_value","d"),("start_date","date"),("end_date","date"),("minimum_order_value","d"),("channel","s"),("is_active","b")]),
"orders":schema([("order_id","s"),("customer_id","s"),("restaurant_id","s"),("promotion_id","s"),("order_datetime","ts"),("ordering_channel","s"),("order_status","s"),("subtotal","d"),("discount_amount","d"),("tax_amount","d"),("delivery_fee","d"),("final_amount","d"),("payment_method","s")]),
"order_items":schema([("order_item_id","s"),("order_id","s"),("menu_item_id","s"),("quantity","i"),("unit_price","d"),("item_discount","d"),("line_total","d"),("special_request","s")]),
"pricing_history":schema([("price_history_id","s"),("menu_item_id","s"),("restaurant_id","s"),("old_price","d"),("new_price","d"),("effective_from","date"),("effective_to","date"),("change_reason","s")]),
"ratings":schema([("rating_id","s"),("order_id","s"),("customer_id","s"),("restaurant_id","s"),("rating","i"),("food_rating","d"),("service_rating","d"),("delivery_rating","d"),("review_text","s"),("rating_date","date")]),
"inventory":schema([("inventory_id","s"),("restaurant_id","s"),("menu_item_id","s"),("record_date","date"),("opening_stock","i"),("stock_received","i"),("stock_used","i"),("closing_stock","i"),("reorder_level","i"),("stock_status","s")]),
"wastage":schema([("wastage_id","s"),("restaurant_id","s"),("menu_item_id","s"),("wastage_date","date"),("quantity_wasted","d"),("unit_cost","d"),("wastage_cost","d"),("reason","s")]),
}
PK={"customers":"customer_id","restaurants":"restaurant_id","menu_categories":"category_id","menu_items":"menu_item_id","promotions":"promotion_id","orders":"order_id","order_items":"order_item_id","pricing_history":"price_history_id","ratings":"rating_id","inventory":"inventory_id","wastage":"wastage_id"}
COUNTS={"customers":75075,"orders":650000,"order_items":3000600,"menu_items":200,"menu_categories":15,"restaurants":25,"pricing_history":2992,"promotions":80,"ratings":220000,"inventory":90000,"wastage":110000}

def _safe_get_active_session():
    try:
        return SparkSession.getActiveSession()
    except Exception:
        return None


def _session_is_usable(session):
    if session is None:
        return False
    try:
        sc = getattr(session, "sparkContext", None)
        if sc is None:
            return False
        jsc = getattr(sc, "_jsc", None)
        if jsc is None:
            return False
        return not jsc.sc().isStopped()
    except Exception:
        return False


def stop_active_spark():
    active = _safe_get_active_session()
    if active is not None:
        try:
            sc = getattr(active, "sparkContext", None)
            if sc is not None:
                jsc = getattr(sc, "_jsc", None)
                if jsc is not None:
                    try:
                        if not jsc.sc().isStopped():
                            active.stop()
                    except Exception:
                        try:
                            active.stop()
                        except Exception:
                            pass
                else:
                    try:
                        active.stop()
                    except Exception:
                        pass
            else:
                try:
                    active.stop()
                except Exception:
                    pass
        except Exception:
            pass
    try:
        if hasattr(SparkSession, "clearActiveSession"):
            SparkSession.clearActiveSession()
    except Exception:
        pass


def _deferred_detach_stop(self, *args, **kwargs):
    try:
        self._sc = None
    except Exception:
        pass
    try:
        self._jsc = None
    except Exception:
        pass
    return None


def spark(app, master="local[4]", shuffle_partitions=16, filesystem=None):
    python_executable = str(Path(sys.executable or "python").resolve()) if sys.executable else "python"
    python_dir = str(Path(python_executable).resolve().parent)
    os.environ["PYSPARK_PYTHON"] = python_executable
    os.environ["PYSPARK_DRIVER_PYTHON"] = python_executable
    os.environ["PATH"] = python_dir + os.pathsep + os.environ.get("PATH", "")
    os.environ.setdefault("HADOOP_USER_NAME", "hadoop")

    active = _safe_get_active_session()
    if active is not None and not _session_is_usable(active):
        stop_active_spark()
        active = None
    if active is not None:
        try:
            active_name = active.conf.get("spark.app.name")
            if getattr(active, "_sc", None) is None:
                SparkSession.clearActiveSession()
                active = None
        except Exception:
            active_name = None
            active = None
        if active is not None and active_name == app:
            return active
        if active is not None and active_name != app:
            try:
                fresh = active.newSession()
                try:
                    fresh.conf.set("spark.app.name", app)
                except Exception:
                    pass
                fresh.stop = types.MethodType(_deferred_detach_stop, fresh)
                return fresh
            except Exception:
                stop_active_spark()
                active = None

    return (SparkSession.builder.appName(app).master(master)
        .config("spark.driver.allowMultipleContexts","true")
        .config("spark.sql.session.timeZone","UTC")
        .config("spark.sql.shuffle.partitions",str(shuffle_partitions))
        .config("spark.default.parallelism","8")
        .config("spark.driver.memory","2g")
        .config("spark.executorEnv.PYSPARK_PYTHON", python_executable)
        .config("spark.executorEnv.PYSPARK_DRIVER_PYTHON", python_executable)
        .config("spark.executorEnv.PATH", os.environ["PATH"])
        .config("spark.sql.sources.partitionOverwriteMode","dynamic")
        .config("spark.hadoop.fs.defaultFS", filesystem or os.environ.get("DINEIQ_SPARK_FS", HDFS))
        .config("spark.hadoop.dfs.namenode.rpc-address","localhost:9000")
        .config("spark.hadoop.dfs.datanode.hostname","localhost")
        # The cluster must register the DataNode via the Docker service name, but
        # host-side Spark reads must resolve block locations back through the
        # forwarded localhost port.
        .config("spark.hadoop.dfs.client.use.datanode.hostname","true")
        .config("spark.hadoop.dfs.datanode.use.datanode.hostname","true")
        .getOrCreate())


# Ensure stray sessions do not leak across repeated script/test invocations.
import atexit
atexit.register(stop_active_spark)

def read_table(spark_session, table):
    return read_csv_table(spark_session, table, f"{RAW}/{table}.csv")

def read_csv_table(spark_session, table, path):
    source = Path(path)
    csv_path = source.as_uri() if source.is_absolute() else str(path)
    return (spark_session.read.option("header",True).option("mode","PERMISSIVE")
        .schema(SCHEMAS[table]).csv(csv_path))

def save_json(path: Path, value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,indent=2,default=str),encoding="utf-8")
