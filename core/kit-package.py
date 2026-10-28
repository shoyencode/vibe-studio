"""Kit workshop backend. JSON stdin/stdout; never executes kit scripts.

Public operations are dispatched by core/kit-workshop.mjs. Transactions use
same-filesystem staging with rollback; archive imports publish only after validation.
"""
from __future__ import annotations

import hashlib
import errno
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time
import uuid
import zipfile
from contextlib import contextmanager

import jsonschema
import yaml

HERE = Path(__file__).resolve().parent
MAX_FILES = 5000
MAX_FILE = 16 * 1024 * 1024
MAX_TOTAL = 100 * 1024 * 1024
MANIFEST = ".agents/vibe-studio-kit.json"
# Authoring metadata travels with the package (ZIP, Git) but is never installed into projects.
AUTHORING = ".apm/vibe-studio-authoring.json"
AUTHORED_SKILL = re.compile(r"^\.apm/skills/[a-z][a-z0-9-]*/SKILL\.md$")
IDENTIFIER = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._-]*$")
REPLACE_DELAYS = (0.025, 0.05, 0.1, 0.2, 0.4, 0.8)


class KitError(Exception):
    def __init__(self, code, message, errors=None):
        super().__init__(message)
        self.code, self.errors = code, errors or []


def safe_name(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise KitError("kit.path", "Expected a portable relative path.")
    parts = value.split("/")
    if any(not p or p in (".", "..") or ":" in p or p.endswith((".", " "))
           or re.search(r'[<>\"|?*\x00-\x1f]', p)
           or re.match(r"^(CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)", p, re.I)
           for p in parts):
        raise KitError("kit.path", f"Unsafe path: {value}")
    return value


def safe_path(root, relative):
    safe_name(relative)
    root = Path(root).absolute()
    # Reject links/junctions in every ancestor, including the destination itself.
    target = root.joinpath(*relative.split("/"))
    for candidate in (target, *target.parents):
        attributes = candidate.lstat().st_file_attributes if os.name == "nt" and candidate.exists() else 0
        if candidate.is_symlink() or attributes & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0) or (
                hasattr(candidate, "is_junction") and candidate.is_junction()):
            raise KitError("kit.symlink", f"Links are not allowed: {candidate.name}")
    return target


def root_path(value):
    root = Path(value).absolute()
    safe_path(root, "__path_check__")
    return root


def scratch(parent):
    folder = parent / (".vibe-kit-" + uuid.uuid4().hex)
    folder.mkdir(parents=True)
    return folder


@contextmanager
def mutation_lock(root):
    root = root_path(root)
    root.mkdir(parents=True, exist_ok=True)
    lock = safe_path(root, ".vibe-studio-kit.lock")
    try:
        descriptor = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as exc:
        raise KitError("kit.busy", "Another kit operation is active; close it before retrying.") from exc
    try:
        os.write(descriptor, str(os.getpid()).encode("ascii"))
        yield
    finally:
        os.close(descriptor)
        lock.unlink()


def file_map(root, package_only=False):
    result, total, folded = {}, 0, set()
    for folder, dirs, names in os.walk(root, followlinks=False):
        if package_only and Path(folder) == root:
            dirs[:] = [name for name in dirs if name == ".apm"]
            names = [name for name in names if name == "apm.yml"]
        for name in list(dirs):
            candidate = Path(folder) / name
            safe_path(root, candidate.relative_to(root).as_posix())
            if package_only and name in (".git", "node_modules", "__pycache__"):
                dirs.remove(name)
        for name in names:
            candidate = Path(folder) / name
            relative = candidate.relative_to(root).as_posix()
            safe_path(root, relative)
            if package_only and relative != "apm.yml" and not relative.startswith(".apm/"):
                continue
            if not candidate.is_file() or candidate.stat().st_size > MAX_FILE:
                raise KitError("kit.limit", "Invalid or oversized kit file.")
            total += candidate.stat().st_size
            if len(result) >= MAX_FILES or total > MAX_TOTAL:
                raise KitError("kit.limit", "Kit exceeds the size or file-count limit.")
            if relative.casefold() in folded:
                raise KitError("kit.path", "Case-colliding kit paths.")
            folded.add(relative.casefold())
            result[relative] = candidate.read_bytes()
    return result


def digest(data):
    return hashlib.sha256(data).hexdigest()


def replace_file(source, target):
    """Tolerate brief antivirus/indexer locks without deleting the old target."""
    for attempt in range(len(REPLACE_DELAYS) + 1):
        try:
            os.replace(source, target)
            return
        except OSError as exc:
            transient = exc.errno in (errno.EACCES, errno.EPERM, errno.EBUSY) or getattr(exc, "winerror", None) in (5, 32, 33)
            if not transient or attempt == len(REPLACE_DELAYS):
                raise
            time.sleep(REPLACE_DELAYS[attempt])


def encode_json(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def read_model(root):
    root = root_path(root)
    package = yaml.safe_load(safe_path(root, "apm.yml").read_text(encoding="utf-8-sig"))
    contracts = list((root / ".apm" / "skills").glob("*/assets/vibe-studio.json"))
    if len(contracts) != 1:
        raise KitError("kit.contract", "A kit must contain exactly one entry contract.")
    contract_path = safe_path(root, contracts[0].relative_to(root).as_posix())
    return {"package": package, "contract": json.loads(contract_path.read_text(encoding="utf-8-sig"))}


def validate_model(root, model, assets=True):
    errors = []

    def error(field, message, code="kit.invalid"):
        issue = {"field": field, "code": code, "message": message}
        if issue not in errors:
            errors.append(issue)

    contract, package = model.get("contract"), model.get("package")
    if not isinstance(package, dict):
        error("/metadata", "Package metadata must be an object.")
        package = {}
    for key in ("name", "version", "description", "license"):
        if not isinstance(package.get(key), str) or not package[key].strip():
            error("/metadata/" + key, "A non-empty value is required.")
    if isinstance(package.get("name"), str) and not IDENTIFIER.fullmatch(package["name"]):
        error("/metadata/name", "Use a portable package identifier.")
    if isinstance(package.get("version"), str) and not re.fullmatch(
            r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", package["version"]):
        error("/metadata/version", "Use a semantic version.")
    schema = json.loads((HERE / "schema" / "vibe-studio.schema.json").read_text(encoding="utf-8"))
    for issue in jsonschema.Draft202012Validator(schema).iter_errors(contract):
        # Keep the actual property path, including missing required properties.
        pointer = "/contract" + "".join("/" + str(p).replace("~", "~0").replace("/", "~1") for p in issue.absolute_path)
        if issue.validator == "required":
            missing = [key for key in issue.validator_value if key not in issue.instance]
            for key in missing:
                error(pointer + "/" + key, "A required field is missing.", "kit.schema")
        else:
            error(pointer, issue.message, "kit.schema")
    if errors:
        return {"valid": False, "errors": errors}
    kit = contract["kit"]
    if package["name"] != kit["id"]:
        error("/contract/kit/id", "The kit id must match the package name.")
    ids, skills = set(), set()
    entry = kit["entrySkill"]
    for field, value in [("/contract/kit/id", kit["id"]), ("/contract/kit/entrySkill", entry)]:
        if not IDENTIFIER.fullmatch(value):
            error(field, "Use a portable identifier.")

    def exists(relative, field):
        try:
            target = safe_path(root, relative)
            if assets and not target.is_file():
                error(field, f"Missing kit file: {relative}", "kit.missing")
            return target
        except KitError as exc:
            error(field, str(exc), exc.code)
            return None

    for i, step in enumerate(contract["steps"]):
        base = f"/contract/steps/{i}"
        if step["id"] in ids:
            error(base + "/id", "Step ids must be unique.")
        ids.add(step["id"])
        skills.add(step["skill"])
        if not IDENTIFIER.fullmatch(step["skill"]):
            error(base + "/skill", "Use a portable skill identifier.")
        else:
            exists(f".apm/skills/{step['skill']}/SKILL.md", base + "/skill")
        if step.get("agent"):
            if not IDENTIFIER.fullmatch(step["agent"]):
                error(base + "/agent", "Use a portable agent identifier.")
            else:
                exists(f".apm/agents/{step['agent']}.agent.md", base + "/agent")
        if step["scope"] == "unit" and "units" not in contract:
            error(base + "/scope", "Unit-scoped steps require units.")
    exists(f".apm/skills/{entry}/SKILL.md", "/contract/kit/entrySkill")
    spec = contract["config"]
    config_schema = None
    for key in ("schema", "template"):
        if spec.get(key):
            target = exists(f".apm/skills/{entry}/{spec[key]}", "/contract/config/" + key)
            if assets and target and target.is_file():
                try:
                    value = yaml.safe_load(target.read_text(encoding="utf-8-sig"))
                    if key == "schema":
                        jsonschema.Draft202012Validator.check_schema(value)
                        def check_refs(item):
                            if isinstance(item, dict):
                                for ref_key in ("$ref", "$dynamicRef"):
                                    if ref_key in item and not item[ref_key].startswith("#"):
                                        raise ValueError("Configuration schemas must use local fragment references only.")
                                for child in item.values():
                                    check_refs(child)
                            elif isinstance(item, list):
                                for child in item:
                                    check_refs(child)
                        check_refs(value)
                        config_schema = value
                except (ValueError, yaml.YAMLError, jsonschema.SchemaError) as exc:
                    error("/contract/config/" + key, str(exc))
    if assets and config_schema is not None and spec.get("template"):
        target = safe_path(root, f".apm/skills/{entry}/{spec['template']}")
        if target.is_file():
            try:
                template = yaml.safe_load(target.read_text(encoding="utf-8-sig"))
                for issue in jsonschema.Draft202012Validator(config_schema).iter_errors(template):
                    error("/contract/config/template", issue.message)
            except yaml.YAMLError as exc:
                error("/contract/config/template", str(exc))
    known = set(spec.get("placeholders", {})) | {"unit", "n"}
    pattern_keys = {"file", "folder", "evidence", "requires", "outputs", "approves", "patterns",
                    "paths", "except", "path", "inventory", "requirements", "report"}

    def walk(value, field="/contract", key=""):
        if isinstance(value, dict):
            for name, child in value.items():
                walk(child, field + "/" + name, name)
        elif isinstance(value, list):
            for i, child in enumerate(value):
                walk(child, field + "/" + str(i), key)
        elif isinstance(value, str):
            if key in ("buildStep", "reviewStep", "importStep") and value not in ids:
                error(field, "Unknown step reference.")
            if key == "script":
                exists(".apm/skills/" + value, field)
            if key == "skills":
                exists(".apm/skills/" + value + "/SKILL.md", field)
            if key in pattern_keys:
                for placeholder in re.findall(r"\{([^{}]+)\}", value):
                    if placeholder not in known:
                        error(field, f"Unknown placeholder: {placeholder}")
                    if placeholder == "unit" and "units" not in contract:
                        error(field, "The unit placeholder requires units.")
                    if placeholder == "unit" and field == "/contract/units/folder":
                        error(field, "The unit folder cannot reference itself.")
                if key == "paths" and value.startswith("/"):
                    return  # JSON pointer config.paths, not a project file.
                expanded = re.sub(r"\{[^{}]+\}", "value", value).replace("**", "glob").replace("*", "glob").replace("?", "q")
                try:
                    safe_name(expanded)
                except KitError:
                    error(field, "Paths must remain relative to the project.")
    walk(contract)
    for name, placeholder in spec.get("placeholders", {}).items():
        try:
            safe_name(placeholder["default"])
            if "{" in placeholder["default"] or "}" in placeholder["default"]:
                raise KitError("kit.path", "Placeholder defaults must be concrete relative paths.")
        except KitError as exc:
            error("/contract/config/placeholders/" + name + "/default", str(exc))
    groups = set()
    for index, group in enumerate(contract.get("deliverables", {}).get("groups", [])):
        if group["id"] in groups:
            error(f"/contract/deliverables/groups/{index}/id", "Deliverable group ids must be unique.")
        groups.add(group["id"])
    policies = contract.get("modelPolicies", {})
    for step_id in policies.get("steps", {}):
        if step_id not in ids:
            error("/contract/modelPolicies/steps/" + step_id, "Unknown step reference.")
    for agent in policies.get("agents", {}):
        exists(f".apm/agents/{agent}.agent.md", "/contract/modelPolicies/agents/" + agent)

    def policies_walk(value, field):
        if not isinstance(value, dict):
            return
        if "default" in value and "models" in value and value["default"] not in value["models"]:
            error(field + "/default", "Default model must be one of the candidates.")
        for key, child in value.items():
            policies_walk(child, field + "/" + key)
    policies_walk(policies, "/contract/modelPolicies")
    return {"valid": not errors, "errors": errors}


def validate(root):
    try:
        file_map(root_path(root), package_only=True)
        return validate_model(root, read_model(root))
    except (KitError, OSError, ValueError, yaml.YAMLError) as exc:
        return {"valid": False, "errors": [{"field": "/", "code": getattr(exc, "code", "kit.read"), "message": str(exc)}]}


def require_valid(root):
    result = validate(root)
    if not result["valid"]:
        raise KitError("kit.invalid", "The kit is invalid.", result["errors"])


def transaction(root, writes, deletes=()):
    """Replace only named files, restoring all old bytes on any failed write."""
    root = root_path(root)
    root.mkdir(parents=True, exist_ok=True)
    stage = scratch(root)
    originals, applied, created_dirs = {}, [], []
    try:
        for relative in set(writes) | set(deletes):
            target = safe_path(root, relative)
            if target.exists() and not target.is_file():
                raise KitError("kit.collision", f"Not a regular file: {relative}")
            originals[relative] = target.read_bytes() if target.exists() else None
        for i, (relative, data) in enumerate(writes.items()):
            (stage / str(i)).write_bytes(data)
        for i, (relative, data) in enumerate(writes.items()):
            target = safe_path(root, relative)
            missing = target.parent
            while not missing.exists():
                created_dirs.append(missing)
                missing = missing.parent
            target.parent.mkdir(parents=True, exist_ok=True)
            replace_file(stage / str(i), target)
            applied.append(relative)
        for relative in deletes:
            target = safe_path(root, relative)
            if target.exists():
                target.unlink()
                applied.append(relative)
    except BaseException:
        for relative in reversed(applied):
            target = safe_path(root, relative)
            original = originals[relative]
            if original is None:
                target.unlink(missing_ok=True)
            else:
                recovery = stage / "recovery"
                recovery.write_bytes(original)
                replace_file(recovery, target)
        for folder in created_dirs:
            if folder.exists() and not any(folder.iterdir()):
                folder.rmdir()
        raise
    finally:
        shutil.rmtree(stage)


def authored_files(files):
    """Validate authored text written with the contract: step instructions and authoring metadata."""
    writes, deletes = {}, []
    if files is None:
        return writes, deletes
    if not isinstance(files, dict) or len(files) > 500:
        raise KitError("kit.files", "Invalid authored files.")
    for relative, content in files.items():
        if not isinstance(relative, str) or not (relative == AUTHORING or AUTHORED_SKILL.fullmatch(relative)):
            raise KitError("kit.files", f"Authored files are limited to step instructions: {relative}")
        safe_name(relative)
        if content is None:
            if relative == AUTHORING:
                raise KitError("kit.files", "Authoring metadata cannot be deleted.")
            deletes.append(relative)
            continue
        if not isinstance(content, str) or len(content.encode("utf-8")) > MAX_FILE:
            raise KitError("kit.files", "Invalid authored file content.")
        if relative == AUTHORING:
            json.loads(content)
        writes[relative] = content.encode("utf-8")
    return writes, deletes


def skeleton(root, model, extra=None):
    contract = model["contract"]
    entry = contract["kit"]["entrySkill"]
    writes = {"apm.yml": yaml.safe_dump(model["package"], sort_keys=False, allow_unicode=True).encode("utf-8"),
              f".apm/skills/{entry}/assets/vibe-studio.json": encode_json(contract)}

    def missing(relative, data):
        if not safe_path(root, relative).exists():
            writes[relative] = data

    skills = {step["skill"]: step["title"] for step in contract["steps"]}
    skills.setdefault(entry, contract["kit"]["name"])
    for skill, title in skills.items():
        missing(f".apm/skills/{skill}/SKILL.md",
                (f"---\nname: {skill}\ndescription: {json.dumps(title, ensure_ascii=False)}\n---\n\n"
                 f"# {title}\n\nDescribe this step's instructions and expected outputs here.\n"
                 "\nReport progress with vibe_studio_report. Ask for approval with ask_user.\n"
                 "Stop at the end of this step.\n").encode("utf-8"))
    for step in contract["steps"]:
        if step.get("agent"):
            agent = step["agent"]
            missing(f".apm/agents/{agent}.agent.md",
                    f"---\nname: {agent}\ndescription: Kit authoring agent\n---\n\nFollow the active kit skill.\n".encode())
    spec = contract["config"]
    missing(f".apm/skills/{entry}/{spec['schema']}", encode_json({
        "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object",
        "properties": {"project": {"type": "object", "properties": {
            "name": {"type": "string"}, "language": {"type": "string"}}},
            "paths": {"type": "object", "additionalProperties": {"type": "string"}}}}))
    if spec.get("template"):
        missing(f".apm/skills/{entry}/{spec['template']}",
                b"project:\n  name: My project\n  language: en\npaths:\n  root: work\n")
    approvals = contract.get("modules", {}).get("approvals", {})
    if approvals.get("script"):
        missing(".apm/skills/" + approvals["script"],
                (HERE / "kit-templates" / "demo" / ".apm" / "skills" /
                 "demo-0-start" / "scripts" / "validations.py").read_bytes())
    writes.update(extra or {})
    return writes


def save(root, model, files=None):
    with mutation_lock(root):
        return save_unlocked(root, model, files)


def save_unlocked(root, model, authored=None):
    root = root_path(root)
    result = validate_model(root, model, assets=False)
    if not result["valid"]:
        raise KitError("kit.invalid", "The kit structure is invalid.", result["errors"])
    extra, deletes = authored_files(authored)
    # Validate the prospective package before changing any authored file.
    root.parent.mkdir(parents=True, exist_ok=True)
    stage = scratch(root.parent)
    try:
        files = file_map(root, package_only=True) if root.exists() else {}
        for name in deletes:
            files.pop(name, None)
        files.update(skeleton(root, model, extra))
        expected = f".apm/skills/{model['contract']['kit']['entrySkill']}/assets/vibe-studio.json"
        old_contracts = [name for name in files if name.endswith("/assets/vibe-studio.json") and name != expected]
        for name in old_contracts:
            del files[name]
        for name, data in files.items():
            target = safe_path(stage, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        require_valid(stage)
        transaction(root, skeleton(root, model, extra), [*old_contracts, *deletes])
        return read_model(root)
    finally:
        shutil.rmtree(stage)


def create(root, options):
    root = root_path(root)
    if root.exists() and any(root.iterdir()):
        raise KitError("kit.exists", "Choose an empty kit directory.")
    template = options.get("template", "blank")
    if template not in ("blank", "demo"):
        raise KitError("kit.template", "Unknown kit template.")
    source = HERE / "kit-templates" / template
    root.parent.mkdir(parents=True, exist_ok=True)
    stage = scratch(root.parent)
    try:
        shutil.copytree(source, stage, dirs_exist_ok=True)
        model = read_model(stage)
        model["package"]["name"] = options.get("id", "my-kit")
        model["contract"]["kit"]["id"] = model["package"]["name"]
        model["contract"]["kit"]["name"] = options.get("name", "My kit")
        save(stage, model)
        require_valid(stage)
        if root.exists():
            root.rmdir()
        replace_file(stage, root)
        return read_model(root)
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def export_zip(root, destination):
    root, destination = root_path(root), root_path(destination)
    require_valid(root)
    if destination == root or root in destination.parents:
        raise KitError("kit.path", "Export the archive outside the kit directory.")
    files = file_map(root, package_only=True)
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = scratch(destination.parent)
    try:
        archive = stage / "kit.zip"
        with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as out:
            for name, data in sorted(files.items()):
                info = zipfile.ZipInfo(name)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | 0o644) << 16
                out.writestr(info, data)
        replace_file(archive, destination)
        return {"path": str(destination), "sha256": digest(destination.read_bytes()), "size": destination.stat().st_size}
    finally:
        shutil.rmtree(stage)


def import_zip(archive, destination):
    archive, destination = root_path(archive), root_path(destination)
    if destination.exists() and any(destination.iterdir()):
        raise KitError("kit.exists", "Choose an empty import directory.")
    if archive.stat().st_size > MAX_TOTAL:
        raise KitError("kit.limit", "Archive is too large.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = scratch(destination.parent)
    try:
        with zipfile.ZipFile(archive) as source:
            entries = source.infolist()
            if len(entries) > MAX_FILES:
                raise KitError("kit.limit", "Too many archive entries.")
            total, seen = 0, set()
            for info in entries:
                name = info.filename[:-1] if info.is_dir() else info.filename
                safe_name(name)
                if name.casefold() in seen:
                    raise KitError("kit.path", "Duplicate or case-colliding archive path.")
                seen.add(name.casefold())
                mode = info.external_attr >> 16
                if stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR):
                    raise KitError("kit.symlink", "Archive links and special files are forbidden.")
                if info.flag_bits & 1:
                    raise KitError("kit.archive", "Encrypted archives are not supported.")
                if name != "apm.yml" and name != ".apm" and not name.startswith(".apm/"):
                    raise KitError("kit.archive", "Archive contains files outside the kit package.")
                total += info.file_size
                if info.file_size > MAX_FILE or total > MAX_TOTAL:
                    raise KitError("kit.limit", "Uncompressed archive is too large.")
                target = safe_path(stage, name)
                if info.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with source.open(info) as stream:
                        data = stream.read(MAX_FILE + 1)
                    if len(data) > MAX_FILE or len(data) != info.file_size:
                        raise KitError("kit.limit", "Invalid archive file size.")
                    target.write_bytes(data)
        require_valid(stage)
        if destination.exists():
            destination.rmdir()
        replace_file(stage, destination)
        return read_model(destination)
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def import_git(url, destination):
    # No shell, option injection, local/file protocols, credentials, or remote helpers.
    if not isinstance(url, str) or not re.fullmatch(r"https://[A-Za-z0-9.-]+(?::[0-9]+)?/[A-Za-z0-9_./~%-]+(?:\.git)?", url):
        raise KitError("kit.gitUrl", "Use an HTTPS Git repository URL without credentials.")
    destination = root_path(destination)
    if destination.exists() and any(destination.iterdir()):
        raise KitError("kit.exists", "Choose an empty import directory.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = scratch(destination.parent)
    try:
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_CONFIG_NOSYSTEM": "1",
               "GIT_CONFIG_GLOBAL": os.devnull, "GIT_LFS_SKIP_SMUDGE": "1"}
        # Disallow inherited config injection and custom transport commands.
        for key in list(env):
            if key.startswith("GIT_CONFIG_") and key not in ("GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_GLOBAL"):
                del env[key]
        try:
            subprocess.run(["git", "-c", "core.hooksPath=" + str(stage / "no-hooks"),
                            "-c", "protocol.allow=never", "-c", "protocol.https.allow=always",
                            "clone", "--depth", "1", "--no-recurse-submodules", "--", url, str(stage / "repo")],
                           check=True, capture_output=True, timeout=150, env=env)
        except FileNotFoundError as exc:
            raise KitError("kit.gitMissing", "Git is not available.") from exc
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
            raise KitError("kit.gitFailed", "Unable to clone the Git repository.") from exc
        repo = stage / "repo"
        file_map(repo)
        require_valid(repo)
        if destination.exists():
            destination.rmdir()
        replace_file(repo, destination)
        return read_model(destination)
    finally:
        shutil.rmtree(stage)


def owned_path(value):
    safe_name(value)
    return value.startswith((".agents/skills/", ".github/agents/", ".github/instructions/"))


def install(root, project, options):
    with mutation_lock(project):
        return install_unlocked(root, project, options)


def install_unlocked(root, project, options):
    root, project = root_path(root), root_path(project)
    if root == project or root in project.parents or project in root.parents:
        raise KitError("kit.path", "Kit and project directories must be separate.")
    require_valid(root)
    model = read_model(root)
    old = read_installed(project)
    if old:
        if old.get("id") != model["contract"]["kit"]["id"]:
            raise KitError("kit.other", "Another kit is already installed.")
    # Also detect unmanaged/APM contracts: never silently replace another kit.
    for base in (".agents/skills", ".github/skills", ".apm/skills"):
        safe_path(project, base)
        for candidate in (project / base).glob("*/assets/vibe-studio.json"):
            safe_path(project, candidate.relative_to(project).as_posix())
            existing = json.loads(candidate.read_text(encoding="utf-8-sig"))
            if existing.get("kit", {}).get("id") != model["contract"]["kit"]["id"] or not old:
                raise KitError("kit.other", "An unmanaged or different kit is already installed.")
    writes = {}
    mapping = {".apm/skills/": ".agents/skills/", ".apm/agents/": ".github/agents/",
               ".apm/instructions/": ".github/instructions/", ".apm/rules/": ".github/instructions/"}
    for name, data in file_map(root, package_only=True).items():
        for source, target in mapping.items():
            if name.startswith(source):
                dest = target + name[len(source):]
                if dest.casefold() in {key.casefold() for key in writes}:
                    raise KitError("kit.collision", "Multiple kit files target the same installed path.")
                writes[dest] = data
                break
    old_files = old["files"] if old else {}
    modified = []
    for name in set(writes) | set(old_files):
        target = safe_path(project, name)
        if name in old_files:
            if not target.is_file() or digest(target.read_bytes()) != old_files[name]:
                modified.append(name)
        elif target.exists():
            # Explicit confirmation applies only to owned files, never unrelated data.
            raise KitError("kit.collision", f"Installation would overwrite an unrelated file: {name}")
    if modified and not options.get("allowModified", False):
        raise KitError("kit.modified", "Installed kit files have local modifications.",
                       [{"field": name, "code": "kit.modified", "message": "Locally modified kit file."} for name in sorted(modified)])
    manifest = {"id": model["contract"]["kit"]["id"], "version": model["package"]["version"],
                "source": options.get("source", {"type": "local", "directory": str(root)}),
                "files": {name: digest(data) for name, data in sorted(writes.items())}}
    manifest["sha256"] = digest(encode_json(manifest["files"]))
    backup = None
    if old:
        backup_root = root_path(options.get("backupDir") or str(project / ".agents" / "kit-backups"))
        for name in old_files:
            if backup_root == safe_path(project, name) or safe_path(project, name) in backup_root.parents:
                raise KitError("kit.path", "Backup directory overlaps installed files.")
        backup_root.mkdir(parents=True, exist_ok=True)
        backup = scratch(backup_root)
        for name in [*old_files, MANIFEST]:
            source = safe_path(project, name)
            if source.is_file():
                target = safe_path(backup, name)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(source, target)
    writes[MANIFEST] = encode_json(manifest)
    transaction(project, writes, sorted(set(old_files) - set(writes)))
    return {**manifest, "backup": str(backup) if backup else None}


def dispatch(command, request):
    directory = request.get("directory")
    if command == "read":
        return public_model(directory, read_model(directory))
    if command == "validate":
        return validate(directory)
    if command == "validate-model":
        model = request["model"]
        return validate_model(root_path(directory), {
            "package": model.get("metadata", model.get("package")),
            "contract": model.get("contract"),
        }, assets=False)
    if command == "save":
        model = request["model"]
        return public_model(directory, save(directory, {"package": model.get("metadata", model.get("package")),
                                                        "contract": model.get("contract")}, request.get("files")))
    if command == "create":
        return public_model(directory, create(directory, request))
    if command == "export":
        return export_zip(directory, request["zip"])
    if command == "import":
        return public_model(directory, import_zip(request["zip"], directory))
    if command == "git":
        return public_model(directory, import_git(request["url"], directory))
    if command == "install":
        return install(directory, request["project"], request)
    if command == "installed":
        return read_installed(request["project"])
    if command == "inspect":
        return inspect_installation(directory, request["project"])
    raise KitError("kit.command", "Unknown kit operation.")


def public_model(directory, model):
    root = root_path(directory)
    contract = model["contract"]
    files = {}
    skills = {step.get("skill") for step in contract.get("steps", []) if isinstance(step, dict)}
    skills.add(contract.get("kit", {}).get("entrySkill"))
    for skill in sorted(name for name in skills if isinstance(name, str)):
        relative = f".apm/skills/{skill}/SKILL.md"
        if AUTHORED_SKILL.fullmatch(relative):
            target = safe_path(root, relative)
            if target.is_file():
                files[relative] = target.read_text(encoding="utf-8-sig")
    target = safe_path(root, AUTHORING)
    if target.is_file():
        files[AUTHORING] = target.read_text(encoding="utf-8-sig")
    return {"directory": str(root), "metadata": model["package"], "contract": contract, "files": files}


def read_installed(project):
    target = safe_path(root_path(project), MANIFEST)
    if not target.exists():
        return None
    manifest = json.loads(target.read_text(encoding="utf-8"))
    if not isinstance(manifest, dict) or not isinstance(manifest.get("files"), dict):
        raise KitError("kit.manifest", "Invalid installed kit manifest.")
    if not isinstance(manifest.get("id"), str) or not isinstance(manifest.get("version"), str):
        raise KitError("kit.manifest", "Invalid installed kit identity.")
    folded = set()
    for name, checksum in manifest["files"].items():
        if not owned_path(name) or not isinstance(checksum, str) or not re.fullmatch(r"[a-f0-9]{64}", checksum):
            raise KitError("kit.manifest", "Invalid installed kit manifest.")
        if name.casefold() in folded:
            raise KitError("kit.manifest", "Case-colliding installed paths.")
        folded.add(name.casefold())
    return manifest


def inspect_installation(directory, project):
    project = root_path(project)
    manifest = read_installed(project)
    modified = []
    if manifest:
        for name, checksum in manifest["files"].items():
            target = safe_path(project, name)
            if not target.is_file() or digest(target.read_bytes()) != checksum:
                modified.append(name)
    result = {"manifest": manifest, "modified": sorted(modified)}
    if directory:
        require_valid(directory)
        model = read_model(directory)
        result.update({"id": model["contract"]["kit"]["id"], "version": model["package"]["version"],
                       "sameKit": manifest is None or manifest.get("id") == model["contract"]["kit"]["id"]})
    return result


if __name__ == "__main__":
    try:
        print(json.dumps(dispatch(sys.argv[1], json.load(sys.stdin)), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"code": getattr(exc, "code", "kit.failure"), "error": str(exc),
                          "errors": getattr(exc, "errors", [])}, ensure_ascii=False), file=sys.stderr)
        sys.exit(1)
