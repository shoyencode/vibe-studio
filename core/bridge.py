"""Vibe Studio kit bridge: reads a project and the kit contract (vibe-studio.json). Generic: nothing here is specific to one kit.

Commands (JSON on stdin, JSON on stdout; on error a JSON object with code and error on stderr, exit code 1):
  snapshot, validate, preview, task, feedback, correction, approve, reopen, costs, mark
Only task, feedback, correction, approve, reopen and mark write project data.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
from pathlib import Path, PureWindowsPath

import jsonschema
import yaml

sys.dont_write_bytecode = True
MAX_FILE = 2_000_000
CONTRACT_SCHEMA = Path(__file__).resolve().parent / "schema" / "vibe-studio.schema.json"
# APM deploys the skills of a kit for each harness: .agents (Copilot, Codex), .claude (Claude Code), .gemini (Gemini CLI).
SKILL_ROOTS = (".apm/skills", ".agents/skills", ".claude/skills", ".gemini/skills")


class KitError(ValueError):
    """User-facing error: an English message, plus a code and values Vibe Studio translates."""

    def __init__(self, code: str, message: str, **values: str):
        super().__init__(message)
        self.code = code
        self.values = values


def within(project: Path, value: str) -> Path:
    if not isinstance(value, str) or Path(value).is_absolute() or PureWindowsPath(value).is_absolute():
        raise KitError("path.relative", "The path must be relative to the project.")
    target = (project / value).resolve()
    if not target.is_relative_to(project):
        raise KitError("path.outside", "A path leaves the allowed folder.")
    if any(part.lower() == ".git" or part.lower().startswith(".env") for part in target.relative_to(project).parts):
        raise KitError("path.forbidden", "This file cannot be read by Vibe Studio.")
    return target


def text(path: Path) -> str:
    if path.stat().st_size > MAX_FILE:
        raise KitError("file.tooLarge", f"File too large: {path.name}.", name=path.name)
    return path.read_text(encoding="utf-8-sig")


def mapping(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = yaml.safe_load(text(path))
    except yaml.YAMLError as exc:
        raise KitError("yaml.invalid", f"Invalid YAML: {path.name}.", name=path.name) from exc
    if data is None:
        return {}
    if not isinstance(data, dict):
        raise KitError("yaml.object", f"An object is expected: {path.name}.", name=path.name)
    return data


def pointer(data: object, value: str | None, default: object = None) -> object:
    """Value of a JSON pointer, or the default when a part is missing."""
    if not value:
        return default
    current = data
    for part in value.strip("/").split("/"):
        part = part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return default
    return current


# ---------------------------------------------------------------- discovery

def discover(project: Path) -> tuple[Path, dict, Path]:
    """Skills folder, contract and contract path of the single kit installed in the project."""
    found: dict[str, tuple[Path, dict, Path]] = {}
    for root in SKILL_ROOTS:
        folder = project / root
        if not folder.is_dir():
            continue
        for candidate in sorted(folder.glob("*/assets/vibe-studio.json")):
            path = within(project, candidate.relative_to(project).as_posix())
            contract = json.loads(text(path))
            kit_id = (contract.get("kit") or {}).get("id") if isinstance(contract, dict) else None
            if not isinstance(kit_id, str) or not kit_id:
                raise KitError("contract.invalid", "The kit contract must declare a kit id.")
            if kit_id not in found:
                found[kit_id] = (within(project, root), contract, path)
    if len(found) > 1:
        raise KitError("kit.several", "Several kits are installed in this project; Vibe Studio drives one kit at a time.",
                       kits=", ".join(sorted(found)))
    if found:
        return next(iter(found.values()))
    raise KitError("kit.none", "No kit with a Vibe Studio contract is installed in this project. Install a kit with APM.")


def kit_version(project: Path, kit_id: str, skills: Path) -> dict:
    manifest = mapping(within(project, "apm.yml"))
    if skills.name == "skills" and skills.parent.name == ".apm" and manifest.get("name") == kit_id:
        return {"version": manifest.get("version"), "source": "kit"}
    lock = mapping(within(project, "apm.lock.yaml"))
    entries = [dep for dep in lock.get("dependencies", []) if isinstance(dep, dict) and dep.get("name") == kit_id]
    if len(entries) != 1:
        return {"version": None, "source": "apm"}
    return {"version": entries[0].get("version"), "commit": entries[0].get("resolved_commit"), "source": "apm"}


def load(project: Path) -> dict:
    skills, contract, contract_path = discover(project)
    try:
        jsonschema.Draft202012Validator(json.loads(CONTRACT_SCHEMA.read_text(encoding="utf-8"))).validate(contract)
    except jsonschema.ValidationError as exc:
        raise KitError("contract.invalid", f"Invalid kit contract: {exc.message}") from exc
    ids = [step["id"] for step in contract["steps"]]
    if len(set(ids)) != len(ids):
        raise KitError("contract.duplicate", "Duplicate step ids in the kit contract.")
    policies = contract.get("modelPolicies") or {}
    if set(policies.get("steps", {})) - set(ids):
        raise KitError("contract.invalid", "A model policy references an unknown step.")
    for policy in [*(policies.get("agents") or {}).values(), *(policies.get("steps") or {}).values(),
                   *([policies["default"]] if "default" in policies else [])]:
        for choice in [policy, *(policy.get("byProducerFamily") or {}).values()]:
            if choice["default"] not in choice["models"]:
                raise KitError("contract.invalid", "A default model is absent from its policy candidates.")
    if any(step["scope"] == "unit" for step in contract["steps"]) and "units" not in contract:
        raise KitError("contract.units", "A step works on units but the contract declares no units.")
    for step in contract["steps"]:
        skill_file = within(project, (skills / step["skill"] / "SKILL.md").relative_to(project).as_posix())
        if not skill_file.is_file():
            raise KitError("kit.skillMissing", f"Installed skill missing: {step['skill']}. Run APM again.", skill=step["skill"])
    entry = skills / contract["kit"]["entrySkill"]
    config_spec = contract["config"]
    schema = json.loads(text(within(project, (entry / config_spec["schema"]).relative_to(project).as_posix())))
    template_file = config_spec.get("template")
    template = mapping(within(project, (entry / template_file).relative_to(project).as_posix())) if template_file else {}
    config = mapping(within(project, config_spec["file"]))
    kit = {"id": contract["kit"]["id"], "name": contract["kit"]["name"], "i18n": contract["kit"].get("i18n", {})} | kit_version(project, contract["kit"]["id"], skills)
    return {"skills": skills, "contract": contract, "contractPath": contract_path, "kit": kit,
            "schema": schema, "config": config, "template": template}


# ---------------------------------------------------------------- configuration and paths

def config_issues(project: Path, contract: dict, config: dict, schema: dict) -> list[dict]:
    issues = [
        {"code": "config.invalidValue", "field": ".".join(str(p) for p in error.absolute_path) or "configuration",
         "validator": error.validator}
        for error in jsonschema.Draft202012Validator(schema).iter_errors(config)
    ]
    paths = pointer(config, contract["config"].get("paths"), {})
    prefix = (contract["config"].get("paths") or "").strip("/").replace("/", ".")
    for key, value in paths.items() if isinstance(paths, dict) else []:
        try:
            within(project, value)
        except ValueError:
            issues.append({"code": "config.badPath", "field": f"{prefix}.{key}" if prefix else key})
    return issues


def issue_text(issue: dict) -> str:
    if issue["code"] == "config.badPath":
        return f"{issue['field']}: path outside the project or invalid."
    return f"{issue['field']}: invalid value ({issue['validator']})."


def placeholders(contract: dict, config: dict) -> dict[str, str]:
    values = {}
    for name, spec in (contract["config"].get("placeholders") or {}).items():
        value = pointer(config, spec["pointer"], spec["default"])
        values[name] = value if isinstance(value, str) and value else spec["default"]
    return values


def expand(pattern: str, contract: dict, values: dict[str, str], unit: int | None = None) -> str:
    result = pattern
    if "{unit}" in result:
        result = result.replace("{unit}", contract["units"]["folder"])
    if unit is not None:
        result = result.replace("{n}", str(unit))
    for name, value in values.items():
        result = result.replace("{" + name + "}", value)
    return result


def unit_numbers(project: Path, contract: dict, values: dict[str, str]) -> list[int]:
    """Numbers of the units present on disk, from the unit folder pattern ({n} in the last segment)."""
    if "units" not in contract:
        return []
    folder = expand(contract["units"]["folder"], contract, values)
    parent, _, last = folder.rpartition("/")
    if "{n}" not in last:
        return []
    matcher = re.compile("^" + re.escape(last).replace(re.escape("{n}"), "([1-9][0-9]*)") + "$")
    base = within(project, parent) if parent else project
    found = []
    if base.is_dir():
        for child in base.iterdir():
            if (match := matcher.match(child.name)) and child.is_dir():
                found.append(int(match.group(1)))
    return sorted(found)


def file_info(project: Path, value: str) -> dict:
    path = within(project, value)
    if not path.is_file():
        return {"path": value, "exists": False}
    stat = path.stat()
    return {"path": value, "exists": True, "size": stat.st_size, "modified": stat.st_mtime,
            "hash": hashlib.sha256(path.read_bytes()).hexdigest() if stat.st_size <= MAX_FILE else None}


# ---------------------------------------------------------------- tasks module (Markdown checklist)

TASK_LINE = re.compile(r"^\s*[-*]\s+\[([ xX~!])\]\s+\**([TR][0-9]+[a-z]?)\**\.?\s*:?\s*(.*)$")
PLAN_STATUS = re.compile(r"^(?:Plan status|Statut du plan)\s*:\s*(.*)$", re.IGNORECASE)
TASK_STATUS = {" ": "todo", "x": "done", "X": "done", "~": "in_progress", "!": "blocked"}
MARKERS = {"todo": " ", "in_progress": "~", "done": "x", "blocked": "!"}


def parse_tasks(path: Path) -> dict:
    """Read the task list of a unit. The file is the source of truth for task status."""
    result = {"approval": None, "approved": False, "sections": [], "convergence": {"rows": 0, "filled": 0}, "warnings": [], "removedCorrections": []}
    raw = b""
    if path.is_file():
        with path.open("rb") as source:
            raw = source.read(MAX_FILE + 1)
        if len(raw) > MAX_FILE:
            raise KitError("file.tooLarge", f"File too large: {path.name}.", name=path.name)
    revision = hashlib.sha256(raw).hexdigest()
    section, in_convergence, header_seen = None, False, False
    for raw_line in raw.decode("utf-8-sig").splitlines():
        line = raw_line.rstrip()
        unsupported = re.match(r"^\s*[-*]\s+\[[ xX~!]\]\s+\**(U[0-9]+[a-z]?)\b", line)
        if unsupported:
            raise KitError("tasks.unsupportedId", "Update the kit: task identifiers must start with T or R.",
                           id=unsupported.group(1))
        if removed := re.fullmatch(r"<!-- Vibe Studio removed correction (R[0-9]+[a-z]?) -->", line):
            result["removedCorrections"].append(removed.group(1))
        elif status := PLAN_STATUS.match(line):
            result["approval"] = status.group(1).strip()
            result["approved"] = bool(re.match(r"(approved|approuv)", result["approval"], re.IGNORECASE))
        elif line.startswith("## "):
            title = line[3:].strip()
            in_convergence, header_seen = title.lower().startswith("convergence"), False
            section = {"title": title, "tasks": []}
            if not in_convergence:
                result["sections"].append(section)
        elif in_convergence and line.startswith("|"):
            cells = [cell.strip() for cell in line.strip("|").split("|")]
            if all(set(cell) <= set("-: ") for cell in cells):
                continue
            if not header_seen:
                header_seen = True
                continue
            result["convergence"]["rows"] += 1
            if len(cells) > 2 and cells[2]:
                result["convergence"]["filled"] += 1
        elif (match := TASK_LINE.match(line)) and section is not None:
            body = match.group(3)
            goal = re.split(r"\.\s+(?:Files|Fichiers|Done when|Terminé quand|Serves|Sert)\s*:|\s+—\s+", body, maxsplit=1)[0].strip().rstrip(".")
            serves = re.search(r"(?:Serves|Sert)\s*:\s*([^.—]+)", body)
            note = re.search(r"(?:—|Note\s*:)\s*(?:Note\s*:\s*)?(.+)$", body)
            section["tasks"].append({
                "id": match.group(2), "status": TASK_STATUS[match.group(1)], "goal": goal[:240],
                "body": body, "revision": revision,
                "feedback": feedback_fields(body),
                "serves": serves.group(1).strip() if serves else None,
                "note": note.group(1).strip()[:240] if note else None,
            })
    result["sections"] = [s for s in result["sections"] if s["tasks"]]
    if not result["sections"]:
        result["warnings"].append("tasks.unrecognised")
    return result


def write_atomic(path: Path, data: bytes) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def tasks_file(project: Path, loaded: dict, unit: object) -> Path:
    module = (loaded["contract"].get("modules") or {}).get("tasks")
    if not module:
        raise KitError("module.tasks", "The kit has no task tracking.")
    if type(unit) is not int or unit < 1:
        raise KitError("unit.invalid", "Invalid unit number.")
    values = placeholders(loaded["contract"], loaded["config"])
    path = within(project, expand(module["file"], loaded["contract"], values, unit))
    if not path.is_file():
        raise KitError("task.noFile", f"No task list for unit {unit}.", unit=str(unit))
    if path.stat().st_size > MAX_FILE:
        raise KitError("file.tooLarge", f"File too large: {path.name}.", name=path.name)
    return path


def set_task(project: Path, loaded: dict, request: dict) -> dict:
    """Write the status marker of one task. Nothing else in the file changes."""
    task_id, status = request.get("id"), request.get("status")
    if not isinstance(task_id, str) or not re.fullmatch(r"[TR][0-9]+[a-z]?", task_id) or status not in MARKERS:
        raise KitError("report.task", "Invalid task: id expected like T01 or R01, status todo, in_progress, done or blocked.")
    path = tasks_file(project, loaded, request.get("unit"))
    raw = path.read_bytes()
    bom = raw.startswith(b"\xef\xbb\xbf")
    lines = raw.decode("utf-8-sig").splitlines(keepends=True)
    for index, line in enumerate(lines):
        match = TASK_LINE.match(line.rstrip("\r\n"))
        if match and match.group(2) == task_id:
            previous = TASK_STATUS[match.group(1)]
            if previous != status:
                lines[index] = line[:match.start(1)] + MARKERS[status] + line[match.end(1):]
                write_atomic(path, (b"\xef\xbb\xbf" if bom else b"") + "".join(lines).encode("utf-8"))
            return {"written": previous != status, "previous": previous, "path": path.relative_to(project).as_posix()}
    raise KitError("task.unknown", f"Task {task_id} not found in the task list of unit {request.get('unit')}.",
                   id=task_id, unit=str(request.get("unit")))


def manual_correction(project: Path, loaded: dict, request: dict) -> dict:
    """Only manually selected R corrections may be changed; reject stale file snapshots."""
    task_id, action = request.get("id"), request.get("action")
    if not isinstance(task_id, str) or not re.fullmatch(r"R[0-9]+[a-z]?", task_id) or action not in ("edit", "delete", "validate"):
        raise KitError("feedback.invalidAction", "Select an R correction and a valid action.")
    path = tasks_file(project, loaded, request.get("unit"))
    raw = path.read_bytes()
    if request.get("revision") != hashlib.sha256(raw).hexdigest():
        raise KitError("feedback.changed", "The task list changed. Refresh it before editing.")
    bom = raw.startswith(b"\xef\xbb\xbf")
    lines = raw.decode("utf-8-sig").splitlines(keepends=True)
    matches = [(i, TASK_LINE.match(line.rstrip("\r\n"))) for i, line in enumerate(lines)]
    matches = [(i, match) for i, match in matches if match and match.group(2) == task_id]
    if len(matches) != 1:
        raise KitError("feedback.invalidAction", "The correction is missing or has a duplicate identifier.")
    index, match = matches[0]
    if action == "delete":
        ending = "\r\n" if lines[index].endswith("\r\n") else "\n" if lines[index].endswith("\n") else ""
        lines[index] = f"<!-- Vibe Studio removed correction {task_id} -->{ending}"
    elif action == "validate":
        lines[index] = lines[index][:match.start(1)] + "x" + lines[index][match.end(1):]
    else:
        body = request.get("text")
        if not isinstance(body, str) or not body.strip() or len(body) > 6000 or "\n" in body or "\r" in body:
            raise KitError("feedback.invalid", "A single-line correction of at most 6000 characters is required.")
        original = feedback_fields(match.group(3))
        if original:
            priority, screen = request.get("priority"), request.get("screen")
            if priority not in ("high", "medium", "low") or not isinstance(screen, str) or len(screen) > 120 or len(body) > 600:
                raise KitError("feedback.invalid", "Feedback text, screen and priority are invalid.")
            labels = FEEDBACK_LABELS[original["language"]]
            body = f"({labels['origin']}, {labels['priority'][priority]}){labels['sep']} {one_line(body, 600)}."
            if screen.strip():
                body += f" {labels['screen']}{labels['sep']} {one_line(screen, 120)}."
            body += original["attachments"]
        lines[index] = lines[index][:match.start(3)] + body.strip() + lines[index][match.end(3):]
    write_atomic(path, (b"\xef\xbb\xbf" if bom else b"") + "".join(lines).encode("utf-8"))
    return {"written": True, "path": path.relative_to(project).as_posix()}


# ---------------------------------------------------------------- review module

FINDING_ROW = re.compile(r"^\|\s*\**(R[0-9]+)\**\s*\|")
REVIEW_ROUND = re.compile(r"^Review round:\s*([0-9]+)", re.IGNORECASE)
REVIEWED_LINE = re.compile(r"^Corrections reviewed:\s*(.*)$", re.IGNORECASE)
REVIEW_SECTION = re.compile(r"^##\s+(Review corrections|Corrections issues de la revue)\b", re.IGNORECASE)
R_NUMBER = re.compile(r"^R([0-9]+)")


def read_review(path: Path) -> dict:
    """Round, corrections checked and ids raised (Findings table) of one review file."""
    review = {"round": None, "reviewed": None, "raised": []}
    section = ""
    for line in text(path).splitlines():
        line = line.strip()
        if line.startswith("## "):
            section = line[3:].strip().lower()
        elif (value := REVIEW_ROUND.match(line)) and review["round"] is None:
            review["round"] = int(value.group(1))
        elif (value := REVIEWED_LINE.match(line)) and review["reviewed"] is None:
            review["reviewed"] = re.findall(r"\bR[0-9]+\b", value.group(1))
        elif section.startswith(("findings", "constats")) and (row := FINDING_ROW.match(line)):
            review["raised"].append(row.group(1))
    return review


def review_loop(review_file: Path, tasks: dict) -> dict:
    """Where the unit stands in the loop review, corrections, new review."""
    folder, stem = review_file.parent, review_file.stem
    archived = sorted((f for f in folder.glob(f"{stem}-*.md") if re.fullmatch(rf"{re.escape(stem)}-[0-9]+\.md", f.name)),
                      key=lambda f: int(f.stem.rsplit("-", 1)[1]))
    files = archived + ([review_file] if review_file.is_file() else [])
    reviews = [read_review(f) for f in files]
    reviewed = set()
    for index, review in enumerate(reviews):
        if review["reviewed"] is not None:
            reviewed.update(review["reviewed"])
        elif index:
            # Files written before review rounds existed: a review checks the findings raised by the previous one.
            reviewed.update(reviews[index - 1]["raised"])
    corrections = [t for s in tasks.get("sections", []) for t in s["tasks"] if t["id"].startswith("R")]
    numbers = [int(R_NUMBER.match(i).group(1)) for i in [t["id"] for t in corrections if t["id"][0] == "R"] + [i for r in reviews for i in r["raised"]] + tasks.get("removedCorrections", [])]
    current = reviews[-1]["round"] if reviews and reviews[-1]["round"] else len(reviews)
    built = all(t["status"] == "done" for s in tasks.get("sections", []) for t in s["tasks"] if t["id"][0] == "T")
    still_open = [t["id"] for t in corrections if t["status"] != "done"]
    unreviewed = [t["id"] for t in corrections if t["status"] == "done" and t["id"] not in reviewed] if reviews else []
    step = "corrections" if still_open and built else "rereview" if unreviewed and not still_open else None
    return {"round": current, "open": still_open, "unreviewed": unreviewed, "step": step,
            "nextId": f"R{max(numbers, default=0) + 1:02d}"}


FEEDBACK_LABELS = {
    "en": {"origin": "user feedback", "screen": "Screen", "attachments": "Attachments", "sep": ":", "priority": {"high": "High", "medium": "Medium", "low": "Low"}},
    "fr": {"origin": "user feedback", "screen": "Écran", "attachments": "Pièces jointes", "sep": " :", "priority": {"high": "Élevée", "medium": "Moyenne", "low": "Faible"}},
}


def feedback_fields(body: str):
    match = re.match(r"^\(user feedback,\s*(High|Medium|Low|Élevée|Moyenne|Faible)\)\s*:\s*(.*)$", body)
    if not match:
        return None
    language = "fr" if match.group(1) in ("Élevée", "Moyenne", "Faible") else "en"
    labels = FEEDBACK_LABELS[language]
    priority = next(key for key, label in labels["priority"].items() if label == match.group(1))
    parts = re.split(r"\.\s+(?=Attachments\s*:|Pièces jointes\s*:)", match.group(2), maxsplit=1)
    attachments = " " + parts[1] if len(parts) > 1 else ""
    fields = re.split(r"\.\s+(?:Screen|Écran)\s*:\s*", parts[0], maxsplit=1)
    return {"text": fields[0].rstrip("."), "screen": fields[1].rstrip(".") if len(fields) > 1 else "",
            "priority": priority, "language": language, "attachments": attachments}


def one_line(value: object, limit: int) -> str:
    cleaned = re.sub(r"\s+", " ", str(value or "")).strip()
    cleaned = re.sub(r"^(?:[-*]\s*)?\[[ xX~!]\]\s*", "", cleaned)
    return cleaned[:limit].rstrip(" .")


def add_feedback(project: Path, loaded: dict, request: dict) -> dict:
    """Append a user feedback as an R task in the Review corrections section of the task list."""
    review = (loaded["contract"].get("modules") or {}).get("review") or {}
    if not review.get("feedback"):
        raise KitError("module.feedback", "The kit does not take user feedback.")
    priority = request.get("priority")
    feedback, screen = one_line(request.get("text"), 600), one_line(request.get("screen"), 120)
    if not feedback or priority not in ("high", "medium", "low"):
        raise KitError("feedback.invalid", "Feedback text and a priority (high, medium or low) are required.")
    path = tasks_file(project, loaded, request.get("unit"))
    values = placeholders(loaded["contract"], loaded["config"])
    review_file = within(project, expand(review["file"], loaded["contract"], values, request["unit"]))
    raw = path.read_bytes()
    bom = raw.startswith(b"\xef\xbb\xbf")
    body = raw.decode("utf-8-sig")
    newline = "\r\n" if "\r\n" in body else "\n"
    lines = body.splitlines()
    task_id = review_loop(review_file, parse_tasks(path))["nextId"]
    labels = FEEDBACK_LABELS.get(language_of(loaded), FEEDBACK_LABELS["en"])
    entry = f"- [ ] {task_id} ({labels['origin']}, {labels['priority'][priority]}){labels['sep']} {feedback}."
    if screen:
        entry += f" {labels['screen']}{labels['sep']} {screen}."
    attached = []
    for item in request.get("attachments") or []:
        within(project, str(item))
        attached.append(f"`{one_line(item, 200)}`")
    if attached:
        entry += f" {labels['attachments']}{labels['sep']} {', '.join(attached[:10])}."
    start = next((i for i, line in enumerate(lines) if REVIEW_SECTION.match(line)), None)
    if start is None:
        while lines and not lines[-1].strip():
            lines.pop()
        lines += ["", "## Review corrections", "", entry]
    else:
        end = next((i for i in range(start + 1, len(lines)) if lines[i].startswith("## ")), len(lines))
        last = end
        while last > start + 1 and not lines[last - 1].strip():
            last -= 1
        lines.insert(last, entry)
        if last == start + 1:
            lines.insert(last, "")
    write_atomic(path, (b"\xef\xbb\xbf" if bom else b"") + (newline.join(lines) + newline).encode("utf-8"))
    return {"id": task_id, "path": path.relative_to(project).as_posix()}


REQUIREMENT_ROW = re.compile(r"^\|\s*\**((?:AC|BR|UI|IF)[0-9]+[a-z]?)\**\s*\|\s*([^|]*?)\s*\|")


def parse_requirements(path: Path) -> dict:
    """Map each requirement id of the unit contract (tables) to its label."""
    result = {}
    for line in text(path).splitlines():
        if (row := REQUIREMENT_ROW.match(line.strip())) and row.group(2):
            result.setdefault(row.group(1), re.sub(r"[`*]", "", row.group(2))[:240])
    return result


# ---------------------------------------------------------------- sources, approvals, costs modules

def converted_files(root: str, inventory: dict | None) -> list[str]:
    """Converted Markdown files listed by the import inventory, relative to the project."""
    result = []
    for entry in (inventory or {}).get("sources", []) if isinstance(inventory, dict) else []:
        for item in [entry, *(entry.get("embedded") or [])] if isinstance(entry, dict) else []:
            converted = item.get("converted") if isinstance(item, dict) else None
            if isinstance(converted, str) and converted.endswith(".md"):
                result.append(f"{root}/{converted}" if root else converted)
    return result


def script_path(project: Path, loaded: dict, relative: str) -> Path:
    path = within(project, (loaded["skills"] / relative).relative_to(project).as_posix())
    if not path.is_file():
        raise KitError("module.script", f"Kit script missing: {relative}. Run APM again.", script=relative)
    return path


def unit_catalog(project: Path, loaded: dict, values: dict) -> list[dict]:
    provider = (loaded["contract"].get("units") or {}).get("catalog")
    if not provider:
        return []
    script = script_path(project, loaded, provider["script"])
    if not script.is_relative_to(loaded["skills"].resolve()):
        raise KitError("path.outside", "The catalog script leaves the installed skills.")
    try:
        result = subprocess.run(
            [sys.executable, "-B", str(script), "--project", str(project)],
            input=json.dumps({"config": loaded["config"], "placeholders": values}),
            capture_output=True, text=True, encoding="utf-8", timeout=10, cwd=project,
            creationflags=0x08000000 if os.name == "nt" else 0,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise KitError("catalog.failed", f"Unit catalog failed: {str(exc)[:300]}.", detail=str(exc)[:300]) from exc
    if result.returncode:
        detail = result.stderr[:500].strip()
        raise KitError("catalog.failed", f"Unit catalog failed: {detail}", detail=detail)
    try:
        if len(result.stdout) > MAX_FILE:
            raise ValueError("Catalog output is too large.")
        payload = json.loads(result.stdout)
        rows = payload["units"]
        if not isinstance(rows, list) or len(rows) > 500:
            raise ValueError("Expected at most 500 units.")
        found = {}
        for row in rows:
            if not isinstance(row, dict) or set(row) - {"id", "title", "dependsOn"}:
                raise ValueError("Invalid unit fields.")
            number, title = row.get("id"), row.get("title")
            dependencies = row.get("dependsOn", [])
            if type(number) is not int or number < 1 or number in found:
                raise ValueError("Unit IDs must be unique positive integers.")
            if not isinstance(title, str) or not title.strip() or len(title) > 500:
                raise ValueError("Each unit needs a business title.")
            if (not isinstance(dependencies, list) or any(type(dep) is not int or dep < 1 for dep in dependencies)
                    or number in dependencies or len(set(dependencies)) != len(dependencies)):
                raise ValueError("Invalid unit dependencies.")
            found[number] = {"id": number, "title": title.strip(), "dependsOn": dependencies}
        visiting, visited = set(), set()

        def visit(number):
            if number in visiting:
                raise ValueError("Cyclic unit dependencies.")
            if number in visited:
                return
            if number not in found:
                raise ValueError("A unit dependency is missing from the catalog.")
            visiting.add(number)
            for dep in found[number]["dependsOn"]:
                visit(dep)
            visiting.remove(number)
            visited.add(number)
        for number in found:
            visit(number)
        return list(found.values())
    except (ValueError, KeyError, TypeError) as exc:
        raise KitError("catalog.invalid", f"Invalid unit catalog: {exc}", detail=str(exc)) from exc


def approvals_module(project: Path, loaded: dict):
    """The approval script of the kit, imported, or None when the kit declares no approvals."""
    spec = (loaded["contract"].get("modules") or {}).get("approvals")
    if not spec:
        return None
    script = loaded["skills"] / spec["script"]
    if not script.is_file():
        return None
    module_spec = importlib.util.spec_from_file_location("vibe_studio_kit_approvals", script)
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    return module


def approvals_call(module, loaded: dict, function: str, *args, **kwargs):
    """Pass the contract's file and language, retaining support for older approval scripts."""
    spec = loaded["contract"]["modules"]["approvals"]
    values = placeholders(loaded["contract"], loaded["config"])
    options = {"file": expand(spec["file"], loaded["contract"], values), "language": language_of(loaded)}
    try:
        return getattr(module, function)(*args, **kwargs, **options)
    except TypeError:
        return getattr(module, function)(*args, **kwargs)


def approvable(contract: dict, values: dict[str, str], units: list[int]) -> dict[str, str]:
    """Deliverable path -> step whose checkpoint approves it."""
    result: dict[str, str] = {}
    for step in contract["steps"]:
        for number in (units if step["scope"] == "unit" else [None]):
            for pattern in step.get("approves", []):
                result.setdefault(expand(pattern, contract, values, number), step["id"])
    return result


def language_of(loaded: dict) -> str:
    value = pointer(loaded["config"], loaded["contract"]["config"].get("language"), "en")
    return value if isinstance(value, str) and re.fullmatch(r"[a-z]{2}", value) else "en"


def snapshot(project: Path) -> dict:
    loaded = load(project)
    contract, config = loaded["contract"], loaded["config"]
    issues = config_issues(project, contract, config, loaded["schema"])
    valid = not issues
    # Do not follow configured paths until every field has passed validation.
    values = placeholders(contract, config if valid else {})
    modules = contract.get("modules") or {}
    planned = unit_numbers(project, contract, values) if valid else []
    catalog = unit_catalog(project, loaded, values) if valid else []
    units = sorted(set(planned) | {item["id"] for item in catalog})
    built, tasks = [], {}
    if "units" in contract and contract["units"].get("evidence"):
        for number in units:
            evidence = within(project, expand(contract["units"]["evidence"], contract, values, number))
            if evidence.is_dir() and any(item.is_file() for item in evidence.iterdir()):
                built.append(number)
    if valid and modules.get("tasks"):
        for number in units:
            task_file = within(project, expand(modules["tasks"]["file"], contract, values, number))
            if not task_file.is_file():
                continue
            try:
                entry = parse_tasks(task_file)
                entry["modified"] = task_file.stat().st_mtime
                if modules.get("review"):
                    entry["loop"] = review_loop(within(project, expand(modules["review"]["file"], contract, values, number)), entry)
            except (ValueError, OSError, UnicodeDecodeError):
                entry = {"approval": None, "approved": False, "sections": [], "convergence": {"rows": 0, "filled": 0},
                         "warnings": ["tasks.unreadable"]}
            requirements = modules["tasks"].get("requirements")
            entry["requirements"] = {}
            if requirements:
                spec_file = within(project, expand(requirements, contract, values, number))
                try:
                    entry["requirements"] = parse_requirements(spec_file) if spec_file.is_file() else {}
                except (ValueError, OSError, UnicodeDecodeError):
                    entry["requirements"] = {}
            tasks[str(number)] = entry
    unit_titles = {str(item["id"]): item["title"] for item in catalog}
    for number in units:
        if str(number) in unit_titles:
            continue
        patterns = [pattern for step in contract["steps"] if step["scope"] == "unit" for pattern in step["outputs"]]
        for pattern in patterns:
            candidate = within(project, expand(pattern, contract, values, number))
            if candidate.suffix.lower() != ".md" or not candidate.is_file():
                continue
            heading = next((line[2:].strip() for line in text(candidate).splitlines() if line.startswith("# ")), "")
            generic = re.fullmatch(r"(?:scenario|scénario|topic|sujet|unit|unité)\s+\d+|tasks|tâches", heading, re.IGNORECASE)
            if heading and not generic:
                unit_titles[str(number)] = re.sub(
                    r"^(?:scenario|scénario|topic|sujet|unit|unité)\s+\d+\s*[:.\-\u2013\u2014]\s*",
                    "", heading, flags=re.IGNORECASE).strip() or heading
                break
    files = {contract["config"]["file"]}
    files.update(expand(p, contract, values) for p in (contract.get("deliverables") or {}).get("extra", []))
    for step in contract["steps"]:
        for number in (units or [1]) if step["scope"] == "unit" else [None]:
            files.update(expand(p, contract, values, number) for p in step["outputs"] + step["requires"])
    approvals = approvable(contract, values, units) if valid else {}
    files.update(approvals)
    validations, validation_warning = {}, None
    module = approvals_module(project, loaded) if valid else None
    if module:
        try:
            validations = approvals_call(module, loaded, "status", project)
        except (ValueError, OSError, UnicodeDecodeError):
            validation_warning = "validations.unreadable"
    inventory, sources, conversions, originals = None, [], [], []
    if modules.get("sources"):
        if modules["sources"].get("inventory"):
            inventory_path = within(project, expand(modules["sources"]["inventory"], contract, values))
            inventory = json.loads(text(inventory_path)) if inventory_path.is_file() else None
            inventory_root = inventory_path.parent.relative_to(project).as_posix() if inventory_path.parent != project else ""
            conversions = converted_files(inventory_root, inventory)
            source_directory = within(project, expand(modules["sources"]["folder"], contract, values))
            for entry in (inventory or {}).get("sources", []):
                if not isinstance(entry, dict):
                    raise KitError("sources.invalid", "Invalid source inventory entry.")
                original = entry.get("path")
                if isinstance(original, str):
                    if Path(original).is_absolute() or PureWindowsPath(original).is_absolute():
                        raise KitError("path.relative", "The source inventory path must be relative.")
                    original_file = within(project, (source_directory / original).relative_to(project).as_posix())
                    if not original_file.is_relative_to(source_directory):
                        raise KitError("path.outside", "The original leaves the sources folder.")
                    entry["originalPath"] = original_file.relative_to(project).as_posix()
                    entry["originalExists"] = original_file.is_file()
                    originals.append(entry["originalPath"])
                for item in [entry, *(entry.get("embedded") or [])]:
                    if isinstance(item, dict) and isinstance(item.get("converted"), str):
                        converted = within(project, f"{inventory_root}/{item['converted']}" if inventory_root else item["converted"])
                        item["convertedPath"] = converted.relative_to(project).as_posix()
                        item["convertedExists"] = converted.is_file()
        source_dir = within(project, expand(modules["sources"]["folder"], contract, values))
        if source_dir.is_dir():
            for child in source_dir.iterdir():
                checked = within(project, child.relative_to(project).as_posix())
                sources.append({"name": child.name, "directory": checked.is_dir()})
                if len(sources) >= 500:
                    break
    lock = mapping(within(project, "apm.lock.yaml"))
    packages = [{"name": item.get("name"), "version": item.get("version")} for item in lock.get("dependencies", []) if isinstance(item, dict)]
    mcp_names = set()
    for relative in (".github/mcp.json", ".vscode/mcp.json", ".copilot/mcp-config.json"):
        file = within(project, relative)
        if file.is_file():
            declaration = json.loads(text(file))
            mcp_names.update((declaration.get("servers") or declaration.get("mcpServers") or {}).keys())
    application = pointer(config, (modules.get("application") or {}).get("pointer")) if valid and modules.get("application") else None
    return {
        "kit": loaded["kit"], "contract": contract,
        "schema": loaded["schema"], "config": config, "template": loaded["template"],
        "language": language_of(loaded), "title": pointer(config, contract["config"].get("title")),
        "valid": valid, "errors": [issue_text(i) for i in issues], "errorItems": issues, "placeholders": values,
        "files": [file_info(project, value) for value in sorted(files)],
        "units": units, "unitTitles": unit_titles, "builtUnits": built, "tasks": tasks,
        "unitCatalog": bool((contract.get("units") or {}).get("catalog")), "plannedUnits": planned,
        "unitDependencies": {str(item["id"]): item["dependsOn"] for item in catalog},
        "sources": sources, "inventory": inventory, "conversions": conversions, "originals": originals,
        "skills": {step["skill"]: (loaded["skills"] / step["skill"] / "SKILL.md").relative_to(project).as_posix() for step in contract["steps"]},
        "skillHashes": {
            **{step["skill"]: hashlib.sha256(text(loaded["skills"] / step["skill"] / "SKILL.md").encode()).hexdigest()
               for step in contract["steps"]},
            **({"unitCatalog": hashlib.sha256(text(script_path(project, loaded, contract["units"]["catalog"]["script"])).encode()).hexdigest()}
               if (contract.get("units") or {}).get("catalog") else {}),
        },
        "packages": packages, "mcpNames": sorted(mcp_names),
        "approvable": approvals if module else {}, "validations": validations, "validationWarning": validation_warning,
        "application": application if isinstance(application, dict) else None,
    }


def approve(project: Path, request: dict) -> dict:
    data = snapshot(project)
    path = request.get("path")
    step = data["approvable"].get(path) if isinstance(path, str) else None
    if step is None:
        raise KitError("approve.forbidden", "This file is not a deliverable to approve.")
    comment = request.get("comment") or ""
    if not isinstance(comment, str) or len(comment) > 300:
        raise KitError("approve.comment", "The comment is limited to 300 characters.")
    loaded = load(project)
    module = approvals_module(project, loaded)
    try:
        return approvals_call(module, loaded, "record", project, path, step, comment)
    except module.Refused as exc:
        raise KitError(exc.code, str(exc)) from exc


def reopen(project: Path, request: dict) -> dict:
    data = snapshot(project)
    step = next((step for step in data["contract"]["steps"] if step["id"] == request.get("step")), None)
    if not step:
        raise KitError("step.unknown", "Unknown step.")
    unit = request.get("unit") if step["scope"] == "unit" else None
    if step["scope"] == "unit" and (type(unit) is not int or unit not in data["units"]):
        raise KitError("unit.invalid", "Invalid unit number.")
    paths = [expand(pattern, data["contract"], data["placeholders"], unit) for pattern in step.get("approves", [])]
    if not paths or not all(data["validations"].get(path, {}).get("current") for path in paths):
        raise KitError("reopen.notApproved", "This step is not approved.")
    loaded = load(project)
    module = approvals_module(project, loaded)
    if not callable(getattr(module, "reopen", None)):
        raise KitError("reopen.updateKit", "Update the kit with APM to reopen a step.")
    try:
        entries = [approvals_call(module, loaded, "reopen", project, path, step["id"]) for path in paths]
    except module.Refused as exc:
        raise KitError(exc.code, str(exc)) from exc
    return {"reopened": paths, "entries": entries}


def run_costs(project: Path, loaded: dict, command: str, request: dict) -> dict:
    contract, config = loaded["contract"], loaded["config"]
    spec = (contract.get("modules") or {}).get("costs")
    if not spec:
        raise KitError("module.costs", "The kit does not track costs.")
    if config_issues(project, contract, config, loaded["schema"]):
        raise KitError("costs.configure", "Configure the project before reading or marking its costs.")
    script = script_path(project, loaded, spec["script"])
    values = placeholders(contract, config)
    state_dir = Path(os.environ.get("COPILOT_HOME", str(Path.home() / ".copilot"))) / "session-state"
    args = [sys.executable, str(script), command, "--project", str(project), "--state-dir", str(state_dir)]
    if "root" in values:
        args += ["--root", values["root"]]
    if command == "report":
        args += ["--json", "--read-only", "--credits-per-aiu", str(pointer(config, spec.get("creditsPerAiu"), 1) or 1)]
        budget = pointer(config, spec.get("budget"))
        if budget is not None:
            args += ["--budget", str(budget)]
    else:
        step = next((s for s in contract["steps"] if s["id"] == request.get("step")), None)
        if step is None:
            raise KitError("step.unknown", "Unknown step.")
        args += ["--phase", step["id"], "--session-id", str(request["sessionId"]), "--run-id", str(request["runId"])]
        if step["scope"] == "unit":
            unit = request.get("unit")
            if type(unit) is not int or unit < 1:
                raise KitError("unit.invalid", "Invalid unit number.")
            args += ["--scenario", str(unit)]
    result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", timeout=45)
    if result.returncode:
        lines = [line.strip() for line in result.stderr.splitlines() if line.strip()]
        if lines:
            detail = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "", lines[-1])
            detail = "".join(char for char in detail if char.isprintable())[:500]
            raise KitError("costs.scriptFailed", "The cost script failed.", exitCode=str(result.returncode), detail=detail)
        raise KitError("costs.scriptFailedWithoutDetail", "The cost script failed without diagnostic output.", exitCode=str(result.returncode))
    if command == "mark":
        return {"marked": True}
    report = json.loads(result.stdout)
    return {key: report.get(key) for key in ("generated_at", "rows", "total", "budget", "malformed_lines", "malformed_marks")} | {
        "sessionCount": len(report.get("sessions", [])),
    }


def preview(project: Path, request: dict) -> dict:
    data = snapshot(project)
    wanted = request.get("path")
    entry = next((f["path"] for f in data["files"] if f["path"] == wanted and f["exists"]), None)
    if entry is None and wanted in data.get("conversions", []):
        candidate = within(project, wanted)
        if candidate.is_file():
            entry = wanted
    if entry is None:
        raise KitError("preview.forbidden", "This file is not one of the allowed deliverables.")
    return {"path": entry, "content": text(within(project, entry))}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["snapshot", "validate", "preview", "task", "feedback", "correction", "approve", "reopen", "costs", "mark"])
    parser.add_argument("--project", required=True)
    args = parser.parse_args(argv)
    project = Path(args.project).resolve(strict=True)
    try:
        request = json.load(sys.stdin)
        if args.command == "snapshot":
            result = snapshot(project)
        elif args.command == "validate":
            loaded = load(project)
            issues = config_issues(project, loaded["contract"], request["config"], loaded["schema"])
            result = {"valid": not issues, "errors": [issue_text(i) for i in issues], "errorItems": issues}
        elif args.command == "preview":
            result = preview(project, request)
        elif args.command == "task":
            result = set_task(project, load(project), request)
        elif args.command == "feedback":
            result = add_feedback(project, load(project), request)
        elif args.command == "correction":
            result = manual_correction(project, load(project), request)
        elif args.command == "approve":
            result = approve(project, request)
        elif args.command == "reopen":
            result = reopen(project, request)
        else:
            result = run_costs(project, load(project), "report" if args.command == "costs" else "mark", request)
        sys.stdout.reconfigure(encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError, subprocess.TimeoutExpired) as exc:
        if isinstance(exc, KitError):
            detail = {"error": str(exc), "code": exc.code, "vars": exc.values}
        else:
            detail = {"error": "Unreadable or incomplete data. Check the kit and the configuration.", "code": "bridge.unreadable"}
        sys.stderr.reconfigure(encoding="utf-8")
        print(json.dumps(detail, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
