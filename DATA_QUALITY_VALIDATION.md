# Data quality validation catalog

Generated from [full-data v2 evidence](results/submission/quality/v2/quality_cleaning.json) by `python scripts/audit/submission_evidence.py`. This publishes saved execution evidence; it does not rerun Spark.

Evidence timestamp: `2026-09-28T12:31:28.924295+00:00`. Contract: `submission-quality-v1`.

## Quarantine and repair policy

`profile_clean.py` reads original CSV tokens, verifies headers and applies `quality_rules.validate_table` in parent-first order. Header/schema drift fails the run. Malformed records, invalid types, required-value failures, conflicting keys, invalid domains/bounds, inconsistent settlements/balances and missing accepted parents are quarantined. Rejected parents cascade to dependent records. Identical source copies are deduplicated separately; conflicting primary-key variants are all rejected.

Quarantine preserves `_raw_record`, `_source_file`, `_corrupt_record` and every `_quality_reasons` value. Original CSV is unchanged. Only validated components may produce repaired line/waste totals; missing optional customer city/order channel becomes Unknown. No arbitrary numeric imputation is performed. Rule counts overlap and must not be summed as rejected-row counts.

Review rejected source records, correct them in a new version of the dataset and revalidate. Do not move quarantine rows directly into accepted outputs. Fresh output versions are required; existing or partially written versions are never silently overwritten.

## Before/after counts

Raw = accepted + quarantined unique records + removed exact duplicate copies. Every table passed accounting and persisted Parquet read-back checks.

| Table | Raw | Accepted | Quarantined | Duplicate copies removed |
|---|---:|---:|---:|---:|
| customers | 75,075 | 62,754 | 12,246 | 75 |
| restaurants | 25 | 25 | 0 | 0 |
| menu_categories | 15 | 15 | 0 | 0 |
| menu_items | 200 | 200 | 0 | 0 |
| promotions | 80 | 80 | 0 | 0 |
| orders | 650,000 | 584,306 | 65,694 | 0 |
| order_items | 3,000,600 | 2,693,856 | 306,144 | 600 |
| pricing_history | 2,992 | 2,992 | 0 | 0 |
| ratings | 220,000 | 197,768 | 22,232 | 0 |
| inventory | 90,000 | 90,000 | 0 | 0 |
| wastage | 110,000 | 109,945 | 55 | 0 |
| **Total** | **4,148,987** | **3,741,941** | **406,371** | **675** |

Accepted root: `hdfs://localhost:9000/dineq/submission/processed/v2`. Quarantine root: `hdfs://localhost:9000/dineq/submission/quality/v2/quarantine`.

These strict outputs are separate from canonical v4. Existing dashboards, forecasts and metrics still use historical v4; they have not been recomputed or retrained on this accepted subset. Cross-table business semantics beyond the listed rules are not claimed validated.

## Malformed-record fixtures

[test_quality_submission.py](tests/test_quality_submission.py) covers valid records across all 11 tables; exact duplicates and conflicting keys; zero/negative/fractional/missing quantities; NaN/infinity and derived overflow; missing keys and parent cascades; invalid dates/times/booleans/status; excessive discounts; incorrect totals; percentage/rating bounds; reversed dates; stock imbalance; cancelled settlement; extra/missing CSV fields; bad numeric tokens; quoted multiline fields; optional values; and empty input. Current test results are in [verification.json](results/submission/verification.json).

## Complete executed rule list

Each table below lists every rule in the executed catalog, its action and the saved affected count. Repair counts describe values actually changed. Deduplication counts removed copies, not rejected unique rows.

### customers

| Rule | Action | Affected | Contract |
|---|---|---:|---|
| `malformed_csv` | quarantine | 0 | Malformed CSV record |
| `conflicting_primary_key` | quarantine | 0 | Different source records share a primary key; quarantine all variants |
| `required:customer_id` | quarantine | 0 | Required value missing or unparseable |
| `required:signup_date` | quarantine | 0 | Required value missing or unparseable |
| `invalid_type:age` | quarantine | 0 | Nonempty source must parse as int |
| `invalid_type:signup_date` | quarantine | 0 | Nonempty source must parse as date |
| `invalid_type:loyalty_points` | quarantine | 0 | Nonempty source must parse as int |
| `invalid_type:is_churned` | quarantine | 0 | Nonempty source must parse as boolean |
| `invalid_type:last_order_date` | quarantine | 0 | Nonempty source must parse as date |
| `domain:gender` | quarantine | 0 | Allowed nonmissing values: Female, Male, Other |
| `domain:customer_segment` | quarantine | 0 | Allowed nonmissing values: New, Regular, Loyal, High Value, Occasional |
| `domain:preferred_channel` | quarantine | 0 | Allowed nonmissing values: Dine-In, Takeaway, Mobile App, Website, Delivery Partner |
| `nonnegative:age` | quarantine | 0 | Present value must be zero or greater |
| `nonnegative:loyalty_points` | quarantine | 0 | Present value must be zero or greater |
| `date_order` | quarantine | 12,246 | last_order_date cannot precede signup_date; optional end may be absent |
| `exact_duplicate` | deduplicate | 75 | Collapse identical complete source records; count removed copies separately |
| `fill:city` | repair | 195 | Missing becomes Unknown; unrecognized present domains are quarantined |

Accepted: `hdfs://localhost:9000/dineq/submission/processed/v2/customers`. Quarantine: `hdfs://localhost:9000/dineq/submission/quality/v2/quarantine/customers`.

### restaurants

| Rule | Action | Affected | Contract |
|---|---|---:|---|
| `malformed_csv` | quarantine | 0 | Malformed CSV record |
| `conflicting_primary_key` | quarantine | 0 | Different source records share a primary key; quarantine all variants |
| `required:restaurant_id` | quarantine | 0 | Required value missing or unparseable |
| `required:opening_date` | quarantine | 0 | Required value missing or unparseable |
| `invalid_type:opening_date` | quarantine | 0 | Nonempty source must parse as date |
| `invalid_type:seating_capacity` | quarantine | 0 | Nonempty source must parse as int |
| `invalid_type:is_active` | quarantine | 0 | Nonempty source must parse as boolean |
| `domain:city` | quarantine | 0 | Allowed nonmissing values: Karachi, Lahore, Islamabad, Rawalpindi, Faisalabad, Multan |
| `domain:location_type` | quarantine | 0 | Allowed nonmissing values: High Street, Mall, Commercial, Residential |
| `nonnegative:seating_capacity` | quarantine | 0 | Present value must be zero or greater |
| `exact_duplicate` | deduplicate | 0 | Collapse identical complete source records; count removed copies separately |

Accepted: `hdfs://localhost:9000/dineq/submission/processed/v2/restaurants`. Quarantine: `hdfs://localhost:9000/dineq/submission/quality/v2/quarantine/restaurants`.

### menu_categories

| Rule | Action | Affected | Contract |
|---|---|---:|---|
| `malformed_csv` | quarantine | 0 | Malformed CSV record |
| `conflicting_primary_key` | quarantine | 0 | Different source records share a primary key; quarantine all variants |
| `required:category_id` | quarantine | 0 | Required value missing or unparseable |
| `required:category_name` | quarantine | 0 | Required value missing or unparseable |
| `invalid_type:is_active` | quarantine | 0 | Nonempty source must parse as boolean |
| `domain:category_name` | quarantine | 0 | Allowed nonmissing values: Burgers, Pizza, Pakistani, BBQ, Beverages, Desserts, Chinese, Fast Food, Breakfast, Salads, Pasta, Seafood, Sandwiches, Rice, Coffee & Tea |
| `exact_duplicate` | deduplicate | 0 | Collapse identical complete source records; count removed copies separately |

Accepted: `hdfs://localhost:9000/dineq/submission/processed/v2/menu_categories`. Quarantine: `hdfs://localhost:9000/dineq/submission/quality/v2/quarantine/menu_categories`.

### menu_items

| Rule | Action | Affected | Contract |
|---|---|---:|---|
| `malformed_csv` | quarantine | 0 | Malformed CSV record |
| `conflicting_primary_key` | quarantine | 0 | Different source records share a primary key; quarantine all variants |
| `required:menu_item_id` | quarantine | 0 | Required value missing or unparseable |
| `required:category_id` | quarantine | 0 | Required value missing or unparseable |
| `required:launch_date` | quarantine | 0 | Required value missing or unparseable |
| `invalid_type:base_price` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:base_price` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:cost_price` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:cost_price` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:preparation_time_min` | quarantine | 0 | Nonempty source must parse as int |
| `invalid_type:is_vegetarian` | quarantine | 0 | Nonempty source must parse as boolean |
| `invalid_type:is_available` | quarantine | 0 | Nonempty source must parse as boolean |
| `invalid_type:launch_date` | quarantine | 0 | Nonempty source must parse as date |
| `positive:base_price` | quarantine | 0 | Present value must be greater than zero |
| `positive:cost_price` | quarantine | 0 | Present value must be greater than zero |
| `positive:preparation_time_min` | quarantine | 0 | Present value must be greater than zero |
| `foreign_key:category_id` | quarantine | 0 | Nonmissing value must reference accepted menu_categories.category_id; rejected parents cascade |
| `exact_duplicate` | deduplicate | 0 | Collapse identical complete source records; count removed copies separately |

Accepted: `hdfs://localhost:9000/dineq/submission/processed/v2/menu_items`. Quarantine: `hdfs://localhost:9000/dineq/submission/quality/v2/quarantine/menu_items`.

### promotions

| Rule | Action | Affected | Contract |
|---|---|---:|---|
| `malformed_csv` | quarantine | 0 | Malformed CSV record |
| `conflicting_primary_key` | quarantine | 0 | Different source records share a primary key; quarantine all variants |
| `required:promotion_id` | quarantine | 0 | Required value missing or unparseable |
| `required:discount_type` | quarantine | 0 | Required value missing or unparseable |
| `required:discount_value` | quarantine | 0 | Required value missing or unparseable |
| `required:start_date` | quarantine | 0 | Required value missing or unparseable |
| `required:end_date` | quarantine | 0 | Required value missing or unparseable |
| `required:minimum_order_value` | quarantine | 0 | Required value missing or unparseable |
| `invalid_type:discount_value` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:discount_value` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:start_date` | quarantine | 0 | Nonempty source must parse as date |
| `invalid_type:end_date` | quarantine | 0 | Nonempty source must parse as date |
| `invalid_type:minimum_order_value` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:minimum_order_value` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:is_active` | quarantine | 0 | Nonempty source must parse as boolean |
| `domain:promotion_type` | quarantine | 0 | Allowed nonmissing values: Seasonal, Acquisition, Retention, Flash Sale, Bundle |
| `domain:discount_type` | quarantine | 0 | Allowed nonmissing values: Percentage, Fixed |
| `domain:channel` | quarantine | 0 | Allowed nonmissing values: Dine-In, Takeaway, Mobile App, Website, Delivery Partner, All |
| `nonnegative:discount_value` | quarantine | 0 | Present value must be zero or greater |
| `nonnegative:minimum_order_value` | quarantine | 0 | Present value must be zero or greater |
| `date_order` | quarantine | 0 | end_date cannot precede start_date; optional end may be absent |
| `percentage_over_100` | quarantine | 0 | Percentage discount cannot exceed 100 |
| `exact_duplicate` | deduplicate | 0 | Collapse identical complete source records; count removed copies separately |

Accepted: `hdfs://localhost:9000/dineq/submission/processed/v2/promotions`. Quarantine: `hdfs://localhost:9000/dineq/submission/quality/v2/quarantine/promotions`.

### orders

| Rule | Action | Affected | Contract |
|---|---|---:|---|
| `malformed_csv` | quarantine | 0 | Malformed CSV record |
| `conflicting_primary_key` | quarantine | 0 | Different source records share a primary key; quarantine all variants |
| `required:order_id` | quarantine | 0 | Required value missing or unparseable |
| `required:customer_id` | quarantine | 0 | Required value missing or unparseable |
| `required:restaurant_id` | quarantine | 0 | Required value missing or unparseable |
| `required:order_datetime` | quarantine | 0 | Required value missing or unparseable |
| `required:order_status` | quarantine | 0 | Required value missing or unparseable |
| `required:subtotal` | quarantine | 0 | Required value missing or unparseable |
| `required:discount_amount` | quarantine | 0 | Required value missing or unparseable |
| `required:tax_amount` | quarantine | 0 | Required value missing or unparseable |
| `required:delivery_fee` | quarantine | 0 | Required value missing or unparseable |
| `required:final_amount` | quarantine | 0 | Required value missing or unparseable |
| `invalid_type:order_datetime` | quarantine | 0 | Nonempty source must parse as timestamp |
| `invalid_type:subtotal` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:subtotal` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:discount_amount` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:discount_amount` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:tax_amount` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:tax_amount` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:delivery_fee` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:delivery_fee` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:final_amount` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:final_amount` | quarantine | 0 | NaN and infinity are invalid |
| `domain:ordering_channel` | quarantine | 0 | Allowed nonmissing values: Dine-In, Takeaway, Mobile App, Website, Delivery Partner |
| `domain:order_status` | quarantine | 0 | Allowed nonmissing values: Completed, Cancelled, Refunded |
| `domain:payment_method` | quarantine | 0 | Allowed nonmissing values: Cash, Card, Mobile Wallet, Bank Transfer |
| `nonnegative:subtotal` | quarantine | 0 | Present value must be zero or greater |
| `nonnegative:discount_amount` | quarantine | 325 | Present value must be zero or greater |
| `nonnegative:tax_amount` | quarantine | 0 | Present value must be zero or greater |
| `nonnegative:delivery_fee` | quarantine | 0 | Present value must be zero or greater |
| `nonnegative:final_amount` | quarantine | 0 | Present value must be zero or greater |
| `discount_exceeds_subtotal` | quarantine | 0 | Discount cannot exceed subtotal |
| `order_total_mismatch` | quarantine | 316 | Non-cancelled final = subtotal - discount + tax + delivery within PKR 0.011 |
| `cancelled_settlement` | quarantine | 0 | Cancelled orders retain quoted subtotal but must have zero settled final amount |
| `foreign_key:customer_id` | quarantine | 65,403 | Nonmissing value must reference accepted customers.customer_id; rejected parents cascade |
| `foreign_key:restaurant_id` | quarantine | 0 | Nonmissing value must reference accepted restaurants.restaurant_id; rejected parents cascade |
| `foreign_key:promotion_id` | quarantine | 0 | Nonmissing value must reference accepted promotions.promotion_id; rejected parents cascade |
| `exact_duplicate` | deduplicate | 0 | Collapse identical complete source records; count removed copies separately |
| `fill:ordering_channel` | repair | 1,155 | Missing becomes Unknown; unrecognized present domains are quarantined |

Accepted: `hdfs://localhost:9000/dineq/submission/processed/v2/orders`. Quarantine: `hdfs://localhost:9000/dineq/submission/quality/v2/quarantine/orders`.

### order_items

| Rule | Action | Affected | Contract |
|---|---|---:|---|
| `malformed_csv` | quarantine | 0 | Malformed CSV record |
| `conflicting_primary_key` | quarantine | 0 | Different source records share a primary key; quarantine all variants |
| `required:order_item_id` | quarantine | 0 | Required value missing or unparseable |
| `required:order_id` | quarantine | 0 | Required value missing or unparseable |
| `required:menu_item_id` | quarantine | 0 | Required value missing or unparseable |
| `required:quantity` | quarantine | 0 | Required value missing or unparseable |
| `required:unit_price` | quarantine | 0 | Required value missing or unparseable |
| `required:item_discount` | quarantine | 0 | Required value missing or unparseable |
| `invalid_type:quantity` | quarantine | 0 | Nonempty source must parse as int |
| `invalid_type:unit_price` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:unit_price` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:item_discount` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:item_discount` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:line_total` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:line_total` | quarantine | 0 | NaN and infinity are invalid |
| `positive:quantity` | quarantine | 1,500 | Present value must be greater than zero |
| `positive:unit_price` | quarantine | 1,200 | Present value must be greater than zero |
| `nonnegative:item_discount` | quarantine | 0 | Present value must be zero or greater |
| `discount_exceeds_line_value` | quarantine | 2,698 | Discount cannot exceed quantity times unit price |
| `derived_nonfinite` | quarantine | 0 | Derived amount must not overflow even when components are finite |
| `foreign_key:order_id` | quarantine | 303,728 | Nonmissing value must reference accepted orders.order_id; rejected parents cascade |
| `foreign_key:menu_item_id` | quarantine | 0 | Nonmissing value must reference accepted menu_items.menu_item_id; rejected parents cascade |
| `exact_duplicate` | deduplicate | 600 | Collapse identical complete source records; count removed copies separately |
| `recompute:line_total` | repair | 1,351 | Recompute derived value as round(quantity * unit_price - item_discount, 2) after validation |

Accepted: `hdfs://localhost:9000/dineq/submission/processed/v2/order_items`. Quarantine: `hdfs://localhost:9000/dineq/submission/quality/v2/quarantine/order_items`.

### pricing_history

| Rule | Action | Affected | Contract |
|---|---|---:|---|
| `malformed_csv` | quarantine | 0 | Malformed CSV record |
| `conflicting_primary_key` | quarantine | 0 | Different source records share a primary key; quarantine all variants |
| `required:price_history_id` | quarantine | 0 | Required value missing or unparseable |
| `required:menu_item_id` | quarantine | 0 | Required value missing or unparseable |
| `required:restaurant_id` | quarantine | 0 | Required value missing or unparseable |
| `required:old_price` | quarantine | 0 | Required value missing or unparseable |
| `required:new_price` | quarantine | 0 | Required value missing or unparseable |
| `required:effective_from` | quarantine | 0 | Required value missing or unparseable |
| `invalid_type:old_price` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:old_price` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:new_price` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:new_price` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:effective_from` | quarantine | 0 | Nonempty source must parse as date |
| `invalid_type:effective_to` | quarantine | 0 | Nonempty source must parse as date |
| `domain:change_reason` | quarantine | 0 | Allowed nonmissing values: Inflation, Supplier Cost, Seasonal Adjustment, Promotion End, Menu Review |
| `positive:old_price` | quarantine | 0 | Present value must be greater than zero |
| `positive:new_price` | quarantine | 0 | Present value must be greater than zero |
| `date_order` | quarantine | 0 | effective_to cannot precede effective_from; optional end may be absent |
| `foreign_key:menu_item_id` | quarantine | 0 | Nonmissing value must reference accepted menu_items.menu_item_id; rejected parents cascade |
| `foreign_key:restaurant_id` | quarantine | 0 | Nonmissing value must reference accepted restaurants.restaurant_id; rejected parents cascade |
| `exact_duplicate` | deduplicate | 0 | Collapse identical complete source records; count removed copies separately |

Accepted: `hdfs://localhost:9000/dineq/submission/processed/v2/pricing_history`. Quarantine: `hdfs://localhost:9000/dineq/submission/quality/v2/quarantine/pricing_history`.

### ratings

| Rule | Action | Affected | Contract |
|---|---|---:|---|
| `malformed_csv` | quarantine | 0 | Malformed CSV record |
| `conflicting_primary_key` | quarantine | 0 | Different source records share a primary key; quarantine all variants |
| `required:rating_id` | quarantine | 0 | Required value missing or unparseable |
| `required:order_id` | quarantine | 0 | Required value missing or unparseable |
| `required:customer_id` | quarantine | 0 | Required value missing or unparseable |
| `required:restaurant_id` | quarantine | 0 | Required value missing or unparseable |
| `required:rating_date` | quarantine | 0 | Required value missing or unparseable |
| `invalid_type:rating` | quarantine | 0 | Nonempty source must parse as int |
| `invalid_type:food_rating` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:food_rating` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:service_rating` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:service_rating` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:delivery_rating` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:delivery_rating` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:rating_date` | quarantine | 0 | Nonempty source must parse as date |
| `rating_range:rating` | quarantine | 220 | Present rating must be in [1, 5] |
| `rating_range:food_rating` | quarantine | 0 | Present rating must be in [1, 5] |
| `rating_range:service_rating` | quarantine | 0 | Present rating must be in [1, 5] |
| `rating_range:delivery_rating` | quarantine | 0 | Present rating must be in [1, 5] |
| `foreign_key:order_id` | quarantine | 22,029 | Nonmissing value must reference accepted orders.order_id; rejected parents cascade |
| `foreign_key:customer_id` | quarantine | 21,932 | Nonmissing value must reference accepted customers.customer_id; rejected parents cascade |
| `foreign_key:restaurant_id` | quarantine | 0 | Nonmissing value must reference accepted restaurants.restaurant_id; rejected parents cascade |
| `exact_duplicate` | deduplicate | 0 | Collapse identical complete source records; count removed copies separately |

Accepted: `hdfs://localhost:9000/dineq/submission/processed/v2/ratings`. Quarantine: `hdfs://localhost:9000/dineq/submission/quality/v2/quarantine/ratings`.

### inventory

| Rule | Action | Affected | Contract |
|---|---|---:|---|
| `malformed_csv` | quarantine | 0 | Malformed CSV record |
| `conflicting_primary_key` | quarantine | 0 | Different source records share a primary key; quarantine all variants |
| `required:inventory_id` | quarantine | 0 | Required value missing or unparseable |
| `required:restaurant_id` | quarantine | 0 | Required value missing or unparseable |
| `required:menu_item_id` | quarantine | 0 | Required value missing or unparseable |
| `required:record_date` | quarantine | 0 | Required value missing or unparseable |
| `required:opening_stock` | quarantine | 0 | Required value missing or unparseable |
| `required:stock_received` | quarantine | 0 | Required value missing or unparseable |
| `required:stock_used` | quarantine | 0 | Required value missing or unparseable |
| `required:closing_stock` | quarantine | 0 | Required value missing or unparseable |
| `required:reorder_level` | quarantine | 0 | Required value missing or unparseable |
| `invalid_type:record_date` | quarantine | 0 | Nonempty source must parse as date |
| `invalid_type:opening_stock` | quarantine | 0 | Nonempty source must parse as int |
| `invalid_type:stock_received` | quarantine | 0 | Nonempty source must parse as int |
| `invalid_type:stock_used` | quarantine | 0 | Nonempty source must parse as int |
| `invalid_type:closing_stock` | quarantine | 0 | Nonempty source must parse as int |
| `invalid_type:reorder_level` | quarantine | 0 | Nonempty source must parse as int |
| `domain:stock_status` | quarantine | 0 | Allowed nonmissing values: Low, Normal |
| `nonnegative:opening_stock` | quarantine | 0 | Present value must be zero or greater |
| `nonnegative:stock_received` | quarantine | 0 | Present value must be zero or greater |
| `nonnegative:stock_used` | quarantine | 0 | Present value must be zero or greater |
| `nonnegative:closing_stock` | quarantine | 0 | Present value must be zero or greater |
| `nonnegative:reorder_level` | quarantine | 0 | Present value must be zero or greater |
| `stock_balance` | quarantine | 0 | Closing = opening + received - used |
| `foreign_key:restaurant_id` | quarantine | 0 | Nonmissing value must reference accepted restaurants.restaurant_id; rejected parents cascade |
| `foreign_key:menu_item_id` | quarantine | 0 | Nonmissing value must reference accepted menu_items.menu_item_id; rejected parents cascade |
| `exact_duplicate` | deduplicate | 0 | Collapse identical complete source records; count removed copies separately |

Accepted: `hdfs://localhost:9000/dineq/submission/processed/v2/inventory`. Quarantine: `hdfs://localhost:9000/dineq/submission/quality/v2/quarantine/inventory`.

### wastage

| Rule | Action | Affected | Contract |
|---|---|---:|---|
| `malformed_csv` | quarantine | 0 | Malformed CSV record |
| `conflicting_primary_key` | quarantine | 0 | Different source records share a primary key; quarantine all variants |
| `required:wastage_id` | quarantine | 0 | Required value missing or unparseable |
| `required:restaurant_id` | quarantine | 0 | Required value missing or unparseable |
| `required:menu_item_id` | quarantine | 0 | Required value missing or unparseable |
| `required:wastage_date` | quarantine | 0 | Required value missing or unparseable |
| `required:quantity_wasted` | quarantine | 0 | Required value missing or unparseable |
| `required:unit_cost` | quarantine | 0 | Required value missing or unparseable |
| `invalid_type:wastage_date` | quarantine | 0 | Nonempty source must parse as date |
| `invalid_type:quantity_wasted` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:quantity_wasted` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:unit_cost` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:unit_cost` | quarantine | 0 | NaN and infinity are invalid |
| `invalid_type:wastage_cost` | quarantine | 0 | Nonempty source must parse as double |
| `nonfinite:wastage_cost` | quarantine | 0 | NaN and infinity are invalid |
| `domain:reason` | quarantine | 0 | Allowed nonmissing values: Expired, Overproduction, Damaged, Preparation Error, Unsold |
| `nonnegative:quantity_wasted` | quarantine | 55 | Present value must be zero or greater |
| `nonnegative:unit_cost` | quarantine | 0 | Present value must be zero or greater |
| `derived_nonfinite` | quarantine | 0 | Derived amount must not overflow even when components are finite |
| `foreign_key:restaurant_id` | quarantine | 0 | Nonmissing value must reference accepted restaurants.restaurant_id; rejected parents cascade |
| `foreign_key:menu_item_id` | quarantine | 0 | Nonmissing value must reference accepted menu_items.menu_item_id; rejected parents cascade |
| `exact_duplicate` | deduplicate | 0 | Collapse identical complete source records; count removed copies separately |
| `recompute:wastage_cost` | repair | 0 | Recompute derived value as round(quantity_wasted * unit_cost, 2) after validation |

Accepted: `hdfs://localhost:9000/dineq/submission/processed/v2/wastage`. Quarantine: `hdfs://localhost:9000/dineq/submission/quality/v2/quarantine/wastage`.
