<script setup lang="ts">
import { computed } from "vue";
import { useData, withBase } from "vitepress";

// Screenshot of the real application, produced by scripts/site-screenshots.mjs with the fictional demo kit.
const props = defineProps<{ name: string; alt: string; lang?: "en" | "fr" }>();
const { lang: pageLang } = useData();
const folder = computed(() => props.lang || (pageLang.value.startsWith("fr") ? "fr" : "en"));
const src = computed(() => withBase(`/screenshots/${folder.value}/${props.name}.png`));
</script>

<template>
  <figure class="vs-shot">
    <img :src="src" :alt="alt" loading="lazy" decoding="async" width="1280" height="800">
  </figure>
</template>
