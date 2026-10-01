<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NConfigProvider, NMessageProvider, darkTheme, type GlobalThemeOverrides } from 'naive-ui';
import Overview from './views/Overview.vue';
import Assets from './views/Assets.vue';
import Sessions from './views/Sessions.vue';

const route = ref(location.hash.slice(1) || '/');
window.addEventListener('hashchange', () => { route.value = location.hash.slice(1) || '/'; });

const nav = [
  { path: '/', label: '总览', icon: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z' },
  { path: '/assets', label: '资产库', icon: 'M3 5a2 2 0 012-2h5l2 2h7a2 2 0 012 2v11a2 2 0 01-2 2H5a2 2 0 01-2-2z' },
  { path: '/sessions', label: '会话', icon: 'M4 4h16a2 2 0 012 2v9a2 2 0 01-2 2H9l-5 4V6a2 2 0 012-2z' },
];

// Apple 风格浅色主题（不用 darkTheme，仅保留类型引用以备切换）
void darkTheme;
const overrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#0071e3',
    primaryColorHover: '#0077ed',
    primaryColorPressed: '#0068d1',
    borderRadius: '10px',
    fontSize: '14px',
    fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue","PingFang SC","Microsoft YaHei UI",sans-serif',
    cardBorderRadius: '14px',
  },
  Card: { borderRadius: '14px' },
};

const sources = ref(0);
onMounted(async () => {
  sources.value = ((await (await fetch('/api/stats')).json()).sources as unknown[]).length;
});
</script>

<template>
  <n-config-provider :theme-overrides="overrides">
    <n-message-provider>
      <div class="shell">
        <aside class="sidebar glassbar">
          <div class="brand">
            <div class="logo-mark">W</div>
            <div>
              <div class="brand-name">walle</div>
              <div class="brand-sub">瓦力 · {{ sources }} 个数据源</div>
            </div>
          </div>
          <nav>
            <a
              v-for="n in nav" :key="n.path" class="nav-item"
              :class="{ active: route === n.path || (n.path !== '/' && route.startsWith(n.path)) }"
              :href="'#' + n.path"
            >
              <svg viewBox="0 0 24 24" width="16" height="16"><path :d="n.icon" fill="currentColor" /></svg>
              <span>{{ n.label }}</span>
            </a>
          </nav>
          <div class="sidebar-foot dim">
            <div>纯本地 · 无遥测</div>
            <div>Phase 0-4 · UI-1</div>
          </div>
        </aside>
        <div class="content">
          <main>
            <Overview v-if="route === '/'" />
            <Assets v-else-if="route.startsWith('/assets')" />
            <Sessions v-else-if="route.startsWith('/sessions')" />
            <div v-else class="dim" style="padding-top:120px;text-align:center">404</div>
          </main>
        </div>
      </div>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; }
.sidebar {
  width: 224px; flex-shrink: 0; position: sticky; top: 0; height: 100vh;
  display: flex; flex-direction: column; padding: 14px 10px;
  border-right: 1px solid var(--border);
}
.brand { display: flex; gap: 10px; align-items: center; padding: 4px 8px 16px; }
.logo-mark {
  width: 34px; height: 34px; border-radius: 9px;
  background: linear-gradient(135deg, #0a84ff, #5e5ce6);
  color: #fff; font-weight: 700; font-size: 17px;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2px 8px rgba(10, 132, 255, .35);
}
.brand-name { font-weight: 700; font-size: 15px; letter-spacing: .2px; }
.brand-sub { font-size: 11px; color: var(--dim); }
nav { display: flex; flex-direction: column; gap: 2px; }
.nav-item {
  display: flex; gap: 10px; align-items: center;
  padding: 7px 12px; border-radius: 9px;
  color: var(--text); font-size: 13.5px; font-weight: 500;
}
.nav-item svg { color: var(--dim); }
.nav-item:hover { background: rgba(0, 0, 0, .05); }
.nav-item.active { background: var(--accent); color: #fff; }
.nav-item.active svg { color: #fff; }
.sidebar-foot { margin-top: auto; padding: 10px 12px; font-size: 11px; line-height: 1.8; }
.content { flex: 1; min-width: 0; }
main { padding: 24px 40px 56px; max-width: 1680px; margin: 0 auto; width: 100%; }
</style>
