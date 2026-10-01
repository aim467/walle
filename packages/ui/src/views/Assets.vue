<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { NInput, NSelect, NTag, NButton, NEmpty } from 'naive-ui';
import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';

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
const toolLabel: Record<string, string> = { codex: 'Codex CLI', zcode: 'ZCode', cursor: 'Cursor', opencode: 'opencode' };
const toolLogos: Record<string, string> = { zcode: zcodeLogo, codex: openaiLogo, cursor: cursorLogo, opencode: opencodeLogo };
/** 会话类资产由「会话」页负责，此处排除避免两个页面职责冲突 */
const EXCLUDED_KINDS = new Set(['session', 'prompt']);
/** ZCode 模型 I/O 遥测也属会话数据（kind=other），一并移交会话页 */
const isSessionAsset = (a: Asset) => EXCLUDED_KINDS.has(a.kind) || a.path.includes('model-io-');

const assets = ref<Asset[]>([]);
const kind = ref('');
const activeTool = ref<string | null>(null);
const q = ref('');
const selected = ref<Asset | null>(null);
const source = ref<{ content: string; sensitive: boolean } | null>(null);
const snapshots = ref<Snapshot[]>([]);
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

const toolGroups = computed(() => {
  const groups: { tool: string; assets: Asset[] }[] = [];
  for (const t of ['zcode', 'codex', 'cursor', 'opencode']) {
    const list = assets.value.filter((a) => a.tool === t);
    if (list.length) groups.push({ tool: t, assets: list });
  }
  return groups;
});
const listFiltered = computed(() => {
  let list = assets.value.filter((a) => !isSessionAsset(a));
  if (activeTool.value) list = list.filter((a) => a.tool === activeTool.value);
  if (kind.value) list = list.filter((a) => a.kind === kind.value);
  if (q.value) {
    const s = q.value.toLowerCase();
    list = list.filter((a) => a.path.toLowerCase().includes(s) || (a.name ?? '').toLowerCase().includes(s));
  }
  return list;
});
const kindCounts = computed(() => {
  const m = new Map<string, number>();
  let base = assets.value.filter((a) => !isSessionAsset(a));
  if (activeTool.value) base = base.filter((a) => a.tool === activeTool.value);
  for (const a of base) m.set(a.kind, (m.get(a.kind) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
});
const toolCount = (t: string) => assets.value.filter((a) => a.tool === t && !isSessionAsset(a)).length;
const totalShown = computed(() => assets.value.filter((a) => !isSessionAsset(a)).length);

const editable = (a: Asset) => a.kind !== 'session' && a.rawFormat !== 'sqlite' && a.rawFormat !== 'dir';

async function open(a: Asset) {
  selected.value = a;
  source.value = null;
  editing.value = false;
  writeMsg.value = '';
  snapshots.value = (await (await fetch('/api/snapshots?asset=' + a.id)).json()).snapshots ?? [];
  if (editable(a)) {
    const s = await (await fetch('/api/source?asset=' + a.id)).json();
    if (!s.error) source.value = { content: s.content, sensitive: s.sensitive };
  }
}
function startEdit() {
  if (!source.value) return;
  editText.value = source.value.content;
  editing.value = true;
  writeMsg.value = '';
}
async function saveWrite() {
  if (!selected.value) return;
  const r = await (await fetch('/api/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: selected.value.id, content: editText.value }) })).json();
  if (r.ok) {
    writeMsg.value = `已写回 ✓ · 写前快照 #${r.snapshotId}，可回滚`;
    editing.value = false;
    await open(selected.value);
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
    <!-- 顶部工具 Tab -->
    <div class="toolbar glassbar">
      <button class="tab" :class="{ on: activeTool === null }" @click="activeTool = null">
        <span class="tab-dot" style="background:#8e8e93">A</span>
        <span class="tab-name">全部工具</span>
        <span class="tab-n">{{ totalShown }}</span>
      </button>
      <button
        v-for="t in ['zcode', 'codex', 'cursor', 'opencode']" :key="t"
        class="tab" :class="{ on: activeTool === t, off: !toolCount(t) }" @click="activeTool = t"
      >
        <img class="tab-logo" :src="toolLogos[t]" :alt="t">
        <span class="tab-name">{{ toolLabel[t] }}</span>
        <span class="tab-n">{{ toolCount(t) }}</span>
      </button>
      <span class="flex1" />
      <n-input v-model:value="q" placeholder="按路径 / 名称过滤…" size="small" round clearable style="width:280px" />
    </div>

    <div class="body">
      <!-- 左侧：工具分组 + 类型筛选 -->
      <div class="side">
        <div class="side-sec dim small">类型</div>
        <button class="side-item" :class="{ on: kind === '' }" @click="kind = ''">
          全部类型<span class="n">{{ activeTool ? assets.filter((a) => a.tool === activeTool && !isSessionAsset(a)).length : totalShown }}</span>
        </button>
        <button v-for="[k, n] in kindCounts" :key="k" class="side-item" :class="{ on: kind === k }" @click="kind = k">
          {{ kindLabel[k] ?? k }}<span class="n">{{ n }}</span>
        </button>
        <div class="side-note dim small">
          会话与输入历史在「会话」页查看<br>此处专注配置 / 记忆 / Skill / 规则等资产
        </div>
      </div>

      <!-- 中间：资产列表 -->
      <div class="list card">
        <div v-for="grp in toolGroups.filter((g) => !activeTool || g.tool === activeTool)" :key="grp.tool" class="grp">
          <div class="grp-head">
            <img class="grp-logo" :src="toolLogos[grp.tool]">
            <span class="grp-name">{{ toolLabel[grp.tool] }}</span>
            <span class="dim small">{{ grp.assets.filter((a) => !isSessionAsset(a)).length }}</span>
          </div>
          <div
            v-for="a in grp.assets.filter((a0) => !isSessionAsset(a0) && (!kind || a0.kind === kind) && (!q || (a0.path + (a0.name ?? '')).toLowerCase().includes(q.toLowerCase())))"
            :key="a.id" class="row" :class="{ sel: selected?.id === a.id }" @click="open(a)"
          >
            <span class="tag">{{ kindLabel[a.kind] ?? a.kind }}</span>
            <span class="row-path mono">{{ a.path }} <span v-if="a.sensitive" class="warn">⚠</span></span>
            <span class="dim small">{{ humanSize(a.size) }}</span>
          </div>
        </div>
        <n-empty v-if="!listFiltered.length" description="没有匹配的资产" style="padding:60px 0" />
      </div>

      <!-- 右侧：详情 -->
      <div v-if="selected" class="detail">
        <div class="card detail-head">
          <div class="dh-top">
            <img class="dh-logo" :src="toolLogos[selected.tool]">
            <strong class="mono">#{{ selected.id }} {{ selected.path }}</strong>
            <n-tag size="tiny" :bordered="false" round>{{ kindLabel[selected.kind] ?? selected.kind }}</n-tag>
            <n-tag v-if="selected.sensitive" size="tiny" round type="warning">敏感</n-tag>
          </div>
          <div class="dim small">
            修改 {{ fmtTime(selected.mtime) }} · {{ humanSize(selected.size) }} · 哈希 {{ selected.contentHash?.slice(0, 10) }}
          </div>
        </div>

        <div v-if="writeMsg" class="card msgline small" :class="{ warn: writeMsg.startsWith('拒绝') }">{{ writeMsg }}</div>

        <div v-if="source" class="card editor-wrap">
          <div class="editor-bar glassbar">
            <span class="dim small">
              原文<template v-if="source.sensitive"> · <span class="warn">脱敏展示，直接保存会把脱敏文本写回！</span></template>
            </span>
            <span>
              <n-button v-if="!editing" size="tiny" round type="primary" :disabled="!writeEnabled" @click="startEdit">
                {{ writeEnabled ? '编辑' : '写回开关未开启' }}
              </n-button>
              <template v-else>
                <n-button size="tiny" round type="primary" @click="saveWrite">保存并写回</n-button>
                <n-button size="tiny" round style="margin-left:6px" @click="editing = false">取消</n-button>
              </template>
            </span>
          </div>
          <textarea v-if="editing" v-model="editText" class="ta edit" spellcheck="false"></textarea>
          <pre v-else class="ta">{{ source.content }}</pre>
        </div>
        <div v-else class="card" style="padding:26px 16px">
          <n-empty size="small" description="该资产为二进制库或无内容副本，仅记录元数据" />
        </div>

        <div class="card snaps">
          <div class="dim small snap-title">快照时间线（{{ snapshots.length }}）</div>
          <div v-for="s in snapshots" :key="s.id" class="snap-row small">
            <span class="dim">快照#{{ s.id }}</span>
            <span>{{ fmtTime(s.capturedAt) }}</span>
            <span class="dim mono">{{ s.contentHash.slice(0, 10) }}</span>
            <span class="dim">{{ humanSize(s.size) }}</span>
          </div>
          <div v-if="!snapshots.length" class="dim small" style="padding:0 14px 10px">暂无历史快照（内容变化时自动留存）</div>
        </div>
      </div>
      <div v-else class="detail card empty-detail">
        <n-empty description="选择资产查看配置内容 / 编辑 / 快照历史" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { margin: -24px -40px -56px; }
.toolbar { height: 52px; display: flex; gap: 6px; align-items: center; padding: 0 14px; position: sticky; top: 0; z-index: 20; }
.tab { display: flex; gap: 7px; align-items: center; height: 36px; background: transparent; border: none; border-radius: 9px; padding: 0 12px; cursor: pointer; color: var(--text); font-size: 13px; font-weight: 500; }
.tab:hover { background: rgba(0, 0, 0, .05); }
.tab.on { background: var(--accent); color: #fff; }
.tab.off { opacity: .45; }
.tab-logo { width: 18px; height: 18px; border-radius: 4px; object-fit: contain; background: #fff; }
.tab-dot { width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: #fff; }
.tab-n { color: var(--dim); font-size: 12px; }
.tab.on .tab-n { color: rgba(255, 255, 255, .8); }
.flex1 { flex: 1; }
/* 三区 */
.body { display: flex; gap: 14px; align-items: stretch; padding: 14px 18px; height: calc(100vh - 52px); overflow: hidden; }
.side { width: 190px; flex-shrink: 0; overflow-y: auto; }
.side-sec { padding: 4px 10px 6px; font-weight: 600; }
.side-item {
  display: flex; justify-content: space-between; align-items: center; width: 100%;
  background: transparent; border: none; border-radius: 8px; padding: 7px 10px;
  font-size: 13px; color: var(--text); cursor: pointer; text-align: left;
}
.side-item:hover { background: rgba(0, 0, 0, .05); }
.side-item.on { background: rgba(0, 113, 227, .12); color: var(--accent); font-weight: 600; }
.side-item .n { color: var(--dim); font-size: 12px; }
.side-note { margin-top: 18px; padding: 10px; line-height: 1.7; border-top: 1px solid var(--border); }
/* 列表 */
.list { flex: 1; min-width: 0; overflow-y: auto; padding: 10px; }
.grp { margin-bottom: 8px; }
.grp-head { display: flex; gap: 8px; align-items: center; padding: 6px 8px; }
.grp-logo { width: 20px; height: 20px; border-radius: 5px; object-fit: contain; background: #fff; }
.grp-name { font-weight: 700; font-size: 13px; }
.row { display: flex; gap: 10px; align-items: center; padding: 8px 10px; border-radius: 9px; cursor: pointer; }
.row:hover { background: var(--bg); }
.row.sel { background: rgba(0, 113, 227, .1); outline: 1.5px solid var(--accent); }
.row-path { font-size: 12px; word-break: break-all; flex: 1; min-width: 0; }
/* 详情 */
.detail { width: clamp(420px, 38vw, 620px); flex-shrink: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
.empty-detail { display: flex; align-items: center; justify-content: center; }
.detail-head { padding: 12px 16px; display: flex; flex-direction: column; gap: 4px; }
.dh-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dh-logo { width: 20px; height: 20px; border-radius: 5px; object-fit: contain; background: #fff; }
.dh-top strong { font-size: 13px; word-break: break-all; }
.msgline { padding: 9px 16px; }
.editor-wrap { overflow: hidden; }
.editor-bar { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; }
.ta { width: 100%; min-height: 320px; max-height: 44vh; background: var(--code-bg); border: none; border-top: 1px solid var(--border); padding: 14px 16px; font: 12px/1.55 "SF Mono",ui-monospace,Consolas,monospace; white-space: pre; overflow: auto; margin: 0; color: var(--text); }
.ta.edit { resize: vertical; }
.snaps { padding-bottom: 4px; }
.snap-title { padding: 10px 16px 4px; font-weight: 600; }
.snap-row { display: flex; gap: 16px; padding: 4px 16px; }
</style>
