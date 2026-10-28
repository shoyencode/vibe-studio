// Regenerates the application screenshots of the website (site/public/screenshots/<lang>/*.png).
// It drives the real desktop interface with the fake harness of the smoke tests and the fictional demo kit:
// no AI request, no real profile, no client data. A capture fails if it shows the Windows user name or a local path.
import { createRequire } from "node:module";
import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { t } from "../core/i18n.mjs";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "site", "public", "screenshots");
const forbidden = [os.userInfo().username, os.homedir(), os.tmpdir()].filter(value => value && value.length > 2).map(value => value.toLowerCase());

const text = {
    en: {
        project: "Demo mission", kitName: "Accessibility audit",
        message: "I read the scoping note and the client sources.\n\n**Plan for this topic**\n\n1. List the pages of the sample.\n2. Check contrast, keyboard navigation and alternative texts.\n3. Write the findings in `findings.md`.",
        question: "Which pages are in the audit sample?", choices: ["Home and checkout", "The full site map"],
        tasks: [["Read the mission", "done"], ["Propose the journey", "doing"], ["Write step instructions", "todo"]],
        proposals: [
            { kind: "kit", summary: "Describe the kit for its users.", description: "A guided accessibility audit, from scoping to the final report." },
            { kind: "step.add", summary: "Agree on the scope before analysing.", title: "Scope the audit", description: "Collects the scope, sample and standards with the client.",
                result: "A scoping note approved by the client.", produces: ["scoping-note.md"], approval: true, instructions: "1. Ask for the site, the sample and the target standard.\n2. Write the scoping note.\n3. Ask the user to approve it." },
            { kind: "step.add", summary: "Analyse each page of the sample.", title: "Analyse a page", description: "Checks one page against the standard.", repeat: true,
                uses: ["scoping-note.md"], produces: ["findings.md"], result: "Findings with severity and fix." },
            { kind: "step.add", summary: "Write the report from the findings.", title: "Write the report", uses: ["findings.md"], produces: ["report.md"], approval: true, result: "A prioritised report." },
            { kind: "rule.add", summary: "Never write secrets.", rule: "secrets", description: "No secret written in the project." },
        ],
        translations: [["kit.name", "Audit d’accessibilité"], ["kit.description", "Un audit d’accessibilité guidé, du cadrage au rapport final."]],
        target: "fr",
    },
    fr: {
        project: "Mission de démonstration", kitName: "Audit d’accessibilité",
        message: "J’ai lu la note de cadrage et les sources du client.\n\n**Plan pour ce thème**\n\n1. Lister les pages de l’échantillon.\n2. Vérifier le contraste, la navigation au clavier et les textes alternatifs.\n3. Écrire les constats dans `constats.md`.",
        question: "Quelles pages font partie de l’échantillon ?", choices: ["Accueil et paiement", "Le plan du site complet"],
        tasks: [["Lire la mission", "done"], ["Proposer le parcours", "doing"], ["Rédiger les instructions", "todo"]],
        proposals: [
            { kind: "kit", summary: "Présenter le kit à ses utilisateurs.", description: "Un audit d’accessibilité guidé, du cadrage au rapport final." },
            { kind: "step.add", summary: "Cadrer avant d’analyser.", title: "Cadrer l’audit", description: "Recueille le périmètre, l’échantillon et le référentiel avec le client.",
                result: "Une note de cadrage validée par le client.", produces: ["note-de-cadrage.md"], approval: true, instructions: "1. Demander le site, l’échantillon et le référentiel visé.\n2. Rédiger la note de cadrage.\n3. Demander sa validation." },
            { kind: "step.add", summary: "Analyser chaque page de l’échantillon.", title: "Analyser une page", description: "Vérifie une page par rapport au référentiel.", repeat: true,
                uses: ["note-de-cadrage.md"], produces: ["constats.md"], result: "Des constats avec gravité et correction." },
            { kind: "step.add", summary: "Rédiger le rapport à partir des constats.", title: "Rédiger le rapport", uses: ["constats.md"], produces: ["rapport.md"], approval: true, result: "Un rapport priorisé." },
            { kind: "rule.add", summary: "Ne jamais écrire de secret.", rule: "secrets", description: "Aucun secret écrit dans le projet." },
        ],
        translations: [["kit.name", "Accessibility audit"], ["kit.description", "A guided accessibility audit, from scoping to the final report."]],
        target: "en",
    },
};

async function capture(lang) {
    const say = (key, vars) => t(lang, key, vars), copy = text[lang];
    const base = await realpath(await mkdtemp(path.join(os.tmpdir(), "vibe-studio-site-shots-")));
    const project = path.join(base, "project"), appData = path.join(base, "appdata"), kits = path.join(base, "kits");
    await cp(path.join(root, "test", "fixtures", "demo"), project, { recursive: true });
    await writeFile(path.join(project, "demo.yml"), `project:\n  name: ${copy.project}\n  language: ${lang}\npaths:\n  root: work\n`);
    await mkdir(path.join(project, "work"), { recursive: true });
    await mkdir(path.join(appData, "Vibe Studio"), { recursive: true });
    await mkdir(kits);
    await writeFile(path.join(appData, "Vibe Studio", "preferences.json"), JSON.stringify({ theme: "dark", sound: false, notifications: false }));
    const folder = path.join(output, lang);
    await mkdir(folder, { recursive: true });
    let desktop;
    try {
        desktop = await _electron.launch({ executablePath: require("electron"), args: [path.join(root, "scripts", "smoke-entry.mjs")],
            env: { ...process.env, VIBE_STUDIO_SMOKE_PROJECT: project, VIBE_STUDIO_SMOKE_APPDATA: appData }, timeout: 60000 });
        const page = await desktop.firstWindow();
        page.setDefaultTimeout(30000);
        await page.setViewportSize({ width: 1280, height: 800 });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        const shoot = async name => {
            await page.waitForTimeout(400);
            const visible = (await page.evaluate(() => document.body.innerText)).toLowerCase();
            const leak = forbidden.find(value => visible.includes(value));
            if (leak) throw new Error(`Screenshot ${lang}/${name} would show a local path or user name.`);
            await page.screenshot({ path: path.join(folder, `${name}.png`) });
            console.log(`${lang}/${name}.png`);
        };
        const session = () => desktop.evaluate(() => [...globalThis.smoke.sessions.values()].at(-1).sessionId);
        const emit = (event) => desktop.evaluate((_electron, event) => [...globalThis.smoke.sessions.values()].at(-1).options.onEvent(event), event);
        const nav = name => page.locator("#navigation").getByRole("button", { name, exact: true }).click();

        // Journey and conversation with a running step and a question from the AI.
        await page.getByRole("heading", { name: say("space.journey"), exact: true }).waitFor();
        await page.locator(".register-current .primary").first().click();
        await page.locator("dialog").getByRole("button", { name: say("launch.confirm"), exact: true }).click();
        await page.getByRole("heading", { name: say("space.conversation"), exact: true }).waitFor();
        await emit({ type: "session.usage_info", id: "c1", data: { tokenLimit: 200000, currentTokens: 18400 } });
        await emit({ type: "assistant.usage", id: "u1", data: { model: "claude-sonnet-5.5", inputTokens: 21400, outputTokens: 1800, cacheReadTokens: 9000 } });
        await emit({ type: "assistant.message", id: "m1", data: { messageId: "m1", content: copy.message } });
        const sessionId = await session();
        await desktop.evaluate((_electron, input) => {
            globalThis.smoke.siteQuestion = globalThis.smoke.harness.ui.question({ sessionId: input.sessionId, request: { question: input.question, choices: input.choices } });
        }, { sessionId, question: copy.question, choices: copy.choices });
        await page.getByText(copy.question, { exact: true }).waitFor();
        await shoot("conversation");
        await nav(say("space.journey"));
        await page.locator('[data-indicator="questions"].indicator-attention').waitFor();
        await shoot("journey");
        await page.locator('[data-indicator="questions"]').click();
        await page.getByRole("button", { name: copy.choices[0], exact: true }).click();
        await emit({ type: "session.idle", id: "idle-1", data: {} });

        // Kit workshop: mission, preparation, review, summary, translation, kit page.
        await desktop.evaluate(({ dialog }, kits) => {
            globalThis.smoke.selection = [kits];
            dialog.showMessageBox = async () => ({ response: 1 });
        }, kits);
        await page.locator("#project").click();
        await nav(say("author.workshop"));
        await page.getByRole("heading", { name: say("ws.createTitle"), exact: true }).waitFor();
        await page.getByRole("button", { name: say("ws.example.audit"), exact: true }).click();
        await page.getByLabel(say("ws.kitName"), { exact: true }).fill(copy.kitName);
        await shoot("workshop-start");
        await page.getByText(say("ws.options")).click();
        await page.getByRole("group", { name: say("ws.location") }).getByRole("button", { name: say("ws.change"), exact: true }).click();
        await page.locator(".ws-path", { hasText: kits }).waitFor();
        await page.getByRole("button", { name: say("ws.prepare"), exact: true }).click();
        await page.getByRole("heading", { name: say("ws.preparingTitle"), exact: true }).waitFor();
        await desktop.evaluate((_electron, tasks) => [...globalThis.smoke.sessions.values()].at(-1).options.tools
            .find(tool => tool.name === "vibe_studio_progress").handler({ tasks: tasks.map(([label, status]) => ({ label, status })) }), copy.tasks);
        await page.getByText(copy.tasks[1][0], { exact: true }).waitFor();
        await shoot("workshop-preparing");
        const propose = proposals => desktop.evaluate(async (_electron, proposals) => {
            const handle = [...globalThis.smoke.sessions.values()].at(-1);
            const result = await handle.options.tools.find(tool => tool.name === "vibe_studio_propose").handler({ proposals });
            handle.options.onEvent({ type: "session.idle", id: `idle-${Date.now()}`, data: {} });
            return result;
        }, proposals);
        await propose(copy.proposals);
        await page.getByRole("heading", { name: say("ws.reviewTitle"), exact: true }).waitFor();
        await page.getByRole("button", { name: say("ws.accept"), exact: true }).click();
        await page.getByText(say("ws.reviewCount", { n: 2, total: copy.proposals.length }), { exact: true }).waitFor();
        await shoot("workshop-review");
        for (let n = 2; n <= copy.proposals.length; n++) {
            await page.getByText(say("ws.reviewCount", { n, total: copy.proposals.length }), { exact: true }).waitFor();
            await page.getByRole("button", { name: say("ws.accept"), exact: true }).click();
        }
        await page.getByRole("heading", { name: say("ws.summaryTitle"), exact: true }).waitFor();
        await shoot("workshop-summary");
        await page.getByRole("button", { name: say("ws.prepareTranslation"), exact: true }).click();
        for (let attempt = 0; attempt < 100; attempt++) {
            if (/Translate these kit texts/.test(await desktop.evaluate(() => globalThis.smoke.sent.at(-1)?.prompt || ""))) break;
            await page.waitForTimeout(100);
        }
        await propose(copy.translations.map(([key, value]) => ({ kind: "translation", summary: key, language: copy.target, key, text: value })));
        await page.getByRole("heading", { name: say("ws.reviewTranslationTitle"), exact: true }).waitFor();
        await shoot("workshop-translation");
        await page.getByRole("button", { name: say("ws.acceptAllTranslations"), exact: true }).click();
        await page.getByRole("heading", { name: say("ws.summaryTitle"), exact: true }).waitFor();
        await page.getByRole("button", { name: say("ws.openKit"), exact: true }).click();
        await page.getByRole("navigation", { name: say("ws.outline") }).getByRole("button", { name: copy.proposals[1].title }).click();
        await page.getByRole("heading", { name: copy.proposals[1].title, exact: true }).waitFor();
        await shoot("workshop-kit");
        if (errors.length) throw new Error(errors.join("\n"));
    } finally {
        if (desktop) await desktop.close();
        await rm(base, { recursive: true, force: true });
    }
}

for (const lang of ["en", "fr"]) await capture(lang);
console.log("Screenshots written to", path.relative(root, output));
