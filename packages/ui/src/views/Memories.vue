<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import UiButton from '../components/ui/Button.vue';
import UiInput from '../components/ui/Input.vue';
import UiEmpty from '../components/ui/Empty.vue';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';
import agentsLogo from '../assets/logos/agents.svg';

/** 统一记忆视图（P5.2）：跨工具记忆聚合——根记忆（工具 home 根）与项目记忆（项目点目录下的 memory 文件）+ 相似检测 */
interface MemoryEntry {
  assetId: number; tool: string; name: string; path: string;
  format: string | null; size: number | null; mtime: string | null;
  contentHash: string | null; sensitive: number;
  scope: 'global' | 'project'; projectRoot: string | null;
}
interface SimilarGroup { kind: 'name' | 'content'; label: string; assetIds: number[] }

const toolLabel: Record<string, string> = { codex: 'Codex CLI', zcode: 'ZCode', cursor: 'Cursor', opencode: 'OpenCode', workbuddy: 'WorkBuddy 国际版', 'workbuddy-cn': 'WorkBuddy 国内版', agents: 'Skills 共享库' };
const toolLogos: Record<string, string> = { zcode: zcodeLogo, codex: openaiLogo, cursor: cursorLogo, opencode: opencodeLogo, workbuddy: workbuddyLogo, 'workbuddy-cn': workbuddyLogo, agents: agentsLogo };
const TOOL_ORDER = ['zcode', 'codex', 'cursor', 'opencode', 'workbuddy', 'workbuddy-cn', 'agents'];

const memories = ref<MemoryEntry[]>([]);
const similar = ref<SimilarGroup[]>([]);
const activeTool = ref<string | null>(null);
const scope = ref<'' | 'global' | 'project' | 'similar'>('');
const q = ref('');
const selected = ref<MemoryEntry | null>(null);
const tab = ref<'overview' | 'source' | 'similar'>('source');
const rawText = ref<string | null>(null);
const rawSensitive = ref(false);
const rawError = ref('');

function humanSize(b: number | null): string {
  if (b == null) return '-';
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1048576).toFixed(1)}MB`;
}
function fmtTime(iso: string | null): string { return iso ? iso.replace('T', ' ').slice(0, 19) : '-'; }
function mdHtml(src: string): string {
  return DOMPurify.sanitize(marked.parse(src) as string);
}
/** 项目根显示名：路径末段 */
function projectName(root: string): string {
  const segs = root.split(/[\\/]+/).filter(Boolean);
  return segs[segs.length - 1] ?? root;
}

/** 相似组内条目 id 集合（列表打徽标 + 「相似」筛选） */
const similarIds = computed(() => {
  const s = new Set<number>();
  for (const g of similar.value) for (const id of g.assetIds) s.add(id);
  return s;
});
const groupsOf = (id: number): SimilarGroup[] => similar.value.filter((g) => g.assetIds.includes(id));

/** 实际有记忆的工具（保持固定顺序） */
const tools = computed(() => {
  const present = new Set(memories.value.map((m) => m.tool));
  return TOOL_ORDER.filter((t) => present.has(t));
});
const toolCount = (t: string) => memories.value.filter((m) => m.tool === t).length;

const scoped = computed(() => (activeTool.value ? memories.value.filter((m) => m.tool === activeTool.value) : memories.value));
const nGlobal = computed(() => scoped.value.filter((m) => m.scope === 'global').length);
const nProject = computed(() => scoped.value.filter((m) => m.scope === 'project').length);
const nSimilar = computed(() => scoped.value.filter((m) => similarIds.value.has(m.assetId)).length);

const filtered = computed(() => {
  let list = scoped.value;
  if (scope.value === 'global') list = list.filter((m) => m.scope === 'global');
  else if (scope.value === 'project') list = list.filter((m) => m.scope === 'project');
  else if (scope.value === 'similar') list = list.filter((m) => similarIds.value.has(m.assetId));
  if (q.value) {
    const s = q.value.toLowerCase();
    list = list.filter((m) => m.path.toLowerCase().includes(s) || m.name.toLowerCase().includes(s));
  }
  return list;
});

/** 列表分组：根记忆按工具一组，项目记忆按项目根一组；全局在前，项目按最近修改排序 */
interface MemGroup { key: string; label: string; sub: string; logo: string | null; entries: MemoryEntry[] }
const visibleGroups = computed<MemGroup[]>(() => {
  const groups: MemGroup[] = [];
  for (const t of TOOL_ORDER) {
    const arr = filtered.value.filter((m) => m.scope === 'global' && m.tool === t);
    if (arr.length) groups.push({ key: `global:${t}`, label: toolLabel[t] ?? t, sub: '根记忆', logo: toolLogos[t], entries: arr });
  }
  const byRoot = new Map<string, MemoryEntry[]>();
  for (const m of filtered.value) {
    if (m.scope !== 'project') continue;
    const key = m.projectRoot ?? m.path;
    byRoot.set(key, [...(byRoot.get(key) ?? []), m]);
  }
  const roots = [...byRoot.keys()].sort((a, b) => {
    const maxMtime = (arr) => (arr ?? []).reduce((acc, m) => (m.mtime ?? '' > acc ? m.mtime ?? '' : acc), '');
    return maxMtime(byRoot.get(b)).localeCompare(maxMtime(byRoot.get(a)));
  });
  for (const r of roots) {
    groups.push({ key: r, label: projectName(r), sub: r, logo: null, entries: byRoot.get(r) ?? [] });
  }
  return groups;
});

async function open(m: MemoryEntry) {
  selected.value = m;
  rawText.value = null;
  rawError.value = '';
  tab.value = 'source';
  const d = await (await fetch(`/api/source?asset=${m.assetId}&raw=1`)).json();
  if (d.error) {
    rawError.value = String(d.error);
    return;
  }
  rawSensitive.value = !!d.sensitive;
  const text = String(d.content ?? '') + (d.truncated ? '\n…（截断）' : '');
  // 预览剥离 frontmatter（元信息已在头部展示，与技能页口径一致）
  rawText.value = m.format === 'markdown' ? text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '') : text;
}
function jumpTo(m: MemoryEntry) {
  const target = memories.value.find((x) => x.assetId === m.assetId);
  if (target) open(target);
}

onMounted(async () => {
  const d = await (await fetch('/api/memories')).json();
  memories.value = d.memories ?? [];
  similar.value = d.similar ?? [];
});
</script>

<template>
  <div class="page">
    <!-- 第一层：工具 -->
    <div class="toolbar glassbar">
      <div class="tabs-strip">
        <UiButton
          size="sm" class="h-8 gap-1.5 px-3"
          :variant="activeTool === null ? 'default' : 'ghost'"
          @click="activeTool = null"
        >
          <span class="tab-dot">M</span>
          <span class="tab-name">全部工具</span>
          <span class="tab-n">{{ memories.length }}</span>
        </UiButton>
        <UiButton
          v-for="t in tools" :key="t"
          size="sm" class="h-8 gap-1.5 px-3"
          :variant="activeTool === t ? 'default' : 'ghost'"
          @click="activeTool = t"
        >
          <img class="tab-logo" :src="toolLogos[t]" :alt="t">
          <span class="tab-name">{{ toolLabel[t] }}</span>
          <span class="tab-n">{{ toolCount(t) }}</span>
        </UiButton>
      </div>
      <UiInput v-model:value="q" placeholder="搜索记忆 / 路径…" class="search" />
    </div>

    <!-- 第二层：作用域 -->
    <div class="typerow">
      <UiButton size="sm" class="h-7 gap-1.5 px-3" :variant="scope === '' ? 'secondary' : 'ghost'" :class="scope === '' ? '!bg-primary/10 !text-primary !font-semibold' : ''" @click="scope = ''">全部<span class="tchip-n">{{ scoped.length }}</span></UiButton>
      <UiButton size="sm" class="h-7 gap-1.5 px-3" :variant="scope === 'global' ? 'secondary' : 'ghost'" :class="scope === 'global' ? '!bg-primary/10 !text-primary !font-semibold' : ''" @click="scope = 'global'">根记忆<span class="tchip-n">{{ nGlobal }}</span></UiButton>
      <UiButton size="sm" class="h-7 gap-1.5 px-3" :variant="scope === 'project' ? 'secondary' : 'ghost'" :class="scope === 'project' ? '!bg-primary/10 !text-primary !font-semibold' : ''" @click="scope = 'project'">项目记忆<span class="tchip-n">{{ nProject }}</span></UiButton>
      <UiButton size="sm" class="h-7 gap-1.5 px-3" :variant="scope === 'similar' ? 'secondary' : 'ghost'" :class="scope === 'similar' ? '!bg-primary/10 !text-primary !font-semibold' : ''" @click="scope = 'similar'">相似<span class="tchip-n">{{ nSimilar }}</span></UiButton>
    </div>

    <div class="body">
      <!-- 记忆列表（按作用域分组） -->
      <div class="list card">
        <div class="list-head">
          <span class="lh-title">记忆</span>
          <span class="lh-n">{{ filtered.length }} 条 · {{ visibleGroups.length }} 组</span>
        </div>
        <div class="list-scroll">
          <template v-for="grp in visibleGroups" :key="grp.key">
            <div class="grp-head" :title="grp.sub">
              <img v-if="grp.logo" class="grp-logo" :src="grp.logo" :alt="grp.key">
              <span v-else class="grp-dot" />
              <span class="grp-name">{{ grp.label }}</span>
              <span class="dim small">{{ grp.entries.length }}</span>
            </div>
            <div
              v-for="m in grp.entries" :key="m.assetId"
              class="arow" :class="{ sel: selected?.assetId === m.assetId }" @click="open(m)"
            >
              <img class="arow-logo" :src="toolLogos[m.tool]" :alt="m.tool">
              <span class="arow-main">
                <span class="arow-name">
                  <span class="arow-name-t">{{ m.name }}</span>
                  <span class="scope" :class="{ proj: m.scope === 'project' }">{{ m.scope === 'project' ? '项目' : '根' }}</span>
                  <span v-if="m.sensitive" class="sflag">敏感</span>
                  <span v-for="g in groupsOf(m.assetId)" :key="g.kind + g.label" class="dup">{{ g.kind === 'name' ? '同名' : '同内容' }}</span>
                </span>
                <span class="arow-path mono" :title="m.path">{{ m.path }}</span>
              </span>
              <span class="arow-size">{{ humanSize(m.size) }}</span>
            </div>
          </template>
          <UiEmpty v-if="!filtered.length" description="没有匹配的记忆" style="padding:60px 0" />
        </div>
      </div>

      <!-- Inspector -->
      <div v-if="selected" class="inspector card">
        <div class="insp-head">
          <img class="insp-logo" :src="toolLogos[selected.tool]" :alt="selected.tool">
          <div class="insp-id">
            <div class="insp-title" :title="selected.name">{{ selected.name }}</div>
            <div class="insp-sub">
              <span>{{ selected.scope === 'project' ? '项目记忆' : '根记忆' }} · {{ toolLabel[selected.tool] ?? selected.tool }}</span>
              <span>{{ humanSize(selected.size) }}</span>
              <span>修改于 {{ fmtTime(selected.mtime) }}</span>
              <span>哈希 {{ selected.contentHash?.slice(0, 10) ?? '-' }}</span>
            </div>
          </div>
        </div>

        <div class="insp-tabs">
          <UiButton size="sm" class="h-7 px-3" :variant="tab === 'source' ? 'secondary' : 'ghost'" :class="tab === 'source' ? '!bg-primary/10 !text-primary !font-semibold' : ''" @click="tab = 'source'">内容</UiButton>
          <UiButton size="sm" class="h-7 px-3" :variant="tab === 'overview' ? 'secondary' : 'ghost'" :class="tab === 'overview' ? '!bg-primary/10 !text-primary !font-semibold' : ''" @click="tab = 'overview'">概览</UiButton>
          <UiButton size="sm" class="h-7 px-3 gap-1.5" :variant="tab === 'similar' ? 'secondary' : 'ghost'" :class="tab === 'similar' ? '!bg-primary/10 !text-primary !font-semibold' : ''" @click="tab = 'similar'">
            相似<span v-if="groupsOf(selected.assetId).length" class="itab-n">{{ groupsOf(selected.assetId).length }}</span>
          </UiButton>
        </div>

        <!-- 内容（markdown 渲染；sqlite 等二进制记忆如实空态） -->
        <div v-if="tab === 'source'" class="panel">
          <div v-if="rawError" class="empty-note pad-note">{{ rawError }}</div>
          <template v-else-if="rawText !== null">
            <div v-if="rawSensitive" class="src-warn small">敏感记忆，内容已脱敏展示</div>
            <article v-if="selected.format === 'markdown'" class="md-content" v-html="mdHtml(rawText)"></article>
            <pre v-else class="code">{{ rawText }}</pre>
          </template>
          <UiEmpty v-else size="small" description="加载中…" style="padding:60px 0" />
        </div>

        <!-- 概览 -->
        <div v-else-if="tab === 'overview'" class="panel pad">
          <div class="meta"><span class="mk">名称</span><span class="mv">{{ selected.name }}</span></div>
          <div class="meta"><span class="mk">作用域</span><span class="mv">{{ selected.scope === 'project' ? '项目记忆' : '根记忆' }}</span></div>
          <div v-if="selected.projectRoot" class="meta"><span class="mk">项目</span><span class="mv mono">{{ selected.projectRoot }}</span></div>
          <div class="meta"><span class="mk">工具</span><span class="mv">{{ toolLabel[selected.tool] ?? selected.tool }}</span></div>
          <div class="meta"><span class="mk">路径</span><span class="mv mono">{{ selected.path }}</span></div>
          <div class="meta"><span class="mk">大小</span><span class="mv">{{ humanSize(selected.size) }}</span></div>
          <div class="meta"><span class="mk">格式</span><span class="mv">{{ selected.format ?? '-' }}</span></div>
          <div class="meta"><span class="mk">修改时间</span><span class="mv">{{ fmtTime(selected.mtime) }}</span></div>
          <div class="meta"><span class="mk">内容哈希</span><span class="mv mono">{{ selected.contentHash ?? '-' }}</span></div>
          <div class="meta"><span class="mk">资产 ID</span><span class="mv mono">#{{ selected.assetId }}</span></div>
        </div>

        <!-- 相似 -->
        <div v-else class="panel pad">
          <template v-if="groupsOf(selected.assetId).length">
            <div v-for="g in groupsOf(selected.assetId)" :key="g.kind + g.label" class="simgrp">
              <div class="sec-title">{{ g.label }}</div>
              <div
                v-for="id in g.assetIds" :key="id"
                class="arow" :class="{ sel: id === selected.assetId }" @click="jumpTo(memories.find((x) => x.assetId === id)!)"
              >
                <img class="arow-logo" :src="toolLogos[memories.find((x) => x.assetId === id)?.tool ?? '']" alt="">
                <span class="arow-main">
                  <span class="arow-name"><span class="arow-name-t">{{ memories.find((x) => x.assetId === id)?.name }}</span></span>
                  <span class="arow-path mono">{{ memories.find((x) => x.assetId === id)?.path }}</span>
                </span>
                <span class="arow-size">{{ memories.find((x) => x.assetId === id)?.scope === 'project' ? '项目' : '根' }}</span>
              </div>
            </div>
          </template>
          <div v-else class="empty-note">
            <div>未发现相似记忆</div>
            <div class="dim small">检测口径：同名跨作用域、内容哈希一致</div>
          </div>
        </div>
      </div>

      <div v-else class="inspector card empty-detail">
        <UiEmpty description="选择记忆查看内容与相似条目" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { margin: -24px -40px -56px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

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
.search { flex: 0 0 auto; width: 260px; }

.typerow { flex: 0 0 auto; height: 42px; display: flex; gap: 4px; align-items: center; padding: 0 16px; background: var(--card-solid); border-bottom: 1px solid var(--border); overflow-x: auto; }
.typerow::-webkit-scrollbar { height: 0; }
.tchip { display: inline-flex; gap: 8px; align-items: center; height: 28px; padding: 0 12px; border: none; border-radius: 8px; background: transparent; color: var(--dim); font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.tchip:hover { background: rgba(0, 0, 0, .05); color: var(--text); }
.tchip.on { background: rgba(0, 113, 227, .1); color: var(--accent); font-weight: 600; }
.tchip-n { font-size: 11px; opacity: .75; }

.body { flex: 1; min-height: 0; display: flex; gap: 12px; padding: 12px 16px 16px; overflow: hidden; }

.list { flex: 1 1 42%; min-width: 300px; display: flex; flex-direction: column; overflow: hidden; }
.list-head { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.lh-title { font-size: 13.5px; font-weight: 700; }
.lh-n { font-size: 12px; color: var(--dim); }
.list-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; overscroll-behavior: contain; }
.grp-head { display: flex; gap: 8px; align-items: center; padding: 10px 8px 4px; }
.grp-logo { width: 18px; height: 18px; border-radius: 4px; object-fit: contain; background: #fff; }
.grp-dot { width: 10px; height: 10px; border-radius: 3px; background: var(--accent); opacity: .55; flex-shrink: 0; }
.grp-name { font-weight: 700; font-size: 12.5px; }
.arow { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; }
.arow:hover { background: var(--bg); }
.arow.sel { background: rgba(0, 113, 227, .08); border-color: var(--accent); }
.arow-logo { width: 16px; height: 16px; border-radius: 4px; object-fit: contain; background: #fff; flex-shrink: 0; }
.arow-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.arow-name { font-size: 13.5px; font-weight: 600; display: flex; gap: 8px; align-items: center; min-width: 0; }
.arow-name-t { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.arow-path { font-size: 11.5px; color: var(--dim); word-break: break-all; line-height: 1.5; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1; overflow: hidden; }
.arow-size { flex-shrink: 0; font-size: 11.5px; color: var(--dim); }
.sflag { flex-shrink: 0; font-size: 10px; font-weight: 500; color: var(--warn); border: 1px solid currentColor; border-radius: 4px; padding: 0 4px; line-height: 14px; }
.scope { flex-shrink: 0; font-size: 10px; font-weight: 500; color: var(--dim); border: 1px solid currentColor; border-radius: 4px; padding: 0 4px; line-height: 14px; }
.scope.proj { color: var(--accent); }
.dup { flex-shrink: 0; font-size: 10px; font-weight: 500; color: var(--accent); background: rgba(0, 113, 227, .08); border-radius: 4px; padding: 0 4px; line-height: 14px; }

.inspector { flex: 1 1 58%; min-width: 360px; display: flex; flex-direction: column; overflow: hidden; }
.empty-detail { align-items: center; justify-content: center; }
.insp-head { flex: 0 0 auto; display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.insp-logo { width: 20px; height: 20px; border-radius: 5px; object-fit: contain; background: #fff; flex-shrink: 0; margin-top: 1px; }
.insp-id { flex: 1; min-width: 0; }
.insp-title { font-size: 15px; font-weight: 700; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.insp-sub { display: flex; flex-wrap: wrap; gap: 2px 8px; font-size: 12px; color: var(--dim); line-height: 1.6; }
.insp-sub > span { white-space: nowrap; }
.insp-tabs { flex: 0 0 auto; display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.itab { height: 28px; padding: 0 12px; border: none; border-radius: 8px; background: transparent; color: var(--dim); font-size: 13px; cursor: pointer; }
.itab:hover { background: rgba(0, 0, 0, .05); color: var(--text); }
.itab.on { background: rgba(0, 113, 227, .1); color: var(--accent); font-weight: 600; }
.itab-n { margin-left: 4px; font-size: 11px; }
.panel { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.panel.pad { padding: 12px 16px 16px; }
.sec-title { font-size: 12px; font-weight: 600; color: var(--dim); margin: 4px 0 8px; }
.simgrp { margin-bottom: 16px; }

.meta { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12.5px; }
.meta:last-child { border-bottom: none; }
.mk { flex: 0 0 76px; color: var(--dim); }
.mv { flex: 1; min-width: 0; word-break: break-all; }

.src-warn { flex: 0 0 auto; padding: 8px 16px; color: var(--warn); border-bottom: 1px solid var(--border); }
.code { flex: 1; min-height: 0; width: 100%; margin: 0; background: var(--code-bg); border: none; padding: 12px 16px; font: 12px/1.55 "SF Mono", ui-monospace, Consolas, monospace; white-space: pre; overflow: auto; color: var(--text); }
.empty-note { padding: 12px 0; font-size: 12.5px; line-height: 1.8; }
.pad-note { padding: 16px; }

.md-content { padding: 22px 30px; line-height: 1.7; max-width: 1100px; margin: auto; font-size: 13.5px; }
.md-content :deep(h1) { font-size: 24px; margin: 0 0 14px; }
.md-content :deep(h2) { font-size: 18px; margin: 24px 0 10px; }
.md-content :deep(h3) { font-size: 14px; margin: 18px 0 8px; }
.md-content :deep(p), .md-content :deep(li) { color: #4e535a; }
.md-content :deep(li) { margin: 6px 0; }
.md-content :deep(pre) { font-family: "SF Mono", ui-monospace, Consolas, monospace; background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; overflow: auto; font-size: 12px; }
.md-content :deep(code) { font-family: "SF Mono", ui-monospace, Consolas, monospace; font-size: 12px; }

@media (max-width: 1024px) {
  .body { flex-direction: column; overflow-y: auto; }
  .list, .inspector { flex: none; width: 100%; min-width: 0; }
  .list { max-height: 46vh; }
  .inspector { max-height: 70vh; }
  .search { width: 180px; }
}
</style>
