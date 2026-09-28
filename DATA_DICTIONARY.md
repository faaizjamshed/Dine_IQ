# DineIQ Data Dictionary

This document describes the synthetic restaurant dataset used in the project. The dataset is designed to reflect a realistic restaurant intelligence domain while preserving a reproducible generation path and controlled quality issues for cleaning and validation tests.

## Dataset scope

The full synthetic dataset contains 11 source tables with a single-purpose relationship model:

- customers
- restaurants
- menu_categories
- menu_items
- promotions
- orders
- order_items
- pricing_history
- ratings
- inventory
- wastage

The source data is generated with a fixed seed and a reproducible generator (`scripts/data_generation/generate_dineq_dataset.py`). The full dataset includes approximately 650,000 orders and 3,000,600 order-item rows.

## Relationship summary

- `customers` -> `orders` via `customer_id`
- `restaurants` -> `orders` via `restaurant_id`
- `restaurants` -> `inventory` via `restaurant_id`
- `restaurants` -> `ratings` via `restaurant_id`
- `menu_categories` -> `menu_items` via `category_id`
- `menu_items` -> `order_items` via `menu_item_id`
- `orders` -> `order_items` via `order_id`
- `orders` -> `ratings` via `order_id`
- `promotions` -> `orders` via `promotion_id`
- `pricing_history` -> `menu_items` via `menu_item_id`
- `inventory` -> `menu_items` via `menu_item_id`
- `wastage` -> `menu_items` via `menu_item_id`

## Table reference

### 1) customers

| Column | Type | Key | Meaning |
|---|---|---|---|
| customer_id | string | PK | Surrogate customer identifier |
| customer_name | string |  | Generated customer display name |
| gender | string |  | Customer gender |
| age | integer |  | Customer age |
| city | string |  | Customer city |
| signup_date | date |  | Account signup date |
| customer_segment | string |  | Segment label, used for behavior profiling |
| preferred_channel | string |  | Preferred ordering channel |
| loyalty_points | integer |  | Loyalty points at signup or event | 
| is_churned | boolean |  | Churn indicator |
| last_order_date | date |  | Most recent order date |

Dirty-data rules:

- controlled missing or invalid values are injected in some rows
- date fields may be partially missing or inconsistent with order history
- synthetic churn indicators are not treated as a predictive churn model target

### 2) restaurants

| Column | Type | Key | Meaning |
|---|---|---|---|
| restaurant_id | string | PK | Restaurant surrogate key |
| restaurant_name | string |  | Restaurant display name |
| city | string |  | City location |
| area | string |  | Area/district |
| opening_date | date |  | Store opening date |
| seating_capacity | integer |  | Seating capacity |
| location_type | string |  | High street, mall, residential, etc. |
| is_active | boolean |  | Active status |

Dirty-data rules:

- some dates may be unrealistic relative to generated order windows
- inactive locations may exist in the source population when validating filters

### 3) menu_categories

| Column | Type | Key | Meaning |
|---|---|---|---|
| category_id | string | PK | Category identifier |
| category_name | string |  | Category label |
| description | string |  | Category description |
| is_active | boolean |  | Whether the category remains active |

### 4) menu_items

| Column | Type | Key | Meaning |
|---|---|---|---|
| menu_item_id | string | PK | Menu item identifier |
| category_id | string | FK | Related category |
| item_name | string |  | Menu item name |
| base_price | float |  | List price before adjustments |
| cost_price | float |  | Estimated ingredient cost |
| preparation_time_min | integer |  | Preparation time in minutes |
| is_vegetarian | boolean |  | Vegetarian flag |
| is_available | boolean |  | Current availability |
| launch_date | date |  | Product launch date |

Dirty-data rules:

- some base prices/costs can be inconsistent with the generated pricing history
- new items and missing-cost cases are included for tricky analytical tests

### 5) promotions

| Column | Type | Key | Meaning |
|---|---|---|---|
| promotion_id | string | PK | Promotion ID |
| promotion_name | string |  | Promotional campaign name |
| promotion_type | string |  | Seasonal, acquisition, retention, flash sale, bundle |
| discount_type | string |  | Percentage or fixed |
| discount_value | float |  | Discount amount or percentage |
| start_date | date |  | Start of campaign |
| end_date | date |  | End of campaign |
| minimum_order_value | float |  | Min order threshold |
| channel | string |  | Applicable channel or all |
| is_active | boolean |  | Active indicator |

Dirty-data rules:

- date ranges may overlap and include active/inactive states
- discount semantics should be interpreted with the campaign rules and not assumed to be causal

### 6) orders

| Column | Type | Key | Meaning |
|---|---|---|---|
| order_id | string | PK | Order identifier |
| customer_id | string | FK | Customer making the order |
| restaurant_id | string | FK | Restaurant fulfillment site |
| promotion_id | string | FK | Promotion associated with the order |
| order_datetime | timestamp |  | Order timestamp |
| ordering_channel | string |  | Dine-In, Takeaway, Mobile App, Website, Delivery Partner |
| order_status | string |  | Order state |
| subtotal | float |  | Pre-discount line subtotal |
| discount_amount | float |  | Discount applied |
| tax_amount | float |  | Tax |
| delivery_fee | float |  | Delivery fee |
| final_amount | float |  | Final order amount |
| payment_method | string |  | Cash, Card, Mobile Wallet, Bank Transfer |

Dirty-data rules:

- order totals may be inconsistently generated relative to item-level lines
- some promotions may be inactive or mismatched to channel expectations
- status values include combinations that require cleaning rules before analytics

### 7) order_items

| Column | Type | Key | Meaning |
|---|---|---|---|
| order_item_id | string | PK | Line-level order item key |
| order_id | string | FK | Parent order |
| menu_item_id | string | FK | Purchased menu item |
| quantity | integer |  | Quantity purchased |
| unit_price | float |  | Unit selling price |
| item_discount | float |  | Item-level discount |
| line_total | float |  | Extended line amount |
| special_request | string |  | Special instruction or note |

Dirty-data rules:

- duplicate order items and inconsistent price/discount logic are intentionally present
- line totals and order-level subtotals may require reconciliation

### 8) pricing_history

| Column | Type | Key | Meaning |
|---|---|---|---|
| price_history_id | string | PK | Price change identifier |
| menu_item_id | string | FK | Item affected |
| restaurant_id | string | FK | Restaurant affected |
| old_price | float |  | Previous price |
| new_price | float |  | New price |
| effective_from | date |  | Effective start date |
| effective_to | date |  | Effective end date |
| change_reason | string |  | Price reason code |

Dirty-data rules:

- some transitions are missing or overlap due to synthetic generation rules
- effective-to dates often require normalization during analytics

### 9) ratings

| Column | Type | Key | Meaning |
|---|---|---|---|
| rating_id | string | PK | Rating ID |
| order_id | string | FK | Related order |
| customer_id | string | FK | Review customer |
| restaurant_id | string | FK | Rated restaurant |
| rating | integer |  | Aggregate rating |
| food_rating | float |  | Food quality subscore |
| service_rating | float |  | Service quality subscore |
| delivery_rating | float |  | Delivery quality subscore |
| review_text | string |  | Free-text review |
| rating_date | date |  | Rating date |

Dirty-data rules:

- ratings may be sparse or inconsistent with item-level sales history
- some review text and subscore fields may be missing or malformed

### 10) inventory

| Column | Type | Key | Meaning |
|---|---|---|---|
| inventory_id | string | PK | Inventory observation ID |
| restaurant_id | string | FK | Restaurant location |
| menu_item_id | string | FK | Inventory-tracked menu item |
| record_date | date |  | Observation date |
| opening_stock | integer |  | Stock at start of period |
| stock_received | integer |  | Received stock |
| stock_used | integer |  | Used or sold stock |
| closing_stock | integer |  | Remaining stock |
| reorder_level | integer |  | Reorder trigger |
| stock_status | string |  | Low, healthy, etc. |

Dirty-data rules:

- negative or impossible quantities are intentionally avoided by the generator but may still require validation checks
- consumption and replenishment must be reconciled with records in orders and wastage

### 11) wastage

| Column | Type | Key | Meaning |
|---|---|---|---|
| wastage_id | string | PK | Wastage record ID |
| restaurant_id | string | FK | Affected restaurant |
| menu_item_id | string | FK | Affected item |
| wastage_date | date |  | Waste date |
| quantity_wasted | float |  | Lost quantity |
| unit_cost | float |  | Unit production cost |
| wastage_cost | float |  | Total cost of waste |
| reason | string |  | Expired, overproduction, damaged, etc. |

Dirty-data rules:

- waste records can be noisy or skewed due to generation assumptions
- cost and quantity values should not be treated as causal effects without matched operational context

## Known dirty-data patterns

The dataset intentionally includes quality problems to demonstrate Spark profiling and cleaning rules, including:

- duplicated identifiers
- missing values
- invalid ranges and price mismatches
- cross-table reference drift
- inconsistent date semantics
- category and item drift
- partial promotion alignment issues

The validated project uses those issues for data-quality documentation and not for production-grade operational assumptions.
