<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { withBase } from "vitepress";
import { data as built } from "../../github.data.mts";
import { RELEASES_URL, liveStats, merge, type GitHubStats } from "../github";
import { copy } from "../copy";
import Shot from "./Shot.vue";

const props = defineProps<{ lang: "en" | "fr" }>();
const c = computed(() => copy[props.lang]);
const live = ref<GitHubStats | null>(null);
const stats = computed(() => merge(built, live.value));
const locale = computed(() => (props.lang === "fr" ? "fr-FR" : "en-GB"));
const docs = (path: string) => (props.lang === "fr" ? `/fr${path}` : path);

onMounted(async () => { live.value = await liveStats(); });

const number = (value: number | null) => (value === null ? "—" : new Intl.NumberFormat(locale.value).format(value));
const date = (value: string | null) => (value === null ? "—"
    : new Intl.DateTimeFormat(locale.value, { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value)));
const installer = computed(() => stats.value.installer || RELEASES_URL);
const portable = computed(() => stats.value.portable || RELEASES_URL);
const cells = computed(() => [
    { label: c.value.stats.version, value: stats.value.version ?? "—", href: withBase(docs("/changelog")) + (stats.value.version ? `#v${stats.value.version.replace(/\./g, "-")}` : "") },
    { label: c.value.stats.published, value: date(stats.value.published) },
    { label: c.value.stats.downloads, value: number(stats.value.downloads) },
    { label: c.value.stats.stars, value: number(stats.value.stars), href: "https://github.com/shoyencode/vibe-studio/stargazers" },
    { label: c.value.stats.forks, value: number(stats.value.forks), href: "https://github.com/shoyencode/vibe-studio/forks" },
    { label: c.value.stats.issues, value: number(stats.value.openIssues), href: "https://github.com/shoyencode/vibe-studio/issues" },
    { label: c.value.stats.pushed, value: date(stats.value.pushed), href: "https://github.com/shoyencode/vibe-studio/commits/main" },
    { label: "CI", value: stats.value.ci ? c.value.stats.ci[stats.value.ci] : "—", state: stats.value.ci, href: stats.value.ciUrl || "https://github.com/shoyencode/vibe-studio/actions" },
    { label: c.value.stats.license, value: stats.value.license ?? "—", href: "https://github.com/shoyencode/vibe-studio/blob/main/LICENSE" },
]);
</script>

<template>
  <div class="vs-home">
    <section class="vs-hero" aria-labelledby="vs-title">
      <div class="vs-hero-text">
        <a class="vs-badge vs-ok" :href="withBase(docs('/changelog'))">{{ stats.version ? `v${stats.version} · ` : "" }}{{ c.platform }}</a>
        <h1 id="vs-title" class="vs-display"><span>{{ c.title[0] }}</span> {{ c.title[1] }}</h1>
        <p class="vs-lead" v-html="c.lead" />
        <ul class="vs-harnesses" :aria-label="c.harnessesLabel">
          <li v-for="harness in c.harnesses" :key="harness">{{ harness }}</li>
        </ul>
      </div>
      <div class="vs-hero-panel">
        <div class="vs-register" role="img" :aria-label="c.registerLabel">
          <div class="vs-register-head"><strong>{{ c.register.title }}</strong><small>{{ c.register.summary }}</small></div>
          <div v-for="(entry, index) in c.register.entries" :key="entry.title" class="vs-entry" :class="{ now: entry.state === 'wait' }" :style="{ '--i': index }">
            <time><span>{{ entry.date }}</span> <span>{{ entry.time }}</span></time>
            <div><strong>{{ entry.title }}</strong><small>{{ entry.file }}</small><span v-if="entry.guard" class="vs-guard">{{ entry.guard }}</span></div>
            <span class="vs-badge" :class="entry.state === 'wait' ? 'vs-wait' : 'vs-ok'">{{ entry.badge }}</span>
          </div>
        </div>
        <div class="vs-ask" :style="{ '--i': 3 }">
          <span class="vs-ask-who">{{ c.ask.who }}</span>
          <p class="vs-ask-question">{{ c.ask.question }}</p>
          <div class="vs-actions">
            <a class="vs-button primary" :href="installer">{{ c.ask.download }} <small>.exe{{ stats.version ? ` · v${stats.version}` : "" }}</small></a>
            <a class="vs-button" :href="portable">{{ c.ask.portable }}</a>
            <a class="vs-button" :href="withBase(docs('/guide/installation'))">{{ c.ask.guide }}</a>
          </div>
        </div>
        <p class="vs-caption">{{ c.register.caption }}</p>
      </div>
    </section>

    <section class="vs-strip-wrap" :aria-label="c.stats.label">
      <dl class="vs-strip">
        <div v-for="cell in cells" :key="cell.label">
          <dt>{{ cell.label }}</dt>
          <dd><a v-if="cell.href" :href="cell.href" :class="cell.state ? `vs-ci ${cell.state}` : ''">{{ cell.value }}</a><span v-else>{{ cell.value }}</span></dd>
        </div>
      </dl>
      <p class="vs-strip-note">{{ stats.live ? c.stats.live : c.stats.fallback }}</p>
    </section>

    <ol class="vs-story">
      <li v-for="(step, index) in c.steps" :key="step.title" class="vs-step" :class="{ current: index === c.steps.length - 1 }">
        <span class="vs-step-n">{{ c.stepLabel }} {{ String(index + 1).padStart(2, "0") }}</span>
        <div class="vs-step-body">
          <div>
            <h2 class="vs-display">{{ step.title }}</h2>
            <p v-html="step.text" />
            <a class="vs-more" :href="withBase(docs(step.link))">{{ step.more }} →</a>
          </div>
          <div class="vs-step-visual">
            <div v-if="step.visual === 'guard'" class="vs-panel vs-terminal" aria-hidden="true">
              <span class="m">$ {{ c.guard.command }}</span>
              <span class="x">✕ {{ c.guard.refused }}</span>
              <span class="w">{{ c.guard.reason }}</span>
            </div>
            <div v-else-if="step.visual === 'harnesses'" class="vs-harness-grid">
              <div v-for="harness in c.harnessCards" :key="harness.name" class="vs-panel">
                <strong>{{ harness.name }}</strong><code>{{ harness.command }}</code><small>{{ harness.note }}</small>
              </div>
            </div>
            <div v-else-if="step.visual === 'proposal'" class="vs-panel vs-proposal" aria-hidden="true">
              <span class="k">{{ c.proposal.kicker }}</span>
              <strong>{{ c.proposal.title }}</strong>
              <div class="vs-compare"><span>{{ c.proposal.before[0] }}</span><span>{{ c.proposal.after[0] }}</span><span>{{ c.proposal.before[1] }}</span><span class="mono">{{ c.proposal.after[1] }}</span></div>
              <div class="vs-actions end"><span class="vs-button">{{ c.proposal.edit }}</span><span class="vs-button">{{ c.proposal.reject }}</span><span class="vs-button primary">{{ c.proposal.accept }}</span></div>
            </div>
            <Shot v-else :name="step.visual" :alt="step.alt" :lang="lang" />
          </div>
        </div>
      </li>
    </ol>

    <section class="vs-final" aria-labelledby="vs-final-title">
      <div class="vs-ask">
        <span class="vs-ask-who">{{ c.final.who }}</span>
        <h2 id="vs-final-title" class="vs-display">{{ c.final.title }}</h2>
        <div class="vs-actions">
          <a class="vs-button primary" :href="installer">{{ c.ask.download }} <small>.exe{{ stats.version ? ` · v${stats.version}` : "" }}</small></a>
          <a class="vs-button" :href="portable">{{ c.ask.portable }}</a>
        </div>
        <p class="vs-requirements">{{ c.final.requirements }}</p>
      </div>
      <nav class="vs-docs" :aria-label="c.final.docsLabel">
        <a v-for="item in c.final.docs" :key="item.link" :href="withBase(docs(item.link))"><strong>{{ item.title }}</strong><small>{{ item.text }}</small></a>
      </nav>
    </section>
  </div>
</template>
