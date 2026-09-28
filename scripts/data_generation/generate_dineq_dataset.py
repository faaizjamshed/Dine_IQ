#!/usr/bin/env python3
"""
DineIQ Analytics synthetic dataset generator.

Modes:
  sample -> small 11-table dataset for validation
  full   -> competition-scale dataset with ~3,000,000 order-line rows

The generator first creates logically consistent restaurant data, then injects
a small, controlled amount of dirty data for downstream Spark data-quality work.
"""

from __future__ import annotations

import argparse
import json
import math
import random
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

ROOT = Path(__file__).resolve().parents[2]

CONFIG = {
    "sample": {
        "customers": 1000,
        "restaurants": 25,
        "categories": 12,
        "menu_items": 200,
        "orders": 5000,
        "order_items": 20000,
        "ratings": 2000,
        "wastage": 1500,
        "promotions": 30,
        "history_months": 18,
    },
    "full": {
        "customers": 75000,
        "restaurants": 25,
        "categories": 15,
        "menu_items": 200,
        "orders": 650000,
        "order_items": 3000000,
        "ratings": 220000,
        "wastage": 110000,
        "promotions": 80,
        "history_months": 18,
    },
}

CITIES = [
    ("Karachi", ["Clifton", "DHA", "Gulshan", "North Nazimabad", "Bahadurabad"]),
    ("Lahore", ["Gulberg", "DHA", "Johar Town", "Model Town"]),
    ("Islamabad", ["F-7", "F-10", "Blue Area", "G-11"]),
    ("Rawalpindi", ["Saddar", "Bahria Town"]),
    ("Faisalabad", ["D-Ground", "Canal Road"]),
    ("Multan", ["Gulgasht", "Cantt"]),
]

CATEGORY_NAMES = [
    "Burgers", "Pizza", "Pakistani", "BBQ", "Beverages",
    "Desserts", "Chinese", "Fast Food", "Breakfast", "Salads",
    "Pasta", "Seafood", "Sandwiches", "Rice", "Coffee & Tea",
]

ITEM_STEMS = [
    "Classic", "Spicy", "Smoky", "Grilled", "Crispy", "Cheesy", "Supreme",
    "Signature", "House", "Royal", "Tandoori", "Masala", "Creamy", "Loaded",
    "Fresh", "Double", "Special", "Fiery", "Herb", "Deluxe",
]

CHANNELS = ["Dine-In", "Takeaway", "Mobile App", "Website", "Delivery Partner"]
PAYMENTS = ["Cash", "Card", "Mobile Wallet", "Bank Transfer"]
SEGMENTS = ["New", "Regular", "Loyal", "High Value", "Occasional"]
WASTE_REASONS = ["Expired", "Overproduction", "Damaged", "Preparation Error", "Unsold"]
PRICE_REASONS = ["Inflation", "Supplier Cost", "Seasonal Adjustment", "Promotion End", "Menu Review"]

START_DATE = datetime(2025, 3, 1)
END_DATE = datetime(2026, 8, 31, 23, 59, 59)


def ids(prefix: str, n: int, width: int = 7) -> list[str]:
    return [f"{prefix}{i:0{width}d}" for i in range(1, n + 1)]


def random_datetimes(n: int) -> pd.DatetimeIndex:
    """Realistic dates with weekend + lunch/dinner weighting."""
    days = pd.date_range(START_DATE.date(), END_DATE.date(), freq="D")
    day_weights = np.array([1.28 if d.weekday() >= 5 else 1.0 for d in days], dtype=float)

    # Seasonal demand: Ramadan/Eid-like and year-end/summer variation, without
    # requiring exact holiday calendars.
    month_factor = {1: 1.02, 2: 0.98, 3: 1.08, 4: 1.14, 5: 1.05, 6: 1.08,
                    7: 1.04, 8: 1.02, 9: 1.00, 10: 1.06, 11: 1.12, 12: 1.18}
    day_weights *= np.array([month_factor[d.month] for d in days])
    day_weights /= day_weights.sum()

    chosen_days = np.random.choice(days.values, size=n, p=day_weights)

    # Peak-hour pattern: lunch and dinner dominate.
    hours = np.arange(24)
    hw = np.array([
        .02,.01,.01,.01,.01,.02,.04,.07,.10,.08,.06,.08,
        .15,.17,.13,.08,.08,.13,.18,.20,.18,.10,.05,.03
    ])
    hw /= hw.sum()
    chosen_hours = np.random.choice(hours, size=n, p=hw)
    minutes = np.random.randint(0, 60, size=n)
    seconds = np.random.randint(0, 60, size=n)

    return pd.to_datetime(chosen_days) + pd.to_timedelta(chosen_hours, unit="h") + \
           pd.to_timedelta(minutes, unit="m") + pd.to_timedelta(seconds, unit="s")


def make_categories(n: int) -> pd.DataFrame:
    names = CATEGORY_NAMES[:n]
    return pd.DataFrame({
        "category_id": ids("CAT", n, 3),
        "category_name": names,
        "description": [f"{x} menu category" for x in names],
        "is_active": True,
    })


def make_restaurants(n: int) -> pd.DataFrame:
    rows = []
    rid = ids("R", n, 3)
    location_pairs = [(c, a) for c, areas in CITIES for a in areas]
    for i in range(n):
        city, area = location_pairs[i % len(location_pairs)]
        rows.append({
            "restaurant_id": rid[i],
            "restaurant_name": f"DineIQ {area}",
            "city": city,
            "area": area,
            "opening_date": (START_DATE - timedelta(days=random.randint(180, 2500))).date(),
            "seating_capacity": random.randint(40, 180),
            "location_type": random.choice(["High Street", "Mall", "Commercial", "Residential"]),
            "is_active": True,
        })
    return pd.DataFrame(rows)


def make_menu(categories: pd.DataFrame, n: int) -> pd.DataFrame:
    category_ids = categories["category_id"].tolist()
    rows = []
    used = {}
    for i, mid in enumerate(ids("M", n, 4)):
        cid = category_ids[i % len(category_ids)]
        cname = categories.loc[categories["category_id"] == cid, "category_name"].iloc[0]
        used[cname] = used.get(cname, 0) + 1
        stem = ITEM_STEMS[(i * 7) % len(ITEM_STEMS)]
        item_name = f"{stem} {cname.rstrip('s')} {used[cname]}"
        base = round(random.uniform(180, 1800) / 10) * 10
        cost = round(base * random.uniform(.35, .62), 2)
        rows.append({
            "menu_item_id": mid,
            "category_id": cid,
            "item_name": item_name,
            "base_price": float(base),
            "cost_price": cost,
            "preparation_time_min": random.randint(5, 45),
            "is_vegetarian": random.random() < .28,
            "is_available": random.random() > .03,
            "launch_date": (START_DATE + timedelta(days=random.randint(0, 365))).date(),
        })
    return pd.DataFrame(rows)


def make_customers(n: int) -> pd.DataFrame:
    customer_ids = ids("C", n, 7)
    cities = [x[0] for x in CITIES]
    signup_days = np.random.randint(0, (END_DATE - START_DATE).days, n)
    signup = pd.to_datetime(START_DATE) + pd.to_timedelta(signup_days, unit="D")
    churn = np.random.random(n) < .16
    return pd.DataFrame({
        "customer_id": customer_ids,
        "customer_name": [f"Customer {i:07d}" for i in range(1, n + 1)],
        "gender": np.random.choice(["Female", "Male", "Other"], n, p=[.47, .52, .01]),
        "age": np.random.randint(18, 70, n),
        "city": np.random.choice(cities, n),
        "signup_date": signup.date,
        "customer_segment": np.random.choice(SEGMENTS, n, p=[.18,.34,.24,.09,.15]),
        "preferred_channel": np.random.choice(CHANNELS, n, p=[.22,.14,.30,.12,.22]),
        "loyalty_points": np.random.randint(0, 10000, n),
        "is_churned": churn,
        "last_order_date": pd.NaT,
    })


def make_promotions(n: int) -> pd.DataFrame:
    rows = []
    for i, pid in enumerate(ids("P", n, 4)):
        start = START_DATE + timedelta(days=random.randint(0, max(1, (END_DATE - START_DATE).days - 45)))
        end = min(start + timedelta(days=random.randint(5, 45)), END_DATE)
        dtype = random.choice(["Percentage", "Fixed"])
        value = random.choice([5, 10, 15, 20, 25, 30]) if dtype == "Percentage" else random.choice([100,150,200,300,500])
        rows.append({
            "promotion_id": pid,
            "promotion_name": f"Campaign {i+1:03d}",
            "promotion_type": random.choice(["Seasonal", "Acquisition", "Retention", "Flash Sale", "Bundle"]),
            "discount_type": dtype,
            "discount_value": value,
            "start_date": start.date(),
            "end_date": end.date(),
            "minimum_order_value": random.choice([0, 500, 750, 1000, 1500, 2000]),
            "channel": random.choice(CHANNELS + ["All"]),
            "is_active": end >= END_DATE - timedelta(days=30),
        })
    return pd.DataFrame(rows)


def make_orders(cfg, customers, restaurants, promotions):
    n = cfg["orders"]
    order_ids = ids("O", n, 8)
    dts = random_datetimes(n)

    # Heavy-tailed customer activity: a minority of customers order frequently.
    customer_pool = customers["customer_id"].to_numpy()
    ranks = np.arange(1, len(customer_pool) + 1)
    weights = 1 / np.power(ranks, .55)
    weights /= weights.sum()
    cust = np.random.choice(customer_pool, n, p=weights)

    rest = np.random.choice(restaurants["restaurant_id"], n)
    channels = np.random.choice(CHANNELS, n, p=[.24,.14,.29,.11,.22])
    statuses = np.random.choice(["Completed", "Cancelled", "Refunded"], n, p=[.94,.045,.015])
    promo_used = np.random.random(n) < .28
    promo_ids = np.where(promo_used, np.random.choice(promotions["promotion_id"], n), None)

    orders = pd.DataFrame({
        "order_id": order_ids,
        "customer_id": cust,
        "restaurant_id": rest,
        "promotion_id": promo_ids,
        "order_datetime": dts,
        "ordering_channel": channels,
        "order_status": statuses,
        "subtotal": 0.0,
        "discount_amount": 0.0,
        "tax_amount": 0.0,
        "delivery_fee": 0.0,
        "final_amount": 0.0,
        "payment_method": np.random.choice(PAYMENTS, n, p=[.30,.35,.27,.08]),
    })
    return orders


def item_counts_for_orders(n_orders: int, target_lines: int) -> np.ndarray:
    if target_lines < n_orders:
        raise ValueError("order_items target must be >= number of orders")
    counts = np.ones(n_orders, dtype=np.int32)
    remaining = target_lines - n_orders
    # Distribute remaining lines in chunks; guarantees exact target.
    while remaining > 0:
        batch = min(remaining, n_orders * 3)
        chosen = np.random.randint(0, n_orders, size=batch)
        np.add.at(counts, chosen, 1)
        remaining -= batch
    return counts


def make_order_items(cfg, orders, menu):
    target = cfg["order_items"]
    counts = item_counts_for_orders(len(orders), target)
    order_ids = np.repeat(orders["order_id"].to_numpy(), counts)

    # Popularity follows a Zipf-like distribution.
    mids = menu["menu_item_id"].to_numpy()
    ranks = np.arange(1, len(mids) + 1)
    pop = 1 / np.power(ranks, .72)
    pop /= pop.sum()
    chosen_mid = np.random.choice(mids, target, p=pop)

    price_map = menu.set_index("menu_item_id")["base_price"]
    prices = pd.Series(chosen_mid).map(price_map).to_numpy(dtype=float)
    # Small restaurant/time-like price variation.
    prices = np.round(prices * np.random.choice([.95, 1.0, 1.0, 1.0, 1.05], target), 2)
    qty = np.random.choice([1,2,3,4,5], target, p=[.63,.25,.075,.03,.015]).astype(np.int16)
    item_disc = np.where(np.random.random(target) < .12,
                         np.round(prices * qty * np.random.choice([.05,.10,.15], target), 2), 0.0)
    line_total = np.round(prices * qty - item_disc, 2)

    return pd.DataFrame({
        "order_item_id": ids("OI", target, 9),
        "order_id": order_ids,
        "menu_item_id": chosen_mid,
        "quantity": qty,
        "unit_price": prices,
        "item_discount": item_disc,
        "line_total": line_total,
        "special_request": np.where(np.random.random(target) < .06, "Customer request", None),
    })


def update_order_totals(orders, order_items, promotions):
    agg = order_items.groupby("order_id", sort=False)["line_total"].sum()
    orders["subtotal"] = orders["order_id"].map(agg).fillna(0).round(2)

    promo = promotions.set_index("promotion_id")[["discount_type", "discount_value", "minimum_order_value"]]
    ptype = orders["promotion_id"].map(promo["discount_type"])
    pval = orders["promotion_id"].map(promo["discount_value"]).fillna(0)
    pmin = orders["promotion_id"].map(promo["minimum_order_value"]).fillna(0)
    eligible = orders["subtotal"] >= pmin
    disc = np.where(
        eligible & (ptype == "Percentage"),
        orders["subtotal"] * pval / 100,
        np.where(eligible & (ptype == "Fixed"), pval, 0)
    )
    orders["discount_amount"] = np.minimum(np.round(disc, 2), orders["subtotal"])
    taxable = orders["subtotal"] - orders["discount_amount"]
    orders["tax_amount"] = np.round(taxable * .15, 2)
    delivery = orders["ordering_channel"].isin(["Mobile App", "Website", "Delivery Partner"])
    orders["delivery_fee"] = np.where(delivery, np.random.choice([0,80,100,120,150], len(orders)), 0)
    orders["final_amount"] = np.round(taxable + orders["tax_amount"] + orders["delivery_fee"], 2)

    # Cancelled orders have zero settled final amount while preserving original subtotal.
    orders.loc[orders["order_status"] == "Cancelled", "final_amount"] = 0.0
    return orders


def update_customer_last_order(customers, orders):
    completed = orders.loc[orders["order_status"] == "Completed"]
    last = completed.groupby("customer_id")["order_datetime"].max()
    customers["last_order_date"] = customers["customer_id"].map(last)
    cutoff = END_DATE - timedelta(days=120)
    customers.loc[customers["last_order_date"].notna() &
                  (pd.to_datetime(customers["last_order_date"]) < cutoff), "is_churned"] = True
    return customers


def make_pricing_history(menu, restaurants, mode):
    # Full: roughly 2-4 price changes/item across locations subset.
    rows = []
    seq = 1
    restaurant_ids = restaurants["restaurant_id"].tolist()
    for _, item in menu.iterrows():
        selected = random.sample(restaurant_ids, k=min(5 if mode == "full" else 2, len(restaurant_ids)))
        for rid in selected:
            old = float(item["base_price"])
            changes = random.randint(2, 4)
            points = sorted(random.sample(range(30, max(31, (END_DATE - START_DATE).days - 20)), changes))
            for j, day in enumerate(points):
                new = round(old * random.uniform(1.02, 1.12), 2)
                eff_from = START_DATE + timedelta(days=day)
                eff_to = (START_DATE + timedelta(days=points[j+1]-1)).date() if j+1 < len(points) else None
                rows.append({
                    "price_history_id": f"PH{seq:08d}",
                    "menu_item_id": item["menu_item_id"],
                    "restaurant_id": rid,
                    "old_price": old,
                    "new_price": new,
                    "effective_from": eff_from.date(),
                    "effective_to": eff_to,
                    "change_reason": random.choice(PRICE_REASONS),
                })
                seq += 1
                old = new
    return pd.DataFrame(rows)


def make_ratings(cfg, orders):
    eligible = orders.loc[orders["order_status"] == "Completed"]
    n = min(cfg["ratings"], len(eligible))
    sampled = eligible.sample(n=n, replace=False, random_state=SEED).copy()

    # Mostly positive, with tails/anomalies to support analysis.
    overall = np.random.choice([1,2,3,4,5], n, p=[.04,.07,.15,.34,.40])
    food = np.clip(overall + np.random.choice([-1,0,0,0,1], n), 1, 5)
    service = np.clip(overall + np.random.choice([-1,0,0,1], n), 1, 5)
    delivery = np.clip(overall + np.random.choice([-1,0,0,1], n), 1, 5).astype(float)
    dine_in = sampled["ordering_channel"].eq("Dine-In").to_numpy()
    delivery[dine_in] = np.nan

    rating_dates = pd.to_datetime(sampled["order_datetime"]) + pd.to_timedelta(np.random.randint(0, 8, n), unit="D")
    return pd.DataFrame({
        "rating_id": ids("RT", n, 8),
        "order_id": sampled["order_id"].to_numpy(),
        "customer_id": sampled["customer_id"].to_numpy(),
        "restaurant_id": sampled["restaurant_id"].to_numpy(),
        "rating": overall,
        "food_rating": food,
        "service_rating": service,
        "delivery_rating": delivery,
        "review_text": np.where(np.random.random(n) < .18, "Customer review", None),
        "rating_date": rating_dates.dt.date,
    })


def make_inventory(cfg, restaurants, menu, mode):
    # Monthly snapshots keep the table useful without exploding file size.
    dates = pd.date_range(START_DATE.date(), END_DATE.date(), freq="MS")
    if mode == "sample":
        dates = dates[:3]
    rows = []
    seq = 1
    for dt in dates:
        for rid in restaurants["restaurant_id"]:
            # full mode covers all items monthly; sample covers a subset
            mids = menu["menu_item_id"] if mode == "full" else menu["menu_item_id"].head(40)
            for mid in mids:
                opening = random.randint(20, 250)
                received = random.randint(10, 180)
                used = random.randint(0, opening + received)
                closing = opening + received - used
                reorder = random.randint(15, 60)
                status = "Low" if closing <= reorder else "Normal"
                rows.append({
                    "inventory_id": f"INV{seq:09d}",
                    "restaurant_id": rid,
                    "menu_item_id": mid,
                    "record_date": dt.date(),
                    "opening_stock": opening,
                    "stock_received": received,
                    "stock_used": used,
                    "closing_stock": closing,
                    "reorder_level": reorder,
                    "stock_status": status,
                })
                seq += 1
    return pd.DataFrame(rows)


def make_wastage(cfg, restaurants, menu):
    n = cfg["wastage"]
    mids = np.random.choice(menu["menu_item_id"], n)
    cost_map = menu.set_index("menu_item_id")["cost_price"]
    unit_cost = pd.Series(mids).map(cost_map).to_numpy(dtype=float)
    qty = np.round(np.random.gamma(shape=1.8, scale=1.2, size=n), 2)
    qty = np.maximum(qty, .05)
    dates = pd.to_datetime(np.random.choice(pd.date_range(START_DATE.date(), END_DATE.date(), freq="D"), n))
    return pd.DataFrame({
        "wastage_id": ids("W", n, 8),
        "restaurant_id": np.random.choice(restaurants["restaurant_id"], n),
        "menu_item_id": mids,
        "wastage_date": dates.date,
        "quantity_wasted": qty,
        "unit_cost": np.round(unit_cost, 2),
        "wastage_cost": np.round(qty * unit_cost, 2),
        "reason": np.random.choice(WASTE_REASONS, n, p=[.25,.28,.10,.17,.20]),
    })


def inject_dirty_data(tables: dict[str, pd.DataFrame]) -> dict:
    """
    Controlled corruption. Rates are deliberately small so most records remain
    realistic and usable. A manifest records exactly what was injected.
    """
    manifest = {}
    rng = np.random.default_rng(SEED + 100)

    def choose(df, frac, minimum=1):
        k = max(minimum, int(len(df) * frac))
        return rng.choice(df.index.to_numpy(), size=min(k, len(df)), replace=False)

    # Customers: missing city / duplicate rows
    df = tables["customers"]
    ix = choose(df, .003)
    df.loc[ix, "city"] = None
    dup = df.sample(n=max(1, int(len(df)*.001)), random_state=7)
    tables["customers"] = pd.concat([df, dup], ignore_index=True)
    manifest["customers"] = {"missing_city": len(ix), "duplicate_rows": len(dup)}

    # Orders: missing channels and a few impossible negative discounts.
    df = tables["orders"]
    ix1 = choose(df, .002)
    df.loc[ix1, "ordering_channel"] = None
    ix2 = choose(df, .0005)
    df.loc[ix2, "discount_amount"] = -50.0
    manifest["orders"] = {"missing_channel": len(ix1), "negative_discount": len(ix2)}

    # Order items: invalid quantities/prices/totals and duplicates.
    df = tables["order_items"]
    iq = choose(df, .0005)
    ip = choose(df, .0004)
    it = choose(df, .0005)
    df.loc[iq, "quantity"] = -1
    df.loc[ip, "unit_price"] = -100.0
    df.loc[it, "line_total"] = df.loc[it, "line_total"] + 999.0
    dup_n = max(1, int(len(df)*.0002))
    dup = df.sample(n=dup_n, random_state=8)
    tables["order_items"] = pd.concat([df, dup], ignore_index=True)
    manifest["order_items"] = {
        "invalid_quantity": len(iq), "invalid_price": len(ip),
        "incorrect_line_total": len(it), "duplicate_rows": len(dup)
    }

    # Ratings: a few invalid >5 ratings and missing food ratings.
    df = tables["ratings"]
    ir = choose(df, .001)
    im = choose(df, .002)
    df.loc[ir, "rating"] = 6
    df.loc[im, "food_rating"] = np.nan
    manifest["ratings"] = {"invalid_rating": len(ir), "missing_food_rating": len(im)}

    # Wastage: negative quantities are intentional dirty records only.
    df = tables["wastage"]
    iw = choose(df, .0005)
    df.loc[iw, "quantity_wasted"] = -1.0
    manifest["wastage"] = {"invalid_negative_quantity": len(iw)}

    # Menu: missing base price in a tiny fraction.
    df = tables["menu_items"]
    imenu = choose(df, .005)
    df.loc[imenu, "base_price"] = np.nan
    manifest["menu_items"] = {"missing_base_price": len(imenu)}

    return manifest


def validate_clean_logic(tables):
    """Validate relationships and key business rules before dirty injection."""
    checks = {}

    def unique(df, col):
        return bool(df[col].is_unique and df[col].notna().all())

    checks["customers_pk"] = unique(tables["customers"], "customer_id")
    checks["restaurants_pk"] = unique(tables["restaurants"], "restaurant_id")
    checks["categories_pk"] = unique(tables["menu_categories"], "category_id")
    checks["menu_items_pk"] = unique(tables["menu_items"], "menu_item_id")
    checks["promotions_pk"] = unique(tables["promotions"], "promotion_id")
    checks["orders_pk"] = unique(tables["orders"], "order_id")
    checks["order_items_pk"] = unique(tables["order_items"], "order_item_id")
    checks["ratings_pk"] = unique(tables["ratings"], "rating_id")
    checks["inventory_pk"] = unique(tables["inventory"], "inventory_id")
    checks["wastage_pk"] = unique(tables["wastage"], "wastage_id")
    checks["pricing_history_pk"] = unique(tables["pricing_history"], "price_history_id")

    checks["orders_customer_fk"] = tables["orders"]["customer_id"].isin(tables["customers"]["customer_id"]).all()
    checks["orders_restaurant_fk"] = tables["orders"]["restaurant_id"].isin(tables["restaurants"]["restaurant_id"]).all()
    checks["order_items_order_fk"] = tables["order_items"]["order_id"].isin(tables["orders"]["order_id"]).all()
    checks["order_items_menu_fk"] = tables["order_items"]["menu_item_id"].isin(tables["menu_items"]["menu_item_id"]).all()
    checks["menu_category_fk"] = tables["menu_items"]["category_id"].isin(tables["menu_categories"]["category_id"]).all()
    checks["ratings_order_fk"] = tables["ratings"]["order_id"].isin(tables["orders"]["order_id"]).all()
    checks["inventory_restaurant_fk"] = tables["inventory"]["restaurant_id"].isin(tables["restaurants"]["restaurant_id"]).all()
    checks["inventory_menu_fk"] = tables["inventory"]["menu_item_id"].isin(tables["menu_items"]["menu_item_id"]).all()
    checks["wastage_nonnegative"] = (tables["wastage"]["quantity_wasted"] >= 0).all()
    checks["inventory_formula"] = (
        tables["inventory"]["closing_stock"] ==
        tables["inventory"]["opening_stock"] + tables["inventory"]["stock_received"] - tables["inventory"]["stock_used"]
    ).all()
    checks["line_total_formula"] = np.allclose(
        tables["order_items"]["line_total"],
        tables["order_items"]["quantity"] * tables["order_items"]["unit_price"] - tables["order_items"]["item_discount"],
        atol=.011
    )
    return {k: bool(v) for k, v in checks.items()}


def write_csv(df: pd.DataFrame, path: Path):
    df.to_csv(path, index=False, date_format="%Y-%m-%d %H:%M:%S")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["sample", "full"], default="sample")
    args = parser.parse_args()
    mode = args.mode
    cfg = CONFIG[mode]

    out_dir = ROOT / "data" / ("sample" if mode == "sample" else "generated")
    out_dir.mkdir(parents=True, exist_ok=True)
    result_dir = ROOT / "results" / "generation"
    result_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n=== DineIQ Dataset Generator | mode={mode.upper()} ===")
    print(f"Output: {out_dir}")
    print(f"Seed: {SEED}\n")

    print("[1/11] Menu categories...")
    categories = make_categories(cfg["categories"])
    print("[2/11] Restaurants...")
    restaurants = make_restaurants(cfg["restaurants"])
    print("[3/11] Menu items...")
    menu = make_menu(categories, cfg["menu_items"])
    print("[4/11] Customers...")
    customers = make_customers(cfg["customers"])
    print("[5/11] Promotions...")
    promotions = make_promotions(cfg["promotions"])
    print("[6/11] Orders...")
    orders = make_orders(cfg, customers, restaurants, promotions)
    print(f"[7/11] Order items ({cfg['order_items']:,} target rows)...")
    order_items = make_order_items(cfg, orders, menu)
    orders = update_order_totals(orders, order_items, promotions)
    customers = update_customer_last_order(customers, orders)
    print("[8/11] Pricing history...")
    pricing = make_pricing_history(menu, restaurants, mode)
    print("[9/11] Ratings...")
    ratings = make_ratings(cfg, orders)
    print("[10/11] Inventory...")
    inventory = make_inventory(cfg, restaurants, menu, mode)
    print("[11/11] Wastage...")
    wastage = make_wastage(cfg, restaurants, menu)

    tables = {
        "customers": customers,
        "orders": orders,
        "order_items": order_items,
        "menu_items": menu,
        "menu_categories": categories,
        "restaurants": restaurants,
        "pricing_history": pricing,
        "promotions": promotions,
        "ratings": ratings,
        "inventory": inventory,
        "wastage": wastage,
    }

    print("\nValidating clean base dataset...")
    clean_checks = validate_clean_logic(tables)
    failed = [k for k, v in clean_checks.items() if not v]
    if failed:
        raise RuntimeError(f"Clean dataset validation failed: {failed}")
    print("Clean base validation: PASS")

    print("Injecting controlled dirty-data cases...")
    dirty_manifest = inject_dirty_data(tables)

    print("Writing 11 CSV files...")
    for name, df in tables.items():
        write_csv(df, out_dir / f"{name}.csv")
        print(f"  {name:20s} {len(df):>12,} rows")

    summary = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "mode": mode,
        "seed": SEED,
        "history_start": str(START_DATE.date()),
        "history_end": str(END_DATE.date()),
        "table_counts_after_dirty_injection": {k: int(len(v)) for k, v in tables.items()},
        "clean_base_validation": clean_checks,
        "dirty_data_manifest": dirty_manifest,
        "notes": [
            "Ordering channel is stored in Orders, not as a separate table.",
            "Base dataset is validated before controlled dirty-data injection.",
            "Parquet is intentionally produced later by the Spark processing pipeline."
        ],
    }
    summary_path = result_dir / f"generation_summary_{mode}.json"
    summary_path.write_text(json.dumps(summary, indent=2, default=str), encoding="utf-8")

    print(f"\nGeneration summary: {summary_path}")
    print("=== DineIQ generation COMPLETE ===\n")


if __name__ == "__main__":
    main()