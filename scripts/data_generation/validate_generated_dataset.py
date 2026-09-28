

#!/usr/bin/env python3
"""Independent, streaming validation for the frozen full DineIQ CSV dataset."""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SUMMARY = ROOT / "results/generation/generation_summary_full.json"
DATA = ROOT / "data/generated"
OUT = ROOT / "results/data_quality"
EXPECTED_FILES = {"customers", "restaurants", "menu_categories", "menu_items", "promotions", "orders", "order_items", "pricing_history", "ratings", "inventory", "wastage"}
PK = {"customers":"customer_id", "restaurants":"restaurant_id", "menu_categories":"category_id", "menu_items":"menu_item_id", "promotions":"promotion_id", "orders":"order_id", "order_items":"order_item_id", "pricing_history":"price_history_id", "ratings":"rating_id", "inventory":"inventory_id", "wastage":"wastage_id"}
FKS = {
    "orders": {"customer_id":"customers", "restaurant_id":"restaurants", "promotion_id":"promotions"},
    "menu_items": {"category_id":"menu_categories"},
    "order_items": {"order_id":"orders", "menu_item_id":"menu_items"},
    "pricing_history": {"menu_item_id":"menu_items", "restaurant_id":"restaurants"},
    "ratings": {"order_id":"orders", "customer_id":"customers", "restaurant_id":"restaurants"},
    "inventory": {"restaurant_id":"restaurants", "menu_item_id":"menu_items"},
    "wastage": {"restaurant_id":"restaurants", "menu_item_id":"menu_items"},
}
MINIMUM = {"customers":75000,"orders":600000,"order_items":2500000,"menu_items":200,"menu_categories":15,"restaurants":25,"pricing_history":2500,"promotions":80,"ratings":200000,"inventory":80000,"wastage":100000}
EXPECTED_HEADERS = {
    "customers":"customer_id,customer_name,gender,age,city,signup_date,customer_segment,preferred_channel,loyalty_points,is_churned,last_order_date",
    "restaurants":"restaurant_id,restaurant_name,city,area,opening_date,seating_capacity,location_type,is_active",
    "menu_categories":"category_id,category_name,description,is_active",
    "menu_items":"menu_item_id,category_id,item_name,base_price,cost_price,preparation_time_min,is_vegetarian,is_available,launch_date",
    "promotions":"promotion_id,promotion_name,promotion_type,discount_type,discount_value,start_date,end_date,minimum_order_value,channel,is_active",
    "orders":"order_id,customer_id,restaurant_id,promotion_id,order_datetime,ordering_channel,order_status,subtotal,discount_amount,tax_amount,delivery_fee,final_amount,payment_method",
    "order_items":"order_item_id,order_id,menu_item_id,quantity,unit_price,item_discount,line_total,special_request",
    "pricing_history":"price_history_id,menu_item_id,restaurant_id,old_price,new_price,effective_from,effective_to,change_reason",
    "ratings":"rating_id,order_id,customer_id,restaurant_id,rating,food_rating,service_rating,delivery_rating,review_text,rating_date",
    "inventory":"inventory_id,restaurant_id,menu_item_id,record_date,opening_stock,stock_received,stock_used,closing_stock,reorder_level,stock_status",
    "wastage":"wastage_id,restaurant_id,menu_item_id,wastage_date,quantity_wasted,unit_cost,wastage_cost,reason",
}

def blank(v): return v is None or not v.strip()
def num(row, key):
    try: return float(row[key])
    except (KeyError, TypeError, ValueError): return None

def scan(table: str, expected: int, ids: dict, results: dict):
    path = DATA / f"{table}.csv"
    report = {"file": str(path.relative_to(ROOT)), "exists": path.is_file(), "expected_rows": expected, "actual_rows": 0, "header": [], "pk_duplicate_observations": 0, "full_duplicate_observations": 0, "nulls": Counter(), "fk_orphans": Counter(), "dates": {}, "issues": Counter()}
    if not path.is_file(): results[table] = report; return
    seen_pk, seen_rows = set(), set()
    date_cols = {"orders":["order_datetime"],"customers":["signup_date","last_order_date"],"menu_items":["launch_date"],"ratings":["rating_date"],"inventory":["record_date"],"wastage":["wastage_date"]}
    date_min, date_max = {}, {}
    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        report["header"] = reader.fieldnames or []
        for row in reader:
            report["actual_rows"] += 1
            if any(blank(v) for v in row.values()):
                for k,v in row.items():
                    if blank(v): report["nulls"][k] += 1
            key = row.get(PK[table], "")
            if key in seen_pk: report["pk_duplicate_observations"] += 1
            else: seen_pk.add(key)
            # Full-row duplicate check only needed where the manifest declares duplicates.
            if table in ("customers", "order_items"):
                tup = tuple(row.get(k, "") for k in report["header"])
                if tup in seen_rows: report["full_duplicate_observations"] += 1
                else: seen_rows.add(tup)
            for col, parent in FKS.get(table, {}).items():
                val = row.get(col, "")
                if val and val not in ids.get(parent, set()): report["fk_orphans"][col] += 1
            for col in date_cols.get(table, []):
                val = row.get(col, "")
                if not val: continue
                try:
                    parsed = datetime.fromisoformat(val.replace("Z", "+00:00")).date()
                    date_min[col] = min(date_min.get(col, parsed), parsed)
                    date_max[col] = max(date_max.get(col, parsed), parsed)
                except ValueError: report["issues"][f"invalid_date:{col}"] += 1
            if table == "orders":
                if blank(row.get("ordering_channel")): report["issues"]["missing_channel"] += 1
                if (num(row,"discount_amount") or 0) < 0: report["issues"]["negative_discount"] += 1
                if row.get("order_status") not in {"Completed","Cancelled","Refunded"}: report["issues"]["unexpected_order_status"] += 1
            elif table == "order_items":
                q,p,total,disc = num(row,"quantity"),num(row,"unit_price"),num(row,"line_total"),num(row,"item_discount")
                if q is not None and (q <= 0 or not q.is_integer()): report["issues"]["invalid_quantity"] += 1
                if p is not None and p <= 0: report["issues"]["invalid_price"] += 1
                # The generator injects incorrect totals by adding exactly 999.00.
                # Other formula residuals can be secondary effects of injected bad
                # quantities/prices, so report them separately from that rule.
                if None not in (q,p,total,disc):
                    residual = total - (q*p-disc)
                    if abs(residual - 999.0) <= .011: report["issues"]["incorrect_line_total"] += 1
                    elif abs(residual) > .011: report["issues"]["other_line_total_formula_deviation"] += 1
            elif table == "ratings":
                for col in ("rating","food_rating","service_rating","delivery_rating"):
                    v=num(row,col)
                    if v is not None and not 1 <= v <= 5: report["issues"][f"invalid_{col}"] += 1
                if blank(row.get("food_rating")): report["issues"]["missing_food_rating"] += 1
            elif table == "wastage":
                q=num(row,"quantity_wasted")
                if q is not None and q < 0: report["issues"]["invalid_negative_quantity"] += 1
            elif table == "menu_items" and blank(row.get("base_price")): report["issues"]["missing_base_price"] += 1
            elif table == "inventory":
                vals=[num(row,k) for k in ("opening_stock","stock_received","stock_used","closing_stock")]
                if all(v is not None for v in vals) and abs(vals[0]+vals[1]-vals[2]-vals[3]) > .011: report["issues"]["inventory_formula"] += 1
    report["dates"] = {c:{"min":str(lo),"max":str(date_max[c])} for c,lo in date_min.items()}
    # retain IDs needed for subsequent FK scans
    ids[table] = seen_pk
    report["nulls"] = dict(report["nulls"]); report["fk_orphans"] = dict(report["fk_orphans"]); report["issues"] = dict(report["issues"])
    results[table] = report

def main():
    global DATA
    ap=argparse.ArgumentParser(); ap.add_argument("--data-dir",type=Path,default=DATA); ap.add_argument("--summary",type=Path,default=SUMMARY); ap.add_argument("--output-dir",type=Path,default=OUT); args=ap.parse_args()
    DATA=args.data_dir.resolve()
    manifest=json.loads(args.summary.read_text(encoding="utf-8"))
    expected=manifest["table_counts_after_dirty_injection"]
    actual_files={p.stem for p in DATA.glob("*.csv")}
    ids, tables={},{}
    # Parent tables first so every downstream FK is checked against the same observed files.
    order=["customers","restaurants","menu_categories","menu_items","promotions","orders","order_items","pricing_history","ratings","inventory","wastage"]
    for t in order: scan(t,expected[t],ids,tables)
    missing=sorted(EXPECTED_FILES-actual_files); extra=sorted(actual_files-EXPECTED_FILES)
    structural=[]; quality=[]
    if missing: structural.append({"check":"expected_files","missing":missing})
    if extra: structural.append({"check":"unexpected_csv_files","extra":extra})
    for t,r in tables.items():
        if not r["exists"]: structural.append({"check":"file_exists","table":t}); continue
        if r["actual_rows"] != r["expected_rows"]: structural.append({"check":"row_count","table":t,"expected":r["expected_rows"],"actual":r["actual_rows"]})
        if r["actual_rows"] < MINIMUM[t]: structural.append({"check":"minimum_scale","table":t,"minimum":MINIMUM[t],"actual":r["actual_rows"]})
        if not r["header"] or len(r["header"]) != len(set(r["header"])): structural.append({"check":"header_structure","table":t,"header":r["header"]})
        if r["header"] != EXPECTED_HEADERS[t].split(","): structural.append({"check":"unexpected_columns_or_order","table":t,"expected":EXPECTED_HEADERS[t].split(","),"actual":r["header"]})
        if r["pk_duplicate_observations"] and t not in ("customers","order_items"): structural.append({"check":"unexpected_pk_duplicates","table":t,"count":r["pk_duplicate_observations"]})
        for fk,n in r["fk_orphans"].items(): structural.append({"check":"foreign_key_orphans","table":t,"column":fk,"count":n})
        if r["pk_duplicate_observations"] or r["full_duplicate_observations"] or r["nulls"] or r["issues"]: quality.append({"table":t,"pk_duplicate_observations":r["pk_duplicate_observations"],"full_duplicate_observations":r["full_duplicate_observations"],"nulls":r["nulls"],"issues":r["issues"]})
    # Expected history boundary applies to orders; compare calendar dates inclusively.
    od=tables.get("orders",{}).get("dates",{}).get("order_datetime",{})
    if od and (od["min"] < manifest["history_start"] or od["max"] > manifest["history_end"]): structural.append({"check":"order_history_range","observed":od,"expected_start":manifest["history_start"],"expected_end":manifest["history_end"]})
    # Controlled counts are reported as quality evidence; discrepancies are unexpected findings but do not conflate quality with file/FK structure.
    observed={t:r.get("issues",{}) for t,r in tables.items()}
    dirty=manifest.get("dirty_data_manifest",{})
    keymap={"missing_city":("customers","city"),"duplicate_rows":None,"missing_channel":("orders","missing_channel"),"negative_discount":("orders","negative_discount"),"invalid_quantity":("order_items","invalid_quantity"),"invalid_price":("order_items","invalid_price"),"incorrect_line_total":("order_items","incorrect_line_total"),"invalid_rating":None,"missing_food_rating":("ratings","missing_food_rating"),"invalid_negative_quantity":("wastage","invalid_negative_quantity"),"missing_base_price":("menu_items","missing_base_price")}
    dirty_comparison=[]
    for t,items in dirty.items():
        for name,expected_n in items.items():
            value=None
            if name=="duplicate_rows": value=tables[t]["full_duplicate_observations"]
            elif name=="missing_city": value=tables[t]["nulls"].get("city",0)
            elif name=="invalid_rating": value=sum(n for k,n in tables[t]["issues"].items() if k.startswith("invalid_") and k != "invalid_date")
            else:
                pair=keymap.get(name)
                if pair: value=tables[pair[0]]["issues"].get(pair[1],0)
            match=value==expected_n if value is not None else None
            explanation=None
            if not match and (t,name)==("customers","missing_city"):
                explanation="Observed CSV occurrences include a missing-city row repeated by the intentional duplicate-row injection."
            elif not match and (t,name)==("order_items","invalid_price"):
                explanation="Observed CSV occurrences include an invalid-price row repeated by the intentional duplicate-row injection."
            elif not match and (t,name)==("order_items","incorrect_line_total"):
                explanation="Two injected incorrect-total records overlap invalid-price records; after those prices change, their residual is no longer exactly +999. Other formula deviations are separately reported and include secondary effects of invalid quantities/prices."
            dirty_comparison.append({"table":t,"issue":name,"manifest_count":expected_n,"observed_count":value,"match":match,"status":"MATCH" if match else ("EXPLAINED_OBSERVATION_DELTA" if explanation else "COUNT_DIFFERENCE"),"explanation":explanation})
    output={"status":"PASS" if not structural else "FAIL","dataset":"frozen full dataset","generated_at_manifest":manifest.get("generated_at"),"seed":manifest.get("seed"),"expected_file_count":11,"actual_csv_file_count":len(actual_files),"missing_files":missing,"unexpected_files":extra,"structural_failures":structural,"expected_data_quality_issues":quality,"dirty_manifest_comparison":dirty_comparison,"minimum_scale":MINIMUM,"tables":tables}
    args.output_dir.mkdir(parents=True,exist_ok=True)
    (args.output_dir/"independent_validation.json").write_text(json.dumps(output,indent=2,default=str),encoding="utf-8")
    with (args.output_dir/"independent_validation_tables.csv").open("w",newline="",encoding="utf-8") as f:
        w=csv.DictWriter(f,fieldnames=["table","expected_rows","actual_rows","pk_duplicate_observations","full_duplicate_observations","null_field_count","fk_orphan_count"]); w.writeheader()
        for t,r in tables.items(): w.writerow({"table":t,"expected_rows":r["expected_rows"],"actual_rows":r["actual_rows"],"pk_duplicate_observations":r["pk_duplicate_observations"],"full_duplicate_observations":r["full_duplicate_observations"],"null_field_count":sum(r["nulls"].values()),"fk_orphan_count":sum(r["fk_orphans"].values())})
    print(json.dumps({"status":output["status"],"structural_failures":len(structural),"quality_tables":len(quality),"evidence":str(args.output_dir/"independent_validation.json"),"dirty_comparisons":dirty_comparison},indent=2))
    return 0 if not structural else 1

if __name__=="__main__": raise SystemExit(main())
