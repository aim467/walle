import fs from 'node:fs';

let s = fs.readFileSync('src/views/Skills.vue', 'utf8');
const reps = [
  // 搜索框
  ['      <n-input v-model:value="q" placeholder="搜索技能…" size="small" round clearable class="search" />',
   '      <UiInput v-model:value="q" placeholder="搜索技能…" class="search" />'],
  // 状态行动作按钮
  ['      <n-button size="tiny" round secondary @click="notYet(\'新建技能\')">＋ 新建技能</n-button>\n      <n-button size="tiny" round secondary @click="openImport">↓ 导入技能</n-button>',
   '      <UiButton variant="secondary" @click="notYet(\'新建技能\')">＋ 新建技能</UiButton>\n      <UiButton variant="secondary" @click="openImport">↓ 导入技能</UiButton>'],
  // 排序下拉
  ['          <n-select v-model:value="sortBy" :options="sortOptions" size="medium" class="sortsel" />',
   '          <UiSelect v-model:value="sortBy" :options="sortOptions" class="sortsel" />'],
  // 列表状态标签
  [
    '                <n-tag size="tiny" round :bordered="false" :type="statusMeta[groupStatus(s)].type">\n                  {{ statusMeta[groupStatus(s)].label }}\n                </n-tag>',
    '                <UiBadge :type="statusMeta[groupStatus(s)].type">\n                  {{ statusMeta[groupStatus(s)].label }}\n                </UiBadge>',
  ],
  ['          <n-empty v-if="!filtered.length && !loading" description="没有匹配的技能" size="small" style="padding:36px 0" />',
   '          <UiEmpty v-if="!filtered.length && !loading" description="没有匹配的技能" size="small" style="padding:36px 0" />'],
  // 详情头：编辑 + dropdown
  [
    '              <n-button size="tiny" round secondary @click="notYet(\'编辑技能\')">编辑</n-button>\n              <n-dropdown trigger="click" :options="moreOptions" @select="onMore">\n                <n-button size="tiny" round secondary>···</n-button>\n              </n-dropdown>',
    '              <UiButton variant="secondary" @click="notYet(\'编辑技能\')">编辑</UiButton>\n              <UiDropdownMenu :options="moreOptions" @select="onMore">\n                <template #trigger>\n                  <UiButton variant="secondary">···</UiButton>\n                </template>\n              </UiDropdownMenu>',
  ],
  // SKILL.md 页签的小标签与按钮
  ['                    <n-tag size="small" type="info" :bordered="false">Markdown</n-tag>',
   '                    <UiBadge type="info" size="small">Markdown</UiBadge>'],
  ['                    <n-button size="tiny" secondary @click="notYet(\'编辑\')">编辑</n-button>\n                    <n-button size="tiny" secondary @click="mdText && copyText(mdText)">复制</n-button>',
   '                    <UiButton variant="secondary" @click="notYet(\'编辑\')">编辑</UiButton>\n                    <UiButton variant="secondary" @click="mdText && copyText(mdText)">复制</UiButton>'],
  ['              <n-button size="tiny" round secondary :loading="openingLocal" @click="openLocal">⌖ 在本地打开</n-button>',
   '              <UiButton variant="secondary" :loading="openingLocal" @click="openLocal">⌖ 在本地打开</UiButton>'],
  ['                      <n-button size="tiny" quaternary title="收起文件树，预览占满全宽" @click="treeCollapsed = true">«</n-button>',
   '                      <UiButton variant="ghost" title="收起文件树，预览占满全宽" @click="treeCollapsed = true">«</UiButton>'],
  ['                      <n-button size="tiny" quaternary @click="preview = null">关闭</n-button>',
   '                      <UiButton variant="ghost" @click="preview = null">关闭</UiButton>'],
  ['                  <n-empty v-else description="选择左侧文件预览" size="small" style="margin:auto" />',
   '                  <UiEmpty v-else description="选择左侧文件预览" size="small" style="margin:auto" />'],
  ['        <n-empty v-else description="从左侧选择一个技能" style="margin:auto" />',
   '        <UiEmpty v-else description="从左侧选择一个技能" style="margin:auto" />'],
];
for (const [a, b] of reps) {
  if (!s.includes(a)) { console.error('MISS:', a.slice(0, 80)); process.exit(1); }
  s = s.split(a).join(b);
}
fs.writeFileSync('src/views/Skills.vue', s);
console.log('skills template part1 done');
