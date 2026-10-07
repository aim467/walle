<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { NCard, NInput, NButton, NTag, useMessage } from 'naive-ui';import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';
import agentsLogo from '../assets/logos/agents.svg';
import walleMark from '../assets/walle-mark.svg';

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

const toolLabel: Record<string, string> = { codex: 'Codex CLI', zcode: 'ZCode', cursor: 'Cursor', opencode: 'opencode', workbuddy: 'WorkBuddy 国际版', 'workbuddy-cn': 'WorkBuddy 国内版', agents: 'Skills 共享库', walle: 'Walle 知识库' };
const toolLogos: Record<string, string> = { zcode: zcodeLogo, codex: openaiLogo, cursor: cursorLogo, opencode: opencodeLogo, workbuddy: workbuddyLogo, 'workbuddy-cn': workbuddyLogo, agents: agentsLogo, walle: walleMark };
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

// ---------- 大模型配置（OpenAI 兼容接口） ----------
interface LlmStatus { configured: boolean; baseUrl: string; model: string; apiKeyMasked: string }
const llm = ref<LlmStatus | null>(null);
const llmEdit = ref<{ baseUrl: string; apiKey: string; model: string }>({ baseUrl: '', apiKey: '', model: '' });
const llmSaving = ref(false);

async function loadLlm() {
  llm.value = await (await fetch('/api/llm')).json();
  llmEdit.value = { baseUrl: llm.value.baseUrl, apiKey: '', model: llm.value.model };
}

async function saveLlm() {
  llmSaving.value = true;
  try {
    const d = await (await fetch('/api/llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(llmEdit.value),
    })).json();
    if (d.ok) {
      llm.value = d.status;
      llmEdit.value = { baseUrl: d.status.baseUrl, apiKey: '', model: d.status.model };
      message.success('大模型配置已保存，提炼可用 AI 生成');
    } else {
      message.error(d.error ?? '保存失败');
    }
  } finally {
    llmSaving.value = false;
  }
}

onMounted(loadLlm);

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

  <!-- 大模型配置（OpenAI 兼容） -->
  <n-card size="small" class="tool-card">
    <template #header>
      <div class="tool-head">
        <strong>大模型（提炼用 · OpenAI 兼容接口）</strong>
        <n-tag v-if="llm" size="tiny" :bordered="false" round :type="llm.configured ? 'success' : 'warning'">
          {{ llm.configured ? '已配置' : '未配置（提炼为纯手动模式）' }}
        </n-tag>
      </div>
    </template>
    <div v-if="llm" class="llm-grid">
      <div class="root-row">
        <div class="root-info">
          <div class="root-label">Base URL</div>
          <div class="dim small">OpenAI 兼容地址，如 http://127.0.0.1:11434/v1（Ollama）或 https://api.deepseek.com/v1</div>
        </div>
        <n-input v-model:value="llmEdit.baseUrl" placeholder="https://api.deepseek.com/v1" clearable />
      </div>
      <div class="root-row">
        <div class="root-info">
          <div class="root-label">API Key</div>
          <div class="dim small">
            {{ llm.apiKeyMasked ? `已保存：${llm.apiKeyMasked}（留空即保留原值）` : '本地 Ollama 可留空' }}
          </div>
        </div>
        <n-input v-model:value="llmEdit.apiKey" type="password" show-password-on="click" placeholder="sk-…" clearable />
      </div>
      <div class="root-row">
        <div class="root-info">
          <div class="root-label">模型名</div>
          <div class="dim small">如 qwen3:8b（Ollama）/ deepseek-chat / gpt-4o-mini</div>
        </div>
        <n-input v-model:value="llmEdit.model" placeholder="qwen3:8b" clearable />
      </div>
    </div>
    <div class="llm-act">
      <n-button size="small" type="primary" :loading="llmSaving" :disabled="!llmEdit.baseUrl.trim() || !llmEdit.model.trim()" @click="saveLlm">保存大模型配置</n-button>
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
.llm-grid .root-row .n-input { width: 380px; }
.llm-act { padding-top: 6px; }
</style>
