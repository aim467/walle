<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import UiButton from '../components/ui/Button.vue';
import UiBadge from '../components/ui/Badge.vue';
import { toast } from '../components/ui/toast';
import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';
import clineLogo from '../assets/logos/cline.png';
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

const toolLabel: Record<string, string> = { codex: 'Codex CLI', zcode: 'ZCode', cursor: 'Cursor', opencode: 'opencode', workbuddy: 'WorkBuddy 国际版', 'workbuddy-cn': 'WorkBuddy 国内版', agents: 'Skills 共享库', walle: '知识库', cline: 'Cline' };
const toolLogos: Record<string, string> = { zcode: zcodeLogo, codex: openaiLogo, cursor: cursorLogo, opencode: opencodeLogo, workbuddy: workbuddyLogo, 'workbuddy-cn': workbuddyLogo, agents: agentsLogo, walle: walleMark, cline: clineLogo };

const sources = ref<SourceInfo[]>([]);
const allowWrite = ref(false);
const usage = ref<ToolUsage[]>([]);
const usageDaily = ref<UsageDay[]>([]);
const usageProjects = ref<UsageProject[]>([]);
const scanning = ref(false);

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

/** 顶部聚合指标：数据源数 / 资产总数 / 最近扫描时间 */
const aggregate = computed(() => {
  const assets = sources.value.reduce((a, s) => a + s.total, 0);
  const lastScan = sources.value.map((s) => s.lastScannedAt).filter(Boolean).sort().pop() ?? null;
  return { tools: sources.value.length, assets, lastScan: lastScan as string | null };
});

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
  for (const b of out) b.height = max > 0 ? Math.max(3, Math.round((b.total / max) * 100)) : 3;
  return out;
};
const projName = (p: string) => p.replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p;

/** Top 项目：按 token 占比生成内联条形（单一品牌色编码量级） */
const projRows = computed(() => {
  const max = Math.max(0, ...usageProjects.value.map((p) => p.total ?? 0));
  return usageProjects.value.map((p) => ({
    ...p,
    pct: max > 0 ? Math.round(((p.total ?? 0) / max) * 100) : 0,
  }));
});

async function rescan(source?: string) {
  if (scanning.value) return;
  scanning.value = true;

  try {
    const d = await (await fetch('/api/scan' + (source ? `?source=${source}` : ''), { method: 'POST' })).json();
    if (!d.ok) {
      toast.error(d.error ?? '扫描失败');
      return;
    }
    const parts = d.results.filter((r: ScanResult) => r.scanned)
      .map((r: ScanResult) => `${r.displayName}：资产 ${r.total}${r.new ? ` · 新增 ${r.new}` : ''}${r.updated ? ` · 更新 ${r.updated}` : ''}`);
    toast.success(parts.length ? parts.join('；') : '未发现任何 AI 工具数据源目录');
    await load();
  } finally {
    scanning.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <div class="page-head">
      <div>
        <h2>总览</h2>
        <div class="subtitle">全部 AI 工具资产的一站式视图 · 数据落盘 ~/.walle</div>
      </div>
      <div class="head-actions">
        <UiButton variant="secondary" :loading="scanning" @click="rescan()">重新扫描</UiButton>
        <UiBadge size="small">
          写回开关 <span :class="allowWrite ? 'warn' : 'ok'">{{ allowWrite ? '已开启' : '关闭（安全）' }}</span>
        </UiBadge>
      </div>
    </div>

    <div class="summary">
      <div class="sm"><span class="sm-num">{{ aggregate.tools }}</span><span class="sm-label">数据源</span></div>
      <div class="sm"><span class="sm-num">{{ aggregate.assets.toLocaleString('en-US') }}</span><span class="sm-label">资产总数</span></div>
      <div class="sm"><span class="sm-num">{{ fmtTok(usageTotal().total) }}</span><span class="sm-label">累计 tokens</span></div>
      <div class="sm"><span class="sm-num sm-mono">{{ aggregate.lastScan ? fmtTime(aggregate.lastScan) : '—' }}</span><span class="sm-label">最近扫描</span></div>
    </div>

    <div class="cards">
      <div v-for="(s, i) in sources" :key="s.tool" class="card src-card" :style="{ '--i': i }">
        <div class="card-head">
          <img class="card-logo" :src="toolLogos[s.tool]" :alt="s.tool">
          <div class="head-id">
            <strong :title="s.displayName">{{ s.displayName }}</strong>
            <UiBadge>{{ s.tool }}</UiBadge>
          </div>
          <span class="stat-num">{{ s.total.toLocaleString('en-US') }}</span>
        </div>
        <div class="kinds">
          <UiBadge v-for="(n, k) in s.byKind" :key="k">
            {{ kindLabel[k] ?? k }} {{ n }}
          </UiBadge>
        </div>
        <div class="dim small foot">上次扫描 {{ fmtTime(s.lastScannedAt) }} · <a class="rescan-link" @click="rescan(s.tool)">仅扫此源</a></div>
        <div class="dim small foot mono path" :title="s.rootPath">{{ s.rootPath }}</div>
      </div>
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
      <!-- 双栏仪表盘：左＝按工具明细 + 近 14 天趋势，右＝Top 项目（长列表独占一栏，两栏等高收边） -->
      <div class="usage-body">
        <div class="usage-col">
          <div class="card usage-card table-card">
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
          </div>

          <div class="usage-block">
            <div class="dim small ub-title">近 14 天（按会话开始日，UTC）</div>
            <div class="card usage-card bars-card">
              <div class="bars">
                <div v-for="(b, i) in dailyBars()" :key="b.day" class="bar-col" :title="b.day + ' · ' + fmtTok(b.total) + ' tokens'" :style="{ '--i': i }">
                  <div class="bar-track">
                    <div class="bar" :class="{ empty: b.total === 0 }" :style="{ height: b.height + '%' }"></div>
                  </div>
                  <span class="bar-label">{{ b.day.slice(8) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="usage-block">
          <div class="dim small ub-title">Top 项目（按 token 用量）</div>
          <div class="card usage-card">
            <div v-for="p in projRows" :key="p.project" class="proj-row" :title="p.project">
              <span class="proj-bar" :style="{ width: p.pct + '%' }"></span>
              <span class="proj-name mono">{{ projName(p.project) }}</span>
              <span class="dim small proj-meta">{{ p.withUsage }} 会话 · {{ fmtTok(p.total) }}</span>
            </div>
            <div v-if="!usageProjects.length" class="dim small proj-empty">暂无带项目路径的用量数据</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
.head-actions { display: flex; gap: 10px; align-items: center; }
h2 { margin: 0 0 3px; font-size: 23px; font-weight: 700; letter-spacing: -.2px; }
.subtitle { color: var(--dim); font-size: 13px; }

/* 聚合指标条：左对齐、分隔线、tabular 数字，提供清晰焦点的层次 */
.summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 30px; margin: 2px 0 24px; }
.summary .sm { position: relative; display: flex; align-items: baseline; gap: 7px; }
.summary .sm:not(:first-child)::before { content: ''; position: absolute; left: -15px; top: 3px; bottom: 3px; width: 1px; background: var(--border); }
.sm-num { font-size: 21px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: .2px; line-height: 1.1; }
.sm-mono { font-family: "SF Mono", ui-monospace, Consolas, monospace; font-size: 15px; }
.sm-label { font-size: 12px; color: var(--dim); white-space: nowrap; }

.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(258px, 1fr)); gap: 14px; }
.src-card {
  padding: 15px 16px;
  transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
  animation: cardIn .55s cubic-bezier(.22, .61, .36, 1) backwards;
}
/* 入场用 backwards：结束后交还控制权，hover 变换不被动画 fill 覆盖 */
.src-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .09), 0 16px 40px rgba(0, 0, 0, .06);
  border-color: hsl(var(--primary) / .32);
}
@keyframes cardIn { from { opacity: 0; transform: translateY(12px); } }
.stat-num { margin-left: auto; font-size: 22px; font-weight: 700; line-height: 1.15; font-variant-numeric: tabular-nums; letter-spacing: -.4px; white-space: nowrap; flex-shrink: 0; }
/* 允许换行：卡片被压窄（高缩放比）时，数字会整块落到下一行右对齐，而不是溢出卡片外 */
.card-head { display: flex; gap: 9px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
/* 图标+名称+徽标作为一个可收缩分组：换行时整组留在首行，只把数字挤到下一行 */
.head-id { display: flex; gap: 9px; align-items: center; min-width: 0; }
/* 工具名过长时收缩并截断，避免把徽标与数字挤出容器 */
.head-id strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card-logo { width: 22px; height: 22px; border-radius: 6px; object-fit: contain; background: #fff; border: 1px solid var(--border); flex-shrink: 0; }
.kinds { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 10px; }
.foot { line-height: 1.5; }
.rescan-link { color: var(--accent); cursor: pointer; }
.path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; font-size: 11px; }

.usage { margin-top: 26px; }
.usage-head { display: flex; align-items: baseline; gap: 14px; margin-bottom: 10px; flex-wrap: wrap; }
.usage-head h3 { margin: 0; font-size: 16px; font-weight: 700; letter-spacing: .1px; }

/* 左栏（明细表 + 趋势）与右栏（Top 项目）等高：短的一栏由卡片吃满剩余高度 */
.usage-body { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 16px; align-items: stretch; }
.usage-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.usage-block { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.usage-block > .usage-card { flex: 1; min-height: 0; }
.usage-card { padding: 10px 14px; }
/* 极窄视口下表格列宽有下限，交给卡片自己横滚，避免整页出现横向滚动条 */
.table-card { overflow-x: auto; }
.usage-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.usage-table th { text-align: left; color: var(--dim); font-weight: 500; padding: 4px 10px; border-bottom: 1px solid var(--border); }
.usage-table td { padding: 7px 10px; border-bottom: 1px solid var(--border); transition: background .15s ease; }
.usage-table tbody tr { transition: background .15s ease; }
.usage-table tbody tr:hover { background: var(--hover); }
.usage-table tr:last-child td { border-bottom: none; }
.usage-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.usage-table .strong { font-weight: 700; color: hsl(var(--primary)); }
.usage-logo { width: 16px; height: 16px; border-radius: 4px; object-fit: contain; background: #fff; border: 1px solid var(--border); vertical-align: -3px; margin-right: 7px; }
.usage-table td:first-child { display: flex; align-items: center; }

.ub-title { margin-bottom: 6px; }
.bars-card { display: flex; flex-direction: column; }
.bars { display: flex; align-items: flex-end; gap: 5px; flex: 1; min-height: 116px; padding-top: 4px; }
.bar-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; cursor: default; }
/* 柱体轨道：柱高按轨道百分比计算，避免被下方日期标签挤压导致顶部柱体互相贴平 */
.bar-track { flex: 1; width: 100%; min-height: 0; display: flex; align-items: flex-end; justify-content: center; }
/* 单一品牌色，自底向上 scaleY 入场（GPU 友好，不动画布局属性）。
   注意：这里必须写完整的 hsl()——--card 是「0 0% 100%」通道三元组，
   直接塞进 color-mix 会构成非法颜色，导致整条 background 声明失效、柱子全透明 */
.bar {
  width: 100%; max-width: 34px; border-radius: 4px 4px 0 0;
  background: linear-gradient(180deg, hsl(var(--primary)), hsl(var(--primary) / .62));
  transform: scaleY(0); transform-origin: bottom;
  animation: barIn .55s cubic-bezier(.22, .61, .36, 1) forwards;
  animation-delay: calc(var(--i) * 35ms);
  transition: filter .15s ease;
}
.bar.empty { background: var(--border); }
.bar-col:hover .bar { filter: brightness(1.12); }
@keyframes barIn { to { transform: scaleY(1); } }
.bar-label { font-size: 9px; color: var(--dim); margin-top: 5px; white-space: nowrap; }

.proj-row { position: relative; display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 6px 2px; border-bottom: 1px solid var(--border); overflow: hidden; }
.proj-row:last-child { border-bottom: none; }
.proj-bar { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: hsl(var(--primary) / .09); border-right: 2px solid hsl(var(--primary) / .4); transition: width .4s cubic-bezier(.22, .61, .36, 1); }
.proj-name { position: relative; z-index: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.proj-meta { position: relative; z-index: 1; flex-shrink: 0; }
.proj-empty { padding: 8px 2px; }

/* 窄屏：双栏收成单栏。阈值 1200 是量出来的——再窄 50px，「会话/输入」列就会换行、
   行高从 36px 涨到 57px；收到单栏后表格反而更宽松 */
@media (max-width: 1200px) {
  .usage-body { grid-template-columns: minmax(0, 1fr); }
}

@media (prefers-reduced-motion: reduce) {
  .src-card, .bar { animation: none !important; transform: none !important; }
  .src-card:hover { transform: none; }
}
</style>
