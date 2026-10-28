import { defineConfig, type DefaultTheme } from "vitepress";

const repo = "https://github.com/shoyencode/vibe-studio";

function sidebar(prefix: string, fr: boolean): DefaultTheme.SidebarItem[] {
    const l = (en: string, frText: string) => (fr ? frText : en);
    return [
        {
            text: l("Guide", "Guide"),
            items: [
                { text: l("What is Vibe Studio?", "Qu’est-ce que Vibe Studio ?"), link: `${prefix}/guide/introduction` },
                { text: l("Installation", "Installation"), link: `${prefix}/guide/installation` },
                { text: l("Getting started", "Prise en main"), link: `${prefix}/guide/getting-started` },
            ],
        },
        {
            text: l("Using Vibe Studio", "Utiliser Vibe Studio"),
            items: [
                { text: l("Journey", "Parcours"), link: `${prefix}/guide/journey` },
                { text: l("Conversation", "Conversation"), link: `${prefix}/guide/conversation` },
                { text: l("Guards", "Garde-fous"), link: `${prefix}/guide/guards` },
                { text: l("Deliverables and approvals", "Livrables et validations"), link: `${prefix}/guide/deliverables` },
                { text: l("Units, tasks and costs", "Unités, tâches et coûts"), link: `${prefix}/guide/units-and-costs` },
                { text: l("Settings and alerts", "Réglages et alertes"), link: `${prefix}/guide/settings` },
                { text: l("Harnesses", "Harness"), link: `${prefix}/guide/harnesses` },
                { text: l("Updates", "Mises à jour"), link: `${prefix}/guide/updates` },
                { text: l("Data and privacy", "Données et confidentialité"), link: `${prefix}/guide/data` },
                { text: l("Troubleshooting", "Dépannage"), link: `${prefix}/guide/troubleshooting` },
            ],
        },
        {
            text: l("Kits", "Kits"),
            items: [
                { text: l("Tutorial: your first kit", "Tutoriel : un premier kit"), link: `${prefix}/kits/tutorial` },
                { text: l("Creating a kit", "Créer un kit"), link: `${prefix}/kits/creating-a-kit` },
                { text: l("Contract reference", "Référence du contrat"), link: `${prefix}/kits/vibe-studio-contract` },
                { text: l("Official catalog", "Catalogue officiel"), link: `${prefix}/kits/kit-catalog` },
            ],
        },
        {
            text: l("Contributing", "Contribuer"),
            items: [
                { text: l("Build from source", "Construire depuis les sources"), link: `${prefix}/contributing/` },
                { text: l("Tests and releases", "Tests et versions"), link: `${prefix}/contributing/tests-and-releases` },
            ],
        },
    ];
}

function locale(prefix: string, fr: boolean): DefaultTheme.Config {
    const l = (en: string, frText: string) => (fr ? frText : en);
    const items = sidebar(prefix, fr);
    return {
        nav: [
            { text: l("Guide", "Guide"), link: `${prefix}/guide/introduction`, activeMatch: `${prefix}/guide/` },
            { text: l("Kits", "Kits"), link: `${prefix}/kits/tutorial`, activeMatch: `${prefix}/kits/` },
            { text: l("Versions", "Versions"), link: `${prefix}/changelog`, activeMatch: `${prefix}/changelog` },
            { text: l("Contributing", "Contribuer"), link: `${prefix}/contributing/`, activeMatch: `${prefix}/contributing/` },
            { text: l("Download", "Télécharger"), link: `${repo}/releases/latest` },
        ],
        sidebar: { [`${prefix}/guide/`]: items, [`${prefix}/kits/`]: items, [`${prefix}/contributing/`]: items },
        editLink: { pattern: `${repo}/edit/main/site/:path`, text: l("Edit this page on GitHub", "Modifier cette page sur GitHub") },
        docFooter: { prev: l("Previous", "Précédent"), next: l("Next", "Suivant") },
        outline: { level: [2, 3], label: l("On this page", "Sur cette page") },
        lastUpdated: { text: l("Updated", "Mis à jour") },
        langMenuLabel: l("Language", "Langue"),
        returnToTopLabel: l("Back to top", "Haut de page"),
        sidebarMenuLabel: l("Menu", "Menu"),
        darkModeSwitchLabel: l("Appearance", "Apparence"),
        lightModeSwitchTitle: l("Switch to light theme", "Passer au thème clair"),
        darkModeSwitchTitle: l("Switch to dark theme", "Passer au thème sombre"),
        skipToContentLabel: l("Skip to content", "Aller au contenu"),
        notFound: {
            title: l("Page not found", "Page introuvable"),
            quote: l("This page is not part of the documentation.", "Cette page ne fait pas partie de la documentation."),
            linkLabel: l("Go to home", "Aller à l’accueil"),
            linkText: l("Back to the home page", "Revenir à l’accueil"),
        },
        footer: {
            message: l("MIT licence. Vibe Studio is an independent application.", "Licence MIT. Vibe Studio est une application indépendante."),
        },
    };
}

export default defineConfig({
    base: "/vibe-studio/",
    title: "Vibe Studio",
    cleanUrls: true,
    srcExclude: ["DESIGN.md"],
    lastUpdated: true,
    appearance: "force-dark",
    head: [
        ["link", { rel: "icon", type: "image/png", href: "/vibe-studio/logo.png" }],
        ["meta", { property: "og:type", content: "website" }],
        ["meta", { property: "og:image", content: "https://shoyencode.github.io/vibe-studio/screenshots/og.png" }],
    ],
    locales: {
        root: {
            label: "English", lang: "en",
            description: "Drive AI kits step by step, under your control, with Copilot, Claude Code, Codex or Gemini.",
            themeConfig: locale("", false),
        },
        fr: {
            label: "Français", lang: "fr", link: "/fr/",
            description: "Piloter des kits d’IA étape par étape, sous contrôle, avec Copilot, Claude Code, Codex ou Gemini.",
            themeConfig: locale("/fr", true),
        },
    },
    themeConfig: {
        logo: { src: "/logo.png", alt: "" },
        socialLinks: [{ icon: "github", link: repo }],
        search: {
            provider: "local",
            options: {
                locales: {
                    fr: {
                        translations: {
                            button: { buttonText: "Rechercher", buttonAriaLabel: "Rechercher" },
                            modal: {
                                displayDetails: "Afficher la liste détaillée", resetButtonTitle: "Effacer la recherche",
                                backButtonTitle: "Fermer la recherche", noResultsText: "Aucun résultat pour",
                                footer: { selectText: "choisir", navigateText: "naviguer", closeText: "fermer" },
                            },
                        },
                    },
                },
            },
        },
    },
});
