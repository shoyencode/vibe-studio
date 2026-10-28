"""Run only after human review, on the protected default branch."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from validate import validate

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(".")
index_path = Path(sys.argv[2]) if len(sys.argv) > 2 else root / "index.json"
repository = os.environ["GITHUB_REPOSITORY"]
index = json.loads(index_path.read_text())
output = root / "release-assets"
output.mkdir(exist_ok=True)
for kit, metadata, catalog in validate(root, published_index=index_path):
    identity, version = kit.name, metadata["version"]
    if any(entry["id"] == identity and entry["version"] == version for entry in index["entries"]):
        continue
    tag = f"kit-{identity}-v{version}"
    archive = output / f"{tag}.zip"
    with ZipFile(archive, "w", ZIP_DEFLATED) as zipped:
        for file in sorted(kit.rglob("*")):
            if file.is_file():
                zipped.write(file, file.relative_to(kit).as_posix())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    checksum = output / f"{tag}.sha256"
    checksum.write_text(f"{digest}  {archive.name}\n")
    subprocess.run(["gh", "release", "create", tag, str(archive), str(checksum),
                    "--repo", repository, "--title", f"{identity} {version}",
                    "--notes", "Manually reviewed kit release."], check=True)
    index["entries"].append({
        "id": identity, "name": metadata["name"], "description": metadata["description"],
        "version": version, "protocolVersion": 2, **catalog, "license": metadata["license"],
        "url": f"https://github.com/{repository}/releases/download/{tag}/{archive.name}",
        "sha256": f"sha256:{digest}", "size": archive.stat().st_size
    })
index_path.write_text(json.dumps(index, indent=2) + "\n")
