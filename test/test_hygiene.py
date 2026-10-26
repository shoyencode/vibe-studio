import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class GeneratedFileTests(unittest.TestCase):
    def test_generated_outputs_are_ignored_without_hiding_sources_or_fixtures(self):
        ignored = {
            ".test-core-example/demo/demo.yml",
            ".test-models-example/data/runs.json",
            ".profile-test-example/profile/preferences.json",
            "test/__pycache__/test_ci.cpython-313.pyc",
            "core/__pycache__/bridge.cpython-313.pyc",
            "dist/test-artifacts/window.png",
            "dist/installer-ui/install.log",
            "node_modules/example/package.json",
            "npm-debug.log.1",
            ".env",
            ".env.local",
        }
        retained = {
            "test/test_hygiene.py",
            "test/models.test.mjs",
            "test/fixtures/demo/apm.yml",
            "test/fixtures/demo/.apm/skills/demo-0-start/assets/vibe-studio.json",
            "test/fixtures/README.md",
            "app/renderer/logo.png",
            "app/renderer/sounds/piano-success.wav",
            ".github/workflows/ci.yml",
            ".env.example",
        }
        env = {key: value for key, value in os.environ.items()
               if key not in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE")}
        with tempfile.TemporaryDirectory() as folder:
            subprocess.run(["git", "init", "--quiet", folder], check=True, env=env, capture_output=True)
            (Path(folder) / ".gitignore").write_bytes((ROOT / ".gitignore").read_bytes())
            result = subprocess.run(["git", "-C", folder, "-c", "core.excludesFile=", "check-ignore", "--no-index", "-z", "--stdin"],
                                    input=("\0".join(sorted(ignored | retained)) + "\0").encode(),
                                    capture_output=True, env=env, check=True)
            self.assertEqual(ignored, set(filter(None, result.stdout.decode().split("\0"))))

    def test_portable_excludes_leftover_test_workspaces_and_debug_logs(self):
        script = r"""
            import assert from "node:assert/strict";
            import { readFileSync } from "node:fs";
            const source = readFileSync("scripts/package.mjs", "utf8");
            const match = source.match(/^\s*(\/\^.*profile-test.*\/),$/m);
            assert.ok(match, "Keep the isolated-workspace exclusion explicit.");
            const pattern = new RegExp(match[1].slice(1, -1));
            for (const name of ["/.test-core-example/data", "/.profile-test-example/profile"])
                assert.ok(pattern.test(name), name);
            assert.equal(pattern.test("/app/profile.mjs"), false);
            const logs = source.match(/^\s*(\/\^.*npm-debug.*\/),$/m);
            assert.ok(logs);
            const logPattern = new RegExp(logs[1].slice(1, -1));
            assert.ok(logPattern.test("/npm-debug.log"));
            assert.ok(logPattern.test("/npm-debug.log.1"));
            assert.equal(logPattern.test("/app/conversations.mjs"), false);
        """
        result = subprocess.run(["node", "--input-type=module", "-e", script], cwd=ROOT, capture_output=True, text=True)
        self.assertEqual(0, result.returncode, result.stderr)
