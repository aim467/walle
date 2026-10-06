<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NCard, NTag, NStatistic, NButton, useMessage } from 'naive-ui';
import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';
import agentsLogo from '../assets/logos/agents.svg';
import walleMark from '../assets/walle-mark.svg';

interface SourceInfo {
  tool: string; displayName: string; rootPath: string; lastScannedAt: string | null;
  total: number; byKind: Record<string, number>;
}
interface ScanResult {
  tool: string; displayName: string; root: string | null; scanned: boolean;
  total: number; new: number; updated: number; unchanged: number; missing: number;
}
interface ToolUsage {
  tool: string; sessions: number; withUsage: number;
  input: number | null; output: number | null; reasoning: number | null;
  cacheRead: number | null; cacheWrite: number | null; total: number | null; cost: number | null;
}
interface UsageDay { day: string; input: number | null; output: number | null; total: number | null }
interface UsageProject { project: string; sessions: number; withUsage: number; input: number | null; output: number | null; total: number | null }

const toolLabel: Record<string, string> = { codex: 'Codex CLI', zcode: 'ZCode', cursor: 'Cursor', opencode: 'opencode', workbuddy: 'WorkBuddy 国际版', 'workbuddy-cn': 'WorkBuddy 国内版', agents: 'Skills 共享库', walle: '知识库' };
const toolLogos: Record<string, string> = { zcode: zcodeLogo, codex: openaiLogo, cursor: cursorLogo, opencode: opencodeLogo, workbuddy: workbuddyLogo, 'workbuddy-cn': workbuddyLogo, agents: agentsLogo, walle: walleMark };

const sources = ref<SourceInfo[]>([]);
const allowWrite = ref(false);
const usage = ref<ToolUsage[]>([]);
const usageDaily = ref<UsageDay[]>([]);
const usageProjects = ref<UsageProject[]>([]);
const scanning = ref(false);
const message = useMessage();
const kindLabel: Record<string, string> = {
  config: '配置', session: '会话', memory: '记忆', skill: 'Skill', mcp: 'MCP', rule: '规则',
  prompt: '输入历史', agent: '子代理', plugin: '插件', secret: '凭证', other: '其他',
};
function fmtTime(iso: string | null): string { return iso ? iso.replace('T', ' ').slice(0, 19) : '-'; }

async function load() {
  const d = await (await fetch('/api/overview')).json();
  sources.value = d.sources;
  allowWrite.value = d.allowWrite;
  usage.value = d.usage ?? [];
  usageDaily.value = d.usageDaily ?? [];
  usageProjects.value = d.usageProjects ?? [];
}

const usageRows = () => usage.value.filter((u) => (u.total ?? 0) > 0 || (u.input ?? 0) > 0);
function fmtTok(n: number | null): string {
  if (n == null) return '-';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + ' B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + ' k';
  return n.toLocaleString('en-US');
}
const usageTotal = () =>
  usage.value.reduce((acc, u) => ({
    input: (acc.input ?? 0) + (u.input ?? 0), output: (acc.output ?? 0) + (u.output ?? 0),
    total: (acc.total ?? 0) + (u.total ?? 0), cost: (acc.cost ?? 0) + (u.cost ?? 0),
  }), { input: 0, output: 0, total: 0, cost: 0 } as { input: number; output: number; total: number; cost: number });

/** 近 14 天趋势：以今天为终点补齐空日期（无用量日高度为 0） */
const dailyBars = () => {
  const byDay = new Map(usageDaily.value.map((d) => [d.day, d]));
  const out: { day: string; total: number; height: number }[] = [];
  let max = 0;
  for (let i = 13; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const total = byDay.get(dt)?.total ?? 0;
    max = Math.max(max, total);
    out.push({ day: dt, total, height: 0 });
  }
  for (const b of out) b.height = max > 0 ? Math.max(2, Math.round((b.total / max) * 100)) : 2;
  return out;
};
const projName = (p: string) => p.replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

async function rescan(source?: string) {
  if (scanning.value) return;
  scanning.value = true;
  const done = message.loading(source ? `正在重新扫描 ${toolLabel[source] ?? source}…` : '正在重新扫描全部数据源…', { duration: 0 });
  try {
    const d = await (await fetch('/api/scan' + (source ? `?source=${source}` : ''), { method: 'POST' })).json();
    if (!d.ok) {
      message.error(d.error ?? '扫描失败');
      return;
    }
    const parts = d.results.filter((r: ScanResult) => r.scanned)
      .map((r: ScanResult) => `${r.displayName}：资产 ${r.total}${r.new ? ` · 新增 ${r.new}` : ''}${r.updated ? ` · 更新 ${r.updated}` : ''}`);
    message.success(parts.length ? parts.join('；') : '未发现任何 AI 工具数据源目录');
    await load();
  } finally {
    done();
    scanning.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="page-head">
    <div>
      <h2>总览</h2>
      <div class="dim small">全部 AI 工具资产的一站式视图 · 数据落盘 ~/.walle</div>
    </div>
    <div class="head-actions">
      <n-button size="small" secondary :loading="scanning" @click="rescan()">重新扫描</n-button>
      <n-tag :bordered="false" size="small" round>
        写回开关 <span :class="allowWrite ? 'warn' : 'ok'">{{ allowWrite ? '已开启' : '关闭（安全）' }}</span>
      </n-tag>
    </div>
  </div>

  <div class="cards">
    <n-card v-for="s in sources" :key="s.tool" size="small" class="src-card">
      <div class="card-head">
        <img class="card-logo" :src="toolLogos[s.tool]" :alt="s.tool">
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
      <div class="dim small foot">上次扫描 {{ fmtTime(s.lastScannedAt) }} · <a class="rescan-link" @click="rescan(s.tool)">仅扫此源</a></div>
      <div class="dim small foot mono path" :title="s.rootPath">{{ s.rootPath }}</div>
    </n-card>
  </div>

  <!-- Token 用量（P5.1：仅统计能提供用量的工具，取不到的如实不显示） -->
  <div v-if="usageRows().length" class="usage">
    <div class="usage-head">
      <h3>Token 用量</h3>
      <span class="dim small">
        累计 {{ fmtTok(usageTotal().total) }} tokens · 输入 {{ fmtTok(usageTotal().input) }} / 输出 {{ fmtTok(usageTotal().output) }}
        <template v-if="usageTotal().cost > 0"> · 成本 {{ usageTotal().cost.toFixed(2) }}</template>
      </span>
    </div>
    <n-card size="small" class="usage-card">
      <table class="usage-table">
        <thead>
          <tr><th>工具</th><th class="num">会话</th><th class="num">输入</th><th class="num">输出</th><th class="num">缓存读</th><th class="num">合计</th></tr>
        </thead>
        <tbody>
          <tr v-for="u in usageRows()" :key="u.tool">
            <td><img class="usage-logo" :src="toolLogos[u.tool]" alt=""><span>{{ toolLabel[u.tool] ?? u.tool }}</span></td>
            <td class="num">{{ u.withUsage }}<span v-if="u.sessions > u.withUsage" class="dim"> / {{ u.sessions }}</span></td>
            <td class="num">{{ fmtTok(u.input) }}</td>
            <td class="num">{{ fmtTok(u.output) }}</td>
            <td class="num">{{ fmtTok(u.cacheRead) }}</td>
            <td class="num strong">{{ fmtTok(u.total) }}</td>
          </tr>
        </tbody>
      </table>
    </n-card>

    <div class="usage-two">
      <div>
        <div class="dim small ub-title">近 14 天（按会话开始日，UTC）</div>
        <n-card size="small" class="usage-card">
          <div class="bars">
            <div v-for="b in dailyBars()" :key="b.day" class="bar-col" :title="b.day + ' · ' + fmtTok(b.total) + ' tokens'">
              <div class="bar" :style="{ height: b.height + '%' }" :class="{ empty: b.total === 0 }"></div>
              <span class="bar-label">{{ b.day.slice(5) }}</span>
            </div>
          </div>
        </n-card>
      </div>
      <div>
        <div class="dim small ub-title">Top 项目（按 token 用量）</div>
        <n-card size="small" class="usage-card">
          <div v-for="p in usageProjects" :key="p.project" class="proj-row" :title="p.project">
            <span class="proj-name mono">{{ projName(p.project) }}</span>
            <span class="dim small">{{ p.withUsage }} 会话 · {{ fmtTok(p.total) }}</span>
          </div>
          <div v-if="!usageProjects.length" class="dim small">暂无带项目路径的用量数据</div>
        </n-card>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 18px; }
.head-actions { display: flex; gap: 10px; align-items: center; }
h2 { margin: 0 0 2px; font-size: 22px; font-weight: 700; letter-spacing: .2px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 14px; }
.card-head { display: flex; gap: 9px; align-items: center; margin-bottom: 8px; }
.card-logo { width: 22px; height: 22px; border-radius: 6px; object-fit: contain; background: #fff; border: 1px solid var(--border); }
.stat { margin: 4px 0 8px; }
.kinds { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px; }
.foot { line-height: 1.5; }
.rescan-link { color: var(--accent); cursor: pointer; }
.path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; font-size: 11px; }
.usage { margin-top: 22px; }
.usage-head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 10px; }
.usage-head h3 { margin: 0; font-size: 16px; font-weight: 700; }
.usage-card { max-width: 720px; }
.usage-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.usage-table th { text-align: left; color: #6e6e73; font-weight: 500; padding: 4px 10px; border-bottom: 1px solid var(--border); }
.usage-table td { padding: 6px 10px; border-bottom: 1px solid var(--border); }
.usage-table tr:last-child td { border-bottom: none; }
.usage-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.usage-table .strong { font-weight: 600; }
.usage-logo { width: 16px; height: 16px; border-radius: 4px; object-fit: contain; background: #fff; border: 1px solid var(--border); vertical-align: -3px; margin-right: 7px; }
.usage-table td:first-child { display: flex; align-items: center; }
.usage-two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; max-width: 980px; }
.ub-title { margin-bottom: 6px; }
.bars { display: flex; align-items: flex-end; gap: 5px; height: 110px; padding-top: 4px; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; }
.bar { width: 100%; max-width: 26px; background: linear-gradient(180deg, #0a84ff, #5e5ce6); border-radius: 4px 4px 0 0; }
.bar.empty { background: var(--border); }
.bar-label { font-size: 9px; color: #8e8e93; margin-top: 4px; white-space: nowrap; }
.proj-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 5px 2px; border-bottom: 1px solid var(--border); }
.proj-row:last-of-type { border-bottom: none; }
.proj-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
</style>
