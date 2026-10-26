import test from "node:test";
import assert from "node:assert/strict";
import { decide, globToRegExp, prepareRules, relativeTo, tasksInProgress, writesOf, describeRules } from "../core/guards.mjs";
import { reviewDecided } from "../core/project.mjs";

const project = process.platform === "win32" ? "C:\\work\\poc-a" : "/work/poc-a";
const values = { root: "poc", sources: "poc/sources", code: "app", specification: "poc/specification.md" };
const resolve = pattern => pattern.replaceAll("{unit}", "poc/build/scenario-2").replace(/\{(\w+)\}/g, (m, name) => values[name] ?? m);
const contract = {
    steps: [{ id: "5-build", skill: "poc-5", guards: {
        readOnly: [{ id: "G11", paths: ["{unit}/plan.md"], reason: "plan read-only" }],
        requireTaskInProgress: { id: "G12", paths: ["{code}/**"], reason: "task first" },
        forbidCreate: { id: "G14", paths: ["{code}/**/*.spec.ts"], except: ["{code}/e2e/**"], reason: "no unit tests" },
        skills: { id: "G15", reason: "one skill" } } }],
    guards: {
        readOnly: [{ id: "G01", paths: ["{sources}/**"], reason: "sources read-only" }],
        scriptOnly: [{ id: "G02", paths: ["{root}/state/validations.md"], scripts: ["validations.py"], reason: "script only" }],
        secrets: { id: "G04", reason: "no secret" },
        confirmCommands: { id: "G05", commands: ["\\bgit\\s+push\\b"], reason: "confirm" },
    },
};
const rules = prepareRules(contract, contract.steps[0], resolve);
const ctx = (extra = {}) => ({ project, rules, suspended: new Set(), tasks: { inProgress: ["T01"] }, allowedSkills: { has: s => s !== "poc-6" }, ...extra });
const at = relative => `${project}${process.platform === "win32" ? "\\" : "/"}${relative.replaceAll("/", process.platform === "win32" ? "\\" : "/")}`;

test("file tools: sources, script-only files and the plan are protected; other files pass", () => {
    assert.equal(decide({ toolName: "create", toolArgs: { path: at("poc/sources/brief.docx"), file_text: "x" } }, ctx()).id, "G01");
    assert.equal(decide({ toolName: "edit", toolArgs: { path: "poc/state/validations.md", new_str: "x" } }, ctx()).id, "G02");
    assert.equal(decide({ toolName: "apply_patch", toolArgs: { input: "*** Begin Patch\n*** Update File: poc/build/scenario-2/plan.md\n+x\n*** End Patch" } }, ctx()).id, "G11");
    assert.equal(decide({ toolName: "edit", toolArgs: { path: at("poc/state.md"), new_str: "x" } }, ctx()), null);
    // Real sessions pass the patch of apply_patch as a raw string, with absolute paths.
    assert.equal(decide({ toolName: "apply_patch", toolArgs: `*** Begin Patch\n*** Add File: ${at("poc/state/validations.md")}\n+test\n*** End Patch` }, ctx()).id, "G02");
    assert.equal(decide({ toolName: "apply_patch", toolArgs: `*** Begin Patch\n*** Add File: ${at("app/front/src/b.spec.ts")}\n+x\n*** End Patch` }, ctx()).id, "G14");
    assert.equal(decide({ toolName: "apply_patch", toolArgs: "*** Begin Patch\n*** Update File: app/back/A.java\n+x\n*** End Patch" }, ctx({ tasks: { inProgress: [] } })).id, "G12");
    assert.equal(decide({ toolName: "view", toolArgs: { path: at("poc/sources/brief.docx") } }, ctx()), null, "reading is never blocked");
    assert.equal(decide({ toolName: "create", toolArgs: { path: at("poc/sources/x"), file_text: "x" } }, ctx({ suspended: new Set(["G01"]) })), null);
});

test("shell commands that write a protected path are blocked; the declared script may write its file", () => {
    assert.equal(decide({ toolName: "powershell", toolArgs: { command: "Remove-Item poc\\sources\\brief.docx" } }, ctx()).id, "G01");
    assert.equal(decide({ toolName: "powershell", toolArgs: { command: `Set-Content "${at("poc/state/validations.md")}" x` } }, ctx()).id, "G02");
    assert.equal(decide({ toolName: "powershell", toolArgs: { command: "python .agents/skills/poc-0-start/scripts/validations.py record --path poc/state/validations.md" } }, ctx()), null);
    assert.equal(decide({ toolName: "powershell", toolArgs: { command: "Get-Content poc\\sources\\brief.md" } }, ctx()), null, "reading by shell passes");
    assert.deepEqual(decide({ toolName: "powershell", toolArgs: { command: "git push origin main" } }, ctx()), { decision: "ask", id: "G05", reason: "confirm" });
});

test("build rules: a task in progress before code, no unit test file, no other skill, no secret", () => {
    assert.equal(decide({ toolName: "edit", toolArgs: { path: "app/back/A.java", new_str: "x" } }, ctx({ tasks: { inProgress: [] } })).id, "G12");
    assert.equal(decide({ toolName: "edit", toolArgs: { path: "app/back/A.java", new_str: "x" } }, ctx()), null);
    assert.equal(decide({ toolName: "create", toolArgs: { path: "app/front/src/a.spec.ts", file_text: "x" } }, ctx()).id, "G14");
    assert.equal(decide({ toolName: "create", toolArgs: { path: "app/e2e/tests/s1.spec.ts", file_text: "x" } }, ctx()), null);
    assert.equal(decide({ toolName: "edit", toolArgs: { path: "app/front/src/a.spec.ts", new_str: "x" } }, ctx()), null, "editing an existing file is not creating it");
    assert.equal(decide({ toolName: "skill", toolArgs: { skill: "poc-6" } }, ctx()).id, "G15");
    assert.equal(decide({ toolName: "skill", toolArgs: { skill: "poc-track-costs" } }, ctx()), null);
    const token = "ghp_" + "a".repeat(36);
    assert.equal(decide({ toolName: "create", toolArgs: { path: "app/x.env.example", file_text: `TOKEN=${token}` } }, ctx()).id, "G04");
    assert.equal(decide({ toolName: "create", toolArgs: { path: "app/README.md", file_text: "password: <set me>" } }, ctx()), null);
});

test("sub-agents of a review only read", () => {
    const review = { steps: [{ id: "6-review", skill: "poc-6", guards: { subagentsReadOnly: { id: "G16", reason: "read only" } } }] };
    const reviewRules = prepareRules(review, review.steps[0], resolve);
    assert.equal(decide({ toolName: "edit", toolArgs: { path: "app/a.ts" }, agentId: "reviewer-1" }, ctx({ rules: reviewRules })).id, "G16");
    assert.equal(decide({ toolName: "edit", toolArgs: { path: "poc/build/scenario-2/review.md" } }, ctx({ rules: reviewRules })), null, "the review step itself writes");
});

test("helpers", () => {
    assert.equal(globToRegExp("app/**").test("app"), true);
    assert.equal(globToRegExp("app/**/*.spec.ts").test("app/a.spec.ts"), true);
    assert.equal(relativeTo(project, at("poc/a.md")), "poc/a.md");
    assert.equal(relativeTo(project, process.platform === "win32" ? "C:\\other\\a.md" : "/other/a.md"), null);
    assert.deepEqual(writesOf("apply_patch", { input: "*** Add File: a.md\n+x\n*** Delete File: b.md" }).files, ["a.md", "b.md"]);
    assert.deepEqual(tasksInProgress("- [x] T01 a\n- [~] **T02** b\n  - [~] R03 c\n"), ["T02", "R03"]);
    assert.deepEqual(describeRules(contract, contract.steps[0]).map(r => `${r.scope}:${r.id}`),
        ["permanent:G01", "permanent:G02", "permanent:G04", "permanent:G05", "step:G11", "step:G12", "step:G14", "step:G15"]);
    assert.equal(reviewDecided("Review round: 1\n\n## Findings\n\n| Id | Finding | Decision |\n| --- | --- | --- |\n| R01 | x | fix |\n"), true);
    assert.equal(reviewDecided("Review round: 1\n\n## Constats\n\n| Id | Constat | Décision |\n|---|---|---|\n| R01 | x |  |\n"), false);
});
