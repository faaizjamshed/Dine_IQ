"""Shared definitions for leakage-safe hourly restaurant demand forecasting."""
from __future__ import annotations

SEED = 42
TARGET = "order_count"
FEATURES_NUMERIC = ["hour_of_day", "day_of_week", "month", "lag_1h", "lag_24h", "lag_168h"]
FEATURES_CATEGORICAL = ["restaurant_id"]
FEATURES = FEATURES_CATEGORICAL + FEATURES_NUMERIC
START = "2025-03-01 00:00:00"
END = "2026-08-31 23:00:00"
PREDICTION_POINT = "At the start of each UTC timestamp hour in the source data, before that hour's orders occur; restaurant-specific time zones are not provided."
TARGET_DEFINITION = "Count of order records with order_datetime in [hour_start, hour_start + 1 hour), regardless of eventual order status."
LEAKAGE_EXCLUSIONS = ["order_status", "subtotal", "discount_amount", "tax_amount", "delivery_fee", "final_amount", "payment_method", "promotion_id", "customer_id", "order items", "ratings", "inventory and wastage observed during/after target hour"]


def split_for_timestamp(ts):
    """Contiguous chronological partitions, no random row mixing."""
    if ts < "2026-04-01":
        return "train"
    if ts < "2026-06-01":
        return "validation"
    return "test"
