<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import UiButton from '../components/ui/Button.vue';
import UiInput from '../components/ui/Input.vue';
import UiBadge from '../components/ui/Badge.vue';
import { toast } from '../components/ui/toast';import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';
import agentsLogo from '../assets/logos/agents.svg';
import clineLogo from '../assets/logos/cline.png';
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

const toolLabel: Record<string, string> = { codex: 'Codex CLI', zcode: 'ZCode', cursor: 'Cursor', opencode: 'opencode', workbuddy: 'WorkBuddy 国际版', 'workbuddy-cn': 'WorkBuddy 国内版', agents: 'Skills 共享库', walle: 'Walle 知识库', cline: 'Cline' };
const toolLogos: Record<string, string> = { zcode: zcodeLogo, codex: openaiLogo, cursor: cursorLogo, opencode: opencodeLogo, workbuddy: workbuddyLogo, 'workbuddy-cn': workbuddyLogo, agents: agentsLogo, walle: walleMark, cline: clineLogo };
const toolOrder = ['codex', 'zcode', 'cursor', 'opencode', 'workbuddy', 'workbuddy-cn', 'cline'];

const data = ref<SettingsData | null>(null);
const edit = ref<Record<string, string>>({});
const saving = ref(false);
const needsRescan = ref(false); // 保存过路径修改后提示重扫
const rescanning = ref(false);


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
      toast.success('已保存');
      needsRescan.value = true;
      data.value = await (await fetch('/api/settings')).json();
      edit.value = { ...data.value.toolPaths };
    } else {
      toast.error(d.error ?? '保存失败');
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
      toast.success('大模型配置已保存，提炼可用 AI 生成');
    } else {
      toast.error(d.error ?? '保存失败');
    }
  } finally {
    llmSaving.value = false;
  }
}

onMounted(loadLlm);

async function rescanNow() {
  if (rescanning.value) return;
  rescanning.value = true;

  try {
    const d = await (await fetch('/api/scan', { method: 'POST' })).json();
    if (!d.ok) {
      toast.error(d.error ?? '扫描失败');
      return;
    }
    const parts = d.results.filter((r: ScanResult) => r.scanned)
      .map((r: ScanResult) => `${r.displayName}：资产 ${r.total}${r.new ? ` · 新增 ${r.new}` : ''}${r.updated ? ` · 更新 ${r.updated}` : ''}`);
    toast.success(parts.length ? parts.join('；') : '未发现任何 AI 工具数据源目录');
    needsRescan.value = false;
  } finally {
    rescanning.value = false;
  }
}
</script>

<template>
  <div class="settings">
    <div class="page-head">
      <div class="head-text">
        <h2>设置</h2>
        <div class="dim small">自定义各 AI 工具的配置路径 · 保存到 <span class="mono">~/.walle/config.json</span> · 修改后需重新执行 <span class="mono">walle scan</span> 生效</div>
      </div>
      <div class="head-actions">
        <UiButton v-if="needsRescan" variant="secondary" :loading="rescanning" class="!text-amber-600 dark:!text-amber-400" @click="rescanNow">
          立即重新扫描
        </UiButton>
        <UiButton :loading="saving" :disabled="!dirty" @click="save">保存修改</UiButton>
      </div>
    </div>

    <!-- 工具路径卡片网格 -->
    <div class="tool-grid">
      <section v-for="g in grouped" :key="g.tool" class="card tool-tile">
        <header class="tile-head">
          <div class="tool-id">
            <span class="logo-tile">
              <img class="tool-logo" :src="toolLogos[g.tool]" :alt="g.tool">
            </span>
            <strong>{{ toolLabel[g.tool] ?? g.tool }}</strong>
          </div>
          <UiBadge>{{ g.tool }}</UiBadge>
        </header>

        <div class="tile-body">
          <div v-for="r in g.roots" :key="r.key" class="field">
            <div class="field-label">
              <span>{{ r.label }}</span>
              <UiBadge :type="r.exists ? 'success' : 'warning'">
                {{ r.exists ? '目录存在' : '目录不存在' }}
              </UiBadge>
              <UiBadge v-if="r.envRedirect && !r.override">环境变量重定向</UiBadge>
            </div>
            <UiInput
              v-model:value="edit[r.key]"
              :placeholder="r.defaultRoot"
              class="field-input"
              @update:value="(v: string) => { if (!v) resetOne(r.key) }"
            />
            <div class="dim small field-meta">默认：{{ r.defaultRoot }}</div>
            <div v-if="r.effectiveRoot !== r.defaultRoot" class="dim small field-meta">
              当前生效：{{ r.effectiveRoot }}
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 大模型配置（OpenAI 兼容） -->
    <section class="card llm-card">
      <header class="tile-head">
        <div class="tool-id">
          <span class="logo-tile llm-tile">AI</span>
          <strong>大模型（提炼用 · OpenAI 兼容接口）</strong>
        </div>
        <UiBadge v-if="llm" :type="llm.configured ? 'success' : 'warning'">
          {{ llm.configured ? '已配置' : '未配置（提炼为纯手动模式）' }}
        </UiBadge>
      </header>

      <div v-if="llm" class="tile-body">
        <div class="llm-fields">
          <div class="field">
            <div class="field-label"><span>Base URL</span></div>
            <UiInput v-model:value="llmEdit.baseUrl" placeholder="https://api.deepseek.com/v1" class="field-input" />
            <div class="dim small field-meta">OpenAI 兼容地址，如 http://127.0.0.1:11434/v1（Ollama）或 https://api.deepseek.com/v1</div>
          </div>
          <div class="field">
            <div class="field-label"><span>API Key</span></div>
            <UiInput v-model:value="llmEdit.apiKey" password placeholder="sk-…" class="field-input" />
            <div class="dim small field-meta">
              {{ llm.apiKeyMasked ? `已保存：${llm.apiKeyMasked}（留空即保留原值）` : '本地 Ollama 可留空' }}
            </div>
          </div>
          <div class="field">
            <div class="field-label"><span>模型名</span></div>
            <UiInput v-model:value="llmEdit.model" placeholder="qwen3:8b" class="field-input" />
            <div class="dim small field-meta">如 qwen3:8b（Ollama）/ deepseek-chat / gpt-4o-mini</div>
          </div>
        </div>
        <div class="llm-act">
          <UiButton :loading="llmSaving" :disabled="!llmEdit.baseUrl.trim() || !llmEdit.model.trim()" @click="saveLlm">保存大模型配置</UiButton>
        </div>
      </div>
    </section>

    <div v-if="data" class="dim small foot-hint">
      清空输入框即恢复默认路径。路径不存在的工具在扫描时会被跳过（与未安装一致）。修改路径保存后需重新扫描才会生效。
    </div>
  </div>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; }
.page-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-bottom: 18px; flex-wrap: wrap; }
.head-text h2 { margin: 0 0 4px; font-size: 22px; letter-spacing: -0.01em; }
.mono { font-family: "SF Mono", ui-monospace, Consolas, monospace; }

/* 工具卡片网格 */
.tool-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 16px;
  align-items: stretch;
}
.tool-tile { overflow: hidden; transition: transform .25s ease, box-shadow .25s ease; }
.tool-tile:hover { transform: translateY(-2px); box-shadow: 0 2px 6px rgba(0,0,0,.08), 0 14px 34px rgba(0,0,0,.10); }
:global(.dark) .tool-tile:hover { box-shadow: 0 2px 6px rgba(0,0,0,.5), 0 14px 34px rgba(0,0,0,.45); }

.tile-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  padding: 14px 16px; border-bottom: 1px solid var(--border);
}
.tool-id { display: flex; align-items: center; gap: 10px; min-width: 0; }
.logo-tile {
  width: 34px; height: 34px; flex-shrink: 0; border-radius: 10px;
  background: hsl(var(--muted)); display: flex; align-items: center; justify-content: center;
}
.tool-logo { width: 20px; height: 20px; object-fit: contain; }
.llm-tile {
  background: hsl(var(--primary) / .14); color: hsl(var(--primary));
  font-weight: 700; font-size: 13px; letter-spacing: .04em;
}
.tile-head strong { font-size: 14px; font-weight: 600; }

.tile-body { padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 14px; }

.field { display: flex; flex-direction: column; gap: 6px; }
.field-label { display: flex; align-items: center; gap: 6px; font-weight: 500; font-size: 13px; flex-wrap: wrap; }
.field-input { width: 100%; }
.field-meta { font-size: 11.5px; line-height: 1.5; }
:deep(.field-input) input { text-overflow: ellipsis; }

/* 大模型配置：三列字段 */
.llm-card { margin-top: 16px; overflow: hidden; }
.llm-fields { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.llm-act { padding-top: 14px; }

.foot-hint { margin-top: 14px; line-height: 1.6; }

@media (max-width: 720px) {
  .llm-fields { grid-template-columns: 1fr; }
}
</style>
