<script setup lang="ts">
import { computed } from "vue";
import { data as versions } from "../../changelog.data.mts";
import { RELEASES_URL } from "../github";

const props = defineProps<{ lang: "en" | "fr" }>();
const fr = computed(() => props.lang === "fr");
const text = computed(() => fr.value ? {
    title: "Versions", lead: "Chaque version de Vibe Studio et ses changements. Les notes de version sont rédigées en anglais, comme le journal des modifications du dépôt.",
    index: "Toutes les versions", upcoming: "À venir", latest: "Dernière version", released: "Publiée le", untagged: "Version antérieure aux releases GitHub",
    download: "Télécharger l’installeur", portable: "Version portable", release: "Release sur GitHub", all: "Toutes les releases sur GitHub",
    upcomingNote: "Changements présents sur la branche principale, pas encore publiés.",
} : {
    title: "Versions", lead: "Every version of Vibe Studio and what changed. Release notes come from the repository changelog.",
    index: "All versions", upcoming: "Upcoming", latest: "Latest version", released: "Released on", untagged: "Released before GitHub releases",
    download: "Download the installer", portable: "Portable version", release: "Release on GitHub", all: "All releases on GitHub",
    upcomingNote: "Changes on the main branch, not released yet.",
});
const SECTIONS: Record<string, string> = {
    "Added": "Ajouts", "Changed": "Modifications", "Changed (breaking)": "Modifications incompatibles", "Deprecated": "Obsolescences",
    "Removed": "Retraits", "Fixed": "Corrections", "Security": "Sécurité",
};
const sectionTitle = (title: string) => !fr.value ? title : SECTIONS[title] || title.replace(/^Migration from /, "Migration depuis ");
const latest = computed(() => versions.find(item => item.version !== "Unreleased")?.version);
const date = (value: string | null) => value && new Intl.DateTimeFormat(fr.value ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
</script>

<template>
  <div class="vs-changelog">
    <header class="vs-changelog-head">
      <h1 class="vs-display">{{ text.title }}</h1>
      <p>{{ text.lead }}</p>
    </header>
    <div class="vs-changelog-body">
      <nav class="vs-changelog-index" :aria-label="text.index">
        <a v-for="item in versions" :key="item.id" :href="`#${item.id}`">
          <span class="mono">{{ item.version === "Unreleased" ? text.upcoming : item.version }}</span>
          <small v-if="item.date">{{ date(item.date) }}</small>
        </a>
        <a class="vs-more" :href="RELEASES_URL.replace(/\/latest$/, '')">{{ text.all }} ↗</a>
      </nav>
      <ol class="vs-versions">
        <li v-for="item in versions" :id="item.id" :key="item.id" class="vs-version" :class="{ upcoming: item.version === 'Unreleased', latest: item.version === latest }">
          <div class="vs-version-head">
            <h2 class="vs-display">{{ item.version === "Unreleased" ? text.upcoming : item.version }}</h2>
            <span v-if="item.version === latest" class="vs-badge vs-ok">{{ text.latest }}</span>
            <time v-if="item.date" :datetime="item.date">{{ text.released }} {{ date(item.date) }}</time>
            <small v-else-if="item.version !== 'Unreleased'" class="vs-muted">{{ text.untagged }}</small>
          </div>
          <p v-if="item.version === 'Unreleased'" class="vs-muted">{{ text.upcomingNote }}</p>
          <ul v-if="item.sections.length" class="vs-counts">
            <li v-for="section in item.sections" :key="section.title" :class="`kind-${section.kind}`">{{ sectionTitle(section.title) }}<b v-if="section.count && section.kind !== 'migration'">{{ section.count }}</b></li>
          </ul>
          <div v-if="item.installer || item.release" class="vs-actions">
            <a v-if="item.installer" class="vs-button primary" :href="item.installer">{{ text.download }} <small>.exe</small></a>
            <a v-if="item.portable" class="vs-button" :href="item.portable">{{ text.portable }}</a>
            <a v-if="item.release" class="vs-button" :href="item.release">{{ text.release }} ↗</a>
          </div>
          <div v-if="item.intro" class="vp-doc vs-notes" v-html="item.intro" />
          <section v-for="section in item.sections" :key="section.title" class="vs-section" :class="`kind-${section.kind}`">
            <h3>{{ sectionTitle(section.title) }}</h3>
            <div class="vp-doc vs-notes" v-html="section.html" />
          </section>
        </li>
      </ol>
    </div>
  </div>
</template>
