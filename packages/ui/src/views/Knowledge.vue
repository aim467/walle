<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import UiButton from '../components/ui/Button.vue';
import UiInput from '../components/ui/Input.vue';
import UiBadge from '../components/ui/Badge.vue';
import UiEmpty from '../components/ui/Empty.vue';
import UiDialog from '../components/ui/Dialog.vue';
import UiPopconfirm from '../components/ui/Popconfirm.vue';
import UiTextarea from '../components/ui/Textarea.vue';
import { toast } from '../components/ui/toast';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';
import agentsLogo from '../assets/logos/agents.svg';
import walleMark from '../assets/walle-mark.svg';

marked.setOptions({ gfm: true, breaks: true });

/** 知识库（P5.2 会话提炼）：walle 自管的知识卡片/总结文档，来源可溯源到会话 */
interface Asset {
  id: number; tool: string; kind: string; name: string | null; path: string;
  rawFormat: string | null; contentHash: string | null; size: number | null;
  mtime: string | null; sensitive: number; status: string;
}

const toolLogos: Record<string, string> = {
  zcode: zcodeLogo, codex: openaiLogo, cursor: cursorLogo, opencode: opencodeLogo,
  workbuddy: workbuddyLogo, 'workbuddy-cn': workbuddyLogo, agents: agentsLogo, walle: walleMark,
};
const toolName = (t: string) => (t === 'walle' ? '手动创建' : t);

const items = ref<Asset[]>([]);
const q = ref('');
const tagFilter = ref<string | null>(null);
/** 文档类型筛选（提炼二期）：card=知识卡片 / summary=总结文档 */
const typeFilter = ref<'all' | 'card' | 'summary'>('all');
const selected = ref<Asset | null>(null);
const mdText = ref<string | null>(null);
const rawFull = ref('');
const frontmatter = ref<Record<string, string>>({});
const bodyText = ref('');
const editing = ref(false);
const editText = ref('');
const saving = ref(false);
const tab = ref<'read' | 'edit'>('read');

/** 新建卡片（知识库页直接创建，不带来源会话） */
const creating = ref(false);
const newTitle = ref('');
const newTags = ref('');
const newText = ref('');

function humanSize(b: number | null): string {
  if (b == null) return '-';
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1048576).toFixed(1)}MB`;
}
function fmtTime(iso: string | null): string { return iso ? iso.replace('T', ' ').slice(0, 19) : '-'; }
function mdHtml(src: string): string {
  return DOMPurify.sanitize(marked.parse(src) as string);
}

/** 简易 frontmatter 解析（title/tags/source_* 等单行键值） */
function parseFm(raw: string): { meta: Record<string, string>; body: string } {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^\[|\]$/g, '');
  }
  return { meta, body: raw.slice(m[0].length) };
}

const tagsOf = (a: Asset): string[] => (frontmatterCache.value.get(a.id)?.tags.split(',').map((x) => x.trim()).filter(Boolean) ?? []);
/** 文档类型：frontmatter type 字段，缺省 card（第一期卡片无 type） */
const typeOf = (a: Asset): 'card' | 'summary' => (frontmatterCache.value.get(a.id)?.type === 'summary' ? 'summary' : 'card');
/** tags 预解析缓存（loadAll 时从 CAS 原文提取） */
const frontmatterCache = ref(new Map<number, { tags: string; title: string; type: string; project: string }>());

const allTags = computed(() => {
  const s = new Set<string>();
  for (const a of items.value) for (const t of tagsOf(a)) s.add(t);
  return [...s].sort();
});
/** 列表/详情显示名：优先 frontmatter 标题，回退文件名 */
const displayName = (a: Asset): string => frontmatterCache.value.get(a.id)?.title || a.name || a.path;

const filtered = computed(() => {
  let list = items.value;
  if (typeFilter.value !== 'all') {
    list = list.filter((a) => typeOf(a) === typeFilter.value);
  }
  if (tagFilter.value) {
    const idSet = new Set(items.value.filter((a) => tagsOf(a).includes(tagFilter.value!)).map((a) => a.id));
    list = list.filter((a) => idSet.has(a.id));
  }
  if (q.value) {
    const s = q.value.toLowerCase();
    list = list.filter((a) => (displayName(a) ?? '').toLowerCase().includes(s) || a.path.toLowerCase().includes(s));
  }
  return list;
});
const typeCounts = computed(() => ({
  card: items.value.filter((a) => typeOf(a) === 'card').length,
  summary: items.value.filter((a) => typeOf(a) === 'summary').length,
}));

const sourceLink = computed(() => {
  const m = frontmatter.value;
  if (!m.source_asset) return null;
  return { assetId: Number(m.source_asset), subId: m.source_sub ?? '', tool: m.source_tool ?? '', title: m.source_title ?? '' };
});

async function loadAll() {
  items.value = await (await fetch('/api/assets?kind=knowledge')).json();
  // 提取 tags/type 到缓存（CAS 原文 frontmatter）
  for (const a of items.value) {
    if (frontmatterCache.value.has(a.id) || !a.contentHash) continue;
    try {
      const d = await (await fetch(`/api/source?asset=${a.id}&raw=1`)).json();
      if (d.content) {
        const m = parseFm(d.content).meta;
        frontmatterCache.value.set(a.id, { tags: m.tags ?? '', title: m.title ?? '', type: m.type ?? 'card', project: m.project ?? '' });
      }
    } catch { /* 忽略单条失败 */ }
  }
}

async function open(a: Asset) {
  selected.value = a;
  editing.value = false;
  tab.value = 'read';
  const d = await (await fetch(`/api/source?asset=${a.id}&raw=1`)).json();
  if (d.error) { mdText.value = null; frontmatter.value = {}; return; }
  const parsed = parseFm(String(d.content ?? ''));
  frontmatter.value = parsed.meta;
  bodyText.value = parsed.body;
  mdText.value = parsed.body;
  rawFull.value = String(d.content ?? '');
}

function startEdit() {
  if (!selected.value) return;
  // 编辑完整原文（含 frontmatter），否则保存会把元数据丢掉
  editText.value = rawFull.value;
  editing.value = true;
  tab.value = 'edit';
}
async function saveEdit() {
  if (!selected.value) return;
  saving.value = true;
  try {
    const r = await (await fetch('/api/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assetId: selected.value.id, content: editText.value }) })).json();
    if (r.ok) {
      editing.value = false;
      await open(selected.value);
      await loadAll();
    } else {
      toast.error('保存失败: ' + (r.reason || r.error));
    }
  } finally {
    saving.value = false;
  }
}


const deleting = ref(false);
async function deleteCard() {
  if (!selected.value || deleting.value) return;
  deleting.value = true;
  try {
    const r = await (await fetch('/api/knowledge/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetId: selected.value.id }),
    })).json();
    if (r.ok) {
      toast.success('已删除（内容副本仍在仓中，扫描可追溯）');
      selected.value = null;
      mdText.value = null;
      await loadAll();
    } else {
      toast.error('删除失败: ' + (r.error || ''));
    }
  } finally {
    deleting.value = false;
  }
}

async function createCard() {
  if (!newTitle.value.trim() || !newText.value.trim()) return;
  saving.value = true;
  try {
    const r = await (await fetch('/api/knowledge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: newTitle.value, tags: newTags.value.split(',').map((s) => s.trim()).filter(Boolean), text: newText.value }) })).json();
    if (r.ok) {
      creating.value = false;
      newTitle.value = ''; newTags.value = ''; newText.value = '';
      await loadAll();
    } else {
      toast.error('创建失败: ' + (r.error || ''));
    }
  } finally {
    saving.value = false;
  }
}

onMounted(loadAll);
</script>

<template>
  <div class="page">
    <div class="toolbar glassbar">
      <span class="tb-title">知识库</span>
      <span class="dim small">{{ filtered.length }} 条</span>
      <span class="flex1" />
      <UiButton @click="creating = true">＋ 新建卡片</UiButton>
      <UiInput v-model:value="q" placeholder="搜索知识卡片…" class="search" />
    </div>

    <div class="typerow">
      <UiButton size="sm" class="h-7 gap-1.5 px-3" :variant="typeFilter === 'all' ? 'secondary' : 'ghost'" :class="typeFilter === 'all' ? '!bg-primary/10 !text-primary !font-semibold' : ''" @click="typeFilter = 'all'">全部<span class="tchip-n">{{ items.length }}</span></UiButton>
      <UiButton size="sm" class="h-7 gap-1.5 px-3" :variant="typeFilter === 'card' ? 'secondary' : 'ghost'" :class="typeFilter === 'card' ? '!bg-primary/10 !text-primary !font-semibold' : ''" @click="typeFilter = 'card'">知识卡片<span class="tchip-n">{{ typeCounts.card }}</span></UiButton>
      <UiButton size="sm" class="h-7 gap-1.5 px-3" :variant="typeFilter === 'summary' ? 'secondary' : 'ghost'" :class="typeFilter === 'summary' ? '!bg-primary/10 !text-primary !font-semibold' : ''" @click="typeFilter = 'summary'">总结文档<span class="tchip-n">{{ typeCounts.summary }}</span></UiButton>
      <span class="tsep" />
      <UiButton size="sm" class="h-7 gap-1.5 px-3" :variant="tagFilter === null ? 'secondary' : 'ghost'" :class="tagFilter === null ? '!bg-primary/10 !text-primary !font-semibold' : ''" @click="tagFilter = null">全部标签</UiButton>
      <UiButton v-for="t in allTags" :key="t" size="sm" class="h-7 gap-1.5 px-3" :variant="tagFilter === t ? 'secondary' : 'ghost'" :class="tagFilter === t ? '!bg-primary/10 !text-primary !font-semibold' : ''" @click="tagFilter = t">
        #{{ t }}<span class="tchip-n">{{ items.filter((a) => tagsOf(a).includes(t)).length }}</span>
      </UiButton>
    </div>

    <div class="body">
      <div class="list card">
        <div class="list-scroll">
          <div
            v-for="a in filtered" :key="a.id"
            class="arow" :class="{ sel: selected?.id === a.id }" @click="open(a)"
          >
            <span class="arow-main">
              <span class="arow-name">
                <span class="arow-name-t">{{ displayName(a) }}</span>
                <span v-if="typeOf(a) === 'summary'" class="ktag ktag-sum">纪要</span>
                <span v-for="t in tagsOf(a).slice(0, 3)" :key="t" class="ktag">#{{ t }}</span>
              </span>
              <span class="dim small">{{ fmtTime(a.mtime) }} · {{ humanSize(a.size) }}<template v-if="typeOf(a) === 'summary' && frontmatterCache.get(a.id)?.project"> · {{ frontmatterCache.get(a.id)?.project }}</template></span>
            </span>
          </div>
          <UiEmpty v-if="!filtered.length" description="知识库为空——到会话页点「提炼」创建第一张卡片" style="padding:60px 0" />
        </div>
      </div>

      <div v-if="selected" class="inspector card">
        <div class="insp-head">
          <div class="insp-id">
            <div class="insp-title">{{ displayName(selected) }}</div>
            <div class="insp-sub">
              <span class="ktag" :class="{ 'ktag-sum': typeOf(selected) === 'summary' }">{{ typeOf(selected) === 'summary' ? '总结文档' : '知识卡片' }}</span>
              <span v-if="frontmatterCache.get(selected.id)?.project" class="mono">{{ frontmatterCache.get(selected.id)?.project }}</span>
              <span>{{ fmtTime(selected.mtime) }}</span>
              <span>{{ humanSize(selected.size) }}</span>
              <span v-for="t in tagsOf(selected)" :key="t" class="ktag">#{{ t }}</span>
            </div>
          </div>
          <div class="insp-act">
            <template v-if="editing">
              <UiButton variant="default" :loading="saving" @click="saveEdit">保存</UiButton>
              <UiButton variant="ghost" @click="editing = false">取消</UiButton>
            </template>
            <UiButton v-else variant="ghost" @click="startEdit">编辑</UiButton>
            <UiPopconfirm v-if="!editing" @confirm="deleteCard">
              <template #trigger>
                <UiButton variant="ghost" class="!text-destructive" :loading="deleting">删除</UiButton>
              </template>
              删除该知识卡片？内容副本仍保留在仓中可追溯。
            </UiPopconfirm>
          </div>
        </div>

        <div v-if="sourceLink" class="src-line small">
          来源会话：<span class="mono">{{ sourceLink.tool }}</span>
          <template v-if="sourceLink.title">「{{ sourceLink.title }}」</template>
          <span class="dim mono">#{{ sourceLink.assetId }}<template v-if="sourceLink.subId">/{{ sourceLink.subId.slice(0, 12) }}</template></span>
        </div>

        <div v-if="editing" class="panel edit-wrap">
          <UiTextarea v-model:value="editText" variant="bare" spellcheck="false" class="h-full min-h-0 flex-1 bg-muted p-4 font-mono text-[12px] leading-[1.55] text-foreground overflow-auto whitespace-pre" />
        </div>
        <div v-else class="panel">
          <article class="md-content" v-html="mdHtml(bodyText)"></article>
        </div>
      </div>

      <div v-else class="inspector card empty-detail">
        <UiEmpty description="选择知识卡片阅读 / 编辑" />
      </div>
    </div>

    <!-- 新建卡片 -->
    <UiDialog :open="creating" title="新建知识卡片" @update:open="creating = $event">
      <UiInput v-model:value="newTitle" placeholder="标题" class="mb-2" />
      <UiInput v-model:value="newTags" placeholder="标签（逗号分隔，如：坑, vue, api）" class="mb-2" />
      <UiTextarea v-model:value="newText" :rows="10" placeholder="正文（Markdown）" class="font-mono text-xs" />
      <template #footer>
        <UiButton variant="ghost" @click="creating = false">取消</UiButton>
        <UiButton :loading="saving" :disabled="!newTitle.trim() || !newText.trim()" @click="createCard">保存</UiButton>
      </template>
    </UiDialog>
  </div>
</template>

<style scoped>
.page { margin: -24px -40px -56px; height: 100vh; display: flex; flex-direction: column; overflow: hidden; }
.toolbar { flex: 0 0 auto; height: 48px; display: flex; gap: 12px; align-items: center; padding: 0 16px; }
.tb-title { font-size: 14px; font-weight: 700; }
.search { flex: 0 0 auto; width: 240px; }
.flex1 { flex: 1; }
.typerow { flex: 0 0 auto; height: 42px; display: flex; gap: 4px; align-items: center; padding: 0 16px; background: var(--card-solid); border-bottom: 1px solid var(--border); overflow-x: auto; }
.typerow::-webkit-scrollbar { height: 0; }
.tchip { display: inline-flex; gap: 8px; align-items: center; height: 28px; padding: 0 12px; border: none; border-radius: 8px; background: transparent; color: var(--dim); font-size: 12.5px; cursor: pointer; white-space: nowrap; }
.tchip:hover { background: rgba(0, 0, 0, .05); color: var(--text); }
.tchip.on { background: rgba(0, 113, 227, .1); color: var(--accent); font-weight: 600; }
.tchip-n { font-size: 11px; opacity: .75; }

.body { flex: 1; min-height: 0; display: flex; gap: 12px; padding: 12px 16px 16px; overflow: hidden; }
.list { flex: 1 1 36%; min-width: 280px; display: flex; flex-direction: column; overflow: hidden; }
.list-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; overscroll-behavior: contain; }
.arow { display: flex; gap: 12px; align-items: center; padding: 12px; border-radius: 10px; border: 1px solid transparent; cursor: pointer; }
.arow:hover { background: var(--bg); }
.arow.sel { background: rgba(0, 113, 227, .08); border-color: var(--accent); }
.arow-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.arow-name { font-size: 13.5px; font-weight: 600; display: flex; gap: 8px; align-items: center; min-width: 0; flex-wrap: wrap; }
.arow-name-t { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ktag { flex-shrink: 0; font-size: 10px; font-weight: 500; color: var(--accent); background: rgba(0, 113, 227, .08); border-radius: 4px; padding: 0 4px; line-height: 14px; }
.ktag-sum { color: #7d5bd0; background: rgba(125, 91, 208, .1); }
.tsep { flex: 0 0 1px; height: 18px; background: var(--border); margin: 0 8px; }

.inspector { flex: 1 1 64%; min-width: 360px; display: flex; flex-direction: column; overflow: hidden; }
.empty-detail { align-items: center; justify-content: center; }
.insp-head { flex: 0 0 auto; display: flex; gap: 12px; align-items: flex-start; padding: 12px 16px; border-bottom: 1px solid var(--border); }
.insp-id { flex: 1; min-width: 0; }
.insp-title { font-size: 15px; font-weight: 700; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.insp-sub { display: flex; flex-wrap: wrap; gap: 2px 8px; font-size: 12px; color: var(--dim); line-height: 1.6; }
.insp-act { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
.src-line { flex: 0 0 auto; padding: 8px 16px; border-bottom: 1px solid var(--border); color: var(--text); }
.panel { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.md-content { padding: 22px 30px; line-height: 1.7; max-width: 1100px; margin: auto; font-size: 13.5px; color: var(--text); }
.md-content :deep(h1) { font-size: 24px; margin: 0 0 14px; font-weight: 700; }
.md-content :deep(h2) { font-size: 18px; margin: 24px 0 10px; font-weight: 700; }
.md-content :deep(h3) { font-size: 14px; margin: 18px 0 8px; font-weight: 600; }
.md-content :deep(h4) { font-size: 13.5px; margin: 14px 0 6px; font-weight: 600; }
.md-content :deep(p), .md-content :deep(li) { color: var(--text); }
.md-content :deep(li) { margin: 6px 0; }
.md-content :deep(ul), .md-content :deep(ol) { padding-left: 22px; }
.md-content :deep(a) { color: var(--accent); text-decoration: none; border-bottom: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); }
.md-content :deep(strong) { font-weight: 600; }
.md-content :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 18px 0; }
.md-content :deep(blockquote) {
  margin: 12px 0; padding: 4px 14px; color: var(--dim);
  background: var(--muted); border-left: 3px solid var(--accent); border-radius: 0 8px 8px 0;
}
.md-content :deep(table) { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 12.5px; }
.md-content :deep(th), .md-content :deep(td) { border: 1px solid var(--border); padding: 6px 10px; text-align: left; }
.md-content :deep(th) { background: var(--muted); font-weight: 600; }
.md-content :deep(img) { max-width: 100%; border-radius: 8px; }
.md-content :deep(pre) { font-family: "SF Mono", ui-monospace, Consolas, monospace; background: var(--code-bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; overflow: auto; font-size: 12px; color: var(--text); }
.md-content :deep(code) { font-family: "SF Mono", ui-monospace, Consolas, monospace; font-size: 12px; background: var(--muted); color: var(--text); padding: 1px 5px; border-radius: 4px; }
.md-content :deep(pre code) { background: transparent; color: inherit; padding: 0; border-radius: 0; }
.edit-wrap { display: flex; flex-direction: column; }
.code { flex: 1; min-height: 0; width: 100%; margin: 0; background: var(--code-bg); border: none; padding: 12px 16px; font: 12px/1.55 "SF Mono", ui-monospace, Consolas, monospace; white-space: pre; overflow: auto; color: var(--text); }
.code.edit { resize: none; outline: none; }


@media (max-width: 1024px) {
  .body { flex-direction: column; overflow-y: auto; }
  .list, .inspector { flex: none; width: 100%; min-width: 0; }
  .list { max-height: 46vh; }
  .inspector { max-height: 70vh; }
}
</style>
