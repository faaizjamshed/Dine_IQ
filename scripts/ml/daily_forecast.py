"""Persist daily item/category/location forecasts with honest recursive backtests."""
import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

os.environ.setdefault("OMP_NUM_THREADS", "1")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor

ROOT = Path(__file__).resolve().parents[2]
FEATURES = ["lag_1", "lag_7", "lag_28", "dow", "month"]


def panel(frame):
    """Calendar reindex before shifting: an absent day is zero, not a skipped lag."""
    data = frame.copy()
    data["day"] = pd.to_datetime(data.day)
    if data.duplicated(["entity", "day"]).any():
        raise ValueError("Duplicate entity/day")
    return data.pivot(index="day", columns="entity", values="units").reindex(
        pd.date_range(data.day.min(), data.day.max(), freq="D")).fillna(0).astype(float)


def training(grid):
    rows = grid.rename_axis(index="day", columns="entity").stack().rename("units").reset_index()
    rows = rows.sort_values(["entity", "day"])
    for lag in (1, 7, 28):
        rows[f"lag_{lag}"] = rows.groupby("entity").units.shift(lag)
    rows["dow"] = rows.day.dt.dayofweek
    rows["month"] = rows.day.dt.month
    return rows.dropna()


def rollout(model, history, days):
    if len(history) < 28 or not 1 <= days <= 28:
        raise ValueError("Need 28 history days and horizon in [1, 28]")
    predicted, baseline = history.copy(), history.copy()
    rows = []
    for step in range(1, days + 1):
        day = history.index[-1] + pd.Timedelta(days=step)
        x = pd.DataFrame({f"lag_{lag}": predicted.iloc[-lag].to_numpy() for lag in (1, 7, 28)})
        x["dow"], x["month"] = day.dayofweek, day.month
        values = np.maximum(0, model.predict(x[FEATURES]))
        naive = baseline.iloc[-7].to_numpy().copy()
        predicted.loc[day], baseline.loc[day] = values, naive
        rows.extend({"entity": str(entity), "day": day.strftime("%Y-%m-%d"), "horizon_day": step,
                     "prediction": float(value), "baseline": float(ref)}
                    for entity, value, ref in zip(history.columns, values, naive))
    return rows


def metrics(actual, predicted):
    difference = np.asarray(actual) - np.asarray(predicted)
    return {"mae": float(np.abs(difference).mean()), "rmse": float(np.sqrt(np.square(difference).mean()))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="results/submission/forecast-v1")
    args = parser.parse_args()
    out = ROOT / args.output
    out.mkdir(parents=True, exist_ok=False)
    source = ROOT / "results/analytics/srs_completion/v1/daily_demand.parquet"
    data = pd.read_parquet(source)
    report = {"version": "daily-v1", "generated_at": datetime.now(timezone.utc).isoformat(),
              "target": "completed-order menu units per calendar day", "weekday": "Monday=0 through Sunday=6",
              "source": str(source.relative_to(ROOT)).replace("\\", "/"),
              "source_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
              "features": FEATURES, "model": "HistGradientBoostingRegressor", "levels": {},
              "note": "Frozen synthetic-data outlook from 2026-08-31, not a live forecast. Horizons recursively use predictions, never future actual lags. No calibrated intervals. Item/category forecasts aggregate all restaurants; levels are independently forecast and are not reconciled hierarchically."}
    served = dict(report)
    served["levels"] = {}
    cases = []
    for level in ("item", "category", "location"):
        grid = panel(data[data.level.eq(level)])
        samples = training(grid)
        fit_rows = samples[samples.day < "2026-06-01"]
        model = HistGradientBoostingRegressor(max_iter=120, max_leaf_nodes=15, learning_rate=.08,
                                             random_state=42, early_stopping=False)
        model.fit(fit_rows[FEATURES], fit_rows.units)
        level_cases = []
        # Fixed training cutoff; each origin may use observed history preceding that origin.
        for origin in ("2026-05-31", "2026-06-28", "2026-07-26"):
            for row in rollout(model, grid.loc[:origin], 28):
                row.update(level=level, origin=origin, actual=float(grid.loc[row["day"], row["entity"]]))
                level_cases.append(row)
        scores = {}
        for horizon in (7, 14, 28):
            subset = [r for r in level_cases if r["horizon_day"] <= horizon]
            scores[str(horizon)] = {"rows": len(subset),
                "model": metrics([r["actual"] for r in subset], [r["prediction"] for r in subset]),
                "seasonal_naive": metrics([r["actual"] for r in subset], [r["baseline"] for r in subset])}
        model.fit(samples[FEATURES], samples.units)
        path = out / f"{level}.joblib"
        joblib.dump(model, path)
        loaded = joblib.load(path)
        assert np.allclose(model.predict(samples[FEATURES].tail(8)), loaded.predict(samples[FEATURES].tail(8)))
        future = rollout(loaded, grid, 28)
        info = {"entities": list(grid.columns), "training_rows": len(samples), "backtest_training_rows": len(fit_rows),
                "training_end": grid.index[-1].strftime("%Y-%m-%d"), "backtest": scores,
                "model_file": path.name, "model_sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "reload_passed": True}
        report["levels"][level] = info
        history = [{"entity": str(entity), "day": day.strftime("%Y-%m-%d"), "actual": float(value)}
                   for day, series in grid.tail(28).iterrows() for entity, value in series.items()]
        served["levels"][level] = dict(info, forecasts=future, history=history)
        cases.extend(level_cases)
        print(level, json.dumps(scores), flush=True)
    pd.DataFrame(cases).to_csv(out / "backtest_cases.csv", index=False)
    (out / "evaluation.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (out / "serving.json").write_text(json.dumps(served, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {out}; publish serving.json separately after review.")


if __name__ == "__main__":
    main()
