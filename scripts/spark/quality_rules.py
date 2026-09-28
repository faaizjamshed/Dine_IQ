"""Testable, source-preserving Spark quality profiles and cleaning rules."""
from pyspark.sql import functions as F

from common import PK, SCHEMAS

FOREIGN_KEYS = {
    "orders": {"customer_id": "customers", "restaurant_id": "restaurants", "promotion_id": "promotions"},
    "menu_items": {"category_id": "menu_categories"},
    "order_items": {"order_id": "orders", "menu_item_id": "menu_items"},
    "pricing_history": {"menu_item_id": "menu_items", "restaurant_id": "restaurants"},
    "ratings": {"order_id": "orders", "customer_id": "customers", "restaurant_id": "restaurants"},
    "inventory": {"restaurant_id": "restaurants", "menu_item_id": "menu_items"},
    "wastage": {"restaurant_id": "restaurants", "menu_item_id": "menu_items"},
}

DOMAINS = {
    "customers": {"gender": ["Female", "Male", "Other"], "customer_segment": ["New", "Regular", "Loyal", "High Value", "Occasional"], "preferred_channel": ["Dine-In", "Takeaway", "Mobile App", "Website", "Delivery Partner"]},
    "restaurants": {"city": ["Karachi", "Lahore", "Islamabad", "Rawalpindi", "Faisalabad", "Multan"], "location_type": ["High Street", "Mall", "Commercial", "Residential"]},
    "menu_categories": {"category_name": ["Burgers", "Pizza", "Pakistani", "BBQ", "Beverages", "Desserts", "Chinese", "Fast Food", "Breakfast", "Salads", "Pasta", "Seafood", "Sandwiches", "Rice", "Coffee & Tea"]},
    "promotions": {"promotion_type": ["Seasonal", "Acquisition", "Retention", "Flash Sale", "Bundle"], "discount_type": ["Percentage", "Fixed"], "channel": ["Dine-In", "Takeaway", "Mobile App", "Website", "Delivery Partner", "All"]},
    "orders": {"ordering_channel": ["Dine-In", "Takeaway", "Mobile App", "Website", "Delivery Partner"], "order_status": ["Completed", "Cancelled", "Refunded"], "payment_method": ["Cash", "Card", "Mobile Wallet", "Bank Transfer"]},
    "pricing_history": {"change_reason": ["Inflation", "Supplier Cost", "Seasonal Adjustment", "Promotion End", "Menu Review"]},
    "inventory": {"stock_status": ["Low", "Normal"]},
    "wastage": {"reason": ["Expired", "Overproduction", "Damaged", "Preparation Error", "Unsold"]},
}
DATE_COLUMNS = {
    "customers": ["signup_date", "last_order_date"],
    "restaurants": ["opening_date"],
    "menu_items": ["launch_date"],
    "promotions": ["start_date", "end_date"],
    "orders": ["order_datetime"],
    "pricing_history": ["effective_from", "effective_to"],
    "ratings": ["rating_date"],
    "inventory": ["record_date"],
    "wastage": ["wastage_date"],
}


def _affected(frame, predicate):
    return frame.filter(predicate).count()


def _invalid_date_count(frame, column: str) -> int:
    if column not in frame.columns:
        return 0
    return _affected(frame, F.col(column).isNotNull() & F.to_date(F.col(column)).isNull())


def build_quarantine_policy(table: str) -> dict:
    rules = {
        "invalid_date": "quarantine rows with malformed or impossible dates because they cannot be safely interpreted",
        "negative_quantity": "quarantine rows with negative quantity so the event is excluded from production aggregates",
        "discount_exceeds_subtotal": "quarantine rows where discounts exceed the subtotal before a pricing exception is approved",
        "invalid_discount": "quarantine rows where discounts are negative or otherwise invalid before a pricing exception is approved",
        "bad_foreign_key": "quarantine orphaned references for manual review because the parent entity is missing",
        "unexpected_status": "quarantine rows with unrecognised lifecycle states until a valid status contract is confirmed",
    }
    return {
        "table": table,
        "execution": "profile_clean.py uses validate_table before legacy repairs; raw CSV is preserved",
        "validation_catalog": validation_catalog(table),
        "quarantine_rules": list(rules.keys()),
        "policy": rules,
        "repair_rules": [
            "keep one canonical record per primary key when duplicates are exact",
            "fill missing categorical channels with Unknown if the value is absent but the row is otherwise valid",
            "null invalid numeric values instead of inventing a replacement quantity or price",
            "recompute derived totals from validated source values when the source is trustworthy",
        ],
    }


def summarize_quality_issues(table: str, frame) -> dict:
    profile = profile_table(table, frame)
    policy = build_quarantine_policy(table)
    summary = {
        "table": table,
        "rows": profile["rows"],
        "duplicate_pk_rows_in_groups": profile["duplicate_pk_rows_in_groups"],
        "anomaly_summary": {issue: count for issue, count in profile["anomalies"].items() if count > 0},
        "quarantine_policy": policy,
    }
    return summary


def profile_table(table: str, frame) -> dict:
    row_count = frame.count()
    null_aggs = [F.sum(F.when(F.col(column).isNull(), 1).otherwise(0)).alias(column) for column in frame.columns]
    nulls = {column: int(count) for column, count in frame.agg(*null_aggs).first().asDict().items() if count}
    duplicates = (frame.groupBy(PK[table]).count().filter(F.col("count") > 1)
                  .agg(F.coalesce(F.sum("count"), F.lit(0))).first()[0])
    anomalies = {}
    for column in DATE_COLUMNS.get(table, []):
        invalid_date = _invalid_date_count(frame, column)
        if invalid_date:
            anomalies[f"invalid_date:{column}"] = invalid_date
            anomalies[f"invalid_{column}"] = invalid_date
    for column, allowed in DOMAINS.get(table, {}).items():
        anomalies[f"unexpected_categorical:{column}"] = _affected(
            frame, F.col(column).isNotNull() & ~F.col(column).isin(*allowed))
    if table == "orders":
        negative_discount = _affected(frame, F.col("discount_amount") < 0)
        excessive_discount = _affected(frame, F.col("discount_amount").isNotNull() & (F.col("discount_amount") > F.col("subtotal")))
        anomalies.update({
            "negative_discount": negative_discount,
            "discount_exceeds_subtotal": excessive_discount,
            "cancelled": _affected(frame, F.col("order_status") == "Cancelled"),
            "refunded": _affected(frame, F.col("order_status") == "Refunded"),
            "unexpected_channel": _affected(frame, ~F.col("ordering_channel").isin("Dine-In", "Takeaway", "Mobile App", "Website", "Delivery Partner") & F.col("ordering_channel").isNotNull()),
            "unexpected_status": _affected(frame, ~F.col("order_status").isin("Completed", "Cancelled", "Refunded")),
        })
    if table == "order_items":
        valid = F.col("quantity").isNotNull() & F.col("unit_price").isNotNull() & F.col("item_discount").isNotNull() & F.col("line_total").isNotNull()
        anomalies.update({
            "invalid_quantity": _affected(frame, F.col("quantity") <= 0),
            "invalid_price": _affected(frame, F.col("unit_price") <= 0),
            "invalid_item_discount": _affected(frame, F.col("item_discount") < 0),
            "discount_exceeds_line_total": _affected(frame, F.col("item_discount").isNotNull() & (F.col("item_discount") > F.col("unit_price") * F.col("quantity"))),
            "incorrect_line_total": _affected(frame, valid & (F.abs(F.col("line_total") - (F.col("quantity") * F.col("unit_price") - F.col("item_discount"))) > .011)),
        })
    if table == "ratings":
        for column in ("rating", "food_rating", "service_rating", "delivery_rating"):
            anomalies[f"invalid_{column}"] = _affected(frame, F.col(column).isNotNull() & ~F.col(column).between(1, 5))
    if table == "wastage":
        anomalies["negative_quantity"] = _affected(frame, F.col("quantity_wasted") < 0)
    if table == "menu_items":
        anomalies["nonpositive_base_price"] = _affected(frame, F.col("base_price") <= 0)
    return {"rows": row_count, "nulls": nulls, "duplicate_pk_rows_in_groups": int(duplicates or 0), "anomalies": anomalies}


def count_foreign_key_orphans(tables: dict) -> dict[str, int]:
    results = {}
    for child, relations in FOREIGN_KEYS.items():
        for column, parent in relations.items():
            if child not in tables or parent not in tables:
                continue
            orphans = (tables[child].filter(F.col(column).isNotNull())
                       .join(tables[parent].select(PK[parent]).distinct(), tables[child][column] == tables[parent][PK[parent]], "left_anti")
                       .count())
            results[f"{child}.{column}->{parent}"] = orphans
    return results


def apply_cleaning_rules(table: str, raw, audit: list, before: int | None = None):
    if table not in PK:
        raise ValueError(f"Unsupported quality table: {table}")
    frame = raw
    before = frame.count() if before is None else before
    duplicates = before - int(frame.select(PK[table]).distinct().count())
    if duplicates:
        frame = frame.dropDuplicates([PK[table]])
        audit.append({"table": table, "rule": "deduplicate_primary_key", "issue": "repeated primary key", "affected_records": duplicates, "action": "keep one record per key", "justification": "processed layer requires unique identifiers; raw records remain unchanged"})
    if table == "customers":
        count = _affected(frame, F.col("city").isNull())
        frame = frame.withColumn("city", F.coalesce("city", F.lit("Unknown")))
        if count:
            audit.append({"table": table, "rule": "fill_missing_city", "issue": "missing city", "affected_records": count, "action": "set city to Unknown", "justification": "retain customer while marking unavailable location explicitly"})
    if table == "orders":
        for column in DATE_COLUMNS.get(table, []):
            count = _invalid_date_count(frame, column)
            if count:
                frame = frame.withColumn(column, F.when(F.to_date(F.col(column)).isNotNull(), F.col(column)).otherwise(None))
                audit.append({"table": table, "rule": "null_invalid_date", "issue": f"invalid {column}", "affected_records": count, "action": f"set {column} to null", "justification": "invalid date values are not safe to use in analytics"})
        count = _affected(frame, F.col("ordering_channel").isNull())
        frame = frame.withColumn("ordering_channel", F.coalesce("ordering_channel", F.lit("Unknown")))
        if count:
            audit.append({"table": table, "rule": "fill_missing_channel", "issue": "missing ordering channel", "affected_records": count, "action": "set channel to Unknown", "justification": "preserve transaction without inventing a channel"})
        count = _affected(frame, F.col("discount_amount") < 0)
        frame = frame.withColumn("discount_amount", F.when(F.col("discount_amount") < 0, None).otherwise(F.col("discount_amount")))
        if count:
            audit.append({"table": table, "rule": "null_negative_discount", "issue": "negative discount", "affected_records": count, "action": "set discount to null", "justification": "negative discount is invalid and zero would claim no discount"})
        excessive = _affected(frame, F.col("discount_amount").isNotNull() & (F.col("discount_amount") > F.col("subtotal")))
        frame = frame.withColumn("discount_amount", F.when(F.col("discount_amount").isNotNull() & (F.col("discount_amount") > F.col("subtotal")), None).otherwise(F.col("discount_amount")))
        if excessive:
            audit.append({"table": table, "rule": "null_excessive_discount", "issue": "discount exceeds subtotal", "affected_records": excessive, "action": "set discount to null", "justification": "a discount cannot exceed the order subtotal without a separate pricing policy"})
    if table == "order_items":
        for column in ("quantity", "unit_price"):
            count = _affected(frame, F.col(column) <= 0)
            frame = frame.withColumn(column, F.when(F.col(column) <= 0, None).otherwise(F.col(column)))
            if count:
                audit.append({"table": table, "rule": f"null_invalid_{column}", "issue": f"nonpositive {column}", "affected_records": count, "action": f"set {column} to null", "justification": "do not fabricate a valid quantity or price"})
        count = _affected(frame, F.col("item_discount") < 0)
        frame = frame.withColumn("item_discount", F.when(F.col("item_discount") < 0, None).otherwise(F.col("item_discount")))
        if count:
            audit.append({"table": table, "rule": "null_negative_item_discount", "issue": "negative item discount", "affected_records": count, "action": "set item discount to null", "justification": "do not keep a discount that is not represented in the source record"})
        excessive = _affected(frame, F.col("item_discount").isNotNull() & (F.col("item_discount") > F.col("unit_price") * F.col("quantity")))
        frame = frame.withColumn("item_discount", F.when(F.col("item_discount").isNotNull() & (F.col("item_discount") > F.col("unit_price") * F.col("quantity")), None).otherwise(F.col("item_discount")))
        if excessive:
            audit.append({"table": table, "rule": "null_excessive_item_discount", "issue": "discount exceeds line value", "affected_records": excessive, "action": "set item discount to null", "justification": "a line discount cannot exceed the full line amount"})
        valid = F.col("quantity").isNotNull() & F.col("unit_price").isNotNull() & F.col("item_discount").isNotNull()
        count = _affected(frame, ~valid & F.col("line_total").isNotNull())
        if count:
            audit.append({"table": table, "rule": "null_unverifiable_line_total", "issue": "line total cannot be checked with invalid components", "affected_records": count, "action": "set line_total to null", "justification": "do not keep an amount that cannot be reconciled to its quantity, price and discount"})
        incorrect = _affected(frame, valid & F.col("line_total").isNotNull() & (F.abs(F.col("line_total") - (F.col("quantity") * F.col("unit_price") - F.col("item_discount"))) > .011))
        frame = frame.withColumn("line_total", F.when(valid, F.round(F.col("quantity") * F.col("unit_price") - F.col("item_discount"), 2)).otherwise(None))
        if incorrect:
            audit.append({"table": table, "rule": "recompute_line_total", "issue": "incorrect line total", "affected_records": incorrect, "action": "recompute from valid quantity, unit price and item discount", "justification": "line total is deterministic from source components"})
    if table == "menu_items":
        count = _affected(frame, F.col("base_price").isNull())
        if count:
            audit.append({"table": table, "rule": "retain_missing_base_price", "issue": "base price unavailable", "affected_records": count, "action": "preserve null base_price", "justification": "no reliable replacement price exists in the source; downstream logic can exclude or handle explicitly"})
    if table == "ratings":
        for column in ("rating", "food_rating", "service_rating", "delivery_rating"):
            count = _affected(frame, F.col(column).isNotNull() & ~F.col(column).between(1, 5))
            frame = frame.withColumn(column, F.when(F.col(column).between(1, 5), F.col(column)).otherwise(None))
            if count:
                audit.append({"table": table, "rule": f"null_out_of_range_{column}", "issue": f"{column} outside 1..5", "affected_records": count, "action": f"set {column} to null", "justification": "ratings outside documented five-point scale are invalid"})
        count = _affected(frame, F.col("food_rating").isNull())
        if count:
            audit.append({"table": table, "rule": "retain_missing_food_rating", "issue": "food rating unavailable", "affected_records": count, "action": "preserve null food_rating", "justification": "rating is not inferable from other review fields"})
    if table == "wastage":
        count = _affected(frame, F.col("quantity_wasted") < 0)
        frame = frame.withColumn("quantity_wasted", F.when(F.col("quantity_wasted") < 0, None).otherwise(F.col("quantity_wasted")))
        if count:
            audit.append({"table": table, "rule": "null_negative_wastage", "issue": "negative wastage", "affected_records": count, "action": "set quantity to null", "justification": "retain event without changing its sign or inventing a quantity"})
    return frame, duplicates


# New jobs validate before repair; legacy helpers above reproduce historical v4.
REQUIRED = {
    "customers": ["customer_id", "signup_date"],
    "restaurants": ["restaurant_id", "opening_date"],
    "menu_categories": ["category_id", "category_name"],
    "menu_items": ["menu_item_id", "category_id", "launch_date"],
    "promotions": ["promotion_id", "discount_type", "discount_value", "start_date", "end_date", "minimum_order_value"],
    "orders": ["order_id", "customer_id", "restaurant_id", "order_datetime", "order_status", "subtotal", "discount_amount", "tax_amount", "delivery_fee", "final_amount"],
    "order_items": ["order_item_id", "order_id", "menu_item_id", "quantity", "unit_price", "item_discount"],
    "pricing_history": ["price_history_id", "menu_item_id", "restaurant_id", "old_price", "new_price", "effective_from"],
    "ratings": ["rating_id", "order_id", "customer_id", "restaurant_id", "rating_date"],
    "inventory": ["inventory_id", "restaurant_id", "menu_item_id", "record_date", "opening_stock", "stock_received", "stock_used", "closing_stock", "reorder_level"],
    "wastage": ["wastage_id", "restaurant_id", "menu_item_id", "wastage_date", "quantity_wasted", "unit_cost"],
}
POSITIVE = {"menu_items": ["base_price", "cost_price", "preparation_time_min"], "order_items": ["quantity", "unit_price"], "pricing_history": ["old_price", "new_price"]}
NONNEGATIVE = {
    "customers": ["age", "loyalty_points"], "restaurants": ["seating_capacity"],
    "promotions": ["discount_value", "minimum_order_value"],
    "orders": ["subtotal", "discount_amount", "tax_amount", "delivery_fee", "final_amount"],
    "order_items": ["item_discount"],
    "inventory": ["opening_stock", "stock_received", "stock_used", "closing_stock", "reorder_level"],
    "wastage": ["quantity_wasted", "unit_cost"],
}
DATE_ORDER = {"customers": ("signup_date", "last_order_date"), "promotions": ("start_date", "end_date"), "pricing_history": ("effective_from", "effective_to")}
FORMULAS = {"order_items": ("line_total", "quantity * unit_price - item_discount"), "wastage": ("wastage_cost", "quantity_wasted * unit_cost")}
TABLE_ORDER = ("customers", "restaurants", "menu_categories", "menu_items", "promotions", "orders", "order_items", "pricing_history", "ratings", "inventory", "wastage")


def _contract(table):
    """One source for executable row checks and the published rule catalog."""
    checks = [("malformed_csv", "Malformed CSV record", F.col("_corrupt_record").isNotNull()),
              ("conflicting_primary_key", "Different source records share a primary key; quarantine all variants", F.col("_key_variants") > 1)]
    for c in REQUIRED[table]:
        checks.append((f"required:{c}", "Required value missing or unparseable", F.col(c).isNull()))
    for field in SCHEMAS[table]:
        c, kind = field.name, field.dataType.simpleString()
        if kind != "string":
            checks.append((f"invalid_type:{c}", f"Nonempty source must parse as {kind}", F.col(f"_present_{c}") & F.col(c).isNull()))
        if kind == "double":
            checks.append((f"nonfinite:{c}", "NaN and infinity are invalid", F.isnan(c) | (F.abs(F.col(c)) == float("inf"))))
    for c, allowed in DOMAINS.get(table, {}).items():
        checks.append((f"domain:{c}", f"Allowed nonmissing values: {', '.join(allowed)}", F.col(c).isNotNull() & ~F.col(c).isin(allowed)))
    for c in POSITIVE.get(table, []):
        checks.append((f"positive:{c}", "Present value must be greater than zero", F.col(c) <= 0))
    for c in NONNEGATIVE.get(table, []):
        checks.append((f"nonnegative:{c}", "Present value must be zero or greater", F.col(c) < 0))
    if table in DATE_ORDER:
        start, end = DATE_ORDER[table]
        checks.append(("date_order", f"{end} cannot precede {start}; optional end may be absent", F.col(end) < F.col(start)))
    if table == "orders":
        checks += [("discount_exceeds_subtotal", "Discount cannot exceed subtotal", F.col("discount_amount") > F.col("subtotal")),
                   ("order_total_mismatch", "Non-cancelled final = subtotal - discount + tax + delivery within PKR 0.011", (F.col("order_status") != "Cancelled") & (F.abs(F.col("final_amount") - F.expr("subtotal - discount_amount + tax_amount + delivery_fee")) > .011)),
                   ("cancelled_settlement", "Cancelled orders retain quoted subtotal but must have zero settled final amount", (F.col("order_status") == "Cancelled") & (F.abs(F.col("final_amount")) > .011))]
    if table == "order_items":
        checks.append(("discount_exceeds_line_value", "Discount cannot exceed quantity times unit price", F.col("item_discount") > F.col("quantity") * F.col("unit_price")))
    if table == "promotions":
        checks.append(("percentage_over_100", "Percentage discount cannot exceed 100", (F.col("discount_type") == "Percentage") & (F.col("discount_value") > 100)))
    if table == "ratings":
        for c in ("rating", "food_rating", "service_rating", "delivery_rating"):
            checks.append((f"rating_range:{c}", "Present rating must be in [1, 5]", F.col(c).isNotNull() & ~F.col(c).between(1, 5)))
    if table == "inventory":
        checks.append(("stock_balance", "Closing = opening + received - used", F.col("closing_stock") != F.expr("opening_stock + stock_received - stock_used")))
    if table in FORMULAS:
        expression = F.expr(FORMULAS[table][1])
        checks.append(("derived_nonfinite", "Derived amount must not overflow even when components are finite", F.isnan(expression) | (F.abs(expression) == float("inf"))))
    return checks


def validation_catalog(table):
    """Requires an active Spark session, as do the executable rule expressions."""
    rules = [{"id": name, "action": "quarantine", "description": description} for name, description, _ in _contract(table)]
    rules += [{"id": f"foreign_key:{c}", "action": "quarantine", "description": f"Nonmissing value must reference accepted {parent}.{PK[parent]}; rejected parents cascade"} for c, parent in FOREIGN_KEYS.get(table, {}).items()]
    rules.append({"id": "exact_duplicate", "action": "deduplicate", "description": "Collapse identical complete source records; count removed copies separately"})
    if table in FORMULAS:
        c, expression = FORMULAS[table]
        rules.append({"id": f"recompute:{c}", "action": "repair", "description": f"Recompute derived value as round({expression}, 2) after validation"})
    if table in ("customers", "orders"):
        c = "city" if table == "customers" else "ordering_channel"
        rules.append({"id": f"fill:{c}", "action": "repair", "description": "Missing becomes Unknown; unrecognized present domains are quarantined"})
    return rules


def read_quality_csv(session, table, path):
    """Preserve source tokens; header drift fails rather than reassigning fields."""
    from pyspark.sql.types import StructType, StructField, StringType
    from pathlib import Path
    source = Path(path)
    uri = source.as_uri() if source.is_absolute() else str(path)
    schema = StructType([StructField(c, StringType(), True) for c in SCHEMAS[table].fieldNames() + ["_corrupt_record"]])
    return (session.read.schema(schema).option("header", True).option("enforceSchema", False)
            .option("mode", "PERMISSIVE").option("multiLine", True)
            .option("columnNameOfCorruptRecord", "_corrupt_record").csv(uri)
            .withColumn("_source_file", F.input_file_name()))


def validate_table(table, raw, accepted_parents):
    """Return cached accepted/rejected frames and reconciled counts. Caller unpersists."""
    from pyspark.sql import Window
    columns = SCHEMAS[table].fieldNames()
    missing = set(columns) - set(raw.columns)
    if missing:
        raise ValueError(f"{table}: missing columns {sorted(missing)}")
    for parent in FOREIGN_KEYS.get(table, {}).values():
        if parent not in accepted_parents:
            raise ValueError(f"{table}: accepted parent {parent} is required")
    frame = raw
    if "_corrupt_record" not in frame.columns:
        frame = frame.withColumn("_corrupt_record", F.lit(None).cast("string"))
    if "_source_file" not in frame.columns:
        frame = frame.withColumn("_source_file", F.lit("in-memory fixture"))
    frame = frame.withColumn("_raw_record", F.to_json(F.struct(*columns), {"ignoreNullFields": "false"})).cache()
    before = frame.count()
    unique = frame.dropDuplicates(columns + ["_corrupt_record"])
    unique = unique.withColumn("_key_variants", F.count("*").over(Window.partitionBy(PK[table])))
    expressions, presence = [], []
    for field in SCHEMAS[table]:
        c, kind = field.name, field.dataType.simpleString()
        value = F.when(F.length(F.trim(F.col(c).cast("string"))) > 0, F.col(c).cast("string"))
        if kind == "string":
            expressions.append(value.alias(c))
        else:
            presence.append(value.isNotNull().alias(f"_present_{c}"))
            expressions.append(F.expr(f"try_cast(`{c}` as {kind})").alias(c))
    typed = unique.select(*expressions, *presence, "_key_variants", "_corrupt_record", "_source_file", "_raw_record")
    checks = _contract(table)
    for c, parent in FOREIGN_KEYS.get(table, {}).items():
        marker = f"_parent_{c}"
        keys = accepted_parents[parent].select(F.col(PK[parent]).alias(marker)).distinct()
        typed = typed.join(keys, typed[c] == keys[marker], "left")
        checks.append((f"foreign_key:{c}", "Missing accepted parent", F.col(c).isNotNull() & F.col(marker).isNull()))
    tagged = typed.withColumn("_quality_reasons", F.filter(F.array(*[
        F.when(F.coalesce(predicate, F.lit(False)), F.lit(name)) for name, _, predicate in checks
    ]), lambda value: value.isNotNull())).cache()
    metrics = tagged.agg(F.count("*").alias("unique_rows"), *[
        F.sum(F.when(F.array_contains("_quality_reasons", name), 1).otherwise(0)).alias(name)
        for name, _, _ in checks]).first().asDict()
    good, repairs = tagged.filter(F.size("_quality_reasons") == 0), {}
    if table in FORMULAS:
        c, expression = FORMULAS[table]
        expected = F.round(F.expr(expression), 2)
        repairs[f"recompute:{c}"] = good.filter(F.col(c).isNull() | (F.abs(F.col(c) - expected) > .011)).count()
        good = good.withColumn(c, expected)
    if table in ("customers", "orders"):
        c = "city" if table == "customers" else "ordering_channel"
        repairs[f"fill:{c}"] = good.filter(F.col(c).isNull()).count()
        good = good.withColumn(c, F.coalesce(c, F.lit("Unknown")))
    accepted = good.select(*columns).cache()
    rejected = tagged.filter(F.size("_quality_reasons") > 0).select(*columns, "_raw_record", "_source_file", "_corrupt_record", "_quality_reasons").cache()
    after, quarantined = accepted.count(), rejected.count()
    duplicates = before - metrics.pop("unique_rows")
    report = {"before_count": before, "accepted_count": after, "quarantine_count": quarantined,
              "exact_duplicate_copies_removed": duplicates, "accounting_passed": before == after + quarantined + duplicates,
              "rule_counts": {name: int(count or 0) for name, count in metrics.items()}, "repair_counts": repairs, "rules": validation_catalog(table)}
    tagged.unpersist()
    frame.unpersist()
    if not report["accounting_passed"]:
        raise RuntimeError(f"Row accounting failed for {table}: {report}")
    return accepted, rejected, report
