import { createRequire } from "node:module";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { _electron } = require("playwright-core");
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const packaged = process.env.VIBE_STUDIO_SMOKE_APP;
const executable = process.env.VIBE_STUDIO_SMOKE_EXECUTABLE || require("electron");
const artifacts = process.env.VIBE_STUDIO_SMOKE_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
const screenshot = name => artifacts ? page.screenshot({ path: path.join(artifacts, name) }) : Promise.resolve();
const base = await mkdtemp(path.join(os.tmpdir(), "vibe-studio-smoke-"));
const project = path.join(base, "project"), appData = path.join(base, "appdata"), data = path.join(appData, "Vibe Studio");
await cp(path.join(repo, "test", "fixtures", "demo"), project, { recursive: true });
await mkdir(data, { recursive: true });
await writeFile(path.join(data, "preferences.json"), JSON.stringify({ theme: "light", sound: false, notifications: false }));
await writeFile(path.join(data, "projects.json"), JSON.stringify([{ dir: project, title: "Existing Vibe Studio project" }]));
await writeFile(path.join(project, "demo.yml"), "project:\n  name: Essai des retours\n  language: fr\npaths:\n  root: work\n");
await mkdir(path.join(project, "work"), { recursive: true });
await writeFile(path.join(project, "work", "note.md"), "# Note de cadrage\n\n" + "Un document lisible sur toute la largeur. ".repeat(20));
const contractFile = path.join(project, ".apm", "skills", "demo-0-start", "assets", "vibe-studio.json");
const contract = JSON.parse(await readFile(contractFile, "utf8"));
contract.modelPolicies = { default: { default: "claude-sonnet-5.5", models: ["claude-sonnet-5.5", "gpt-6-luna"] } };
contract.units.catalog = { script: "demo-0-start/scripts/list_units.py" };
contract.modules.sources = { folder: "client", inventory: "{root}/inventory.json" };
contract.modules.costs = { script: "demo-0-start/scripts/smoke_costs.py" };
contract.steps.find(step => step.id === "2-explore-topic").approves = [];
await writeFile(contractFile, JSON.stringify(contract));
const costReport = path.join(project, "work", "smoke-costs.json"), costReads = path.join(project, "work", "smoke-cost-reads.txt");
const report = { generated_at: "2026-10-23T12:00:00Z", sessions: [{ id: "fixture" }], total: { usage: { credits: 12.5 } },
    rows: [{ phase: "2-explore-topic", scenario: 5, authors: ["fixture"], usage: { credits: 12.5, input_tokens: 100,
        output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0 }, models_observed: ["claude-sonnet-5.5"], method: "marks" }] };
await writeFile(costReport, JSON.stringify(report));
await writeFile(path.join(project, ".apm", "skills", "demo-0-start", "scripts", "smoke_costs.py"),
    'import json, pathlib, sys\nroot = pathlib.Path(sys.argv[sys.argv.index("--project") + 1]) / "work"\n'
    + 'if sys.argv[1] == "report":\n with (root / "smoke-cost-reads.txt").open("a") as f: f.write("read\\n")\n print((root / "smoke-costs.json").read_text())\n'
    + 'else: print("{}")\n');
await writeFile(path.join(project, ".apm", "skills", "demo-0-start", "scripts", "list_units.py"),
    'import json\nprint(json.dumps({"units":[{"id":4,"title":"Analyse des contrats"},{"id":5,"title":"Accès clients"}]}))\n');
await mkdir(path.join(project, "client"), { recursive: true });
await writeFile(path.join(project, "client", "Client source.pdf"), "%PDF-1.7 synthetic fixture\n");
await writeFile(path.join(project, "work", "converted.md"), "# Converted source\n");
await writeFile(path.join(project, "work", "inventory.json"), JSON.stringify({
    sources: [{ path: "Client source.pdf", type: "pdf", converted: "converted.md", chars: 19 }],
}));
const png = path.join(base, "capture.png"), text = path.join(base, "document.txt"), dropped = path.join(base, "native-drop.txt");
await writeFile(png, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6QAAAABJRU5ErkJggg==", "base64"));
await writeFile(text, "Document joint");
await writeFile(dropped, "Document glissé depuis Windows");
let electron, page;
const checks = [];
const until = async predicate => {
    for (let i = 0; i < 200; i++) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 50)); }
    throw new Error("The expected desktop state did not arrive.");
};
try {
    electron = await _electron.launch({
        executablePath: executable,
        args: [path.join(here, "smoke-entry.mjs")],
        env: { ...process.env, VIBE_STUDIO_SMOKE_PROJECT: project, VIBE_STUDIO_SMOKE_APPDATA: appData,
            ...(packaged ? { VIBE_STUDIO_SMOKE_APP: packaged } : {}) },
        timeout: 60000,
    });
    page = await electron.firstWindow();
    assert.equal(await page.title(), "Vibe Studio");
    assert.equal(await electron.evaluate(({ app }) => app.getPath("userData")), data);
    assert.equal(await electron.evaluate(({ app }) => app.getName()), "Vibe Studio");
    if (process.platform === "win32") assert.equal(await electron.evaluate(() => globalThis.smoke.appId), "VibeStudio.Desktop");
    const pngBase64 = await electron.evaluate(({ nativeImage }) => nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4, 220), { width: 16, height: 16 }).toPNG().toString("base64"));
    await writeFile(png, Buffer.from(pngBase64, "base64"));
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.getByRole("heading", { name: "Parcours", exact: true }).waitFor();
    await page.getByText("Thème 4 · Analyse des contrats", { exact: true }).first().waitFor();
    assert.equal(await page.locator(".brand").count(), 0);
    assert.equal(await page.getByRole("button", { name: /4 · Analyse des contrats$/ }).innerText(), "Thème 4 · Analyse des contrats");
    checks.push("scenario title and removed brand");
    const nav = name => page.locator("nav").getByRole("button", { name, exact: true }).click();
    const checkIconSpacing = async () => {
        const crowded = await page.evaluate(() => [...document.querySelectorAll(".icon, .status-icon, .spinner, .attention, .app-dot, .brand img")].flatMap(icon => {
            const parent = icon.parentElement, style = getComputedStyle(parent);
            if (!parent.textContent.trim() || !["flex", "inline-flex"].includes(style.display)) return [];
            return parseFloat(style.columnGap) >= 6 ? [] : [parent.className];
        }));
        assert.deepEqual(crowded, [], "visible icons keep at least 6px from their neighbouring label");
    };
    const checkJourneyContrast = async () => {
        const failures = await page.evaluate(() => {
            const canvas = new OffscreenCanvas(1, 1), context = canvas.getContext("2d", { willReadFrequently: true });
            const rgba = color => {
                context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
                return [...context.getImageData(0, 0, 1, 1).data].map((value, i) => i === 3 ? value / 255 : value);
            };
            const luminance = color => color.slice(0, 3).map(value => {
                const c = value / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
            }).reduce((total, value, i) => total + value * [.2126, .7152, .0722][i], 0);
            return [...document.querySelectorAll(".journey-summary, .indicator-label, .indicator-cell strong, .register-date, .status-badge, .register-body small, .register .primary")].flatMap(node => {
                const ancestors = []; for (let parent = node; parent; parent = parent.parentElement) ancestors.unshift(parent);
                let background = [255, 255, 255];
                for (const parent of ancestors) {
                    const color = rgba(getComputedStyle(parent).backgroundColor);
                    background = background.map((value, i) => color[i] * color[3] + value * (1 - color[3]));
                }
                const foreground = rgba(getComputedStyle(node).color), a = luminance(foreground), b = luminance(background);
                const ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
                return ratio >= 4.5 ? [] : [{ text: node.textContent, ratio }];
            });
        });
        assert.deepEqual(failures, []);
    };
    await page.getByRole("group", { name: "État en direct", exact: true }).waitFor();
    assert.equal(await page.locator(".indicator-cell").count(), 4);
    await page.waitForFunction(() => document.querySelector('[data-indicator="costs"]').textContent.includes("13 crédits"));
    assert.equal((await readFile(costReads, "utf8")).trim(), "read", "costs load once on opening the project");
    await page.locator("#refresh").click();
    await page.waitForFunction(() => !document.querySelector("#refresh").hasAttribute("aria-busy"));
    assert.equal((await readFile(costReads, "utf8")).trim(), "read", "snapshot refresh does not poll the cost script");
    assert.equal(await page.locator(".journey .focus-card, .eyebrow").count(), 0);
    assert.equal(await page.locator(".register-current").count(), 1);
    assert.equal(await page.locator(".register-current .primary").count(), 1);
    await checkJourneyContrast();
    await checkIconSpacing();
    await screenshot("vibe-studio-journey-light.png");
    const journeyLayout = async () => page.evaluate(() => {
        const main = document.querySelector("main"), scroll = document.querySelector(".journey-scroll");
        const row = document.querySelector(".register-entry"), date = row.querySelector(".register-date"), body = row.querySelector(".register-body");
        return { mainWidth: main.clientWidth, mainScroll: main.scrollWidth, registerWidth: scroll.clientWidth, registerScroll: scroll.scrollWidth,
            thin: getComputedStyle(scroll).scrollbarWidth, dateAbove: date.getBoundingClientRect().bottom <= body.getBoundingClientRect().top,
            scrollable: scroll.scrollHeight > scroll.clientHeight };
    });
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(820, 720));
    await page.waitForFunction(() => innerWidth <= 820);
    const narrowJourney = await journeyLayout();
    assert.ok(narrowJourney.mainScroll <= narrowJourney.mainWidth && narrowJourney.registerScroll <= narrowJourney.registerWidth, JSON.stringify(narrowJourney));
    assert.equal(narrowJourney.thin, "thin");
    assert.equal(narrowJourney.dateAbove, true);
    assert.equal(narrowJourney.scrollable, true);
    await screenshot("vibe-studio-journey-narrow.png");
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 860));
    await page.locator('[data-indicator="guards"]').click();
    await page.getByRole("button", { name: "Garde-fous", exact: true }).waitFor();
    await nav("Parcours");
    await page.locator('[data-indicator="costs"]').click();
    await page.getByRole("button", { name: "Lire le dernier relevé", exact: true }).click();
    await until(async () => (await readFile(costReads, "utf8")).trim().split(/\r?\n/).length === 2);
    await page.getByText("Total du rapport : 12,5 crédits.", { exact: true }).waitFor();
    await page.getByRole("cell", { name: "Thème 5 · Accès clients", exact: true }).waitFor();
    assert.equal(await page.getByRole("columnheader", { name: "Étape", exact: true }).count(), 1);
    await screenshot("vibe-studio-costs.png");
    await nav("Parcours");
    assert.match(await page.locator('[data-indicator="costs"]').innerText(), /13 crédits/);
    assert.deepEqual((await readFile(costReads, "utf8")).trim().split(/\r?\n/), ["read", "read"]);
    await writeFile(costReport, JSON.stringify({ ...report, total: { usage: { credits: 0 } } }));
    await nav("Coûts");
    await page.getByRole("button", { name: "Lire le dernier relevé", exact: true }).click();
    await page.getByText("Total du rapport : 0 crédits.", { exact: true }).waitFor();
    await nav("Parcours");
    assert.match(await page.locator('[data-indicator="costs"]').innerText(), /0 crédits/);
    await writeFile(costReport, JSON.stringify({ ...report, sessions: [] }));
    await nav("Coûts");
    await page.getByRole("button", { name: "Lire le dernier relevé", exact: true }).click();
    await page.getByText("Aucune session reconnue : consommation inconnue, et non nulle.", { exact: true }).waitFor();
    await nav("Parcours");
    assert.match(await page.locator('[data-indicator="costs"]').innerText(), /Non relevée/);
    checks.push("live strip, single current register row, 820px wrapping and automatic initial cost reading without polling (including zero and unknown)");
    await nav("Réglages");
    await page.getByRole("button", { name: "Projet et kit", exact: true }).click();
    const languageSelect = page.locator('select[data-path="project.language"]');
    assert.deepEqual(await languageSelect.locator("option").allTextContents(), ["Français", "English"]);
    assert.equal(await languageSelect.inputValue(), "fr");
    await page.getByRole("button", { name: "Réglages personnels", exact: true }).click();
    await page.getByLabel("Thème de l’application", { exact: true }).selectOption("dark");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(31, 35, 40)");
    await nav("Parcours");
    const darkJourney = await journeyLayout();
    assert.ok(darkJourney.mainScroll <= darkJourney.mainWidth && darkJourney.registerScroll <= darkJourney.registerWidth, JSON.stringify(darkJourney));
    await checkJourneyContrast();
    await screenshot("vibe-studio-journey-dark.png");
    await nav("Réglages");
    await page.getByLabel("Thème de l’application", { exact: true }).selectOption("light");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    await page.getByRole("button", { name: "Alertes", exact: true }).click();
    const soundChoice = page.getByLabel("Note sonore", { exact: true }), originalSound = await soundChoice.inputValue();
    for (const theme of ["arcade", "orbital", "telegraph", "analogNoir", "piano", "guitar"]) {
        await soundChoice.selectOption(theme);
        await until(async () => JSON.parse(await readFile(path.join(data, "preferences.json"), "utf8")).soundTheme === theme);
        await until(() => soundChoice.isEnabled());
    }
    const audioChecks = await page.evaluate(async () => {
        const { SOUND_THEMES, scheduleSound, scheduleRecordedSound } = await import("/app.mjs"), results = [];
        if (SOUND_THEMES.alchemy || SOUND_THEMES.crystal) throw new Error("Rejected theme must not be installed");
        for (const theme of ["arcade", "orbital", "telegraph", "analogNoir"]) {
            const sound = SOUND_THEMES[theme];
            if (JSON.stringify(sound.notes.reply) !== JSON.stringify(sound.notes.ended)) throw new Error("Replies must reuse the approved success sound");
            for (const kind of ["ask", "ended", "failed"]) {
                const audio = new OfflineAudioContext(1, 44100, 44100);
                scheduleSound(audio, sound, kind);
                const buffer = await audio.startRendering();
                let peak = 0;
                for (const sample of buffer.getChannelData(0)) peak = Math.max(peak, Math.abs(sample));
                results.push({ theme, kind, peak, duration: .02 + (sound.notes[kind].length - 1) * sound.step + sound.length + .05 });
            }
        }
        for (const theme of ["piano", "guitar"]) {
            const sound = SOUND_THEMES[theme];
            if (sound.files.reply !== sound.files.ended) throw new Error("Recorded replies must reuse the approved success clip");
            for (const kind of ["ask", "ended", "failed"]) {
                const response = await fetch(new URL(sound.files[kind], location.href));
                if (!response.ok || response.headers.get("content-type") !== "audio/wav") throw new Error("Bundled recorded clip is unavailable");
                const decoder = new OfflineAudioContext(2, 1, 44100), buffer = await decoder.decodeAudioData(await response.arrayBuffer());
                const audio = new OfflineAudioContext(2, buffer.length, 44100);
                scheduleRecordedSound(audio, buffer, sound.gain);
                const rendered = await audio.startRendering();
                let peak = 0;
                for (let channel = 0; channel < rendered.numberOfChannels; channel++)
                    for (const sample of rendered.getChannelData(channel)) peak = Math.max(peak, Math.abs(sample));
                results.push({ theme, kind, peak, duration: buffer.duration, recorded: true });
            }
        }
        return results;
    });
    assert.equal(audioChecks.length, 18);
    for (const check of audioChecks) assert.ok(check.peak > 0 && check.peak < (check.recorded ? .4 : .25) && check.duration < (check.recorded ? 2 : 1), JSON.stringify(check));
    await soundChoice.selectOption(originalSound);
    await until(async () => JSON.parse(await readFile(path.join(data, "preferences.json"), "utf8")).soundTheme === originalSound);
    checks.push("all four approved sound trios persist, synthesize non-silent unclipped subsecond audio, reuse success for replies and leave the original selection intact");
    checks.push("both approved recorded piano/guitar trios load offline from bundled WAV files and play non-silent unclipped stereo audio with the real playback path");
    await page.getByRole("button", { name: "Harness", exact: true }).click();
    await page.getByRole("button", { name: "Vérifier la connexion", exact: true }).waitFor();
    if (process.platform === "win32") assert.equal(await page.getByRole("button", { name: /^Se connecter à / }).count(), 4);
    assert.ok((await page.locator(".harness-list").innerText()).includes("gh auth login --hostname github.com --web"));
    await page.getByRole("button", { name: "Vérifier la connexion", exact: true }).click();
    await page.getByText(/connecté.*smoke/i).first().waitFor();
    await checkIconSpacing();
    checks.push("all harnesses expose sign-in actions, Copilot login command and connection retry");
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(255, 255, 255)");
    assert.equal(JSON.parse(await readFile(path.join(data, "preferences.json"))).theme, "light");
    const saved = await page.evaluate(async () => {
        const responses = await Promise.all([
            window.vibeStudio.call("/preferences", { approveAll: true }),
            window.vibeStudio.call("/preferences", { theme: "system" }),
        ]);
        for (const response of responses) if (response.error) throw new Error(response.error);
        return (await window.vibeStudio.call("/preferences")).result;
    });
    assert.equal(saved.approveAll, true);
    assert.equal(saved.theme, "system");
    assert.deepEqual(JSON.parse(await readFile(path.join(data, "preferences.json"))), saved);
    await page.evaluate(() => window.vibeStudio.call("/preferences", { approveAll: false, theme: "light" }));
    assert.equal(await page.getByRole("button", { name: "Garde-fous", exact: true }).count(), 0);
    await page.getByRole("button", { name: "Projet et kit", exact: true }).click();
    await page.getByRole("button", { name: "Garde-fous", exact: true }).waitFor();
    checks.push("theme applied, persisted and settings scopes separated");
    await nav("Sources client");
    const sourceRow = page.getByRole("row").filter({ has: page.getByRole("button", { name: /Ouvrir l’original/ }) });
    const sourceActions = sourceRow.locator(".document-actions");
    const positions = await sourceActions.locator("button").evaluateAll(nodes => nodes.map(node => {
        const rect = node.getBoundingClientRect(); return { top: rect.top, height: rect.height };
    }));
    assert.equal(positions.length, 3);
    assert.ok(positions.every(position => Math.abs(position.top - positions[0].top) < 1 && position.height <= 32), JSON.stringify(positions));
    await sourceRow.getByRole("button", { name: /Ouvrir l’original/ }).click();
    await until(() => electron.evaluate(() => globalThis.smoke.opened.at(-1)?.endsWith("Client source.pdf")));
    assert.equal(await electron.evaluate(() => globalThis.smoke.opened.at(-1)), path.join(project, "client", "Client source.pdf"));
    await sourceRow.getByRole("button", { name: /Ouvrir le fichier/ }).click();
    await until(() => electron.evaluate(() => globalThis.smoke.opened.at(-1)?.endsWith("converted.md")));
    assert.equal(await electron.evaluate(() => globalThis.smoke.opened.at(-1)), path.join(project, "work", "converted.md"));
    await screenshot("vibe-studio-source-actions.png");
    checks.push("compact inline source actions open original and converted files separately");
    await nav("Livrables");
    const noteRow = page.getByRole("row").filter({ hasText: "work/note.md" });
    await noteRow.getByRole("button", { name: /Valider work\/note.md/ }).click();
    await page.locator("dialog").getByRole("button", { name: "Valider", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("#notice").textContent.includes("work/note.md"));
    await page.waitForFunction(() => !document.querySelector("#notice").textContent, { timeout: 8000 });
    await noteRow.getByRole("button", { name: /Ouvrir le fichier/ }).click();
    await until(() => electron.evaluate(() => globalThis.smoke.opened.at(-1)?.endsWith("note.md")));
    assert.equal(await electron.evaluate(() => globalThis.smoke.opened.at(-1)), path.join(project, "work", "note.md"));
    await noteRow.getByRole("button", { name: /Lire work\/note.md/ }).click();
    const readerSize = await page.locator("article.markdown").evaluate(node => ({ width: node.getBoundingClientRect().width, main: document.querySelector("main").clientWidth }));
    assert.ok(readerSize.width >= readerSize.main - 50, JSON.stringify(readerSize));
    await screenshot("vibe-studio-reader.png");
    await page.getByRole("button", { name: /Retour/ }).click();
    await nav("Parcours");
    const approved = page.locator('[data-phase="1-write-note"]');
    assert.match(await approved.locator(".status-badge").innerText(), /^Validé le \d{2}\/\d{2}\/\d{4}$/);
    const approvedDate = await approved.locator("time").getAttribute("datetime");
    assert.ok(Number.isFinite(Date.parse(approvedDate)), approvedDate);
    assert.equal(await approved.getByRole("button", { name: "Préparer", exact: true }).isDisabled(), true);
    await approved.getByRole("button", { name: "Rouvrir l’étape…", exact: true }).click();
    await page.locator("dialog").getByRole("button", { name: "Annuler", exact: true }).click();
    assert.equal(await approved.getByRole("button", { name: "Préparer", exact: true }).isDisabled(), true);
    await approved.getByRole("button", { name: "Rouvrir l’étape…", exact: true }).click();
    await page.locator("dialog").getByRole("button", { name: "Rouvrir l’étape…", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('[data-phase="1-write-note"] .phase-actions button').disabled);
    checks.push("approval locks journey, confirmed reopen unlocks it, original opens safely, notice expires");
    await page.getByRole("button", { name: /5 · Accès clients$/ }).click();
    const explore = page.locator('[data-phase="2-explore-topic"]');
    assert.equal(await explore.getByRole("button", { name: "Préparer", exact: true }).isDisabled(), false);
    await explore.getByRole("button", { name: "Préparer", exact: true }).click();
    await page.locator("dialog").getByLabel("Modèle", { exact: true }).waitFor();
    assert.equal(await page.locator("dialog").getByLabel("Modèle", { exact: true }).locator("option").count(), 2);
    await page.locator("dialog").getByLabel("Modèle", { exact: true }).selectOption("claude-sonnet-5.5");
    const contextOptions = await page.locator("dialog").getByLabel("Fenêtre de contexte", { exact: true }).locator("option").allTextContents();
    assert.deepEqual(contextOptions.map(text => text.replace(/[\u00a0\u202f]/g, " ")),
        ["Standard · 200 000 tokens en entrée max.", "Étendu · 936 000 tokens en entrée max."]);
    await page.locator("dialog").getByLabel("Fenêtre de contexte", { exact: true }).selectOption("long_context");
    await page.locator("dialog").getByLabel("Effort de raisonnement", { exact: true }).selectOption("high");
    await screenshot("vibe-studio-launch-effort.png");
    await page.locator("dialog").getByRole("button", { name: /Lancer|Confirmer/ }).click();
    await page.locator("dialog").waitFor({ state: "hidden" });
    await page.getByRole("heading", { name: "Conversation", exact: true }).waitFor();
    await until(() => electron.evaluate(() => globalThis.smoke.sessions.size === 1));
    assert.deepEqual(await electron.evaluate(() => {
        const entry = [...globalThis.smoke.sessions.values()][0]; return [entry.options.model, entry.options.contextTier];
    }), ["claude-sonnet-5.5", "long_context"]);
    const launched = await electron.evaluate(async () => (await globalThis.smoke.project.store.read()).runs.at(-1));
    assert.equal(launched.unit, 5);
    assert.equal(launched.model, "claude-sonnet-5.5");
    assert.equal(launched.reasoningEffort, "high");
    assert.equal(launched.contextBudget, 936000);
    assert.match(await page.locator(".conversation-metrics").innerText(), /Effort de raisonnement\s+high/);
    assert.match((await page.locator(".conversation-metrics").innerText()).replace(/[\u00a0\u202f]/g, " "), /Contexte sélectionné\s+Étendu · 936 000 tokens/);
    assert.equal(await page.locator(".conversation-title").evaluate(node => getComputedStyle(node).borderBottomWidth), "1px");
    assert.equal(await page.locator(".conversation-thread > .convo-head").getByRole("button", { name: "Mettre en pause", exact: true }).count(), 1);
    if (process.platform === "win32") await until(() => electron.evaluate(() => globalThis.smoke.taskbar.at(-1)?.value === 2));
    await page.locator(".composer textarea").fill("Brouillon avant la pause");
    await electron.evaluate(() => {
        globalThis.smoke.pausedQuestion = null;
        globalThis.smoke.harness.ui.question({ sessionId: "smoke-1", request: { question: "Question interrompue par la pause ?", choices: ["Continuer"] } })
            .then(answer => { globalThis.smoke.pausedQuestion = answer; });
    });
    await page.getByText("Question interrompue par la pause ?", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Mettre en pause", exact: true }).click();
    await page.getByRole("button", { name: "Reprendre", exact: true }).waitFor();
    await until(() => electron.evaluate(async () => (await globalThis.smoke.project.store.read()).runs.at(-1).status === "paused"));
    assert.equal(await page.locator(".composer").count(), 0);
    assert.match((await electron.evaluate(() => globalThis.smoke.pausedQuestion)).answer, /Annulé/);
    if (process.platform === "win32") await until(() => electron.evaluate(() => globalThis.smoke.taskbar.at(-1)?.value === -1));
    await nav("Parcours");
    assert.match(await page.locator('[data-indicator="session"]').innerText(), /En pause/);
    assert.equal(await page.locator(".register-current .badge-paused").innerText(), "En pause");
    await page.locator('[data-indicator="session"]').click();
    await page.getByRole("button", { name: "Reprendre", exact: true }).click();
    await page.locator(".composer textarea").waitFor();
    assert.equal(await page.locator(".composer textarea").inputValue(), "Brouillon avant la pause");
    assert.equal(await electron.evaluate(() => globalThis.smoke.sessions.size), 1);
    assert.equal((await electron.evaluate(() => globalThis.smoke.sent.at(-1))).sessionId, launched.sessionId);
    if (process.platform === "win32") await until(() => electron.evaluate(() => globalThis.smoke.taskbar.at(-1)?.value === 2));
    checks.push("native taskbar activity, confirmed pause, cancelled pending question, preserved draft and same-session resume");
    await nav("Parcours");
    assert.equal(await page.locator(".register-current").count(), 1);
    assert.equal(await page.locator(".register-current .badge-running").innerText(), "En cours");
    await page.getByRole("button", { name: /4 · Analyse des contrats$/ }).click();
    assert.equal(await page.locator(".register-current").count(), 1);
    assert.equal(await page.locator(".register-entry").count(), 4);
    assert.match(await page.locator(".journey-summary").innerText(), /sur 4/);
    assert.match(await page.locator(".register-current .register-body strong").innerText(), /Accès clients/);
    await page.locator(".register-current").getByRole("button", { name: "Suivre", exact: true }).click();
    await page.getByRole("heading", { name: "Conversation", exact: true }).waitFor();
    await mkdir(path.join(project, "work", "topics", "topic-5"), { recursive: true });
    await writeFile(path.join(project, "work", "topics", "topic-5", "tasks.md"), "Plan status: approved\n\n## Tasks\n\n- [x] T01 Complete build\n");
    await writeFile(path.join(project, "work", "topics", "topic-5", "findings.md"), "# Completed build\n");
    await electron.evaluate(async (_electron, run) => {
        await globalThis.smoke.project.report({ runId: run.id, status: "produced", paths: ["work/topics/topic-5/tasks.md", "work/topics/topic-5/findings.md"] }, run.sessionId);
        globalThis.smoke.sessions.get(run.sessionId).options.onEvent({ type: "session.idle", id: "build-finished", data: {} });
    }, launched);
    await until(() => electron.evaluate(async () => (await globalThis.smoke.project.store.read()).runs.at(-1).completion?.automatic === true));
    await nav("Parcours");
    await page.getByRole("button", { name: /5 · Accès clients$/ }).click();
    await page.getByText("Validée automatiquement", { exact: true }).waitFor();
    assert.equal(await page.locator('[data-phase="2-explore-topic"]').getByRole("button", { name: "Préparer", exact: true }).count(), 0);
    assert.equal(await page.locator('[data-phase="2-explore-topic"]').getByRole("button", { name: "Rouvrir", exact: true }).count(), 0);
    checks.push("build completion automatically validates its journey entry without a manual approval or a new Prepare action");
    if (process.platform === "win32") await until(() => electron.evaluate(() => globalThis.smoke.taskbar.at(-1)?.value === -1));
    checks.push("scenario 5 selectable without folder 4, kit model choices and extended context applied");
    await writeFile(path.join(project, "work", "topics", "topic-5", "tasks.md"),
        "Plan status: approved\n\n## Tasks\n- [x] T01 Complete build\n\n## Review corrections\n- [ ] R01 Fix contrast. Files: app.css.\n- [ ] R02 (user feedback, Medium): Fix title. Screen: Home.\n");
    await nav("Thèmes");
    await page.locator("#refresh").click();
    const correctionRow = id => page.locator("tr").filter({ has: page.getByRole("cell", { name: id, exact: true }) });
    await correctionRow("R02").getByRole("button", { name: "Modifier", exact: true }).click();
    await page.locator("dialog").getByLabel("Retour", { exact: true }).fill("New title");
    await page.locator("dialog").getByLabel("Priorité", { exact: true }).selectOption("high");
    await screenshot("vibe-studio-manual-correction.png");
    await page.locator("dialog").getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.locator("dialog").waitFor({ state: "hidden" });
    await correctionRow("R02").getByText(/New title/).waitFor();
    await correctionRow("R01").getByRole("button", { name: "Valider manuellement", exact: true }).click();
    await page.locator("dialog").getByRole("button", { name: "Valider manuellement", exact: true }).click();
    await until(async () => (await readFile(path.join(project, "work", "topics", "topic-5", "tasks.md"), "utf8")).includes("- [x] R01"));
    await correctionRow("R01").getByRole("button", { name: "Valider manuellement", exact: true }).waitFor({ state: "hidden" });
    await correctionRow("R02").getByRole("button", { name: "Supprimer", exact: true }).click();
    await page.locator("dialog").getByRole("button", { name: "Supprimer", exact: true }).click();
    await until(async () => (await readFile(path.join(project, "work", "topics", "topic-5", "tasks.md"), "utf8")).includes("removed correction R02"));
    checks.push("manual R editing, priority selection, validation and deletion preserve the task file and identifiers");
    await nav("Conversation");
    await page.getByRole("button", { name: "Nouvelle discussion", exact: true }).click();
    await page.locator("dialog").getByLabel("Modèle", { exact: true }).waitFor();
    assert.equal(await page.locator("dialog").getByLabel("Modèle", { exact: true }).locator("option").count(), 3);
    await page.locator("dialog").getByLabel("Fenêtre de contexte", { exact: true }).selectOption("long_context");
    await page.locator("dialog").getByLabel("Effort de raisonnement", { exact: true }).selectOption("low");
    await page.locator("dialog").getByRole("button", { name: "Démarrer", exact: true }).click();
    await page.locator(".composer textarea").waitFor();
    assert.equal(await electron.evaluate(() => globalThis.smoke.sessions.get("smoke-2").options.contextTier), "long_context");
    assert.equal(await electron.evaluate(() => globalThis.smoke.sessions.get("smoke-2").options.reasoningEffort), "low");
    const history = page.locator(".conversation-history");
    await history.locator("summary").click();
    await until(async () => JSON.parse(await readFile(path.join(data, "preferences.json"), "utf8")).conversationHistory === false);
    await nav("Parcours"); await nav("Conversation");
    assert.equal(await history.evaluate(node => node.open), false);
    assert.equal(await page.getByText("Dernière conversation", { exact: true }).isVisible(), true);
    await history.locator("summary").click();
    await until(async () => JSON.parse(await readFile(path.join(data, "preferences.json"), "utf8")).conversationHistory === true);
    await nav("Parcours"); await nav("Conversation");
    assert.equal(await history.evaluate(node => node.open), true);
    await history.evaluate(async node => {
        node.open = false; await new Promise(resolve => setTimeout(resolve, 0)); node.open = true;
    });
    await until(async () => JSON.parse(await readFile(path.join(data, "preferences.json"), "utf8")).conversationHistory === true);
    checks.push("previous conversations are labelled, collapsible, and their visibility is persisted across navigation and rapid toggles");
    await page.getByRole("switch", { name: /^Approve All/ }).check();
    await until(() => page.getByRole("switch", { name: /^Approve All/ }).isEnabled());
    await page.emulateMedia({ reducedMotion: "reduce" });
    const toggleGeometry = await page.getByRole("switch").evaluateAll(nodes => nodes.map(node => {
        const style = getComputedStyle(node, "::after"), track = node.getBoundingClientRect();
        const translate = style.transform === "none" ? 0 : new DOMMatrixReadOnly(style.transform).m41;
        const left = parseFloat(style.left) + translate, top = parseFloat(style.top);
        return { checked: node.checked, inset: node.checked ? track.width - left - parseFloat(style.width) : left,
            top, bottom: track.height - top - parseFloat(style.height) };
    }));
    for (const geometry of toggleGeometry) {
        assert.ok(Math.abs(geometry.inset - 3) < 0.1 && Math.abs(geometry.top - 3) < 0.1
            && Math.abs(geometry.bottom - 3) < 0.1, JSON.stringify(geometry));
    }
    checks.push("OFF/ON switches have symmetric 3px thumb insets and reduced-motion support");
    if (process.platform === "win32") {
        await electron.evaluate(({ BrowserWindow }) => {
            BrowserWindow.getAllWindows()[0].minimize();
            globalThis.smoke.sessions.get("smoke-2").options.onEvent({ type: "assistant.turn_start", id: "taskbar-turn", data: {} });
        });
        await until(() => electron.evaluate(() => globalThis.smoke.taskbar.at(-1)?.value === 2));
        assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), true);
        await electron.evaluate(({ BrowserWindow }) => {
            globalThis.smoke.sessions.get("smoke-2").options.onEvent({ type: "session.idle", id: "taskbar-idle", data: {} });
            BrowserWindow.getAllWindows()[0].restore();
        });
        await until(() => electron.evaluate(() => globalThis.smoke.taskbar.at(-1)?.value === -1));
        checks.push("native activity works for free conversations while the window is minimized and clears when idle");
    }
    const automatic = await electron.evaluate(async () => globalThis.smoke.harness.ui.permission({ sessionId: "smoke-2", request: { kind: "shell", fullCommandText: "echo smoke" } }));
    assert.equal(automatic, "approve");
    await electron.evaluate(() => {
        globalThis.smoke.question = null;
        globalThis.smoke.harness.ui.question({ sessionId: "smoke-2", request: { question: "Continuer le test ?", choices: ["Oui", "Non"] } }).then(answer => globalThis.smoke.question = answer);
    });
    await nav("Parcours");
    await page.locator('[data-indicator="questions"].indicator-attention').waitFor();
    assert.match(await page.locator('[data-indicator="questions"]').innerText(), /1 en attente/);
    await page.locator('[data-indicator="questions"]').click();
    await page.getByRole("button", { name: "Oui", exact: true }).click();
    await page.waitForFunction(() => !!document.querySelector(".convo-request-done"));
    assert.equal((await electron.evaluate(() => globalThis.smoke.question)).answer, "Oui");
    await nav("Parcours");
    assert.equal(await page.locator(".indicator-attention").count(), 0);
    await nav("Conversation");
    await electron.evaluate(() => {
        globalThis.smoke.project.forcedAsks.set("smoke-2", 1);
        globalThis.smoke.forced = null;
        globalThis.smoke.harness.ui.permission({ sessionId: "smoke-2", request: { kind: "shell", fullCommandText: "guard-confirmation" } }).then(answer => globalThis.smoke.forced = answer);
    });
    await page.getByRole("button", { name: "Autoriser", exact: true }).click();
    assert.equal(await electron.evaluate(() => globalThis.smoke.forced), "approve");
    await page.getByRole("switch", { name: /^Autopilot/ }).check();
    await page.getByRole("switch", { name: /^Approve All/ }).waitFor({ state: "detached" });
    assert.equal(await page.getByRole("switch", { name: /^Approve All/ }).count(), 0);
    await page.getByRole("switch", { name: /^Autopilot/ }).uncheck();
    await page.getByRole("switch", { name: /^Approve All/ }).waitFor();
    assert.equal(await page.getByRole("switch", { name: /^Approve All/ }).isChecked(), true);
    checks.push("Approve All leaves questions and guard confirmations explicit, independent of Autopilot");
    const readsBeforeUsage = (await readFile(costReads, "utf8")).trim().split(/\r?\n/).length;
    await writeFile(costReport, JSON.stringify({ ...report, total: { usage: { credits: 17.5 } } }));
    await electron.evaluate(() => {
        const { options } = globalThis.smoke.sessions.get("smoke-2");
        options.onEvent({ type: "session.usage_info", id: "c1", data: { tokenLimit: 200000, currentTokens: 12000 } });
        options.onEvent({ type: "assistant.usage", id: "u1", data: { model: "claude-sonnet-5.5", inputTokens: 14000, outputTokens: 1200, cacheReadTokens: 4000,
            copilotUsage: { totalNanoAiu: 1250000000 } } });
        options.onEvent({ type: "assistant.message", id: "m1", data: { messageId: "m1", content: "Une réponse dans toute la largeur. ".repeat(100) } });
        for (let i = 0; i < 10; i++) options.onEvent({ type: "assistant.usage", id: `cost-burst-${i}`, data: { inputTokens: 0 } });
    });
    await page.waitForFunction(() => document.querySelector(".conversation-metrics").textContent.includes("200"));
    await checkIconSpacing();
    const widths = await page.evaluate(() => {
        const width = selector => document.querySelector(selector).getBoundingClientRect().width;
        return { main: document.querySelector(".conversation-thread").clientWidth, log: width(".convo"), composer: width(".composer"), markdown: width(".convo-assistant .markdown") };
    });
    assert.ok(widths.log >= widths.main - 50 && widths.composer >= widths.main - 50 && widths.markdown >= widths.main - 50, JSON.stringify(widths));
    assert.match(await page.locator(".conversation-metrics").innerText(), /Crédits IA consommés\s+1(?:\s|$)/);
    await nav("Coûts");
    await page.getByText("Total du rapport : 17,5 crédits.", { exact: true }).waitFor();
    const readsAfterUsage = (await readFile(costReads, "utf8")).trim().split(/\r?\n/).length;
    assert.ok(readsAfterUsage - readsBeforeUsage <= 2, "usage bursts are coalesced rather than reading on every token event");
    await writeFile(costReport, JSON.stringify({ ...report, total: { usage: { credits: 19 } } }));
    await electron.evaluate(() => globalThis.smoke.sessions.get("smoke-2").options.onEvent({ type: "session.idle", id: "cost-finished", data: {} }));
    await page.getByText("Total du rapport : 19 crédits.", { exact: true }).waitFor();
    await writeFile(costReport, JSON.stringify({ ...report, total: { usage: { credits: 20 } } }));
    await electron.evaluate(() => globalThis.smoke.sessions.get("smoke-2").options.onEvent({ type: "session.usage_checkpoint", id: "cost-flushed", data: {} }));
    await page.getByText("Total du rapport : 20 crédits.", { exact: true }).waitFor();
    await nav("Parcours");
    assert.match(await page.locator('[data-indicator="costs"]').innerText(), /20 crédits/);
    await nav("Conversation");
    checks.push("usage, completion and flushed checkpoints automatically refresh Costs and Journey without counting the same usage twice");
    const metricsTop = await page.locator(".conversation-details").evaluate(node => node.getBoundingClientRect().top);
    const transcript = page.locator(".conversation-transcript");
    await transcript.evaluate(node => { node.scrollTop = 0; });
    await page.waitForFunction(() => document.querySelector(".conversation-transcript").classList.contains("is-scrolling"));
    assert.equal(await page.locator(".conversation-details").evaluate(node => node.getBoundingClientRect().top), metricsTop);
    await page.waitForFunction(() => !document.querySelector(".conversation-transcript").classList.contains("is-scrolling"));
    assert.equal(await transcript.evaluate(node => getComputedStyle(node).scrollbarColor), "rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)");
    await transcript.evaluate(node => { node.scrollTop = 20; });
    await page.waitForFunction(() => document.querySelector(".conversation-transcript").classList.contains("is-scrolling"));
    assert.notEqual(await transcript.evaluate(node => getComputedStyle(node).scrollbarColor), "rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)");
    await page.locator(".composer textarea").fill("Brouillon conservé");
    await electron.evaluate((_electron, files) => { globalThis.smoke.selection = files; }, [png, text]);
    await page.locator(".composer").getByRole("button", { name: "Ajouter des fichiers…", exact: true }).click();
    await page.locator(".composer .attachment-card img").waitFor();
    assert.equal(await page.locator(".composer .attachment-card").count(), 2);
    await nav("Parcours"); await nav("Conversation");
    assert.equal(await page.locator(".composer textarea").inputValue(), "Brouillon conservé");
    assert.equal(await page.locator(".composer .attachment-card").count(), 2);
    await page.locator(".composer").getByRole("button", { name: "Envoyer", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".composer textarea").value);
    assert.equal((await electron.evaluate(() => globalThis.smoke.sent.at(-1))).attachments.length, 2);
    checks.push("persistent side metrics, reported AI credits, scroll-only scrollbar, chooser thumbnails, draft retention and sending attachments");
    await page.locator(".composer textarea").evaluate((node, base64) => {
        const file = new File([Uint8Array.from(atob(base64), x => x.charCodeAt(0))], "pasted.png", { type: "image/png" });
        const data = new DataTransfer(); data.items.add(file);
        node.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    }, pngBase64);
    await page.locator(".composer .attachment-card img").waitFor();
    await page.evaluate(() => {
        const input = document.createElement("input"); input.type = "file"; input.id = "native-drop-fixture"; input.hidden = true; document.body.append(input);
    });
    await page.locator("#native-drop-fixture").setInputFiles(dropped);
    await page.locator(".composer").evaluate(node => {
        const data = new DataTransfer(); data.items.add(document.querySelector("#native-drop-fixture").files[0]);
        node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
    });
    await page.waitForFunction(() => document.querySelectorAll(".composer .attachment-card").length === 2);
    assert.ok((await page.locator(".composer .attachment-tray").innerText()).includes("native-drop.txt"));
    await nav("Réglages");
    await page.getByRole("button", { name: "Réglages personnels", exact: true }).click();
    await page.getByLabel("Thème de l’application", { exact: true }).selectOption("dark");
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    await nav("Conversation");
    await screenshot("vibe-studio-dark.png");
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 720));
    await page.waitForFunction(() => innerWidth < 950);
    const composerBounds = await page.evaluate(() => {
        const main = document.querySelector("main"), composer = document.querySelector(".composer");
        return { main: main.getBoundingClientRect().bottom - parseFloat(getComputedStyle(main).paddingBottom), composer: composer.getBoundingClientRect().bottom };
    });
    assert.ok(composerBounds.composer >= composerBounds.main - 1, JSON.stringify(composerBounds));
    const sendBounds = await page.locator(".composer").getByRole("button", { name: "Envoyer", exact: true }).boundingBox();
    assert.ok(sendBounds.y + sendBounds.height <= composerBounds.composer, "the send action remains visible on a narrow window");
    await screenshot("vibe-studio-narrow.png");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator(".composer").getByRole("button", { name: "Envoyer", exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll(".composer .attachment-card").length === 0);
    assert.equal((await electron.evaluate(() => globalThis.smoke.sent.at(-1))).attachments.length, 2);
    checks.push("image paste, file drop, attachment-only send, dark mode and narrow layout");
    delete contract.modules.costs;
    await writeFile(contractFile, JSON.stringify(contract));
    await nav("Parcours");
    await page.locator("#refresh").click();
    await page.getByRole("button", { name: /Consommation Non suivie par ce kit/ }).waitFor();
    assert.equal(await page.locator('[data-indicator="costs"]').isDisabled(), true);
    checks.push("Journey text contrast meets 4.5:1 in both themes; kits without costs show an explicit unavailable state");
    await nav("À propos");
    await page.getByRole("button", { name: "Rechercher une mise à jour", exact: true }).click();
    await page.getByText("Vibe Studio 99.0.0 est disponible.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Télécharger l’installeur vérifié", exact: true }).count(), 0,
        "a development or portable copy links to the release instead of installing");
    await page.getByRole("button", { name: "Ouvrir la page de la version", exact: true }).click();
    await until(() => electron.evaluate(() => globalThis.smoke.opened.some(url => url.endsWith("/releases/tag/v99.0.0"))));
    await electron.evaluate(() => { globalThis.smoke.updateFailure = true; });
    await page.getByRole("button", { name: "Rechercher une mise à jour", exact: true }).click();
    await page.getByText(/Recherche ou téléchargement indisponible.*404/).waitFor();
    checks.push("anonymous update check, portable release link and explicit private-server failure use a fake server without credentials");
    assert.deepEqual(errors, []);
    assert.equal(JSON.parse(await readFile(path.join(data, "projects.json"), "utf8"))[0].dir, project);
    checks.push("Vibe Studio identity and existing Vibe Studio profile retained in isolated appData");
    console.log(JSON.stringify({ checks, widths, readerSize, composerBounds, artifacts }, null, 2));
} catch (error) {
    if (page) {
        console.error("Cost reads:", await readFile(costReads, "utf8").catch(() => "none"));
        console.error(await page.locator("main").innerText());
        console.error(await page.locator("#notice").innerText());
        console.error(await page.locator("label").evaluateAll(nodes => nodes.map(node => node.outerHTML)));
        await screenshot("vibe-studio-failure.png");
    }
    throw error;
} finally {
    if (electron) await electron.close();
    await rm(base, { recursive: true, force: true });
}
