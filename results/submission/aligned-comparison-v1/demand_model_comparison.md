# Spark and Python Demand Model Comparison

## Summary

This report compares independently generated restaurant-hour demand predictions from the selected Spark and Python models on the same chronological held-out test interval. The feature panels, targets, and keys were verified to match across 55,200 test rows. A uniformly spaced sample of 500 cases is included for row-level review.

On the 500 sampled cases, Spark and Python predictions are within one order for all cases (100.0% agreement at that tolerance). This measures cross-pipeline consistency only; it does not establish business impact or prove that either model is operationally accurate.

## Scope and evaluation design

- **Target:** Number of orders whose timestamp falls within each restaurant-hour, regardless of eventual order status.
- **Prediction point:** Start of each UTC hour, before orders in that hour occur. Restaurant-specific time zones are not available.
- **Test interval:** 2026-06-01 through 2026-08-31.
- **Test set:** 55,200 rows from the same chronological, untouched Spark held-out interval.
- **Case comparison:** 500 evenly spaced cases from that interval; Spark and Python predictions were generated independently.
- **Feature alignment:** Both pipelines use Sunday = 0. Keys, targets, and numeric features match across the full 55,200-row panel.
- **Baseline:** Seasonal naive forecast using the same restaurant and hour-of-week from 168 hours earlier.

## Test metrics

| Pipeline | Selected model | RMSE (orders) | MAE (orders) | R-squared |
|---|---|---:|---:|---:|
| Seasonal-naive baseline | Same restaurant/hour-of-week, 168-hour lag | 1.9614 | 1.3595 | 0.0156 |
| Spark | Gradient-boosted trees | 1.3931 | 1.0232 | 0.5034 |
| Python, aligned feature panel | Random forest | 1.3896 | 1.0245 | 0.5059 |

Lower RMSE and MAE indicate smaller prediction errors; higher R-squared indicates more target variation explained on this test set. These are historical held-out results, not a live evaluation.

## Cross-pipeline agreement

Agreement is defined as the absolute difference between Spark and Python order-count predictions being no greater than the stated tolerance. It is a consistency band, not a model-accuracy threshold.

| Absolute prediction difference | Sample agreement |
|---|---:|
| At most 0.5 order | 98.4% (492/500) |
| At most 1.0 order | 100.0% (500/500) |
| At most 2.0 orders | 100.0% (500/500) |

For the 500 sampled cases, the mean absolute difference was 0.1031 orders, the median was 0.0555, the 90th percentile was 0.2384, and the maximum was 0.9827. The mean signed difference (Spark minus Python) was -0.0168 orders.

## Largest sampled difference

| Record | Actual orders | Spark prediction | Python prediction | Spark minus Python | Status at 1-order tolerance |
|---|---:|---:|---:|---:|---|
| R004 at 2026-08-30 08:00 UTC | 3.0000 | 2.5947 | 3.5775 | -0.9827 | Within one order |

This is the largest absolute difference in the sample and remains within the declared one-order tolerance. Residual differences are expected because the Spark gradient-boosted-tree model and Python random-forest model were trained independently. The evidence does not identify a disagreement greater than one order in the 500 sampled cases.

## Model and evidence caveats

- The Spark model was not retrained for this aligned comparison. The Python model was retrained specifically to align feature semantics; it does not replace the historical Python artifact, which used Monday = 0.
- Both models produce point regression predictions. They do not provide calibrated confidence scores, probabilities, or prediction intervals.
- The predictions are technical comparison evidence. Agreement does not demonstrate causal business value or guarantee performance on future/live data.

## Supporting files

- [Machine-readable comparison metrics and sampled cases](demand_model_comparison.json)
- [500 row-level Spark/Python cases](demand_model_comparison_cases.csv)
- [Largest sampled differences](demand_model_major_disagreements.csv)
