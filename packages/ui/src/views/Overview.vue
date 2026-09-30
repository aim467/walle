<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface SourceInfo {
  tool: string; displayName: string; rootPath: string; lastScannedAt: string | null;
  total: number; byKind: Record<string, number>;
}
interface RecentAsset { id: number; tool: string; kind: string; name: string | null; path: string; mtime: string | null; size: number | null; sensitive: boolean }

const sources = ref<SourceInfo[]>([]);
const recent = ref<RecentAsset[]>([]);
const allowWrite = ref(false);
const kindLabel: Record<string, string> = {
  config: '配置', session: '会话', memory: '记忆', skill: 'Skill', mcp: 'MCP', rule: '规则',
  prompt: '输入历史', agent: '子代理', plugin: '插件', secret: '凭证', other: '其他',
};
function humanSize(b: number | null): string {
  if (b == null) return '-';
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)}MB`;
  return `${(b / 1073741824).toFixed(2)}GB`;
}
function fmtTime(iso: string | null): string { return iso ? iso.replace('T', ' ').slice(0, 19) : '-'; }

onMounted(async () => {
  const d = await (await fetch('/api/overview')).json();
  sources.value = d.sources;
  recent.value = d.recent;
  allowWrite.value = d.allowWrite;
});
</script>

<template>
  <h2>总览</h2>
  <p class="dim">
    数据落盘 ~/.walle · 写回开关
    <span :class="allowWrite ? 'warn' : 'ok'">{{ allowWrite ? '已开启' : '关闭（默认，安全）' }}</span>
  </p>

  <div class="cards">
    <div v-for="s in sources" :key="s.tool" class="panel card">
      <div class="card-head">
        <strong>{{ s.displayName }}</strong>
        <span class="tag">{{ s.tool }}</span>
      </div>
      <div class="total">{{ s.total }} 个资产</div>
      <div class="kinds">
        <span v-for="(n, k) in s.byKind" :key="k" class="tag">{{ kindLabel[k] ?? k }} {{ n }}</span>
      </div>
      <div class="dim small">上次扫描 {{ fmtTime(s.lastScannedAt) }}</div>
      <div class="dim small path">{{ s.rootPath }}</div>
    </div>
  </div>

  <h3>最近变更（谁刚被改过）</h3>
  <div class="panel">
    <table class="recent">
      <thead><tr><th>时间</th><th>来源</th><th>类型</th><th>资产</th><th>大小</th></tr></thead>
      <tbody>
        <tr v-for="a in recent" :key="a.id">
          <td class="dim">{{ fmtTime(a.mtime) }}</td>
          <td><span class="tag">{{ a.tool }}</span></td>
          <td><span class="tag">{{ kindLabel[a.kind] ?? a.kind }}</span></td>
          <td class="p">{{ a.path }} <span v-if="a.sensitive" class="warn">⚠</span></td>
          <td class="dim">{{ humanSize(a.size) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
h2, h3 { margin: 8px 0; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; margin: 12px 0 24px; }
.card { padding: 12px 14px; }
.card-head { display: flex; gap: 8px; align-items: center; }
.total { font-size: 20px; font-weight: 600; margin: 6px 0; }
.kinds { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 6px; }
.small { font-size: 12px; }
.path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.recent { width: 100%; border-collapse: collapse; font-size: 13px; }
.recent th { text-align: left; color: var(--dim); font-weight: 500; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.recent td { padding: 6px 10px; border-bottom: 1px solid var(--border); }
.recent td.p { font-family: Consolas, monospace; font-size: 12px; word-break: break-all; }
</style>
