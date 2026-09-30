<script setup lang="ts">
import { ref, onMounted } from 'vue';

const route = ref(location.hash.slice(1) || '/');
window.addEventListener('hashchange', () => { route.value = location.hash.slice(1) || '/'; });
function go(r: string) { location.hash = r; }

interface SourceInfo { tool: string; displayName: string }

const sources = ref<SourceInfo[]>([]);
onMounted(async () => {
  sources.value = (await (await fetch('/api/stats')).json()).sources;
});
</script>

<template>
  <header>
    <span class="logo" @click="go('/')">walle · 瓦力</span>
    <nav>
      <a :class="{ active: route === '/' }" href="#/">总览</a>
      <a :class="{ active: route.startsWith('/assets') }" href="#/assets">资产库</a>
      <a :class="{ active: route.startsWith('/sessions') }" href="#/sessions">会话</a>
    </nav>
  </header>
  <main>
    <div v-if="route === '/'">总览（建设中） sources={{ sources.length }}</div>
    <div v-else-if="route.startsWith('/assets')">资产库（建设中）</div>
    <div v-else-if="route.startsWith('/sessions')">会话（建设中）</div>
    <div v-else>404</div>
  </main>
</template>

<style scoped>
header{display:flex;gap:18px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--border);background:var(--panel);position:sticky;top:0;z-index:10}
.logo{font-weight:700;color:var(--accent);cursor:pointer;font-size:15px}
nav{display:flex;gap:12px}
nav a{color:var(--dim);padding:2px 8px;border-radius:6px;font-size:13px}
nav a.active{color:var(--text);background:var(--panel2)}
main{padding:16px 20px;max-width:1200px;margin:0 auto}
</style>
