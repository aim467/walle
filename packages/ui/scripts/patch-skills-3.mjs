import fs from 'node:fs';

let s = fs.readFileSync('src/views/Skills.vue', 'utf8');
const reps = [
  // NModal → UiDialog
  ['    <n-modal v-model:show="showImport" preset="card" title="导入技能（从互联网下载）" style="width: 660px; max-width: 92vw">',
   '    <UiDialog :open="showImport" title="导入技能（从互联网下载）" width="660px" @update:open="showImport = $event">'],
  ['      </template>\n    </n-modal>', '      </template>\n    </UiDialog>'],
  // 模式切换：radio-group → 分段按钮
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
  // Hub 搜索输入 + 按钮
  ['          <n-input\n            v-model:value="hubKeyword" placeholder="搜索 SkillHub 技能市场（中文全文）" size="small" :disabled="installing" @keydown.enter="searchHub"\n          />',
   '          <UiInput\n            v-model:value="hubKeyword" placeholder="搜索 SkillHub 技能市场（中文全文）" :disabled="installing" @keydown.enter="searchHub"\n          />'],
  ['          <n-select v-model:value="hubSort" :options="hubSortOptions" size="small" class="hub-sort" :disabled="installing" />',
   '          <UiSelect v-model:value="hubSort" :options="hubSortOptions" class="hub-sort" :disabled="installing" />'],
  ['          <n-button size="small" type="primary" :loading="hubSearching" :disabled="installing" @click="searchHub">搜索</n-button>',
   '          <UiButton :loading="hubSearching" :disabled="installing" @click="searchHub">搜索</UiButton>'],
  // URL 候选勾选
  [
    '            <n-checkbox-group v-if="importMode === \'url\'" v-model:value="picked">\n              <div v-for="c in candidates" :key="c.path" class="cand-row">\n                <n-checkbox :value="c.path" :label="c.name" />\n                <span class="cand-desc dim">{{ c.description ?? \'（无描述）\' }}</span>\n              </div>\n            </n-checkbox-group>',
    '            <div v-if="importMode === \'url\'">\n              <div v-for="c in candidates" :key="c.path" class="cand-row">\n                <label class="cand-label"><UiCheckbox :checked="picked.includes(c.path)" @update:checked="(on: boolean) => toggleIn(picked, c.path, on)" />{{ c.name }}</label>\n                <span class="cand-desc dim">{{ c.description ?? \'（无描述）\' }}</span>\n              </div>\n            </div>',
  ],
  // Hub 候选勾选
  [
    '            <n-checkbox-group v-else v-model:value="hubPicked">\n              <div v-for="c in hubResults" :key="c.slug" class="cand-row">\n                <n-checkbox :value="c.slug">\n                  <span class="hub-name">{{ c.name }}</span>\n                  <n-tag v-if="c.verified" size="tiny" type="success" :bordered="false">认证</n-tag>\n                  <span class="dim small">v{{ c.version }} · {{ c.downloads }} 下载</span>\n                </n-checkbox>\n                <span class="cand-desc dim">{{ c.description ?? \'\' }}</span>\n              </div>\n            </n-checkbox-group>',
    '            <div v-else>\n              <div v-for="c in hubResults" :key="c.slug" class="cand-row">\n                <label class="cand-label"><UiCheckbox :checked="hubPicked.includes(c.slug)" @update:checked="(on: boolean) => toggleIn(hubPicked, c.slug, on)" /><span class="hub-name">{{ c.name }}</span><UiBadge v-if="c.verified" type="success">认证</UiBadge><span class="dim small">v{{ c.version }} · {{ c.downloads }} 下载</span></label>\n                <span class="cand-desc dim">{{ c.description ?? \'\' }}</span>\n              </div>\n            </div>',
  ],
  // 接入工具矩阵
  ['            <n-checkbox v-model:checked="targetState[t.tool].on" />',
   '            <UiCheckbox v-model:checked="targetState[t.tool].on" />'],
  [
    '            <n-select\n              v-model:value="targetState[t.tool].mode" size="tiny"\n              :disabled="!targetState[t.tool].on || installing" class="mode-sel"\n              :options="[{ label: \'符号链接\', value: \'link\' }, { label: \'目录复制\', value: \'copy\' }]"\n            />',
    '            <UiSelect\n              v-model:value="targetState[t.tool].mode"\n              :disabled="!targetState[t.tool].on || installing" class="mode-sel"\n              :options="[{ label: \'符号链接\', value: \'link\' }, { label: \'目录复制\', value: \'copy\' }]"\n            />',
  ],
  ['            <n-checkbox v-model:checked="installOverwrite">覆盖同名技能</n-checkbox>',
   '            <label class="cand-label"><UiCheckbox v-model:checked="installOverwrite" />覆盖同名技能</label>'],
  // 安装按钮
  [
    '          <n-button type="primary" size="small" :loading="installing" @click="installSkills">\n            安装 {{ importMode === \'hub\' ? hubPicked.length : picked.length }} 个技能到共享库\n          </n-button>',
    '          <UiButton :loading="installing" @click="installSkills">\n            安装 {{ importMode === \'hub\' ? hubPicked.length : picked.length }} 个技能到共享库\n          </UiButton>',
  ],
  // 安装结果 tags
  [
    '            <n-tag size="small" :type="r.installed ? \'success\' : \'error\'" :bordered="false">\n              {{ r.installed ? \'已装入共享库\' : \'失败\' }}\n            </n-tag>\n            <n-tag\n              v-for="l in r.linked" :key="l.tool" size="small"\n              :type="l.ok ? \'info\' : \'warning\'" :bordered="false"\n            >\n              {{ toolName(l.tool) }} · {{ l.mode === \'link\' ? \'链接\' : \'复制\' }}{{ l.ok ? \'\' : \'：\' + (l.error ?? \'失败\') }}\n            </n-tag>',
    '            <UiBadge :type="r.installed ? \'success\' : \'error\'" size="small">\n              {{ r.installed ? \'已装入共享库\' : \'失败\' }}\n            </UiBadge>\n            <UiBadge\n              v-for="l in r.linked" :key="l.tool" size="small"\n              :type="l.ok ? \'info\' : \'warning\'"\n            >\n              {{ toolName(l.tool) }} · {{ l.mode === \'link\' ? \'链接\' : \'复制\' }}{{ l.ok ? \'\' : \'：\' + (l.error ?? \'失败\') }}\n            </UiBadge>',
  ],
  // 死 CSS + 分段按钮样式
  ['.toolbar :deep(.n-input) { --n-height: 30px; }\n', ''],
  ['</style>', '.mode-seg { display: inline-flex; gap: 4px; }\n.mode-seg .seg { height: 28px; padding: 0 12px; border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--dim); font-size: 12px; cursor: pointer; }\n.mode-seg .seg.on { background: var(--accent); border-color: var(--accent); color: #fff; font-weight: 600; }\n.mode-seg .seg:disabled { opacity: .5; cursor: not-allowed; }\n.cand-label { display: inline-flex; gap: 8px; align-items: center; font-size: 12.5px; cursor: pointer; }\n</style>'],
];
for (const [a, b] of reps) {
  if (!s.includes(a)) { console.error('MISS:', a.slice(0, 80)); process.exit(1); }
  s = s.split(a).join(b);
}
fs.writeFileSync('src/views/Skills.vue', s);
console.log('skills template part2 done');
