"""Publish the validation catalog from saved, reconciled full-data evidence."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "results/submission/quality/v2/quality_cleaning.json"


def main():
    report = json.loads(SOURCE.read_text(encoding="utf-8"))
    assert report["all_passed"] and report["canonical_v4_changed"] is False
    totals = dict.fromkeys(("before_count", "accepted_count", "quarantine_count", "exact_duplicate_copies_removed"), 0)
    lines = [
        "# Data quality validation catalog", "",
        "Generated from [full-data v2 evidence](results/submission/quality/v2/quality_cleaning.json) by `python scripts/audit/submission_evidence.py`. This publishes saved execution evidence; it does not rerun Spark.", "",
        f"Evidence timestamp: `{report['timestamp_utc']}`. Contract: `{report['contract_version']}`.", "",
        "## Quarantine and repair policy", "",
        "`profile_clean.py` reads original CSV tokens, verifies headers and applies `quality_rules.validate_table` in parent-first order. Header/schema drift fails the run. Malformed records, invalid types, required-value failures, conflicting keys, invalid domains/bounds, inconsistent settlements/balances and missing accepted parents are quarantined. Rejected parents cascade to dependent records. Identical source copies are deduplicated separately; conflicting primary-key variants are all rejected.", "",
        "Quarantine preserves `_raw_record`, `_source_file`, `_corrupt_record` and every `_quality_reasons` value. Original CSV is unchanged. Only validated components may produce repaired line/waste totals; missing optional customer city/order channel becomes Unknown. No arbitrary numeric imputation is performed. Rule counts overlap and must not be summed as rejected-row counts.", "",
        "Review rejected source records, correct them in a new version of the dataset and revalidate. Do not move quarantine rows directly into accepted outputs. Fresh output versions are required; existing or partially written versions are never silently overwritten.", "",
        "## Before/after counts", "",
        "Raw = accepted + quarantined unique records + removed exact duplicate copies. Every table passed accounting and persisted Parquet read-back checks.", "",
        "| Table | Raw | Accepted | Quarantined | Duplicate copies removed |",
        "|---|---:|---:|---:|---:|",
    ]
    for table, item in report["tables"].items():
        assert item["accounting_passed"] and item["readback_passed"]
        assert item["before_count"] == sum(item[k] for k in list(totals)[1:])
        for key in totals:
            totals[key] += item[key]
        lines.append(f"| {table} | " + " | ".join(f"{item[k]:,}" for k in totals) + " |")
    lines += ["| **Total** | " + " | ".join(f"**{v:,}**" for v in totals.values()) + " |", "",
        f"Accepted root: `{report['processed_root']}`. Quarantine root: `{report['quality_root']}/quarantine`.", "",
        "These strict outputs are separate from canonical v4. Existing dashboards, forecasts and metrics still use historical v4; they have not been recomputed or retrained on this accepted subset. Cross-table business semantics beyond the listed rules are not claimed validated.", "",
        "## Malformed-record fixtures", "",
        "[test_quality_submission.py](tests/test_quality_submission.py) covers valid records across all 11 tables; exact duplicates and conflicting keys; zero/negative/fractional/missing quantities; NaN/infinity and derived overflow; missing keys and parent cascades; invalid dates/times/booleans/status; excessive discounts; incorrect totals; percentage/rating bounds; reversed dates; stock imbalance; cancelled settlement; extra/missing CSV fields; bad numeric tokens; quoted multiline fields; optional values; and empty input. Current test results are in [verification.json](results/submission/verification.json).", "",
        "## Complete executed rule list", "",
        "Each table below lists every rule in the executed catalog, its action and the saved affected count. Repair counts describe values actually changed. Deduplication counts removed copies, not rejected unique rows.", ""]
    for table, item in report["tables"].items():
        lines += [f"### {table}", "", "| Rule | Action | Affected | Contract |", "|---|---|---:|---|"]
        for rule in item["rules"]:
            key = rule["id"]
            count = item["exact_duplicate_copies_removed"] if key == "exact_duplicate" else item["repair_counts"].get(key, item["rule_counts"].get(key, 0))
            description = rule["description"].replace("|", "\\|")
            lines.append(f"| `{key}` | {rule['action']} | {count:,} | {description} |")
        lines += ["", f"Accepted: `{item['accepted_path']}`. Quarantine: `{item['quarantine_path']}`.", ""]
    (ROOT / "DATA_QUALITY_VALIDATION.md").write_text("\n".join(lines), encoding="utf-8")
    print(json.dumps({"source": str(SOURCE.relative_to(ROOT)), "tables": len(report["tables"]), "totals": totals}, indent=2))


if __name__ == "__main__":
    main()
