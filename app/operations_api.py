"""Authentication, RBAC, transactional CRUD, exports, reports and audit APIs."""
from __future__ import annotations

import csv
import io
import json
import secrets
import sqlite3
from functools import wraps
from flask import Blueprint, Response, current_app, jsonify, request, session

from app.operational_store import ENTITIES, OperationalStore

WRITABLE = {"locations", "menu-categories", "menu-items", "customers", "orders", "order-items", "promotions", "promotion-items", "ratings", "inventory", "wastage"}
MANAGER_WRITABLE = WRITABLE - {"locations", "menu-categories"}
EXPORTS = {
    "menu": "menu_profitability", "locations_menu": "menu_by_location", "baskets": "basket_rules",
    "customers": "customer_rfm", "wastage": "wastage_dimensions", "wastage_risk": "wastage_risk_ranking",
    "price_sensitivity": "price_sensitivity", "promotions": "promotion_intelligence",
    "rating_anomalies": "rating_anomalies", "sales_anomalies": "sales_anomalies", "recommendations": "recommendations",
}


def _store() -> OperationalStore:
    return current_app.extensions["dineiq_store"]


def _actor() -> dict | None:
    user = session.get("user")
    if not user:
        return None
    current = _store().user_by_id(int(user["user_id"]))
    if current is None:
        session.clear()
        return None
    session["user"] = current
    return current


def _require_user(fn):
    @wraps(fn)
    def wrapped(*args, **kwargs):
        if _actor() is None:
            return jsonify({"error": {"code": "authentication_required", "message": "Sign in to use this application function."}}), 401
        return fn(*args, **kwargs)
    return wrapped


def _csrf_ok() -> bool:
    token = session.get("csrf_token")
    supplied = request.headers.get("X-CSRF-Token", "")
    return bool(token and supplied and secrets.compare_digest(token, supplied))


def register_operations_api(app, service_getter):
    api = Blueprint("dineq_operations", __name__)

    @api.before_request
    def protect_mutations():
        if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
            if request.path in {"/api/auth/login", "/api/auth/register", "/api/auth/logout", "/api/auth/session"}:
                return None
            if not _csrf_ok():
                return jsonify({"error": {"code": "csrf_failed", "message": "Refresh the session token and retry the request."}}), 403

    @api.get("/api/auth/session")
    def auth_session():
        if not session.get("csrf_token"):
            session["csrf_token"] = secrets.token_urlsafe(32)
        return jsonify({"user": _actor(), "csrf_token": session["csrf_token"]})

    @api.post("/api/auth/register")
    def register():
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or set(body) - {"email", "password"}:
            return jsonify({"error": {"code": "invalid_registration", "message": "Provide email and password only. New registrations receive the analyst role."}}), 400
        try:
            created = _store().create_user(body.get("email", ""), body.get("password", ""), "analyst")
        except (ValueError, sqlite3.IntegrityError) as exc:
            _store().add_audit(actor=None, action="registration", outcome="rejected", details={"reason": str(exc)[:120]})
            return jsonify({"error": {"code": "invalid_registration", "message": "Registration details are invalid or the account already exists."}}), 400
        session.clear()
        session["user"] = created
        session["csrf_token"] = secrets.token_urlsafe(32)
        _store().add_audit(actor=created, action="registration", details={"assigned_role": "analyst"})
        return jsonify({"user": created, "csrf_token": session["csrf_token"]}), 201

    @api.post("/api/auth/login")
    def login():
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not isinstance(body.get("email"), str) or not isinstance(body.get("password"), str):
            return jsonify({"error": {"code": "invalid_login", "message": "Provide email and password."}}), 400
        user = _store().authenticate(body["email"], body["password"])
        if user is None:
            _store().add_audit(actor=None, action="login", outcome="rejected", details={"email": body["email"][:254]})
            return jsonify({"error": {"code": "invalid_credentials", "message": "Email or password is incorrect, or sign-in is temporarily locked."}}), 401
        session.clear()
        session["user"] = user
        session["csrf_token"] = secrets.token_urlsafe(32)
        _store().add_audit(actor=user, action="login", details={})
        return jsonify({"user": user, "csrf_token": session["csrf_token"]})

    @api.post("/api/auth/logout")
    @_require_user
    def logout():
        actor = _actor()
        _store().add_audit(actor=actor, action="logout")
        session.clear()
        return jsonify({"logged_out": True})

    @api.get("/api/auth/me")
    def whoami():
        return jsonify({"user": _actor()})

    @api.route("/api/admin/users", methods=["GET", "POST"])
    @api.route("/api/admin/users/<int:user_id>", methods=["PATCH"])
    @_require_user
    def user_admin(user_id=None):
        actor = _actor()
        if actor["role"] != "administrator":
            return jsonify({"error": {"code": "forbidden", "message": "Only administrators can manage application accounts."}}), 403
        if request.method == "GET":
            return jsonify({"items": _store().list_users()})
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({"error": {"code": "invalid_body", "message": "Send a JSON object."}}), 400
        try:
            if request.method == "POST":
                user = _store().create_user(body.get("email", ""), body.get("password", ""), body.get("role", "analyst"), body.get("restaurant_id"))
            else:
                if set(body) - {"role", "is_active", "restaurant_id"}:
                    raise ValueError("Only role, is_active, and restaurant_id can be changed.")
                user = _store().update_user(user_id, role=body.get("role"), is_active=body.get("is_active"), restaurant_id=body.get("restaurant_id"))
                if user is None:
                    return jsonify({"error": {"code": "not_found", "message": "User not found."}}), 404
        except (ValueError, sqlite3.IntegrityError):
            return jsonify({"error": {"code": "invalid_user", "message": "Account details violate role, password, or location requirements."}}), 400
        _store().add_audit(actor=actor, action="user_admin", entity="users", record_key=str(user.get("user_id", user_id)), details={"role": user.get("role"), "active": user.get("is_active", True)})
        return jsonify({"user": user}), 201 if request.method == "POST" else 200

    @api.route("/api/management/<entity>", methods=["GET", "POST"])
    @api.route("/api/management/<entity>/<key>", methods=["GET", "PUT", "DELETE"])
    @_require_user
    def management(entity, key=None):
        store, actor = _store(), _actor()
        if entity not in ENTITIES:
            return jsonify({"error": {"code": "unknown_entity", "message": "This operational entity is not supported."}}), 404
        role = actor["role"]
        if request.method == "GET":
            if key is None:
                rows = store.list_entity(entity, actor.get("restaurant_id") if role == "restaurant_manager" else None)
                return jsonify({"entity": entity, "count": len(rows), "items": rows, "data_boundary": "operational SQLite only; canonical analytical CSV/HDFS is not modified"})
            row = store.get_entity(entity, key)
            if row is None:
                return jsonify({"error": {"code": "not_found", "message": "Record not found."}}), 404
            if role == "restaurant_manager" and row.get("restaurant_id") != actor.get("restaurant_id"):
                return jsonify({"error": {"code": "forbidden", "message": "This record is outside your assigned restaurant."}}), 403
            return jsonify({"item": row})
        if role == "analyst" or role not in {"administrator", "regional_manager", "restaurant_manager"}:
            return jsonify({"error": {"code": "forbidden", "message": "Your role cannot change operational records."}}), 403
        if entity not in WRITABLE or ENTITIES[entity].get("readonly"):
            return jsonify({"error": {"code": "read_only_entity", "message": "This entity is maintained through a linked workflow."}}), 405
        if role == "restaurant_manager" and entity not in MANAGER_WRITABLE:
            return jsonify({"error": {"code": "forbidden", "message": "Your role cannot manage this entity."}}), 403
        body = request.get_json(silent=True) if request.method in {"POST", "PUT"} else None
        if request.method in {"POST", "PUT"} and not isinstance(body, dict):
            return jsonify({"error": {"code": "invalid_body", "message": "Send a JSON object."}}), 400
        if role == "restaurant_manager" and entity in {"orders", "ratings", "inventory", "wastage"}:
            if body is not None and body.get("restaurant_id", actor.get("restaurant_id")) != actor.get("restaurant_id"):
                return jsonify({"error": {"code": "forbidden", "message": "Records must belong to your assigned restaurant."}}), 403
            if body is not None: body["restaurant_id"] = actor.get("restaurant_id")
        if role == "restaurant_manager" and key is not None:
            existing = store.get_entity(entity, key)
            if existing and "restaurant_id" in existing and existing["restaurant_id"] != actor.get("restaurant_id"):
                return jsonify({"error": {"code": "forbidden", "message": "This record is outside your assigned restaurant."}}), 403
        try:
            if request.method == "DELETE":
                deleted = store.delete_entity(entity, key)
                if not deleted:
                    return jsonify({"error": {"code": "not_found", "message": "Record not found."}}), 404
                result = {"deleted": True, "key": key}
                action = "delete"
            else:
                result = store.save_entity(entity, body, key=key, actor_id=actor["user_id"])
                action = "create" if request.method == "POST" else "update"
        except KeyError as exc:
            return jsonify({"error": {"code": "not_found", "message": str(exc).strip("'")}}), 404
        except ValueError as exc:
            return jsonify({"error": {"code": "invalid_record", "message": str(exc)}}), 400
        except sqlite3.IntegrityError as exc:
            return jsonify({"error": {"code": "integrity_conflict", "message": "The record conflicts with a required relationship or unique key."}}), 409
        record_key = str(result.get(ENTITIES[entity]["pk"], key))
        _store().add_audit(actor=actor, action=action, entity=entity, record_key=record_key, details={"fields": sorted(body) if body else []})
        return jsonify({"item": result}), 201 if request.method == "POST" else 200

    @api.get("/api/export/<dataset>")
    @_require_user
    def export(dataset):
        if dataset not in EXPORTS:
            return jsonify({"error": {"code": "unknown_export", "message": "Choose a supported result set."}}), 404
        actor = _actor()
        if actor["role"] == "restaurant_manager" and dataset == "customers":
            return jsonify({"error": {"code": "forbidden", "message": "Customer-level cross-location export is not permitted."}}), 403
        try:
            limit = int(request.args.get("limit", "1000"))
        except ValueError:
            return jsonify({"error": {"code": "invalid_limit", "message": "limit must be an integer from 1 to 5000."}}), 400
        if not 1 <= limit <= 5000:
            return jsonify({"error": {"code": "invalid_limit", "message": "limit must be from 1 to 5000."}}), 400
        service = service_getter()
        records = service.gap1_tables[EXPORTS[dataset]]
        restaurant = request.args.get("restaurant_id", "").strip().upper()
        if restaurant:
            if not any(r.get("restaurant_id") == restaurant for r in service.tables["restaurants"]):
                return jsonify({"error": {"code": "invalid_filter", "message": "restaurant_id is not present in canonical analytics."}}), 400
            records = [r for r in records if r.get("restaurant_id") == restaurant]
        records = records[:limit]
        fmt = request.args.get("format", "csv").lower()
        _store().add_audit(actor=actor, action="export", entity=dataset, details={"format": fmt, "rows": len(records), "restaurant_filter": restaurant or None})
        if fmt == "json":
            return Response(json.dumps({"dataset": dataset, "source": "Spark gap-closure v6 derived from canonical v4", "count": len(records), "items": records}, default=str), mimetype="application/json", headers={"Content-Disposition": f"attachment; filename=dineq-{dataset}.json"})
        if fmt != "csv":
            return jsonify({"error": {"code": "invalid_format", "message": "format must be csv or json."}}), 400
        output = io.StringIO(newline="")
        if records:
            writer = csv.DictWriter(output, fieldnames=list(records[0]), extrasaction="ignore")
            writer.writeheader(); writer.writerows(records)
        return Response(output.getvalue(), mimetype="text/csv", headers={"Content-Disposition": f"attachment; filename=dineq-{dataset}.csv"})

    @api.get("/api/reports/<dataset>")
    @_require_user
    def report(dataset):
        if dataset not in EXPORTS:
            return jsonify({"error": {"code": "unknown_report", "message": "Choose a supported analytical report."}}), 404
        service = service_getter(); key = EXPORTS[dataset]
        data = service.gap1_tables[key]
        report_data = {"report": dataset, "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(), "source": "Spark gap-closure v6; canonical input /dineq/processed/v4", "records": len(data), "items": data[:1000]}
        _store().add_audit(actor=_actor(), action="report_download", entity=dataset, details={"records_included": len(report_data["items"])})
        return Response(json.dumps(report_data, default=str), mimetype="application/json", headers={"Content-Disposition": f"attachment; filename=dineq-{dataset}-report.json"})

    @api.get("/api/system/audit")
    @_require_user
    def audit_view():
        if _actor()["role"] != "administrator":
            return jsonify({"error": {"code": "forbidden", "message": "Audit events are available to administrators only."}}), 403
        try: limit = int(request.args.get("limit", "200"))
        except ValueError: return jsonify({"error": {"code": "invalid_limit", "message": "limit must be an integer from 1 to 500."}}), 400
        if not 1 <= limit <= 500: return jsonify({"error": {"code": "invalid_limit", "message": "limit must be from 1 to 500."}}), 400
        return jsonify({"items": _store().audit_rows(limit), "count": len(_store().audit_rows(limit))})

    @api.route("/api/admin/settings", methods=["GET", "PUT"])
    @_require_user
    def app_settings():
        actor = _actor()
        if actor["role"] != "administrator":
            return jsonify({"error": {"code": "forbidden", "message": "Only administrators can view or update application settings."}}), 403
        allowed = {"default_analytics_page", "report_retention_days"}
        if request.method == "GET":
            with _store().connect() as conn:
                rows = conn.execute("SELECT setting_key,value_json,updated_at FROM application_settings ORDER BY setting_key")
                return jsonify({"items": [{"key": r["setting_key"], "value": json.loads(r["value_json"]), "updated_at": r["updated_at"]} for r in rows]})
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or set(body) - allowed or not body:
            return jsonify({"error": {"code": "invalid_setting", "message": "Only supported non-secret application settings may be updated."}}), 400
        with _store().connect() as conn:
            for key, value in body.items():
                if key == "default_analytics_page" and value not in {"overview", "menu", "intelligence", "forecast"}:
                    return jsonify({"error": {"code": "invalid_setting", "message": "Unsupported default page."}}), 400
                if key == "report_retention_days" and (isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 365):
                    return jsonify({"error": {"code": "invalid_setting", "message": "report_retention_days must be an integer from 1 to 365."}}), 400
                conn.execute("INSERT INTO application_settings(setting_key,value_json,updated_at,updated_by) VALUES(?,?,datetime('now'),?) ON CONFLICT(setting_key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by", (key, json.dumps(value), actor["user_id"]))
        _store().add_audit(actor=actor, action="settings_update", entity="application_settings", details={"keys": sorted(body)})
        return jsonify({"updated": sorted(body)})

    app.register_blueprint(api)
