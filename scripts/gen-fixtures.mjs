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
// skills：每个技能目录只收 SKILL.md；附属文件与系统 marker 不得成为资产（对齐 cursor/workbuddy）
write('codex/skills/.system/fixture-skill/SKILL.md', '# Fixture Skill\n\nfixture skill description\n');
write('codex/skills/.system/fixture-skill/scripts/run.py', 'print("fixture")\n');
write('codex/skills/.system/fixture-skill/references/notes.md', '# fixture notes\n');
write('codex/skills/.system/fixture-skill/assets/logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
write('codex/skills/.system/.codex-system-skills.marker', 'v1\n');
write('codex/skills/user-skill/SKILL.md', '# User Skill\n\nuser skill description\n');
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
CREATE TABLE part (id INTEGER PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, sequence INTEGER, time_created TEXT);
INSERT INTO session (id, title, path, version, time_created) VALUES ('sess_fixture1', 'fixture 会话', 'D:\\CodingProject\\walle', '0.16.9', '2026-09-30T10:00:00Z');
INSERT INTO message (id, session_id, data, sequence, time_created) VALUES (1, 'sess_fixture1', '{"role":"user"}', 0, '2026-09-30T10:00:01Z');
INSERT INTO part (id, message_id, session_id, data, sequence, time_created) VALUES (1, '1', 'sess_fixture1', '{"type":"text","text":"fixture prompt：帮我检查语义检索的阈值配置"}', 0, '2026-09-30T10:00:01Z');`);
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

// ---------- opencode（配置根 + 数据根，数据根由测试的 roots 覆盖注入） ----------
write('opencode/opencode.jsonc', JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2));
{
  // opencode 家族 schema：part/message 无 sequence 列（与 ZCode 的差异点）
  const db = openDb('opencode-data/opencode.db');
  db.exec(`CREATE TABLE session (id TEXT PRIMARY KEY, title TEXT, directory TEXT, time_created TEXT);
CREATE TABLE message (id TEXT PRIMARY KEY, session_id TEXT, data TEXT, time_created TEXT);
CREATE TABLE part (id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT, data TEXT, time_created TEXT);
INSERT INTO session (id, title, directory, time_created) VALUES ('oc_sess1', '语义检索工具可用性测试', 'D:/fixture/proj', '2026-09-05T12:23:50.509Z');
INSERT INTO message (id, session_id, data, time_created) VALUES ('oc_msg1', 'oc_sess1', '{"role":"user"}', '2026-09-05T12:24:00.000Z');
INSERT INTO part (id, message_id, session_id, data, time_created) VALUES ('oc_p1', 'oc_msg1', 'oc_sess1', '{"type":"text","text":"帮我测试 mcp server 的连接是否正常"}', '2026-09-05T12:24:00.000Z');
INSERT INTO message (id, session_id, data, time_created) VALUES ('oc_msg2', 'oc_sess1', '{"role":"assistant"}', '2026-09-05T12:24:10.000Z');
INSERT INTO part (id, message_id, session_id, data, time_created) VALUES ('oc_p2', 'oc_msg2', 'oc_sess1', '{"type":"text","text":"mcp server 连接测试通过，语义检索工具可用"}', '2026-09-05T12:24:10.000Z');`);
  db.close();
}
write('opencode-data/auth.json', JSON.stringify({ 'opencode-go': { access_token: 'oc-fixture-token-0000000000000000' } }, null, 2));

// ---------- cursor（配置根 + 应用根） ----------
write('cursor/mcp.json', JSON.stringify({ mcpServers: { git: { command: 'uvx', args: ['mcp-server-git'] } } }, null, 2));
write('cursor/skills-cursor/automate/SKILL.md', '---\nname: automate\ndescription: fixture skill for mcp server automation\n---\n\nCheck the mcp server gate before running.\n');
{
  const db = openDb('cursor-appdata/User/globalStorage/state.vscdb');
  db.exec('CREATE TABLE ItemTable (key TEXT, value TEXT); CREATE TABLE cursorDiskKV (key TEXT, value TEXT);');
  db.close();
}
write('cursor-appdata/User/settings.json', JSON.stringify({ 'editor.fontSize': 14 }));

// ---------- workbuddy（单根 ~/.workbuddy-ai 的脱敏样本） ----------
write('workbuddy/settings.json', JSON.stringify({ theme: 'dark', sandbox: { extraAllowWrite: [] } }, null, 2));
write('workbuddy/mcp-tool-list.json', JSON.stringify({ tools: [{ name: 'fixture-mcp-tool' }] }, null, 2));
write('workbuddy/mcp-approvals.json', JSON.stringify({}));
write('workbuddy/models.json', JSON.stringify({}));
write('workbuddy/last-launch.json', JSON.stringify({ at: '2026-10-01T00:00:00Z' }));
// 身份 / 记忆
write('workbuddy/SOUL.md', '# SOUL\n\nfixture soul\n');
write('workbuddy/USER.md', '# USER\n\nfixture user profile\n');
write('workbuddy/memory/fixture-uid_memory.md', '# User Memory Profile\n\nfixture memory: 语义检索阈值配置\n');
// 技能
write('workbuddy/skills/fixture-skill/SKILL.md', '---\nname: fixture-skill\ndescription: fixture\n---\n\nfixture skill body\n');
// 插件（含在用版本标记）
write('workbuddy/plugins/cache/fixture-market/fixture-plugin/1.0.0/.codebuddy-plugin/plugin.json', JSON.stringify({ name: 'fixture-plugin', version: '1.0.0' }, null, 2));
write('workbuddy/plugins/cache/fixture-market/fixture-plugin/1.0.0/.in_use', '');
write('workbuddy/plugins/cache/fixture-market/fixture-plugin/0.9.0/.codebuddy-plugin/plugin.json', JSON.stringify({ name: 'fixture-plugin', version: '0.9.0' }, null, 2));
// 连接器与凭证
write('workbuddy/connectors/fixture-uid/connector-states.json', JSON.stringify({ version: 4, connectors: {} }, null, 2));
write('workbuddy/connectors/fixture-uid/.master.key', 'fixture-connector-master-key-000000000000');
write('workbuddy/keyblob', 'fixture-keyblob-0000000000000000');
// 审计日志
write('workbuddy/audit-log/2026-10-01.jsonl', JSON.stringify({ sessionId: '11111111-1111-4111-8111-111111111111', eventType: 'command-safety.sandbox-executed', decision: 'allowed' }) + '\n');

// 会话 A：workbuddy.db 有权威标题（验证 noDocs 合并）；用户提问藏在 <system-reminder> 之后的 <user_query>
const wbSessA = '11111111-1111-4111-8111-111111111111';
write(
  `workbuddy/projects/c-fixture-proj/${wbSessA}.jsonl`,
  [
    { type: 'session-meta', id: 'fixture-sm-1', sessionId: wbSessA, timestamp: 1789211122934, cwd: 'D:\\fixture\\proj', meta: { 'codebuddy.ai/hostKind': 'unopted' } },
    {
      type: 'message',
      id: 'fixture-m1',
      timestamp: 1789211123260,
      role: 'user',
      cwd: 'D:\\fixture\\proj',
      content: [{ type: 'input_text', text: '<system-reminder data-role="user-context">\n<user_info>\nOS Version: win32\n</user_info>\n</system-reminder>\n<user_query>帮我检查语义检索的阈值配置</user_query>' }],
    },
    { type: 'ai-title', id: 'fixture-at-1', aiTitle: '检查语义检索阈值', sessionId: wbSessA, timestamp: 1789211128948, cwd: 'D:\\fixture\\proj' },
    { type: 'message', id: 'fixture-m2', timestamp: 1789211130000, role: 'assistant', content: [{ type: 'output_text', text: '语义检索阈值已确认，mcp server 正常' }] },
  ]
    .map((o) => JSON.stringify(o))
    .join('\n') + '\n',
);

// 会话 B：workbuddy.db 无记录（验证 ai-title 兜底）
const wbSessB = '22222222-2222-4222-8222-222222222222';
write(
  `workbuddy/projects/d-fixture-other/${wbSessB}.jsonl`,
  [
    { type: 'message', id: 'fixture-m3', timestamp: 1789300000000, role: 'user', cwd: 'D:\\fixture\\other', content: [{ type: 'input_text', text: '<system-reminder data-role="user-context">\n<user_info>OS</user_info>\n</system-reminder>\n<user_query>整理一下项目结构</user_query>' }] },
    { type: 'ai-title', id: 'fixture-at-2', aiTitle: 'JSONL 兜底标题', sessionId: wbSessB, timestamp: 1789300001000, cwd: 'D:\\fixture\\other' },
    { type: 'message', id: 'fixture-m4', timestamp: 1789300002000, role: 'assistant', content: [{ type: 'output_text', text: '已整理项目结构' }] },
  ]
    .map((o) => JSON.stringify(o))
    .join('\n') + '\n',
);

// 会话索引库（sessions 表：权威标题/cwd/model；仅含会话 A）
{
  const db = openDb('workbuddy/workbuddy.db');
  db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT, custom_title TEXT, cwd TEXT, model TEXT, created_at INTEGER, updated_at INTEGER, deleted_at INTEGER);
INSERT INTO sessions (id, title, cwd, model, created_at, updated_at, deleted_at) VALUES ('${wbSessA}', 'WorkBuddy 数据库标题', 'D:\\fixture\\proj', 'fixture-model', 1789211122934, 1789213894036, NULL);`);
  db.close();
}

console.log(`fixtures 已生成: ${fixtures}`);
