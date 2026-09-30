<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NCard, NTag, NTable, NStatistic } from 'naive-ui';

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
  <div class="page-head">
    <div>
      <h2>总览</h2>
      <div class="dim small">全部 AI 工具资产的一站式视图 · 数据落盘 ~/.walle</div>
    </div>
    <n-tag :bordered="false" size="small" round>
      写回开关 <span :class="allowWrite ? 'warn' : 'ok'">{{ allowWrite ? '已开启' : '关闭（安全）' }}</span>
    </n-tag>
  </div>

  <div class="cards">
    <n-card v-for="s in sources" :key="s.tool" size="small" class="src-card">
      <div class="card-head">
        <span class="dot" :data-tool="s.tool" />
        <strong>{{ s.displayName }}</strong>
        <n-tag size="tiny" :bordered="false" round>{{ s.tool }}</n-tag>
      </div>
      <n-statistic :value="s.total" tabular-num-size="26px" class="stat">
        <template #label><span class="dim small">个资产</span></template>
      </n-statistic>
      <div class="kinds">
        <n-tag v-for="(n, k) in s.byKind" :key="k" size="tiny" :bordered="false" round>
          {{ kindLabel[k] ?? k }} {{ n }}
        </n-tag>
      </div>
      <div class="dim small foot">上次扫描 {{ fmtTime(s.lastScannedAt) }}</div>
      <div class="dim small foot mono path" :title="s.rootPath">{{ s.rootPath }}</div>
    </n-card>
  </div>

  <div class="sec-head">
    <h3>最近变更</h3>
    <span class="dim small">谁刚被改过 · 含第三方工具的并发修改</span>
  </div>
  <n-card size="small" class="recent-card">
    <n-table size="small" :bordered="false" :single-line="false" class="recent">
      <thead>
        <tr><th>时间</th><th>来源</th><th>类型</th><th>资产</th><th style="text-align:right">大小</th></tr>
      </thead>
      <tbody>
        <tr v-for="a in recent" :key="a.id">
          <td class="dim">{{ fmtTime(a.mtime) }}</td>
          <td><n-tag size="tiny" :bordered="false" round>{{ a.tool }}</n-tag></td>
          <td><n-tag size="tiny" :bordered="false" round>{{ kindLabel[a.kind] ?? a.kind }}</n-tag></td>
          <td class="mono path-cell">{{ a.path }} <span v-if="a.sensitive" class="warn">⚠</span></td>
          <td class="dim" style="text-align:right">{{ humanSize(a.size) }}</td>
        </tr>
      </tbody>
    </n-table>
  </n-card>
</template>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 18px; }
h2 { margin: 0 0 2px; font-size: 22px; font-weight: 700; letter-spacing: .2px; }
h3 { margin: 0; font-size: 16px; }
.sec-head { display: flex; gap: 10px; align-items: baseline; margin: 26px 0 10px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
.card-head { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
.dot[data-tool="codex"] { background: #0a84ff; }
.dot[data-tool="zcode"] { background: #5e5ce6; }
.dot[data-tool="cursor"] { background: #ff9f0a; }
.dot[data-tool="opencode"] { background: #30d158; }
.stat { margin: 4px 0 8px; }
.kinds { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.foot { line-height: 1.5; }
.path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; font-size: 11px; }
.path-cell { font-size: 12px; word-break: break-all; max-width: 480px; }
</style>
