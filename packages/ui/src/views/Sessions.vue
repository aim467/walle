<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { NInput, NEmpty, NTag } from 'naive-ui';
import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';

interface Hit { assetId: number; tool: string; kind: string; role: string | null; time: string | null; title: string; snippet: string; path: string }
interface Msg { seq: number; role: string | null; ts: string | null; text: string }

const roleLabel: Record<string, string> = { user: '用户', assistant: '助手', developer: '系统注入', system: '系统' };
interface ToolDef { id: string; name: string; logo?: string; color: string }
const TOOLS: ToolDef[] = [
  { id: 'zcode', name: 'ZCode', color: 'linear-gradient(135deg,#0a84ff,#5e5ce6)' },
  { id: 'codex', name: 'Codex CLI', logo: openaiLogo, color: '#10a37f' },
  { id: 'cursor', name: 'Cursor', logo: cursorLogo, color: '#111' },
  { id: 'opencode', name: 'opencode', logo: opencodeLogo, color: '#111' },
];

const q = ref('');
const activeTool = ref<string | null>(null); // null = 跨工具搜索
const hits = ref<Hit[]>([]);
const allSessions = ref<Hit[]>([]);
const msgs = ref<Msg[]>([]);
const readTitle = ref('');
const readTool = ref('');

const toolStats = computed(() => {
  const m = new Map<string, { count: number; latest: string | null }>();
  for (const s of allSessions.value) {
    const cur = m.get(s.tool) ?? { count: 0, latest: null as string | null };
    cur.count++;
    if (!cur.latest || (s.time ?? '') > cur.latest) cur.latest = s.time;
    m.set(s.tool, cur);
  }
  return m;
});
const listTitle = computed(() =>
  activeTool.value ? `${TOOLS.find((t) => t.id === activeTool.value)?.name} · ${hits.value.length} 个会话` : (q.value.trim() ? `搜索「${q.value.trim()}」 · ${hits.value.length} 条结果` : '跨工具搜索'),
);

async function loadSessions() {
  allSessions.value = ((await (await fetch('/api/list?sessions=1&limit=2000')).json()).hits ?? []) as Hit[];
}
function selectTool(id: string | null) {
  activeTool.value = id;
  q.value = '';
  const p = new URLSearchParams({ sessions: '1' });
  if (id) p.set('tool', id);
  fetch('/api/list?' + p).then((r) => r.json()).then((d) => { hits.value = d.hits ?? []; });
}
async function doSearch() {
  if (!q.value.trim()) return;
  const p = new URLSearchParams({ q: q.value.trim() });
  if (activeTool.value) p.set('tool', activeTool.value);
  const d = await (await fetch('/api/list?' + p)).json();
  hits.value = d.hits ?? [];
}
async function openAsset(id: number) {
  msgs.value = [];
  readTitle.value = '加载中…';
  const d = await (await fetch('/api/read?asset=' + id)).json();
  readTool.value = d.tool ?? '';
  readTitle.value = (d.title ?? d.path ?? '') + (d.messages?.length ? ` · ${d.messages.length} 条消息` : '');
  msgs.value = d.messages ?? [];
}
function fmtTime(iso: string | null): string { return iso ? iso.replace('T', ' ').slice(0, 16).replace('Z', '') : ''; }

onMounted(async () => {
  await loadSessions();
  await selectTool(null);
  // 默认选中会话最多的工具
  let best: string | null = null, n = 0;
  for (const [t, s] of toolStats.value) if (s.count > n) { n = s.count; best = t; }
  if (best) selectTool(best);
});
</script>

<template>
  <div class="page-head">
    <div>
      <h2>会话</h2>
      <div class="dim small">按工具浏览历史会话 · 支持跨工具全文搜索</div>
    </div>
    <n-input v-model:value="q" placeholder="搜索会话内容…（Enter）" size="small" style="width:280px" round clearable @keydown.enter="doSearch" />
  </div>

  <div class="cols">
    <!-- 栏1：工具卡片 -->
    <div class="tools">
      <div class="tool-card card" :class="{ sel: activeTool === null }" @click="activeTool = null; doSearch()">
        <div class="tool-logo all">⌕</div>
        <div class="tool-meta">
          <div class="tool-name">跨工具搜索</div>
          <div class="dim small">{{ q.trim() ? `「${q.trim()}」` : '输入关键词，搜全部工具' }}</div>
        </div>
      </div>
      <div
        v-for="t in TOOLS" :key="t.id"
        class="tool-card card" :class="{ sel: activeTool === t.id }" @click="selectTool(t.id)"
      >
        <img v-if="t.logo" class="tool-logo" :src="t.logo" :alt="t.name">
        <div v-else class="tool-logo" :style="{ background: t.color }">W</div>
        <div class="tool-meta">
          <div class="tool-name">{{ t.name }}</div>
          <div class="dim small">
            {{ toolStats.get(t.id)?.count ?? 0 }} 个会话<template v-if="toolStats.get(t.id)?.latest"> · 最近 {{ fmtTime(toolStats.get(t.id)?.latest) }}</template>
          </div>
        </div>
      </div>
    </div>

    <!-- 栏2：会话列表 -->
    <div class="list">
      <div class="dim small list-title">{{ listTitle }}</div>
      <div v-if="!hits.length" class="card" style="padding:0">
        <n-empty :description="q.trim() ? '没有匹配的结果' : '选择一个工具查看会话'" style="padding:50px 0" />
      </div>
      <div v-for="(h, i) in hits" :key="i" class="card item" @click="openAsset(h.assetId)">
        <div class="meta">
          <n-tag v-if="!activeTool" size="tiny" :bordered="false" round>{{ h.tool }}</n-tag>
          <span class="dim small">{{ h.time ? fmtTime(h.time) : '' }}</span>
        </div>
        <div class="title">{{ h.title }}</div>
        <div class="sub dim small mono">{{ h.path.split('/').pop() === h.path ? h.path.split('\\').slice(-1)[0] : h.path.split(/[\\/]/).slice(-2, -1)[0] }}</div>
        <div v-if="h.snippet" class="snip dim" v-html="h.snippet"></div>
      </div>
    </div>

    <!-- 栏3：阅读器 -->
    <div class="reader">
      <div v-if="!msgs.length" class="card" style="padding:0">
        <n-empty description="选择会话阅读完整内容" style="padding:110px 0" />
      </div>
      <template v-else>
        <div class="read-head glassbar small dim">{{ readTitle }} · 来源 {{ readTool }}</div>
        <div v-for="(m, i) in msgs" :key="i" class="msg" :class="m.role || 'assistant'">
          <div class="who">{{ roleLabel[m.role ?? ''] ?? m.role ?? '未知' }}<template v-if="m.ts"> · {{ m.ts.replace('T', ' ').slice(0, 19) }}</template></div>
          <div class="body">{{ m.text }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; }
h2 { margin: 0 0 2px; font-size: 22px; font-weight: 700; }
.cols { display: flex; gap: 14px; align-items: flex-start; }
/* 栏1 */
.tools { width: 208px; flex-shrink: 0; display: flex; flex-direction: column; gap: 10px; }
.tool-card { display: flex; gap: 10px; align-items: center; padding: 11px 12px; cursor: pointer; transition: border-color .15s, transform .15s; }
.tool-card:hover { border-color: var(--accent); transform: translateY(-1px); }
.tool-card.sel { border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0, 113, 227, .18); }
.tool-logo {
  width: 34px; height: 34px; border-radius: 9px; object-fit: contain;
  background: #fff; border: 1px solid var(--border);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 700; font-size: 15px; flex-shrink: 0;
}
.tool-logo.all { background: var(--bg); color: var(--accent); font-size: 18px; border: 1px dashed var(--border); }
.tool-name { font-weight: 600; font-size: 13px; }
.tool-meta { min-width: 0; }
/* 栏2 */
.list { width: 380px; flex-shrink: 0; max-height: calc(100vh - 170px); overflow-y: auto; padding-right: 2px; }
.list-title { font-weight: 600; padding: 2px 4px 8px; }
.item { padding: 11px 14px; margin-bottom: 10px; cursor: pointer; transition: border-color .15s, transform .15s; }
.item:hover { border-color: var(--accent); transform: translateY(-1px); }
.meta { display: flex; gap: 8px; align-items: center; }
.title { font-weight: 600; margin: 4px 0 2px; font-size: 13.5px; }
.sub { font-size: 11px; }
.snip { font-size: 12px; margin-top: 4px; }
.snip :deep(mark) { background: rgba(0, 113, 227, .15); color: var(--accent); border-radius: 3px; padding: 0 2px; }
/* 栏3 */
.reader { flex: 1; min-width: 0; max-height: calc(100vh - 170px); overflow-y: auto; }
.read-head { position: sticky; top: 0; z-index: 5; padding: 8px 14px; margin-bottom: 12px; border-radius: 10px; }
.msg { border-radius: 16px; padding: 12px 16px; margin-bottom: 14px; max-width: 860px; white-space: pre-wrap; word-break: break-word; }
.msg .who { font-size: 11.5px; color: var(--dim); margin-bottom: 4px; font-weight: 600; }
.msg.user { background: rgba(0, 113, 227, .1); border: 1px solid rgba(0, 113, 227, .16); margin-left: 40px; }
.msg.assistant { background: var(--card-solid); border: 1px solid var(--border); box-shadow: var(--shadow); }
.msg.developer, .msg.system { background: var(--code-bg); border: 1px dashed var(--border); color: var(--dim); font-size: 13px; margin-right: 40px; }
</style>
