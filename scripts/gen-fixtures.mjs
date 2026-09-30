#!/usr/bin/env node
// 生成测试固件：fixtures/codex 与 fixtures/zcode 的合成脱敏样本 + 两个 SQLite 库。
// 每次运行全量重建（rm -rf 后再生成），npm test 在跑测试前调用本脚本。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixtures = path.join(root, 'fixtures');
fs.rmSync(fixtures, { recursive: true, force: true });

const write = (rel, content) => {
  const p = path.join(fixtures, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
};

const openDb = (rel) => {
  const p = path.join(fixtures, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  return new DatabaseSync(p);
};

// ---------- codex ----------
write('codex/config.toml', `model_provider = "custom"
model = "test-model"

[model_providers.custom]
name = "test"
base_url = "https://example.invalid/v1"
experimental_bearer_token = "sk-fixture000000000000000000000000000000"
`);
write('codex/auth.json', JSON.stringify({ OPENAI_API_KEY: 'sk-fixture000000000000000000000000000000' }, null, 2));
write('codex/history.jsonl', JSON.stringify({ session_id: 't1', ts: 1783744450, text: 'test prompt' }) + '\n');
write(
  'codex/session_index.jsonl',
  JSON.stringify({ id: '019f404d-bbb3-7eb0-a91e-ffed59995d84', thread_name: '审查微信小程序登录文档', updated_at: '2026-07-08T05:58:24.274475Z' }) + '\n',
);
write('codex/version.json', JSON.stringify({ version: '0.156.1' }));
write('codex/cap_sid', 'sid-fixture');
// 会话样本：首行 session_meta + 一条用户消息（<environment_context> 注入块形态）
write(
  'codex/sessions/2026/07/08/rollout-2026-07-08T13-57-45-019f404d-bbb3-7eb0-a91e-ffed59995d84.jsonl',
  JSON.stringify({ timestamp: '2026-07-08T05:57:45Z', ordinal: 0, type: 'session_meta', payload: { session_id: '019f404d', cwd: 'C:\\Users\\Administrator', cli_version: '0.156.1' } }) +
    '\n' +
    JSON.stringify({ timestamp: '2026-07-08T05:57:46Z', ordinal: 1, type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'text', text: '<environment_context>\n<cwd>C:\\Users\\Administrator</cwd>\n</environment_context>' }] } }) +
    '\n' +
    JSON.stringify({ timestamp: '2026-07-08T05:58:00Z', ordinal: 2, type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: 'fixture reply' }] } }) +
    '\n',
);
// rules / skills
write('codex/rules/default.rules', '# fixture rule\nno-destructive-commands\n');
// 根目录 SQLite 库（threads 元数据 + 空记忆库）
{
  const db = openDb('codex/state_5.sqlite');
  db.exec(`CREATE TABLE threads (id INTEGER PRIMARY KEY, rollout_path TEXT, title TEXT, cwd TEXT, model TEXT, tokens_used INTEGER, created_at TEXT, updated_at TEXT);
INSERT INTO threads (title, cwd, model, tokens_used, created_at, updated_at) VALUES ('fixture thread', 'C:\\proj', 'test-model', 100, '2026-07-08T05:57:45Z', '2026-07-08T06:00:00Z');`);
  db.close();
}
{
  const db = openDb('codex/memories_1.sqlite');
  db.exec('CREATE TABLE stage1_outputs (thread_id TEXT, raw_memory TEXT, generated_at TEXT);');
  db.close();
}

// ---------- zcode ----------
{
  const db = openDb('zcode/cli/db/db.sqlite');
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, path TEXT, version TEXT, time_created TEXT);
CREATE TABLE message (id INTEGER PRIMARY KEY, session_id TEXT, data TEXT, sequence INTEGER, time_created TEXT);
INSERT INTO session (id, title, path, version, time_created) VALUES ('sess_fixture1', 'fixture 会话', 'D:\\CodingProject\\walle', '0.16.9', '2026-09-30T10:00:00Z');
INSERT INTO message (session_id, data, sequence, time_created) VALUES ('sess_fixture1', '{"role":"user","content":"fixture prompt"}', 0, '2026-09-30T10:00:01Z');`);
  db.close();
}
write(
  'zcode/cli/memories/projects/wenchu-d3471833ce0224a6/memory/MEMORY.md',
  '# Memory Index\n\n- [WenChu env & tooling](wenchu-env-tooling.md) — fixture memory\n',
);
write(
  'zcode/cli/memories/projects/wenchu-d3471833ce0224a6/memory/wenchu-env-tooling.md',
  '---\nname: wenchu-env-tooling\ndescription: fixture\n---\n\nFastAPI+Vue stack; use python 3.11 from miniconda.\n',
);
write(
  'zcode/cli/rollout/model-io-sess_fixture1.jsonl',
  JSON.stringify({ type: 'model_io', startedAt: '2026-09-30T10:00:01Z', completedAt: '2026-09-30T10:00:02Z', durationMs: 1000, model: { modelId: 'GLM-Test', providerId: 'fixture' }, sessionId: 'sess_fixture1', turnId: 't1' }) + '\n',
);
write('zcode/cli/plugins/known_marketplaces.json', JSON.stringify([{ name: 'fixture-marketplace', url: 'https://example.invalid' }], null, 2));
write('zcode/v2/credentials.json', JSON.stringify({ 'oauth:bigmodel:access_token': 'eyJfixtureTokenValue0000000000000000', zcodejwttoken: 'zz-fixture-jwt-0000000000000000' }, null, 2));
write('zcode/v2/bot-config.v3.json', JSON.stringify({ fixture: true }));
write('zcode/v2/setting.json', JSON.stringify({ theme: 'fixture' }));

console.log(`fixtures 已生成: ${fixtures}`);
