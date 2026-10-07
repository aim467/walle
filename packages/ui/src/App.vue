<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useTheme } from './composables/useTheme';
import Toaster from './components/ui/Toaster.vue';
import Overview from './views/Overview.vue';
import Assets from './views/Assets.vue';
import Sessions from './views/Sessions.vue';
import Skills from './views/Skills.vue';
import Memories from './views/Memories.vue';
import Knowledge from './views/Knowledge.vue';
import Settings from './views/Settings.vue';
import walleMark from './assets/walle-mark.svg';

const route = ref(location.hash.slice(1) || '/');
window.addEventListener('hashchange', () => { route.value = location.hash.slice(1) || '/'; });

const nav = [
  { path: '/', label: '总览', icon: 'M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z' },
  { path: '/assets', label: '资产库', icon: 'M3 5a2 2 0 012-2h5l2 2h7a2 2 0 012 2v11a2 2 0 01-2 2H5a2 2 0 01-2-2z' },
  { path: '/sessions', label: '会话', icon: 'M4 4h16a2 2 0 012 2v9a2 2 0 01-2 2H9l-5 4V6a2 2 0 012-2z' },
  { path: '/skills', label: '技能', icon: 'M13.6 21.3l-2.1-2.1a2 2 0 010-2.8 2 2 0 000-2.9 2 2 0 00-2.9 0 2 2 0 01-2.8 0L3.7 11.4a1.5 1.5 0 010-2.1l2.5-2.5a1 1 0 011.4 0l1.3 1.3a1.6 1.6 0 002.3-2.3L9.9 4.5a1 1 0 010-1.4L12.4.6a1.5 1.5 0 012.1 0l2.1 2.1a2 2 0 002.8 0 2 2 0 012.9 0 2 2 0 000 2.8l2.1 2.1a1.5 1.5 0 010 2.1l-2.5 2.5a1 1 0 01-1.4 0l-1.3-1.3a1.6 1.6 0 00-2.3 2.3l1.3 1.3a1 1 0 010 1.4l-2.5 2.5a1.5 1.5 0 01-2.1 0z' },
  { path: '/memories', label: '记忆', icon: 'M9.5 2a3.5 3.5 0 00-3.37 4.46A4.5 4.5 0 003 10.5c0 1.4.64 2.65 1.64 3.47A4.25 4.25 0 008 21c.89 0 1.72-.27 2.4-.74.36-.24.6-.65.6-1.1V3.9c0-.6-.4-1.12-.98-1.25A3.6 3.6 0 009.5 2zM14.5 2a3.5 3.5 0 013.37 4.46A4.5 4.5 0 0121 10.5c0 1.4-.64 2.65-1.64 3.47A4.25 4.25 0 0116 21a3.97 3.97 0 01-2.4-.74c-.36-.24-.6-.65-.6-1.1V3.9c0-.6.4-1.12.98-1.25.17-.05.34-.06.52-.06z' },
  { path: '/knowledge', label: '知识库', icon: 'M6 2h12a1 1 0 011 1v18l-7-3.5L5 21V3a1 1 0 011-1zM8 6h8v2H8V6z' },
  { path: '/settings', label: '设置', icon: 'M12 8a4 4 0 100 8 4 4 0 000-8zm8.4 4a8.4 8.4 0 00-.1-1.3l2-1.6-2-3.4-2.4 1a8.5 8.5 0 00-2.2-1.3L15.3 3h-4l-.4 2.4a8.5 8.5 0 00-2.2 1.3l-2.4-1-2 3.4 2 1.6a8.4 8.4 0 000 2.6l-2 1.6 2 3.4 2.4-1a8.5 8.5 0 002.2 1.3l.4 2.4h4l.4-2.4a8.5 8.5 0 002.2-1.3l2.4 1 2-3.4-2-1.6c.07-.43.1-.86.1-1.3z' },
];

// 明暗主题（v1.25 shadcn 化）：全部页面吃 CSS 变量令牌
const { theme, toggle: toggleTheme } = useTheme();

const sources = ref(0);
onMounted(async () => {
  sources.value = ((await (await fetch('/api/stats')).json()).sources as unknown[]).length;
});

// 侧栏折叠（图标模式）；状态持久化，刷新保持
const collapsed = ref(localStorage.getItem('walle-sidebar') === 'collapsed');
function toggleSidebar() {
  collapsed.value = !collapsed.value;
  localStorage.setItem('walle-sidebar', collapsed.value ? 'collapsed' : 'expanded');
}
</script>

<template>
  <div>
      <div class="shell">
        <aside class="sidebar glassbar" :class="{ collapsed }">
          <div class="brand">
            <img class="logo-mark" :src="walleMark" alt="walle">
            <div v-if="!collapsed">
              <div class="brand-name">walle</div>
              <div class="brand-sub">瓦力 · {{ sources }} 个数据源</div>
            </div>
          </div>
          <nav>
            <a
              v-for="n in nav" :key="n.path" class="nav-item"
              :class="{ active: route === n.path || (n.path !== '/' && route.startsWith(n.path)) }"
              :href="'#' + n.path" :title="collapsed ? n.label : undefined"
            >
              <svg viewBox="0 0 24 24" width="16" height="16"><path :d="n.icon" fill="currentColor" /></svg>
              <span v-if="!collapsed">{{ n.label }}</span>
            </a>
          </nav>
          <!-- 底部操作区：整体贴底（仅容器 margin-top:auto，避免两个按钮各自 auto 把空白均分导致悬空） -->
          <div class="sidebar-actions">
            <!-- 明暗切换（v1.25）：月亮/太阳随主题换形 -->
            <button class="collapse-btn" :title="theme === 'dark' ? '切换到浅色' : '切换到深色'" @click="toggleTheme">
              <svg v-if="theme === 'dark'" viewBox="0 0 24 24" width="14" height="14"><path d="M12 4V2m0 20v-2m8-8h2M2 12h2m13.66-5.66l1.41-1.41M4.93 19.07l1.41-1.41m0-11.32L4.93 4.93m14.14 14.14l-1.41-1.41M12 8a4 4 0 100 8 4 4 0 000-8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
              <svg v-else viewBox="0 0 24 24" width="14" height="14"><path d="M21 12.8A8.5 8.5 0 1111.2 3a6.6 6.6 0 109.8 9.8z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
              <span v-if="!collapsed">{{ theme === 'dark' ? '浅色模式' : '深色模式' }}</span>
            </button>
            <button class="collapse-btn" :title="collapsed ? '展开侧栏' : '折叠侧栏'" @click="toggleSidebar">
              <svg viewBox="0 0 24 24" width="14" height="14"><path :d="collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
              <span v-if="!collapsed">折叠侧栏</span>
            </button>
          </div>
          <div v-if="!collapsed" class="sidebar-foot dim">
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
            <Memories v-else-if="route.startsWith('/memories')" />
            <Knowledge v-else-if="route.startsWith('/knowledge')" />
            <Settings v-else-if="route.startsWith('/settings')" />
            <div v-else class="dim" style="padding-top:120px;text-align:center">404</div>
          </main>
        </div>
      </div>
      <Toaster />
  </div>
</template>

<style scoped>
.shell { display: flex; min-height: 100vh; }
.sidebar {
  width: 224px; flex-shrink: 0; position: sticky; top: 0; height: 100vh;
  display: flex; flex-direction: column; padding: 14px 10px;
  border-right: 1px solid var(--border);
  transition: width .18s ease;
}
.sidebar.collapsed { width: 60px; padding-left: 8px; padding-right: 8px; }
.sidebar.collapsed .brand { justify-content: center; padding-left: 0; padding-right: 0; }
.sidebar.collapsed .nav-item { justify-content: center; padding-left: 0; padding-right: 0; }
.sidebar.collapsed .collapse-btn { justify-content: center; padding-left: 0; padding-right: 0; }
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
.nav-item:hover { background: var(--hover); }
.nav-item.active { background: var(--accent); color: #fff; }
.nav-item.active svg { color: #fff; }
.sidebar-actions { margin-top: auto; display: flex; flex-direction: column; gap: 2px; }
.collapse-btn {
  display: flex; gap: 8px; align-items: center;
  padding: 7px 12px; border-radius: 9px; border: none; background: transparent;
  color: var(--dim); font-size: 12px; font-weight: 500; cursor: pointer; white-space: nowrap;
}
.collapse-btn:hover { background: var(--hover); color: var(--text); }
.sidebar-foot { margin-top: 6px; padding: 10px 12px; font-size: 11px; line-height: 1.8; }
.content { flex: 1; min-width: 0; }
main { padding: 24px 40px 56px; max-width: 1680px; margin: 0 auto; width: 100%; }
</style>
