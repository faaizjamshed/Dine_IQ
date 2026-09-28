"""Grounded, dependency-free conversational guide for DineIQ.

The assistant deliberately answers from the application's loaded analytical
tables and a small, reviewed catalog of project definitions.  It does not call
an external language model and it never invents a metric that is absent from
the evidence bundle.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any, Iterable


def _normalise(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value).casefold()).strip()


def _money(value: object) -> str:
    try:
        return f"PKR {float(value):,.2f}"
    except (TypeError, ValueError):
        return "unavailable"


def _number(value: object) -> str:
    try:
        return f"{float(value):,.0f}"
    except (TypeError, ValueError):
        return "unavailable"


def _percent(value: object, *, ratio: bool = True) -> str:
    try:
        number = float(value) * (100 if ratio else 1)
        return f"{number:,.2f}%"
    except (TypeError, ValueError):
        return "unavailable"


def _contains(query: str, *terms: str) -> bool:
    return any(term in query for term in terms)


@dataclass(frozen=True)
class AssistantReply:
    answer: str
    topic: str
    confidence: str
    sources: tuple[dict[str, str], ...]
    suggestions: tuple[str, ...]
    navigation: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "topic": self.topic,
            "confidence": self.confidence,
            "grounded": True,
            "sources": list(self.sources),
            "suggestions": list(self.suggestions),
            "navigation": self.navigation,
        }


FORMULAS: dict[str, dict[str, Any]] = {
    "profit": {
        "terms": ("profit formula", "profit calculate", "profit kya", "munafa", "contribution margin", "margin formula", "margin kya", "revenue formula", "cost formula"),
        "answer": (
            "DineIQ uses contribution margin as its menu-profit measure.\n\n"
            "Net item revenue = valid item line value − the item's proportional share of the order discount.\n"
            "Estimated item cost = quantity sold × menu cost price.\n"
            "Contribution margin = net item revenue − estimated item cost.\n"
            "Contribution margin % = contribution margin ÷ net item revenue × 100.\n\n"
            "Example: if net revenue is PKR 1,000 and estimated cost is PKR 600, contribution margin is PKR 400 and margin is 40%. Tax, rent, payroll and other overhead are not included, so this is not accounting net profit."
        ),
        "source": "scripts/spark/gap1_analytics.py",
        "nav": "/menu",
    },
    "wastage": {
        "terms": ("wastage formula", "waste formula", "wastage calculate", "waste calculate", "wastage risk", "waste risk", "zaya"),
        "answer": (
            "DineIQ reports two related wastage measures.\n\n"
            "Wastage quantity = sum of valid quantity_wasted records.\n"
            "Wastage cost = sum of recorded wastage_cost.\n"
            "Menu wastage cost ratio = wastage cost ÷ estimated item cost × 100.\n\n"
            "The risk screen is separate: it uses historical lagged waste and demand features to flag restaurant/category weeks. Its held-out precision is about 9.1%, so it is a review signal, not an automatic purchasing or preparation decision."
        ),
        "source": "scripts/spark/gap1_analytics.py",
        "nav": "/wastage",
    },
    "basket": {
        "terms": ("support formula", "confidence formula", "lift formula", "basket formula", "association rule"),
        "answer": (
            "Basket rules use distinct completed orders.\n\n"
            "Support(A,B) = orders containing both A and B ÷ all baskets.\n"
            "Confidence(A→B) = orders containing both ÷ orders containing A.\n"
            "Lift(A→B) = confidence(A→B) ÷ share of baskets containing B.\n\n"
            "Lift above 1 means the pair occurred together more often than independence would suggest. It is association evidence, not proof that one item causes purchase of the other."
        ),
        "source": "scripts/spark/gap1_analytics.py",
        "nav": "/basket",
    },
    "aov": {
        "terms": ("aov formula", "average order value", "order value formula"),
        "answer": "Average order value (AOV) = completed order revenue ÷ number of completed orders. DineIQ displays it in PKR. Always compare it with margin because a higher bill can still produce weaker contribution after discounts and item cost.",
        "source": "scripts/spark/analytics.py",
        "nav": "/dashboard",
    },
    "elasticity": {
        "terms": ("elasticity formula", "price sensitivity formula", "price sensitivity", "price sensitive"),
        "answer": (
            "Observed price sensitivity = percentage change in unit demand ÷ percentage change in price. DineIQ compares 30 days before and 30 days after a price event at item/location level.\n\n"
            "This is an uncontrolled historical association. Seasonality, stock, promotions and other changes can affect the result, so it must not be presented as causal price impact."
        ),
        "source": "scripts/spark/gap1_analytics.py",
        "nav": "/pricing",
    },
    "rfm": {
        "terms": ("rfm formula", "rfm meaning", "customer segment", "churn formula", "churn risk"),
        "answer": (
            "RFM means Recency, Frequency and Monetary value: days since the last completed order, number of distinct completed orders, and total completed-order value. DineIQ assigns 1–5 scores and deterministic behaviour segments.\n\n"
            "‘At risk’ means 90+ inactive days as of 31 August 2026 for a customer with at least two orders. This is descriptive inactivity screening, not a predictive churn probability."
        ),
        "source": "scripts/spark/gap1_analytics.py",
        "nav": "/customers",
    },
    "classification": {
        "terms": ("profit driver", "volume driver", "hidden opportunity", "low performer", "classification formula", "classify"),
        "answer": (
            "Menu classes compare each item with the catalog's 75th-percentile thresholds.\n\n"
            "Profit Driver: high units + high margin %, with wastage cost no more than 10% of estimated cost.\n"
            "Volume Driver: high units but not all Profit Driver conditions.\n"
            "Hidden Opportunity: high margin % but lower units.\n"
            "Low Performer: below both main thresholds.\n\n"
            "These are descriptive portfolio labels as of 31 August 2026, not automatic remove/keep decisions."
        ),
        "source": "scripts/spark/gap1_analytics.py",
        "nav": "/menu",
    },
    "forecast": {
        "terms": ("forecast formula", "forecast model", "demand forecast", "prediction model"),
        "answer": (
            "The verified restaurant-hour demand model uses restaurant, hour, weekday, month and order-arrival lags at 1, 24 and 168 hours. It is evaluated against a seasonal baseline on held-out history.\n\n"
            "DineIQ also contains frozen 7/14/28-day item, category and location outlooks. They have no prediction intervals or hierarchy reconciliation, and they are historical demonstration forecasts rather than a live feed."
        ),
        "source": "results/submission/aligned-comparison-v1/demand_model_comparison.json",
        "nav": "/forecast",
    },
}


class DineIQAssistant:
    """Answer common project and business questions from reviewed evidence."""

    MAX_MESSAGE = 800

    def __init__(self, service: Any):
        self.service = service

    def capabilities(self) -> dict[str, Any]:
        return {
            "name": "DineIQ Guide",
            "description": "A grounded guide to DineIQ formulas, analytics and loaded menu/location evidence.",
            "languages": ["English", "Roman Urdu"],
            "example_questions": [
                "How is profit calculated?",
                "Smoky Chinese 1 ki performance batao",
                "Which items have the highest margin?",
                "Wastage risk ka kya matlab hai?",
                "Forecast model kaise kaam karta hai?",
                "DineIQ kya karta hai?",
            ],
        }

    def answer(self, message: str) -> AssistantReply:
        if not isinstance(message, str) or not message.strip():
            raise ValueError("message must be a non-empty string.")
        if len(message) > self.MAX_MESSAGE:
            raise ValueError(f"message must be {self.MAX_MESSAGE} characters or fewer.")

        original = message.strip()
        query = _normalise(original)

        if _contains(query, "hello", "hi ", "hey", "salam", "assalam", "aoa") or query in {"hi", "hello", "help"}:
            return self._welcome()

        item_matches = self._entity_matches(query, self._gap_rows("menu_profitability"), "item_name", "menu_item_id")
        if item_matches and (self._explicit_entity_mention(query, item_matches[0], "item_name", "menu_item_id") or _contains(query, "item", "dish", "product", "menu", "performance", "margin", "profit", "waste", "recommend")):
            if _contains(query, "pair", "combo", "bundle", "bought together", "goes with", "with this", "sath", "saath"):
                return self._item_baskets(item_matches[0])
            if _contains(query, "which outlet", "which restaurant", "which location", "branch", "outlet performance", "location performance"):
                return self._item_locations(item_matches[0])
            if _contains(query, "waste", "wastage", "zaya"):
                return self._item_wastage(item_matches[0])
            return self._item_answer(item_matches, query)

        restaurant_matches = self._entity_matches(query, self._table_rows("restaurants"), "restaurant_name", "restaurant_id")
        if restaurant_matches and (self._explicit_entity_mention(query, restaurant_matches[0], "restaurant_name", "restaurant_id") or _contains(query, "restaurant", "outlet", "location", "branch")):
            return self._restaurant_answer(restaurant_matches)

        if _contains(query, "how many", "kitny", "kitne", "count", "total revenue", "overall summary", "project snapshot", "overall picture"):
            return self._snapshot()

        category_matches = self._entity_matches(query, self._table_rows("categories"), "category_name", "category_id")
        if category_matches and (_contains(query, "category", "categories", "category ka", "category ki") or self._explicit_entity_mention(query, category_matches[0], "category_name", "category_id")):
            return self._category_answer(category_matches[0])

        for name, formula in FORMULAS.items():
            if _contains(query, *formula["terms"]):
                return self._formula_reply(name, formula)

        if _contains(query, "top margin", "highest margin", "most profitable", "best profit", "top profit"):
            return self._ranked_menu("contribution_margin_pct", "highest contribution-margin percentage")
        if _contains(query, "top selling", "most sold", "popular item", "best seller", "highest sales"):
            return self._ranked_menu("units_sold", "highest unit sales")
        if _contains(query, "waste item", "most waste", "highest wastage", "wastage item"):
            return self._ranked_waste()
        if _contains(query, "recommendation", "recommend", "suggest", "kya karna", "action"):
            return self._recommendations()
        if _contains(query, "architecture", "technology", "tech stack", "spark", "hdfs", "backend", "frontend"):
            return self._architecture()
        if _contains(query, "data quality", "cleaning", "quarantine", "invalid data", "duplicate"):
            return self._quality()
        if _contains(query, "limitation", "accurate", "reliable", "production ready", "can i trust", "bharosa"):
            return self._limitations()
        if _contains(query, "what is dineiq", "what does dineiq", "project overview", "project kya", "dineq kya", "about project"):
            return self._overview()

        return AssistantReply(
            answer=(
                "I could not tie that question to a verified DineIQ metric or entity. Try including an exact dish/item name, restaurant ID, or one topic such as profit, wastage, forecast, pricing, customers, basket rules, data quality or architecture. I only answer from loaded project evidence, so I will not guess a business number."
            ),
            topic="clarification",
            confidence="low",
            sources=(),
            suggestions=("How is profit calculated?", "Show the top margin items", "DineIQ kya karta hai?"),
        )

    def _table_rows(self, name: str) -> list[dict[str, Any]]:
        return list(getattr(self.service, "tables", {}).get(name, []))

    def _gap_rows(self, name: str) -> list[dict[str, Any]]:
        return list(getattr(self.service, "gap1_tables", {}).get(name, []))

    @staticmethod
    def _entity_matches(query: str, rows: Iterable[dict[str, Any]], label_key: str, id_key: str) -> list[dict[str, Any]]:
        scored: list[tuple[float, dict[str, Any]]] = []
        query_tokens = set(query.split())
        for row in rows:
            label = _normalise(row.get(label_key, ""))
            entity_id = _normalise(row.get(id_key, ""))
            if not label:
                continue
            label_tokens = set(label.split())
            overlap = len(label_tokens & query_tokens) / max(1, len(label_tokens))
            exact = 1.0 if label in query or (entity_id and entity_id in query.split()) else 0.0
            similarity = SequenceMatcher(None, label, query).ratio()
            score = max(exact, overlap, similarity * 0.72)
            if score >= 0.66:
                scored.append((score, row))
        scored.sort(key=lambda pair: (pair[0], float(pair[1].get("revenue") or 0)), reverse=True)
        return [row for _, row in scored[:5]]

    @staticmethod
    def _explicit_entity_mention(query: str, row: dict[str, Any], label_key: str, id_key: str) -> bool:
        label, entity_id = _normalise(row.get(label_key, "")), _normalise(row.get(id_key, ""))
        return bool(label and label in query) or bool(entity_id and entity_id in query.split())

    def _welcome(self) -> AssistantReply:
        return AssistantReply(
            answer="Assalam-o-alaikum! I am the DineIQ Guide. Aap simple language mein kisi dish ki performance, profit ya wastage formula, customer segments, basket rules, demand forecast, pricing, data quality, architecture, ya project limitations pooch sakte hain. Exact product name dein to main loaded analytics se uski evidence-based summary dunga.",
            topic="welcome",
            confidence="high",
            sources=(),
            suggestions=("Profit formula kya hai?", "Top selling items dikhao", "Forecast model samjhao"),
        )

    def _formula_reply(self, name: str, formula: dict[str, Any]) -> AssistantReply:
        return AssistantReply(
            answer=formula["answer"], topic=f"formula:{name}", confidence="high",
            sources=({"label": "Verified project logic", "reference": formula["source"]},),
            suggestions=("Ek product ki performance batao", "Project limitations kya hain?"), navigation=formula["nav"],
        )

    def _item_answer(self, matches: list[dict[str, Any]], query: str) -> AssistantReply:
        if len(matches) > 1 and not self._explicit_entity_mention(query, matches[0], "item_name", "menu_item_id"):
            labels = ", ".join(f"{r.get('item_name')} ({r.get('menu_item_id')})" for r in matches)
            return AssistantReply(
                answer=f"I found several possible menu items: {labels}. Please send the exact item name or ID so I do not mix their numbers.",
                topic="menu:item-clarification", confidence="medium", sources=(),
                suggestions=tuple(str(r.get("item_name")) for r in matches[:3]), navigation="/menu",
            )
        row = matches[0]
        waste_ratio = row.get("wastage_cost_ratio")
        answer = (
            f"{row.get('item_name')} ({row.get('menu_item_id')}) is a {row.get('performance_class')} in {row.get('category_name')}.\n\n"
            f"Price: {_money(row.get('base_price'))}\n"
            f"Units sold: {_number(row.get('units_sold'))} across {_number(row.get('order_count'))} orders\n"
            f"Net item revenue: {_money(row.get('revenue'))}\n"
            f"Estimated item cost: {_money(row.get('estimated_cost'))}\n"
            f"Contribution margin: {_money(row.get('contribution_margin'))} ({_percent(row.get('contribution_margin_pct'))})\n"
            f"Recorded wastage cost: {_money(row.get('wastage_cost'))} ({_percent(waste_ratio)} of estimated cost)\n\n"
            f"Meaning: {self._class_explanation(str(row.get('performance_class')))} These figures cover stored historical evidence through 31 August 2026 and are not a live accounting statement."
        )
        return AssistantReply(
            answer=answer, topic="menu:item", confidence="high",
            sources=(
                {"label": "Menu profitability", "reference": "/api/intelligence/menu"},
                {"label": "Calculation method", "reference": "scripts/spark/gap1_analytics.py"},
            ),
            suggestions=(f"What pairs well with {row.get('item_name')}?", "How is contribution margin calculated?", "Show top margin items"),
            navigation="/menu",
        )

    def _item_baskets(self, item: dict[str, Any]) -> AssistantReply:
        item_id = str(item.get("menu_item_id"))
        rules = []
        for row in self._gap_rows("basket_rules"):
            if item_id not in {str(row.get("item_a")), str(row.get("item_b"))}:
                continue
            if str(row.get("item_a")) == item_id:
                other = row.get("item_b_name")
                confidence = row.get("confidence_a_to_b")
                lift = row.get("lift_a_to_b")
            else:
                other = row.get("item_a_name")
                confidence = row.get("confidence_b_to_a")
                lift = row.get("lift_b_to_a")
            rules.append((float(lift or 0), float(confidence or 0), row, other))
        rules.sort(key=lambda value: (value[0], value[1], int(value[2].get("pair_count") or 0)), reverse=True)
        supported = [rule for rule in rules if rule[0] > 1][:5]
        if not supported:
            return AssistantReply(
                answer=f"No stored basket pair for {item.get('item_name')} clears lift above 1. I cannot recommend a bundle without that association evidence.",
                topic="menu:item-baskets", confidence="high",
                sources=({"label": "Distinct completed-order baskets", "reference": "/api/intelligence/baskets"},),
                suggestions=(f"Tell me about {item.get('item_name')}", "Lift formula kya hai?"), navigation="/basket",
            )
        lines = []
        for index, (lift, confidence, row, other) in enumerate(supported, 1):
            lines.append(
                f"{index}. {other} — pair orders {_number(row.get('pair_count'))}, "
                f"confidence {_percent(confidence)}, lift {lift:.3f}"
            )
        return AssistantReply(
            answer=(
                f"Evidence-backed basket candidates for {item.get('item_name')}:\n\n" + "\n".join(lines) +
                "\n\nLift above 1 means co-purchase was stronger than independence would suggest. These are candidate cross-sells, not proven incremental-profit bundles."
            ),
            topic="menu:item-baskets", confidence="high",
            sources=({"label": "Distinct completed-order basket rules", "reference": "/api/intelligence/baskets"},),
            suggestions=("Lift formula kya hai?", f"Tell me about {item.get('item_name')}"), navigation="/basket",
        )

    def _item_locations(self, item: dict[str, Any]) -> AssistantReply:
        item_id = str(item.get("menu_item_id"))
        rows = [row for row in self._gap_rows("menu_by_location") if str(row.get("menu_item_id")) == item_id]
        if not rows:
            return self._data_unavailable(f"location breakdown for {item.get('item_name')}", "/locations")
        rows.sort(key=lambda row: float(row.get("contribution_margin") or 0), reverse=True)
        restaurant_names = {str(row.get("restaurant_id")): row.get("restaurant_name") for row in self._table_rows("restaurants")}
        lines = []
        for index, row in enumerate(rows[:5], 1):
            restaurant_id = str(row.get("restaurant_id"))
            location = restaurant_names.get(restaurant_id) or restaurant_id
            lines.append(
                f"{index}. {location} — margin {_money(row.get('contribution_margin'))} "
                f"({_percent(row.get('contribution_margin_pct'))}), units {_number(row.get('units_sold'))}"
            )
        return AssistantReply(
            answer=f"Top locations for {item.get('item_name')} by historical contribution margin:\n\n" + "\n".join(lines) + "\n\nThis compares stored history; location size and operating overhead are not controlled.",
            topic="menu:item-locations", confidence="high",
            sources=({"label": "Item by location profitability", "reference": "results/analytics/gap1/v6/menu_by_location"},),
            suggestions=(f"What pairs well with {item.get('item_name')}?", f"Tell me about {item.get('item_name')}"), navigation="/locations",
        )

    def _item_wastage(self, item: dict[str, Any]) -> AssistantReply:
        item_id = str(item.get("menu_item_id"))
        rows = [row for row in self._gap_rows("wastage_risk_ranking") if str(row.get("menu_item_id")) == item_id]
        rows.sort(key=lambda row: float(row.get("historical_wastage_cost") or 0), reverse=True)
        overall = (
            f"Overall recorded wastage cost is {_money(item.get('wastage_cost'))}, equal to "
            f"{_percent(item.get('wastage_cost_ratio'))} of estimated item cost."
        )
        if rows:
            locations = "\n".join(
                f"{index}. {row.get('restaurant_id')} — {_money(row.get('historical_wastage_cost'))}, "
                f"quantity {_number(row.get('historical_quantity_wasted'))}"
                for index, row in enumerate(rows[:5], 1)
            )
            detail = f"\n\nHighest historical outlet burdens:\n{locations}"
        else:
            detail = "\n\nNo item/outlet wastage ranking is loaded for this item."
        return AssistantReply(
            answer=f"{item.get('item_name')}: {overall}{detail}\n\nThis is historical burden, not a prediction of future waste.",
            topic="menu:item-wastage", confidence="high",
            sources=({"label": "Menu and outlet wastage evidence", "reference": "/api/intelligence/wastage"},),
            suggestions=("Wastage formula kya hai?", f"Which outlet performs best for {item.get('item_name')}?"), navigation="/wastage",
        )

    @staticmethod
    def _class_explanation(value: str) -> str:
        return {
            "Profit Driver": "It clears the high-volume and high-margin thresholds while staying within the wastage guardrail.",
            "Volume Driver": "Demand is high, but its margin or wastage condition does not clear every Profit Driver threshold.",
            "Hidden Opportunity": "Margin is strong while unit volume is below the high-popularity threshold, so measured visibility tests may be useful.",
            "Low Performer": "It is below the catalog's main volume and margin thresholds; review context before changing or removing it.",
        }.get(value, "Its label follows the stored descriptive classification rules.")

    def _restaurant_answer(self, matches: list[dict[str, Any]]) -> AssistantReply:
        row = matches[0]
        return AssistantReply(
            answer=(
                f"{row.get('restaurant_name')} ({row.get('restaurant_id')}) is in {row.get('city')}.\n\n"
                f"Completed-order revenue: {_money(row.get('revenue'))}\n"
                f"Orders: {_number(row.get('order_count'))}\n"
                f"Average order value: {_money(row.get('avg_order_value'))}\n\n"
                "These are historical stored aggregates. Open Locations for its relative performance and flags."
            ),
            topic="restaurant", confidence="high",
            sources=({"label": "Restaurant performance", "reference": "/api/restaurants"},),
            suggestions=("Which items have the highest margin?", "How is AOV calculated?"), navigation="/locations",
        )

    def _snapshot(self) -> AssistantReply:
        restaurants = self._table_rows("restaurants")
        menu = self._table_rows("menu")
        monthly = self._table_rows("monthly")
        completed_orders = sum(float(row.get("completed_orders") or 0) for row in monthly)
        revenue = sum(float(row.get("completed_revenue") or 0) for row in monthly)
        period = f"{monthly[0].get('order_month')} to {monthly[-1].get('order_month')}" if monthly else "stored period"
        return AssistantReply(
            answer=(
                f"Current loaded DineIQ snapshot ({period}):\n\n"
                f"Restaurants/outlets: {_number(len(restaurants))}\n"
                f"Menu items: {_number(len(menu))}\n"
                f"Completed orders: {_number(completed_orders)}\n"
                f"Completed revenue: {_money(revenue)}\n\n"
                "This is the stored historical evidence window, not a live point-of-sale feed. For a detailed view, use the dashboard filters."
            ),
            topic="project:snapshot", confidence="high",
            sources=({"label": "Overview aggregates", "reference": "/api/overview"},),
            suggestions=("Profit formula kya hai?", "Which items have the highest margin?", "Project limitations kya hain?"), navigation="/dashboard",
        )

    def _category_answer(self, row: dict[str, Any]) -> AssistantReply:
        category_name = str(row.get("category_name") or "")
        item_count = row.get("menu_items")
        if item_count is None:
            item_count = len([item for item in self._table_rows("menu") if str(item.get("category_name") or "") == category_name])
        average_value = row.get("avg_order_value")
        if average_value is None:
            average_value = row.get("avg_line_value")
        return AssistantReply(
            answer=(
                f"{category_name} category has {_number(item_count)} tracked menu items.\n\n"
                f"Units sold: {_number(row.get('units_sold'))}\n"
                f"Orders: {_number(row.get('order_count'))}\n"
                f"Gross sales: {_money(row.get('gross_sales'))}\n"
                f"Average line value: {_money(average_value)}\n\n"
                "These are historical category aggregates. Open Menu Intelligence for item-level margin and class detail."
            ),
            topic="category", confidence="high",
            sources=({"label": "Category performance", "reference": "/api/categories"},),
            suggestions=("Show top margin items", "How is profit calculated?"), navigation="/menu",
        )

    def _ranked_menu(self, field: str, label: str) -> AssistantReply:
        rows = [r for r in self._gap_rows("menu_profitability") if isinstance(r.get(field), (int, float))]
        if not rows:
            return self._data_unavailable("menu rankings", "/menu")
        top = sorted(rows, key=lambda r: float(r[field]), reverse=True)[:5]
        lines = []
        for index, row in enumerate(top, 1):
            value = _percent(row[field]) if field.endswith("pct") else _number(row[field])
            lines.append(f"{index}. {row.get('item_name')} — {value} ({row.get('performance_class')})")
        return AssistantReply(
            answer=f"Top 5 items by {label}:\n\n" + "\n".join(lines) + "\n\nThis is a historical ranking; it does not include overhead or prove future performance.",
            topic="menu:ranking", confidence="high",
            sources=({"label": "Menu profitability", "reference": "/api/intelligence/menu"},),
            suggestions=tuple(str(r.get("item_name")) for r in top[:3]), navigation="/menu",
        )

    def _ranked_waste(self) -> AssistantReply:
        rows = self._gap_rows("wastage_risk_ranking")
        if not rows:
            return self._data_unavailable("wastage ranking", "/wastage")
        top = sorted(rows, key=lambda r: float(r.get("historical_wastage_cost") or 0), reverse=True)[:5]
        lines = [f"{i}. {r.get('item_name')} at {r.get('restaurant_id')} — {_money(r.get('historical_wastage_cost'))}" for i, r in enumerate(top, 1)]
        return AssistantReply(
            answer="Highest historical wastage-cost burdens:\n\n" + "\n".join(lines) + "\n\nThis ranks historical burden; it is descriptive and not a future waste prediction.",
            topic="wastage:ranking", confidence="high",
            sources=({"label": "Historical wastage ranking", "reference": "/api/intelligence/wastage"},),
            suggestions=("Wastage formula kya hai?", "Wastage risk kitna reliable hai?"), navigation="/wastage",
        )

    def _recommendations(self) -> AssistantReply:
        rows = self._gap_rows("directional_basket_recommendations") or self._gap_rows("recommendations")
        if not rows:
            return self._data_unavailable("recommendations", "/recommendations")
        snippets = []
        for row in rows[:5]:
            subject = row.get("subject") or f"{row.get('antecedent_name', '')} → {row.get('consequent_name', '')}"
            action = row.get("action") or "review this candidate"
            snippets.append(f"• {subject}: {action}. Evidence: {row.get('evidence', 'stored association rule')}")
        return AssistantReply(
            answer="Current candidate actions from stored evidence:\n\n" + "\n".join(snippets) + "\n\nThese are review candidates. Business impact and causal uplift have not been validated.",
            topic="recommendations", confidence="medium",
            sources=({"label": "Candidate recommendation engine", "reference": "/api/intelligence/recommendations"},),
            suggestions=("Basket lift ka kya matlab hai?", "Show top margin items"), navigation="/recommendations",
        )

    def _overview(self) -> AssistantReply:
        return AssistantReply(
            answer=(
                "DineIQ is a restaurant intelligence platform built over synthetic, reproducible restaurant data. It turns orders, menu, customer, promotion, inventory, pricing, rating and wastage records into dashboards for menu profitability, customers, baskets, forecasts, waste, locations, channels, anomalies and candidate actions.\n\n"
                "Spark performs the canonical processing, Parquet/HDFS stores analytical outputs, Flask serves authenticated APIs, and React provides the dashboard. The evidence is historical through 31 August 2026; it is a decision-support demonstration rather than a live production restaurant feed."
            ),
            topic="project:overview", confidence="high",
            sources=({"label": "Architecture", "reference": "ARCHITECTURE.md"}, {"label": "Scope", "reference": "ASSUMPTIONS_LIMITATIONS.md"}),
            suggestions=("Architecture samjhao", "Data quality kaise hoti hai?", "Project limitations kya hain?"), navigation="/dashboard",
        )

    def _architecture(self) -> AssistantReply:
        return AssistantReply(
            answer="DineIQ flow is: generated CSV data → validation and quarantine → canonical Spark processing → Parquet/HDFS analytical tables and ML artifacts → Flask authenticated API → React dashboards. A checksum-verified local serving bundle lets evaluators run the app without a live HDFS connection. The operational SQLite store holds users, roles, audit state and recommendation status; analytical facts remain in the evidence layer.",
            topic="project:architecture", confidence="high",
            sources=({"label": "Architecture", "reference": "ARCHITECTURE.md"}, {"label": "Portable run guide", "reference": "INSTALLATION.md"}),
            suggestions=("Data quality kaise hoti hai?", "Forecast model samjhao"), navigation="/models",
        )

    def _quality(self) -> AssistantReply:
        return AssistantReply(
            answer="The strict validation catalog covers all 11 input tables. It checks required fields, types, ranges, dates, enums, IDs, duplicates and parent-child integrity. Bad records go to quarantine with rule IDs and reasons; accepted and rejected counts are preserved before and after cleaning. The strict v2 subset is separate from the older canonical v4 analytics, so downstream v4 dashboards must not be claimed as retrained on the strict subset.",
            topic="project:data-quality", confidence="high",
            sources=({"label": "Validation catalog", "reference": "DATA_QUALITY_VALIDATION.md"}, {"label": "Quality evidence", "reference": "results/submission/quality/v2/quality_cleaning.json"}),
            suggestions=("Duplicate records kaise handle hote hain?", "Project limitations kya hain?"), navigation="/admin",
        )

    def _limitations(self) -> AssistantReply:
        return AssistantReply(
            answer=(
                "Key limits: the dataset is synthetic and historical; public deployment, TLS/uptime and live feeds are not proven. Wastage prediction has low precision and is screening-only. Pricing and promotion results are observational, not causal. Recommendations are candidates without measured business uplift. Customer churn is descriptive inactivity. Forecasts lack prediction intervals, and item/category forecasts aggregate all restaurants. Contribution margin excludes business overhead."
            ),
            topic="project:limitations", confidence="high",
            sources=({"label": "Assumptions and limitations", "reference": "ASSUMPTIONS_LIMITATIONS.md"},),
            suggestions=("Wastage risk ka kya matlab hai?", "Forecast scope samjhao", "Profit formula kya hai?"), navigation="/reports",
        )

    @staticmethod
    def _data_unavailable(topic: str, navigation: str) -> AssistantReply:
        return AssistantReply(
            answer=f"The {topic} evidence is not loaded in this runtime. Check system health or use the checksum-verified serving bundle, then try again. I will not manufacture a ranking without the records.",
            topic="data-unavailable", confidence="high",
            sources=(), suggestions=("DineIQ kya karta hai?", "Profit formula kya hai?"), navigation=navigation,
        )
