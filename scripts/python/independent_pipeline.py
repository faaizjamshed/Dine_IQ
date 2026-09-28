"""Independent pandas/NumPy analytics over frozen DineIQ CSVs.

The pipeline reads raw CSV files directly, applies the documented canonical v4
cleaning decisions locally, and never invokes Spark or reads Spark analytics.
Large order_items.csv is processed in bounded chunks.
"""
from __future__ import annotations

import argparse
import json
import math
import time
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "generated"
OUT = ROOT / "results" / "python"
V4_QUALITY = ROOT / "results" / "spark" / "quality_cleaning.json"
EXPECTED_COUNTS = {"customers": 75075, "orders": 650000, "order_items": 3000600, "menu_items": 200, "menu_categories": 15, "restaurants": 25, "pricing_history": 2992, "promotions": 80, "ratings": 220000, "inventory": 90000, "wastage": 110000}


def round_half_up(value: float, places: int = 2):
    if value is None or pd.isna(value) or not math.isfinite(float(value)):
        return None
    quantum = Decimal("1").scaleb(-places)
    return float(Decimal(str(float(value))).quantize(quantum, rounding=ROUND_HALF_UP))


def cents(values: pd.Series) -> np.ndarray:
    """Convert CSV dollar values to exact cent integers; nulls use a sentinel."""
    x = pd.to_numeric(values, errors="coerce").to_numpy(dtype="float64")
    out = np.zeros(len(x), dtype="int64")
    ok = np.isfinite(x)
    out[ok] = np.rint(x[ok] * 100).astype("int64")
    return out


def read_small(table: str, usecols=None, **kwargs) -> pd.DataFrame:
    return pd.read_csv(RAW / f"{table}.csv", usecols=usecols, low_memory=False, **kwargs)


def load_orders():
    cols = ["order_id", "customer_id", "restaurant_id", "promotion_id", "order_datetime", "ordering_channel", "order_status", "subtotal", "discount_amount", "final_amount"]
    orders = read_small("orders", usecols=cols, dtype={c: "string" for c in cols[:7]})
    before = len(orders)
    orders = orders.drop_duplicates("order_id", keep="first").copy()
    orders["ordering_channel"] = orders["ordering_channel"].fillna("Unknown")
    orders["discount_amount"] = pd.to_numeric(orders["discount_amount"], errors="coerce")
    negative_discounts=int((orders["discount_amount"]<0).sum())
    orders.loc[orders["discount_amount"] < 0, "discount_amount"] = np.nan
    for col in ("subtotal", "final_amount"):
        orders[col] = pd.to_numeric(orders[col], errors="coerce")
    orders["order_datetime"] = pd.to_datetime(orders["order_datetime"], errors="coerce")
    orders["_final_cents"] = cents(orders["final_amount"])
    orders["_subtotal_cents"] = cents(orders["subtotal"])
    orders["_discount_cents"] = cents(orders["discount_amount"]).astype("float64")
    orders.loc[orders["discount_amount"].isna(),"_discount_cents"] = np.nan
    orders["order_month"] = orders["order_datetime"].dt.strftime("%Y-%m")
    orders["weekday"] = ((orders["order_datetime"].dt.dayofweek + 1) % 7) + 1  # Spark dayofweek: Sunday=1
    orders["hour_of_day"] = orders["order_datetime"].dt.hour
    return orders, {"input_rows": before, "duplicate_primary_keys_removed": before - len(orders), "missing_channels_filled": int((orders["ordering_channel"] == "Unknown").sum()), "negative_discounts_nulled": negative_discounts}


def aggregate_orders(orders, customers, promotions, restaurants):
    completed = orders[orders["order_status"] == "Completed"].copy()
    out = {}

    def order_metrics(frame, key, count_name="orders", revenue_name="revenue", avg_name="avg_order_value"):
        rows = []
        for group_key, group in frame.groupby(key, dropna=False, sort=False):
            if not isinstance(group_key, tuple): group_key = (group_key,)
            row = dict(zip(key if isinstance(key, list) else [key], group_key))
            row[count_name] = int(group["order_id"].nunique())
            row[revenue_name] = round_half_up(group["_final_cents"].sum() / 100)
            row[avg_name] = round_half_up(group["_final_cents"].mean() / 100)
            rows.append(row)
        return pd.DataFrame(rows)

    rest_dim = restaurants[["restaurant_id", "restaurant_name", "city"]].drop_duplicates("restaurant_id")
    rest = order_metrics(completed, "restaurant_id").merge(rest_dim, on="restaurant_id", how="inner")
    rest = rest[["restaurant_id", "restaurant_name", "city", "orders", "revenue", "avg_order_value"]].rename(columns={"orders": "order_count"})
    out["restaurant_performance"] = rest

    channel_rows = []
    for channel, group in completed.groupby("ordering_channel", dropna=False, sort=False):
        channel_rows.append({"ordering_channel": channel, "orders": int(group["order_id"].nunique()), "avg_order_value": round_half_up(group["_final_cents"].mean() / 100), "completed_revenue": round_half_up(group["_final_cents"].sum() / 100)})
    out["channel_performance"] = pd.DataFrame(channel_rows)

    month_rows = []
    for month, group in orders.groupby("order_month", dropna=False, sort=True):
        done = group[group["order_status"] == "Completed"]
        month_rows.append({"order_month": month, "total_orders": int(group["order_id"].nunique()), "completed_orders": int(done["order_id"].nunique()), "completed_revenue": round_half_up(done["_final_cents"].sum() / 100)})
    out["monthly_demand"] = pd.DataFrame(month_rows)

    peaks = []
    for (weekday, hour), group in completed.groupby(["weekday", "hour_of_day"], sort=True):
        peaks.append({"weekday": int(weekday), "hour_of_day": int(hour), "orders": int(group["order_id"].nunique()), "avg_order_value": round_half_up(group["_final_cents"].mean() / 100)})
    out["weekday_peak_hour"] = pd.DataFrame(peaks)

    segment_dim = customers[["customer_id", "customer_segment"]].drop_duplicates("customer_id")
    customer_counts = segment_dim.groupby("customer_segment", dropna=False).customer_id.nunique().rename("customers").reset_index()
    customer_orders = completed.merge(segment_dim, on="customer_id", how="left", validate="many_to_one")
    metrics = []
    for segment, group in customer_orders.groupby("customer_segment", dropna=False, sort=False):
        metrics.append({"customer_segment": segment, "total_orders": int(group["order_id"].nunique()), "avg_order_value": round_half_up(group["_final_cents"].mean() / 100), "revenue": round_half_up(group["_final_cents"].sum() / 100)})
    segment_metrics=customer_counts.merge(pd.DataFrame(metrics), on="customer_segment", how="left")
    segment_metrics["total_orders"]=segment_metrics["total_orders"].fillna(0).astype("int64")
    out["customer_segment_behavior"] = segment_metrics

    promo_orders = completed[completed["promotion_id"].notna()]
    promo_agg = {}
    for pid, group in promo_orders.groupby("promotion_id", sort=False):
        disc = group["_discount_cents"].dropna()
        promo_agg[pid] = {"used_orders": int(group["order_id"].nunique()), "avg_subtotal": round_half_up(group["_subtotal_cents"].mean() / 100), "avg_discount": round_half_up(disc.mean() / 100) if len(disc) else None, "final_revenue": round_half_up(group["_final_cents"].sum() / 100)}
    p_rows = []
    for p in promotions.drop_duplicates("promotion_id").to_dict("records"):
        metrics = promo_agg.get(p["promotion_id"], {"used_orders": 0, "avg_subtotal": None, "avg_discount": None, "final_revenue": None})
        p_rows.append({"promotion_id": p["promotion_id"], "promotion_name": p["promotion_name"], **metrics})
    out["promotion_effectiveness"] = pd.DataFrame(p_rows)
    return out


def aggregate_items(orders, menu_items, categories, chunk_size: int):
    order_code = {value: i for i, value in enumerate(orders["order_id"].astype(str).tolist())}
    status_map = dict(zip(orders["order_id"].astype(str), orders["order_status"].astype(str)))
    menu_category = dict(zip(menu_items["menu_item_id"].astype(str), menu_items["category_id"].astype(str)))
    category_name = dict(zip(categories["category_id"].astype(str), categories["category_name"].astype(str)))
    item_names = dict(zip(menu_items["menu_item_id"].astype(str), menu_items["item_name"].astype(str)))
    item_acc = defaultdict(lambda: {"units": 0, "sales_cents": 0, "line_cents": 0, "line_count": 0, "price_cents": 0, "price_count": 0})
    item_orders = defaultdict(set)
    seen_ids = set()
    duplicate_count = invalid_q = invalid_price = no_total = recomputed = input_rows = 0
    cols = ["order_item_id", "order_id", "menu_item_id", "quantity", "unit_price", "item_discount", "line_total"]
    dtypes = {"order_item_id": "string", "order_id": "string", "menu_item_id": "string"}
    for chunk in pd.read_csv(RAW / "order_items.csv", usecols=cols, dtype=dtypes, chunksize=chunk_size, low_memory=False):
        input_rows += len(chunk)
        item_ids = chunk["order_item_id"].astype(str).to_numpy()
        keep = np.fromiter((key not in seen_ids for key in item_ids), dtype=bool, count=len(item_ids))
        duplicate_count += int((~keep).sum())
        seen_ids.update(item_ids[keep])
        chunk = chunk.loc[keep].copy()
        if chunk.empty: continue

        q = pd.to_numeric(chunk["quantity"], errors="coerce").to_numpy(dtype="float64").copy()
        price = pd.to_numeric(chunk["unit_price"], errors="coerce").to_numpy(dtype="float64").copy()
        discount = pd.to_numeric(chunk["item_discount"], errors="coerce").to_numpy(dtype="float64").copy()
        bad_q = ~np.isfinite(q) | (q <= 0)
        bad_p = ~np.isfinite(price) | (price <= 0)
        invalid_q += int(bad_q.sum()); invalid_price += int(bad_p.sum())
        valid = ~(bad_q | bad_p | ~np.isfinite(discount))
        q[bad_q] = np.nan; price[bad_p] = np.nan
        price_cents = np.zeros(len(chunk), dtype="int64"); price_cents[~bad_p] = np.rint(price[~bad_p] * 100).astype("int64")
        disc_cents = np.zeros(len(chunk), dtype="int64"); disc_ok = np.isfinite(discount); disc_cents[disc_ok] = np.rint(discount[disc_ok] * 100).astype("int64")
        line_cents = np.zeros(len(chunk), dtype="int64")
        q_int = np.zeros(len(chunk), dtype="int64"); q_int[~bad_q] = q[~bad_q].astype("int64")
        line_cents[valid] = q_int[valid] * price_cents[valid] - disc_cents[valid]
        no_total += int((~valid).sum())
        raw_line = pd.to_numeric(chunk["line_total"], errors="coerce").to_numpy(dtype="float64")
        mismatch = valid & np.isfinite(raw_line) & (np.abs(raw_line * 100 - line_cents) > 0.5)
        recomputed += int(mismatch.sum())

        chunk["_status"] = chunk["order_id"].astype(str).map(status_map)
        done = chunk["_status"].eq("Completed").to_numpy()
        chunk["_item"] = chunk["menu_item_id"].astype(str)
        chunk["_q"] = q
        chunk["_price"] = price
        chunk["_price_cents"] = price_cents
        chunk["_line_cents"] = np.where(valid, line_cents, 0)
        chunk["_line_valid"] = valid.astype("int64")
        chunk["_done"] = done
        chunk["_order_code"] = chunk["order_id"].astype(str).map(order_code)
        done_chunk = chunk.loc[done]
        for item_id, group in done_chunk.groupby("_item", sort=False):
            acc = item_acc[item_id]
            units = group["_q"].sum(min_count=1)
            if not pd.isna(units): acc["units"] += int(units)
            acc["sales_cents"] += int(group["_line_cents"].sum())
            acc["line_cents"] += int(group["_line_cents"].sum())
            acc["line_count"] += int(group["_line_valid"].sum())
            prices_valid = group.loc[group["_price"].notna(), "_price_cents"]
            acc["price_cents"] += int(prices_valid.sum())
            acc["price_count"] += int(len(prices_valid))
            item_orders[item_id].update(int(x) for x in group["_order_code"].dropna().unique())

    item_rows = []
    for item_id, acc in item_acc.items():
        cat_id = menu_category[item_id]
        item_rows.append({"menu_item_id": item_id, "item_name": item_names[item_id], "category_name": category_name[cat_id], "order_count": len(item_orders[item_id]), "units_sold": acc["units"], "gross_sales": round_half_up(acc["sales_cents"] / 100), "avg_unit_price": round_half_up(acc["price_cents"] / acc["price_count"] / 100) if acc["price_count"] else None, "_line_cents": acc["line_cents"], "_line_count": acc["line_count"]})
    items = pd.DataFrame(item_rows)
    category_sets = defaultdict(set)
    for item_id, values in item_orders.items(): category_sets[category_name[menu_category[item_id]]].update(values)
    cat_rows=[]
    for name, group in items.groupby("category_name", sort=False):
        line_cents=int(group["_line_cents"].sum()); line_count=int(group["_line_count"].sum())
        cat_rows.append({"category_name":name,"order_count":len(category_sets[name]),"units_sold":int(group["units_sold"].sum()),"gross_sales":round_half_up(group["gross_sales"].sum()),"avg_line_value":round_half_up(line_cents/line_count/100) if line_count else None})
    items=items.drop(columns=["_line_cents","_line_count"])
    categories_out=pd.DataFrame(cat_rows)
    audit={"input_rows":input_rows,"duplicate_primary_keys_removed":duplicate_count,"invalid_quantity_after_dedup":invalid_q,"invalid_price_after_dedup":invalid_price,"line_total_nulled_for_unusable_components":no_total,"valid_line_totals_recomputed":recomputed,"unique_order_item_ids":len(seen_ids),"chunk_size":chunk_size}
    return items,categories_out,audit


def aggregate_other(orders, raw_dir=RAW):
    out={}
    ratings=pd.read_csv(raw_dir/"ratings.csv",dtype={"rating_id":"string","restaurant_id":"string"},low_memory=False)
    ratings=ratings.drop_duplicates("rating_id",keep="first").copy()
    for col in ("rating","food_rating","service_rating","delivery_rating"):
        ratings[col]=pd.to_numeric(ratings[col],errors="coerce")
        ratings.loc[~ratings[col].between(1,5),col]=np.nan
    rows=[]
    for rid,g in ratings.groupby("restaurant_id",sort=False):
        rows.append({"restaurant_id":rid,"rating_count":int(len(g)),"avg_rating":round_half_up(g["rating"].mean(),3),"avg_food_rating":round_half_up(g["food_rating"].mean(),3),"avg_service_rating":round_half_up(g["service_rating"].mean(),3)})
    out["restaurant_ratings"]=pd.DataFrame(rows)

    wastage=pd.read_csv(raw_dir/"wastage.csv",low_memory=False)
    wastage=wastage.drop_duplicates("wastage_id",keep="first").copy()
    wastage["quantity_wasted"]=pd.to_numeric(wastage["quantity_wasted"],errors="coerce")
    wastage["wastage_cost"]=pd.to_numeric(wastage["wastage_cost"],errors="coerce")
    wastage.loc[wastage["quantity_wasted"]<0,"quantity_wasted"]=np.nan
    wastage=wastage[wastage["quantity_wasted"]>=0]
    out["wastage_by_reason"]=wastage.groupby("reason",sort=False).agg(records=("wastage_id","size"),quantity_wasted=("quantity_wasted","sum"),wastage_cost=("wastage_cost","sum")).reset_index()
    out["wastage_by_reason"]["quantity_wasted"]=out["wastage_by_reason"]["quantity_wasted"].map(round_half_up)
    out["wastage_by_reason"]["wastage_cost"]=out["wastage_by_reason"]["wastage_cost"].map(round_half_up)

    prices=pd.read_csv(raw_dir/"pricing_history.csv",low_memory=False)
    prices=prices.drop_duplicates("price_history_id",keep="first").copy()
    prices["old_price"]=pd.to_numeric(prices["old_price"],errors="coerce"); prices["new_price"]=pd.to_numeric(prices["new_price"],errors="coerce")
    prices["_delta"]=prices["new_price"]-prices["old_price"]
    prices["_pct"]=np.where(prices["old_price"]!=0,prices["_delta"]/prices["old_price"]*100,np.nan)
    p=prices.groupby("change_reason",sort=False).agg(changes=("price_history_id","size"),avg_price_change=("_delta","mean"),avg_percent_change=("_pct","mean")).reset_index()
    for col in ("avg_price_change","avg_percent_change"): p[col]=p[col].map(round_half_up)
    out["pricing_changes"]=p

    inventory=pd.read_csv(raw_dir/"inventory.csv",low_memory=False)
    inventory=inventory.drop_duplicates("inventory_id",keep="first").copy()
    inventory["closing_stock"]=pd.to_numeric(inventory["closing_stock"],errors="coerce")
    inv=inventory.groupby("stock_status",sort=False).agg(observations=("inventory_id","size"),avg_closing_stock=("closing_stock","mean")).reset_index()
    inv["avg_closing_stock"]=inv["avg_closing_stock"].map(round_half_up)
    out["inventory_status"]=inv
    return out


def jsonable(df):
    clean=df.copy()
    clean=clean.astype(object).where(pd.notna(clean),None)
    return clean.to_dict(orient="records")


def main():
    global RAW
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chunksize",type=int,default=150000)
    parser.add_argument("--raw-dir",type=Path,default=RAW)
    parser.add_argument("--output-dir",type=Path,default=OUT)
    args=parser.parse_args()
    RAW=args.raw_dir.resolve()
    if args.chunksize<1000: parser.error("--chunksize must be at least 1000")
    started=time.perf_counter()
    quality=json.loads(V4_QUALITY.read_text(encoding="utf-8"))
    audit_rules={x["rule"] for x in quality["cleaning_audit"]}
    required={"deduplicate_primary_key","fill_missing_city","fill_missing_channel","null_negative_discount","null_invalid_quantity","null_invalid_unit_price","null_unverifiable_line_total","recompute_line_total","null_out_of_range_rating","null_negative_wastage"}
    missing_rules=sorted(required-audit_rules)
    if missing_rules: raise RuntimeError(f"Canonical v4 cleaning rule audit is missing: {missing_rules}")

    customers=read_small("customers",usecols=["customer_id","customer_segment","city"],dtype={"customer_id":"string","customer_segment":"string","city":"string"}).drop_duplicates("customer_id",keep="first")
    customers["city"]=customers["city"].fillna("Unknown")
    menu_items=read_small("menu_items",usecols=["menu_item_id","category_id","item_name"],dtype="string").drop_duplicates("menu_item_id",keep="first")
    categories=read_small("menu_categories",usecols=["category_id","category_name"],dtype="string").drop_duplicates("category_id",keep="first")
    restaurants=read_small("restaurants",usecols=["restaurant_id","restaurant_name","city"],dtype="string").drop_duplicates("restaurant_id",keep="first")
    promotions=read_small("promotions",usecols=["promotion_id","promotion_name"],dtype="string").drop_duplicates("promotion_id",keep="first")
    orders,order_clean_audit=load_orders()
    analyses=aggregate_orders(orders,customers,promotions,restaurants)
    items,cat,items_audit=aggregate_items(orders,menu_items,categories,args.chunksize)
    analyses["menu_item_performance"]=items
    analyses["category_performance"]=cat
    analyses.update(aggregate_other(orders))

    args.output_dir.mkdir(parents=True,exist_ok=True)
    outputs={}
    for name,frame in analyses.items():
        frame=frame.sort_values(list(frame.columns[:1]),kind="stable",na_position="last").reset_index(drop=True)
        frame.to_csv(args.output_dir/f"{name}.csv",index=False)
        records=jsonable(frame)
        outputs[name]={"rows":len(frame),"csv":str((args.output_dir/f"{name}.csv").resolve()),"columns":list(frame.columns),"records":records}
    elapsed=round(time.perf_counter()-started,3)
    evidence={"pipeline":"independent pandas/NumPy from frozen raw CSV","source":"data/generated/*.csv","canonical_cleaning_reference":"results/spark/quality_cleaning.json (rules only; no Spark analytic values read)","spark_used_for_python_calculation":False,"python_version":__import__("sys").version.split()[0],"elapsed_seconds":elapsed,"chunk_size":args.chunksize,"expected_physical_rows":EXPECTED_COUNTS,"orders_cleaning_audit":order_clean_audit,"order_items_cleaning_audit":items_audit,"outputs":outputs}
    (args.output_dir/"pipeline.json").write_text(json.dumps(evidence,indent=2,ensure_ascii=False,default=str),encoding="utf-8")
    print(json.dumps({"status":"complete","elapsed_seconds":elapsed,"chunk_size":args.chunksize,"order_items":items_audit,"analyses":{k:v["rows"] for k,v in outputs.items()},"evidence":str(args.output_dir/"pipeline.json")},indent=2))


if __name__=="__main__":
    main()
