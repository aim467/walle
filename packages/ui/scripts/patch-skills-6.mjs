import fs from 'node:fs';

let s = fs.readFileSync('src/views/Skills.vue', 'utf8');
const reps = [
  // n-empty × 2
  ['                  <n-empty v-else description="选择左侧文件预览" size="small" style="margin:auto" />',
   '                  <UiEmpty v-else description="选择左侧文件预览" size="small" style="margin:auto" />'],
  ['        <n-empty v-else description="从左侧选择一个技能" style="margin:auto" />',
   '        <UiEmpty v-else description="从左侧选择一个技能" style="margin:auto" />'],
  // radio-group → 分段按钮
  [
    `          <n-radio-group v-model:value="importMode" size="small" :disabled="installing">
            <n-radio-button value="url">链接（GitHub / zip / SkillHub 页面）</n-radio-button>
            <n-radio-button value="hub">SkillHub 搜索</n-radio-button>
          </n-radio-group>`,
    `          <div class="mode-seg" :class="{ disabled: installing }">
            <button type="button" class="seg" :class="{ on: importMode === 'url' }" :disabled="installing" @click="importMode = 'url'">链接（GitHub / zip / SkillHub 页面）</button>
            <button type="button" class="seg" :class="{ on: importMode === 'hub' }" :disabled="installing" @click="importMode = 'hub'">SkillHub 搜索</button>
          </div>`,
  ],
  // URL 输入 + 发现按钮
  [
    `          <n-input
            v-model:value="importUrl" placeholder="GitHub 仓库（owner/repo 或链接，可带 /tree/ 子目录）、skillhub.cn/skills/<slug> 或任意 zip 直链"
            size="small" :disabled="discovering || installing" @keydown.enter="discoverSkills"
          />
          <n-button size="small" type="primary" :loading="discovering" :disabled="installing" @click="discoverSkills">发现技能</n-button>`,
    `          <UiInput
            v-model:value="importUrl" placeholder="GitHub 仓库（owner/repo 或链接，可带 /tree/ 子目录）、skillhub.cn/skills/<slug> 或任意 zip 直链"
            :disabled="discovering || installing" @keydown.enter="discoverSkills"
          />
          <UiButton :loading="discovering" :disabled="installing" @click="discoverSkills">发现技能</UiButton>`,
  ],
  // Hub 输入 + 排序 + 按钮
  [
    `          <n-input
            v-model:value="hubKeyword" placeholder="搜索 SkillHub 技能市场（中文全文）" size="small" :disabled="installing" @keydown.enter="searchHub"
          />`,
    `          <UiInput
            v-model:value="hubKeyword" placeholder="搜索 SkillHub 技能市场（中文全文）" :disabled="installing" @keydown.enter="searchHub"
          />`,
  ],
  ['          <n-select v-model:value="hubSort" :options="hubSortOptions" size="small" class="hub-sort" :disabled="installing" />',
   '          <UiSelect v-model:value="hubSort" :options="hubSortOptions" class="hub-sort" :disabled="installing" />'],
  ['          <n-button size="small" type="primary" :loading="hubSearching" :disabled="installing" @click="searchHub">搜索</n-button>',
   '          <UiButton :loading="hubSearching" :disabled="installing" @click="searchHub">搜索</UiButton>'],
  // URL 候选
  [
    `            <n-checkbox-group v-if="importMode === 'url'" v-model:value="picked">
              <div v-for="c in candidates" :key="c.path" class="cand-row">
                <n-checkbox :value="c.path" :label="c.name" />
                <span class="cand-desc dim">{{ c.description ?? '（无描述）' }}</span>
              </div>
            </n-checkbox-group>`,
    `            <div v-if="importMode === 'url'">
              <div v-for="c in candidates" :key="c.path" class="cand-row">
                <label class="cand-label"><UiCheckbox :checked="picked.includes(c.path)" @update:checked="(on: boolean) => toggleIn(picked, c.path, on)" />{{ c.name }}</label>
                <span class="cand-desc dim">{{ c.description ?? '（无描述）' }}</span>
              </div>
            </div>`,
  ],
  // Hub 候选
  [
    `            <n-checkbox-group v-else v-model:value="hubPicked">
              <div v-for="c in hubResults" :key="c.slug" class="cand-row">
                <n-checkbox :value="c.slug">
                  <span class="hub-name">{{ c.name }}</span>
                  <n-tag v-if="c.verified" size="tiny" type="success" :bordered="false">认证</n-tag>
                  <span class="dim small">v{{ c.version }} · {{ c.downloads }} 下载</span>
                </n-checkbox>
                <span class="cand-desc dim">{{ c.description ?? '' }}</span>
              </div>
            </n-checkbox-group>`,
    `            <div v-else>
              <div v-for="c in hubResults" :key="c.slug" class="cand-row">
                <label class="cand-label"><UiCheckbox :checked="hubPicked.includes(c.slug)" @update:checked="(on: boolean) => toggleIn(hubPicked, c.slug, on)" /><span class="hub-name">{{ c.name }}</span><UiBadge v-if="c.verified" type="success">认证</UiBadge><span class="dim small">v{{ c.version }} · {{ c.downloads }} 下载</span></label>
                <span class="cand-desc dim">{{ c.description ?? '' }}</span>
              </div>
            </div>`,
  ],
  // 接入矩阵
  ['            <n-checkbox v-model:checked="targetState[t.tool].on" />',
   '            <UiCheckbox v-model:checked="targetState[t.tool].on" />'],
  [
    `            <n-select
              v-model:value="targetState[t.tool].mode" size="tiny"
              :disabled="!targetState[t.tool].on || installing" class="mode-sel"
              :options="[{ label: '符号链接', value: 'link' }, { label: '目录复制', value: 'copy' }]"
            />`,
    `            <UiSelect
              v-model:value="targetState[t.tool].mode"
              :disabled="!targetState[t.tool].on || installing" class="mode-sel"
              :options="[{ label: '符号链接', value: 'link' }, { label: '目录复制', value: 'copy' }]"`
    + `\n            />`,
  ],
  ['            <n-checkbox v-model:checked="installOverwrite">覆盖同名技能</n-checkbox>',
   '            <label class="cand-label"><UiCheckbox v-model:checked="installOverwrite" />覆盖同名技能</label>'],
  // 安装按钮
  [
    `          <n-button type="primary" size="small" :loading="installing" @click="installSkills">
            安装 {{ importMode === 'hub' ? hubPicked.length : picked.length }} 个技能到共享库
          </n-button>`,
    `          <UiButton :loading="installing" @click="installSkills">
            安装 {{ importMode === 'hub' ? hubPicked.length : picked.length }} 个技能到共享库
          </UiButton>`,
  ],
  // 结果 tags
  [
    `            <n-tag size="small" :type="r.installed ? 'success' : 'error'" :bordered="false">
              {{ r.installed ? '已装入共享库' : '失败' }}
            </n-tag>
            <n-tag
              v-for="l in r.linked" :key="l.tool" size="small"
              :type="l.ok ? 'info' : 'warning'" :bordered="false"
            >
              {{ toolName(l.tool) }} · {{ l.mode === 'link' ? '链接' : '复制' }}{{ l.ok ? '' : '：' + (l.error ?? '失败') }}
            </n-tag>`,
    `            <UiBadge :type="r.installed ? 'success' : 'error'" size="small">
              {{ r.installed ? '已装入共享库' : '失败' }}
            </UiBadge>
            <UiBadge
              v-for="l in r.linked" :key="l.tool" size="small"
              :type="l.ok ? 'info' : 'warning'"
            >
              {{ toolName(l.tool) }} · {{ l.mode === 'link' ? '链接' : '复制' }}{{ l.ok ? '' : '：' + (l.error ?? '失败') }}
            </UiBadge>`,
  ],
  // 分段按钮 + cand-label 样式（若尚未存在）
  ['</style>', '.mode-seg { display: inline-flex; gap: 4px; }\n.mode-seg .seg { height: 28px; padding: 0 12px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--dim); font-size: 12px; cursor: pointer; }\n.mode-seg .seg.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }\n.mode-seg .seg:disabled { opacity: .5; cursor: not-allowed; }\n.cand-label { display: inline-flex; gap: 8px; align-items: center; font-size: 12.5px; cursor: pointer; }\n</style>'],
];
for (const [a, b] of reps) {
  if (!s.includes(a)) { console.error('MISS:', JSON.stringify(a.slice(0, 80))); process.exit(1); }
  s = s.split(a).join(b);
}
fs.writeFileSync('src/views/Skills.vue', s);
const leftover = s.match(/<n-[a-z-]+|<\/n-[a-z-]+|from 'naive-ui'/g) ?? [];
console.log('leftover naive tags:', leftover.length);
