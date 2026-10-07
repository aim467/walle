// 会话提炼二期测试：总结文档 prompt / 知识文档构建 / 记忆条目追加逻辑（不打网络、不碰真机数据）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.WALLE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'walle-distill2-'));

import { buildSummaryPrompt, buildDistillPrompt } from '../packages/cli/dist/llm.js';
import { buildKnowledgeDoc } from '../packages/cli/dist/knowledge.js';
import { appendMemoryEntry } from '../packages/core/dist/index.js';

const turns = [
  { role: 'user', text: '帮我修复 Cursor 会话为 0 的问题' },
  { role: 'assistant', text: '双重 bug：appdata 资产未被发现 + 缺 parse 函数，已修复' },
];

test('buildSummaryPrompt：项目纪要结构与素材隔离', () => {
  const msgs = buildSummaryPrompt(turns, '修复 Cursor 会话', 'D:/work/demo');
  assert.equal(msgs.length, 2);
  assert.ok(msgs[0].content.includes('项目纪要'), 'system 提示词声明纪要任务');
  assert.ok(msgs[0].content.includes('背景与目标'), '纪要结构段落');
  assert.ok(msgs[0].content.includes('不是提给你的问题'), '素材/任务框架隔离与卡片一致');
  assert.ok(msgs[1].content.includes('D:/work/demo'), 'user 消息带项目路径');
  assert.ok(msgs[1].content.includes('<dialog>'), 'dialog 框架包裹素材');
  assert.ok(msgs[1].content.includes('【用户】'), '标注双角色');
});

test('buildSummaryPrompt：超长素材截断且不超上限', () => {
  const big = buildSummaryPrompt([{ role: 'user', text: 'x'.repeat(40000) }, { role: 'assistant', text: 'y'.repeat(40000) }], null, null);
  assert.ok(big[1].content.length < 80000);
  assert.ok(big[1].content.includes('截断'));
});

test('buildKnowledgeDoc：卡片默认类型与溯源 frontmatter', () => {
  const d = buildKnowledgeDoc({
    title: 'Cursor 会话为 0 的双重 bug',
    tags: ['坑', 'cursor'],
    text: '## 结论\n适配器漏扫 appdata。',
    source: { tool: 'zcode', assetId: 42, subId: 'abc', sessionTitle: '修复 Cursor 会话' },
  });
  assert.match(d.file, /^\d{4}-\d{2}-\d{2}-\d+-.+\.md$/, '文件名：日期-序号-slug');
  assert.ok(d.content.startsWith('---\ntitle: Cursor 会话为 0 的双重 bug\ntype: card\n'));
  assert.ok(d.content.includes('tags: [坑, cursor]'));
  assert.ok(d.content.includes('source_tool: zcode'));
  assert.ok(d.content.includes('source_asset: 42'));
  assert.ok(d.content.includes('source_sub: abc'));
  assert.ok(d.content.includes('source_title: 修复 Cursor 会话'));
  assert.ok(d.content.endsWith('## 结论\n适配器漏扫 appdata。\n'));
  assert.ok(!d.content.includes('project:'), '卡片默认无 project 行');
});

test('buildKnowledgeDoc：总结文档带 type/project', () => {
  const d = buildKnowledgeDoc({ title: 'walle 项目纪要', text: '## 主要工作\n适配器接入。', type: 'summary', project: 'D:/CodingProject/walle' });
  assert.ok(d.content.includes('type: summary'));
  assert.ok(d.content.includes('project: D:/CodingProject/walle'));
  // 非法 type 归一为 card
  const d2 = buildKnowledgeDoc({ title: 'x', text: 'y', type: 'bogus' });
  assert.ok(d2.content.includes('type: card'));
});

test('appendMemoryEntry：空文件 / 追加分隔 / 不碰已有内容', () => {
  // 空文件：只有条目本身
  assert.equal(appendMemoryEntry('', '## 2026-10-07 事项\n\n内容'), '## 2026-10-07 事项\n\n内容\n');
  assert.equal(appendMemoryEntry('   \n', '- 一行'), '- 一行\n');
  // 非空：分隔线 + 条目在末尾，已有内容（含结尾空行数量差异）被规整但文本不丢
  const cur = '# Memory Index\n\n- [a](a.md) — note\n\n\n';
  const next = appendMemoryEntry(cur, '- 2026-10-07 新条目');
  assert.ok(next.startsWith('# Memory Index\n\n- [a](a.md) — note\n'), '原内容保留且尾部空行规整');
  assert.ok(next.includes('\n---\n\n- 2026-10-07 新条目\n'), '分隔线 + 追加条目');
  // frontmatter 文件：条目追加在末尾，frontmatter 不动
  const fm = '---\ntitle: mem\n---\n\n正文\n';
  const nextFm = appendMemoryEntry(fm, '新条目');
  assert.ok(nextFm.startsWith(fm));
  assert.ok(nextFm.endsWith('\n---\n\n新条目\n'));
});
