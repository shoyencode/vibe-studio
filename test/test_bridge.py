import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

import jsonschema

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "test/fixtures"
REFERENCE = FIXTURES / "reference-kit"


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


bridge = module("vibe_studio_bridge", ROOT / "core/bridge.py")
SCHEMA = json.loads((ROOT / "core/schema/vibe-studio.schema.json").read_text(encoding="utf-8"))
REFERENCE_CONTRACT = REFERENCE / ".apm/skills/poc-0-start/assets/vibe-studio.json"
DEMO = FIXTURES / "demo"


class ContractTests(unittest.TestCase):
    def test_both_kits_follow_the_contract_schema(self):
        jsonschema.Draft202012Validator.check_schema(SCHEMA)
        for path in (REFERENCE_CONTRACT, DEMO / ".apm/skills/demo-0-start/assets/vibe-studio.json"):
            jsonschema.Draft202012Validator(SCHEMA).validate(json.loads(path.read_text(encoding="utf-8")))

    def test_kits_share_the_same_approval_script(self):
        poc = (REFERENCE / ".apm/skills/poc-0-start/scripts/validations.py").read_bytes()
        demo = (DEMO / ".apm/skills/demo-0-start/scripts/validations.py").read_bytes()
        self.assertEqual(poc, demo, "copy .apm/skills/poc-0-start/scripts/validations.py to the demo kit")


class DemoKitTests(unittest.TestCase):
    """The demo kit has no costs, sources, review or application module: the bridge must not need them."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.project = Path(self.temp.name).resolve() / "demo"
        shutil.copytree(DEMO, self.project)
        (self.project / "demo.yml").write_text("project:\n  name: Essai\n  language: en\npaths:\n  root: work\n", encoding="utf-8")
        (self.project / "work/topics/topic-1").mkdir(parents=True)
        (self.project / "work/topics/topic-3").mkdir(parents=True)
        (self.project / "work/note.md").write_text("# Note\n", encoding="utf-8")
        (self.project / "work/topics/topic-1/tasks.md").write_text(
            "# Topic 1\n\nPlan status: approved\n\n## Tasks\n\n- [x] T01 First\n- [~] T02 Second\n- [ ] T03 Third\n", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_task_snapshot_refuses_oversized_files(self):
        path = self.project / "work/topics/topic-1/tasks.md"
        path.write_bytes(b"x" * (bridge.MAX_FILE + 1))
        with self.assertRaises(bridge.KitError) as caught:
            bridge.parse_tasks(path)
        self.assertEqual("file.tooLarge", caught.exception.code)

    def test_unsupported_task_identifiers_fail_instead_of_disappearing(self):
        path = self.project / "work/topics/topic-1/tasks.md"
        path.write_text("## Tasks\n- [x] T01 Done\n- [ ] U01 Pending correction\n", encoding="utf-8")
        with self.assertRaises(bridge.KitError) as caught:
            bridge.parse_tasks(path)
        self.assertEqual("tasks.unsupportedId", caught.exception.code)

    def test_snapshot_follows_the_contract(self):
        data = bridge.snapshot(self.project)
        self.assertTrue(data["valid"], data["errors"])
        self.assertEqual(("kit-demo", "0.1.0", "kit"), (data["kit"]["id"], data["kit"]["version"], data["kit"]["source"]))
        self.assertEqual("Essai", data["title"])
        self.assertEqual([1, 3], data["units"])
        self.assertEqual(["done", "in_progress", "todo"], [t["status"] for t in data["tasks"]["1"]["sections"][0]["tasks"]])
        self.assertNotIn("loop", data["tasks"]["1"])
        self.assertEqual({"work/note.md": "1-write-note", "work/topics/topic-1/findings.md": "2-explore-topic",
                          "work/topics/topic-3/findings.md": "2-explore-topic"}, data["approvable"])
        paths = {f["path"] for f in data["files"]}
        self.assertTrue({"demo.yml", "work/note.md", "work/topics/topic-1/tasks.md", "work/topics/topic-3/findings.md"} <= paths)
        self.assertEqual(([], None, None), (data["sources"], data["inventory"], data["application"]))

    def test_approval_uses_the_file_and_language_of_the_contract(self):
        result = bridge.approve(self.project, {"path": "work/note.md", "comment": "ok"})
        self.assertEqual(("work/approvals.md", "1-write-note"), (result["file"], result["step"]))
        content = (self.project / "work/approvals.md").read_text(encoding="utf-8")
        self.assertIn("| Deliverable | Approved on | By | Step | Fingerprint | Comment |", content)
        self.assertTrue(bridge.snapshot(self.project)["validations"]["work/note.md"]["current"])
        self.assertFalse((self.project / "work/state/validations.md").exists())

    def test_reopen_is_scoped_to_the_step_and_unit_and_preserves_history(self):
        bridge.approve(self.project, {"path": "work/note.md"})
        findings = self.project / "work/topics/topic-1/findings.md"
        findings.write_text("# Sujet 1 : Recherche tarifaire\n", encoding="utf-8")
        bridge.approve(self.project, {"path": "work/topics/topic-1/findings.md"})
        data = bridge.snapshot(self.project)
        self.assertEqual("Recherche tarifaire", data["unitTitles"]["1"])
        result = bridge.reopen(self.project, {"step": "2-explore-topic", "unit": 1})
        self.assertEqual(["work/topics/topic-1/findings.md"], result["reopened"])
        data = bridge.snapshot(self.project)
        self.assertTrue(data["validations"]["work/note.md"]["current"])
        self.assertFalse(data["validations"]["work/topics/topic-1/findings.md"]["current"])
        self.assertTrue(data["validations"]["work/topics/topic-1/findings.md"]["reopened"])
        for request in ({"step": "2-explore-topic", "unit": 3}, {"step": "2-explore-topic", "unit": "../1"}, {"step": "unknown"}):
            with self.assertRaises(bridge.KitError):
                bridge.reopen(self.project, request)

    def test_task_marker_and_refused_modules(self):
        loaded = bridge.load(self.project)
        result = bridge.set_task(self.project, loaded, {"unit": 1, "id": "T02", "status": "done"})
        self.assertEqual(("in_progress", True), (result["previous"], result["written"]))
        for call, code in ((lambda: bridge.add_feedback(self.project, loaded, {"unit": 1, "text": "x", "priority": "low"}), "module.feedback"),
                           (lambda: bridge.run_costs(self.project, loaded, "report", {}), "module.costs"),
                           (lambda: bridge.set_task(self.project, loaded, {"unit": 2, "id": "T01", "status": "done"}), "task.noFile")):
            with self.assertRaises(bridge.KitError) as caught:
                call()
            self.assertEqual(code, caught.exception.code)

    def test_invalid_configuration_is_reported_without_following_paths(self):
        (self.project / "demo.yml").write_text("project:\n  name: Essai\n  language: en\npaths:\n  root: ../../outside\n", encoding="utf-8")
        data = bridge.snapshot(self.project)
        self.assertFalse(data["valid"])
        self.assertIn({"code": "config.badPath", "field": "paths.root"}, data["errorItems"])
        self.assertEqual([], data["units"])

    def test_cost_failures_preserve_bounded_diagnostic_and_exit_code_without_writing_marks(self):
        loaded = bridge.load(self.project)
        loaded["contract"]["modules"]["costs"] = {"script": "demo-0-start/scripts/costs.py"}
        script = self.project / ".apm/skills/demo-0-start/scripts/costs.py"
        script.write_text("# synthetic cost script\n", encoding="utf-8")
        request = {"step": "2-explore-topic", "unit": 1, "sessionId": "exact-session", "runId": "exact-run"}
        for stderr, expected_code in (
            ("usage: costs.py mark\ncosts.py: error: session does not belong to this project\n", "costs.scriptFailed"),
            ("", "costs.scriptFailedWithoutDetail"),
            ("\x1b[31m" + "x" * 800 + "\x1b[0m\n", "costs.scriptFailed"),
        ):
            with patch.object(bridge.subprocess, "run", return_value=SimpleNamespace(returncode=2, stderr=stderr)) as run:
                with self.assertRaises(bridge.KitError) as caught:
                    bridge.run_costs(self.project, loaded, "mark", request)
                self.assertEqual(expected_code, caught.exception.code)
                self.assertEqual("2", caught.exception.values["exitCode"])
                args = run.call_args.args[0]
                self.assertEqual("exact-session", args[args.index("--session-id") + 1])
                self.assertEqual("exact-run", args[args.index("--run-id") + 1])
                self.assertEqual("1", args[args.index("--scenario") + 1])
                if stderr:
                    detail = caught.exception.values["detail"]
                    self.assertLessEqual(len(detail), 500)
                    self.assertNotIn("\x1b", detail)
                    self.assertNotIn("usage:", detail)
            self.assertFalse((self.project / "work/costs/marks.jsonl").exists())


class CatalogAndSourceTests(unittest.TestCase):
    setUp = DemoKitTests.setUp
    tearDown = DemoKitTests.tearDown

    def contract(self, transform):
        file = self.project / ".apm/skills/demo-0-start/assets/vibe-studio.json"
        value = json.loads(file.read_text(encoding="utf-8"))
        transform(value)
        file.write_text(json.dumps(value), encoding="utf-8")

    def test_manual_corrections_preserve_bytes_and_reserve_removed_ids(self):
        path = self.project / "work/topics/topic-1/tasks.md"
        before = b"\xef\xbb\xbf# Tasks\r\n\r\n## Tasks\r\n- [x] T01 Keep.\r\n\r\n## Review corrections\r\n- [ ] R01 Check button. Files: app.css.\r\n- [ ] R02 (user feedback, Medium): Fix title. Screen: Home. Attachments: `work/image.png`.\r\n"
        path.write_bytes(before)
        loaded = bridge.load(self.project)
        def change(task_id, action, **values):
            revision = bridge.parse_tasks(path)["sections"][1]["tasks"][0]["revision"]
            return bridge.manual_correction(self.project, loaded, {"unit": 1, "id": task_id, "action": action, "revision": revision, **values})
        change("R01", "edit", text="Check contrast. Files: app.css.")
        self.assertEqual(before.replace(b"Check button", b"Check contrast"), path.read_bytes())
        change("R01", "validate")
        self.assertIn(b"- [x] R01 Check contrast", path.read_bytes())
        change("R02", "edit", text="Fix heading", screen="Settings", priority="high")
        self.assertIn(b"- [ ] R02 (user feedback, High): Fix heading. Screen: Settings. Attachments: `work/image.png`.", path.read_bytes())
        change("R02", "delete")
        self.assertNotIn(b"- [ ] R02", path.read_bytes())
        parsed = bridge.parse_tasks(path)
        self.assertEqual(["R02"], parsed["removedCorrections"])
        self.assertEqual("R03", bridge.review_loop(path.with_name("review.md"), parsed)["nextId"])
        self.assertTrue(path.read_bytes().startswith(b"\xef\xbb\xbf"))
        self.assertNotIn(b"\n", path.read_bytes().replace(b"\r\n", b""))

    def test_manual_corrections_reject_stale_invalid_and_ambiguous_requests(self):
        path = self.project / "work/topics/topic-1/tasks.md"
        path.write_text("## Tasks\n- [ ] T01 Keep\n- [ ] R01 Fix\n", encoding="utf-8")
        loaded = bridge.load(self.project)
        revision = bridge.parse_tasks(path)["sections"][0]["tasks"][0]["revision"]
        base = {"unit": 1, "id": "R01", "action": "edit", "text": "Changed", "revision": revision}
        for changes in ({"id": "T01"}, {"id": "../R01"}, {"unit": 0}, {"revision": "stale"}, {"text": "x\n- [x] T01"},
                        {"action": "unknown"}, {"text": ""}):
            before = path.read_bytes()
            with self.assertRaises(bridge.KitError):
                bridge.manual_correction(self.project, loaded, {**base, **changes})
            self.assertEqual(before, path.read_bytes())
        path.write_text("## Tasks\n- [ ] R01 Fix\n- [ ] R01 Duplicate\n", encoding="utf-8")
        revision = bridge.parse_tasks(path)["sections"][0]["tasks"][0]["revision"]
        with self.assertRaises(bridge.KitError):
            bridge.manual_correction(self.project, loaded, {**base, "revision": revision})

    def provider(self, units):
        self.contract(lambda value: value["units"].update({"catalog": {"script": "demo-0-start/scripts/list_units.py"}}))
        script = self.project / ".apm/skills/demo-0-start/scripts/list_units.py"
        script.write_text("import json, sys\nrequest = json.load(sys.stdin)\n"
                          "assert request['placeholders']['root'] == 'work'\n"
                          f"print({json.dumps(json.dumps({'units': units}))})\n", encoding="utf-8")

    def test_catalog_exposes_noncontiguous_unplanned_units_without_writing(self):
        self.provider([{"id": 2, "title": "Pricing", "dependsOn": []},
                       {"id": 5, "title": "Customer access", "dependsOn": [2]}])
        before = {str(file): file.read_bytes() for file in self.project.rglob("*") if file.is_file()}
        data = bridge.snapshot(self.project)
        after = {str(file): file.read_bytes() for file in self.project.rglob("*") if file.is_file()}
        self.assertEqual(before, after)
        self.assertEqual([1, 2, 3, 5], data["units"])
        self.assertEqual([1, 3], data["plannedUnits"])
        self.assertEqual("Customer access", data["unitTitles"]["5"])
        self.assertEqual([2], data["unitDependencies"]["5"])
        self.assertFalse((self.project / "work/topics/topic-4").exists())
        self.assertFalse((self.project / "work/topics/topic-5").exists())
        self.assertIn("work/topics/topic-5/findings.md", {file["path"] for file in data["files"]})
        self.assertIn("unitCatalog", data["skillHashes"])

    def test_catalog_rejects_invalid_ids_titles_dependencies_and_cycles(self):
        for units in (
            [{"id": True, "title": "Invalid"}],
            [{"id": 5, "title": "A"}, {"id": 5, "title": "B"}],
            [{"id": 5, "title": " "}],
            [{"id": 5, "title": "A", "dependsOn": [4]}],
            [{"id": 5, "title": "A", "dependsOn": [5]}],
            [{"id": 2, "title": "A", "dependsOn": [5]}, {"id": 5, "title": "B", "dependsOn": [2]}],
        ):
            with self.subTest(units=units):
                self.provider(units)
                with self.assertRaises(bridge.KitError) as caught:
                    bridge.snapshot(self.project)
                self.assertEqual("catalog.invalid", caught.exception.code)

    def test_catalog_failure_and_forbidden_script_are_explicit(self):
        self.provider([])
        script = self.project / ".apm/skills/demo-0-start/scripts/list_units.py"
        script.write_text("raise RuntimeError('fixture provider failure')\n", encoding="utf-8")
        with self.assertRaises(bridge.KitError) as caught:
            bridge.snapshot(self.project)
        self.assertEqual("catalog.failed", caught.exception.code)
        self.contract(lambda value: value["units"]["catalog"].update({"script": "../outside.py"}))
        with self.assertRaises(bridge.KitError) as caught:
            bridge.load(self.project)
        self.assertEqual("contract.invalid", caught.exception.code)

    def test_model_policies_validate_defaults_step_references_and_family_choices(self):
        for policies in (
            {"default": {"default": "absent", "models": ["known"]}},
            {"steps": {"99-missing": {"default": "known", "models": ["known"]}}},
            {"default": {"default": "known", "models": ["known", "known"]}},
            {"default": {"default": "known", "models": ["known"],
                         "byProducerFamily": {"openai": {"default": "missing", "models": ["known"]}}}},
        ):
            with self.subTest(policies=policies):
                self.contract(lambda value: value.update({"modelPolicies": policies}))
                with self.assertRaises(bridge.KitError) as caught:
                    bridge.load(self.project)
                self.assertEqual("contract.invalid", caught.exception.code)
        self.contract(lambda value: value.update({"modelPolicies": {
            "default": {"default": "known", "models": ["known", "alternative"]}}}))
        self.assertEqual("known", bridge.load(self.project)["contract"]["modelPolicies"]["default"]["default"])

    def inventory(self, original="Client file.pdf"):
        self.contract(lambda value: value.setdefault("modules", {}).update({
            "sources": {"folder": "client", "inventory": "{root}/inventory.json"}}))
        (self.project / "client").mkdir(exist_ok=True)
        (self.project / "client/Client file.pdf").write_bytes(b"%PDF fixture")
        (self.project / "work/converted.md").write_text("# Converted\n", encoding="utf-8")
        (self.project / "work/inventory.json").write_text(json.dumps({
            "sources_root": "C:\\untrusted\\other-computer",
            "sources": [{"path": original, "converted": "converted.md",
                         "embedded": [{"name": "Attachment", "converted": "missing.md"}]}]}), encoding="utf-8")

    def test_originals_use_validated_sources_folder_and_converted_use_inventory_root(self):
        self.inventory()
        data = bridge.snapshot(self.project)
        self.assertEqual(["client/Client file.pdf"], data["originals"])
        source = data["inventory"]["sources"][0]
        self.assertEqual("client/Client file.pdf", source["originalPath"])
        self.assertTrue(source["originalExists"])
        self.assertEqual("work/converted.md", source["convertedPath"])
        self.assertTrue(source["convertedExists"])
        self.assertNotIn("originalPath", source["embedded"][0])
        self.assertFalse(source["embedded"][0]["convertedExists"])

    def test_original_paths_cannot_leave_the_sources_folder(self):
        for original in ("../work/note.md", "../../outside.pdf", "C:\\private\\document.pdf"):
            self.inventory(original)
            with self.assertRaises(bridge.KitError):
                bridge.snapshot(self.project)


class DiscoveryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.project = Path(self.temp.name).resolve()

    def tearDown(self):
        self.temp.cleanup()

    def install(self, source: Path, root=".agents/skills"):
        shutil.copytree(source / ".apm/skills", self.project / root, dirs_exist_ok=True)

    def test_no_kit_one_kit_several_kits(self):
        with self.assertRaises(bridge.KitError) as caught:
            bridge.discover(self.project)
        self.assertEqual("kit.none", caught.exception.code)
        self.install(DEMO)
        self.assertEqual("kit-demo", bridge.discover(self.project)[1]["kit"]["id"])
        self.install(REFERENCE)
        with self.assertRaises(bridge.KitError) as caught:
            bridge.discover(self.project)
        self.assertEqual("kit.several", caught.exception.code)

    def test_only_the_current_contract_filename_is_discovered(self):
        self.install(DEMO)
        current = self.project / ".agents/skills/demo-0-start/assets/vibe-studio.json"
        unrelated = current.with_name("other.json")
        current.rename(unrelated)
        before = unrelated.read_bytes()
        with self.assertRaises(bridge.KitError) as caught:
            bridge.discover(self.project)
        self.assertEqual("kit.none", caught.exception.code)
        self.assertEqual(before, unrelated.read_bytes())
        self.assertFalse(current.exists())

    def test_unsupported_protocol_is_refused_without_rewriting_the_contract(self):
        self.install(DEMO)
        current = self.project / ".agents/skills/demo-0-start/assets/vibe-studio.json"
        value = json.loads(current.read_text(encoding="utf-8"))
        value["protocolVersion"] = 1
        current.write_text(json.dumps(value), encoding="utf-8")
        before = current.read_bytes()
        with self.assertRaises(bridge.KitError) as caught:
            bridge.load(self.project)
        self.assertEqual("contract.invalid", caught.exception.code)
        self.assertEqual(before, current.read_bytes())

    def test_source_identity_matches_the_contract_and_manifest(self):
        self.install(REFERENCE, ".apm/skills")
        file = self.project / ".apm/skills/poc-0-start/assets/vibe-studio.json"
        value = json.loads(file.read_text(encoding="utf-8"))
        value["kit"]["id"] = "independent-kit"
        file.write_text(json.dumps(value), encoding="utf-8")
        (self.project / "apm.yml").write_text("name: independent-kit\nversion: 0.7.1\n", encoding="utf-8")
        kit = bridge.load(self.project)["kit"]
        self.assertEqual(("independent-kit", "0.7.1", "kit"), (kit["id"], kit["version"], kit["source"]))

    def test_deployed_identity_matches_the_contract_and_lock_entry(self):
        self.install(REFERENCE)
        file = self.project / ".agents/skills/poc-0-start/assets/vibe-studio.json"
        value = json.loads(file.read_text(encoding="utf-8"))
        value["kit"]["id"] = "independent-kit"
        file.write_text(json.dumps(value), encoding="utf-8")
        (self.project / "apm.lock.yaml").write_text(
            "dependencies:\n- name: unrelated-kit\n  version: 1.0.0\n"
            "- name: independent-kit\n  version: 0.7.1\n  resolved_commit: abc123\n"
            "  deployed_files:\n  - .agents/skills/poc-0-start/SKILL.md\n", encoding="utf-8")
        kit = bridge.load(self.project)["kit"]
        self.assertEqual(("independent-kit", "0.7.1", "apm", "abc123"),
                         (kit["id"], kit["version"], kit["source"], kit["commit"]))


class PocKitTests(unittest.TestCase):
    """The generic bridge reads the independent protocol-2 reference fixture."""

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.project = Path(self.temp.name).resolve() / "project"
        self.project.mkdir()
        (self.project / "apm.yml").write_text("name: reference-kit\nversion: 0.12.0\n", encoding="utf-8")
        shutil.copytree(REFERENCE / ".apm/skills", self.project / ".apm/skills")
        config = bridge.load(self.project)["template"]
        config["client"]["name"] = "Client synthétique"
        config["project"]["name"] = "Essai"
        (self.project / "poc.yml").write_text(bridge.yaml.safe_dump(config, allow_unicode=True), encoding="utf-8")
        folder = self.project / "poc/build/scenario-1"
        folder.mkdir(parents=True)
        (folder / "tasks.md").write_text("Plan status: approved on 01/10/2026 by Ana\n\n## Build\n\n- [x] T01 Done\n\n## Review corrections\n\n- [ ] R01 Fix\n", encoding="utf-8")
        (folder / "review.md").write_text("Review round: 1\n\n## Findings\n\n| R01 | x |\n", encoding="utf-8")
        (folder / "spec.md").write_text("| AC1 | Total shown |\n", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_reference_contract_drives_the_project_snapshot(self):
        snapshot = bridge.snapshot(self.project)
        self.assertTrue(snapshot["valid"], snapshot["errors"])
        self.assertEqual([1], snapshot["units"])
        self.assertEqual("corrections", snapshot["tasks"]["1"]["loop"]["step"])
        self.assertEqual(["R01"], snapshot["tasks"]["1"]["loop"]["open"])
        tasks = [task for section in snapshot["tasks"]["1"]["sections"] for task in section["tasks"]]
        self.assertEqual([("T01", "done"), ("R01", "todo")], [(task["id"], task["status"]) for task in tasks])
        self.assertEqual(2, snapshot["contract"]["protocolVersion"])

    def test_feedback_and_task_marker(self):
        loaded = bridge.load(self.project)
        self.assertEqual("R02", bridge.add_feedback(self.project, loaded, {"unit": 1, "text": "Bouton trop petit", "priority": "high"})["id"])
        self.assertTrue(bridge.set_task(self.project, loaded, {"unit": 1, "id": "R02", "status": "in_progress"})["written"])

    def test_feedback_lists_its_attachments_inside_the_project(self):
        loaded = bridge.load(self.project)
        result = bridge.add_feedback(self.project, loaded, {"unit": 1, "text": "Logo flou", "priority": "low",
                                                            "attachments": ["poc/build/scenario-1/attachments/20261021-160000-logo.png"]})
        tasks = (self.project / result["path"]).read_text(encoding="utf-8")
        self.assertIn("`poc/build/scenario-1/attachments/20261021-160000-logo.png`", tasks)
        with self.assertRaises(bridge.KitError):
            bridge.add_feedback(self.project, loaded, {"unit": 1, "text": "x", "priority": "low", "attachments": ["../secret.txt"]})


if __name__ == "__main__":
    unittest.main()
