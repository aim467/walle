<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

interface Asset { id: number; tool: string; kind: string; name: string | null; path: string; rawFormat: string | null; contentHash: string | null; size: number | null; mtime: string | null; sensitive: number; status: string }
interface Snapshot { id: number; capturedAt: string; contentHash: string; size: number | null }

const kindLabel: Record<string, string> = {
  config: '配置', session: '会话', memory: '记忆', skill: 'Skill', mcp: 'MCP', rule: '规则',
  prompt: '输入历史', agent: '子代理', plugin: '插件', secret: '凭证', other: '其他',
};

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
  snapshots.value = (await (await fetch('/api/snapshots?asset=' + a.id)).json()).snapshots ?? [];
  if (editable(a)) {
    const s = await (await fetch('/api/source?asset=' + a.id)).json();
    if (!s.error) source.value = { content: s.content, sensitive: s.sensitive };
  }
}
function startEdit() {
  if (!source.value || !selected.value) return;
  editText.value = source.value.content;
  editing.value = true;
  writeMsg.value = '';
}
async function saveWrite() {
  if (!selected.value) return;
  const r = await (await fetch('/api/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: selected.value.id, content: editText.value }) })).json();
  if (r.ok) {
    writeMsg.value = `已写回 ✓（写前快照 #${r.snapshotId}，可回滚）`;
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
  <h2>资产库</h2>
  <div class="filters">
    <input v-model="q" placeholder="按路径/名称过滤…" class="grow">
    <select v-model="tool" @change="load">
      <option value="">全部来源</option>
      <option value="codex">Codex CLI</option>
      <option value="zcode">ZCode</option>
      <option value="cursor">Cursor</option>
      <option value="opencode">opencode</option>
    </select>
  </div>
  <div class="chips">
    <span class="chip" :class="{ on: kind === '' }" @click="kind = ''">全部 {{ assets.length }}</span>
    <span v-for="[k, n] in kinds" :key="k" class="chip" :class="{ on: kind === k }" @click="kind = k">
      {{ kindLabel[k] ?? k }} {{ n }}
    </span>
  </div>

  <div class="split">
    <div class="list panel">
      <table>
        <tbody>
          <tr v-for="a in filtered" :key="a.id" :class="{ sel: selected?.id === a.id }" @click="open(a)">
            <td><span class="tag">{{ a.tool }}</span></td>
            <td class="p">{{ a.path }} <span v-if="a.sensitive" class="warn">⚠</span></td>
            <td class="dim">{{ humanSize(a.size) }}</td>
            <td class="dim">{{ fmtTime(a.mtime) }}</td>
          </tr>
        </tbody>
      </table>
      <div v-if="filteredTotal > filtered.length" class="dim small" style="padding:8px 12px">
        显示前 {{ filtered.length }} 条 / 共 {{ filteredTotal }} 条——用上方过滤缩小范围
      </div>
    </div>

    <div v-if="selected" class="detail">
      <div class="panel detail-head">
        <strong>#{{ selected.id }} {{ selected.path }}</strong>
        <span class="tag">{{ selected.tool }}</span>
        <span class="tag">{{ kindLabel[selected.kind] ?? selected.kind }}</span>
        <span v-if="selected.sensitive" class="warn">⚠ 敏感</span>
        <span class="dim small">修改 {{ fmtTime(selected.mtime) }} · {{ humanSize(selected.size) }} · 哈希 {{ selected.contentHash?.slice(0, 10) }}</span>
      </div>

      <div v-if="writeMsg" class="panel msgline" :class="{ warn: writeMsg.startsWith('拒绝') }">{{ writeMsg }}</div>

      <div v-if="source" class="panel editor-wrap">
        <div class="editor-bar">
          <span class="dim small">原文{{ source.sensitive ? '（脱敏展示——直接保存会把脱敏文本写回！）' : '' }}</span>
          <span>
            <button v-if="!editing" class="btn" @click="startEdit" :disabled="!writeEnabled">
              {{ writeEnabled ? '编辑' : '写回开关未开启' }}
            </button>
            <template v-else>
              <button class="btn" @click="saveWrite">保存并写回</button>
              <button class="btn ghost" style="margin-left:6px" @click="editing = false">取消</button>
            </template>
          </span>
        </div>
        <textarea v-if="editing" v-model="editText" class="ta edit" spellcheck="false"></textarea>
        <pre v-else class="ta">{{ source.content }}</pre>
      </div>

      <div class="panel snaps">
        <div class="dim small" style="padding:8px 10px">快照时间线（{{ snapshots.length }}）</div>
        <div v-for="s in snapshots" :key="s.id" class="snap-row">
          <span class="dim">快照#{{ s.id }}</span>
          <span>{{ fmtTime(s.capturedAt) }}</span>
          <span class="dim">{{ s.contentHash.slice(0, 10) }}</span>
          <span class="dim">{{ humanSize(s.size) }}</span>
        </div>
      </div>
    </div>
    <div v-else class="detail dim" style="text-align:center;padding-top:80px">← 选择资产查看详情 / 编辑 / 快照</div>
  </div>
</template>

<style scoped>
h2 { margin: 8px 0; }
.filters { display: flex; gap: 8px; margin: 10px 0; }
.grow { flex: 1; padding: 7px 12px; }
select { padding: 7px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.chip { background: var(--panel2); border: 1px solid var(--border); border-radius: 14px; padding: 2px 12px; font-size: 12px; color: var(--dim); cursor: pointer; }
.chip.on { border-color: var(--accent); color: var(--text); }
.split { display: flex; gap: 12px; align-items: flex-start; }
.list { flex: 1.1; max-height: 70vh; overflow-y: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
td { padding: 6px 10px; border-bottom: 1px solid var(--border); }
tr { cursor: pointer; }
tr:hover { background: var(--panel2); }
tr.sel { background: var(--panel2); border-left: 2px solid var(--accent); }
td.p { font-family: Consolas, monospace; font-size: 12px; word-break: break-all; }
.detail { flex: 1; min-width: 0; }
.detail-head { padding: 10px 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.small { font-size: 12px; }
.msgline { padding: 8px 14px; margin-top: 8px; }
.editor-wrap { margin-top: 8px; }
.editor-bar { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border); }
.ta { width: 100%; min-height: 320px; max-height: 55vh; background: transparent; border: none; padding: 12px 14px; font: 12px/1.5 Consolas, monospace; white-space: pre; overflow: auto; margin: 0; }
.ta.edit { border-radius: 0 0 10px 10px; }
.snaps { margin-top: 8px; padding-bottom: 6px; }
.snap-row { display: flex; gap: 14px; padding: 4px 14px; font-size: 12px; }
</style>
