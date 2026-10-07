<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, reactive } from 'vue';
import { NInput, NEmpty, NTag, NButton, NSelect, NCheckbox, NCheckboxGroup, useMessage } from 'naive-ui';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });
import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';

interface Hit {
  assetId: number; subId: string; tool: string; kind: string; role: string | null;
  time: string | null; title: string; snippet: string; path: string;
  model?: string | null; projectPath?: string | null; messageCount?: number | null;
  tokensTotal?: number | null; tokensInput?: number | null; tokensOutput?: number | null;
}
interface Msg { seq: number; role: string | null; ts: string | null; text: string; docType?: string }
interface TokenUsage { input: number | null; output: number | null; reasoning: number | null; cacheRead: number | null; cacheWrite: number | null; total: number | null; cost: number | null }
interface ReadMeta { model: string | null; projectPath: string | null; startedAt: string | null; messageCount: number | null; subId: string; usage: TokenUsage | null }
interface ArtifactFile { name: string; size: number; mtime: string }

const roleLabel: Record<string, string> = { user: '用户', assistant: '助手', developer: '系统注入', system: '系统', tool: '工具', thinking: '思考' };
/** 角色头部样式元数据：头像类型与配色 */
const roleMeta: Record<string, { bg: string; fg: string; icon: string }> = {
  user: { bg: '#0071e3', fg: '#fff', icon: 'user' },
  assistant: { bg: '#1d1d1f', fg: '#fff', icon: 'tool-logo' },
  developer: { bg: '#e8e2f4', fg: '#5e5ce6', icon: 'gear' },
  system: { bg: '#ececec', fg: '#6e6e73', icon: 'gear' },
  tool: { bg: '#fff3d6', fg: '#b25000', icon: 'wrench' },
  thinking: { bg: '#efe9f7', fg: '#7d5bd0', icon: 'think' },
};
const SVG_ICONS: Record<string, string> = {
  user: 'M12 12a4.5 4.5 0 100-9 4.5 4.5 0 000 9zm0 2c-4 0-7.5 2-7.5 4.5V21h15v-2.5c0-2.5-3.5-4.5-7.5-4.5z',
  gear: 'M12 8.5A3.5 3.5 0 1012 15.5 3.5 3.5 0 0012 8.5zm8.9 4.9l-1.8-1a6.9 6.9 0 000-2.8l1.8-1a1 1 0 00.4-1.3l-1.5-2.6a1 1 0 00-1.3-.4l-1.8 1a7 7 0 00-2.4-1.4V2a1 1 0 00-1-1h-3a1 1 0 00-1 1v1.9a7 7 0 00-2.4 1.4l-1.8-1a1 1 0 00-1.3.4L3.3 6.9a1 1 0 00.4 1.3l1.8 1a6.9 6.9 0 000 2.8l-1.8 1a1 1 0 00-.4 1.3l1.5 2.6a1 1 0 001.3.4l1.8-1a7 7 0 002.4 1.4V19a1 1 0 001 1h3a1 1 0 001-1v-1.9a7 7 0 002.4-1.4l1.8 1a1 1 0 001.3-.4l1.5-2.6a1 1 0 00-.4-1.3z',
  wrench: 'M21.7 5.3l-4-4a1 1 0 00-1.4 0l-2.5 2.5a5.5 5.5 0 00-6.9 6.9L1.3 16.3a1 1 0 000 1.4l5 5a1 1 0 001.4 0l5.6-5.6a5.5 5.5 0 006.9-6.9l2.5-2.5a1 1 0 000-1.4zM7.5 19.1l-2.6-2.6 3-3 2.6 2.6z',
  think: 'M12 2a7 7 0 00-4 12.7c.6.5 1 1.4 1 2.3v1h6v-1c0-.9.4-1.8 1-2.3A7 7 0 0012 2zM9.5 21h5M10.5 23h3',
};
interface ToolDef { id: string; name: string; logo?: string; letter: string; color: string }
const TOOLS: ToolDef[] = [
  { id: 'zcode', name: 'ZCode', logo: zcodeLogo, letter: 'Z', color: 'linear-gradient(135deg,#0a84ff,#5e5ce6)' },
  { id: 'codex', name: 'Codex CLI', logo: openaiLogo, letter: 'C', color: '#10a37f' },
  { id: 'cursor', name: 'Cursor', logo: cursorLogo, letter: 'C', color: '#111' },
  { id: 'opencode', name: 'OpenCode', logo: opencodeLogo, letter: 'O', color: '#111' },
  { id: 'workbuddy', name: 'WorkBuddy 国际版', logo: workbuddyLogo, letter: 'W', color: 'linear-gradient(135deg,#0a84ff,#5e5ce6)' },
  { id: 'workbuddy-cn', name: 'WorkBuddy 国内版', logo: workbuddyLogo, letter: 'W', color: 'linear-gradient(135deg,#34c759,#0a84ff)' },
];

const activeTool = ref<string | null>(null); // null = 全部工具
const hits = ref<Hit[]>([]);
const allSessions = ref<Hit[]>([]);
const globalQ = ref('');
const listQ = ref('');
const msgs = ref<Msg[]>([]);
const readMeta = ref<{ title: string | null; tool: string; meta: ReadMeta | null } | null>(null);
const curKey = ref('');
const detailTab = ref<'msgs' | 'thinking' | 'overview' | 'tools' | 'files' | 'system' | 'raw'>('msgs');
const rawText = ref<string | null>(null);
const rawLoading = ref(false);

const toolStats = computed(() => {
  const m = new Map<string, { count: number }>();
  for (const s of allSessions.value) m.set(s.tool, { count: (m.get(s.tool)?.count ?? 0) + 1 });
  return m;
});
const totalCount = computed(() => allSessions.value.length);
const listTitle = computed(() => {
  const name = activeTool.value ? (TOOLS.find((t) => t.id === activeTool.value)?.name ?? activeTool.value) : '全部工具';
  return `${name} · ${hits.value.length} 个会话`;
});
const listFiltered = computed(() => {
  let rows = hits.value;
  if (projectFilter.value) rows = rows.filter((h) => h.projectPath === projectFilter.value);
  if (!listQ.value.trim()) return rows;
  const s = listQ.value.toLowerCase();
  return rows.filter((h) => (h.title ?? '').toLowerCase().includes(s) || (h.projectPath ?? '').toLowerCase().includes(s) || (h.model ?? '').toLowerCase().includes(s));
});
/** 项目归集筛选：当前工具下出现过的项目路径（显示名取末段 + 会话数，值为完整路径） */
const projectFilter = ref<string | null>(null);
const projectOptions = computed(() => {
  const m = new Map<string, number>();
  for (const h of hits.value) if (h.projectPath) m.set(h.projectPath, (m.get(h.projectPath) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([p, n]) => ({ label: `${p.replace(/^\\\\\?\\/, '').split(/[\\/]/).pop() || p} (${n})`, value: p }));
});
const FOLD_CHARS = 2048;
/** 超长消息折叠状态（按消息对象弱引用，切换会话自动失效） */
const expandedMsgs = reactive(new WeakSet<Msg>());
const isLongMsg = (m: Msg) => m.text.length > FOLD_CHARS;
const isCollapsed = (m: Msg) => isLongMsg(m) && !expandedMsgs.has(m);
function toggleMsg(m: Msg) {
  if (expandedMsgs.has(m)) expandedMsgs.delete(m);
  else expandedMsgs.add(m);
}
function clipText(m: Msg) {
  // 折叠时截到最近的换行，避免半行割裂
  let cut = m.text.slice(0, FOLD_CHARS);
  const nl = cut.lastIndexOf('\n');
  if (nl > FOLD_CHARS * 0.7) cut = cut.slice(0, nl);
  return cut;
}

/** 思考消息：默认折叠为摘要（与长消息折叠独立），展开后整段可读 */
const THINK_PREVIEW_CHARS = 600;
const expandedThinking = reactive(new WeakSet<Msg>());
const thinkCollapsed = (m: Msg) => !expandedThinking.has(m);
function toggleThinking(m: Msg) {
  if (expandedThinking.has(m)) expandedThinking.delete(m);
  else expandedThinking.add(m);
}
function thinkPreview(m: Msg): string {
  let cut = m.text.slice(0, THINK_PREVIEW_CHARS);
  const nl = cut.lastIndexOf('\n');
  if (nl > THINK_PREVIEW_CHARS * 0.6) cut = cut.slice(0, nl);
  return cut;
}
const thinkTotalChars = computed(() => thinkingMsgs.value.reduce((n, m) => n + m.text.length, 0));

/** assistant 消息 Markdown 渲染（DOMPurify 消毒；折叠消息以截断文本为源渲染摘要） */
function mdHtml(m: Msg): string {
  const src = isCollapsed(m) ? clipText(m) : m.text;
  return DOMPurify.sanitize(marked.parse(src) as string);
}

const toolMsgs = computed(() => msgs.value.filter((m) => m.role === 'tool'));
const thinkingMsgs = computed(() => msgs.value.filter((m) => m.role === 'thinking'));
const systemMsgs = computed(() => msgs.value.filter((m) => m.role === 'developer' || m.role === 'system'));
// 消息流排除工具与思考（各自有专属页签）
const visibleMsgs = computed(() => msgs.value.filter((m) => m.role !== 'tool' && m.role !== 'thinking'));

/** Files 页签：会话涉及的文件（来自工具调用路径提取，session_file 文档按路径聚合） */
const fileGroups = computed(() => {
  const m = new Map<string, { path: string; count: number; lastTs: string | null }>();
  for (const f of msgs.value) {
    if (f.docType !== 'session_file') continue;
    const g = m.get(f.text) ?? { path: f.text, count: 0, lastTs: null };
    g.count++;
    if (f.ts && (!g.lastTs || f.ts > g.lastTs)) g.lastTs = f.ts;
    m.set(f.text, g);
  }
  return [...m.values()].sort((a, b) => (b.lastTs ?? '').localeCompare(a.lastTs ?? ''));
});

/** ZCode 工具结果转储（artifacts）：不入资产库，Files 页签按需读取 */
const artifacts = ref<ArtifactFile[] | null>(null);
const artifactPreview = ref<{ name: string; text: string; truncated: boolean } | null>(null);
const artifactLoading = ref(false);
async function loadArtifacts() {
  artifactPreview.value = null;
  artifacts.value = null;
  if (readMeta.value?.tool !== 'zcode' || !readMeta.value.meta?.subId) return;
  artifactLoading.value = true;
  try {
    const p = new URLSearchParams({ asset: String(currentAssetId()), sub: readMeta.value.meta.subId });
    const d = await (await fetch('/api/artifacts?' + p)).json();
    artifacts.value = d.files ?? [];
  } catch {
    artifacts.value = [];
  } finally {
    artifactLoading.value = false;
  }
}
async function previewArtifact(name: string) {
  const p = new URLSearchParams({ asset: String(currentAssetId()), sub: readMeta.value?.meta?.subId ?? '', file: name });
  try {
    const d = await (await fetch('/api/artifacts?' + p)).json();
    artifactPreview.value = d.error
      ? { name, text: `（${d.error}）`, truncated: false }
      : { name, text: d.text ?? '', truncated: !!d.truncated };
  } catch {
    artifactPreview.value = { name, text: '（读取失败）', truncated: false };
  }
}
function fmtSize(n: number): string {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB';
  return n + ' B';
}
const toolLogo = computed(() => TOOLS.find((t) => t.id === readMeta.value?.tool)?.logo);
function copyMsg(text: string) {
  navigator.clipboard?.writeText(text).catch(function () { /* 剪贴板不可用时静默 */ });
}

/** 用户消息锚点导航：只定位真实用户输入（排除环境上下文/权限注入等 user 角色的系统块） */
const isInjected = (t: string) =>
  t.startsWith('<environment_context>') || t.startsWith('<permissions') || t.startsWith('<skills_');
const userAnchors = computed(() =>
  visibleMsgs.value
    .map((m, i) => ({ idx: i, ts: m.ts, text: m.text }))
    .filter((x) => x.text && visibleMsgs.value[x.idx].role === 'user' && !isInjected(x.text)),
);
const activeAnchor = ref(-1);
function jumpToUser(idx: number) {
  activeAnchor.value = idx;
  const el = document.getElementById('umsg-' + idx);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('anchor-flash');
    setTimeout(function () { el.classList.remove('anchor-flash'); }, 1600);
  }
}
/** 思考索引定位：目标默认折叠，先展开再滚动 */
function jumpToThink(idx: number) {
  const m = thinkingMsgs.value[idx];
  if (m) expandedThinking.add(m);
  document.getElementById('think-' + idx)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadSessions() {
  allSessions.value = ((await (await fetch('/api/list?sessions=1&limit=2000')).json()).hits ?? []) as Hit[];
}
function selectTool(id: string | null) {
  activeTool.value = id;
  listQ.value = '';
  projectFilter.value = null;
  const p = new URLSearchParams({ sessions: '1' });
  if (id) p.set('tool', id);
  fetch('/api/list?' + p).then((r) => r.json()).then((d) => { hits.value = d.hits ?? []; });
}
async function globalSearch() {
  if (!globalQ.value.trim()) return;
  activeTool.value = null;
  listQ.value = '';
  const d = await (await fetch('/api/list?q=' + encodeURIComponent(globalQ.value.trim()))).json();
  hits.value = d.hits ?? [];
}
async function openAsset(h: Hit) {
  const p = new URLSearchParams({ asset: String(h.assetId) });
  if (h.subId) p.set('sub', h.subId);
  const d = await (await fetch('/api/read?' + p)).json();
  readMeta.value = { title: d.title ?? h.title, tool: d.tool, meta: d.meta ?? null };
  curKey.value = h.assetId + '|' + (h.subId ?? '');
  msgs.value = d.messages ?? [];
  detailTab.value = 'msgs';
  rawText.value = null;
}
async function loadRaw() {
  if (!readMeta.value) return;
  const p = new URLSearchParams({ asset: String(currentAssetId()), raw: '1' });
  rawLoading.value = true;
  try {
    const d = await (await fetch('/api/source?' + p)).json();
    rawText.value = d.error ? `（${d.error}）` : d.content + (d.truncated ? '\n…（超过 512KB，已截断）' : '');
  } finally {
    rawLoading.value = false;
  }
}
function currentAssetId(): number {
  const cur = listFiltered.value.find((h) => h.title === readMeta.value?.title) ?? hits.value[0];
  return cur ? cur.assetId : 0;
}

// ---------- 会话提炼（P5.2）：圈选消息 → 三种产物（知识卡片/总结文档/记忆条目） ----------
const message = useMessage();
const distillOpen = ref(false);
const distillSel = ref<number[]>([]);
const distillTitle = ref('');
const distillTags = ref('');
const distillBody = ref('');
const distillSaving = ref(false);
const distillProduct = ref<'card' | 'summary' | 'memory'>('card');
const distillProject = ref('');
const distillSource = ref<{ assetId: number; subId: string; tool: string; title: string | null } | null>(null);
/** 提炼素材：只取 user/assistant 双角色正文（口径与未来 LLM 蒸馏一致） */
const distillMsgs = computed(() => msgs.value.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.text.trim()));
const productOptions = [
  { label: '知识卡片（问题/方案/结论）', value: 'card' },
  { label: '总结文档（项目纪要）', value: 'summary' },
  { label: '记忆条目（写回记忆文件）', value: 'memory' },
];

// 记忆写回（提炼二期产物之三）：目标下拉 + 模板 + diff 预览 + WriteEngine 三保险
interface MemTarget { assetId: number; tool: string; name: string; path: string; scope: 'global' | 'project'; projectRoot: string | null; size: number | null; mtime: string | null }
interface DiffLine { op: 'same' | 'add' | 'del'; text: string; gap?: number }
const memTargets = ref<MemTarget[]>([]);
const memAllowWrite = ref(false);
const memTarget = ref<number | null>(null);
const memTplKey = ref<'std' | 'one' | 'custom'>('std');
const memTplCustom = ref('');
const MEM_TEMPLATES = [
  { key: 'std' as const, label: '标准条目（日期 + 标题）', tpl: '## {date} {title}\n\n{summary}\n\n> 来源会话：{source}' },
  { key: 'one' as const, label: '简洁一行', tpl: '- {date} {title}：{summary}（来源：{source}）' },
  { key: 'custom' as const, label: '自定义模板…', tpl: '' },
];
const memDiff = ref<DiffLine[] | null>(null);
const memConflict = ref(false);
const memPreviewing = ref(false);
const memWriting = ref(false);

const memTargetOptions = computed(() => {
  const byTool = new Map<string, { label: string; value: number }[]>();
  for (const t of memTargets.value) {
    const scopeTag = t.scope === 'global' ? '根记忆' : '项目';
    const item = { label: `${scopeTag} · ${t.name}`, value: t.assetId };
    byTool.set(t.tool, [...(byTool.get(t.tool) ?? []), item]);
  }
  return [...byTool.entries()].map(([tool, children]) => ({ type: 'group' as const, label: tool, key: tool, children }));
});
const memTplText = computed(() => (memTplKey.value === 'custom' ? memTplCustom.value : MEM_TEMPLATES.find((m) => m.key === memTplKey.value)!.tpl));
/** 模板渲染：{date} {title} {summary} {source} 四个占位符 */
function renderEntry(): string {
  const src = distillSource.value;
  return memTplText.value
    .replaceAll('{date}', new Date().toISOString().slice(0, 10))
    .replaceAll('{title}', distillTitle.value.trim() || '未命名')
    .replaceAll('{summary}', distillBody.value.trim())
    .replaceAll('{source}', src ? `${src.tool}${src.title ? `「${src.title}」` : ''}` : '手动记录');
}
async function loadMemTargets() {
  try {
    const d = await (await fetch('/api/memory/targets')).json();
    memTargets.value = d.targets ?? [];
    memAllowWrite.value = !!d.allowWrite;
    if (memTarget.value == null && memTargets.value.length) memTarget.value = memTargets.value[0].assetId;
  } catch { memTargets.value = []; }
}
async function previewMemDiff() {
  if (memTarget.value == null || memPreviewing.value || !distillBody.value.trim()) return;
  memPreviewing.value = true;
  try {
    const r = await (await fetch('/api/memory/append-preview', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: memTarget.value, entryText: renderEntry() }),
    })).json();
    if (r.ok) { memDiff.value = r.diff; memConflict.value = !!r.conflict; }
    else { memDiff.value = null; message.error(r.error ?? '预览失败'); }
  } finally {
    memPreviewing.value = false;
  }
}
async function writeMemory() {
  if (memTarget.value == null || memWriting.value || !distillBody.value.trim()) return;
  memWriting.value = true;
  try {
    const r = await (await fetch('/api/memory/append', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: memTarget.value, entryText: renderEntry() }),
    })).json();
    if (r.ok) {
      distillOpen.value = false;
      message.success('已写入记忆文件（写前快照 #' + (r.snapshotId ?? '-') + '，可回滚）');
    } else {
      message.error('写入失败: ' + (r.reason || r.error || ''));
    }
  } finally {
    memWriting.value = false;
  }
}

function openDistill() {
  if (!readMeta.value) return;
  const [aid, sub] = curKey.value.split('|');
  distillSource.value = { assetId: Number(aid) || currentAssetId(), subId: sub ?? '', tool: readMeta.value.tool, title: readMeta.value.title };
  const list = distillMsgs.value;
  // 默认圈选：第一条用户消息 + 最后一条助手消息（会话的核心问答），可增删
  const firstUser = list.find((m) => m.role === 'user');
  const lastAsst = [...list].reverse().find((m) => m.role === 'assistant');
  distillSel.value = [firstUser?.seq, lastAsst?.seq].filter((s): s is number => s != null && list.some((m) => m.seq === s));
  distillProduct.value = 'card';
  distillTitle.value = (readMeta.value.title ?? '') + ' · 提炼';
  distillTags.value = '';
  distillProject.value = readMeta.value.meta?.projectPath ?? '';
  memDiff.value = null;
  memConflict.value = false;
  prefillBody();
  distillOpen.value = true;
  void loadLlmStatus();
  void loadMemTargets();
}
function onDistillSelChange(v: number[]) {
  distillSel.value = v;
  prefillBody();
}
/** 用圈选的消息生成正文预填（每条截 2000 字符） */
function prefillBody() {
  const picked = distillMsgs.value.filter((m) => distillSel.value.includes(m.seq));
  distillBody.value = picked
    .map((m) => `**${m.role === 'user' ? '用户' : '助手'}：**\n\n${m.text.length > 2000 ? m.text.slice(0, 2000) + '\n…（截断）' : m.text}`)
    .join('\n\n---\n\n');
}
// 大模型（OpenAI 兼容）配置状态：弹窗打开时查询，决定显示 AI 生成按钮还是手动提示
const llmConfigured = ref(false);
const llmGenerating = ref(false);
async function loadLlmStatus() {
  try { llmConfigured.value = (await (await fetch('/api/llm')).json()).configured; } catch { llmConfigured.value = false; }
}
async function aiSummarize() {
  if (!distillSource.value || llmGenerating.value) return;
  llmGenerating.value = true;
  try {
    const r = await (await fetch('/api/llm/summarize', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: distillSource.value.assetId, subId: distillSource.value.subId, seqs: distillSel.value, product: distillProduct.value === 'memory' ? 'card' : distillProduct.value }),
    })).json();
    if (r.ok) distillBody.value = r.text;
    else message.error(r.error ?? '生成失败');
  } finally {
    llmGenerating.value = false;
  }
}

async function saveDistill() {
  if (!distillSource.value || !distillTitle.value.trim() || !distillBody.value.trim()) return;
  distillSaving.value = true;
  try {
    const r = await (await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: distillTitle.value, tags: distillTags.value.split(',').map((s) => s.trim()).filter(Boolean), text: distillBody.value,
        type: distillProduct.value === 'summary' ? 'summary' : 'card',
        project: distillProduct.value === 'summary' ? (distillProject.value || null) : null,
        source: { tool: distillSource.value.tool, assetId: distillSource.value.assetId, subId: distillSource.value.subId, sessionTitle: distillSource.value.title },
      }),
    })).json();
    if (r.ok) {
      distillOpen.value = false;
      message.success(distillProduct.value === 'summary' ? '已存入知识库（总结文档）' : '已存入知识库');
    } else {
      message.error('保存失败: ' + (r.error || ''));
    }
  } finally {
    distillSaving.value = false;
  }
}
function fmtDate(iso: string | null): string { return iso ? iso.slice(0, 10) : ''; }
function fmtHM(iso: string | null): string { return iso ? iso.slice(11, 16) : ''; }
function fmtFull(iso: string | null): string { return iso ? iso.replace('T', ' ').slice(0, 19) : '-'; }
function fmtTok(n: number | null): string {
  if (n == null) return '-';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + ' M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + ' k';
  return n.toLocaleString('en-US');
}

// 列表拖拽调宽
const listW = ref(380);
let resizing = false;
function startResize(e: MouseEvent) {
  resizing = true;
  e.preventDefault();
}
function onMove(e: MouseEvent) {
  if (!resizing) return;
  listW.value = Math.min(680, Math.max(260, e.clientX - 232)); // 232 = 侧栏宽 + 容器起点
}
function stopResize() { resizing = false; }
onMounted(() => {
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', stopResize);
});
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onMove);
  window.removeEventListener('mouseup', stopResize);
});

onMounted(async () => {
  await loadSessions();
  await selectTool(null);
  // 默认选中会话最多的工具
  let best: string | null = null, n = 0;
  for (const [t, s] of toolStats.value) if (s.count > n) { n = s.count; best = t; }
  if (best) selectTool(best);
});
</script>

<template>
  <div class="page">
    <!-- 顶部 52px 工具 Tab 栏 -->
    <div class="toolbar glassbar">
      <button class="tab" :class="{ on: activeTool === null }" @click="selectTool(null)">
        <span class="tab-dot" style="background:#8e8e93;color:#fff">A</span>
        <span class="tab-name">全部工具</span>
        <span class="tab-n">{{ totalCount }}</span>
      </button>
      <button
        v-for="t in TOOLS" :key="t.id" class="tab" :class="{ on: activeTool === t.id }" @click="selectTool(t.id)"
      >
        <img v-if="t.logo" class="tab-logo" :src="t.logo" :alt="t.name">
        <span v-else class="tab-dot" :style="{ background: t.color }">{{ t.letter }}</span>
        <span class="tab-name">{{ t.name }}</span>
        <span class="tab-n">{{ toolStats.get(t.id)?.count ?? 0 }}</span>
      </button>
      <span class="flex1" />
      <n-input v-model:value="globalQ" placeholder="全局搜索（跨工具，Enter）" size="small" round clearable style="width:300px" @keydown.enter="globalSearch" />
    </div>

    <div class="body">
      <!-- 会话列表（可拖宽） -->
      <div class="list card" :style="{ width: listW + 'px' }">
        <div class="list-head">
          <strong class="small">{{ listTitle }}</strong>
          <span class="dim small">最近更新</span>
        </div>
        <div class="list-search">
          <n-input v-model:value="listQ" placeholder="搜索当前列表…" size="small" round clearable />
          <n-select
            v-if="projectOptions.length" v-model:value="projectFilter" :options="projectOptions"
            placeholder="按项目归集" size="small" clearable filterable style="margin-top:6px"
          />
        </div>
        <div class="list-scroll">
          <div v-for="(h, i) in listFiltered" :key="i" class="s-item" :class="{ sel: curKey === h.assetId + '|' + (h.subId ?? '') }" @click="openAsset(h)">
            <div class="s-top">
              <span class="dim small">{{ fmtDate(h.time) }}</span>
              <span class="dim small">{{ fmtHM(h.time) }}</span>
            </div>
            <div class="s-title">{{ h.title }}</div>
            <div class="dim small">{{ h.model ?? '未知模型' }}<template v-if="h.messageCount"> · {{ h.messageCount }} 条消息</template><template v-if="h.tokensTotal"> · {{ fmtTok(h.tokensTotal) }} tok</template></div>
            <div class="dim small s-path">{{ h.projectPath ?? h.path }}</div>
          </div>
          <n-empty :description="listQ ? '没有匹配的会话' : '选择上方工具查看会话'" size="small" style="padding:36px 0" />
        </div>
      </div>
      <div class="resizer" title="拖动调整宽度" @mousedown="startResize" />

      <!-- 详情 -->
      <div class="detail card">
        <template v-if="readMeta">
          <div class="d-head">
            <div class="d-title">{{ readMeta.title }}</div>
            <div class="d-tags">
              <n-tag size="tiny" :bordered="false" round type="primary">{{ TOOLS.find((t) => t.id === readMeta.tool)?.name ?? readMeta.tool }}</n-tag>
              <n-tag v-if="readMeta.meta?.model" size="tiny" :bordered="false" round>{{ readMeta.meta.model }}</n-tag>
              <n-tag v-if="msgs.length" size="tiny" :bordered="false" round>{{ msgs.length }} 条消息</n-tag>
              <n-tag v-if="readMeta.meta?.startedAt" size="tiny" :bordered="false" round>{{ fmtFull(readMeta.meta.startedAt) }}</n-tag>
            </div>
            <div class="d-actions">
              <n-button size="tiny" round type="primary" secondary @click="openDistill" title="把该会话提炼为知识卡片">✦ 提炼</n-button>
              <n-button size="tiny" round quaternary title="复制标题">⧉</n-button>
              <n-button size="tiny" round quaternary title="回到顶部">↑</n-button>
            </div>
          </div>
          <div class="d-tabs glassbar">
            <button v-for="t in [
              { k: 'msgs', label: '消息' }, { k: 'thinking', label: '思考' }, { k: 'overview', label: '概览' }, { k: 'tools', label: 'Tools' },
              { k: 'files', label: 'Files' }, { k: 'system', label: 'System' }, { k: 'raw', label: 'Raw' },
            ]" :key="t.k" class="d-tab" :class="{ on: detailTab === t.k }"
              @click="detailTab = t.k; if (t.k === 'raw' && rawText === null) loadRaw(); if (t.k === 'files') loadArtifacts()">
              {{ t.label }}
            </button>
          </div>
          <div class="d-body">
            <!-- 消息 -->
            <div v-if="detailTab === 'msgs'" class="msgs-wrap">
              <div class="msgs-flow">
                <div
                  v-for="(m, i) in visibleMsgs" :key="i" class="msg-row"
                  :id="m.role === 'user' ? 'umsg-' + i : undefined"
                >
                <div class="m-avatar" :style="{ background: (roleMeta[m.role ?? ''] ?? roleMeta.system).bg }">
                  <img
                    v-if="(roleMeta[m.role ?? ''] ?? roleMeta.system).icon === 'tool-logo' && toolLogo"
                    :src="toolLogo" alt=""
                  >
                  <svg v-else viewBox="0 0 24 24" width="13" height="13">
                    <path :d="SVG_ICONS[(roleMeta[m.role ?? ''] ?? roleMeta.system).icon]" :fill="(roleMeta[m.role ?? ''] ?? roleMeta.system).fg" />
                  </svg>
                </div>
                <div class="m-main">
                  <div class="m-head">
                    <span class="m-name">{{ roleLabel[m.role ?? ''] ?? m.role ?? '未知' }}</span>
                    <span v-if="m.ts" class="dim small m-time">{{ fmtFull(m.ts) }}</span>
                    <span class="m-copy" title="复制内容" @click="copyMsg(m.text)">⧉</span>
                  </div>
                  <div
                    v-if="m.role === 'assistant'"
                    class="msg assistant md"
                    :class="{ clamped: isCollapsed(m) }"
                    v-html="mdHtml(m)"
                  ></div>
                  <div v-else class="msg" :class="[m.role || 'assistant', { clamped: isCollapsed(m) }]">{{ isCollapsed(m) ? clipText(m) : m.text }}</div>
                  <button v-if="isLongMsg(m)" class="fold-btn" @click="toggleMsg(m)">
                    {{ isCollapsed(m) ? `展开全文 · 共 ${m.text.length.toLocaleString()} 字符` : '收起' }}
                  </button>
                </div>
                </div>
              </div>
              <!-- 用户消息锚点导航 -->
              <aside v-if="userAnchors.length" class="anchor-nav">
                <div class="dim small an-head">用户消息 · {{ userAnchors.length }}</div>
                <button
                  v-for="(a, i) in userAnchors" :key="i"
                  class="an-item" :class="{ on: activeAnchor === a.idx }"
                  :title="a.text.slice(0, 120)"
                  @click="jumpToUser(a.idx)"
                >
                  <span class="an-idx">{{ i + 1 }}</span>
                  <span class="an-text">{{ a.text.replace(/\s+/g, ' ').slice(0, 26) }}</span>
                </button>
              </aside>
            </div>
            <!-- 概览 -->
            <div v-else-if="detailTab === 'overview'" class="overview">
              <div class="ov-grid">
                <div class="ov-item" v-for="f in [
                  ['模型', readMeta.meta?.model ?? '-'], ['项目', readMeta.meta?.projectPath ?? '-'],
                  ['开始时间', fmtFull(readMeta.meta?.startedAt ?? null)], ['消息数', String(msgs.length)],
                  ['会话 ID', readMeta.meta?.subId ?? '-'], ['来源', TOOLS.find((t) => t.id === readMeta.tool)?.name ?? readMeta.tool],
                ]" :key="f[0]">
                  <div class="dim small">{{ f[0] }}</div>
                  <div class="mono small">{{ f[1] }}</div>
                </div>
              </div>
              <div v-if="readMeta.meta?.usage" class="usage-block">
                <div class="dim small ub-head">Token 用量</div>
                <div class="usage-grid">
                  <div class="ov-item" v-for="f in [
                    ['输入', fmtTok(readMeta.meta.usage.input)], ['输出', fmtTok(readMeta.meta.usage.output)],
                    ['缓存读', fmtTok(readMeta.meta.usage.cacheRead)], ['合计', fmtTok(readMeta.meta.usage.total ?? (readMeta.meta.usage.input ?? 0) + (readMeta.meta.usage.output ?? 0))],
                  ]" :key="f[0]">
                    <div class="dim small">{{ f[0] }}</div>
                    <div class="mono small">{{ f[1] }}</div>
                  </div>
                </div>
              </div>
              <div v-else class="dim small" style="margin-top:14px">本会话的数据源未记录 token 用量</div>
            </div>
            <!-- Tools -->
            <div v-else-if="detailTab === 'tools'">
              <div v-if="toolMsgs.length">
                <div v-for="(m, i) in toolMsgs" :key="i" class="msg-block">
                  <div class="who">工具 · {{ fmtFull(m.ts) }}</div>
                  <div class="msg" :class="['tool', { clamped: isCollapsed(m) }]">{{ isCollapsed(m) ? clipText(m) : m.text }}</div>
                  <button v-if="isLongMsg(m)" class="fold-btn" @click="toggleMsg(m)">
                    {{ isCollapsed(m) ? `展开全文 · 共 ${m.text.length.toLocaleString()} 字符` : '收起' }}
                  </button>
                </div>
              </div>
              <n-empty v-else description="本会话未解析到工具调用记录（结构化工具调用解析将随会话解析增强提供）" style="padding:60px 0" />
            </div>
            <!-- Files -->
            <div v-else-if="detailTab === 'files'" class="overview">
              <div class="ov-item">
                <div class="dim small">项目路径</div>
                <div class="mono small">{{ readMeta.meta?.projectPath ?? '（未记录）' }}</div>
              </div>
              <div class="ov-item" style="margin-top:14px">
                <div class="dim small" style="margin-bottom:6px">涉及文件 · {{ fileGroups.length }}</div>
                <template v-if="fileGroups.length">
                  <div v-for="g in fileGroups" :key="g.path" class="mono small" style="display:flex; gap:12px; justify-content:space-between; padding:3px 0" :title="g.path">
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ g.path }}</span>
                    <span class="dim" style="white-space:nowrap">{{ g.count }} 次{{ g.lastTs ? ' · ' + fmtFull(g.lastTs) : '' }}</span>
                  </div>
                </template>
                <div v-else class="dim small">本会话未解析到文件级记录（来自工具调用的路径提取）</div>
              </div>
              <div v-if="readMeta.tool === 'zcode'" class="ov-item" style="margin-top:14px">
                <div class="dim small" style="margin-bottom:6px">工具结果转储（artifacts · 按需读取原文）</div>
                <div v-if="artifactLoading" class="dim small">加载中…</div>
                <template v-else-if="artifacts && artifacts.length">
                  <button
                    v-for="a in artifacts" :key="a.name" class="mono small"
                    style="display:flex; gap:12px; justify-content:space-between; width:100%; padding:3px 0; border:none; background:none; cursor:pointer; text-align:left"
                    :title="a.name + '（点击预览）'"
                    @click="previewArtifact(a.name)"
                  >
                    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ a.name }}</span>
                    <span class="dim" style="white-space:nowrap">{{ fmtSize(a.size) }}</span>
                  </button>
                </template>
                <div v-else-if="artifacts" class="dim small">本会话没有转储文件</div>
              </div>
              <pre v-if="artifactPreview" class="raw" style="margin-top:12px; max-height:420px; overflow:auto">{{ artifactPreview.text + (artifactPreview.truncated ? '\n…（超过 512KB，已截断）' : '') }}</pre>
            </div>
            <!-- 思考：模型的内在独白——左侧紫色轨道卡片 + 右侧索引导航 -->
            <div v-else-if="detailTab === 'thinking'" class="msgs-wrap">
              <div class="msgs-flow">
                <template v-if="thinkingMsgs.length">
                  <div class="think-summary dim small">
                    共 {{ thinkingMsgs.length }} 段思考 · 约 {{ thinkTotalChars.toLocaleString() }} 字符——默认折叠，点击卡片展开
                  </div>
                  <div v-for="(m, i) in thinkingMsgs" :key="i" class="think-row" :id="'think-' + i">
                    <div class="think-card" :class="{ open: !thinkCollapsed(m) }" @click="toggleThinking(m)">
                      <div class="think-head">
                        <span class="think-idx">{{ String(i + 1).padStart(2, '0') }}</span>
                        <span class="think-title">思考</span>
                        <span v-if="m.ts" class="dim small">{{ fmtHM(m.ts) }}</span>
                        <span class="think-chars dim small">{{ m.text.length.toLocaleString() }} 字符</span>
                        <span class="think-chev" aria-hidden="true">▾</span>
                      </div>
                      <div class="think-body" :class="{ clamped: thinkCollapsed(m) }">{{ thinkCollapsed(m) ? thinkPreview(m) : m.text }}</div>
                    </div>
                    <span v-if="thinkCollapsed(m) && m.text.length > THINK_PREVIEW_CHARS" class="think-more">点击展开全文</span>
                  </div>
                </template>
                <n-empty v-else description="本会话没有思考记录（该工具/模型未开启思考模式，或思考内容不可读）" style="padding:60px 0" />
              </div>
              <!-- 思考索引导航 -->
              <aside v-if="thinkingMsgs.length > 1" class="anchor-nav think-nav">
                <div class="dim small an-head">思考索引 · {{ thinkingMsgs.length }}</div>
                <button
                  v-for="(m, i) in thinkingMsgs" :key="i"
                  class="an-item" :title="m.text.slice(0, 120)"
                  @click="jumpToThink(i)"
                >
                  <span class="an-idx think-idx-dot">{{ String(i + 1).padStart(2, '0') }}</span>
                  <span class="an-text">{{ m.text.replace(/\s+/g, ' ').slice(0, 26) }}</span>
                </button>
              </aside>
            </div>
            <!-- System -->
            <div v-else-if="detailTab === 'system'">
              <div v-if="systemMsgs.length">
                <div v-for="(m, i) in systemMsgs" :key="i" class="msg-block">
                  <div class="who">{{ roleLabel[m.role ?? ''] ?? m.role }} · {{ fmtFull(m.ts) }}</div>
                  <div class="msg" :class="['developer', { clamped: isCollapsed(m) }]">{{ isCollapsed(m) ? clipText(m) : m.text }}</div>
                  <button v-if="isLongMsg(m)" class="fold-btn" @click="toggleMsg(m)">
                    {{ isCollapsed(m) ? `展开全文 · 共 ${m.text.length.toLocaleString()} 字符` : '收起' }}
                  </button>
                </div>
              </div>
              <n-empty v-else description="本会话没有系统注入消息" style="padding:60px 0" />
            </div>
            <!-- Raw -->
            <div v-else-if="detailTab === 'raw'">
              <div v-if="rawLoading" class="dim small" style="padding:20px">加载中…</div>
              <pre v-else-if="rawText !== null" class="raw">{{ rawText }}</pre>
              <n-empty v-else description="选择会话后加载原文" style="padding:60px 0" />
            </div>
          </div>
        </template>
        <n-empty v-else description="从左侧选择一个会话" style="margin:auto" />
      </div>
    </div>

    <!-- 提炼弹窗：圈选 user/assistant 消息 → 三种产物（知识卡片/总结文档/记忆条目） -->
    <div v-if="distillOpen" class="modal-mask" @click.self="distillOpen = false">
      <div class="modal card">
        <div class="insp-title">提炼会话</div>
        <div class="dim small" style="margin-top:4px">只圈选用户的文本与助手的正文（不含工具调用与系统注入）。勾选变化会重新生成正文预填，可在正文里继续手工编辑。</div>
        <n-select v-model:value="distillProduct" :options="productOptions" size="small" round style="margin-top:10px; width: 260px" />
        <n-checkbox-group :value="distillSel" @update:value="onDistillSelChange">
          <div class="distill-list">
            <label v-for="m in distillMsgs" :key="m.seq" class="distill-item">
              <n-checkbox :value="m.seq" />
              <n-tag size="tiny" :bordered="false" round :type="m.role === 'user' ? 'info' : 'default'">{{ m.role === 'user' ? '用户' : '助手' }}</n-tag>
              <span class="distill-text">{{ m.text.replace(/s+/g, ' ').slice(0, 180) }}</span>
            </label>
          </div>
        </n-checkbox-group>
        <n-input v-model:value="distillTitle" :placeholder="distillProduct === 'memory' ? '条目标题' : '标题'" size="small" round style="margin-top:12px" />
        <n-input v-if="distillProduct !== 'memory'" v-model:value="distillTags" placeholder="标签（逗号分隔）" size="small" round style="margin-top:8px" />
        <n-input v-if="distillProduct === 'summary'" v-model:value="distillProject" placeholder="所属项目路径（可选）" size="small" round style="margin-top:8px" />

        <!-- 记忆条目：目标 + 模板 + diff 预览 -->
        <template v-if="distillProduct === 'memory'">
          <div class="mem-row" style="margin-top:8px">
            <span class="dim small">写入目标</span>
            <n-select v-model:value="memTarget" :options="memTargetOptions" size="small" style="flex:1" placeholder="选择记忆文件" />
          </div>
          <div class="mem-row" style="margin-top:8px">
            <span class="dim small">格式模板</span>
            <n-select v-model:value="memTplKey" :options="MEM_TEMPLATES.map((m) => ({ label: m.label, value: m.key }))" size="small" style="flex:1" />
          </div>
          <n-input v-if="memTplKey === 'custom'" v-model:value="memTplCustom" type="textarea" placeholder="自定义模板，支持占位符 {date} {title} {summary} {source}" :autosize="{ minRows: 2, maxRows: 5 }" style="margin-top:8px" />
          <div v-else class="dim small mono" style="margin-top:8px; white-space: pre-wrap;">→ {{ memTplText.replace('{date}', '2026-10-07').replace('{title}', '标题').replace('{summary}', '摘要内容').replace('{source}', '工具「会话」') }}</div>
          <div v-if="!memTargets.length" class="dim small" style="margin-top:8px">没有可写回的记忆文件（各工具记忆页签下才有可写目标）。</div>
          <div v-if="memDiff" class="mem-diff">
            <template v-for="(l, i) in memDiff" :key="i">
              <div v-if="l.gap" class="dl-gap">…（省略 {{ l.gap }} 行相同内容）</div>
              <div v-else class="dl" :class="l.op">{{ l.op === 'add' ? '+' : l.op === 'del' ? '-' : ' ' }} {{ l.text }}</div>
            </template>
          </div>
          <div v-if="memConflict" class="mem-warn">⚠ 该文件在扫描后被外部修改过——写入会被拒绝，请先到总览页重新扫描。</div>
          <div v-if="!memAllowWrite" class="dim small" style="margin-top:6px">写回开关未开启（walle write-enable）——可先预览 diff，写入需要开启写回。</div>
        </template>

        <n-input v-model:value="distillBody" type="textarea" :placeholder="distillProduct === 'memory' ? '记忆条目内容（{summary} 占位符引用此内容）' : '正文（Markdown）'" :autosize="{ minRows: 6, maxRows: 14 }" style="margin-top:8px" />
        <div class="dim small" style="margin-top:8px" v-if="!llmConfigured">未配置大模型（设置页可配 OpenAI 兼容接口）——当前为手动提炼模式，直接编辑上方正文即可。</div>
        <div class="modal-act">
          <n-button v-if="llmConfigured" size="tiny" round type="info" secondary :loading="llmGenerating" :disabled="!distillSel.length" @click="aiSummarize">✦ AI 生成摘要</n-button>
          <template v-if="distillProduct === 'memory'">
            <n-button size="tiny" round :loading="memPreviewing" :disabled="memTarget == null || !distillBody.trim()" @click="previewMemDiff">预览 diff</n-button>
            <n-button size="tiny" round @click="distillOpen = false">取消</n-button>
            <n-button size="tiny" round type="primary" :loading="memWriting" :disabled="memTarget == null || !distillBody.trim() || !distillTitle.trim()" @click="writeMemory">写入记忆</n-button>
          </template>
          <template v-else>
            <n-button size="tiny" round @click="distillOpen = false">取消</n-button>
            <n-button size="tiny" round type="primary" :loading="distillSaving" :disabled="!distillSel.length || !distillTitle.trim()" @click="saveDistill">存入知识库</n-button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page { margin: -24px -40px -56px; }
/* 52px Tab 栏 */
.toolbar {
  height: 52px; display: flex; gap: 6px; align-items: center;
  padding: 0 14px; position: sticky; top: 0; z-index: 20;
}
.tab {
  display: flex; gap: 7px; align-items: center; height: 36px;
  background: transparent; border: none; border-radius: 9px;
  padding: 0 12px; cursor: pointer; color: var(--text); font-size: 13px; font-weight: 500;
}
.tab:hover { background: rgba(0, 0, 0, .05); }
.tab.on { background: var(--accent); color: #fff; }
.tab-logo { width: 18px; height: 18px; border-radius: 4px; object-fit: contain; background: #fff; }
.tab-dot {
  width: 18px; height: 18px; border-radius: 50%; flex-shrink: 0;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: #fff;
}
.tab-n { color: var(--dim); font-size: 12px; }
.tab.on .tab-n { color: rgba(255, 255, 255, .8); }
.flex1 { flex: 1; }
/* 三区 */
.body { display: flex; gap: 0; align-items: stretch; height: calc(100vh - 52px - 2px); }
.list { flex-shrink: 0; display: flex; flex-direction: column; border-radius: 0; border: none; border-right: 1px solid var(--border); box-shadow: none; overflow: hidden; }
.list-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px 4px; }
.list-search { padding: 6px 14px 10px; border-bottom: 1px solid var(--border); }
.list-scroll { flex: 1; overflow-y: auto; padding: 8px; }
.s-item { border-radius: 10px; padding: 9px 11px; cursor: pointer; margin-bottom: 2px; }
.s-item:hover { background: var(--bg); }
.s-item.sel { background: rgba(0, 113, 227, .1); outline: 1.5px solid var(--accent); }
.s-top { display: flex; justify-content: space-between; font-size: 11.5px; }
.s-title { font-weight: 600; font-size: 13px; margin: 2px 0; word-break: break-all; }
.s-path { font-size: 11px; word-break: break-all; }
.resizer { width: 5px; cursor: col-resize; flex-shrink: 0; background: transparent; }
.resizer:hover, .resizer:active { background: rgba(0, 113, 227, .25); }
/* 详情 */
.detail { flex: 1; min-width: 0; display: flex; flex-direction: column; border-radius: 0; border: none; box-shadow: none; overflow: hidden; }
.d-head { display: flex; gap: 12px; align-items: center; padding: 12px 18px 8px; }
.d-title { font-size: 17px; font-weight: 700; flex: 1; min-width: 0; word-break: break-all; }
.d-tags { display: flex; gap: 5px; flex-wrap: wrap; }
.d-actions { display: flex; gap: 2px; }
.d-tabs { display: flex; gap: 2px; padding: 0 14px; position: sticky; top: 0; z-index: 10; }
.d-tab {
  background: transparent; border: none; padding: 8px 14px; cursor: pointer;
  font-size: 13px; color: var(--dim); border-radius: 8px 8px 0 0; border-bottom: 2px solid transparent;
}
.d-tab:hover { color: var(--text); }
.d-tab.on { color: var(--accent); border-bottom-color: var(--accent); font-weight: 600; }
.d-body { flex: 1; overflow-y: auto; padding: 16px 22px 40px; }
/* 消息行：头像 + 头部 + 气泡 */
.msg-row { display: flex; gap: 11px; margin-bottom: 18px; }
.m-avatar {
  width: 24px; height: 24px; border-radius: 7px; flex-shrink: 0; margin-top: 2px;
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; box-shadow: 0 1px 3px rgba(0, 0, 0, .12);
}
/* 工具 logo 多为黑底透明 PNG（Cursor/OpenAI 等），直接贴深色头像会糊成黑块——
   统一垫白色内圆片：外环保持助手深色身份，logo 任何底色都清晰 */
.m-avatar img {
  width: calc(100% - 6px); height: calc(100% - 6px); margin: 3px;
  border-radius: 4.5px; background: #fff; object-fit: contain;
}
.m-main { flex: 1; min-width: 0; }
.m-head { display: flex; gap: 8px; align-items: baseline; margin-bottom: 5px; }
.m-name { font-size: 12.5px; font-weight: 700; letter-spacing: .3px; }
.m-time { font-size: 11.5px; }
.m-copy {
  margin-left: auto; cursor: pointer; color: var(--dim); font-size: 12px;
  opacity: 0; transition: opacity .12s; padding: 0 4px; border-radius: 4px;
}
.m-copy:hover { color: var(--accent); background: rgba(0, 113, 227, .08); }
.msg-row:hover .m-copy { opacity: 1; }
.msg { border-radius: 12px; padding: 11px 15px; white-space: pre-wrap; word-break: break-word; font-size: 13.5px; position: relative; overflow: hidden; }
.msg.clamped { -webkit-mask-image: linear-gradient(to bottom, #000 78%, transparent 99%); mask-image: linear-gradient(to bottom, #000 78%, transparent 99%); max-height: 560px; }
.fold-btn {
  display: inline-flex; align-items: center; gap: 4px; margin-top: 6px;
  background: var(--card-solid); border: 1px solid var(--border); border-radius: 100px;
  padding: 3px 14px; font-size: 12px; color: var(--accent); cursor: pointer; transition: all .15s;
}
.fold-btn:hover { border-color: var(--accent); box-shadow: var(--shadow); }
/* 用户消息锚点导航 */
.msgs-wrap { display: flex; gap: 12px; align-items: flex-start; }
.msgs-flow { flex: 1; min-width: 0; }
.msg-row { scroll-margin-top: 64px; }
.anchor-nav {
  width: 190px; flex-shrink: 0; position: sticky; top: 6px;
  max-height: calc(100vh - 340px); overflow-y: auto;
  background: rgba(255, 255, 255, .82); backdrop-filter: blur(14px);
  border: 1px solid var(--border); border-radius: 12px; padding: 8px;
  box-shadow: var(--shadow);
}
.an-head { font-weight: 700; padding: 4px 8px 8px; }
.an-item {
  display: flex; gap: 7px; align-items: baseline; width: 100%;
  background: transparent; border: none; border-radius: 8px;
  padding: 5px 8px; cursor: pointer; text-align: left; font-size: 12px; color: var(--text);
}
.an-item:hover { background: var(--bg); }
.an-item.on { background: rgba(0, 113, 227, .12); }
.an-idx {
  flex-shrink: 0; width: 16px; height: 16px; border-radius: 50%;
  background: rgba(0, 113, 227, .14); color: var(--accent);
  font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center;
  align-self: center;
}
.an-item.on .an-idx { background: var(--accent); color: #fff; }
.an-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 锚点定位闪烁 */
.msg-row.anchor-flash .msg { outline: 2px solid var(--accent); border-radius: 12px; transition: outline-color 1s; }
.msg.user { background: rgba(0, 113, 227, .09); border: 1px solid rgba(0, 113, 227, .15); }
.msg.assistant { background: var(--card-solid); border: 1px solid var(--border); box-shadow: var(--shadow); }
/* Markdown 渲染（assistant 消息）：块级排版覆盖 pre-wrap */
.msg.md { white-space: normal; line-height: 1.6; }
.msg.md > :first-child { margin-top: 0; }
.msg.md > :last-child { margin-bottom: 0; }
.msg.md p { margin: 0 0 8px; }
.msg.md h1, .msg.md h2, .msg.md h3, .msg.md h4 { margin: 14px 0 8px; line-height: 1.35; }
.msg.md h1 { font-size: 17px; } .msg.md h2 { font-size: 15.5px; } .msg.md h3 { font-size: 14.5px; } .msg.md h4 { font-size: 13.5px; }
.msg.md ul, .msg.md ol { margin: 6px 0; padding-left: 22px; }
.msg.md li { margin: 2px 0; }
.msg.md li > p { margin: 0; }
.msg.md code { background: rgba(0, 0, 0, .06); padding: 1px 5px; border-radius: 5px; font-size: 12.5px; font-family: ui-monospace, Menlo, Consolas, 'Courier New', monospace; }
.msg.md pre { background: #f6f6f7; border: 1px solid var(--border); border-radius: 9px; padding: 10px 12px; overflow-x: auto; margin: 8px 0; }
.msg.md pre code { background: none; padding: 0; font-size: 12px; line-height: 1.5; }
.msg.md blockquote { border-left: 3px solid var(--border); margin: 8px 0; padding: 2px 12px; color: var(--dim); }
.msg.md table { border-collapse: collapse; margin: 8px 0; display: block; overflow-x: auto; max-width: 100%; }
.msg.md th, .msg.md td { border: 1px solid var(--border); padding: 4px 10px; font-size: 12.5px; text-align: left; }
.msg.md th { background: rgba(0, 0, 0, .03); }
.msg.md a { color: var(--accent); text-decoration: none; }
.msg.md a:hover { text-decoration: underline; }
.msg.md hr { border: none; border-top: 1px solid var(--border); margin: 12px 0; }
.msg.developer, .msg.system { background: var(--code-bg); border: 1px dashed var(--border); color: var(--dim); font-size: 12.5px; }
.msg.tool { background: #fffbe8; border: 1px solid #f0e2ac; font-size: 12.5px; }
/* 思考页签：内在独白——紫色只在此处出现 */
.think-summary { margin-bottom: 10px; }
.think-row { scroll-margin-top: 64px; margin-bottom: 10px; }
.think-card {
  background: #f9f6fd; border: 1px solid #e6dcf5; border-left: 3px solid #7d5bd0;
  border-radius: 10px; padding: 9px 14px 10px; cursor: pointer;
  transition: box-shadow .15s, border-color .15s;
}
.think-card:hover { border-color: #cbb6ea; box-shadow: 0 1px 6px rgba(125, 91, 208, .12); }
.think-head { display: flex; gap: 8px; align-items: baseline; }
.think-idx {
  font-family: ui-monospace, Menlo, Consolas, monospace;
  font-size: 11px; font-weight: 700; color: #7d5bd0; letter-spacing: .5px;
}
.think-title { font-size: 12.5px; font-weight: 700; color: #5b4394; }
.think-chars { margin-left: auto; font-size: 11px; }
.think-chev { color: #7d5bd0; font-size: 11px; transition: transform .15s; }
.think-card.open .think-chev { transform: rotate(180deg); }
.think-body {
  margin-top: 6px; white-space: pre-wrap; word-break: break-word;
  font-size: 12.5px; line-height: 1.65; color: #4a4550;
}
.think-body.clamped {
  max-height: 300px; overflow: hidden;
  -webkit-mask-image: linear-gradient(to bottom, #000 70%, transparent 99%); mask-image: linear-gradient(to bottom, #000 70%, transparent 99%);
}
.think-more { display: block; font-size: 11px; color: #7d5bd0; margin: 4px 0 0 16px; opacity: .8; }
.think-nav .an-head { color: #5b4394; }
.think-nav .an-item.on { background: rgba(125, 91, 208, .12); }
.think-idx-dot { width: 24px; border-radius: 6px !important; background: rgba(125, 91, 208, .14); color: #7d5bd0 !important; }
/* 概览 */
.overview { max-width: 720px; }
.ov-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 24px; }
.ov-item { background: var(--bg); border-radius: 10px; padding: 10px 14px; }
.ov-item .mono { margin-top: 2px; word-break: break-all; }
.raw { background: var(--code-bg); border: 1px solid var(--border); border-radius: 10px; padding: 14px; font: 11.5px/1.5 "SF Mono",ui-monospace,Consolas,monospace; white-space: pre; overflow: auto; max-height: calc(100vh - 300px); margin: 0; }
.usage-block { margin-top: 14px; }
.ub-head { margin-bottom: 6px; }
.usage-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; }
.modal-mask { position: fixed; inset: 0; background: rgba(0, 0, 0, .3); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 720px; max-width: 94vw; max-height: 86vh; overflow: auto; padding: 16px 20px; }
.modal-act { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; }
.distill-list { max-height: 300px; overflow-y: auto; margin-top: 10px; border: 1px solid var(--border); border-radius: 10px; padding: 4px; overscroll-behavior: contain; }
.distill-item { display: flex; gap: 8px; align-items: flex-start; padding: 6px 8px; border-radius: 8px; cursor: pointer; }
.distill-item:hover { background: var(--bg); }
.distill-text { flex: 1; min-width: 0; font-size: 12px; line-height: 1.5; color: var(--text); }
/* 记忆条目写回 */
.mem-row { display: flex; gap: 10px; align-items: center; }
.mem-diff { margin-top: 10px; max-height: 220px; overflow: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--code-bg); font: 11.5px/1.6 "SF Mono", ui-monospace, Consolas, monospace; padding: 8px 0; overscroll-behavior: contain; }
.mem-diff .dl { padding: 0 12px; white-space: pre-wrap; word-break: break-all; }
.mem-diff .dl.add { background: rgba(52, 199, 89, .12); color: #1d7a3a; }
.mem-diff .dl.del { background: rgba(255, 59, 48, .1); color: #b3261e; text-decoration: line-through; }
.mem-diff .dl.same { color: var(--dim); }
.mem-diff .dl-gap { padding: 0 12px; color: var(--dim); font-style: italic; }
.mem-warn { margin-top: 8px; font-size: 12px; color: #b25000; background: #fff3d6; border-radius: 8px; padding: 6px 10px; }
</style>
