"""Serve frozen daily outlooks; never train a model during an HTTP request."""
import hashlib
import json
from pathlib import Path
from flask import Blueprint, jsonify, request

DATA = Path(__file__).resolve().parent / "data" / "daily_forecast.json"
bp = Blueprint("daily_forecasts", __name__)


def select_forecast(data, args):
    if set(args) - {"level", "entity", "horizon"}:
        raise ValueError("Supported filters are level, entity and horizon only")
    level = args.get("level", "item")
    if level not in data["levels"]:
        raise ValueError("Level must be item, category or location")
    info = data["levels"][level]
    try:
        horizon = int(args.get("horizon", "7"))
    except (TypeError, ValueError):
        raise ValueError("Horizon must be 7, 14 or 28 days")
    if horizon not in (7, 14, 28):
        raise ValueError("Horizon must be 7, 14 or 28 days")
    entity = args.get("entity") or info["entities"][0]
    if entity not in info["entities"]:
        raise ValueError("Unknown entity for this level")
    return {"version": data["version"], "target": data["target"], "note": data["note"],
            "level": level, "entity": entity, "entities": info["entities"], "horizon": horizon,
            "training_end": info["training_end"], "generated_at": data["generated_at"],
            "model": data["model"], "backtest": info["backtest"][str(horizon)],
            "history": [r for r in info["history"] if r["entity"] == entity],
            "forecasts": [r for r in info["forecasts"] if r["entity"] == entity and r["horizon_day"] <= horizon]}


@bp.get("/api/ml/daily-forecast")
def daily_forecast():
    try:
        content = DATA.read_bytes()
        if hashlib.sha256(content).hexdigest() != DATA.with_suffix(".sha256").read_text().strip():
            raise ValueError("Forecast checksum mismatch")
        data = json.loads(content)
    except (OSError, ValueError):
        return jsonify(error={"code": "forecast_unavailable", "message": "Verified daily forecast artifact is unavailable."}), 503
    try:
        return jsonify(select_forecast(data, request.args))
    except ValueError as error:
        return jsonify(error={"code": "invalid_filter", "message": str(error)}), 400
