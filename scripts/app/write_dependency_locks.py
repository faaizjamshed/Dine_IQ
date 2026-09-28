"""Write hash-checked pip lock files from downloaded dependency artifacts."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

from packaging.utils import canonicalize_name, parse_sdist_filename, parse_wheel_filename


def artifact_identity(path: Path) -> tuple[str, str]:
    if path.suffix == ".whl":
        name, version, _build, _tags = parse_wheel_filename(path.name)
        return canonicalize_name(str(name)), str(version)
    name, version = parse_sdist_filename(path.name)
    return canonicalize_name(str(name)), str(version)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wheelhouse", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--binary-only", action="store_true")
    args = parser.parse_args()

    if not args.wheelhouse.is_dir():
        raise SystemExit(f"wheelhouse does not exist: {args.wheelhouse}")
    artifacts = [path for path in args.wheelhouse.iterdir() if path.is_file()]
    if not artifacts:
        raise SystemExit(f"wheelhouse is empty: {args.wheelhouse}")

    rows = []
    for path in sorted(artifacts, key=lambda item: item.name.lower()):
        name, version = artifact_identity(path)
        rows.append((name, version, sha256(path), path.name))

    lines = [
        f"# {args.title}",
        "# Generated from downloaded artifacts on 2026-09-28.",
        "# Install with pip using --require-hashes and the matching --find-links directory.",
        "--no-index",
        f"--find-links {args.wheelhouse.as_posix()}",
    ]
    if args.binary_only:
        lines.insert(3, "--only-binary=:all:")
    for name, version, digest, filename in rows:
        lines.append(f"{name}=={version} \\")
        lines.append(f"    --hash=sha256:{digest}  # {filename}")

    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"wrote {args.output} with {len(rows)} artifacts")


if __name__ == "__main__":
    main()
