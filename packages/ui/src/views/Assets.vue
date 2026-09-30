<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { NInput, NSelect, NTag, NButton, NEmpty } from 'naive-ui';

interface Asset { id: number; tool: string; kind: string; name: string | null; path: string; rawFormat: string | null; contentHash: string | null; size: number | null; mtime: string | null; sensitive: number; status: string }
interface Snapshot { id: number; capturedAt: string; contentHash: string; size: number | null }

const kindLabel: Record<string, string> = {
  config: '配置', session: '会话', memory: '记忆', skill: 'Skill', mcp: 'MCP', rule: '规则',
  prompt: '输入历史', agent: '子代理', plugin: '插件', secret: '凭证', other: '其他',
};
const toolLabel: Record<string, string> = { codex: 'Codex CLI', zcode: 'ZCode', cursor: 'Cursor', opencode: 'opencode' };

const assets = ref<Asset[]>([]);
const kind = ref('');
const tool = ref('');
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

async function load() {
  const p = new URLSearchParams();
  if (kind.value) p.set('kind', kind.value);
  if (tool.value) p.set('source', tool.value);
  assets.value = await (await fetch('/api/assets?' + p)).json();
}
const PAGE = 200;
const filtered = computed(() => {
  let list = assets.value;
  if (q.value) {
    const s = q.value.toLowerCase();
    list = list.filter((a) => a.path.toLowerCase().includes(s) || (a.name ?? '').toLowerCase().includes(s));
  }
  return list.slice(0, PAGE);
});
const filteredTotal = computed(() => {
  if (!q.value) return assets.value.length;
  const s = q.value.toLowerCase();
  return assets.value.filter((a) => a.path.toLowerCase().includes(s) || (a.name ?? '').toLowerCase().includes(s)).length;
});
const kinds = computed(() => {
  const m = new Map<string, number>();
  for (const a of assets.value) m.set(a.kind, (m.get(a.kind) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
});
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
  await load();
});
</script>

<template>
  <div class="page-head">
    <div>
      <h2>资产库</h2>
      <div class="dim small">{{ assets.length }} 个资产 · 点选查看详情 / 编辑 / 快照历史</div>
    </div>
    <div class="filters">
      <n-input v-model:value="q" placeholder="按路径 / 名称过滤" size="small" style="width:220px" round clearable />
      <n-select v-model:value="tool" size="small" style="width:140px" :options="[
        { label: '全部来源', value: '' },
        { label: 'Codex CLI', value: 'codex' },
        { label: 'ZCode', value: 'zcode' },
        { label: 'Cursor', value: 'cursor' },
        { label: 'opencode', value: 'opencode' },
      ]" @update:value="load" />
    </div>
  </div>

  <div class="chips">
    <button class="chip" :class="{ on: kind === '' }" @click="kind = ''">全部 {{ assets.length }}</button>
    <button v-for="[k, n] in kinds" :key="k" class="chip" :class="{ on: kind === k }" @click="kind = k">
      {{ kindLabel[k] ?? k }} {{ n }}
    </button>
  </div>

  <div class="split">
    <div class="list card">
      <div v-for="a in filtered" :key="a.id" class="row" :class="{ sel: selected?.id === a.id }" @click="open(a)">
        <div class="row-main">
          <div class="row-path mono">{{ a.path }} <span v-if="a.sensitive" class="warn">⚠</span></div>
          <div class="dim small">{{ toolLabel[a.tool] ?? a.tool }} · {{ kindLabel[a.kind] ?? a.kind }} · {{ fmtTime(a.mtime) }}</div>
        </div>
        <div class="dim small">{{ humanSize(a.size) }}</div>
      </div>
      <n-empty v-if="!filtered.length" description="没有匹配的资产" style="padding:40px 0" />
      <div v-if="filteredTotal > filtered.length" class="dim small" style="padding:10px 14px">
        显示前 {{ filtered.length }} 条 / 共 {{ filteredTotal }} 条——用过滤缩小范围
      </div>
    </div>

    <div v-if="selected" class="detail">
      <div class="card detail-head">
        <div class="dh-top">
          <strong class="mono">#{{ selected.id }} {{ selected.path }}</strong>
          <n-tag size="tiny" :bordered="false" round>{{ toolLabel[selected.tool] ?? selected.tool }}</n-tag>
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
    <div v-else class="detail" style="display:flex;align-items:center;justify-content:center">
      <n-empty description="选择左侧资产查看详情" />
    </div>
  </div>
</template>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 14px; }
h2 { margin: 0 0 2px; font-size: 22px; font-weight: 700; }
.filters { display: flex; gap: 8px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
.chip {
  background: var(--card-solid); border: 1px solid var(--border); border-radius: 100px;
  padding: 3px 14px; font-size: 12.5px; color: var(--dim); cursor: pointer; transition: all .15s;
}
.chip:hover { border-color: var(--accent); color: var(--text); }
.chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.split { display: flex; gap: 16px; align-items: flex-start; }
.list { flex: 1.05; max-height: calc(100vh - 230px); overflow-y: auto; padding: 6px; }
.row { display: flex; justify-content: space-between; gap: 10px; padding: 9px 12px; border-radius: 10px; cursor: pointer; }
.row:hover { background: var(--bg); }
.row.sel { background: rgba(0, 113, 227, .1); }
.row-main { min-width: 0; }
.row-path { font-size: 12.5px; word-break: break-all; }
.detail { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.detail-head { padding: 12px 16px; display: flex; flex-direction: column; gap: 4px; }
.dh-top { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.dh-top strong { font-size: 13px; word-break: break-all; }
.msgline { padding: 9px 16px; }
.editor-wrap { overflow: hidden; }
.editor-bar { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; }
.ta { width: 100%; min-height: 320px; max-height: 52vh; background: var(--code-bg); border: none; padding: 14px 16px; font: 12px/1.55 "SF Mono",ui-monospace,Consolas,monospace; white-space: pre; overflow: auto; margin: 0; color: var(--text); }
.ta.edit { border-top: 1px solid var(--border); resize: vertical; }
.snaps { padding-bottom: 4px; }
.snap-title { padding: 10px 16px 4px; font-weight: 600; }
.snap-row { display: flex; gap: 16px; padding: 4px 16px; }
</style>
