import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import "@fontsource-variable/mona-sans/standard.css";
import "@fontsource-variable/hubot-sans/standard.css";
import "@fontsource/monaspace-neon/400.css";
import "@fontsource/monaspace-neon/600.css";
import "./style.css";
import HomeRegister from "./components/HomeRegister.vue";
import Shot from "./components/Shot.vue";
import Changelog from "./components/Changelog.vue";

export default {
    extends: DefaultTheme,
    enhanceApp({ app }) {
        app.component("HomeRegister", HomeRegister);
        app.component("Shot", Shot);
        app.component("Changelog", Changelog);
    },
} satisfies Theme;
