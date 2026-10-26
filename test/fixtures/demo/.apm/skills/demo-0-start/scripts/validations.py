#!/usr/bin/env python3
"""Record and read the approvals of POC deliverables, shared by the team in <root>/state/validations.md.

Run from the project root:
  python <skill>/scripts/validations.py record --project . --path <file> --step <phase> [--comment <text>] [--by <name>]
  python <skill>/scripts/validations.py status --project .
  python <skill>/scripts/validations.py reopen --project . --path <file> --step <phase>

Without --file and --language, the file is <paths.root of poc.yml>/state/validations.md and the language is
project.language of poc.yml. Other kits pass both options (the Vibe Studio reads them from the kit contract).

record appends one row and prints it as JSON. status prints, for each deliverable approved at least once,
its latest approval and whether the file still matches it ("current"). Exit code 1 with a JSON error on
stderr when the request is refused.

The fingerprint ignores a BOM and the line endings, so a checkout on another system keeps the approval.
Requires: Python >= 3.10 and pyyaml.
"""
from __future__ import annotations

import argparse
import getpass
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import yaml

FILE = "state/validations.md"
COMMENT_MAX = 300
NAME_MAX = 80
TEXT = {
    "fr": {"title": "Validations des livrables",
           "headers": ["Livrable", "Validé le", "Par", "Étape", "Empreinte", "Commentaire"],
           "date": "%d/%m/%Y %H:%M"},
    "en": {"title": "Deliverable approvals",
           "headers": ["Deliverable", "Approved on", "By", "Step", "Fingerprint", "Comment"],
           "date": "%Y-%m-%d %H:%M"},
}
NOTE = ("<!-- Written by the kit skills and Vibe Studio with the validations script of poc-0-start. "
        "Columns are fixed by position: deliverable, date, by, step, fingerprint, comment. "
        "The latest row of a deliverable wins. A file changed after its approval needs a new approval. -->")
ROW = re.compile(r"^\|\s*`(?P<path>[^`]+)`\s*\|")
CELL = re.compile(r"(?<!\\)\|")


class Refused(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def config(project: Path) -> tuple[str, str]:
    path = project / "poc.yml"
    data = yaml.safe_load(path.read_text(encoding="utf-8")) if path.is_file() else {}
    data = data if isinstance(data, dict) else {}
    root = str((data.get("paths") or {}).get("root") or "poc")
    language = str((data.get("project") or {}).get("language") or "en")
    return root, language if language in TEXT else "en"


def fingerprint(path: Path) -> str:
    data = path.read_bytes()
    if data.startswith(b"\xef\xbb\xbf"):
        data = data[3:]
    return hashlib.sha256(data.replace(b"\r\n", b"\n")).hexdigest()[:16]


def deliverable(project: Path, relative: str) -> tuple[str, Path]:
    """Normalised relative path of an existing file inside the project."""
    clean = relative.replace("\\", "/").strip()
    if not clean or clean.startswith("/") or re.match(r"^[A-Za-z]:", clean) or ".." in clean.split("/"):
        raise Refused("approve.path", "The deliverable must be a path relative to the project.")
    root = project.resolve()
    target = (root / clean).resolve()
    if not target.is_relative_to(root) or not target.is_file():
        raise Refused("approve.missing", "The deliverable does not exist in the project.")
    return target.relative_to(root).as_posix(), target


def author(project: Path) -> str:
    try:
        result = subprocess.run(["git", "config", "user.name"], cwd=project, capture_output=True, text=True,
                                encoding="utf-8", timeout=10)
        name = result.stdout.strip()
    except (OSError, subprocess.SubprocessError):
        name = ""
    return name or getpass.getuser()


def cell(value: str, limit: int) -> str:
    text = " ".join(str(value or "").split())[:limit]
    return text.replace("\\", "/").replace("|", "\\|").replace("`", "'")


def unescape(value: str) -> str:
    return value.strip().replace("\\|", "|")


def entries(file: Path) -> dict[str, dict]:
    """Latest approval of each deliverable."""
    found: dict[str, dict] = {}
    if not file.is_file():
        return found
    for line in file.read_text(encoding="utf-8-sig").splitlines():
        match = ROW.match(line.strip())
        if not match:
            continue
        cells = [unescape(part) for part in CELL.split(line.strip().strip("|"))]
        if len(cells) < 5:
            continue
        found[match.group("path")] = {"path": match.group("path"), "date": cells[1], "by": cells[2], "step": cells[3],
                                      "fingerprint": cells[4], "comment": cells[5] if len(cells) > 5 else ""}
    return found


def approval_file(project: Path, file: str | None, language: str | None) -> tuple[Path, str, str]:
    """Approval file (absolute and project-relative) and language."""
    root, configured = config(project)
    relative = (file or f"{root}/{FILE}").replace("\\", "/")
    _, absolute = deliverable(project, relative) if (project / relative).is_file() else (relative, (project / relative).resolve())
    if not absolute.is_relative_to(project.resolve()):
        raise Refused("approve.path", "The approval file must be inside the project.")
    return absolute, relative, language if language in TEXT else configured


def status(project: Path, file: str | None = None, language: str | None = None) -> dict[str, dict]:
    absolute, _, _ = approval_file(project, file, language)
    result = {}
    for path, entry in entries(absolute).items():
        current = project / path
        exists = current.is_file()
        result[path] = entry | {"exists": exists, "reopened": entry["fingerprint"] == "reopened",
                                "current": exists and fingerprint(current) == entry["fingerprint"]}
    return result


def record(project: Path, relative: str, step: str, comment: str = "", by: str | None = None,
           now: datetime | None = None, file: str | None = None, language: str | None = None, *, reopened: bool = False) -> dict:
    file, file_name, language = approval_file(project, file, language)
    path, deliverable_path = deliverable(project, relative)
    if deliverable_path == file:
        raise Refused("approve.path", "The approval file cannot approve itself.")
    if not re.fullmatch(r"[0-9]+-[a-z-]+|", step or ""):
        raise Refused("approve.step", "Unknown step.")
    labels = TEXT[language]
    entry = {"path": path, "date": (now or datetime.now()).strftime(labels["date"]), "by": cell(by or author(project), NAME_MAX),
             "step": step or "", "fingerprint": "reopened" if reopened else fingerprint(deliverable_path), "comment": cell(comment, COMMENT_MAX)}
    row = f"| `{path}` | {entry['date']} | {entry['by']} | {entry['step']} | {entry['fingerprint']} | {entry['comment']} |"
    if file.is_file():
        raw = file.read_bytes()
        bom = raw.startswith(b"\xef\xbb\xbf")
        text = raw.decode("utf-8-sig")
        newline = "\r\n" if "\r\n" in text else "\n"
        body = text if text.endswith(("\n", "\r")) else text + newline
        content = body + row + newline
    else:
        bom, newline = False, "\n"
        header = "| " + " | ".join(labels["headers"]) + " |"
        content = newline.join([f"# {labels['title']}", "", NOTE, "", header, "| --- | --- | --- | --- | --- | --- |", row, ""])
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_name(f".{file.name}.{os.getpid()}.tmp")
    temporary.write_bytes((b"\xef\xbb\xbf" if bom else b"") + content.encode("utf-8"))
    os.replace(temporary, file)
    return entry | {"file": file_name, "exists": True, "current": not reopened, "reopened": reopened}


def reopen(project: Path, relative: str, step: str, comment: str = "", by: str | None = None,
           file: str | None = None, language: str | None = None) -> dict:
    """Append a revocation without editing the deliverable or removing the approval history."""
    return record(project, relative, step, comment, by, file=file, language=language, reopened=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    add = commands.add_parser("record", help="record the approval of a deliverable given by the user")
    add.add_argument("--project", default=".")
    add.add_argument("--path", required=True)
    add.add_argument("--step", default="")
    add.add_argument("--comment", default="")
    add.add_argument("--by")
    add.add_argument("--file", help="approval file, project-relative (default: <paths.root>/state/validations.md)")
    add.add_argument("--language", help="language of a new approval file (default: project.language of poc.yml)")
    show = commands.add_parser("status", help="latest approval of each deliverable and whether it is still current")
    show.add_argument("--project", default=".")
    show.add_argument("--file")
    show.add_argument("--language")
    undo = commands.add_parser("reopen", help="reopen a deliverable after explicit user confirmation")
    undo.add_argument("--project", default=".")
    undo.add_argument("--path", required=True)
    undo.add_argument("--step", default="")
    undo.add_argument("--comment", default="")
    undo.add_argument("--by")
    undo.add_argument("--file")
    undo.add_argument("--language")
    args = parser.parse_args(argv)
    project = Path(args.project).resolve()
    try:
        if args.command == "status":
            result = status(project, args.file, args.language)
        else:
            action = reopen if args.command == "reopen" else record
            result = action(project, args.path, args.step, args.comment, args.by, file=args.file, language=args.language)
    except Refused as error:
        print(json.dumps({"code": error.code, "error": str(error)}), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
