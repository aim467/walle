<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import UiButton from '../components/ui/Button.vue';
import UiInput from '../components/ui/Input.vue';
import UiBadge from '../components/ui/Badge.vue';
import UiDialog from '../components/ui/Dialog.vue';
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
const savedTools = ref<string[]>([]); // 本次保存改动了哪些工具（重扫只扫这些，即「导入」范围）


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
  const before = data.value.toolPaths;
  // 本次改动涉及的「工具」——保存后重扫（导入）只针对它们，不再全库扫一遍
  const changedKeys = Object.keys(edit.value).filter((k) => (edit.value[k] || '') !== (before[k] || ''));
  const tools = [...new Set(changedKeys.map((k) => data.value!.roots.find((r) => r.key === k)?.tool).filter((t): t is string => !!t))];
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
      savedTools.value = tools;
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

// ---------- 本地文件夹选择（「浏览…」） ----------
const picking = ref<string | null>(null); // 正在等待系统选择器的字段 key
const pickedPath = ref<Record<string, string>>({}); // 本会话手动选过的路径（用于即时修正「目录存在」徽标）
const browserOpen = ref(false);
const browserField = ref<{ key: string; title: string } | null>(null);
const browserPath = ref('');
const browserParent = ref<string | null>(null);
const browserEntries = ref<{ name: string; path: string; hidden: boolean }[]>([]);
const browserLoading = ref(false);

/** 目录是否存在：手动选过的路径直接为真（选择器只会返回存在的目录），否则用服务端扫描时的判定 */
function existsOf(r: RootDef): boolean {
  const p = edit.value[r.key];
  return !!(p && pickedPath.value[r.key] === p) || r.exists;
}

/** 打开本地文件夹：优先系统原生选择器，不可用时回退内置目录浏览器 */
async function openPicker(r: RootDef) {
  if (picking.value) return;
  const current = edit.value[r.key] || r.effectiveRoot || r.defaultRoot;
  picking.value = r.key;
  try {
    const d = await (await fetch('/api/pick-folder', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: `选择「${r.label}」目录`, defaultPath: current }),
    })).json();
    if (d.ok) { applyPicked(r.key, String(d.path)); return; }
    if (d.cancelled) return; // 用户取消：静默
    toast.warning(d.error ? `系统选择器不可用，改用内置浏览（${d.error}）` : '系统选择器不可用，改用内置浏览');
    await openBrowser(r);
  } finally {
    picking.value = null;
  }
}

function applyPicked(key: string, p: string) {
  edit.value[key] = p;
  pickedPath.value[key] = p;
  toast.success(`已选择：${p}（点「保存修改」后生效）`);
}

async function openBrowser(r: RootDef) {
  browserField.value = { key: r.key, title: r.label };
  browserOpen.value = true;
  await loadDirs(edit.value[r.key] || r.effectiveRoot || r.defaultRoot);
}

async function loadDirs(p: string) {
  browserLoading.value = true;
  try {
    const d = await (await fetch(`/api/fs/dirs?path=${encodeURIComponent(p)}`)).json();
    if (!d.ok) { toast.error(d.error ?? '无法读取目录'); return; }
    browserPath.value = d.path;
    browserParent.value = d.parent ?? null;
    browserEntries.value = d.entries ?? [];
  } finally {
    browserLoading.value = false;
  }
}

function confirmBrowser() {
  if (!browserField.value || !browserPath.value) return;
  applyPicked(browserField.value.key, browserPath.value);
  browserOpen.value = false;
}


// ---------- 大模型配置（OpenAI 兼容接口） ----------
interface LlmStatus {
  configured: boolean; baseUrl: string; model: string; apiKeyMasked: string;
  temperature: number; maxTokens: number | null; topP: number | null;
}
interface LlmEdit {
  baseUrl: string; apiKey: string; model: string;
  temperature: string; maxTokens: string; topP: string;
}
const llm = ref<LlmStatus | null>(null);
const llmEdit = ref<LlmEdit>({ baseUrl: '', apiKey: '', model: '', temperature: '', maxTokens: '', topP: '' });
const llmSaving = ref(false);

/** 用服务端状态回填编辑态（apiKey 永远留空，避免回显/误抹） */
function fillLlmEdit(s: LlmStatus) {
  llmEdit.value = {
    baseUrl: s.baseUrl,
    apiKey: '',
    model: s.model,
    temperature: s.temperature != null ? String(s.temperature) : '',
    maxTokens: s.maxTokens != null ? String(s.maxTokens) : '',
    topP: s.topP != null ? String(s.topP) : '',
  };
}

/** 空串 → undefined（留空即用默认 / 不传）；否则转数字 */
function numOrUndef(s: string): number | undefined {
  return s.trim() === '' ? undefined : Number(s.trim());
}

async function loadLlm() {
  llm.value = await (await fetch('/api/llm')).json();
  fillLlmEdit(llm.value!);
}

async function saveLlm() {
  llmSaving.value = true;
  try {
    const d = await (await fetch('/api/llm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        baseUrl: llmEdit.value.baseUrl,
        apiKey: llmEdit.value.apiKey,
        model: llmEdit.value.model,
        temperature: numOrUndef(llmEdit.value.temperature),
        maxTokens: numOrUndef(llmEdit.value.maxTokens),
        topP: numOrUndef(llmEdit.value.topP),
      }),
    })).json();
    if (d.ok) {
      llm.value = d.status;
      fillLlmEdit(d.status);
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
    // 刚改过路径的工具只扫自己（导入范围）；无改动记录时全量扫
    const targets: (string | null)[] = savedTools.value.length ? savedTools.value : [null];
    const lines: string[] = [];
    for (const t of targets) {
      const d = await (await fetch(`/api/scan${t ? `?source=${encodeURIComponent(t)}` : ''}`, { method: 'POST' })).json();
      if (!d.ok) {
        toast.error(d.error ?? '扫描失败');
        return;
      }
      for (const r of d.results as ScanResult[]) {
        if (!r.scanned) continue;
        lines.push(`${r.displayName}：资产 ${r.total}${r.new ? ` · 新增 ${r.new}` : ''}${r.updated ? ` · 更新 ${r.updated}` : ''}`);
      }
    }
    toast.success(lines.length ? lines.join('；') : '未发现任何 AI 工具数据源目录');
    needsRescan.value = false;
    savedTools.value = [];
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
        <UiButton v-if="needsRescan" variant="secondary" :loading="rescanning" class="!text-amber-600 dark:!text-amber-400" title="按已保存的路径重新扫描并入库" @click="rescanNow">
          立即导入
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
          <!-- <UiBadge>{{ g.tool }}</UiBadge> -->
        </header>

        <div class="tile-body">
          <div v-for="r in g.roots" :key="r.key" class="field">
            <div class="field-label">
              <span>{{ r.label }}</span>
              <UiBadge :type="existsOf(r) ? 'success' : 'warning'">
                {{ existsOf(r) ? '目录存在' : '目录不存在' }}
              </UiBadge>
              <UiBadge v-if="r.envRedirect && !r.override">环境变量重定向</UiBadge>
            </div>
            <div class="path-row">
              <div class="path-input">
                <UiInput
                  v-model:value="edit[r.key]"
                  :placeholder="r.defaultRoot"
                  class="field-input"
                  @update:value="(v: string) => { if (!v) resetOne(r.key) }"
                />
              </div>
              <UiButton
                variant="secondary"
                :loading="picking === r.key"
                :disabled="picking !== null && picking !== r.key"
                title="打开本地文件夹选择器"
                @click="openPicker(r)"
              >
                <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                  <path d="M3 7a2 2 0 012-2h3.6l1.6 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
                </svg>
                浏览…
              </UiButton>
            </div>
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
        <div class="llm-section-title">连接</div>
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

        <div class="llm-section-title">生成参数<span class="dim small"> · 留空则用默认值</span></div>
        <div class="llm-fields">
          <div class="field">
            <div class="field-label"><span>温度 temperature</span></div>
            <UiInput v-model:value="llmEdit.temperature" placeholder="0.3" class="field-input" />
            <div class="dim small field-meta">0-2，越低越稳定确定。默认 0.3（提炼/总结推荐 0-0.5）</div>
          </div>
          <div class="field">
            <div class="field-label"><span>最大 Token max_tokens</span></div>
            <UiInput v-model:value="llmEdit.maxTokens" placeholder="留空不限" class="field-input" />
            <div class="dim small field-meta">单次回复的 token 上限（正整数）；留空交服务端默认</div>
          </div>
          <div class="field">
            <div class="field-label"><span>核采样 top_p</span></div>
            <UiInput v-model:value="llmEdit.topP" placeholder="留空不设置" class="field-input" />
            <div class="dim small field-meta">0-1，与温度二选一调优即可；留空则不传该参数</div>
          </div>
        </div>

        <div class="llm-act">
          <UiButton :loading="llmSaving" :disabled="!llmEdit.baseUrl.trim() || !llmEdit.model.trim()" @click="saveLlm">保存大模型配置</UiButton>
        </div>
      </div>
    </section>

    <div v-if="data" class="dim small foot-hint">
      点「浏览…」可直接在本地文件夹选择器中选目录（系统选择器不可用时自动回退内置浏览）。清空输入框即恢复默认路径。路径不存在的工具在扫描时会被跳过（与未安装一致）。修改路径保存后需重新扫描才会生效。
    </div>

    <!-- 内置目录浏览器（系统选择器不可用时的兜底） -->
    <UiDialog v-model:open="browserOpen" :title="`选择文件夹${browserField ? ` · ${browserField.title}` : ''}`" width="620px">
      <div class="browser">
        <div class="browser-bar">
          <UiButton variant="outline" size="xs" :disabled="!browserParent || browserLoading" @click="loadDirs(browserParent!)">↑ 上级</UiButton>
          <UiButton variant="outline" size="xs" :disabled="browserLoading" @click="loadDirs('')">⌂ 根目录</UiButton>
          <span class="browser-path mono" :title="browserPath">{{ browserPath || '此电脑' }}</span>
        </div>
        <div class="browser-list">
          <button
            v-for="e in browserEntries"
            :key="e.path"
            type="button"
            class="browser-item"
            :class="{ 'is-hidden': e.hidden }"
            @click="loadDirs(e.path)"
          >
            <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
              <path d="M3 7a2 2 0 012-2h3.6l1.6 2H19a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
            </svg>
            <span class="browser-name">{{ e.name }}</span>
          </button>
          <div v-if="!browserEntries.length && !browserLoading" class="dim small browser-empty">此目录下没有子文件夹</div>
        </div>
      </div>
      <template #footer>
        <UiButton variant="ghost" @click="browserOpen = false">取消</UiButton>
        <UiButton :disabled="!browserPath" @click="confirmBrowser">使用此目录</UiButton>
      </template>
    </UiDialog>
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
.path-row { display: flex; align-items: center; gap: 8px; }
.path-input { flex: 1; min-width: 0; }
.field-input { width: 100%; }
.field-meta { font-size: 11.5px; line-height: 1.5; }
:deep(.field-input) input { text-overflow: ellipsis; }

/* 内置目录浏览器（兜底） */
.browser { display: flex; flex-direction: column; gap: 8px; }
.browser-bar { display: flex; align-items: center; gap: 8px; }
.browser-path {
  flex: 1; min-width: 0; font-size: 11.5px; color: hsl(var(--muted-foreground));
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; direction: rtl; text-align: left;
}
.browser-list {
  max-height: 46vh; overflow-y: auto; border: 1px solid var(--border); border-radius: 12px;
  padding: 4px; display: flex; flex-direction: column; gap: 1px;
}
.browser-item {
  display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
  padding: 6px 9px; border-radius: 8px; font-size: 12.5px; color: hsl(var(--foreground));
  transition: background-color .15s ease;
}
.browser-item:hover { background: hsl(var(--muted)); }
.browser-item.is-hidden { opacity: .6; }
.browser-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.browser-empty { padding: 10px 9px; }

/* 大模型配置：三列字段 */
.llm-card { margin-top: 16px; overflow: hidden; }
.llm-section-title {
  font-size: 12px; font-weight: 600; letter-spacing: .02em;
  color: hsl(var(--muted-foreground)); margin-top: 2px;
}
.llm-section-title .small { font-weight: 400; }
.llm-fields { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.llm-act { padding-top: 14px; }

.foot-hint { margin-top: 14px; line-height: 1.6; }

@media (max-width: 720px) {
  .llm-fields { grid-template-columns: 1fr; }
}
</style>
