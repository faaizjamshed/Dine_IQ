"""SQLite operational store, authentication, CRUD validation, and audit events.

Operational records here are deliberately separate from the frozen CSV/HDFS
competition dataset. Analytics continue to read the canonical Spark outputs.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "instance" / "dineq_operational.sqlite3"
ROLES = {"restaurant_manager", "analyst", "regional_manager", "administrator"}

ENTITIES: dict[str, dict[str, Any]] = {
    "locations": {"table": "locations", "pk": "restaurant_id", "required": ["restaurant_id", "restaurant_name", "city"], "fields": ["restaurant_id", "restaurant_name", "city", "address", "is_active"]},
    "menu-categories": {"table": "menu_categories", "pk": "category_id", "required": ["category_id", "category_name"], "fields": ["category_id", "category_name", "description"]},
    "menu-items": {"table": "menu_items", "pk": "menu_item_id", "required": ["menu_item_id", "category_id", "item_name", "price", "cost", "available"], "fields": ["menu_item_id", "category_id", "item_name", "description", "price", "cost", "available"]},
    "pricing-history": {"table": "pricing_history", "pk": "pricing_id", "required": [], "fields": ["pricing_id", "menu_item_id", "old_price", "new_price", "effective_at", "changed_by", "reason"], "readonly": True},
    "customers": {"table": "customers", "pk": "customer_id", "required": [], "fields": ["customer_id", "created_at", "behavior_profile_json"]},
    "orders": {"table": "orders", "pk": "order_id", "required": ["order_id", "restaurant_id", "order_datetime", "status", "channel"], "fields": ["order_id", "customer_id", "restaurant_id", "promotion_id", "order_datetime", "status", "channel", "subtotal", "discount", "total"]},
    "order-items": {"table": "order_items", "pk": "order_item_id", "required": ["order_id", "menu_item_id", "quantity", "unit_price"], "fields": ["order_item_id", "order_id", "menu_item_id", "quantity", "unit_price", "line_total"]},
    "promotions": {"table": "promotions", "pk": "promotion_id", "required": ["promotion_id", "promotion_name", "start_date", "end_date", "discount_pct"], "fields": ["promotion_id", "promotion_name", "start_date", "end_date", "discount_pct", "is_active"]},
    "ratings": {"table": "ratings", "pk": "rating_id", "required": ["rating_id", "customer_id", "restaurant_id", "rating", "rated_at"], "fields": ["rating_id", "customer_id", "restaurant_id", "menu_item_id", "rating", "rated_at"]},
    "promotion-items": {"table": "promotion_items", "pk": "promotion_item_id", "required": ["promotion_item_id", "promotion_id", "menu_item_id"], "fields": ["promotion_item_id", "promotion_id", "menu_item_id"]},
    "inventory": {"table": "inventory", "pk": "inventory_id", "required": ["inventory_id", "restaurant_id", "menu_item_id", "quantity_on_hand", "quantity_consumed", "replenishment_quantity", "reorder_level", "updated_at"], "fields": ["inventory_id", "restaurant_id", "menu_item_id", "quantity_on_hand", "quantity_consumed", "replenishment_quantity", "reorder_level", "updated_at"]},
    "wastage": {"table": "wastage", "pk": "wastage_id", "required": ["wastage_id", "restaurant_id", "menu_item_id", "waste_date", "quantity_wasted", "cost", "reason"], "fields": ["wastage_id", "restaurant_id", "menu_item_id", "waste_date", "quantity_wasted", "cost", "reason"]},
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS application_settings(setting_key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by INTEGER, FOREIGN KEY(updated_by) REFERENCES users(user_id));
CREATE TABLE IF NOT EXISTS users(
 user_id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('restaurant_manager','analyst','regional_manager','administrator')),
 restaurant_id TEXT, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL,
 FOREIGN KEY(restaurant_id) REFERENCES locations(restaurant_id)
);
CREATE TABLE IF NOT EXISTS locations(restaurant_id TEXT PRIMARY KEY, restaurant_name TEXT NOT NULL, city TEXT NOT NULL, address TEXT, is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS menu_categories(category_id TEXT PRIMARY KEY, category_name TEXT NOT NULL, description TEXT);
CREATE TABLE IF NOT EXISTS menu_items(menu_item_id TEXT PRIMARY KEY, category_id TEXT NOT NULL, item_name TEXT NOT NULL, description TEXT, price REAL NOT NULL CHECK(price>=0), cost REAL NOT NULL CHECK(cost>=0), available INTEGER NOT NULL DEFAULT 1, FOREIGN KEY(category_id) REFERENCES menu_categories(category_id));
CREATE TABLE IF NOT EXISTS pricing_history(pricing_id INTEGER PRIMARY KEY AUTOINCREMENT, menu_item_id TEXT NOT NULL, old_price REAL, new_price REAL NOT NULL, effective_at TEXT NOT NULL, changed_by INTEGER, reason TEXT, FOREIGN KEY(menu_item_id) REFERENCES menu_items(menu_item_id), FOREIGN KEY(changed_by) REFERENCES users(user_id));
CREATE TABLE IF NOT EXISTS customers(customer_id TEXT PRIMARY KEY, created_at TEXT NOT NULL, behavior_profile_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS promotions(promotion_id TEXT PRIMARY KEY, promotion_name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, discount_pct REAL NOT NULL CHECK(discount_pct BETWEEN 0 AND 100), is_active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS promotion_items(promotion_item_id TEXT PRIMARY KEY, promotion_id TEXT NOT NULL, menu_item_id TEXT NOT NULL, UNIQUE(promotion_id,menu_item_id), FOREIGN KEY(promotion_id) REFERENCES promotions(promotion_id) ON DELETE CASCADE, FOREIGN KEY(menu_item_id) REFERENCES menu_items(menu_item_id));
CREATE TABLE IF NOT EXISTS orders(order_id TEXT PRIMARY KEY, customer_id TEXT, restaurant_id TEXT NOT NULL, promotion_id TEXT, order_datetime TEXT NOT NULL, status TEXT NOT NULL, channel TEXT NOT NULL, subtotal REAL NOT NULL DEFAULT 0 CHECK(subtotal>=0), discount REAL NOT NULL DEFAULT 0 CHECK(discount>=0), total REAL NOT NULL DEFAULT 0 CHECK(total>=0), FOREIGN KEY(customer_id) REFERENCES customers(customer_id), FOREIGN KEY(restaurant_id) REFERENCES locations(restaurant_id), FOREIGN KEY(promotion_id) REFERENCES promotions(promotion_id));
CREATE TABLE IF NOT EXISTS order_items(order_item_id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL, menu_item_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0), unit_price REAL NOT NULL CHECK(unit_price>=0), line_total REAL NOT NULL CHECK(line_total>=0), FOREIGN KEY(order_id) REFERENCES orders(order_id) ON DELETE CASCADE, FOREIGN KEY(menu_item_id) REFERENCES menu_items(menu_item_id));
CREATE TABLE IF NOT EXISTS ratings(rating_id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, restaurant_id TEXT NOT NULL, menu_item_id TEXT, rating REAL NOT NULL CHECK(rating BETWEEN 1 AND 5), rated_at TEXT NOT NULL, FOREIGN KEY(customer_id) REFERENCES customers(customer_id), FOREIGN KEY(restaurant_id) REFERENCES locations(restaurant_id), FOREIGN KEY(menu_item_id) REFERENCES menu_items(menu_item_id));
CREATE TABLE IF NOT EXISTS inventory(inventory_id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, menu_item_id TEXT NOT NULL, quantity_on_hand REAL NOT NULL CHECK(quantity_on_hand>=0), quantity_consumed REAL NOT NULL DEFAULT 0 CHECK(quantity_consumed>=0), replenishment_quantity REAL NOT NULL DEFAULT 0 CHECK(replenishment_quantity>=0), reorder_level REAL NOT NULL CHECK(reorder_level>=0), updated_at TEXT NOT NULL, FOREIGN KEY(restaurant_id) REFERENCES locations(restaurant_id), FOREIGN KEY(menu_item_id) REFERENCES menu_items(menu_item_id));
CREATE TABLE IF NOT EXISTS wastage(wastage_id TEXT PRIMARY KEY, restaurant_id TEXT NOT NULL, menu_item_id TEXT NOT NULL, waste_date TEXT NOT NULL, quantity_wasted REAL NOT NULL CHECK(quantity_wasted>=0), cost REAL NOT NULL CHECK(cost>=0), reason TEXT NOT NULL, FOREIGN KEY(restaurant_id) REFERENCES locations(restaurant_id), FOREIGN KEY(menu_item_id) REFERENCES menu_items(menu_item_id));
CREATE TABLE IF NOT EXISTS analytics_artifacts(artifact_id TEXT PRIMARY KEY, source_version TEXT NOT NULL, artifact_type TEXT NOT NULL, source_path TEXT NOT NULL, row_count INTEGER, metadata_json TEXT NOT NULL, recorded_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS recommendation_snapshots(snapshot_id INTEGER PRIMARY KEY AUTOINCREMENT, source_version TEXT NOT NULL, recommendation_key TEXT NOT NULL, payload_json TEXT NOT NULL, captured_at TEXT NOT NULL, UNIQUE(source_version,recommendation_key));
CREATE TABLE IF NOT EXISTS audit_events(event_id INTEGER PRIMARY KEY AUTOINCREMENT, occurred_at TEXT NOT NULL, actor_user_id INTEGER, actor_role TEXT, action TEXT NOT NULL, entity TEXT, record_key TEXT, outcome TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS login_attempts(email TEXT PRIMARY KEY COLLATE NOCASE, failures INTEGER NOT NULL DEFAULT 0, window_started TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_audit_occurred ON audit_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_time ON orders(restaurant_id,order_datetime);
CREATE INDEX IF NOT EXISTS idx_wastage_restaurant_date ON wastage(restaurant_id,waste_date);
"""


class ClosingConnection(sqlite3.Connection):
    """Close connections after standard sqlite transaction context handling."""
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def now_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _hash_password(password: str, salt: bytes | None = None) -> str:
    if not isinstance(password, str) or len(password) < 12 or len(password) > 256:
        raise ValueError("Password must be between 12 and 256 characters.")
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)
    return f"scrypt${salt.hex()}${digest.hex()}"


def _verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, salt_hex, digest_hex = stored.split("$", 2)
        if algorithm != "scrypt":
            return False
        candidate = _hash_for_verify(password, bytes.fromhex(salt_hex))
        return hmac.compare_digest(candidate.hex(), digest_hex)
    except (ValueError, TypeError):
        return False


def _hash_for_verify(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**14, r=8, p=1, dklen=32)


class OperationalStore:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(path or os.environ.get("DINEIQ_DATABASE_PATH") or DEFAULT_DB)
        if str(self.path) != ":memory:":
            self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.path), timeout=10, factory=ClosingConnection)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=10000")
        return conn

    def initialize(self) -> None:
        with self.connect() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(SCHEMA)
            conn.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,?)", (now_utc(),))
            inventory_columns = {row[1] for row in conn.execute("PRAGMA table_info(inventory)")}
            for name in ("quantity_consumed", "replenishment_quantity"):
                if name not in inventory_columns:
                    conn.execute(f"ALTER TABLE inventory ADD COLUMN {name} REAL NOT NULL DEFAULT 0 CHECK({name}>=0)")
            customer_columns = {row[1] for row in conn.execute("PRAGMA table_info(customers)")}
            if "behavior_profile_json" not in customer_columns:
                conn.execute("ALTER TABLE customers ADD COLUMN behavior_profile_json TEXT NOT NULL DEFAULT '{}'")
            conn.execute("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,?)", (now_utc(),))

    def record_analytics_state(self, artifacts: list[dict[str, Any]], recommendations: list[dict[str, Any]]) -> None:
        captured = now_utc()
        with self.connect() as conn:
            for item in artifacts:
                conn.execute("INSERT OR REPLACE INTO analytics_artifacts VALUES(?,?,?,?,?,?,?)", (item["artifact_id"], item["source_version"], item["artifact_type"], item["source_path"], item.get("row_count"), json.dumps(item.get("metadata", {}), default=str), captured))
            for index, row in enumerate(recommendations):
                conn.execute("INSERT OR REPLACE INTO recommendation_snapshots(source_version,recommendation_key,payload_json,captured_at) VALUES(?,?,?,?)", ("gap1-v6", f"{index}:{row.get('source')}:{row.get('action')}:{row.get('subject')}", json.dumps(row, default=str), captured))

    def artifact_rows(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [dict(row) | {"metadata": json.loads(row["metadata_json"])} for row in conn.execute("SELECT * FROM analytics_artifacts ORDER BY source_version,artifact_type")]

    def create_user(self, email: str, password: str, role: str = "analyst", restaurant_id: str | None = None) -> dict[str, Any]:
        if not isinstance(email, str):
            raise ValueError("A valid email address is required.")
        email = email.strip().casefold()
        if len(email) > 254 or "@" not in email:
            raise ValueError("A valid email address is required.")
        if role not in ROLES:
            raise ValueError("Unsupported user role.")
        if role == "restaurant_manager" and not restaurant_id:
            raise ValueError("Restaurant managers must be assigned a restaurant_id.")
        encoded = _hash_password(password)
        with self.connect() as conn:
            cur = conn.execute("INSERT INTO users(email,password_hash,role,restaurant_id,created_at) VALUES(?,?,?,?,?)", (email, encoded, role, restaurant_id, now_utc()))
            return {"user_id": cur.lastrowid, "email": email, "role": role, "restaurant_id": restaurant_id}

    def bootstrap_admin(self) -> None:
        from app.security_config import read_secret
        email, password = os.environ.get("DINEIQ_BOOTSTRAP_ADMIN_EMAIL"), read_secret("DINEIQ_BOOTSTRAP_ADMIN_PASSWORD")
        if not email and not password:
            return
        if not email or not password:
            raise RuntimeError("Both DINEIQ_BOOTSTRAP_ADMIN_EMAIL and DINEIQ_BOOTSTRAP_ADMIN_PASSWORD are required.")
        with self.connect() as conn:
            count = conn.execute("SELECT count(*) FROM users WHERE role='administrator'").fetchone()[0]
        if count == 0:
            self.create_user(email, password, "administrator")

    def authenticate(self, email: str, password: str) -> dict[str, Any] | None:
        email = str(email or "").strip().casefold()
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE email=? AND is_active=1", (email,)).fetchone()
            attempt = conn.execute("SELECT failures,window_started FROM login_attempts WHERE email=?", (email,)).fetchone()
            locked = False
            if attempt:
                try:
                    started = datetime.fromisoformat(attempt["window_started"])
                    locked = attempt["failures"] >= 5 and (datetime.now(timezone.utc) - started).total_seconds() < 900
                except ValueError:
                    locked = True
            if not locked and row and _verify_password(password or "", row["password_hash"]):
                conn.execute("DELETE FROM login_attempts WHERE email=?", (email,))
                return {"user_id": row["user_id"], "email": row["email"], "role": row["role"], "restaurant_id": row["restaurant_id"]}
            if attempt is None or (datetime.now(timezone.utc) - datetime.fromisoformat(attempt["window_started"])).total_seconds() >= 900:
                conn.execute("DELETE FROM login_attempts WHERE email=?", (email,))
                conn.execute("INSERT INTO login_attempts VALUES(?,?,?)", (email, 1, now_utc()))
            else:
                conn.execute("UPDATE login_attempts SET failures=failures+1 WHERE email=?", (email,))
        return None

    def user_by_id(self, user_id: int) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute("SELECT user_id,email,role,restaurant_id FROM users WHERE user_id=? AND is_active=1", (user_id,)).fetchone()
            return dict(row) if row else None

    def list_users(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [dict(r) for r in conn.execute("SELECT user_id,email,role,restaurant_id,is_active,created_at FROM users ORDER BY user_id")]

    def update_user(self, user_id: int, *, role: str | None = None, is_active: bool | None = None, restaurant_id: str | None = None) -> dict[str, Any] | None:
        if role is not None and role not in ROLES:
            raise ValueError("Unsupported user role.")
        fields, values = [], []
        for name, value in (("role", role), ("is_active", int(is_active) if is_active is not None else None), ("restaurant_id", restaurant_id)):
            if value is not None:
                fields.append(f"{name}=?"); values.append(value)
        if not fields:
            raise ValueError("Supply role, is_active, or restaurant_id.")
        with self.connect() as conn:
            cur = conn.execute("UPDATE users SET "+", ".join(fields)+" WHERE user_id=?", values+[user_id])
            if cur.rowcount == 0:
                return None
            row = conn.execute("SELECT user_id,email,role,restaurant_id,is_active,created_at FROM users WHERE user_id=?", (user_id,)).fetchone()
            return dict(row) if row else None

    def record_spark_job_event(self, *, job: str, run_id: str, phase: str, details: dict[str, Any] | None = None) -> None:
        outcomes = {"start": "started", "complete": "success", "failure": "failure", "interrupted": "interrupted"}
        if phase not in outcomes:
            raise ValueError("Spark job phase must be start, complete, failure, or interrupted.")
        self.add_audit(actor={"role": "system"}, action=f"spark_job_{phase}", outcome=outcomes[phase],
                       entity="spark_job", record_key=run_id, details={"job": job, **(details or {})})

    def add_audit(self, *, actor: dict[str, Any] | None, action: str, outcome: str = "success", entity: str | None = None, record_key: str | None = None, details: dict[str, Any] | None = None) -> None:
        safe_details = {k: v for k, v in (details or {}).items() if k.casefold() not in {"password", "token", "secret", "authorization", "cookie"}}
        with self.connect() as conn:
            conn.execute("INSERT INTO audit_events(occurred_at,actor_user_id,actor_role,action,entity,record_key,outcome,details_json) VALUES(?,?,?,?,?,?,?,?)",
                         (now_utc(), actor.get("user_id") if actor else None, actor.get("role") if actor else None, action, entity, record_key, outcome, json.dumps(safe_details, default=str)))

    def audit_rows(self, limit: int = 200) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [dict(r) | {"details": json.loads(r["details_json"])} for r in conn.execute("SELECT * FROM audit_events ORDER BY event_id DESC LIMIT ?", (limit,))]

    def list_entity(self, entity: str, restaurant_id: str | None = None) -> list[dict[str, Any]]:
        spec = ENTITIES[entity]
        with self.connect() as conn:
            if restaurant_id and "restaurant_id" in spec["fields"]:
                rows = conn.execute(f"SELECT * FROM {spec['table']} WHERE restaurant_id=? ORDER BY {spec['pk']} LIMIT 1000", (restaurant_id,))
            else:
                rows = conn.execute(f"SELECT * FROM {spec['table']} ORDER BY {spec['pk']} LIMIT 1000")
            return [dict(r) for r in rows]

    def get_entity(self, entity: str, key: str) -> dict[str, Any] | None:
        spec = ENTITIES[entity]
        with self.connect() as conn:
            row = conn.execute(f"SELECT * FROM {spec['table']} WHERE {spec['pk']}=?", (key,)).fetchone()
            return dict(row) if row else None

    def save_entity(self, entity: str, body: dict[str, Any], *, key: str | None = None, actor_id: int | None = None) -> dict[str, Any]:
        if entity not in ENTITIES or not isinstance(body, dict):
            raise ValueError("Unsupported entity or invalid request body.")
        spec = ENTITIES[entity]
        if spec.get("readonly"):
            raise ValueError("This entity is maintained by the associated workflow and is read-only.")
        fields = [f for f in spec["fields"] if f in body and not (f == spec["pk"] and key is not None)]
        unknown = set(body) - set(spec["fields"])
        if unknown:
            raise ValueError("Unknown fields: " + ", ".join(sorted(unknown)))
        if key is None:
            missing = [f for f in spec["required"] if f not in body]
            if missing:
                raise ValueError("Missing required fields: " + ", ".join(missing))
            if spec["pk"] not in fields:
                fields.insert(0, spec["pk"])
        if not fields:
            raise ValueError("No supported fields supplied.")
        values = {f: body.get(f) for f in fields}
        date_fields = {
            "orders": {"order_datetime": "datetime"},
            "promotions": {"start_date": "date", "end_date": "date"},
            "ratings": {"rated_at": "datetime"},
            "inventory": {"updated_at": "datetime"},
            "wastage": {"waste_date": "date"},
        }
        for field, kind in date_fields.get(entity, {}).items():
            if field not in values or values[field] is None:
                continue
            raw_value = str(values[field]).strip()
            try:
                if kind == "datetime":
                    if "T" not in raw_value and " " not in raw_value:
                        raise ValueError
                    parsed_value = datetime.fromisoformat(raw_value.replace("Z", "+00:00"))
                else:
                    parsed_value = date.fromisoformat(raw_value)
            except (TypeError, ValueError) as exc:
                expected = "an ISO 8601 timestamp" if kind == "datetime" else "an ISO 8601 date"
                raise ValueError(f"{field} must be {expected}.") from exc
            values[field] = parsed_value.isoformat()
        if entity == "promotions":
            existing = self.get_entity(entity, key) if key is not None else None
            start_value = values.get("start_date", (existing or {}).get("start_date"))
            end_value = values.get("end_date", (existing or {}).get("end_date"))
            if start_value and end_value and date.fromisoformat(end_value) < date.fromisoformat(start_value):
                raise ValueError("end_date must not be earlier than start_date.")
        if entity == "customers" and key is None:
            if values.get("customer_id") is None:
                values["customer_id"] = "anon_" + secrets.token_hex(16)
            if "customer_id" not in fields: fields.append("customer_id")
            if values.get("created_at") is None:
                values["created_at"] = now_utc()
            if "created_at" not in fields:
                fields.append("created_at")
            if not __import__("re").fullmatch(r"anon_[a-f0-9]{32}", str(values["customer_id"])):
                raise ValueError("customer_id must be an application-issued anonymized key; omit it to generate one.")
            values.setdefault("behavior_profile_json", "{}")
            if "behavior_profile_json" not in fields: fields.append("behavior_profile_json")
        if entity == "customers" and "behavior_profile_json" in values:
            try:
                profile = json.loads(values["behavior_profile_json"]) if isinstance(values["behavior_profile_json"], str) else values["behavior_profile_json"]
            except (ValueError, TypeError) as exc:
                raise ValueError("behavior_profile_json must be a JSON object of non-identifying behavior features.") from exc
            if not isinstance(profile, dict) or {str(k).casefold() for k in profile}.intersection({"name", "email", "phone", "address", "first_name", "last_name"}):
                raise ValueError("Customer behavior profile must be an object without direct personal identifiers.")
            values["behavior_profile_json"] = json.dumps(profile)
        if entity == "orders" and key is None:
            values.setdefault("subtotal", 0.0); values.setdefault("discount", 0.0); values.setdefault("total", values["subtotal"]-values["discount"])
            for name in ("subtotal", "discount", "total"):
                if name not in fields: fields.append(name); values[name] = values[name]
        if entity == "order-items" and key is None:
            values.setdefault("line_total", float(values["quantity"]) * float(values["unit_price"]))
            if "line_total" not in fields: fields.append("line_total")
        if entity == "order-items" and key is None:
            values.setdefault("line_total", float(values["quantity"]) * float(values["unit_price"]))
            if "line_total" not in fields: fields.append("line_total")
        for f in ("quantity", "quantity_on_hand", "reorder_level", "quantity_wasted", "price", "cost", "unit_price", "line_total", "subtotal", "discount", "total", "discount_pct", "rating"):
            if f in values and values[f] is not None:
                n = float(values[f])
                if not (n >= 0 and n < float("inf")):
                    raise ValueError(f"{f} must be a finite nonnegative number.")
                if f == "rating" and n > 5 or f == "discount_pct" and n > 100:
                    raise ValueError(f"{f} is outside its allowed range.")
                if f == "quantity" and not n.is_integer():
                    raise ValueError("quantity must be a whole number.")
                values[f] = int(n) if f == "quantity" else n
        for f in ("available", "is_active"):
            if f in values and values[f] not in (True, False, 0, 1):
                raise ValueError(f"{f} must be boolean.")
            if f in values:
                values[f] = int(bool(values[f]))
        if entity == "customers":
            # The operational customer key is an app-issued pseudonym; names/emails are not accepted.
            forbidden = {"name", "first_name", "last_name", "email", "phone"}.intersection(body)
            if forbidden:
                raise ValueError("Customer records accept pseudonymous IDs only; direct identifiers are prohibited.")
        table, pk = spec["table"], spec["pk"]
        cols = ",".join(fields)
        marks = ",".join("?" for _ in fields)
        with self.connect() as conn:
            if key is None:
                conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(values[f] for f in fields))
                record_key = values.get(pk)
                if entity == "menu-items":
                    conn.execute("INSERT INTO pricing_history(menu_item_id,old_price,new_price,effective_at,changed_by,reason) VALUES(?,?,?,?,?,?)", (record_key, None, values["price"], now_utc(), actor_id, "Initial operational menu price"))
            else:
                if table == "menu_items":
                    previous = conn.execute("SELECT price FROM menu_items WHERE menu_item_id=?", (key,)).fetchone()
                    if previous is None:
                        raise KeyError("Record not found.")
                else:
                    previous = None
                conn.execute(f"UPDATE {table} SET "+",".join(f"{f}=?" for f in fields)+f" WHERE {pk}=?", tuple(values[f] for f in fields)+(key,))
                if previous is not None and "price" in values and float(previous["price"]) != float(values["price"]):
                    conn.execute("INSERT INTO pricing_history(menu_item_id,old_price,new_price,effective_at,changed_by,reason) VALUES(?,?,?,?,?,?)", (key, previous["price"], values["price"], now_utc(), actor_id, "Menu price updated through operational management"))
                record_key = key
            row = conn.execute(f"SELECT * FROM {table} WHERE {pk}=?", (record_key,)).fetchone()
            return dict(row)

    def delete_entity(self, entity: str, key: str) -> bool:
        spec = ENTITIES[entity]
        with self.connect() as conn:
            cur = conn.execute(f"DELETE FROM {spec['table']} WHERE {spec['pk']}=?", (key,))
            return cur.rowcount == 1
