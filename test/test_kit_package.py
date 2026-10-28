"""Workshop regression tests. Scratch artifacts stay inside the checkout."""
import importlib.util
import errno
import json
from pathlib import Path
import shutil
import stat
import unittest
from unittest.mock import patch
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("kit_package", ROOT / "core" / "kit-package.py")
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)


class KitPackageTests(unittest.TestCase):
    def setUp(self):
        self.work = ROOT / (".kit-test-" + uuid.uuid4().hex)
        self.work.mkdir()
        self.source = self.work / "source"
        self.project = self.work / "project"

    def tearDown(self):
        shutil.rmtree(self.work)

    def create(self, template="demo"):
        return kit.create(self.source, {"template": template, "id": "test-kit", "name": "Test kit"})

    def test_templates_read_save_and_preserve_authored_files(self):
        for template in ("blank", "demo"):
            with self.subTest(template=template):
                if self.source.exists():
                    shutil.rmtree(self.source)
                model = self.create(template)
                self.assertTrue(kit.validate(self.source)["valid"])
                skill = self.source / ".apm" / "skills" / model["contract"]["kit"]["entrySkill"] / "SKILL.md"
                skill.write_text("Authored instructions", encoding="utf-8")
                (self.source / "unrelated.txt").write_text("keep")
                model["contract"]["steps"].append({
                    "id": "3-write", "title": "Write", "skill": "write", "agent": "writer",
                    "scope": "project", "requires": [], "outputs": ["{root}/note.md"],
                    "summary": "Write a note.", "returns": "A note."
                })
                kit.save(self.source, model)
                self.assertEqual(skill.read_text(encoding="utf-8"), "Authored instructions")
                self.assertEqual((self.source / "unrelated.txt").read_text(), "keep")
                self.assertTrue((self.source / ".apm/skills/write/SKILL.md").is_file())
                self.assertTrue((self.source / ".apm/agents/writer.agent.md").is_file())

    def test_authored_files_are_saved_with_the_contract_and_never_installed(self):
        model = self.create("blank")
        entry = model["contract"]["kit"]["entrySkill"]
        instructions = f".apm/skills/{entry}/SKILL.md"
        metadata = '{"sourceLanguage": "fr", "languages": ["fr", "en"]}'
        kit.save(self.source, model, {instructions: "# Préparer\n\nLire le cahier des charges.\n", kit.AUTHORING: metadata})
        public = kit.public_model(self.source, kit.read_model(self.source))
        self.assertEqual(public["files"][instructions], "# Préparer\n\nLire le cahier des charges.\n")
        self.assertEqual(json.loads(public["files"][kit.AUTHORING])["sourceLanguage"], "fr")
        original = kit.file_map(self.source)
        for files in ({"apm.yml": "x"}, {".apm/skills/x/scripts/run.py": "x"}, {"../escape/SKILL.md": "x"},
                      {kit.AUTHORING: None}, {kit.AUTHORING: "{not json"}, {instructions: 3}):
            with self.subTest(files=files), self.assertRaises((kit.KitError, ValueError)):
                kit.save(self.source, model, files)
        self.assertEqual(kit.file_map(self.source), original)
        archive = self.work / "kit.zip"
        kit.export_zip(self.source, archive)
        with zipfile.ZipFile(archive) as z:
            self.assertIn(kit.AUTHORING, z.namelist())
        result = kit.install(self.source, self.project, {})
        self.assertFalse(any("authoring" in name for name in result["files"]))
        self.assertTrue((self.project / ".agents/skills" / entry / "SKILL.md").read_text(encoding="utf-8").startswith("# Préparer"))

    def test_field_errors_and_failed_save_leave_original(self):
        model = self.create()
        original = kit.file_map(self.source)
        model["contract"]["steps"][1]["id"] = model["contract"]["steps"][0]["id"]
        model["contract"]["steps"][1]["outputs"] = ["{missing}/note.md"]
        model["contract"]["modules"]["tasks"]["buildStep"] = "absent"
        with self.assertRaises(kit.KitError) as raised:
            kit.save(self.source, model)
        fields = {item["field"] for item in raised.exception.errors}
        self.assertIn("/contract/steps/1/id", fields)
        self.assertIn("/contract/steps/1/outputs/0", fields)
        self.assertIn("/contract/modules/tasks/buildStep", fields)
        self.assertEqual(kit.file_map(self.source), original)
        model["contract"]["steps"][0]["skill"] = "../../escape"
        with self.assertRaises(kit.KitError):
            kit.save(self.source, model)

    def test_missing_assets_and_schema_errors(self):
        model = self.create()
        model["contract"]["protocolVersion"] = 999
        result = kit.validate_model(self.source, model)
        self.assertFalse(result["valid"])
        self.assertIn("/contract/protocolVersion", [e["field"] for e in result["errors"]])
        path = self.source / ".apm/skills/demo-0-start/assets/demo.schema.json"
        path.unlink()
        self.assertFalse(kit.validate(self.source)["valid"])

    def test_zip_roundtrip_contains_only_package(self):
        self.create()
        (self.source / "secret.txt").write_text("not a package asset")
        archive = self.work / "kit.zip"
        result = kit.export_zip(self.source, archive)
        self.assertEqual(len(result["sha256"]), 64)
        with zipfile.ZipFile(archive) as z:
            self.assertNotIn("secret.txt", z.namelist())
        target = self.work / "imported"
        kit.import_zip(archive, target)
        self.assertEqual(kit.file_map(self.source, True), kit.file_map(target, True))

    def test_zip_rejects_unsafe_and_special_paths(self):
        archive = self.work / "bad.zip"
        for name in ("../escape", "/absolute", "C:/escape", ".apm\\escape", ".apm/NUL.txt",
                     ".apm/a:stream", ".apm/a."):
            with self.subTest(name=name):
                with zipfile.ZipFile(archive, "w") as z:
                    z.writestr(name, "bad")
                with self.assertRaises(kit.KitError):
                    kit.import_zip(archive, self.work / "target")
                self.assertFalse((self.work / "target").exists())
        info = zipfile.ZipInfo(".apm/link")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr(info, "../escape")
        with self.assertRaises(kit.KitError):
            kit.import_zip(archive, self.work / "target")

    def test_archive_limits_and_case_collision(self):
        archive = self.work / "bad.zip"
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr(".apm/A", "a")
            z.writestr(".apm/a", "b")
        with self.assertRaises(kit.KitError):
            kit.import_zip(archive, self.work / "target")
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr(".apm/large", "12345")
        with patch.object(kit, "MAX_FILE", 4), self.assertRaises(kit.KitError):
            kit.import_zip(archive, self.work / "target")

    def test_install_update_backup_modification_and_project_preservation(self):
        model = self.create()
        self.project.mkdir()
        (self.project / "demo.yml").write_text("client config")
        (self.project / "work").mkdir()
        (self.project / "work/note.md").write_text("client work")
        rules = self.source / ".apm/instructions"
        rules.mkdir()
        (rules / "kit.instructions.md").write_text("Kit rules")
        manifest = kit.install(self.source, self.project, {"source": {"type": "official", "id": "test-kit"}})
        self.assertEqual(manifest["source"]["type"], "official")
        self.assertEqual(kit.read_installed(self.project)["files"], manifest["files"])
        self.assertTrue((self.project / ".github/instructions/kit.instructions.md").is_file())
        installed = self.project / ".agents/skills/demo-1-write-note/SKILL.md"
        installed.write_text("local changes")
        self.assertIn(installed.relative_to(self.project).as_posix(),
                      kit.inspect_installation(self.source, self.project)["modified"])
        model["package"]["version"] = "0.1.1"
        kit.save(self.source, model)
        with self.assertRaises(kit.KitError) as raised:
            kit.install(self.source, self.project, {})
        self.assertEqual(raised.exception.code, "kit.modified")
        updated = kit.install(self.source, self.project, {"allowModified": True, "backupDir": str(self.work / "backups")})
        self.assertEqual(updated["version"], "0.1.1")
        self.assertEqual((Path(updated["backup"]) / installed.relative_to(self.project)).read_text(), "local changes")
        self.assertEqual((self.project / "demo.yml").read_text(), "client config")
        self.assertEqual((self.project / "work/note.md").read_text(), "client work")

    def test_collision_and_other_kit_refused(self):
        self.create()
        collision = self.project / ".github/agents/demo-writer.agent.md"
        collision.parent.mkdir(parents=True)
        collision.write_text("unrelated")
        with self.assertRaises(kit.KitError):
            kit.install(self.source, self.project, {"allowModified": True})
        self.assertEqual(collision.read_text(), "unrelated")
        collision.unlink()
        kit.install(self.source, self.project, {})
        manifest = self.project / kit.MANIFEST
        data = json.loads(manifest.read_text())
        data["id"] = "other-kit"
        manifest.write_text(json.dumps(data))
        with self.assertRaises(kit.KitError):
            kit.install(self.source, self.project, {})

    def test_transaction_rolls_back_failed_replace(self):
        self.project.mkdir()
        (self.project / "old").write_bytes(b"original")
        real_replace = kit.os.replace
        count = 0

        def replace(source, target):
            nonlocal count
            count += 1
            if count == 2:
                raise OSError("simulated disk failure")
            return real_replace(source, target)

        with patch.object(kit.os, "replace", replace), self.assertRaises(OSError):
            kit.transaction(self.project, {"old": b"changed", "nested/new": b"new"})
        self.assertEqual((self.project / "old").read_bytes(), b"original")
        self.assertFalse((self.project / "nested").exists())
        self.assertEqual(sorted(p.name for p in self.project.iterdir()), ["old"])

    def test_replace_retries_transient_windows_locks(self):
        self.project.mkdir()
        original = self.project / "original"
        target = self.project / "target"
        original.write_bytes(b"new")
        target.write_bytes(b"old")
        calls = 0

        def replace(source, destination):
            nonlocal calls
            calls += 1
            if calls < 3:
                self.assertEqual(target.read_bytes(), b"old")
                raise PermissionError(errno.EACCES, "simulated antivirus lock")
            # No filesystem replacement here: antivirus locks must not affect
            # this unit test's exact retry count while sleep is mocked.
            return None

        with patch.object(kit.os, "replace", replace), patch.object(kit.time, "sleep") as sleep:
            kit.replace_file(original, target)
            self.assertEqual([call.args[0] for call in sleep.call_args_list], [0.025, 0.05])
        self.assertEqual(target.read_bytes(), b"old")
        self.assertEqual(calls, 3)

    def test_replace_persists_new_bytes(self):
        self.project.mkdir()
        source = self.project / "source"
        target = self.project / "target"
        source.write_bytes(b"new")
        target.write_bytes(b"old")
        kit.replace_file(source, target)
        self.assertEqual(target.read_bytes(), b"new")
        self.assertFalse(source.exists())

    def test_replace_preserves_target_after_retry_budget_exhaustion(self):
        self.project.mkdir()
        source = self.project / "source"
        target = self.project / "target"
        source.write_bytes(b"new")
        target.write_bytes(b"old")
        with patch.object(kit.os, "replace", side_effect=PermissionError(errno.EACCES, "locked")) as replace:
            with patch.object(kit.time, "sleep"), self.assertRaises(PermissionError):
                kit.replace_file(source, target)
        self.assertEqual(replace.call_count, len(kit.REPLACE_DELAYS) + 1)
        self.assertEqual(source.read_bytes(), b"new")
        self.assertEqual(target.read_bytes(), b"old")

    def test_updates_remove_only_obsolete_owned_files(self):
        self.create()
        old_skill = self.source / ".apm/skills/demo-1-write-note/obsolete.txt"
        old_skill.write_text("old asset")
        kit.install(self.source, self.project, {})
        unrelated = self.project / ".agents/skills/demo-1-write-note/client.txt"
        unrelated.write_text("client asset")
        old_skill.unlink()
        kit.install(self.source, self.project, {})
        self.assertFalse((self.project / ".agents/skills/demo-1-write-note/obsolete.txt").exists())
        self.assertEqual(unrelated.read_text(), "client asset")

    def test_manifest_paths_and_concurrent_install_are_refused(self):
        self.create()
        with kit.mutation_lock(self.project):
            with self.assertRaises(kit.KitError) as raised:
                kit.install(self.source, self.project, {})
            self.assertEqual(raised.exception.code, "kit.busy")
        self.assertFalse((self.project / ".vibe-studio-kit.lock").exists())
        kit.install(self.source, self.project, {})
        manifest = self.project / kit.MANIFEST
        value = json.loads(manifest.read_text())
        value["files"]["../../client.txt"] = "a" * 64
        manifest.write_text(json.dumps(value))
        with self.assertRaises(kit.KitError):
            kit.install(self.source, self.project, {"allowModified": True})

    def test_configuration_schema_rejects_external_references(self):
        self.create()
        target = self.source / ".apm/skills/demo-0-start/assets/demo.schema.json"
        target.write_text(json.dumps({"$ref": "https://untrusted.invalid/schema.json"}))
        result = kit.validate(self.source)
        self.assertFalse(result["valid"])
        self.assertIn("/contract/config/schema", [error["field"] for error in result["errors"]])

    def test_approval_module_generates_script_without_overwriting_existing_content(self):
        model = self.create("blank")
        model["contract"]["modules"] = {"approvals": {
            "script": "configure/scripts/approve.py", "file": "{root}/approvals.md"}}
        kit.save(self.source, model)
        script = self.source / ".apm/skills/configure/scripts/approve.py"
        self.assertIn("record", script.read_text())
        script.write_text("# authored script")
        kit.save(self.source, model)
        self.assertEqual(script.read_text(), "# authored script")

    def test_symlink_ancestor_is_refused(self):
        self.create()
        outside = self.work / "outside"
        outside.mkdir()
        link = self.work / "linked"
        try:
            link.symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest("Creating symlinks requires platform privileges.")
        try:
            with self.assertRaises(kit.KitError):
                kit.install(self.source, link / "project", {})
        finally:
            link.unlink()

    def test_git_url_rejected_before_spawn(self):
        for value in ("--upload-pack=bad", "file:///repo", "https://user:token@host/repo", "ext::command", "git@host:repo"):
            with self.subTest(value=value), patch.object(kit.subprocess, "run") as run:
                with self.assertRaises(kit.KitError):
                    kit.import_git(value, self.work / "git")
                run.assert_not_called()

    def test_git_uses_shallow_shell_free_clone_and_validates(self):
        def clone(args, **kwargs):
            self.assertIn("--depth", args)
            self.assertIn("--no-recurse-submodules", args)
            self.assertFalse(kwargs.get("shell", False))
            shutil.copytree(kit.HERE / "kit-templates/demo", Path(args[-1]))
        with patch.object(kit.subprocess, "run", clone):
            kit.import_git("https://github.com/example/kit.git", self.work / "git")
        self.assertTrue(kit.validate(self.work / "git")["valid"])


if __name__ == "__main__":
    unittest.main()
