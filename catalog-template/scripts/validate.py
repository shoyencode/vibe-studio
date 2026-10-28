"""Trusted validation: parse data only; never import or execute package code."""
import json
import re
import subprocess
import sys
from pathlib import Path

import jsonschema
import yaml

VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def version(value):
    if not isinstance(value, str) or not VERSION.fullmatch(value):
        raise ValueError("Stable semantic version required")
    return tuple(map(int, value.split(".")))


def validate(root, baseline=None, published_index=None):
    root = Path(root)
    trusted = Path(__file__).resolve().parents[1]
    schema = json.loads((trusted / "schema/vibe-studio.schema.json").read_text())
    index = json.loads((root / "index.json").read_text())
    if baseline and Path(baseline).resolve() != root.resolve():
        if index != json.loads((Path(baseline) / "index.json").read_text()):
            raise ValueError("Only the trusted publisher may change the catalog index")
    if published_index:
        index = json.loads(Path(published_index).read_text())
    jsonschema.validate(index, json.loads((trusted / "index.schema.json").read_text()))
    previous = {}
    for entry in index["entries"]:
        previous.setdefault(entry["id"], []).append(entry)
    packages = []
    for kit in sorted((root / "kits").iterdir()):
        if kit.name == ".gitkeep" and kit.is_file() and not kit.is_symlink():
            continue
        if kit.is_symlink() or not kit.is_dir() or not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", kit.name):
            raise ValueError("Unexpected kit path")
        files = list(kit.rglob("*"))
        total = 0
        for file in files:
            relative = file.relative_to(kit)
            if file.is_symlink():
                raise ValueError(f"Links forbidden: {file}")
            if not file.is_file():
                continue
            if relative.parts[0] not in {".apm", "apm.yml", "README.md", "LICENSE", "LICENSE.md", "catalog.json"}:
                raise ValueError(f"Unexpected package file: {file}")
            data = file.read_bytes()
            total += len(data)
            if len(data) > 2_000_000 or total > 100_000_000 or len(files) > 5000:
                raise ValueError("Package limits exceeded")
            text = data.decode("utf-8")
            if "\0" in text or re.search(r"-----BEGIN .*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16}", text):
                raise ValueError(f"Binary or potential secret: {file}")
        metadata = yaml.safe_load((kit / "apm.yml").read_text())
        if metadata["name"] != kit.name:
            raise ValueError("APM name must match kit directory")
        current = version(metadata["version"])
        contracts = list((kit / ".apm/skills").glob("*/assets/vibe-studio.json"))
        if len(contracts) != 1:
            raise ValueError("Exactly one entry contract required")
        jsonschema.validate(json.loads(contracts[0].read_text()), schema)
        catalog = json.loads((kit / "catalog.json").read_text())
        if set(catalog) != {"minVibeStudio", "maintainer"} or not isinstance(catalog["maintainer"], str) or not catalog["maintainer"].strip():
            raise ValueError("Catalog metadata requires minVibeStudio and maintainer")
        version(catalog["minVibeStudio"])
        for field in ("description", "license"):
            if not isinstance(metadata.get(field), str) or not metadata[field].strip():
                raise ValueError(f"APM {field} required")
        published = previous.get(kit.name, [])
        if published and current < max(version(entry["version"]) for entry in published):
            raise ValueError("Kit version must not decrease")
        if any(current == version(entry["version"]) for entry in published):
            # A published version may remain unchanged, never be silently rebuilt.
            if baseline and Path(baseline).resolve() != root.resolve():
                old = Path(baseline) / "kits" / kit.name
                snapshot = lambda folder: {str(file.relative_to(folder)): file.read_bytes()
                                           for file in folder.rglob("*") if file.is_file()}
                changed = snapshot(kit) != snapshot(old)
            else:
                changed = subprocess.run(["git", "-C", str(root), "diff", "--name-only", "HEAD^", "HEAD", "--", f"kits/{kit.name}"],
                                         check=True, capture_output=True, text=True).stdout.strip()
            if changed:
                raise ValueError("Changed kits must increment their published version")
        packages.append((kit, metadata, catalog))
    return packages


if __name__ == "__main__":
    validate(sys.argv[1] if len(sys.argv) > 1 else ".", sys.argv[2] if len(sys.argv) > 2 else None,
             sys.argv[3] if len(sys.argv) > 3 else None)
