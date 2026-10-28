import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron } from "playwright-core";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "vibe-studio-workshop-smoke-"));
const initial = path.join(temporary, "project"), kits = path.join(temporary, "kits"), target = path.join(temporary, "target");
const profile = path.join(temporary, "appdata"), zip = path.join(temporary, "kit.zip");
const artifacts = process.env.VIBE_STUDIO_SMOKE_ARTIFACTS;
await cp(path.join(root, "test", "fixtures", "demo"), initial, { recursive: true });
await writeFile(path.join(initial, "demo.yml"), "project:\n  name: Atelier test\n  language: fr\npaths:\n  root: work\n");
await mkdir(path.join(profile, "Vibe Studio"), { recursive: true });
await writeFile(path.join(profile, "Vibe Studio", "preferences.json"), JSON.stringify({ theme: "light", sound: false, notifications: false }));
await mkdir(kits); await mkdir(target);

async function contractOf(directory) {
    for (const skill of await readdir(path.join(directory, ".apm", "skills"))) {
        try { return JSON.parse(await readFile(path.join(directory, ".apm", "skills", skill, "assets", "vibe-studio.json"), "utf8")); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    throw new Error("No kit contract found.");
}

let desktop, page;
try {
    desktop = await _electron.launch({ executablePath: require("electron"),
        args: [path.join(root, "scripts", "smoke-entry.mjs")],
        env: { ...process.env, VIBE_STUDIO_SMOKE_PROJECT: initial, VIBE_STUDIO_SMOKE_APPDATA: profile }, timeout: 60000 });
    page = await desktop.firstWindow();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(30000);
    const shoot = async name => { if (artifacts) { await mkdir(artifacts, { recursive: true }); await page.screenshot({ path: path.join(artifacts, `${name}.png`) }); } };
    const noOverflow = async () => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    // The AI is driven from the test: proposals go through the real tool handler, then the turn ends.
    const propose = proposals => desktop.evaluate(async (_electron, proposals) => {
        const session = [...globalThis.smoke.sessions.values()].at(-1);
        const tool = session.options.tools.find(entry => entry.name === "vibe_studio_propose");
        const result = await tool.handler({ proposals });
        session.options.onEvent({ type: "session.idle", id: `idle-${Date.now()}`, data: {} });
        return result;
    }, proposals);
    await page.getByRole("heading", { name: "Parcours", exact: true }).waitFor();
    await page.locator("#settings").click();
    await page.getByRole("heading", { name: "Réglages", exact: true }).waitFor();
    assert.equal(await page.locator("nav").getByRole("button", { name: "Réglages", exact: true }).count(), 1);
    assert.equal(await page.locator("#settings svg").count(), 1);
    assert.equal(await page.locator("#project svg").count(), 1);
    await desktop.evaluate(({ dialog }, { kits, zip }) => {
        globalThis.smoke.selection = [kits];
        dialog.showMessageBox = async () => ({ response: 1 });
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: zip });
    }, { kits, zip });
    await page.locator("#project").click();
    assert.equal(await page.getByRole("button", { name: "Réglages personnels", exact: true }).count(), 0);

    // Start: a name and a mission are enough; the location is the only technical choice and stays folded.
    await page.locator("#navigation").getByRole("button", { name: "Atelier de kits", exact: true }).click();
    await page.getByRole("heading", { name: "Créer un kit", exact: true }).waitFor();
    assert.equal(await page.locator(".ws-start input:not([type=hidden])").count(), 1, "only the kit name is asked up front");
    await page.getByRole("button", { name: "Audit", exact: true }).click();
    assert.equal(await page.getByLabel("Nom du kit", { exact: true }).inputValue(), "Audit d’accessibilité d’un site web");
    await page.getByLabel("Nom du kit", { exact: true }).fill("Audit smoke");
    await page.getByText("Options : documents de référence, langue de rédaction, emplacement").click();
    await page.getByRole("group", { name: "Emplacement du kit" }).getByRole("button", { name: "Modifier", exact: true }).click();
    await page.locator(".ws-path", { hasText: kits }).waitFor();
    await shoot("workshop-start-light-1280");
    await page.getByRole("button", { name: "Préparer le brouillon", exact: true }).click();
    await page.getByRole("heading", { name: "Préparation du brouillon", exact: true }).waitFor();
    const directory = path.join(kits, "audit-smoke");
    const sent = await desktop.evaluate(() => globalThis.smoke.sent.at(-1).prompt);
    assert.match(sent, /Mission described by the author:\nRéaliser un audit d’accessibilité/);
    assert.match(sent, /Write every title, description and instruction in French/);
    const progress = await desktop.evaluate(async () => {
        const session = [...globalThis.smoke.sessions.values()].at(-1);
        return session.options.tools.find(entry => entry.name === "vibe_studio_progress").handler({ tasks: [
            { label: "Lire la mission", status: "done" }, { label: "Proposer le parcours", status: "doing" }] });
    });
    assert.equal(progress, "Progress shown to the author.");
    await page.getByText("Proposer le parcours", { exact: true }).waitFor();
    const verdict = await desktop.evaluate(async () => {
        const session = [...globalThis.smoke.sessions.values()].at(-1);
        return session.options.hooks.onPreToolUse({ toolName: "powershell", toolArgs: { command: "Get-Content apm.yml" } });
    });
    assert.equal(verdict.permissionDecision, "deny");
    await shoot("workshop-preparing-light-1280");

    // Review: each proposal is decided before anything reaches the kit.
    const result = await propose([
        { kind: "kit", summary: "Présenter le kit.", description: "Audit d’accessibilité guidé, du cadrage au rapport." },
        { kind: "step.add", summary: "Cadrer avant d’analyser.", title: "Cadrer l’audit", description: "Recueille le périmètre.",
            result: "Une note de cadrage validée.", produces: ["note-cadrage.md"], approval: true, instructions: "1. Demander le périmètre.\n2. Rédiger la note." },
        { kind: "step.add", summary: "Analyser chaque page.", title: "Analyser une page", repeat: true, uses: ["note-cadrage.md"], produces: ["constats.md"] },
        { kind: "rule.add", summary: "Protéger les secrets.", rule: "secrets", description: "Aucun secret écrit dans le projet." },
        { kind: "step.update", summary: "Étape inconnue.", step: "9-nothing", title: "x" },
    ]);
    assert.match(result, /4 proposal\(s\) queued/);
    assert.match(result, /Proposal 5:/);
    await page.getByRole("heading", { name: "Relire le brouillon", exact: true }).waitFor();
    await page.getByText("Proposition 1 sur 4", { exact: true }).waitFor();
    assert.equal(JSON.stringify(await contractOf(directory)).includes("Cadrer"), false, "nothing is saved before acceptance");
    await shoot("workshop-review-light-1280");
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await page.setViewportSize({ width: 820, height: 860 });
    await noOverflow();
    await shoot("workshop-review-dark-820");
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.getByRole("button", { name: "Accepter", exact: true }).click();
    await page.getByText("Proposition 2 sur 4", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Modifier", exact: true }).click();
    await page.locator(".ws-edit").getByLabel("Titre", { exact: true }).fill("Cadrer le périmètre");
    await page.getByRole("button", { name: "Accepter avec ces modifications", exact: true }).click();
    await page.getByText("Proposition 3 sur 4", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Accepter", exact: true }).click();
    await page.getByText("Proposition 4 sur 4", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Refuser", exact: true }).click();
    await page.getByRole("heading", { name: "Relecture terminée", exact: true }).waitFor();
    assert.deepEqual(await page.locator(".ws-tally strong").allTextContents(), ["3", "1", "0"]);
    let contract = await contractOf(directory);
    assert.deepEqual(contract.steps.map(step => step.title), ["Configurer le projet", "Cadrer le périmètre", "Analyser une page"]);
    assert.equal(contract.kit.description, "Audit d’accessibilité guidé, du cadrage au rapport.");
    assert.equal(contract.steps[2].scope, "unit");
    assert.ok(contract.units, "a repeated step creates the repeated element");
    assert.equal(JSON.stringify(contract.guards || {}).includes("secret"), false, "a rejected rule is not applied");
    const instructions = await readFile(path.join(directory, ".apm", "skills", contract.steps[1].skill, "SKILL.md"), "utf8");
    assert.match(instructions, /Demander le périmètre/);
    await shoot("workshop-summary-light-1280");

    // Translation: the AI translates, the author validates text by text.
    await page.getByRole("button", { name: "Préparer la traduction", exact: true }).click();
    let request = "";
    for (let attempt = 0; attempt < 100 && !/Translate these kit texts/.test(request); attempt++) {
        request = await desktop.evaluate(() => globalThis.smoke.sent.at(-1).prompt);
        await new Promise(done => setTimeout(done, 100));
    }
    assert.match(request, /Translate these kit texts from French into English/);
    await propose([
        { kind: "translation", summary: "Kit name.", language: "en", key: "kit.name", text: "Smoke audit" },
        { kind: "translation", summary: "Kit description.", language: "en", key: "kit.description", text: "Guided accessibility audit." },
    ]);
    await page.getByRole("heading", { name: "Relire la traduction", exact: true }).waitFor();
    await page.getByLabel("English", { exact: true }).fill("Accessibility audit");
    await shoot("workshop-translation-light-1280");
    await page.getByRole("button", { name: "Valider la traduction", exact: true }).click();
    await page.getByText("Proposition 2 sur 2", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Passer", exact: true }).click();
    await page.getByRole("heading", { name: "Relecture terminée", exact: true }).waitFor();
    contract = await contractOf(directory);
    assert.equal(contract.kit.i18n.en.name, "Accessibility audit");
    assert.equal(contract.kit.i18n.en.description, undefined);
    await page.getByRole("button", { name: "Ouvrir le kit", exact: true }).click();

    // Kit view: plain pages, edits saved on change, display in another language.
    await page.getByRole("heading", { name: "Audit smoke", exact: true }).waitFor();
    await page.getByRole("navigation", { name: "Plan du kit" }).getByRole("button", { name: "Présentation et langues" }).click();
    await page.getByLabel("Description affichée aux utilisateurs", { exact: true }).fill("Audit d’accessibilité, du cadrage au rapport final.");
    await page.keyboard.press("Tab");
    for (let attempt = 0; attempt < 100; attempt++) {
        contract = await contractOf(directory);
        if (contract.kit.description.endsWith("rapport final.")) break;
        await new Promise(done => setTimeout(done, 100));
    }
    assert.equal(contract.kit.description, "Audit d’accessibilité, du cadrage au rapport final.");
    await page.getByRole("navigation", { name: "Plan du kit" }).getByRole("button", { name: /Cadrer le périmètre/ }).click();
    await page.getByRole("heading", { name: "Cadrer le périmètre", exact: true }).waitFor();
    await page.getByLabel("Langue", { exact: true }).selectOption("en");
    await page.getByRole("heading", { name: "Accessibility audit", exact: true }).waitFor();
    await page.getByLabel("Langue", { exact: true }).selectOption("fr");
    for (const [theme, width] of [["light", 1280], ["dark", 820]]) {
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        await page.setViewportSize({ width, height: 860 });
        await noOverflow();
        await shoot(`workshop-kit-${theme}-${width}`);
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await page.setViewportSize({ width: 1280, height: 860 });

    // Expert: technical settings and the raw contract with a live check.
    await page.getByRole("group", { name: "Mode d’affichage" }).getByRole("button", { name: "Expert", exact: true }).click();
    await page.getByRole("button", { name: /Règles de l’étape/ }).waitFor();
    await page.getByRole("navigation", { name: "Plan du kit" }).getByRole("button", { name: /Contrat brut/ }).click();
    const raw = page.getByLabel("Contrat brut", { exact: true });
    await raw.fill("{ invalid");
    await page.getByText("JSON invalide", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Enregistrer", exact: true }).isDisabled(), true);
    await shoot("workshop-expert-light-1280");
    await page.getByRole("button", { name: "Annuler", exact: true }).click();
    await page.getByRole("group", { name: "Mode d’affichage" }).getByRole("button", { name: "Simple", exact: true }).click();
    assert.equal(await page.getByRole("navigation", { name: "Plan du kit" }).getByRole("button", { name: /Contrat brut/ }).count(), 0);

    // Share as ZIP from the menu, then test the kit in a project.
    await page.getByLabel("Plus d’actions").click();
    await page.getByRole("button", { name: "Partager…", exact: true }).click();
    await page.locator("#confirmation").getByRole("button", { name: "Continuer", exact: true }).click();
    await page.waitForFunction(() => ![...document.querySelectorAll(".ws button")].some(button => button.disabled));
    for (let attempt = 0; attempt < 50; attempt++) { try { if ((await readFile(zip)).length > 100) break; } catch { /* Not written yet. */ } await new Promise(done => setTimeout(done, 100)); }
    assert.ok((await readFile(zip)).length > 100);
    await desktop.evaluate((_electron, target) => { globalThis.smoke.selection = [target]; }, target);
    await page.getByRole("button", { name: "Tester dans un projet", exact: true }).click();
    await page.locator("nav").getByRole("button", { name: /Parcours|Journey/, exact: true }).waitFor();
    const manifest = JSON.parse(await readFile(path.join(target, ".agents", "vibe-studio-kit.json"), "utf8"));
    assert.equal(manifest.id, "audit-smoke");
    assert.equal(Object.keys(manifest.files).some(name => name.includes("authoring")), false);

    await page.locator("#project").click();
    await page.locator("#navigation").getByRole("button", { name: /Projets|Projects/, exact: true }).click();
    await page.getByRole("button", { name: /Fermer le projet|Close project/, exact: true }).click();
    await page.locator("#confirmation").getByRole("button", { name: /Fermer le projet|Close project/, exact: true }).click();
    await page.getByRole("button", { name: /Fermer le projet|Close project/, exact: true }).waitFor({ state: "hidden" });
    await page.locator("#settings").click();
    await page.getByRole("heading", { name: /Settings|Réglages/, exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: /Project and kit|Projet et kit/, exact: true }).count(), 0);
    await page.locator("#refresh").click();
    await page.getByRole("heading", { name: /Settings|Réglages/, exact: true }).waitFor();
    await page.getByRole("button", { name: "Harness", exact: true }).click();
    await page.locator(".harness-list").waitFor();
    await page.getByRole("button", { name: /Check connection|Vérifier la connexion/, exact: true }).click();
    await page.getByRole("heading", { name: /Settings|Réglages/, exact: true }).waitFor();
    await page.getByRole("button", { name: /Appearance|Apparence/, exact: true }).click();
    for (const [theme, width] of [["light", 1280], ["dark", 820]]) {
        await page.locator("#theme-choice").selectOption(theme);
        await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
        await page.setViewportSize({ width, height: 860 });
        await noOverflow();
        const controls = await page.locator(".nav-foot > button").evaluateAll(nodes => nodes.map(node => {
            const style = getComputedStyle(node), bounds = node.getBoundingClientRect();
            const icon = node.querySelector("svg").getBoundingClientRect();
            return { id: node.id, width: bounds.width, height: bounds.height, left: bounds.left, iconLeft: icon.left,
                radius: style.borderRadius, padding: style.padding, fontSize: style.fontSize, fontWeight: style.fontWeight,
                current: node.getAttribute("aria-current") === "page" };
        }));
        assert.deepEqual(controls.map(control => control.id), ["project", "refresh", "settings"]);
        for (const control of controls) {
            assert.equal(control.width, controls[0].width);
            assert.equal(control.left, controls[0].left);
            assert.equal(control.iconLeft, controls[0].iconLeft);
            assert.equal(control.radius, "6px");
            assert.equal(control.height, 36);
            assert.equal(control.padding, controls[0].padding);
            assert.equal(control.fontSize, controls[0].fontSize);
            assert.equal(control.fontWeight, control.current ? "600" : "400");
        }
        await shoot(`settings-${theme}-${width}`);
    }
    await page.locator("#project").click();
    await page.locator("#navigation").getByRole("button", { name: /Atelier de kits|Kit workshop/, exact: true }).click();
    await page.getByRole("heading", { name: "Audit smoke", exact: true }).waitFor();
    await page.getByLabel(/^(Plus d’actions|More actions)$/).click();
    await page.getByRole("button", { name: /^(Fermer le kit|Close the kit)$/ }).click();
    await page.getByRole("heading", { name: /^(Créer un kit|Create a kit)$/ }).waitFor();
    await page.getByRole("button", { name: /^(Créer sans l’IA|Create without the AI)$/ }).waitFor();
    await page.locator(".ws-recent").getByText("Audit smoke", { exact: true }).waitFor();
    await page.setViewportSize({ width: 820, height: 860 });
    await noOverflow();
    await shoot("workshop-start-dark-820");
    await page.locator("#navigation").getByRole("button", { name: /Kits officiels|Official kits/, exact: true }).click();
    await page.getByText(/catalogue officiel n'est pas configuré|official catalog is not configured/).waitFor();
    assert.deepEqual(errors, []);
    console.log("Workshop: mission start, AI progress and read-only guard, proposal review (accept/edit/reject), summary, translation review, kit view edits and language display, expert raw contract, ZIP share, test install, settings, narrow/dark layout verified.");
} catch (error) {
    if (page && artifacts) await page.screenshot({ path: path.join(artifacts, "workshop-failure.png") }).catch(() => {});
    throw error;
} finally {
    if (desktop) await desktop.close();
    await rm(temporary, { recursive: true, force: true });
}
