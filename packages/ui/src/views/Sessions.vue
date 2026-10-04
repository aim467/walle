<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, reactive } from 'vue';
import { NInput, NEmpty, NTag, NButton } from 'naive-ui';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });
import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';

interface Hit {
  assetId: number; subId: string; tool: string; kind: string; role: string | null;
  time: string | null; title: string; snippet: string; path: string;
  model?: string | null; projectPath?: string | null; messageCount?: number | null;
}
interface Msg { seq: number; role: string | null; ts: string | null; text: string; docType?: string }
interface ReadMeta { model: string | null; projectPath: string | null; startedAt: string | null; messageCount: number | null; subId: string }
interface ArtifactFile { name: string; size: number; mtime: string }

const roleLabel: Record<string, string> = { user: '用户', assistant: '助手', developer: '系统注入', system: '系统', tool: '工具' };
/** 角色头部样式元数据：头像类型与配色 */
const roleMeta: Record<string, { bg: string; fg: string; icon: string }> = {
  user: { bg: '#0071e3', fg: '#fff', icon: 'user' },
  assistant: { bg: '#1d1d1f', fg: '#fff', icon: 'tool-logo' },
  developer: { bg: '#e8e2f4', fg: '#5e5ce6', icon: 'gear' },
  system: { bg: '#ececec', fg: '#6e6e73', icon: 'gear' },
  tool: { bg: '#fff3d6', fg: '#b25000', icon: 'wrench' },
};
const SVG_ICONS: Record<string, string> = {
  user: 'M12 12a4.5 4.5 0 100-9 4.5 4.5 0 000 9zm0 2c-4 0-7.5 2-7.5 4.5V21h15v-2.5c0-2.5-3.5-4.5-7.5-4.5z',
  gear: 'M12 8.5A3.5 3.5 0 1012 15.5 3.5 3.5 0 0012 8.5zm8.9 4.9l-1.8-1a6.9 6.9 0 000-2.8l1.8-1a1 1 0 00.4-1.3l-1.5-2.6a1 1 0 00-1.3-.4l-1.8 1a7 7 0 00-2.4-1.4V2a1 1 0 00-1-1h-3a1 1 0 00-1 1v1.9a7 7 0 00-2.4 1.4l-1.8-1a1 1 0 00-1.3.4L3.3 6.9a1 1 0 00.4 1.3l1.8 1a6.9 6.9 0 000 2.8l-1.8 1a1 1 0 00-.4 1.3l1.5 2.6a1 1 0 001.3.4l1.8-1a7 7 0 002.4 1.4V19a1 1 0 001 1h3a1 1 0 001-1v-1.9a7 7 0 002.4-1.4l1.8 1a1 1 0 001.3-.4l1.5-2.6a1 1 0 00-.4-1.3z',
  wrench: 'M21.7 5.3l-4-4a1 1 0 00-1.4 0l-2.5 2.5a5.5 5.5 0 00-6.9 6.9L1.3 16.3a1 1 0 000 1.4l5 5a1 1 0 001.4 0l5.6-5.6a5.5 5.5 0 006.9-6.9l2.5-2.5a1 1 0 000-1.4zM7.5 19.1l-2.6-2.6 3-3 2.6 2.6z',
};
interface ToolDef { id: string; name: string; logo?: string; letter: string; color: string }
const TOOLS: ToolDef[] = [
  { id: 'zcode', name: 'ZCode', logo: zcodeLogo, letter: 'Z', color: 'linear-gradient(135deg,#0a84ff,#5e5ce6)' },
  { id: 'codex', name: 'Codex CLI', logo: openaiLogo, letter: 'C', color: '#10a37f' },
  { id: 'cursor', name: 'Cursor', logo: cursorLogo, letter: 'C', color: '#111' },
  { id: 'opencode', name: 'OpenCode', logo: opencodeLogo, letter: 'O', color: '#111' },
  { id: 'workbuddy', name: 'WorkBuddy', logo: workbuddyLogo, letter: 'W', color: 'linear-gradient(135deg,#0a84ff,#5e5ce6)' },
];

const activeTool = ref<string | null>(null); // null = 全部工具
const hits = ref<Hit[]>([]);
const allSessions = ref<Hit[]>([]);
const globalQ = ref('');
const listQ = ref('');
const msgs = ref<Msg[]>([]);
const readMeta = ref<{ title: string | null; tool: string; meta: ReadMeta | null } | null>(null);
const curKey = ref('');
const detailTab = ref<'msgs' | 'overview' | 'tools' | 'files' | 'system' | 'raw'>('msgs');
const rawText = ref<string | null>(null);
const rawLoading = ref(false);

const toolStats = computed(() => {
  const m = new Map<string, { count: number }>();
  for (const s of allSessions.value) m.set(s.tool, { count: (m.get(s.tool)?.count ?? 0) + 1 });
  return m;
});
const totalCount = computed(() => allSessions.value.length);
const listTitle = computed(() => {
  const name = activeTool.value ? (TOOLS.find((t) => t.id === activeTool.value)?.name ?? activeTool.value) : '全部工具';
  return `${name} · ${hits.value.length} 个会话`;
});
const listFiltered = computed(() => {
  if (!listQ.value.trim()) return hits.value;
  const s = listQ.value.toLowerCase();
  return hits.value.filter((h) => (h.title ?? '').toLowerCase().includes(s) || (h.projectPath ?? '').toLowerCase().includes(s) || (h.model ?? '').toLowerCase().includes(s));
});
const FOLD_CHARS = 2048;
/** 超长消息折叠状态（按消息对象弱引用，切换会话自动失效） */
const expandedMsgs = reactive(new WeakSet<Msg>());
const isLongMsg = (m: Msg) => m.text.length > FOLD_CHARS;
const isCollapsed = (m: Msg) => isLongMsg(m) && !expandedMsgs.has(m);
function toggleMsg(m: Msg) {
  if (expandedMsgs.has(m)) expandedMsgs.delete(m);
  else expandedMsgs.add(m);
}
function clipText(m: Msg) {
  // 折叠时截到最近的换行，避免半行割裂
  let cut = m.text.slice(0, FOLD_CHARS);
  const nl = cut.lastIndexOf('\n');
  if (nl > FOLD_CHARS * 0.7) cut = cut.slice(0, nl);
  return cut;
}

/** assistant 消息 Markdown 渲染（DOMPurify 消毒；折叠消息以截断文本为源渲染摘要） */
function mdHtml(m: Msg): string {
  const src = isCollapsed(m) ? clipText(m) : m.text;
  return DOMPurify.sanitize(marked.parse(src) as string);
}

const toolMsgs = computed(() => msgs.value.filter((m) => m.role === 'tool'));
const systemMsgs = computed(() => msgs.value.filter((m) => m.role === 'developer' || m.role === 'system'));
const visibleMsgs = computed(() => msgs.value.filter((m) => m.role !== 'tool'));

/** Files 页签：会话涉及的文件（来自工具调用路径提取，session_file 文档按路径聚合） */
const fileGroups = computed(() => {
  const m = new Map<string, { path: string; count: number; lastTs: string | null }>();
  for (const f of msgs.value) {
    if (f.docType !== 'session_file') continue;
    const g = m.get(f.text) ?? { path: f.text, count: 0, lastTs: null };
    g.count++;
    if (f.ts && (!g.lastTs || f.ts > g.lastTs)) g.lastTs = f.ts;
    m.set(f.text, g);
  }
  return [...m.values()].sort((a, b) => (b.lastTs ?? '').localeCompare(a.lastTs ?? ''));
});

/** ZCode 工具结果转储（artifacts）：不入资产库，Files 页签按需读取 */
const artifacts = ref<ArtifactFile[] | null>(null);
const artifactPreview = ref<{ name: string; text: string; truncated: boolean } | null>(null);
const artifactLoading = ref(false);
async function loadArtifacts() {
  artifactPreview.value = null;
  artifacts.value = null;
  if (readMeta.value?.tool !== 'zcode' || !readMeta.value.meta?.subId) return;
  artifactLoading.value = true;
  try {
    const p = new URLSearchParams({ asset: String(currentAssetId()), sub: readMeta.value.meta.subId });
    const d = await (await fetch('/api/artifacts?' + p)).json();
    artifacts.value = d.files ?? [];
  } catch {
    artifacts.value = [];
  } finally {
    artifactLoading.value = false;
  }
}
async function previewArtifact(name: string) {
  const p = new URLSearchParams({ asset: String(currentAssetId()), sub: readMeta.value?.meta?.subId ?? '', file: name });
  try {
    const d = await (await fetch('/api/artifacts?' + p)).json();
    artifactPreview.value = d.error
      ? { name, text: `（${d.error}）`, truncated: false }
      : { name, text: d.text ?? '', truncated: !!d.truncated };
  } catch {
    artifactPreview.value = { name, text: '（读取失败）', truncated: false };
  }
}
function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
const toolLogo = computed(() => TOOLS.find((t) => t.id === readMeta.value?.tool)?.logo);
function copyMsg(text: string) {
  navigator.clipboard?.writeText(text).catch(function () { /* 剪贴板不可用时静默 */ });
}

/** 用户消息锚点导航：只定位真实用户输入（排除环境上下文/权限注入等 user 角色的系统块） */
const isInjected = (t: string) =>
  t.startsWith('<environment_context>') || t.startsWith('<permissions') || t.startsWith('<skills_');
const userAnchors = computed(() =>
  visibleMsgs.value
    .map((m, i) => ({ idx: i, ts: m.ts, text: m.text }))
    .filter((x) => x.text && visibleMsgs.value[x.idx].role === 'user' && !isInjected(x.text)),
);
const activeAnchor = ref(-1);
function jumpToUser(idx: number) {
  activeAnchor.value = idx;
  const el = document.getElementById('umsg-' + idx);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('anchor-flash');
    setTimeout(function () { el.classList.remove('anchor-flash'); }, 1600);
  }
}

async function loadSessions() {
  allSessions.value = ((await (await fetch('/api/list?sessions=1&limit=2000')).json()).hits ?? []) as Hit[];
}
function selectTool(id: string | null) {
  activeTool.value = id;
  listQ.value = '';
  const p = new URLSearchParams({ sessions: '1' });
  if (id) p.set('tool', id);
  fetch('/api/list?' + p).then((r) => r.json()).then((d) => { hits.value = d.hits ?? []; });
}
async function globalSearch() {
  if (!globalQ.value.trim()) return;
  activeTool.value = null;
  listQ.value = '';
  const d = await (await fetch('/api/list?q=' + encodeURIComponent(globalQ.value.trim()))).json();
  hits.value = d.hits ?? [];
}
async function openAsset(h: Hit) {
  const p = new URLSearchParams({ asset: String(h.assetId) });
  if (h.subId) p.set('sub', h.subId);
  const d = await (await fetch('/api/read?' + p)).json();
  readMeta.value = { title: d.title ?? h.title, tool: d.tool, meta: d.meta ?? null };
  curKey.value = h.assetId + '|' + (h.subId ?? '');
  msgs.value = d.messages ?? [];
  detailTab.value = 'msgs';
  rawText.value = null;
}
async function loadRaw() {
  if (!readMeta.value) return;
  const p = new URLSearchParams({ asset: String(currentAssetId()), raw: '1' });
  rawLoading.value = true;
  try {
    const d = await (await fetch('/api/source?' + p)).json();
    rawText.value = d.error ? `（${d.error}）` : d.content + (d.truncated ? '\n…（超过 512KB，已截断）' : '');
  } finally {
    rawLoading.value = false;
  }
}
function currentAssetId(): number {
  const cur = listFiltered.value.find((h) => h.title === readMeta.value?.title) ?? hits.value[0];
  return cur ? cur.assetId : 0;
}
function fmtDate(iso: string | null): string { return iso ? iso.slice(0, 10) : ''; }
function fmtHM(iso: string | null): string { return iso ? iso.slice(11, 16) : ''; }
function fmtFull(iso: string | null): string { return iso ? iso.replace('T', ' ').slice(0, 19) : '-'; }

// 列表拖拽调宽
const listW = ref(380);
let resizing = false;
function startResize(e: MouseEvent) {
  resizing = true;
  e.preventDefault();
}
function onMove(e: MouseEvent) {
  if (!resizing) return;
  listW.value = Math.min(680, Math.max(260, e.clientX - 232)); // 232 = 侧栏宽 + 容器起点
}
function stopResize() { resizing = false; }
onMounted(() => {
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', stopResize);
});
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', stopResize);
});

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
  <div class="page">
    <!-- 顶部 52px 工具 Tab 栏 -->
    <div class="toolbar glassbar">
      <button class="tab" :class="{ on: activeTool === null }" @click="selectTool(null)">
        <span class="tab-dot" style="background:#8e8e93;color:#fff">A</span>
        <span class="tab-name">全部工具</span>
        <span class="tab-n">{{ totalCount }}</span>
      </button>
      <button
        v-for="t in TOOLS" :key="t.id" class="tab" :class="{ on: activeTool === t.id }" @click="selectTool(t.id)"
      >
        <img v-if="t.logo" class="tab-logo" :src="t.logo" :alt="t.name">
        <span v-else class="tab-dot" :style="{ background: t.color }">{{ t.letter }}</span>
        <span class="tab-name">{{ t.name }}</span>
        <span class="tab-n">{{ toolStats.get(t.id)?.count ?? 0 }}</span>
      </button>
      <span class="flex1" />
      <n-input v-model:value="globalQ" placeholder="全局搜索（跨工具，Enter）" size="small" round clearable style="width:300px" @keydown.enter="globalSearch" />
    </div>

    <div class="body">
      <!-- 会话列表（可拖宽） -->
      <div class="list card" :style="{ width: listW + 'px' }">
        <div class="list-head">
          <strong class="small">{{ listTitle }}</strong>
          <span class="dim small">最近更新</span>
        </div>
        <div class="list-search">
          <n-input v-model:value="listQ" placeholder="搜索当前列表…" size="small" round clearable />
        </div>
        <div class="list-scroll">
          <div v-for="(h, i) in listFiltered" :key="i" class="s-item" :class="{ sel: curKey === h.assetId + '|' + (h.subId ?? '') }" @click="openAsset(h)">
            <div class="s-top">
              <span class="dim small">{{ fmtDate(h.time) }}</span>
              <span class="dim small">{{ fmtHM(h.time) }}</span>
            </div>
            <div class="s-title">{{ h.title }}</div>
            <div class="dim small">{{ h.model ?? '未知模型' }}<template v-if="h.messageCount"> · {{ h.messageCount }} 条消息</template></div>
            <div class="dim small s-path">{{ h.projectPath ?? h.path }}</div>
          </div>
          <n-empty :description="listQ ? '没有匹配的会话' : '选择上方工具查看会话'" size="small" style="padding:36px 0" />
        </div>
      </div>
      <div class="resizer" title="拖动调整宽度" @mousedown="startResize" />

      <!-- 详情 -->
      <div class="detail card">
        <template v-if="readMeta">
          <div class="d-head">
            <div class="d-title">{{ readMeta.title }}</div>
            <div class="d-tags">
              <n-tag size="tiny" :bordered="false" round type="primary">{{ TOOLS.find((t) => t.id === readMeta.tool)?.name ?? readMeta.tool }}</n-tag>
              <n-tag v-if="readMeta.meta?.model" size="tiny" :bordered="false" round>{{ readMeta.meta.model }}</n-tag>
              <n-tag v-if="msgs.length" size="tiny" :bordered="false" round>{{ msgs.length }} 条消息</n-tag>
              <n-tag v-if="readMeta.meta?.startedAt" size="tiny" :bordered="false" round>{{ fmtFull(readMeta.meta.startedAt) }}</n-tag>
            </div>
            <div class="d-actions">
              <n-button size="tiny" round quaternary title="复制标题">⧉</n-button>
              <n-button size="tiny" round quaternary title="回到顶部">↑</n-button>
              <n-button size="tiny" round quaternary title="更多">…</n-button>
            </div>
          </div>
          <div class="d-tabs glassbar">
            <button v-for="t in [
              { k: 'msgs', label: '消息' }, { k: 'overview', label: '概览' }, { k: 'tools', label: 'Tools' },
              { k: 'files', label: 'Files' }, { k: 'system', label: 'System' }, { k: 'raw', label: 'Raw' },
            ]" :key="t.k" class="d-tab" :class="{ on: detailTab === t.k }"
              @click="detailTab = t.k; if (t.k === 'raw' && rawText === null) loadRaw(); if (t.k === 'files') loadArtifacts()">
              {{ t.label }}
            </button>
          </div>
          <div class="d-body">
            <!-- 消息 -->
            <div v-if="detailTab === 'msgs'" class="msgs-wrap">
              <div class="msgs-flow">
                <div
                  v-for="(m, i) in visibleMsgs" :key="i" class="msg-row"
                  :id="m.role === 'user' ? 'umsg-' + i : undefined"
                >
                <div class="m-avatar" :style="{ background: (roleMeta[m.role ?? ''] ?? roleMeta.system).bg }">
                  <img
                    v-if="(roleMeta[m.role ?? ''] ?? roleMeta.system).icon === 'tool-logo' && toolLogo"
                    :src="toolLogo" alt=""
                  >
                  <svg v-else viewBox="0 0 24 24" width="13" height="13">
                    <path :d="SVG_ICONS[(roleMeta[m.role ?? ''] ?? roleMeta.system).icon]" :fill="(roleMeta[m.role ?? ''] ?? roleMeta.system).fg" />
                  </svg>
                </div>
                <div class="m-main">
                  <div class="m-head">
                    <span class="m-name">{{ roleLabel[m.role ?? ''] ?? m.role ?? '未知' }}</span>
                    <span v-if="m.ts" class="dim small m-time">{{ fmtFull(m.ts) }}</span>
                    <span class="m-copy" title="复制内容" @click="copyMsg(m.text)">⧉</span>
                  </div>
                  <div
                    v-if="m.role === 'assistant'"
                    class="msg assistant md"
                    :class="{ clamped: isCollapsed(m) }"
                    v-html="mdHtml(m)"
                  ></div>
                  <div v-else class="msg" :class="[m.role || 'assistant', { clamped: isCollapsed(m) }]">{{ isCollapsed(m) ? clipText(m) : m.text }}</div>
                  <button v-if="isLongMsg(m)" class="fold-btn" @click="toggleMsg(m)">
                    {{ isCollapsed(m) ? `展开全文 · 共 ${m.text.length.toLocaleString()} 字符` : '收起' }}
                  </button>
                </div>
                </div>
              </div>
              <!-- 用户消息锚点导航 -->
              <aside v-if="userAnchors.length" class="anchor-nav">
                <div class="dim small an-head">用户消息 · {{ userAnchors.length }}</div>
                <button
                  v-for="(a, i) in userAnchors" :key="i"
                  class="an-item" :class="{ on: activeAnchor === a.idx }"
                  :title="a.text.slice(0, 120)"
                  @click="jumpToUser(a.idx)"
                >
                  <span class="an-idx">{{ i + 1 }}</span>
                  <span class="an-text">{{ a.text.replace(/\s+/g, ' ').slice(0, 26) }}</span>
                </button>
              </aside>
            </div>
            <!-- 概览 -->
            <div v-else-if="detailTab === 'overview'" class="overview">
              <div class="ov-grid">
                <div class="ov-item" v-for="f in [
                  ['模型', readMeta.meta?.model ?? '-'], ['项目', readMeta.meta?.projectPath ?? '-'],
                  ['开始时间', fmtFull(readMeta.meta?.startedAt ?? null)], ['消息数', String(msgs.length)],
                  ['会话 ID', readMeta.meta?.subId ?? '-'], ['来源', TOOLS.find((t) => t.id === readMeta.tool)?.name ?? readMeta.tool],
                ]" :key="f[0]">
                  <div class="dim small">{{ f[0] }}</div>
                  <div class="mono small">{{ f[1] }}</div>
                </div>
              </div>
              <div class="dim small" style="margin-top:14px">token 用量与耗时统计将随会话解析增强提供</div>
            </div>
            <!-- Tools -->
            <div v-else-if="detailTab === 'tools'">
              <div v-if="toolMsgs.length">
                <div v-for="(m, i) in toolMsgs" :key="i" class="msg-block">
                  <div class="who">工具 · {{ fmtFull(m.ts) }}</div>
                  <div class="msg" :class="['tool', { clamped: isCollapsed(m) }]">{{ isCollapsed(m) ? clipText(m) : m.text }}</div>
                  <button v-if="isLongMsg(m)" class="fold-btn" @click="toggleMsg(m)">
                    {{ isCollapsed(m) ? `展开全文 · 共 ${m.text.length.toLocaleString()} 字符` : '收起' }}
                  </button>
                </div>
              </div>
              <n-empty v-else description="本会话未解析到工具调用记录（结构化工具调用解析将随会话解析增强提供）" style="padding:60px 0" />
            </div>
            <!-- Files -->
            <div v-else-if="detailTab === 'files'" class="overview">
              <div class="ov-item">
                <div class="dim small">项目路径</div>
                <div class="mono small">{{ readMeta.meta?.projectPath ?? '（未记录）' }}</div>
              </div>
              <div class="ov-item" style="margin-top:14px">
                <div class="dim small" style="margin-bottom:6px">涉及文件 · {{ fileGroups.length }}</div>
                <template v-if="fileGroups.length">
                  <div v-for="g in fileGroups" :key="g.path" class="mono small" style="display:flex; gap:12px; justify-content:space-between; padding:3px 0" :title="g.path">
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ g.path }}</span>
                    <span class="dim" style="white-space:nowrap">{{ g.count }} 次{{ g.lastTs ? ' · ' + fmtFull(g.lastTs) : '' }}</span>
                  </div>
                </template>
                <div v-else class="dim small">本会话未解析到文件级记录（来自工具调用的路径提取）</div>
              </div>
              <div v-if="readMeta.tool === 'zcode'" class="ov-item" style="margin-top:14px">
                <div class="dim small" style="margin-bottom:6px">工具结果转储（artifacts · 按需读取原文）</div>
                <div v-if="artifactLoading" class="dim small">加载中…</div>
                <template v-else-if="artifacts && artifacts.length">
                  <button
                    v-for="a in artifacts" :key="a.name" class="mono small"
                    style="display:flex; gap:12px; justify-content:space-between; width:100%; padding:3px 0; border:none; background:none; cursor:pointer; text-align:left"
                    :title="a.name + '（点击预览）'"
                    @click="previewArtifact(a.name)"
                  >
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ a.name }}</span>
                    <span class="dim" style="white-space:nowrap">{{ fmtSize(a.size) }}</span>
                  </button>
                </template>
                <div v-else-if="artifacts" class="dim small">本会话没有转储文件</div>
              </div>
              <pre v-if="artifactPreview" class="raw" style="margin-top:12px; max-height:420px; overflow:auto">{{ artifactPreview.text + (artifactPreview.truncated ? '\n…（超过 512KB，已截断）' : '') }}</pre>
            </div>
            <!-- System -->
            <div v-else-if="detailTab === 'system'">
              <div v-if="systemMsgs.length">
                <div v-for="(m, i) in systemMsgs" :key="i" class="msg-block">
                  <div class="who">{{ roleLabel[m.role ?? ''] ?? m.role }} · {{ fmtFull(m.ts) }}</div>
                  <div class="msg" :class="['developer', { clamped: isCollapsed(m) }]">{{ isCollapsed(m) ? clipText(m) : m.text }}</div>
                  <button v-if="isLongMsg(m)" class="fold-btn" @click="toggleMsg(m)">
                    {{ isCollapsed(m) ? `展开全文 · 共 ${m.text.length.toLocaleString()} 字符` : '收起' }}
                  </button>
                </div>
              </div>
              <n-empty v-else description="本会话没有系统注入消息" style="padding:60px 0" />
            </div>
            <!-- Raw -->
            <div v-else-if="detailTab === 'raw'">
              <div v-if="rawLoading" class="dim small" style="padding:20px">加载中…</div>
              <pre v-else-if="rawText !== null" class="raw">{{ rawText }}</pre>
              <n-empty v-else description="选择会话后加载原文" style="padding:60px 0" />
            </div>
          </div>
        </template>
        <n-empty v-else description="从左侧选择一个会话" style="margin:auto" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { margin: -24px -40px -56px; }
/* 52px Tab 栏 */
.toolbar {
  height: 52px; display: flex; gap: 6px; align-items: center;
  padding: 0 14px; position: sticky; top: 0; z-index: 20;
}
.tab {
  display: flex; gap: 7px; align-items: center; height: 36px;
  background: transparent; border: none; border-radius: 9px;
  padding: 0 12px; cursor: pointer; color: var(--text); font-size: 13px; font-weight: 500;
}
.tab:hover { background: rgba(0, 0, 0, .05); }
.tab.on { background: var(--accent); color: #fff; }
.tab-logo { width: 18px; height: 18px; border-radius: 4px; object-fit: contain; background: #fff; }
.tab-dot {
  width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: #fff;
}
.tab-n { color: var(--dim); font-size: 12px; }
.tab.on .tab-n { color: rgba(255, 255, 255, .8); }
.flex1 { flex: 1; }
/* 三区 */
.body { display: flex; gap: 0; align-items: stretch; height: calc(100vh - 52px - 2px); }
.list { flex-shrink: 0; display: flex; flex-direction: column; border-radius: 0; border: none; border-right: 1px solid var(--border); box-shadow: none; overflow: hidden; }
.list-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px 4px; }
.list-search { padding: 6px 14px 10px; border-bottom: 1px solid var(--border); }
.list-scroll { flex: 1; overflow-y: auto; padding: 8px; }
.s-item { border-radius: 10px; padding: 9px 11px; cursor: pointer; margin-bottom: 2px; }
.s-item:hover { background: var(--bg); }
.s-item.sel { background: rgba(0, 113, 227, .1); outline: 1.5px solid var(--accent); }
.s-top { display: flex; justify-content: space-between; font-size: 11.5px; }
.s-title { font-weight: 600; font-size: 13px; margin: 2px 0; word-break: break-all; }
.s-path { font-size: 11px; word-break: break-all; }
.resizer { width: 5px; cursor: col-resize; flex-shrink: 0; background: transparent; }
.resizer:hover, .resizer:active { background: rgba(0, 113, 227, .25); }
/* 详情 */
.detail { flex: 1; min-width: 0; display: flex; flex-direction: column; border-radius: 0; border: none; box-shadow: none; overflow: hidden; }
.d-head { display: flex; gap: 12px; align-items: center; padding: 12px 18px 8px; }
.d-title { font-size: 17px; font-weight: 700; flex: 1; min-width: 0; word-break: break-all; }
.d-tags { display: flex; gap: 5px; flex-wrap: wrap; }
.d-actions { display: flex; gap: 2px; }
.d-tabs { display: flex; gap: 2px; padding: 0 14px; position: sticky; top: 0; z-index: 10; }
.d-tab {
  background: transparent; border: none; padding: 8px 14px; cursor: pointer;
  font-size: 13px; color: var(--dim); border-radius: 8px 8px 0 0; border-bottom: 2px solid transparent;
}
.d-tab:hover { color: var(--text); }
.d-tab.on { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
.d-body { flex: 1; overflow-y: auto; padding: 16px 22px 40px; }
/* 消息行：头像 + 头部 + 气泡 */
.msg-row { display: flex; gap: 11px; margin-bottom: 18px; }
.m-avatar {
  width: 24px; height: 24px; border-radius: 7px; flex-shrink: 0; margin-top: 2px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; box-shadow: 0 1px 3px rgba(0, 0, 0, .12);
}
.m-avatar img { width: 100%; height: 100%; object-fit: cover; }
.m-main { flex: 1; min-width: 0; }
.m-head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 5px; }
.m-name { font-size: 12.5px; font-weight: 700; letter-spacing: .3px; }
.m-time { font-size: 11.5px; }
.m-copy {
  margin-left: auto; cursor: pointer; color: var(--dim); font-size: 12px;
  opacity: 0; transition: opacity .12s; padding: 0 4px; border-radius: 4px;
}
.m-copy:hover { color: var(--accent); background: rgba(0, 113, 227, .08); }
.msg-row:hover .m-copy { opacity: 1; }
.msg { border-radius: 12px; padding: 11px 15px; white-space: pre-wrap; word-break: break-word; font-size: 13.5px; position: relative; overflow: hidden; }
.msg.clamped { -webkit-mask-image: linear-gradient(to bottom, #000 78%, transparent 99%); mask-image: linear-gradient(to bottom, #000 78%, transparent 99%); max-height: 560px; }
.fold-btn {
  display: inline-flex; align-items: center; gap: 4px; margin-top: 6px;
  background: var(--card-solid); border: 1px solid var(--border); border-radius: 100px;
  padding: 3px 14px; font-size: 12px; color: var(--accent); cursor: pointer; transition: all .15s;
}
.fold-btn:hover { border-color: var(--accent); box-shadow: var(--shadow); }
/* 用户消息锚点导航 */
.msgs-wrap { display: flex; gap: 12px; align-items: flex-start; }
.msgs-flow { flex: 1; min-width: 0; }
.msg-row { scroll-margin-top: 64px; }
.anchor-nav {
  width: 190px; flex-shrink: 0; position: sticky; top: 6px;
  max-height: calc(100vh - 340px); overflow-y: auto;
  background: rgba(255, 255, 255, .82); backdrop-filter: blur(14px);
  border: 1px solid var(--border); border-radius: 12px; padding: 8px;
  box-shadow: var(--shadow);
}
.an-head { font-weight: 700; padding: 4px 8px 8px; }
.an-item {
  display: flex; gap: 7px; align-items: baseline; width: 100%;
  background: transparent; border: none; border-radius: 8px;
  padding: 5px 8px; cursor: pointer; text-align: left; font-size: 12px; color: var(--text);
}
.an-item:hover { background: var(--bg); }
.an-item.on { background: rgba(0, 113, 227, .12); }
.an-idx {
  flex-shrink: 0; width: 16px; height: 16px; border-radius: 50%;
  background: rgba(0, 113, 227, .14); color: var(--accent);
  font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;
  align-self: center;
}
.an-item.on .an-idx { background: var(--accent); color: #fff; }
.an-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 锚点定位闪烁 */
.msg-row.anchor-flash .msg { outline: 2px solid var(--accent); border-radius: 12px; transition: outline-color 1s; }
.msg.user { background: rgba(0, 113, 227, .09); border: 1px solid rgba(0, 113, 227, .15); }
.msg.assistant { background: var(--card-solid); border: 1px solid var(--border); box-shadow: var(--shadow); }
/* Markdown 渲染（assistant 消息）：块级排版覆盖 pre-wrap */
.msg.md { white-space: normal; line-height: 1.6; }
.msg.md > :first-child { margin-top: 0; }
.msg.md > :last-child { margin-bottom: 0; }
.msg.md p { margin: 0 0 8px; }
.msg.md h1, .msg.md h2, .msg.md h3, .msg.md h4 { margin: 14px 0 8px; line-height: 1.35; }
.msg.md h1 { font-size: 17px; } .msg.md h2 { font-size: 15.5px; } .msg.md h3 { font-size: 14.5px; } .msg.md h4 { font-size: 13.5px; }
.msg.md ul, .msg.md ol { margin: 6px 0; padding-left: 22px; }
.msg.md li { margin: 2px 0; }
.msg.md li > p { margin: 0; }
.msg.md code { background: rgba(0, 0, 0, .06); padding: 1px 5px; border-radius: 5px; font-size: 12.5px; font-family: ui-monospace, Menlo, Consolas, 'Courier New', monospace; }
.msg.md pre { background: #f6f6f7; border: 1px solid var(--border); border-radius: 9px; padding: 10px 12px; overflow-x: auto; margin: 8px 0; }
.msg.md pre code { background: none; padding: 0; font-size: 12px; line-height: 1.5; }
.msg.md blockquote { border-left: 3px solid var(--border); margin: 8px 0; padding: 2px 12px; color: var(--dim); }
.msg.md table { border-collapse: collapse; margin: 8px 0; display: block; overflow-x: auto; max-width: 100%; }
.msg.md th, .msg.md td { border: 1px solid var(--border); padding: 4px 10px; font-size: 12.5px; text-align: left; }
.msg.md th { background: rgba(0, 0, 0, .03); }
.msg.md a { color: var(--accent); text-decoration: none; }
.msg.md a:hover { text-decoration: underline; }
.msg.md hr { border: none; border-top: 1px solid var(--border); margin: 12px 0; }
.msg.developer, .msg.system { background: var(--code-bg); border: 1px dashed var(--border); color: var(--dim); font-size: 12.5px; }
.msg.tool { background: #fffbe8; border: 1px solid #f0e2ac; font-size: 12.5px; }
/* 概览 */
.overview { max-width: 720px; }
.ov-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 24px; }
.ov-item { background: var(--bg); border-radius: 10px; padding: 10px 14px; }
.ov-item .mono { margin-top: 2px; word-break: break-all; }
.raw { background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px; padding: 14px; font: 11.5px/1.5 "SF Mono",ui-monospace,Consolas,monospace; white-space: pre; overflow: auto; max-height: calc(100vh - 300px); margin: 0; }
</style>
