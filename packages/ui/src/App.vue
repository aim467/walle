<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NConfigProvider, NMessageProvider, darkTheme, type GlobalThemeOverrides } from 'naive-ui';
import Overview from './views/Overview.vue';
import Assets from './views/Assets.vue';
import Sessions from './views/Sessions.vue';
import Skills from './views/Skills.vue';
import Settings from './views/Settings.vue';
import walleMark from './assets/walle-mark.svg';

const route = ref(location.hash.slice(1) || '/');
window.addEventListener('hashchange', () => { route.value = location.hash.slice(1) || '/'; });

const nav = [
  { path: '/', label: '总览', icon: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z' },
  { path: '/assets', label: '资产库', icon: 'M3 5a2 2 0 012-2h5l2 2h7a2 2 0 012 2v11a2 2 0 01-2 2H5a2 2 0 01-2-2z' },
  { path: '/sessions', label: '会话', icon: 'M4 4h16a2 2 0 012 2v9a2 2 0 01-2 2H9l-5 4V6a2 2 0 012-2z' },
  { path: '/skills', label: '技能', icon: 'M13.6 21.3l-2.1-2.1a2 2 0 010-2.8 2 2 0 000-2.9 2 2 0 00-2.9 0 2 2 0 01-2.8 0L3.7 11.4a1.5 1.5 0 010-2.1l2.5-2.5a1 1 0 011.4 0l1.3 1.3a1.6 1.6 0 002.3-2.3L9.9 4.5a1 1 0 010-1.4L12.4.6a1.5 1.5 0 012.1 0l2.1 2.1a2 2 0 002.8 0 2 2 0 012.9 0 2 2 0 000 2.8l2.1 2.1a1.5 1.5 0 010 2.1l-2.5 2.5a1 1 0 01-1.4 0l-1.3-1.3a1.6 1.6 0 00-2.3 2.3l1.3 1.3a1 1 0 010 1.4l-2.5 2.5a1.5 1.5 0 01-2.1 0z' },
  { path: '/settings', label: '设置', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.4 4a8.4 8.4 0 00-.1-1.3l2-1.6-2-3.4-2.4 1a8.5 8.5 0 00-2.2-1.3L15.3 3h-4l-.4 2.4a8.5 8.5 0 00-2.2 1.3l-2.4-1-2 3.4 2 1.6a8.4 8.4 0 000 2.6l-2 1.6 2 3.4 2.4-1a8.5 8.5 0 002.2 1.3l.4 2.4h4l.4-2.4a8.5 8.5 0 002.2-1.3l2.4 1 2-3.4-2-1.6c.07-.43.1-.86.1-1.3z' },
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
            <img class="logo-mark" :src="walleMark" alt="walle">
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
            <Skills v-else-if="route.startsWith('/skills')" />
            <Settings v-else-if="route.startsWith('/settings')" />
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
  box-shadow: 0 2px 8px rgba(10, 132, 255, .35);
  display: block;
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
