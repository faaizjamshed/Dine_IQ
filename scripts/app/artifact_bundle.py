"""Export canonical serving files or verify a portable bundle, without retraining."""
import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from app.artifacts import ArtifactBundle, EVIDENCE_FILES, serving_sources, sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("export", "verify"))
    parser.add_argument("--bundle", required=True)
    args = parser.parse_args()
    target = Path(args.bundle).resolve()
    if args.command == "verify":
        bundle = ArtifactBundle(target)
        print(json.dumps({"verified": True, "files": len(bundle.manifest["files"]), "artifacts": len(bundle.manifest["artifacts"])}))
        return
    if target.exists():
        raise SystemExit("Export destination exists; choose a fresh directory")
    # Read all metadata before creating the destination.
    sources = serving_sources(ROOT)
    for path in EVIDENCE_FILES:
        if not (ROOT / path).is_file():
            raise FileNotFoundError(path)
    target.mkdir(parents=True)
    for path in EVIDENCE_FILES:
        output = target / "evidence" / path
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / path, output)
    sys.path.insert(0, str(ROOT / "scripts/spark"))
    from common import spark
    sp = spark("DineIQ-Portable-Export")
    artifacts = {}
    try:
        for source in sources:
            parsed = urlparse(source)
            if parsed.scheme != "hdfs" or parsed.netloc != "localhost:9000" or not parsed.path.startswith("/dineq/") or ".." in parsed.path.split("/"):
                raise ValueError(f"Unexpected canonical source: {source}")
            relative = "artifacts" + parsed.path
            output = target / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            src = sp._jvm.org.apache.hadoop.fs.Path(source)
            fs = src.getFileSystem(sp._jsc.hadoopConfiguration())
            # Use Python for local writes: Hadoop's local writer requires
            # winutils on Windows, even for a simple export of unchanged bytes.
            listing = fs.listFiles(src, True)
            while listing.hasNext():
                item = listing.next()
                suffix = str(item.getPath().toUri().getPath())[len(parsed.path):].lstrip("/")
                local = output / suffix
                local.parent.mkdir(parents=True, exist_ok=True)
                stream = fs.open(item.getPath())
                try:
                    local.write_bytes(bytes(stream.readAllBytes()))
                finally:
                    stream.close()
            artifacts[source] = relative
            print(f"Exported {parsed.path}", flush=True)
        files = {p.relative_to(target).as_posix(): {"bytes": p.stat().st_size, "sha256": sha256(p)} for p in sorted(target.rglob("*")) if p.is_file()}
        manifest = {"format_version": 1, "created_at": datetime.now(timezone.utc).isoformat(),
                    "canonical_versions": {"analytics": "v4", "demand": "v1", "gap1": "v6", "wastage_risk": "v3", "baskets": "v11"},
                    "spark_version": sp.version, "artifacts": artifacts, "files": files,
                    "trust": "Checksums detect corruption; obtain manifest and files together from a trusted source. Manifest is not a digital signature."}
        (target / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
        ArtifactBundle(target)
        print(f"Verified {len(artifacts)} artifacts, {len(files)} files, {sum(x['bytes'] for x in files.values())} bytes", flush=True)
    finally:
        sp.stop()


if __name__ == "__main__":
    main()
