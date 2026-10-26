import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

import yaml


ROOT = Path(__file__).resolve().parents[1]


class GitHubCiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = yaml.load((ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8"), Loader=yaml.BaseLoader)

    def test_github_is_the_only_repository_ci_with_read_only_permissions(self):
        self.assertFalse((ROOT / ".gitlab-ci.yml").exists())
        events = self.workflow["on"]
        self.assertEqual({"main", "master"}, set(events["push"]["branches"]))
        self.assertEqual(["v*"], events["push"]["tags"])
        self.assertIn("pull_request", events)
        self.assertIn("workflow_dispatch", events)
        self.assertEqual({"contents": "read"}, self.workflow["permissions"])

    def test_both_platforms_gate_the_hosted_windows_distribution(self):
        jobs = self.workflow["jobs"]
        self.assertEqual({"ubuntu-latest", "windows-latest"}, set(jobs["checks"]["strategy"]["matrix"]["os"]))
        self.assertEqual("checks", jobs["windows-distribution"]["needs"])
        self.assertEqual("windows-latest", jobs["windows-distribution"]["runs-on"])
        steps = jobs["windows-distribution"]["steps"]
        commands = [step["run"].strip() for step in steps if "run" in step]
        for command in ("npm run test:smoke", "npm run installer:tools", "npm run package:installer",
                        "npm run test:portable", "npm run test:installer"):
            self.assertIn(command, commands)
        self.assertTrue(any("VIBE_STUDIO_SMOKE_APP" in command and command.endswith("npm run test:smoke") for command in commands))
        for command in commands:
            self.assertLessEqual(sum(line.strip().startswith("npm ") for line in command.splitlines()), 1,
                                 "A successful later command must not hide an earlier failure on PowerShell.")
        artifact = next(step["with"] for step in steps if step.get("uses", "").startswith("actions/upload-artifact@"))
        self.assertEqual("error", artifact["if-no-files-found"])
        self.assertIn("Vibe-Studio-Setup-*-x64.exe", artifact["path"])
        self.assertIn("Vibe-Studio-*-win32-x64.zip", artifact["path"])
        self.assertFalse(any("release create" in command or "git push" in command for command in commands))

    def test_version_guard_accepts_matching_tags_and_rejects_mismatches(self):
        steps = self.workflow["jobs"]["checks"]["steps"]
        script = next(step["run"] for step in steps if step.get("name") == "Check version metadata")
        self.assertTrue(script.strip().startswith("node --input-type=module -e '"))
        javascript = script.split("node --input-type=module -e '", 1)[1].rsplit("'", 1)[0]
        with tempfile.TemporaryDirectory() as folder:
            directory = Path(folder)
            (directory / "package.json").write_text(json.dumps({"version": "2.1.1"}), encoding="utf-8")
            lock = {"version": "2.1.1", "packages": {"": {"version": "2.1.1"}}}
            def run(tag, lockfile):
                (directory / "package-lock.json").write_text(json.dumps(lockfile), encoding="utf-8")
                return subprocess.run(["node", "--input-type=module", "-e", javascript], cwd=directory,
                                      env={**os.environ, "GITHUB_REF_TYPE": "tag", "GITHUB_REF_NAME": tag},
                                      capture_output=True, text=True)
            self.assertEqual(0, run("v2.1.1", lock).returncode)
            mismatch = run("v2.2.0", lock)
            self.assertNotEqual(0, mismatch.returncode)
            self.assertIn("release tag must match", mismatch.stderr)
            mismatch = run("v2.1.1", {**lock, "version": "2.0.0"})
            self.assertNotEqual(0, mismatch.returncode)
            self.assertIn("lockfile versions differ", mismatch.stderr)
