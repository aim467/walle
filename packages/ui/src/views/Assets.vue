<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { NInput, NSelect, NButton, NEmpty } from 'naive-ui';
import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';

interface Asset {
  id: number; tool: string; kind: string; name: string | null; path: string;
  rawFormat: string | null; contentHash: string | null; size: number | null;
  mtime: string | null; sensitive: number; status: string;
}
interface Snapshot { id: number; capturedAt: string; contentHash: string; size: number | null }

const kindLabel: Record<string, string> = {
  config: '配置', memory: '记忆', skill: 'Skill', mcp: 'MCP', rule: '规则',
  agent: '子代理', plugin: '插件', secret: '凭证', other: '其他',
};
const toolLabel: Record<string, string> = { codex: 'Codex CLI', zcode: 'ZCode', cursor: 'Cursor', opencode: 'OpenCode', workbuddy: 'WorkBuddy' };
const toolLogos: Record<string, string> = { zcode: zcodeLogo, codex: openaiLogo, cursor: cursorLogo, opencode: opencodeLogo, workbuddy: workbuddyLogo };

/** 资产类型图标（24×24 描边 path，lucide 风格；未知类型回退到「盒子」） */
const ICON_PATHS: Record<string, string[]> = {
  all: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
  skill: ['M13 2 3 14h9l-1 8 10-12h-9l1-8z'],
  config: ['M4 21v-7', 'M4 10V3', 'M12 21v-9', 'M12 8V3', 'M20 21v-5', 'M20 12V3', 'M1 14h6', 'M9 8h6', 'M17 16h6'],
  memory: ['M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z'],
  rule: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'],
  secret: ['M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4'],
  mcp: ['M12 22v-5', 'M9 8V2', 'M15 8V2', 'M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z'],
  agent: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z'],
  plugin: ['M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z'],
  other: ['M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z', 'M3.3 7l8.7 5 8.7-5', 'M12 22V12'],
};
const kindIcon = (k: string): string[] => ICON_PATHS[k] ?? ICON_PATHS.other;
/** 会话类资产由「会话」页负责，此处排除避免两个页面职责冲突 */
const EXCLUDED_KINDS = new Set(['session', 'prompt']);
/** ZCode 模型 I/O 遥测也属会话数据（kind=other），一并移交会话页 */
const isSessionAsset = (a: Asset) => EXCLUDED_KINDS.has(a.kind) || a.path.includes('model-io-');

const TOOLS = ['zcode', 'codex', 'cursor', 'opencode', 'workbuddy'];
/** 资产类型的固定展示顺序（只渲染实际存在的类型） */
const KIND_ORDER = ['skill', 'config', 'memory', 'rule', 'secret', 'mcp', 'agent', 'plugin', 'other'];
const sortOptions = [
  { label: '名称', value: 'name' },
  { label: '大小', value: 'size' },
  { label: '修改时间', value: 'mtime' },
];

const assets = ref<Asset[]>([]);
const kind = ref('');
const activeTool = ref<string | null>(null);
const q = ref('');
const sortKey = ref('name');
const selected = ref<Asset | null>(null);
const source = ref<{ content: string; sensitive: boolean } | null>(null);
const snapshots = ref<Snapshot[]>([]);
const tab = ref<'overview' | 'source' | 'history'>('source');
const editing = ref(false);
const editText = ref('');
const writeEnabled = ref(false);
const writeMsg = ref('');

function humanSize(b: number | null): string {
  if (b == null) return '-';
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)}MB`;
  return `${(b / 1073741824).toFixed(2)}GB`;
}
function fmtTime(iso: string | null): string { return iso ? iso.replace('T', ' ').slice(0, 19) : '-'; }

/** 列表主标题：优先用索引器给的 name，缺失时从路径推导（SKILL.md / config.toml 取所在目录名） */
const FILE_LIKE = /^(skill|index|readme|config|settings|package)\.(md|markdown|toml|jsonc?|ya?ml|txt)$/i;
function assetName(a: Asset): string {
  const n = a.name?.trim();
  if (n) return n;
  const segs = a.path.split(/[\\/]+/).filter(Boolean);
  if (!segs.length) return a.path;
  const base = segs[segs.length - 1];
  if (FILE_LIKE.test(base) && segs.length > 1) return segs[segs.length - 2];
  return base;
}

/** 当前 AI 工具作用域内的全部非会话资产 */
const scoped = computed(() => {
  const base = assets.value.filter((a) => !isSessionAsset(a));
  return activeTool.value ? base.filter((a) => a.tool === activeTool.value) : base;
});
const listFiltered = computed(() => {
  let list = scoped.value;
  if (kind.value) list = list.filter((a) => a.kind === kind.value);
  if (q.value) {
    const s = q.value.toLowerCase();
    list = list.filter((a) => a.path.toLowerCase().includes(s) || (a.name ?? '').toLowerCase().includes(s));
  }
  return list;
});
const listSorted = computed(() => {
  const arr = [...listFiltered.value];
  const k = sortKey.value;
  arr.sort((a, b) => {
    if (k === 'size') return (b.size ?? -1) - (a.size ?? -1);
    if (k === 'mtime') return (b.mtime ?? '').localeCompare(a.mtime ?? '');
    return assetName(a).localeCompare(assetName(b), 'zh-Hans-CN');
  });
  return arr;
});
const kindCounts = computed(() => {
  const m = new Map<string, number>();
  for (const a of scoped.value) m.set(a.kind, (m.get(a.kind) ?? 0) + 1);
  return m;
});
/** 顶部第二层：资产类型 Tab（含「全部」），按固定顺序排列 */
const kindTabs = computed(() => {
  const c = kindCounts.value;
  const tabs = KIND_ORDER.filter((k) => c.has(k)).map((k) => ({ key: k, label: kindLabel[k] ?? k, n: c.get(k) ?? 0 }));
  for (const [k, n] of c) if (!KIND_ORDER.includes(k)) tabs.push({ key: k, label: kindLabel[k] ?? k, n });
  return tabs;
});
const totalInScope = computed(() => scoped.value.length);
/** 列表按工具分组；只有一个工具可见时隐藏分组头（顶部 Tab 已表达同一信息） */
const visibleGroups = computed(() => {
  const list = listSorted.value;
  const groups: { tool: string; assets: Asset[] }[] = [];
  for (const t of TOOLS) {
    const arr = list.filter((a) => a.tool === t);
    if (arr.length) groups.push({ tool: t, assets: arr });
  }
  return groups;
});
const toolCount = (t: string) => assets.value.filter((a) => a.tool === t && !isSessionAsset(a)).length;
const totalShown = computed(() => assets.value.filter((a) => !isSessionAsset(a)).length);
const listTitle = computed(() => (kind.value ? (kindLabel[kind.value] ?? kind.value) : '全部资产'));

const editable = (a: Asset) => a.kind !== 'session' && a.rawFormat !== 'sqlite' && a.rawFormat !== 'dir';

async function open(a: Asset) {
  selected.value = a;
  source.value = null;
  editing.value = false;
  writeMsg.value = '';
  tab.value = editable(a) ? 'source' : 'overview';
  snapshots.value = (await (await fetch('/api/snapshots?asset=' + a.id)).json()).snapshots ?? [];
  if (editable(a)) {
    const s = await (await fetch('/api/source?asset=' + a.id)).json();
    if (!s.error) source.value = { content: s.content, sensitive: s.sensitive };
  }
}
function startEdit() {
  if (!source.value) return;
  tab.value = 'source';
  editText.value = source.value.content;
  editing.value = true;
  writeMsg.value = '';
}
async function saveWrite() {
  if (!selected.value) return;
  const r = await (await fetch('/api/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: selected.value.id, content: editText.value }) })).json();
  if (r.ok) {
    writeMsg.value = `已写回 · 写前快照 #${r.snapshotId}，可回滚`;
    editing.value = false;
    await open(selected.value);
    tab.value = 'source';
  } else {
    writeMsg.value = '拒绝: ' + (r.reason || r.error);
  }
}

onMounted(async () => {
  writeEnabled.value = (await (await fetch('/api/config')).json()).allowWrite;
  assets.value = await (await fetch('/api/assets').then((r) => r.json()));
});
</script>

<template>
  <div class="page">
    <!-- 第一层：AI 工具 / 数据源 -->
    <div class="toolbar glassbar">
      <div class="tabs-strip">
        <button class="tab" :class="{ on: activeTool === null }" @click="activeTool = null">
          <span class="tab-dot">A</span>
          <span class="tab-name">全部工具</span>
          <span class="tab-n">{{ totalShown }}</span>
        </button>
        <button
          v-for="t in TOOLS" :key="t"
          class="tab" :class="{ on: activeTool === t, off: !toolCount(t) }" @click="activeTool = t"
        >
          <img class="tab-logo" :src="toolLogos[t]" :alt="t">
          <span class="tab-name">{{ toolLabel[t] }}</span>
          <span class="tab-n">{{ toolCount(t) }}</span>
        </button>
      </div>
      <n-input v-model:value="q" placeholder="搜索资产 / 路径…" size="small" round clearable class="search" />
    </div>

    <!-- 第二层：资产类型（原左侧纵向分类栏移到这里） -->
    <div class="typerow">
      <button class="tchip" :class="{ on: kind === '' }" @click="kind = ''">
        <svg class="tchip-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path v-for="(d, i) in kindIcon('all')" :key="i" :d="d" />
        </svg>
        全部<span class="tchip-n">{{ totalInScope }}</span>
      </button>
      <button v-for="t in kindTabs" :key="t.key" class="tchip" :class="{ on: kind === t.key }" @click="kind = t.key">
        <svg class="tchip-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path v-for="(d, i) in kindIcon(t.key)" :key="i" :d="d" />
        </svg>
        {{ t.label }}<span class="tchip-n">{{ t.n }}</span>
      </button>
    </div>

    <div class="body">
      <!-- 资产列表 -->
      <div class="list card">
        <div class="list-head">
          <span class="lh-title">{{ listTitle }}</span>
          <span class="lh-n">{{ listFiltered.length }} 个资源</span>
          <span class="flex1" />
          <n-select v-model:value="sortKey" :options="sortOptions" size="small" class="sortsel" />
        </div>
        <div class="list-scroll">
          <template v-for="grp in visibleGroups" :key="grp.tool">
            <div v-if="visibleGroups.length > 1" class="grp-head">
              <img class="grp-logo" :src="toolLogos[grp.tool]" :alt="grp.tool">
              <span class="grp-name">{{ toolLabel[grp.tool] }}</span>
              <span class="dim small">{{ grp.assets.length }}</span>
            </div>
            <div
              v-for="a in grp.assets" :key="a.id"
              class="arow" :class="{ sel: selected?.id === a.id }" @click="open(a)"
            >
              <img v-if="!activeTool" class="arow-logo" :src="toolLogos[a.tool]" :alt="a.tool">
              <span class="arow-main">
                <span class="arow-name" :title="assetName(a)">
                  <span class="arow-name-t">{{ assetName(a) }}</span>
                  <span v-if="a.sensitive" class="sflag">敏感</span>
                </span>
                <span class="arow-path mono" :title="a.path">{{ a.path }}</span>
              </span>
              <span class="arow-size">{{ humanSize(a.size) }}</span>
            </div>
          </template>
          <n-empty v-if="!listFiltered.length" description="没有匹配的资产" style="padding:60px 0" />
        </div>
      </div>

      <!-- 资产 Inspector -->
      <div v-if="selected" class="inspector card">
        <div class="insp-head">
          <img class="insp-logo" :src="toolLogos[selected.tool]" :alt="selected.tool">
          <div class="insp-id">
            <div class="insp-title" :title="assetName(selected)">{{ assetName(selected) }}</div>
            <div class="insp-sub">
              <span>{{ kindLabel[selected.kind] ?? selected.kind }}</span>
              <span>{{ humanSize(selected.size) }}</span>
              <span>修改于 {{ fmtTime(selected.mtime) }}</span>
              <span>哈希 {{ selected.contentHash?.slice(0, 10) ?? '-' }}</span>
            </div>
          </div>
          <div class="insp-act">
            <template v-if="editing">
              <n-button size="tiny" round type="primary" @click="saveWrite">保存</n-button>
              <n-button size="tiny" round @click="editing = false">取消</n-button>
            </template>
            <template v-else-if="source">
              <n-button size="tiny" round :disabled="!writeEnabled" @click="startEdit">编辑</n-button>
              <span v-if="!writeEnabled" class="dim small" title="在 ~/.walle/config.json 中开启 allowWrite">写回未开启</span>
            </template>
          </div>
        </div>

        <div class="insp-tabs">
          <button class="itab" :class="{ on: tab === 'overview' }" @click="tab = 'overview'">概览</button>
          <button class="itab" :class="{ on: tab === 'source' }" @click="tab = 'source'">原文</button>
          <button class="itab" :class="{ on: tab === 'history' }" @click="tab = 'history'">历史</button>
        </div>

        <div v-if="writeMsg" class="msgline small" :class="{ warn: writeMsg.startsWith('拒绝') }">{{ writeMsg }}</div>

        <!-- 概览 -->
        <div v-if="tab === 'overview'" class="panel pad">
          <div class="meta"><span class="mk">工具</span><span class="mv">{{ toolLabel[selected.tool] ?? selected.tool }}</span></div>
          <div class="meta"><span class="mk">类型</span><span class="mv">{{ kindLabel[selected.kind] ?? selected.kind }}</span></div>
          <div class="meta"><span class="mk">名称</span><span class="mv">{{ assetName(selected) }}</span></div>
          <div class="meta"><span class="mk">路径</span><span class="mv mono">{{ selected.path }}</span></div>
          <div class="meta"><span class="mk">大小</span><span class="mv">{{ humanSize(selected.size) }}</span></div>
          <div class="meta"><span class="mk">格式</span><span class="mv">{{ selected.rawFormat ?? '-' }}</span></div>
          <div class="meta"><span class="mk">修改时间</span><span class="mv">{{ fmtTime(selected.mtime) }}</span></div>
          <div class="meta"><span class="mk">内容哈希</span><span class="mv mono">{{ selected.contentHash ?? '-' }}</span></div>
          <div class="meta"><span class="mk">状态</span><span class="mv">{{ selected.status }}</span></div>
          <div class="meta">
            <span class="mk">敏感</span>
            <span class="mv">{{ selected.sensitive ? '是（读取时脱敏展示）' : '否' }}</span>
          </div>
          <div class="meta"><span class="mk">资产 ID</span><span class="mv mono">#{{ selected.id }}</span></div>
        </div>

        <!-- 原文 -->
        <div v-else-if="tab === 'source'" class="panel">
          <div v-if="source" class="src-wrap">
            <div v-if="source.sensitive" class="src-warn small">
              脱敏展示，直接保存会把脱敏文本写回！
            </div>
            <textarea v-if="editing" v-model="editText" class="code edit" spellcheck="false"></textarea>
            <pre v-else class="code">{{ source.content }}</pre>
          </div>
          <n-empty v-else size="small" description="该资产为二进制库或无内容副本，仅记录元数据" style="padding:60px 0" />
        </div>

        <!-- 历史 -->
        <div v-else class="panel pad">
          <div class="sec-title">快照</div>
          <template v-if="snapshots.length">
            <div v-for="(s, i) in snapshots" :key="s.id" class="tl">
              <span class="tl-rail" :class="{ first: i === 0 }" />
              <span class="tl-dot" />
              <span class="tl-body">
                <span class="tl-time mono">{{ fmtTime(s.capturedAt) }}</span>
                <span class="tl-desc">{{ i === snapshots.length - 1 ? '创建' : '修改' }} · 快照 #{{ s.id }}</span>
                <span class="tl-meta dim mono">{{ s.contentHash.slice(0, 10) }} · {{ humanSize(s.size) }}</span>
              </span>
            </div>
          </template>
          <div v-else class="empty-note">
            <div>暂无历史快照</div>
            <div class="dim small">内容变化后自动留存</div>
          </div>
        </div>
      </div>

      <div v-else class="inspector card empty-detail">
        <n-empty description="选择资产查看内容 / 编辑 / 快照历史" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { margin: -24px -40px -56px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }

/* 第一层：AI 工具 */
.toolbar { flex: 0 0 auto; height: 48px; display: flex; gap: 12px; align-items: center; padding: 0 16px; }
.tabs-strip { flex: 1 1 auto; min-width: 0; display: flex; gap: 8px; align-items: center; overflow-x: auto; }
.tabs-strip::-webkit-scrollbar { height: 0; }
.tab { flex: 0 0 auto; display: flex; gap: 8px; align-items: center; height: 32px; background: transparent; border: none; border-radius: 8px; padding: 0 12px; cursor: pointer; color: var(--text); font-size: 13px; font-weight: 500; white-space: nowrap; }
.tab:hover { background: rgba(0, 0, 0, .05); }
.tab.on { background: var(--accent); color: #fff; }
.tab.off { opacity: .45; }
.tab-logo { width: 18px; height: 18px; border-radius: 4px; object-fit: contain; background: #fff; }
.tab-dot { width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; background: #8e8e93; }
.tab-n { color: var(--dim); font-size: 12px; }
.tab.on .tab-n { color: rgba(255, 255, 255, .8); }
.search { flex: 0 0 auto; width: 260px; }
.toolbar :deep(.n-input) { --n-height: 30px; }
.flex1 { flex: 1; }

/* 第二层：资产类型（弱于第一层） */
.typerow { flex: 0 0 auto; height: 42px; display: flex; gap: 4px; align-items: center; padding: 0 16px; background: var(--card-solid); border-bottom: 1px solid var(--border); overflow-x: auto; }
.typerow::-webkit-scrollbar { height: 0; }
.tchip { display: inline-flex; gap: 8px; align-items: center; height: 28px; padding: 0 12px; border: none; border-radius: 8px; background: transparent; color: var(--dim); font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.tchip-i { width: 14px; height: 14px; flex-shrink: 0; opacity: .85; }
.tchip:hover { background: rgba(0, 0, 0, .05); color: var(--text); }
.tchip.on { background: rgba(0, 113, 227, .1); color: var(--accent); font-weight: 600; }
.tchip-n { font-size: 11px; opacity: .75; }

/* 主体：列表 + Inspector */
.body { flex: 1; min-height: 0; display: flex; gap: 12px; padding: 12px 16px 16px; overflow: hidden; }

/* 列表 */
.list { flex: 1 1 56%; min-width: 340px; display: flex; flex-direction: column; overflow: hidden; }
.list-head { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.lh-title { font-size: 13.5px; font-weight: 700; }
.lh-n { font-size: 12px; color: var(--dim); }
.sortsel { width: 104px; }
.list-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; }
.grp-head { display: flex; gap: 8px; align-items: center; padding: 8px 8px 4px; }
.grp-logo { width: 18px; height: 18px; border-radius: 4px; object-fit: contain; background: #fff; }
.grp-name { font-weight: 700; font-size: 12.5px; }
.arow { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; }
.arow:hover { background: var(--bg); }
.arow.sel { background: rgba(0, 113, 227, .08); border-color: var(--accent); }
.arow-logo { width: 16px; height: 16px; border-radius: 4px; object-fit: contain; background: #fff; flex-shrink: 0; }
.arow-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.arow-name { font-size: 13.5px; font-weight: 600; display: flex; gap: 8px; align-items: center; min-width: 0; }
.arow-name-t { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.arow-path { display: block; font-size: 11.5px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.arow-size { flex-shrink: 0; font-size: 11.5px; color: var(--dim); }
.sflag { flex-shrink: 0; font-size: 10px; font-weight: 500; color: var(--warn); border: 1px solid currentColor; border-radius: 4px; padding: 0 4px; line-height: 14px; }

/* Inspector */
.inspector { flex: 1 1 44%; min-width: 320px; display: flex; flex-direction: column; overflow: hidden; }
.empty-detail { align-items: center; justify-content: center; }
.insp-head { flex: 0 0 auto; display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.insp-logo { width: 20px; height: 20px; border-radius: 5px; object-fit: contain; background: #fff; flex-shrink: 0; margin-top: 1px; }
.insp-id { flex: 1; min-width: 0; }
.insp-title { font-size: 15px; font-weight: 700; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.insp-sub { display: flex; flex-wrap: wrap; gap: 2px 8px; font-size: 12px; color: var(--dim); line-height: 1.6; }
.insp-sub > span { white-space: nowrap; }
.insp-act { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.insp-tabs { flex: 0 0 auto; display: flex; gap: 4px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.itab { height: 28px; padding: 0 12px; border: none; border-radius: 8px; background: transparent; color: var(--dim); font-size: 13px; cursor: pointer; }
.itab:hover { background: rgba(0, 0, 0, .05); color: var(--text); }
.itab.on { background: rgba(0, 113, 227, .1); color: var(--accent); font-weight: 600; }
.msgline { flex: 0 0 auto; padding: 8px 16px; border-bottom: 1px solid var(--border); }
.panel { flex: 1; min-height: 0; overflow: auto; }
.panel.pad { padding: 12px 16px 16px; }
.sec-title { font-size: 12px; font-weight: 600; color: var(--dim); margin-bottom: 8px; }

/* 概览元数据 */
.meta { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 12.5px; }
.meta:last-child { border-bottom: none; }
.mk { flex: 0 0 76px; color: var(--dim); }
.mv { flex: 1; min-width: 0; word-break: break-all; }

/* 原文（IDE / Code Viewer 阅读体验） */
.src-wrap { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.src-warn { flex: 0 0 auto; padding: 8px 16px; color: var(--warn); border-bottom: 1px solid var(--border); }
.code { flex: 1; min-height: 0; width: 100%; margin: 0; background: var(--code-bg); border: none; padding: 12px 16px; font: 12px/1.55 "SF Mono", ui-monospace, Consolas, monospace; white-space: pre; overflow: auto; color: var(--text); }
.code.edit { resize: none; outline: none; }

/* 历史时间线 */
.tl { display: flex; gap: 12px; align-items: stretch; position: relative; padding-bottom: 4px; }
.tl-rail { position: absolute; left: 3px; top: 12px; bottom: -4px; width: 1px; background: var(--border); }
.tl-rail.first { top: 12px; bottom: -4px; }
.tl:last-child .tl-rail { display: none; }
.tl-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-top: 7px; z-index: 1; }
.tl-body { display: flex; flex-direction: column; gap: 1px; padding-bottom: 12px; min-width: 0; }
.tl-time { font-size: 12.5px; }
.tl-desc { font-size: 12px; color: var(--text); }
.tl-meta { font-size: 11px; }
.empty-note { padding: 12px 0; font-size: 12.5px; line-height: 1.8; }

@media (max-width: 1024px) {
  .body { flex-direction: column; overflow-y: auto; }
  .list, .inspector { flex: none; width: 100%; min-width: 0; }
  .list { max-height: 46vh; }
  .inspector { max-height: 70vh; }
  .search { width: 180px; }
}
</style>
