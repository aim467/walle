<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface Hit { assetId: number; tool: string; kind: string; role: string | null; time: string | null; title: string; snippet: string; path: string }
interface Msg { seq: number; role: string | null; ts: string | null; text: string }

const roleLabel: Record<string, string> = { user: '用户', assistant: '助手', developer: '系统注入', system: '系统' };

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
  <div class="head">
    <h2>会话</h2>
    <input v-model="q" class="grow" placeholder="搜索全部会话内容…" @keydown.enter="switchMode('search')">
    <select v-model="tool" @change="doSearch">
      <option value="">全部来源</option>
      <option value="codex">Codex CLI</option>
      <option value="zcode">ZCode</option>
      <option value="cursor">Cursor</option>
      <option value="opencode">opencode</option>
    </select>
    <select :value="mode" @change="switchMode(($event.target as HTMLSelectElement).value as 'search' | 'sessions')">
      <option value="search">搜索</option>
      <option value="sessions">会话列表</option>
    </select>
  </div>

  <div class="split">
    <div class="list">
      <div v-if="!hits.length" class="dim" style="text-align:center;padding:30px 0">输入关键词搜索，或切换到「会话列表」</div>
      <div v-for="(h, i) in hits" :key="i" class="panel item" @click="openAsset(h.assetId)">
        <div class="meta">
          <span class="tag">{{ h.tool }}</span>
          <span class="dim">{{ h.time ? h.time.replace('T', ' ').slice(0, 19) : '' }}</span>
          <span class="tag">{{ h.kind }}{{ h.role && h.role !== 'title' ? ' · ' + (roleLabel[h.role] ?? h.role) : '' }}</span>
        </div>
        <div class="title">{{ h.title }}</div>
        <div class="snip" v-html="h.snippet"></div>
      </div>
    </div>
    <div class="reader">
      <div v-if="!msgs.length" class="dim" style="text-align:center;padding-top:80px">← 选择左侧结果阅读完整会话</div>
      <template v-else>
        <div class="dim small" style="padding:2px 0 10px">{{ readTitle }} · 来源 {{ readTool }}</div>
        <div v-for="(m, i) in msgs" :key="i" class="msg" :class="m.role || 'assistant'">
          <div class="who">{{ roleLabel[m.role ?? ''] ?? m.role ?? '未知' }}<template v-if="m.ts"> · {{ m.ts.replace('T', ' ').slice(0, 19) }}</template></div>
          <div class="body">{{ m.text }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.head { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; }
.head h2 { margin: 0 12px 0 0; }
.grow { flex: 1; padding: 7px 12px; }
select { padding: 7px; }
.split { display: flex; gap: 14px; align-items: flex-start; }
.list { width: 420px; flex-shrink: 0; max-height: calc(100vh - 140px); overflow-y: auto; }
.item { padding: 10px 12px; margin-bottom: 8px; cursor: pointer; }
.item:hover { border-color: var(--accent); }
.meta { color: var(--dim); font-size: 12px; display: flex; gap: 8px; flex-wrap: wrap; }
.title { font-weight: 600; margin: 2px 0; }
.snip { color: var(--dim); font-size: 13px; }
.reader { flex: 1; min-width: 0; max-height: calc(100vh - 140px); overflow-y: auto; padding-right: 4px; }
.small { font-size: 12px; }
.msg { border-radius: 12px; padding: 10px 14px; margin-bottom: 12px; max-width: 900px; white-space: pre-wrap; word-break: break-word; }
.msg .who { font-size: 12px; color: var(--dim); margin-bottom: 4px; }
.msg.user { background: var(--user); }
.msg.assistant { background: var(--assistant); }
.msg.developer, .msg.system { background: var(--system); color: #b9aecb; }
</style>
