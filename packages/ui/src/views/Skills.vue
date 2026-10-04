<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { NInput, NSelect, NEmpty, NButton, NDropdown, useMessage } from 'naive-ui';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';
import agentsLogo from '../assets/logos/agents.svg';

interface SkillEntry { tool: string; assetId: number; path: string; abs: string; linked: boolean; size: number; mtime: string }
interface SkillGroup { key: string; name: string; description: string | null; storePath: string | null; entries: SkillEntry[] }

interface ToolDef { id: string; name: string; logo?: string }
const TOOLS: ToolDef[] = [
  { id: 'agents', name: 'Skills 共享库', logo: agentsLogo },
  { id: 'codex', name: 'Codex CLI', logo: openaiLogo },
  { id: 'zcode', name: 'ZCode', logo: zcodeLogo },
  { id: 'cursor', name: 'Cursor', logo: cursorLogo },
  { id: 'workbuddy', name: 'WorkBuddy', logo: workbuddyLogo },
  { id: 'opencode', name: 'OpenCode', logo: opencodeLogo },
];
const toolDef = (t: string) => TOOLS.find((x) => x.id === t);
const toolName = (t: string) => toolDef(t)?.name ?? t;
/** 接入工具盒子只展示 AI 工具（agents 是存储库本身，不算接入方） */
const LINK_TOOLS = ['codex', 'zcode', 'cursor', 'opencode', 'workbuddy'];

const skills = ref<SkillGroup[]>([]);
const loading = ref(false);
const q = ref('');
const statusFilter = ref<'all' | 'store' | 'linked' | 'copy'>('all');
const sourceFilter = ref('');
const sortBy = ref('name');
const selected = ref<SkillGroup | null>(null);
const activeTab = ref<'overview' | 'markdown' | 'files' | 'usage'>('overview');
const mdText = ref<string | null>(null);
const mdLoading = ref(false);
const message = useMessage();

/** 分组状态按真实数据判定：共享库本体 > 符号链接接入 > 目录副本（不硬造"有更新/冲突"） */
function groupStatus(g: SkillGroup): 'store' | 'linked' | 'copy' {
  if (g.storePath) return 'store';
  if (g.entries.some((e) => e.linked)) return 'linked';
  return 'copy';
}
const statusMeta = {
  store: { label: '共享库', cls: 'blue' },
  linked: { label: '已链接', cls: 'green' },
  copy: { label: '目录副本', cls: '' },
} as const;
const STATUS_CHIPS = [
  { v: 'all', label: '全部' },
  { v: 'store', label: '共享库' },
  { v: 'linked', label: '链接接入' },
  { v: 'copy', label: '目录副本' },
] as const;

function maxSize(g: SkillGroup): number { return g.entries.reduce((m, e) => Math.max(m, e.size ?? 0), 0); }
function lastMtime(g: SkillGroup): string { return g.entries.reduce((m, e) => (e.mtime > m ? e.mtime : m), ''); }
function sourceOf(g: SkillGroup): string { return g.storePath ? 'Skills 共享库' : toolName(g.entries[0]?.tool ?? ''); }
/** 展示技能目录（去掉末尾的 SKILL.md 文件名） */
function pathOf(g: SkillGroup): string {
  const p = g.storePath ?? g.entries[0]?.abs ?? '';
  return p.replace(/[/\\]SKILL\.md$/i, '');
}

/** 接入工具状态：链接/目录副本为真接入；Codex 对共享库技能是原生发现（codex.exe 硬编码 .agents/skills，实测） */
function toolState(g: SkillGroup, toolId: string): { on: boolean; label: string } {
  const e = g.entries.find((x) => x.tool === toolId);
  if (e) return { on: true, label: e.linked ? '符号链接接入' : '目录副本' };
  if (toolId === 'codex' && g.storePath) return { on: true, label: '原生发现' };
  return { on: false, label: '未接入' };
}

const filtered = computed(() => {
  let rows = skills.value;
  if (statusFilter.value !== 'all') rows = rows.filter((s) => groupStatus(s) === statusFilter.value);
  if (sourceFilter.value) rows = rows.filter((s) => s.entries.some((e) => e.tool === sourceFilter.value));
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

const stats = computed(() => ({
  total: skills.value.length,
  shared: skills.value.filter((s) => s.storePath).length,
  linked: skills.value.filter((s) => s.entries.some((e) => e.linked)).length,
}));

const sourceOptions = [{ label: '来源：全部', value: '' }, ...TOOLS.map((t) => ({ label: t.name, value: t.id }))];
const sortOptions = [
  { label: '排序：名称 A-Z', value: 'name' },
  { label: '排序：接入数量', value: 'count' },
  { label: '排序：文件大小', value: 'size' },
  { label: '排序：修改时间', value: 'mtime' },
];

const moreOptions = [
  { label: '复制 Skill 标识', key: 'copy-id' },
  { label: '重新扫描共享库', key: 'rescan' },
  { type: 'divider', key: 'd1' },
  { label: '同步到工具（即将推出）', key: 'sync', disabled: true },
  { label: '导出技能（即将推出）', key: 'export', disabled: true },
  { label: '删除技能（即将推出）', key: 'delete', disabled: true },
];
function onMore(key: string) {
  if (key === 'copy-id' && selected.value) copyText(selected.value.name);
  else if (key === 'rescan') rescan();
}

async function load() {
  loading.value = true;
  try {
    const d = await (await fetch('/api/skills')).json();
    skills.value = d.skills ?? [];
    if (!selected.value) {
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

function mdHtml(src: string): string {
  return DOMPurify.sanitize(marked.parse(src) as string);
}
function fmtSize(n: number): string {
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
function fmtDate(iso: string): string { return iso ? iso.replace('T', ' ').slice(0, 16) : '-'; }

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h2>技能管理</h2>
        <div class="dim small">跨工具技能全景 · 共享库 {{ stats.shared }} · 链接接入 {{ stats.linked }} / 共 {{ stats.total }} 项</div>
      </div>
      <div class="head-actions">
        <n-button size="small" type="primary" @click="notYet('新建技能')">＋ 新建技能</n-button>
        <n-button size="small" secondary @click="notYet('导入技能')">↓ 导入技能</n-button>
      </div>
    </div>

    <div class="workspace">
      <!-- 左：技能清单 -->
      <div class="panel list-panel">
        <div class="list-tools">
          <n-input v-model:value="q" placeholder="搜索技能名称、描述…" size="small" round clearable />
          <div class="chip-row">
            <button
              v-for="c in STATUS_CHIPS" :key="c.v" class="chip" :class="{ on: statusFilter === c.v }"
              @click="statusFilter = c.v"
            >{{ c.label }}</button>
          </div>
          <div class="advanced">
            <n-select v-model:value="sourceFilter" :options="sourceOptions" size="tiny" />
            <n-select v-model:value="sortBy" :options="sortOptions" size="tiny" />
          </div>
        </div>
        <div class="list-summary dim">
          <span>{{ filtered.length }} 个技能</span>
          <span>数据来自本地扫描</span>
        </div>
        <div class="skill-list">
          <div
            v-for="s in filtered" :key="s.key" class="skill-card"
            :class="{ selected: selected?.key === s.key }" @click="loadDetail(s)"
          >
            <div class="skill-head">
              <span class="skill-name">{{ s.name }}</span>
              <span class="skill-count dim">{{ s.entries.length }} 处</span>
            </div>
            <div class="skill-desc dim">{{ s.description ?? '（无描述）' }}</div>
            <div class="meta">
              <span class="tag" :class="statusMeta[groupStatus(s)].cls">
                <span class="dot" :class="statusMeta[groupStatus(s)].cls" />{{ statusMeta[groupStatus(s)].label }}
              </span>
              <span v-for="e in s.entries.slice(0, 2)" :key="e.tool + e.path" class="tag">{{ toolName(e.tool) }}</span>
              <span v-if="s.entries.length > 2" class="tag">+{{ s.entries.length - 2 }}</span>
            </div>
          </div>
          <n-empty v-if="!filtered.length && !loading" description="没有匹配的技能" size="small" style="padding:36px 0" />
        </div>
      </div>

      <!-- 右：详情 -->
      <div class="panel detail">
        <template v-if="selected">
          <div class="detail-head">
            <div class="detail-title-row">
              <div class="dt-main">
                <div class="detail-title">{{ selected.name }}</div>
                <div class="detail-desc">{{ selected.description ?? '（无描述）' }}</div>
              </div>
              <div class="head-actions">
                <n-button size="small" secondary @click="notYet('编辑技能')">编辑</n-button>
                <n-dropdown trigger="click" :options="moreOptions" @select="onMore">
                  <n-button size="small" secondary>···</n-button>
                </n-dropdown>
              </div>
            </div>
            <div class="pathbar mono" :title="pathOf(selected)">{{ pathOf(selected) }}</div>
            <div class="detail-meta dim small">
              <span>状态 <strong>{{ statusMeta[groupStatus(selected)].label }}</strong></span>
              <span>来源 <strong>{{ sourceOf(selected) }}</strong></span>
              <span>大小 <strong>{{ fmtSize(maxSize(selected)) }}</strong></span>
              <span>接入 <strong>{{ selected.entries.length }} 处</strong></span>
            </div>
            <div class="tabs">
              <button
                v-for="t in [
                  { k: 'overview', label: '概览' }, { k: 'markdown', label: 'SKILL.md' },
                  { k: 'files', label: '文件' }, { k: 'usage', label: '使用情况' },
                ]" :key="t.k" class="tab" :class="{ on: activeTab === t.k }"
                @click="activeTab = t.k as typeof activeTab"
              >{{ t.label }}</button>
            </div>
          </div>

          <div class="detail-body">
            <!-- 概览 -->
            <template v-if="activeTab === 'overview'">
              <div class="section-title">基本信息</div>
              <div class="grid">
                <div class="info-card">
                  <div class="info-label">状态</div>
                  <div class="status"><span class="dot green" />{{ statusMeta[groupStatus(selected)].label }}</div>
                </div>
                <div class="info-card"><div class="info-label">来源</div><div class="info-value">{{ sourceOf(selected) }}</div></div>
                <div class="info-card"><div class="info-label">大小</div><div class="info-value">{{ fmtSize(maxSize(selected)) }}</div></div>
                <div class="info-card"><div class="info-label">修改时间</div><div class="info-value">{{ fmtDate(lastMtime(selected)) }}</div></div>
              </div>

              <div class="section-title">接入工具</div>
              <div class="tool-boxes">
                <div
                  v-for="t in LINK_TOOLS" :key="t" class="tool-box"
                  :class="{ connected: toolState(selected, t).on }"
                >
                  <div class="tool-head">
                    <img v-if="toolDef(t)?.logo" class="tool-logo" :src="toolDef(t)?.logo" alt="">
                    <span class="tool-name">{{ toolName(t) }}</span>
                  </div>
                  <div class="tool-state" :class="{ off: !toolState(selected, t).on }">
                    {{ toolState(selected, t).on ? '● ' + toolState(selected, t).label : '○ 未接入' }}
                  </div>
                </div>
              </div>

              <div class="section-title">安装位置</div>
              <div class="source-card">
                <div class="source-row head">
                  <span>工具</span><span>接入方式</span><span>路径</span><span>大小</span>
                </div>
                <div v-for="e in selected.entries" :key="e.tool + e.path" class="source-row">
                  <span>{{ toolName(e.tool) }}</span>
                  <span>{{ e.linked ? '符号链接' : '目录副本' }}</span>
                  <span class="source-path mono" :title="e.abs">{{ e.abs || e.path }}</span>
                  <span class="dim">{{ fmtSize(e.size) }}</span>
                </div>
              </div>
            </template>

            <!-- SKILL.md -->
            <template v-else-if="activeTab === 'markdown'">
              <div class="md-wrap">
                <div class="md-toolbar">
                  <div class="md-toolbar-left">
                    <span class="file-pill mono">SKILL.md</span>
                    <span class="tag blue">Markdown</span>
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
              <div class="section-title">技能文件</div>
              <div class="section-sub dim small">walle 只收 SKILL.md 入库（降噪）；技能目录的附属脚本/参考文档不入库，需要时打开本地目录查看</div>
              <div class="tree">
                <div class="tree-row">
                  <span class="tree-icon">▾</span>
                  <strong class="mono">{{ selected.name }}/</strong>
                  <span class="tree-size dim">{{ fmtSize(maxSize(selected)) }}</span>
                </div>
                <div v-for="e in selected.entries" :key="e.tool + e.path" class="tree-row indent1">
                  <span class="tree-icon">◇</span>
                  <span class="mono">SKILL.md</span>
                  <span class="tree-size dim">{{ toolName(e.tool) }} · {{ fmtSize(e.size) }}</span>
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
                      <img v-if="toolDef(t)?.logo" class="tool-logo" :src="toolDef(t)?.logo" alt="">{{ toolName(t) }}
                    </span>
                    <span class="usage-version dim">{{ toolState(selected, t).on ? toolState(selected, t).label : '未接入' }}</span>
                  </div>
                  <div class="usage-line"><i :class="{ full: toolState(selected, t).on }" /></div>
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
  </div>
</template>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 18px; }
.head-actions { display: flex; gap: 8px; align-items: center; }
h2 { margin: 0 0 2px; font-size: 22px; font-weight: 700; letter-spacing: .2px; }

.workspace { display: grid; grid-template-columns: 380px minmax(0, 1fr); gap: 14px; align-items: stretch; }
@media (max-width: 1000px) { .workspace { grid-template-columns: 320px minmax(0, 1fr); } }
.panel { background: #fff; border: 1px solid var(--border); border-radius: 14px; min-height: 0; }

/* 左侧清单 */
.list-panel { display: flex; flex-direction: column; overflow: hidden; }
.list-tools { padding: 10px; border-bottom: 1px solid var(--border); }
.chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.chip { height: 26px; padding: 0 10px; border: 1px solid var(--border); background: #fff; border-radius: 13px; color: var(--dim); font-size: 11.5px; cursor: pointer; }
.chip:hover { background: var(--bg); }
.chip.on { background: #eaf3ff; border-color: #9ec5ff; color: #1468db; font-weight: 600; }
.advanced { display: flex; gap: 7px; margin-top: 8px; }
.list-summary { display: flex; justify-content: space-between; padding: 7px 12px 5px; font-size: 11px; }
.skill-list { overflow: auto; flex: 1; padding: 0 8px 8px; }
.skill-card { padding: 11px 10px; border: 1px solid transparent; border-radius: 10px; margin-bottom: 3px; cursor: pointer; }
.skill-card:hover { background: var(--bg); }
.skill-card.selected { background: #f7fbff; border-color: #6daaff; }
.skill-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.skill-name { font-size: 14px; font-weight: 700; }
.skill-count { font-size: 11px; white-space: nowrap; }
.skill-desc { margin-top: 4px; font-size: 11px; line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.meta { display: flex; gap: 5px; margin-top: 7px; align-items: center; flex-wrap: wrap; }
.tag { height: 19px; padding: 0 7px; border-radius: 10px; background: #f0f2f4; color: #666b73; font-size: 10px; display: inline-flex; align-items: center; gap: 4px; }
.tag.blue { background: #eaf3ff; color: #1670e8; }
.tag.green { background: #eaf8f1; color: #168455; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: #9aa0a8; display: inline-block; }
.dot.blue { background: #1670e8; }
.dot.green { background: #18a566; }

/* 右侧详情 */
.detail { display: flex; flex-direction: column; overflow: hidden; max-height: calc(100vh - 190px); }
.detail-head { padding: 17px 17px 0; border-bottom: 1px solid var(--border); }
.detail-title-row { display: flex; justify-content: space-between; gap: 15px; }
.dt-main { min-width: 0; }
.detail-title { font-size: 19px; font-weight: 750; }
.detail-desc { color: var(--dim); margin-top: 5px; line-height: 1.5; }
.pathbar { margin-top: 11px; background: var(--bg); border: 1px solid var(--border); border-radius: 8px; height: 32px; display: flex; align-items: center; padding: 0 10px; color: #5f646b; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.detail-meta { display: flex; gap: 18px; margin: 11px 0 12px; flex-wrap: wrap; }
.detail-meta strong { color: #3e4248; font-weight: 600; }
.tabs { display: flex; gap: 3px; }
.tab { height: 36px; border: 0; background: transparent; padding: 0 13px; color: var(--dim); border-bottom: 2px solid transparent; font-size: 13px; cursor: pointer; }
.tab:hover { color: #333; }
.tab.on { color: var(--accent); border-bottom-color: var(--accent); font-weight: 650; }
.detail-body { min-height: 0; flex: 1; overflow: auto; padding: 16px 17px; }

/* 概览 */
.section-title { font-size: 13px; font-weight: 700; margin: 16px 0 10px; }
.section-title:first-child { margin-top: 0; }
.section-sub { margin: -6px 0 12px; }
.grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
@media (max-width: 1280px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.info-card { border: 1px solid var(--border); border-radius: 10px; padding: 12px 13px; }
.info-label { font-size: 10px; color: var(--dim); margin-bottom: 6px; }
.info-value { font-size: 12.5px; font-weight: 600; word-break: break-all; }
.status { display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border-radius: 8px; background: #eaf8f1; color: #138052; font-size: 11px; font-weight: 600; }
.tool-boxes { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 1280px) { .tool-boxes { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.tool-box { border: 1px solid var(--border); border-radius: 10px; padding: 11px; }
.tool-box.connected { border-color: #cfe6da; }
.tool-head { display: flex; align-items: center; gap: 7px; }
.tool-logo { width: 16px; height: 16px; border-radius: 4px; object-fit: contain; background: #fff; border: 1px solid var(--border); }
.tool-name { font-weight: 650; font-size: 12px; }
.tool-state { margin-top: 9px; font-size: 10px; color: #188354; }
.tool-state.off { color: #9b9fa5; }
.source-card { border: 1px solid var(--border); border-radius: 11px; overflow: hidden; }
.source-row { display: grid; grid-template-columns: 110px 90px minmax(0, 1fr) 70px; align-items: center; gap: 10px; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 11.5px; }
.source-row:last-child { border-bottom: 0; }
.source-row.head { background: var(--bg); color: var(--dim); font-size: 11px; }
.source-path { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

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
.tree { border: 1px solid var(--border); border-radius: 11px; overflow: hidden; }
.tree-row { min-height: 38px; display: flex; align-items: center; padding: 6px 12px; gap: 8px; border-bottom: 1px solid var(--border); font-size: 12px; }
.tree-row:last-child { border-bottom: 0; }
.tree-row:hover { background: var(--bg); }
.tree-icon { color: #7b8188; }
.tree-size { font-size: 10px; margin-left: auto; }
.indent1 { padding-left: 34px; }

/* 使用情况 */
.usage { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.usage-card { border: 1px solid var(--border); border-radius: 11px; padding: 14px 15px; }
.usage-card.connected { border-color: #cfe6da; }
.usage-top { display: flex; justify-content: space-between; align-items: center; }
.usage-tool { font-weight: 700; font-size: 12.5px; display: inline-flex; align-items: center; gap: 7px; }
.usage-version { font-size: 10px; }
.usage-line { height: 7px; background: #eef0f3; border-radius: 5px; margin: 12px 0 8px; overflow: hidden; }
.usage-line i { display: block; height: 100%; width: 0; background: #d3d7dc; border-radius: 5px; }
.usage-line i.full { width: 100%; background: #4c91ef; }
.usage-foot { display: flex; justify-content: space-between; font-size: 10px; }
</style>
