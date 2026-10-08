// 大模型模块测试（OpenAI 兼容调用层；不打真网络——只测配置校验/脱敏/prompt 构建）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.WALLE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'walle-llm-'));

import { validateLlmInput, maskApiKey, buildDistillPrompt } from '../packages/cli/dist/llm.js';
import { readWalleConfig, writeWalleConfig } from '../packages/core/dist/index.js';

test('validateLlmInput：地址规整与必填校验', () => {
  const ok = validateLlmInput({ baseUrl: 'http://127.0.0.1:11434/v1/', apiKey: ' ', model: ' qwen3:8b ' });
  assert.ok(!('error' in ok));
  assert.equal(ok.cfg.baseUrl, 'http://127.0.0.1:11434/v1', '去掉尾部斜杠');
  assert.equal(ok.cfg.model, 'qwen3:8b');
  assert.equal(ok.cfg.apiKey, '', '空白 key 归一为空');

  assert.ok('error' in validateLlmInput({ baseUrl: '', model: 'm' }), '缺 baseUrl 报错');
  assert.ok('error' in validateLlmInput({ baseUrl: 'ftp://x', model: 'm' }), '非 http(s) 拒绝');
  assert.ok('error' in validateLlmInput({ baseUrl: 'http://x' }), '缺 model 报错');
});

test('validateLlmInput：生成参数（temperature / maxTokens / topP）校验与规整', () => {
  // 数字或数字字符串均可，转成 number 写入
  const ok = validateLlmInput({ baseUrl: 'http://x', model: 'm', temperature: '0.7', maxTokens: '2048', topP: 0.9 });
  assert.ok(!('error' in ok));
  assert.equal(ok.cfg.temperature, 0.7);
  assert.equal(ok.cfg.maxTokens, 2048);
  assert.equal(ok.cfg.topP, 0.9);

  // 留空 → undefined（不写配置，回退默认）
  const blank = validateLlmInput({ baseUrl: 'http://x', model: 'm', temperature: '', maxTokens: '', topP: '' });
  assert.ok(!('error' in blank));
  assert.equal(blank.cfg.temperature, undefined);
  assert.equal(blank.cfg.maxTokens, undefined);
  assert.equal(blank.cfg.topP, undefined);

  // 越界 / 非法值
  assert.ok('error' in validateLlmInput({ baseUrl: 'http://x', model: 'm', temperature: 3 }), 'temperature > 2 拒绝');
  assert.ok('error' in validateLlmInput({ baseUrl: 'http://x', model: 'm', temperature: 'abc' }), 'temperature 非数字拒绝');
  assert.ok('error' in validateLlmInput({ baseUrl: 'http://x', model: 'm', maxTokens: 0 }), 'maxTokens 必须为正');
  assert.ok('error' in validateLlmInput({ baseUrl: 'http://x', model: 'm', maxTokens: 1.5 }), 'maxTokens 必须为整数');
  assert.ok('error' in validateLlmInput({ baseUrl: 'http://x', model: 'm', topP: 0 }), 'topP 必须 > 0');
  assert.ok('error' in validateLlmInput({ baseUrl: 'http://x', model: 'm', topP: 1.5 }), 'topP 必须 <= 1');
});

test('maskApiKey：脱敏不回显完整 key', () => {
  assert.equal(maskApiKey('sk-abcdef1234567890'), 'sk-a****7890');
  assert.equal(maskApiKey('short'), '****');
  assert.equal(maskApiKey(''), '');
});

test('buildDistillPrompt：双角色素材 + 超长截断', () => {
  const turns = [
    { role: 'user', text: '帮我看看 cursor 会话为什么是 0' },
    { role: 'assistant', text: '双重 bug：appdata 资产未被发现 + 缺 parse 函数' },
  ];
  const msgs = buildDistillPrompt(turns, '修复 Cursor 会话');
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.ok(msgs[1].content.includes('修复 Cursor 会话'), '应带会话标题');
  assert.ok(msgs[1].content.includes('【用户】'), '应标注角色');

  const big = buildDistillPrompt([{ role: 'user', text: 'x'.repeat(40000) }, { role: 'assistant', text: 'y'.repeat(40000) }], null);
  assert.ok(big[1].content.length < 80000, '总体素材应被截断到上限内');
  assert.ok(big[1].content.includes('截断'), '单条超长应有截断标记');
});

test('llm 配置写入 config.json 并可读回', () => {
  const cfg = readWalleConfig();
  writeWalleConfig({ ...cfg, llm: { baseUrl: 'http://127.0.0.1:11434/v1', apiKey: 'sk-secret', model: 'qwen3:8b' } });
  assert.equal(readWalleConfig().llm?.model, 'qwen3:8b');
});
