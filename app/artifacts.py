"""Checksum-verified local copies of canonical serving artifacts."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path

EVIDENCE_FILES = (
    "results/spark/analytics.json", "results/spark/quality_cleaning.json", "results/spark/ingestion.json",
    "results/generation/generation_summary_full.json", "results/comparison/spark_vs_python.json",
    "results/ml/spark/pipeline.json", "results/ml/python/pipeline.json",
    "results/analytics/gap1/v6/spark_gap1.json", "results/analytics/gap1/wastage_risk_v3/pipeline.json",
    "results/ml/gap1/demand_baseline_comparison.json",
    "results/submission/aligned-comparison-v1/demand_model_comparison.json",
    "results/submission/forecast-v1/evaluation.json",
    "results/submission/forecast-v1/serving.json",
    "results/analytics/gap1/v11/directional_basket_recommendations.json",
)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def contained(root, relative):
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError("Artifact paths must be nonempty relative POSIX paths")
    path = (root / relative).resolve()
    if Path(relative).is_absolute() or not path.is_relative_to(root.resolve()) or path == root.resolve():
        raise ValueError(f"Artifact path escapes bundle: {relative}")
    return path


def serving_sources(evidence_root):
    def read(path):
        return json.loads((evidence_root / path).read_text(encoding="utf-8"))
    analytics = read(EVIDENCE_FILES[0])
    gap = read("results/analytics/gap1/v6/spark_gap1.json")
    risk = read("results/analytics/gap1/wastage_risk_v3/pipeline.json")
    basket = read("results/analytics/gap1/v11/directional_basket_recommendations.json")
    demand = read("results/ml/spark/pipeline.json")
    return sorted(set([meta["path"] for meta in analytics["outputs"].values()] +
                      [meta["path"] for meta in gap["outputs"].values()] +
                      [risk["model_path"], risk["test_prediction_path"], basket["output"], demand["model_path"]]))


class ArtifactBundle:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.manifest = json.loads((self.root / "manifest.json").read_text(encoding="utf-8"))
        if self.manifest.get("format_version") != 1:
            raise ValueError("Unsupported artifact manifest version")
        files = self.manifest["files"]
        for relative, expected in files.items():
            path = contained(self.root, relative)
            if not path.is_file() or path.stat().st_size != expected["bytes"] or sha256(path) != expected["sha256"]:
                raise ValueError(f"Artifact checksum/size mismatch: {relative}")
        # Reject injected model/Parquet files omitted from the checksum inventory.
        actual = {p.relative_to(self.root).as_posix() for p in self.root.rglob("*") if p.is_file() and p.name != "manifest.json"}
        if actual != set(files):
            raise ValueError("Artifact inventory differs from manifest")
        for relative in EVIDENCE_FILES:
            if f"evidence/{relative}" not in files:
                raise ValueError(f"Required evidence missing from manifest: {relative}")
        expected_sources = set(serving_sources(self.root / "evidence"))
        if set(self.manifest["artifacts"]) != expected_sources:
            raise ValueError("Artifact sources differ from bundled evidence")
        for source, relative in self.manifest["artifacts"].items():
            path = contained(self.root, relative)
            if not path.is_dir() or not any(name.startswith(relative + "/") for name in files):
                raise ValueError(f"Artifact has no verified files: {source}")

    def resolve(self, source):
        try:
            return contained(self.root, self.manifest["artifacts"][source]).as_uri()
        except KeyError as exc:
            raise ValueError(f"Source is not in verified artifact bundle: {source}") from exc
