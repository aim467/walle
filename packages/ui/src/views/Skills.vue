<script setup lang="ts">
import { ref, computed, onMounted, h } from 'vue';
import { NInput, NSelect, NEmpty, NButton, NDropdown, NTabs, NTab, NTag, NDataTable, NProgress, NModal, NCheckbox, NCheckboxGroup, NRadioGroup, NRadio, NRadioButton, useMessage } from 'naive-ui';
import type { DataTableColumns } from 'naive-ui';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';
import agentsLogo from '../assets/logos/agents.svg';

interface SkillEntry { tool: string; assetId: number; path: string; abs: string; project: boolean; linked: boolean; size: number; mtime: string }
interface SkillGroup { key: string; name: string; description: string | null; storePath: string | null; entries: SkillEntry[] }

interface ToolDef { id: string; name: string; logo?: string }
const TOOLS: ToolDef[] = [
  { id: 'agents', name: 'Skills 共享库', logo: agentsLogo },
  { id: 'codex', name: 'Codex CLI', logo: openaiLogo },
  { id: 'zcode', name: 'ZCode', logo: zcodeLogo },
  { id: 'cursor', name: 'Cursor', logo: cursorLogo },
  { id: 'workbuddy', name: 'WorkBuddy 国际版', logo: workbuddyLogo },
  { id: 'workbuddy-cn', name: 'WorkBuddy 国内版', logo: workbuddyLogo },
  { id: 'opencode', name: 'OpenCode', logo: opencodeLogo },
];
const toolDef = (t: string) => TOOLS.find((x) => x.id === t);
const toolName = (t: string) => toolDef(t)?.name ?? t;
const toolLogo = (t: string) => toolDef(t)?.logo;
/** 接入工具盒子只展示 AI 工具（agents 是存储库本身，不算接入方） */
const LINK_TOOLS = ['codex', 'zcode', 'cursor', 'opencode', 'workbuddy', 'workbuddy-cn'];

const skills = ref<SkillGroup[]>([]);
const loading = ref(false);
const q = ref('');
const statusFilter = ref<'all' | 'store' | 'linked' | 'project' | 'copy'>('all');
const activeTool = ref<string | null>(null);
const sortBy = ref('name');
const selected = ref<SkillGroup | null>(null);
const activeTab = ref<'overview' | 'markdown' | 'files' | 'usage'>('overview');
const mdText = ref<string | null>(null);
const mdLoading = ref(false);
const message = useMessage();

/** 分组状态按真实数据判定：共享库本体 > 符号链接接入 > 项目本地 > 目录副本（不硬造"有更新/冲突"） */
function groupStatus(g: SkillGroup): 'store' | 'linked' | 'project' | 'copy' {
  if (g.storePath) return 'store';
  if (g.entries.some((e) => e.linked)) return 'linked';
  if (g.entries.some((e) => e.project)) return 'project';
  return 'copy';
}
const statusMeta = {
  store: { label: '共享库', type: 'info' },
  linked: { label: '已链接', type: 'success' },
  project: { label: '项目本地', type: 'warning' },
  copy: { label: '目录副本', type: 'default' },
} as const;

function maxSize(g: SkillGroup): number { return g.entries.reduce((m, e) => Math.max(m, e.size ?? 0), 0); }
function lastMtime(g: SkillGroup): string { return g.entries.reduce((m, e) => (e.mtime > m ? e.mtime : m), ''); }
function sourceOf(g: SkillGroup): string {
  if (g.storePath) return 'Skills 共享库';
  if (g.entries[0]?.project) return '项目本地目录';
  return toolName(g.entries[0]?.tool ?? '');
}
/** 展示技能目录（去掉末尾的 SKILL.md 文件名） */
function pathOf(g: SkillGroup): string {
  const p = g.storePath ?? g.entries[0]?.abs ?? '';
  return p.replace(/[/\\]SKILL\.md$/i, '');
}
/** 详情头部 logo：共享库本体用 agents 图标，否则取首个接入工具 */
function groupLogo(g: SkillGroup): string | undefined {
  return g.storePath ? agentsLogo : toolLogo(g.entries[0]?.tool ?? '');
}

/** 接入工具状态：链接/目录副本为真接入；Codex 对共享库技能是原生发现（codex.exe 硬编码 .agents/skills，实测） */
function toolState(g: SkillGroup, toolId: string): { on: boolean; label: string } {
  const e = g.entries.find((x) => x.tool === toolId);
  if (e) return { on: true, label: e.linked ? '符号链接接入' : e.project ? '项目本地' : '目录副本' };
  if (toolId === 'codex' && g.storePath) return { on: true, label: '原生发现' };
  return { on: false, label: '未接入' };
}

/** 切换工具作用域；若当前选中技能不在新作用域内则自动选中第一个 */
function setTool(t: string | null) {
  activeTool.value = t;
  const list = filtered.value;
  if (list.length && !list.some((s) => s.key === selected.value?.key)) {
    selected.value = list[0];
    loadDetail(selected.value);
  }
}

/** 技能是否在某工具作用域内（Codex 含原生发现的共享库技能，与详情页口径一致） */
function inToolScope(g: SkillGroup, toolId: string): boolean {
  return g.entries.some((e) => e.tool === toolId) || (toolId === 'codex' && !!g.storePath);
}

const scoped = computed(() => (activeTool.value ? skills.value.filter((s) => inToolScope(s, activeTool.value!)) : skills.value));

const filtered = computed(() => {
  let rows = scoped.value;
  if (statusFilter.value !== 'all') rows = rows.filter((s) => groupStatus(s) === statusFilter.value);
  const k = q.value.trim().toLowerCase();
  if (k) rows = rows.filter((s) => s.name.toLowerCase().includes(k) || (s.description ?? '').toLowerCase().includes(k));
  const by = sortBy.value;
  return [...rows].sort((a, b) => {
    if (by === 'count') return b.entries.length - a.entries.length;
    if (by === 'size') return maxSize(b) - maxSize(a);
    if (by === 'mtime') return lastMtime(b).localeCompare(lastMtime(a));
    return a.name.localeCompare(b.name);
  });
});

const stats = computed(() => ({ total: skills.value.length }));

/** 第二层状态 chips（带计数，随工具作用域联动） */
const statusChips = computed(() => [
  { v: 'all', label: '全部', n: scoped.value.length },
  { v: 'store', label: '共享库', n: scoped.value.filter((s) => groupStatus(s) === 'store').length },
  { v: 'linked', label: '链接接入', n: scoped.value.filter((s) => groupStatus(s) === 'linked').length },
  { v: 'project', label: '项目本地', n: scoped.value.filter((s) => groupStatus(s) === 'project').length },
  { v: 'copy', label: '目录副本', n: scoped.value.filter((s) => groupStatus(s) === 'copy').length },
] as const);

const sortOptions = [
  { label: '排序：名称 A-Z', value: 'name' },
  { label: '排序：接入数量', value: 'count' },
  { label: '排序：文件大小', value: 'size' },
  { label: '排序：修改时间', value: 'mtime' },
];

const moreOptions = [
  { label: '复制 Skill 标识', key: 'copy-id' },
  { label: '下载技能（zip）', key: 'download' },
  { label: '重新扫描共享库', key: 'rescan' },
  { type: 'divider', key: 'd1' },
  { label: '同步到工具（即将推出）', key: 'sync', disabled: true },
  { label: '删除技能（即将推出）', key: 'delete', disabled: true },
];
function onMore(key: string) {
  if (key === 'copy-id' && selected.value) copyText(selected.value.name);
  else if (key === 'rescan') rescan();
  else if (key === 'download' && selected.value) downloadSkill(selected.value);
}

async function load() {
  loading.value = true;
  try {
    const d = await (await fetch('/api/skills')).json();
    skills.value = d.skills ?? [];
    if (!selected.value || !skills.value.some((s) => s.key === selected.value?.key)) {
      selected.value = skills.value[0] ?? null;
      if (selected.value) loadDetail(selected.value);
    }
  } finally {
    loading.value = false;
  }
}

async function loadDetail(g: SkillGroup) {
  selected.value = g;
  activeTab.value = 'overview';
  mdText.value = null;
  files.value = [];
  preview.value = null;
  const entry = g.entries.find((e) => e.tool === 'agents') ?? g.entries[0];
  if (!entry) return;
  mdLoading.value = true;
  try {
    const d = await (await fetch(`/api/source?asset=${entry.assetId}&raw=1`)).json();
    const raw = d.error ? `（${d.error}）` : (d.content ?? '') + (d.truncated ? '\n…（截断）' : '');
    // 预览剥离 frontmatter（元信息已在头部与基本信息区展示）
    mdText.value = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  } finally {
    mdLoading.value = false;
  }
}

async function rescan() {
  const done = message.loading('正在重新扫描共享库…', { duration: 0 });
  try {
    const d = await (await fetch('/api/scan?source=agents', { method: 'POST' })).json();
    if (!d.ok) { message.error(d.error ?? '扫描失败'); return; }
    message.success('共享库扫描完成');
    await load();
  } finally {
    done();
  }
}

function copyText(text: string) {
  navigator.clipboard?.writeText(text).then(
    function () { message.success('已复制'); },
    function () { message.error('剪贴板不可用'); },
  );
}

function notYet(what: string) {
  message.info(`${what}能力将在后续版本提供`);
}

/** 下载技能：优先共享库本体条目，打包其磁盘目录（后端回退 CAS 的 SKILL.md） */
function downloadSkill(g: SkillGroup) {
  const entry = g.entries.find((e) => e.tool === 'agents') ?? g.entries[0];
  if (!entry) return;
  window.location.href = `/api/skills/download?asset=${entry.assetId}`;
}

/** 导入技能向导：URL 发现候选 → 勾选 → 配置接入工具（链接/复制）→ 安装 */
interface ImportCandidate { name: string; path: string; description: string | null }
interface ImportTarget { tool: string; mode: 'link' | 'copy' }
interface InstallResultItem { name: string; installed: boolean; error?: string; linked: { tool: string; mode: string; ok: boolean; error?: string }[] }

const showImport = ref(false);
const importMode = ref<'url' | 'hub'>('url');
const importUrl = ref('');
const discovering = ref(false);
const candidates = ref<ImportCandidate[]>([]);
const picked = ref<string[]>([]);
const installOverwrite = ref(false);
const installing = ref(false);
const installResult = ref<InstallResultItem[] | null>(null);
const importSource = ref('');

/** SkillHub 搜索模式 */
interface HubSkillItem { slug: string; name: string; description: string | null; downloads: number; verified: boolean; version: string }
const hubKeyword = ref('');
const hubSort = ref('score');
const hubSearching = ref(false);
const hubResults = ref<HubSkillItem[]>([]);
const hubPicked = ref<string[]>([]);
const hubTotal = ref(0);
const hubSortOptions = [
  { label: '按评分', value: 'score' },
  { label: '按下载量', value: 'downloads' },
];

/** 接入工具矩阵：Codex 默认不勾（对共享库技能是原生发现），其余默认勾选 + 链接 */
const TARGET_DEFS = [
  { tool: 'codex', label: 'Codex CLI', hint: '原生发现 ~/.agents/skills，无需接入' },
  { tool: 'zcode', label: 'ZCode', hint: '~/.zcode/skills' },
  { tool: 'cursor', label: 'Cursor', hint: '~/.cursor/skills' },
  { tool: 'opencode', label: 'OpenCode', hint: '~/.config/opencode/skills' },
  { tool: 'workbuddy', label: 'WorkBuddy 国际版', hint: '~/.workbuddy-ai/skills' },
  { tool: 'workbuddy-cn', label: 'WorkBuddy 国内版', hint: '~/.workbuddy/skills' },
];
const targetState = ref<Record<string, { on: boolean; mode: 'link' | 'copy' }>>(
  Object.fromEntries(TARGET_DEFS.map((t) => [t.tool, { on: t.tool !== 'codex', mode: 'link' as const }])),
);

function openImport() {
  showImport.value = true;
  importMode.value = 'url';
  importUrl.value = '';
  candidates.value = [];
  picked.value = [];
  installResult.value = null;
  importSource.value = '';
  hubKeyword.value = '';
  hubResults.value = [];
  hubPicked.value = [];
  hubTotal.value = 0;
}
async function searchHub() {
  if (!hubKeyword.value.trim()) { message.warning('请输入搜索关键词'); return; }
  hubSearching.value = true;
  installResult.value = null;
  try {
    const d = await (await fetch(`/api/skills/hub/search?keyword=${encodeURIComponent(hubKeyword.value)}&page=1&sortBy=${hubSort.value}`)).json();
    if (d.error) { message.error(d.error); return; }
    hubResults.value = d.skills ?? [];
    hubTotal.value = d.total ?? 0;
    hubPicked.value = [];
  } finally {
    hubSearching.value = false;
  }
}
async function discoverSkills() {
  if (!importUrl.value.trim()) { message.warning('请输入来源 URL'); return; }
  discovering.value = true;
  installResult.value = null;
  try {
    const d = await (await fetch('/api/skills/import/discover', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: importUrl.value }),
    })).json();
    if (d.error) { message.error(d.error); return; }
    candidates.value = d.skills ?? [];
    importSource.value = d.source ?? '';
    picked.value = candidates.value.map((c) => c.path);
    if (!candidates.value.length) message.info('该来源中未发现技能（无 SKILL.md）');
  } finally {
    discovering.value = false;
  }
}
async function installSkills() {
  const isHub = importMode.value === 'hub';
  if (isHub && !hubPicked.value.length) { message.warning('请勾选要安装的技能'); return; }
  if (!isHub && !picked.value.length) { message.warning('请勾选要安装的技能'); return; }
  installing.value = true;
  try {
    const targets: ImportTarget[] = TARGET_DEFS
      .filter((t) => targetState.value[t.tool]?.on)
      .map((t) => ({ tool: t.tool, mode: targetState.value[t.tool].mode }));
    const payload = isHub
      ? { source: 'skillhub', skills: hubPicked.value, targets, overwrite: installOverwrite.value }
      : { url: importUrl.value, skills: picked.value, targets, overwrite: installOverwrite.value };
    const d = await (await fetch('/api/skills/import', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })).json();
    if (d.error) { message.error(d.error); return; }
    installResult.value = d.results ?? [];
    const ok = installResult.value.filter((r) => r.installed).length;
    if (ok) {
      message.success(`已安装 ${ok} 个技能到共享库`);
      await load();
    } else {
      message.error('安装失败，详见结果列表');
    }
  } finally {
    installing.value = false;
  }
}

function mdHtml(src: string): string {
  return DOMPurify.sanitize(marked.parse(src) as string);
}

/** 文件 Tab：技能目录全部文件列表 + 点击预览 + 本地打开 */
interface SkillFile { path: string; size: number; mtime: string }
const files = ref<SkillFile[]>([]);
const filesLoading = ref(false);
const filesError = ref('');
const preview = ref<{ path: string; loading: boolean; text: string; truncated: boolean; size: number; isMd: boolean } | null>(null);
const openingLocal = ref(false);

const activeAssetEntry = computed(() => {
  const g = selected.value;
  return g ? (g.entries.find((e) => e.tool === 'agents') ?? g.entries[0]) : null;
});

async function loadFiles() {
  const entry = activeAssetEntry.value;
  if (!entry) return;
  filesLoading.value = true;
  filesError.value = '';
  preview.value = null;
  try {
    const d = await (await fetch(`/api/skills/files?asset=${entry.assetId}`)).json();
    if (d.error) { filesError.value = d.error; files.value = []; return; }
    files.value = d.files ?? [];
    // 默认打开 SKILL.md（无则第一个文件），右侧预览不留空
    const first = files.value.find((f) => f.path.toUpperCase() === 'SKILL.MD') ?? files.value[0];
    if (first) openPreview(first);
  } finally {
    filesLoading.value = false;
  }
}
async function openPreview(f: SkillFile) {
  const entry = activeAssetEntry.value;
  if (!entry) return;
  preview.value = { path: f.path, loading: true, text: '', truncated: false, size: f.size, isMd: /\.md$/i.test(f.path) };
  const d = await (await fetch(`/api/skills/file?asset=${entry.assetId}&path=${encodeURIComponent(f.path)}`)).json();
  if (preview.value.path !== f.path) return; // 用户已切到别的文件
  if (d.error) { message.error(d.error); preview.value = null; return; }
  const isMd = /\.md$/i.test(f.path);
  const text = isMd ? String(d.text ?? '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') : String(d.text ?? '');
  preview.value = { path: f.path, loading: false, text, truncated: !!d.truncated, size: d.size ?? f.size, isMd };
}
async function openLocal() {
  const entry = activeAssetEntry.value;
  if (!entry) return;
  openingLocal.value = true;
  try {
    const d = await (await fetch('/api/skills/open', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ asset: entry.assetId }),
    })).json();
    if (d.error) message.error(d.error);
    else message.success('已在文件管理器中打开');
  } finally {
    openingLocal.value = false;
  }
}
/** 文件树展示：按目录分组（根目录组在最前），目录行为组头；目录组与整个树面板均可折叠 */
const collapsedDirs = ref<Set<string>>(new Set());
const treeCollapsed = ref(false);
function toggleDir(dir: string) {
  const next = new Set(collapsedDirs.value);
  if (next.has(dir)) next.delete(dir); else next.add(dir);
  collapsedDirs.value = next;
}
const fileGroups = computed(() => {
  const m = new Map<string, SkillFile[]>();
  for (const f of files.value) {
    const i = f.path.lastIndexOf('/');
    const dir = i >= 0 ? f.path.slice(0, i) : '';
    if (!m.has(dir)) m.set(dir, []);
    m.get(dir)!.push(f);
  }
  return [...m.entries()]
    .map(([dir, fs]) => ({ dir, files: fs }))
    .sort((a, b) => (a.dir === '' ? -1 : b.dir === '' ? 1 : a.dir.localeCompare(b.dir)));
});

function fmtSize(n: number): string {
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
function fmtDate(iso: string): string { return iso ? iso.replace('T', ' ').slice(0, 16) : '-'; }

/** 切详情 Tab：文件 Tab 懒加载文件清单 */
function setTab(t: typeof activeTab.value) {
  activeTab.value = t;
  if (t === 'files' && !files.value.length && !filesLoading.value) loadFiles();
}

const entryColumns: DataTableColumns<SkillEntry> = [
  { title: '工具', key: 'tool', width: 110, render: (e) => toolName(e.tool) },
  { title: '接入方式', key: 'linked', width: 90, render: (e) => (e.linked ? '符号链接' : e.project ? '项目本地' : '目录副本') },
  { title: '路径', key: 'abs', ellipsis: { tooltip: true }, render: (e) => h('span', { class: 'mono' }, e.abs || e.path) },
  { title: '大小', key: 'size', width: 70, render: (e) => fmtSize(e.size) },
];

onMounted(load);
</script>

<template>
  <div class="page">
    <!-- 第一层：AI 工具 Tab（对齐资产库布局） -->
    <div class="toolbar glassbar">
      <div class="tabs-strip">
        <button class="tab" :class="{ on: activeTool === null }" @click="setTool(null)">
          <span class="tab-dot">A</span>
          <span class="tab-name">全部工具</span>
          <span class="tab-n">{{ stats.total }}</span>
        </button>
        <button
          v-for="t in TOOLS" :key="t.id"
          class="tab" :class="{ on: activeTool === t.id }" @click="setTool(t.id)"
        >
          <img class="tab-logo" :src="t.logo" :alt="t.id">
          <span class="tab-name">{{ t.name }}</span>
          <span class="tab-n">{{ skills.filter((s) => inToolScope(s, t.id)).length }}</span>
        </button>
      </div>
      <n-input v-model:value="q" placeholder="搜索技能…" size="small" round clearable class="search" />
    </div>

    <!-- 第二层：状态筛选 + 页面动作 -->
    <div class="typerow">
      <button
        v-for="c in statusChips" :key="c.v"
        class="tchip" :class="{ on: statusFilter === c.v }" @click="statusFilter = c.v"
      >{{ c.label }}<span class="tchip-n">{{ c.n }}</span></button>
      <span class="flex1" />
      <n-button size="tiny" round secondary @click="notYet('新建技能')">＋ 新建技能</n-button>
      <n-button size="tiny" round secondary @click="openImport">↓ 导入技能</n-button>
    </div>

    <div class="body">
      <!-- 左：技能清单 -->
      <div class="list card">
        <div class="list-head">
          <span class="lh-title">技能</span>
          <span class="lh-n">{{ filtered.length }} 项 · 数据来自本地扫描</span>
          <span class="flex1" />
          <n-select v-model:value="sortBy" :options="sortOptions" size="medium" class="sortsel" />
        </div>
        <div class="list-scroll">
          <div
            v-for="s in filtered" :key="s.key" class="srow"
            :class="{ sel: selected?.key === s.key }" @click="loadDetail(s)"
          >
            <img class="srow-logo" :src="groupLogo(s)" alt="">
            <span class="srow-main">
              <span class="srow-name">
                <span class="srow-name-t">{{ s.name }}</span>
                <n-tag size="tiny" round :bordered="false" :type="statusMeta[groupStatus(s)].type">
                  {{ statusMeta[groupStatus(s)].label }}
                </n-tag>
              </span>
              <span class="srow-desc dim">{{ s.description ?? '（无描述）' }}</span>
            </span>
            <span class="srow-tools">
              <img
                v-for="e in s.entries.slice(0, 3)" :key="e.tool + e.path"
                class="srow-tool-logo" :src="toolLogo(e.tool)" :alt="toolName(e.tool)" :title="toolName(e.tool)"
              >
              <span v-if="s.entries.length > 3" class="dim small">+{{ s.entries.length - 3 }}</span>
            </span>
          </div>
          <n-empty v-if="!filtered.length && !loading" description="没有匹配的技能" size="small" style="padding:36px 0" />
        </div>
      </div>

      <!-- 右：详情 Inspector -->
      <div class="detail card">
        <template v-if="selected">
          <div class="insp-head">
            <img class="insp-logo" :src="groupLogo(selected)" alt="">
            <div class="insp-id">
              <div class="insp-title">{{ selected.name }}</div>
              <div class="insp-desc dim">{{ selected.description ?? '（无描述）' }}</div>
            </div>
            <div class="insp-act">
              <n-button size="tiny" round secondary @click="notYet('编辑技能')">编辑</n-button>
              <n-dropdown trigger="click" :options="moreOptions" @select="onMore">
                <n-button size="tiny" round secondary>···</n-button>
              </n-dropdown>
            </div>
          </div>
          <div class="detail-sub">
            <span class="pathbar mono" :title="pathOf(selected)">{{ pathOf(selected) }}</span>
            <span class="detail-meta dim small">
              <span>来源 <strong>{{ sourceOf(selected) }}</strong></span>
              <span>大小 <strong>{{ fmtSize(maxSize(selected)) }}</strong></span>
              <span>修改 <strong>{{ fmtDate(lastMtime(selected)) }}</strong></span>
              <span>接入 <strong>{{ selected.entries.length }} 处</strong></span>
            </span>
          </div>
          <div class="insp-tabs">
            <button class="itab" :class="{ on: activeTab === 'overview' }" @click="setTab('overview')">概览</button>
            <button class="itab" :class="{ on: activeTab === 'markdown' }" @click="setTab('markdown')">SKILL.md</button>
            <button class="itab" :class="{ on: activeTab === 'files' }" @click="setTab('files')">文件</button>
            <button class="itab" :class="{ on: activeTab === 'usage' }" @click="setTab('usage')">使用情况</button>
          </div>

          <div class="detail-body">
            <!-- 概览 -->
            <template v-if="activeTab === 'overview'">
              <div class="section-title">接入工具</div>
              <div class="tool-boxes">
                <div
                  v-for="t in LINK_TOOLS" :key="t" class="tool-box"
                  :class="{ connected: toolState(selected, t).on }"
                >
                  <div class="tool-head">
                    <img v-if="toolLogo(t)" class="tool-logo" :src="toolLogo(t)" alt="">
                    <span class="tool-name">{{ toolName(t) }}</span>
                  </div>
                  <div class="tool-state" :class="{ off: !toolState(selected, t).on }">
                    {{ toolState(selected, t).on ? '● ' + toolState(selected, t).label : '○ 未接入' }}
                  </div>
                </div>
              </div>

              <div class="section-title">安装位置</div>
              <n-data-table
                size="small" :bordered="false" :single-line="false"
                :columns="entryColumns" :data="selected.entries"
              />
            </template>

            <!-- SKILL.md -->
            <template v-else-if="activeTab === 'markdown'">
              <div class="md-wrap">
                <div class="md-toolbar">
                  <div class="md-toolbar-left">
                    <span class="file-pill mono">SKILL.md</span>
                    <n-tag size="small" type="info" :bordered="false">Markdown</n-tag>
                  </div>
                  <div class="md-toolbar-right">
                    <n-button size="tiny" secondary @click="notYet('编辑')">编辑</n-button>
                    <n-button size="tiny" secondary @click="mdText && copyText(mdText)">复制</n-button>
                  </div>
                </div>
                <div class="md-scroll">
                  <div v-if="mdLoading" class="dim small" style="padding:24px">加载中…</div>
                  <article v-else-if="mdText !== null" class="md-content" v-html="mdHtml(mdText)"></article>
                </div>
              </div>
            </template>

            <!-- 文件 -->
            <template v-else-if="activeTab === 'files'">
              <div class="files-head">
                <div class="section-title" style="margin: 0">技能文件 <span class="dim small" style="font-weight: 400">{{ files.length }} 个</span></div>
                <n-button size="tiny" round secondary :loading="openingLocal" @click="openLocal">⌖ 在本地打开</n-button>
              </div>
              <div class="section-sub dim small">技能目录全部文件（含附属脚本/参考文档）；walle 入库仅收 SKILL.md（降噪）</div>
              <div v-if="filesLoading" class="dim small" style="padding:16px 0">加载中…</div>
              <div v-else-if="filesError" class="dim small" style="padding:16px 0">{{ filesError }}</div>
              <div v-else-if="!files.length" class="dim small" style="padding:16px 0">目录为空</div>
              <div v-else class="files-wrap">
                <div v-if="!treeCollapsed" class="filetree">
                  <div class="filetree-head">
                    <span class="dim small">文件树</span>
                    <n-button size="tiny" quaternary title="收起文件树，预览占满全宽" @click="treeCollapsed = true">«</n-button>
                  </div>
                  <template v-for="g in fileGroups" :key="g.dir">
                    <button
                      v-if="g.dir" class="fdir" :class="{ folded: collapsedDirs.has(g.dir) }"
                      @click="toggleDir(g.dir)"
                    >
                      <span class="fdir-icon">{{ collapsedDirs.has(g.dir) ? '▸' : '▾' }}</span>
                      <span class="mono">{{ g.dir }}/</span>
                      <span class="fdir-n dim">{{ g.files.length }}</span>
                    </button>
                    <button
                      v-for="f in (collapsedDirs.has(g.dir) ? [] : g.files)" :key="f.path"
                      class="frow" :class="{ sel: preview?.path === f.path }"
                      :style="{ paddingLeft: (g.dir ? 26 : 12) + 'px' }"
                      @click="openPreview(f)"
                    >
                      <span class="frow-icon">{{ f.path.toUpperCase().endsWith('.MD') ? 'M↓' : '◇' }}</span>
                      <span class="frow-name mono" :title="f.path">{{ f.path.split('/').pop() }}</span>
                      <span class="frow-size dim">{{ fmtSize(f.size) }}</span>
                    </button>
                  </template>
                </div>
                <div class="fpane">
                  <template v-if="preview">
                    <div class="fpreview-bar">
                      <n-button
                        v-if="treeCollapsed" size="tiny" quaternary class="tree-toggle"
                        title="展开文件树" @click="treeCollapsed = false"
                      >»</n-button>
                      <span class="mono fpreview-path" :title="preview.path">{{ preview.path }}</span>
                      <span class="dim small">{{ fmtSize(preview.size) }}{{ preview.truncated ? ' · 已截断（512KB）' : '' }}</span>
                      <span class="flex1" />
                      <n-button size="tiny" quaternary @click="preview = null">关闭</n-button>
                    </div>
                    <div v-if="preview.loading" class="dim small" style="padding:16px">加载中…</div>
                    <div v-else-if="preview.isMd" class="fpreview-md md-content" v-html="mdHtml(preview.text)"></div>
                    <pre v-else class="fpreview-code">{{ preview.text }}</pre>
                  </template>
                  <n-empty v-else description="选择左侧文件预览" size="small" style="margin:auto" />
                </div>
              </div>
            </template>

            <!-- 使用情况 -->
            <template v-else-if="activeTab === 'usage'">
              <div class="section-title">工具接入情况</div>
              <div class="section-sub dim small">该技能当前被哪些 AI 工具接入；调用次数等使用统计将随后续版本提供</div>
              <div class="usage">
                <div
                  v-for="t in LINK_TOOLS" :key="t" class="usage-card"
                  :class="{ connected: toolState(selected, t).on }"
                >
                  <div class="usage-top">
                    <span class="usage-tool">
                      <img v-if="toolLogo(t)" class="tool-logo" :src="toolLogo(t)" alt="">{{ toolName(t) }}
                    </span>
                    <span class="usage-version dim">{{ toolState(selected, t).on ? toolState(selected, t).label : '未接入' }}</span>
                  </div>
                  <n-progress
                    class="usage-line"
                    type="line" :show-indicator="false" :height="7" :border-radius="5"
                    :percentage="toolState(selected, t).on ? 100 : 0"
                    :color="toolState(selected, t).on ? '#4c91ef' : '#d3d7dc'"
                  />
                  <div class="usage-foot dim">
                    <span>{{ toolState(selected, t).on ? '接入正常' : '可接入' }}</span>
                    <span>—</span>
                  </div>
                </div>
              </div>
            </template>
          </div>
        </template>
        <n-empty v-else description="从左侧选择一个技能" style="margin:auto" />
      </div>
    </div>

    <!-- 导入技能向导 -->
    <n-modal v-model:show="showImport" preset="card" title="导入技能（从互联网下载）" style="width: 660px; max-width: 92vw">
      <div class="import-step">
        <div class="step-title">1 · 来源</div>
        <div class="mode-row">
          <n-radio-group v-model:value="importMode" size="small" :disabled="installing">
            <n-radio-button value="url">链接（GitHub / zip / SkillHub 页面）</n-radio-button>
            <n-radio-button value="hub">SkillHub 搜索</n-radio-button>
          </n-radio-group>
        </div>
        <div v-if="importMode === 'url'" class="import-url-row">
          <n-input
            v-model:value="importUrl" placeholder="GitHub 仓库（owner/repo 或链接，可带 /tree/ 子目录）、skillhub.cn/skills/<slug> 或任意 zip 直链"
            size="small" :disabled="discovering || installing" @keydown.enter="discoverSkills"
          />
          <n-button size="small" type="primary" :loading="discovering" :disabled="installing" @click="discoverSkills">发现技能</n-button>
        </div>
        <div v-else class="import-url-row">
          <n-input
            v-model:value="hubKeyword" placeholder="搜索 SkillHub 技能（关键词）"
            size="small" :disabled="hubSearching || installing" @keydown.enter="searchHub"
          />
          <n-select v-model:value="hubSort" :options="hubSortOptions" size="small" class="hub-sort" :disabled="installing" />
          <n-button size="small" type="primary" :loading="hubSearching" :disabled="installing" @click="searchHub">搜索</n-button>
        </div>
      </div>

      <template v-if="importMode === 'url' ? candidates.length > 0 : hubResults.length > 0">
        <div class="import-step">
          <div class="step-title">
            2 · 选择技能
            <span v-if="importMode === 'url'" class="dim small" style="font-weight: 400">{{ importSource }} · 发现 {{ candidates.length }} 个</span>
            <span v-else class="dim small" style="font-weight: 400">skillhub.cn · 匹配 {{ hubTotal }} 个（显示前 {{ hubResults.length }}）</span>
          </div>
          <div class="cand-list">
            <n-checkbox-group v-if="importMode === 'url'" v-model:value="picked">
              <div v-for="c in candidates" :key="c.path" class="cand-row">
                <n-checkbox :value="c.path" :label="c.name" />
                <span class="cand-desc dim">{{ c.description ?? '（无描述）' }}</span>
              </div>
            </n-checkbox-group>
            <n-checkbox-group v-else v-model:value="hubPicked">
              <div v-for="c in hubResults" :key="c.slug" class="cand-row">
                <n-checkbox :value="c.slug">
                  <span class="hub-name">{{ c.name }}</span>
                  <n-tag v-if="c.verified" size="tiny" type="success" :bordered="false">认证</n-tag>
                  <span class="dim small">v{{ c.version }} · {{ c.downloads }} 下载</span>
                </n-checkbox>
                <span class="cand-desc dim">{{ c.description ?? '' }}</span>
              </div>
            </n-checkbox-group>
          </div>
        </div>

        <div class="import-step">
          <div class="step-title">3 · 接入工具</div>
          <div class="target-row head">
            <span>接入</span><span>工具</span><span>方式</span><span class="dim">说明</span>
          </div>
          <div v-for="t in TARGET_DEFS" :key="t.tool" class="target-row">
            <n-checkbox v-model:checked="targetState[t.tool].on" />
            <span>{{ t.label }}</span>
            <n-select
              v-model:value="targetState[t.tool].mode" size="tiny"
              :disabled="!targetState[t.tool].on || installing" class="mode-sel"
              :options="[{ label: '符号链接', value: 'link' }, { label: '目录复制', value: 'copy' }]"
            />
            <span class="dim small">{{ t.hint }}</span>
          </div>
          <div class="overwrite-row">
            <n-checkbox v-model:checked="installOverwrite">覆盖同名技能</n-checkbox>
          </div>
        </div>

        <div class="import-actions">
          <n-button type="primary" size="small" :loading="installing" @click="installSkills">
            安装 {{ importMode === 'hub' ? hubPicked.length : picked.length }} 个技能到共享库
          </n-button>
        </div>

        <div v-if="installResult" class="install-result">
          <div v-for="r in installResult" :key="r.name" class="install-row">
            <strong>{{ r.name }}</strong>
            <n-tag size="small" :type="r.installed ? 'success' : 'error'" :bordered="false">
              {{ r.installed ? '已装入共享库' : '失败' }}
            </n-tag>
            <n-tag
              v-for="l in r.linked" :key="l.tool" size="small"
              :type="l.ok ? 'info' : 'warning'" :bordered="false"
            >
              {{ toolName(l.tool) }} · {{ l.mode === 'link' ? '链接' : '复制' }}{{ l.ok ? '' : '：' + (l.error ?? '失败') }}
            </n-tag>
            <span v-if="r.error" class="install-err">{{ r.error }}</span>
          </div>
        </div>
      </template>
    </n-modal>
  </div>
</template>

<style scoped>
/* 对齐资产库布局：全幅三段式（工具 Tab / 状态行 / 列表+详情） */
.page { margin: -24px -40px -56px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

/* 第一层：AI 工具 Tab */
.toolbar { flex: 0 0 auto; height: 48px; display: flex; gap: 12px; align-items: center; padding: 0 16px; }
.tabs-strip { flex: 1 1 auto; min-width: 0; display: flex; gap: 8px; align-items: center; overflow-x: auto; }
.tabs-strip::-webkit-scrollbar { height: 0; }
.tab { flex: 0 0 auto; display: flex; gap: 8px; align-items: center; height: 32px; background: transparent; border: none; border-radius: 8px; padding: 0 12px; cursor: pointer; color: var(--text); font-size: 13px; font-weight: 500; white-space: nowrap; }
.tab:hover { background: rgba(0, 0, 0, .05); }
.tab.on { background: var(--accent); color: #fff; }
.tab-logo { width: 18px; height: 18px; border-radius: 4px; object-fit: contain; background: #fff; }
.tab-dot { width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; background: #8e8e93; }
.tab-n { color: var(--dim); font-size: 12px; }
.tab.on .tab-n { color: rgba(255, 255, 255, .8); }
.search { flex: 0 0 auto; width: 240px; }
.toolbar :deep(.n-input) { --n-height: 30px; }
.flex1 { flex: 1; }

/* 第二层：状态筛选 + 动作 */
.typerow { flex: 0 0 auto; height: 42px; display: flex; gap: 4px; align-items: center; padding: 0 16px; background: var(--card-solid); border-bottom: 1px solid var(--border); overflow-x: auto; }
.typerow::-webkit-scrollbar { height: 0; }
.tchip { display: inline-flex; gap: 8px; align-items: center; height: 28px; padding: 0 12px; border: none; border-radius: 8px; background: transparent; color: var(--dim); font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.tchip:hover { background: rgba(0, 0, 0, .05); color: var(--text); }
.tchip.on { background: rgba(0, 113, 227, .1); color: var(--accent); font-weight: 600; }
.tchip-n { font-size: 11px; opacity: .75; }

/* 主体 */
.body { flex: 1; min-height: 0; display: flex; gap: 12px; padding: 12px 16px 16px; overflow: hidden; }

/* 左：技能清单 */
.list { flex: 1 1 38%; min-width: 300px; display: flex; flex-direction: column; overflow: hidden; }
.list-head { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.lh-title { font-size: 13.5px; font-weight: 700; }
.lh-n { font-size: 12px; color: var(--dim); }
.sortsel { width: 128px; }
.list-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; overscroll-behavior: contain; }
.srow { display: flex; gap: 12px; align-items: center; padding: 11px 12px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; }
.srow:hover { background: var(--bg); }
.srow.sel { background: rgba(0, 113, 227, .08); border-color: var(--accent); }
.srow-logo { width: 18px; height: 18px; border-radius: 4px; object-fit: contain; background: #fff; flex-shrink: 0; }
.srow-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.srow-name { display: flex; gap: 8px; align-items: center; min-width: 0; }
.srow-name-t { font-size: 13.5px; font-weight: 600; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.srow-desc { font-size: 11.5px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.srow-tools { flex-shrink: 0; display: flex; align-items: center; gap: 4px; }
.srow-tool-logo { width: 15px; height: 15px; border-radius: 3px; object-fit: contain; background: #fff; border: 1px solid var(--border); }

/* 右：详情 Inspector */
.detail { flex: 1 1 62%; min-width: 360px; display: flex; flex-direction: column; overflow: hidden; }
.insp-head { flex: 0 0 auto; display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px 8px; }
.insp-logo { width: 22px; height: 22px; border-radius: 5px; object-fit: contain; background: #fff; border: 1px solid var(--border); flex-shrink: 0; margin-top: 1px; }
.insp-id { flex: 1; min-width: 0; }
.insp-title { font-size: 16px; font-weight: 700; line-height: 1.3; }
.insp-desc { font-size: 12px; margin-top: 2px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.insp-act { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.detail-sub { flex: 0 0 auto; display: flex; flex-direction: column; gap: 8px; padding: 0 16px 10px; border-bottom: 1px solid var(--border); }
.pathbar { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; height: 30px; display: flex; align-items: center; padding: 0 10px; color: #5f646b; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.detail-meta { display: flex; gap: 16px; flex-wrap: wrap; }
.detail-meta strong { color: #3e4248; font-weight: 600; }
.insp-tabs { flex: 0 0 auto; display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.itab { height: 28px; padding: 0 12px; border: none; border-radius: 8px; background: transparent; color: var(--dim); font-size: 13px; cursor: pointer; }
.itab:hover { background: rgba(0, 0, 0, .05); color: var(--text); }
.itab.on { background: rgba(0, 113, 227, .1); color: var(--accent); font-weight: 600; }
.detail-body { min-height: 0; flex: 1; overflow: auto; padding: 14px 16px 16px; overscroll-behavior: contain; }

/* 概览 */
.section-title { font-size: 13px; font-weight: 700; margin: 16px 0 10px; }
.section-title:first-child { margin-top: 0; }
.section-sub { margin: -6px 0 12px; }
.tool-boxes { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 1280px) { .tool-boxes { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.tool-box { border: 1px solid var(--border); border-radius: 10px; padding: 11px; }
.tool-box.connected { border-color: #cfe6da; }
.tool-head { display: flex; align-items: center; gap: 7px; }
.tool-logo { width: 16px; height: 16px; border-radius: 4px; object-fit: contain; background: #fff; border: 1px solid var(--border); }
.tool-name { font-weight: 650; font-size: 12px; }
.tool-state { margin-top: 9px; font-size: 10px; color: #188354; }
.tool-state.off { color: #9b9fa5; }

/* SKILL.md */
.md-wrap { height: 100%; display: flex; flex-direction: column; border: 1px solid var(--border); border-radius: 11px; overflow: hidden; min-height: 320px; }
.md-toolbar { height: 40px; background: var(--bg); border-bottom: 1px solid var(--border); display: flex; align-items: center; justify-content: space-between; padding: 0 10px; flex-shrink: 0; }
.md-toolbar-left { display: flex; gap: 8px; align-items: center; }
.md-toolbar-right { display: flex; gap: 6px; }
.file-pill { font-size: 11px; color: #555b63; }
.md-scroll { overflow: auto; flex: 1; }
.md-content { padding: 22px 30px; line-height: 1.7; max-width: 1100px; margin: auto; font-size: 13.5px; }
.md-content :deep(h1) { font-size: 24px; margin: 0 0 14px; }
.md-content :deep(h2) { font-size: 18px; margin: 24px 0 10px; }
.md-content :deep(h3) { font-size: 14px; margin: 18px 0 8px; }
.md-content :deep(p), .md-content :deep(li) { color: #4e535a; }
.md-content :deep(li) { margin: 6px 0; }
.md-content :deep(pre) { font-family: "SF Mono", ui-monospace, Consolas, monospace; background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; overflow: auto; font-size: 12px; }
.md-content :deep(code) { font-family: "SF Mono", ui-monospace, Consolas, monospace; font-size: 12px; }

/* 文件 */
.files-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 2px; }
.files-wrap { display: flex; gap: 12px; height: calc(100vh - 420px); min-height: 380px; }
.filetree { flex: 0 0 240px; border: 1px solid var(--border); border-radius: 11px; overflow: auto; align-self: stretch; }
.filetree-head { display: flex; justify-content: space-between; align-items: center; padding: 4px 8px 4px 12px; border-bottom: 1px solid var(--border); position: sticky; top: 0; background: #fff; z-index: 1; }
.fdir { width: 100%; display: flex; align-items: center; gap: 6px; padding: 7px 12px 5px; font-size: 11px; color: var(--dim); background: var(--bg); border-bottom: 1px solid var(--border); position: sticky; top: 29px; cursor: pointer; border-top: 0; border-left: 0; border-right: 0; text-align: left; }
.fdir:hover { color: var(--text); }
.fdir.folded { position: static; }
.fdir-n { margin-left: auto; font-size: 10px; }
.fdir-icon { font-size: 9px; }
.frow { width: 100%; min-height: 34px; display: flex; align-items: center; gap: 8px; padding: 6px 12px; border: none; border-bottom: 1px solid var(--border); background: transparent; font-size: 12px; cursor: pointer; text-align: left; }
.frow:last-child { border-bottom: 0; }
.frow:hover { background: var(--bg); }
.frow.sel { background: rgba(0, 113, 227, .1); box-shadow: inset 2px 0 0 var(--accent); }
.frow-icon { color: #7b8188; flex-shrink: 0; font-size: 10px; }
.frow-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.frow-size { font-size: 10px; flex-shrink: 0; }
.fpane { flex: 1; min-width: 0; border: 1px solid var(--border); border-radius: 11px; overflow: hidden; display: flex; flex-direction: column; }
.fpreview-bar { min-height: 36px; background: var(--bg); border-bottom: 1px solid var(--border); display: flex; align-items: center; gap: 10px; padding: 4px 12px; font-size: 11px; flex-shrink: 0; }
.fpreview-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fpreview-code { flex: 1; margin: 0; padding: 12px 14px; overflow: auto; font: 12px/1.55 "SF Mono", ui-monospace, Consolas, monospace; white-space: pre; background: var(--code-bg); }
.fpreview-md { flex: 1; overflow: auto; padding: 16px 20px; font-size: 13px; }

/* 使用情况 */
.usage { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.usage-card { border: 1px solid var(--border); border-radius: 11px; padding: 14px 15px; }
.usage-card.connected { border-color: #cfe6da; }
.usage-top { display: flex; justify-content: space-between; align-items: center; }
.usage-tool { font-weight: 700; font-size: 12.5px; display: inline-flex; align-items: center; gap: 7px; }
.usage-version { font-size: 10px; }
.usage-line { margin: 12px 0 8px; }
.usage-foot { display: flex; justify-content: space-between; font-size: 10px; }

/* 导入技能向导 */
.import-step { margin-bottom: 16px; }
.mode-row { margin-bottom: 8px; }
.hub-sort { width: 110px; flex-shrink: 0; }
.hub-name { font-weight: 600; margin-right: 6px; }
.step-title { font-size: 13px; font-weight: 700; margin-bottom: 8px; display: flex; align-items: baseline; gap: 8px; }
.import-url-row { display: flex; gap: 8px; }
.cand-list { border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; max-height: 220px; overflow: auto; }
.cand-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
.cand-desc { font-size: 11px; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.target-row { display: grid; grid-template-columns: 40px 110px 150px minmax(0, 1fr); align-items: center; gap: 8px; padding: 6px 0; font-size: 12.5px; }
.mode-sel { width: 120px; }
.target-row.head { font-size: 11px; color: var(--dim); border-bottom: 1px solid var(--border); }
.overwrite-row { margin-top: 8px; }
.import-actions { display: flex; justify-content: flex-end; margin-top: 4px; }
.install-result { margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px; }
.install-row { display: flex; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; flex-wrap: wrap; }
.install-err { color: #c25656; font-size: 11px; }

@media (max-width: 1024px) {
  .body { flex-direction: column; overflow-y: auto; }
  .list { max-height: 46vh; }
  .search { width: 160px; }
}
</style>
