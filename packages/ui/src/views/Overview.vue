<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { NCard, NTag, NStatistic, NButton, useMessage } from 'naive-ui';
import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';

interface SourceInfo {
  tool: string; displayName: string; rootPath: string; lastScannedAt: string | null;
  total: number; byKind: Record<string, number>;
}
interface ScanResult {
  tool: string; displayName: string; root: string | null; scanned: boolean;
  total: number; new: number; updated: number; unchanged: number; missing: number;
}

const toolLabel: Record<string, string> = { codex: 'Codex CLI', zcode: 'ZCode', cursor: 'Cursor', opencode: 'opencode', workbuddy: 'WorkBuddy' };
const toolLogos: Record<string, string> = { zcode: zcodeLogo, codex: openaiLogo, cursor: cursorLogo, opencode: opencodeLogo, workbuddy: workbuddyLogo };

const sources = ref<SourceInfo[]>([]);
const allowWrite = ref(false);
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
  // TODO(P5 会话智能)：此处接入各工具 token 用量统计（Codex state_5.threads.tokens_used /
  // ZCode db.sqlite 的 model_usage/turn_usage 表），替换原"最近变更"区块
}

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
</style>
