// `walle mcp` 测试（node:test，运行于 npm test）：协议层 + 只读工具语义，全部跑在固件隔离环境。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runScan, buildIndex, WalleStore, ContentStore, ensureWalleHome } from '../packages/core/dist/index.js';
import { adapters } from '../packages/adapters/dist/index.js';
import { createMcpHandler } from '../packages/cli/dist/commands/mcp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'fixtures');

process.env.WALLE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'walle-mcp-'));
process.env.WALLE_CURSOR_APPDATA = path.join(fixtures, 'cursor-appdata');
process.env.WALLE_OPENCODE_DATA = path.join(fixtures, 'opencode-data');
process.env.WALLE_WORKBUDDY_CN = path.join(fixtures, 'workbuddy-home');
process.env.WALLE_KNOWLEDGE = path.join(fixtures, 'knowledge');
ensureWalleHome();
const store = new WalleStore(path.join(process.env.WALLE_HOME, 'walle.db'));
const cas = new ContentStore(path.join(process.env.WALLE_HOME, 'objects'));
const roots = {
  codex: path.join(fixtures, 'codex'),
  zcode: path.join(fixtures, 'zcode'),
  cursor: path.join(fixtures, 'cursor'),
  opencode: path.join(fixtures, 'opencode'),
  'workbuddy-cn': path.join(fixtures, 'workbuddy-home'),
  workbuddy: path.join(fixtures, 'workbuddy'),
  agents: path.join(fixtures, 'agents-store'),
};
const scanOpts = { roots, projectRoots: [] };

const handle = createMcpHandler({ store, cas });
const rpc = (method, params, id = 1) => handle({ jsonrpc: '2.0', id, method, params });
const toolText = async (name, args) => {
  const r = await rpc('tools/call', { name, arguments: args });
  if (r.error) throw new Error(`rpc error: ${r.error.message}`);
  return r.result.content[0].text;
};

test('前置：扫描 + 建索引（含项目级记忆）', async () => {
  await runScan(adapters, store, cas, { ...scanOpts, projectRoots: [path.join(fixtures, 'project-alpha')] });
  buildIndex(adapters, store, cas);
});

test('协议：initialize 握手、未知方法报错、通知无响应', async () => {
  const init = await rpc('initialize', { clientInfo: { name: 'test' } });
  assert.equal(init.result.protocolVersion, '2024-11-05');
  assert.equal(init.result.serverInfo.name, 'walle');
  assert.ok(init.result.capabilities.tools, '应声明 tools 能力');

  const bad = await rpc('no/such/method', {});
  assert.equal(bad.error.code, -32601);

  const notified = await handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notified, null, '通知不产生响应');

  const malformed = await handle({ jsonrpc: '1.0', method: 'x' });
  assert.equal(malformed.error.code, -32600, '非 2.0 请求拒绝');
});

test('tools/list：五个只读工具，均无写入能力', async () => {
  const r = await rpc('tools/list', {});
  const names = r.result.tools.map((t) => t.name);
  assert.deepEqual(names, ['list_memories', 'read_memory', 'search_memory', 'search_skills', 'read_skill', 'search_knowledge', 'read_knowledge']);
  assert.ok(r.result.tools.every((t) => t.inputSchema.type === 'object'), '工具应带 inputSchema');
});

test('list_memories：跨工具聚合 + 项目过滤', async () => {
  const all = await toolText('list_memories', {});
  assert.ok(all.includes('#'), '应含资产 id');
  assert.ok(all.includes('MEMORY'), '应含 MEMORY 记忆');
  assert.ok(all.includes('根（'), '应含根记忆');
  assert.ok(all.includes('项目 '), '应含项目记忆');

  const scoped = await toolText('list_memories', { project: 'project-alpha' });
  assert.ok(scoped.includes('project-alpha'), '项目过滤应命中固件项目');
  assert.ok(!scoped.includes('根（zcode'), '项目过滤不应带出根记忆');
});

test('read_memory：读回正文；kind 走错报错', async () => {
  const mem = store.listAssets({ kind: 'memory', tool: 'codex', limit: 10 }).find((a) => a.path === 'memories/MEMORY.md');
  assert.ok(mem, '前置：codex memories/MEMORY.md 应入库');
  const text = await toolText('read_memory', { assetId: mem.id });
  assert.ok(text.includes('用户偏好简体中文交流'), '应读回记忆正文');

  const wrong = await rpc('tools/call', { name: 'read_skill', arguments: { assetId: mem.id } });
  assert.equal(wrong.result.isError, true, 'read_skill 读记忆应报错');
  assert.ok(wrong.result.content[0].text.includes('不是 skill'), '错误信息应说明 kind 不符');

  const missing = await rpc('tools/call', { name: 'read_memory', arguments: { assetId: 999999 } });
  assert.equal(missing.result.isError, true, '不存在的资产应报错而非抛协议错误');
});

test('search_memory / search_skills：全文检索 + read_skill', async () => {
  const memHits = await toolText('search_memory', { query: '简体中文' });
  assert.ok(memHits.includes('memories/MEMORY.md'), '记忆全文检索应命中 codex 记忆');

  const skillHits = await toolText('search_skills', { query: 'fixture-skill' });
  assert.ok(/SKILL\.md/.test(skillHits), '技能检索应返回 SKILL.md 路径');

  const skill = store.listAssets({ kind: 'skill', tool: 'codex', limit: 10 }).find((a) => a.name === 'fixture-skill');
  const text = await toolText('read_skill', { assetId: skill.id });
  assert.ok(text.includes('SKILL.md'), 'read_skill 应带路径头');

  const empty = await toolText('search_memory', { query: '绝不存在的词汇组合xyzq' });
  assert.ok(empty.includes('没有匹配'), '无命中应如实说明');
});

test('search_knowledge / read_knowledge：知识库检索与读取', async () => {
  const assets = store.listAssets({ kind: 'knowledge', limit: 10 });
  assert.ok(assets.length >= 1, 'WALLE_KNOWLEDGE 固件卡片应入库');
  assert.equal(assets[0].tool, 'walle', '知识卡片归属 walle 源');

  const text = await toolText('read_knowledge', { assetId: assets[0].id });
  assert.ok(text.includes('knowledge kind'), '应读回卡片正文');

  const hits = await toolText('search_knowledge', { query: '提炼' });
  assert.ok(hits.includes('#'), '知识检索应返回结果');

  const all = await toolText('search_knowledge', {});
  assert.ok(all.includes('[知识]'), '空 query 应列出全部条目');

  const wrong = await rpc('tools/call', { name: 'read_memory', arguments: { assetId: assets[0].id } });
  assert.equal(wrong.result.isError, true, 'read_memory 读知识卡片应报 kind 不符');
});
