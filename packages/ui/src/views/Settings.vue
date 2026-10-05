<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { NCard, NInput, NButton, NTag, useMessage } from 'naive-ui';import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';
import agentsLogo from '../assets/logos/agents.svg';

interface RootDef {
  key: string; tool: string; label: string;
  defaultRoot: string; envRedirect: string | null;
  override: string | null; effectiveRoot: string; exists: boolean;
}
interface SettingsData {
  allowWrite: boolean;
  toolPaths: Record<string, string>;
  roots: RootDef[];
}

interface ScanResult {
  tool: string; displayName: string; root: string | null; scanned: boolean;
  total: number; new: number; updated: number; unchanged: number; missing: number;
}

const toolLabel: Record<string, string> = { codex: 'Codex CLI', zcode: 'ZCode', cursor: 'Cursor', opencode: 'opencode', workbuddy: 'WorkBuddy 国际版', 'workbuddy-cn': 'WorkBuddy 国内版' };
const toolLogos: Record<string, string> = { zcode: zcodeLogo, codex: openaiLogo, cursor: cursorLogo, opencode: opencodeLogo, workbuddy: workbuddyLogo, 'workbuddy-cn': workbuddyLogo, agents: agentsLogo };
const toolOrder = ['codex', 'zcode', 'cursor', 'opencode', 'workbuddy', 'workbuddy-cn'];

const data = ref<SettingsData | null>(null);
const edit = ref<Record<string, string>>({});
const saving = ref(false);
const needsRescan = ref(false); // 保存过路径修改后提示重扫
const rescanning = ref(false);
const message = useMessage();

const grouped = computed(() => {
  if (!data.value) return [];
  const byTool = new Map<string, RootDef[]>();
  for (const r of data.value.roots) {
    if (!byTool.has(r.tool)) byTool.set(r.tool, []);
    byTool.get(r.tool)!.push(r);
  }
  return [...byTool.keys()].sort((a, b) => toolOrder.indexOf(a) - toolOrder.indexOf(b))
    .map((tool) => ({ tool, roots: byTool.get(tool)! }));
});

const dirty = computed(() => {
  if (!data.value) return false;
  return Object.keys(edit.value).some((k) => (edit.value[k] || '') !== (data.value!.toolPaths[k] || ''));
});

onMounted(async () => {
  data.value = await (await fetch('/api/settings')).json();
  edit.value = { ...data.value.toolPaths };
});

async function save() {
  if (!data.value) return;
  saving.value = true;
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ toolPaths: edit.value }),
    });
    const d = await res.json();
    if (d.ok) {
      message.success('已保存');
      needsRescan.value = true;
      data.value = await (await fetch('/api/settings')).json();
      edit.value = { ...data.value.toolPaths };
    } else {
      message.error(d.error ?? '保存失败');
    }
  } finally {
    saving.value = false;
  }
}

function resetOne(key: string) { edit.value[key] = ''; }

async function rescanNow() {
  if (rescanning.value) return;
  rescanning.value = true;
  const done = message.loading('正在重新扫描全部数据源…', { duration: 0 });
  try {
    const d = await (await fetch('/api/scan', { method: 'POST' })).json();
    if (!d.ok) {
      message.error(d.error ?? '扫描失败');
      return;
    }
    const parts = d.results.filter((r: ScanResult) => r.scanned)
      .map((r: ScanResult) => `${r.displayName}：资产 ${r.total}${r.new ? ` · 新增 ${r.new}` : ''}${r.updated ? ` · 更新 ${r.updated}` : ''}`);
    message.success(parts.length ? parts.join('；') : '未发现任何 AI 工具数据源目录');
    needsRescan.value = false;
  } finally {
    done();
    rescanning.value = false;
  }
}
</script>

<template>
  <div class="page-head">
    <div>
      <h2>设置</h2>
      <div class="dim small">自定义各 AI 工具的配置路径 · 保存到 ~/.walle/config.json · 修改后需重新执行 walle scan 生效</div>
    </div>
    <div class="head-actions">
      <n-button v-if="needsRescan" size="small" type="warning" secondary :loading="rescanning" @click="rescanNow">
        立即重新扫描
      </n-button>
      <n-button type="primary" :loading="saving" :disabled="!dirty" @click="save">保存修改</n-button>
    </div>
  </div>

  <n-card v-for="g in grouped" :key="g.tool" size="small" class="tool-card">
    <template #header>
      <div class="tool-head">
        <img class="tool-logo" :src="toolLogos[g.tool]" :alt="g.tool">
        <strong>{{ toolLabel[g.tool] ?? g.tool }}</strong>
        <n-tag size="tiny" :bordered="false" round>{{ g.tool }}</n-tag>
      </div>
    </template>
    <div v-for="r in g.roots" :key="r.key" class="root-row">
      <div class="root-info">
        <div class="root-label">
          {{ r.label }}
          <n-tag size="tiny" :bordered="false" round :type="r.exists ? 'success' : 'warning'">
            {{ r.exists ? '目录存在' : '目录不存在' }}
          </n-tag>
          <n-tag v-if="r.envRedirect && !r.override" size="tiny" :bordered="false" round>环境变量重定向</n-tag>
        </div>
        <div class="dim small">默认：{{ r.defaultRoot }}</div>
        <div v-if="r.effectiveRoot !== r.defaultRoot" class="dim small">当前生效：{{ r.effectiveRoot }}</div>
      </div>
      <n-input
        v-model:value="edit[r.key]" :placeholder="r.defaultRoot" clearable
        placeholder-style="color: var(--dim)" @clear="resetOne(r.key)"
      />
    </div>
  </n-card>

  <div v-if="data" class="dim small" style="margin-top:12px">
    清空输入框即恢复默认路径。路径不存在的工具在扫描时会被跳过（与未安装一致）。修改路径保存后需重新扫描才会生效。
  </div>
</template>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; }
.head-actions { display: flex; gap: 10px; align-items: center; }
.tool-card { margin-bottom: 14px; }
.tool-head { display: flex; align-items: center; gap: 8px; }
.tool-logo { width: 18px; height: 18px; object-fit: contain; }
.root-row { display: flex; gap: 16px; align-items: center; padding: 10px 0; }
.root-row + .root-row { border-top: 1px solid var(--border); }
.root-info { flex: 1; min-width: 0; }
.root-label { display: flex; align-items: center; gap: 8px; font-weight: 500; }
.root-row .n-input { width: 380px; flex-shrink: 0; }
</style>
