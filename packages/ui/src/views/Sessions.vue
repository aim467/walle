<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NInput, NSelect, NEmpty, NTag } from 'naive-ui';

interface Hit { assetId: number; tool: string; kind: string; role: string | null; time: string | null; title: string; snippet: string; path: string }
interface Msg { seq: number; role: string | null; ts: string | null; text: string }

const roleLabel: Record<string, string> = { user: '用户', assistant: '助手', developer: '系统注入', system: '系统' };
const toolLabel: Record<string, string> = { codex: 'Codex CLI', zcode: 'ZCode', cursor: 'Cursor', opencode: 'opencode' };

const q = ref('');
const mode = ref<'search' | 'sessions'>('search');
const tool = ref('');
const hits = ref<Hit[]>([]);
const msgs = ref<Msg[]>([]);
const readTitle = ref('');
const readTool = ref('');

async function doSearch() {
  const p = new URLSearchParams();
  if (q.value.trim()) p.set('q', q.value.trim());
  if (tool.value) p.set('tool', tool.value);
  if (mode.value === 'sessions') p.set('sessions', '1');
  const d = await (await fetch('/api/list?' + p)).json();
  hits.value = d.hits ?? [];
}
function switchMode(m: 'search' | 'sessions') {
  mode.value = m;
  if (q.value.trim() || m === 'sessions') doSearch();
}
async function openAsset(id: number) {
  msgs.value = [];
  readTitle.value = '加载中…';
  const d = await (await fetch('/api/read?asset=' + id)).json();
  readTool.value = d.tool ?? '';
  readTitle.value = (d.title ?? d.path ?? '') + (d.messages?.length ? ` · ${d.messages.length} 条消息` : '');
  msgs.value = d.messages ?? [];
}

onMounted(() => { if (mode.value === 'sessions') doSearch(); });
</script>

<template>
  <div class="page-head">
    <div>
      <h2>会话</h2>
      <div class="dim small">跨工具全文搜索 · 历史会话按时间倒序</div>
    </div>
    <div class="filters">
      <n-input v-model:value="q" placeholder="搜索会话内容…（Enter）" size="small" style="width:260px" round clearable @keydown.enter="switchMode('search')" />
      <n-select v-model:value="tool" size="small" style="width:130px" :options="[
        { label: '全部来源', value: '' },
        { label: 'Codex CLI', value: 'codex' },
        { label: 'ZCode', value: 'zcode' },
        { label: 'Cursor', value: 'cursor' },
        { label: 'opencode', value: 'opencode' },
      ]" @update:value="doSearch" />
      <n-select :value="mode" size="small" style="width:120px" :options="[
        { label: '搜索', value: 'search' },
        { label: '会话列表', value: 'sessions' },
      ]" @update:value="(v: 'search' | 'sessions') => switchMode(v)" />
    </div>
  </div>

  <div class="split">
    <div class="list">
      <div v-if="!hits.length" class="card" style="padding:0">
        <n-empty description="输入关键词搜索，或切换到「会话列表」" style="padding:60px 0" />
      </div>
      <div v-for="(h, i) in hits" :key="i" class="card item" @click="openAsset(h.assetId)">
        <div class="meta">
          <n-tag size="tiny" :bordered="false" round>{{ toolLabel[h.tool] ?? h.tool }}</n-tag>
          <span class="dim small">{{ h.time ? h.time.replace('T', ' ').slice(0, 19) : '' }}</span>
        </div>
        <div class="title">{{ h.title }}</div>
        <div class="snip dim" v-html="h.snippet"></div>
      </div>
    </div>
    <div class="reader">
      <div v-if="!msgs.length" class="card" style="padding:0">
        <n-empty description="选择左侧结果阅读完整会话" style="padding:100px 0" />
      </div>
      <template v-else>
        <div class="dim small read-head glassbar">{{ readTitle }} · 来源 {{ toolLabel[readTool] ?? readTool }}</div>
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
.filters { display: flex; gap: 8px; }
.split { display: flex; gap: 16px; align-items: flex-start; }
.list { width: 400px; flex-shrink: 0; max-height: calc(100vh - 170px); overflow-y: auto; padding-right: 2px; }
.item { padding: 11px 14px; margin-bottom: 10px; cursor: pointer; transition: border-color .15s, transform .15s; }
.item:hover { border-color: var(--accent); transform: translateY(-1px); }
.meta { color: var(--dim); font-size: 12px; display: flex; gap: 8px; align-items: center; }
.title { font-weight: 600; margin: 4px 0 2px; }
.snip { font-size: 12.5px; }
.snip :deep(mark) { background: rgba(0, 113, 227, .18); color: var(--accent); border-radius: 3px; padding: 0 2px; }
.reader { flex: 1; min-width: 0; max-height: calc(100vh - 170px); overflow-y: auto; }
.read-head { position: sticky; top: 0; z-index: 5; padding: 8px 14px; margin-bottom: 12px; border-radius: 10px; }
.msg { border-radius: 16px; padding: 12px 16px; margin-bottom: 14px; max-width: 860px; white-space: pre-wrap; word-break: break-word; }
.msg .who { font-size: 11.5px; color: var(--dim); margin-bottom: 4px; font-weight: 600; }
.msg.user { background: rgba(0, 113, 227, .1); border: 1px solid rgba(0, 113, 227, .16); margin-left: 40px; }
.msg.assistant { background: var(--card-solid); border: 1px solid var(--border); box-shadow: var(--shadow); }
.msg.developer, .msg.system { background: var(--code-bg); border: 1px dashed var(--border); color: var(--dim); font-size: 13px; margin-right: 40px; }
</style>
