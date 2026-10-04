<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { NCard, NInput, NButton, NTag, useMessage } from 'naive-ui';
import openaiLogo from '../assets/logos/openai.png';
import cursorLogo from '../assets/logos/cursor.png';
import opencodeLogo from '../assets/logos/opencode.png';
import zcodeLogo from '../assets/logos/zcode.png';
import workbuddyLogo from '../assets/logos/workbuddy.svg';

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

const toolLabel: Record<string, string> = { codex: 'Codex CLI', zcode: 'ZCode', cursor: 'Cursor', opencode: 'opencode', workbuddy: 'WorkBuddy' };
const toolLogos: Record<string, string> = { zcode: zcodeLogo, codex: openaiLogo, cursor: cursorLogo, opencode: opencodeLogo, workbuddy: workbuddyLogo };
const toolOrder = ['codex', 'zcode', 'cursor', 'opencode', 'workbuddy'];

const data = ref<SettingsData | null>(null);
const edit = ref<Record<string, string>>({});
const saving = ref(false);
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
      message.success(d.hint ?? '已保存');
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
</script>

<template>
  <div class="page-head">
    <div>
      <h2>设置</h2>
      <div class="dim small">自定义各 AI 工具的配置路径 · 保存到 ~/.walle/config.json · 修改后需重新执行 walle scan 生效</div>
    </div>
    <n-button type="primary" :loading="saving" :disabled="!dirty" @click="save">保存修改</n-button>
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
    清空输入框即恢复默认路径。路径不存在的工具在扫描时会被跳过（与未安装一致）。
  </div>
</template>

<style scoped>
.page-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 20px; }
.tool-card { margin-bottom: 14px; }
.tool-head { display: flex; align-items: center; gap: 8px; }
.tool-logo { width: 18px; height: 18px; object-fit: contain; }
.root-row { display: flex; gap: 16px; align-items: center; padding: 10px 0; }
.root-row + .root-row { border-top: 1px solid var(--border); }
.root-info { flex: 1; min-width: 0; }
.root-label { display: flex; align-items: center; gap: 8px; font-weight: 500; }
.root-row .n-input { width: 380px; flex-shrink: 0; }
</style>
