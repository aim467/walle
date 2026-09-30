// Phase 1 冒烟测试（node:test，运行于 npm test：先构建 + 生成固件）
// 覆盖 DoD：扫描产出清单、敏感标记、增量幂等、失踪检测、脱敏函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runScan, buildIndex, WalleStore, ContentStore, ensureWalleHome, maskSecrets, looksSensitive, buildFtsQuery, createZip, readZip, diffLines, collapseDiff } from '../packages/core/dist/index.js';
import { adapters } from '../packages/adapters/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'fixtures');

// 独立的 WALLE_HOME，绝不触碰真实 ~/.walle
process.env.WALLE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'walle-test-'));
// cursor/opencode 的数据根重定向到固件，绝不读取真机数据
process.env.WALLE_CURSOR_APPDATA = path.join(fixtures, 'cursor-appdata');
process.env.WALLE_OPENCODE_DATA = path.join(fixtures, 'opencode-data');
ensureWalleHome();
const store = new WalleStore(path.join(process.env.WALLE_HOME, 'walle.db'));
const cas = new ContentStore(path.join(process.env.WALLE_HOME, 'objects'));
const roots = {
  codex: path.join(fixtures, 'codex'),
  zcode: path.join(fixtures, 'zcode'),
  cursor: path.join(fixtures, 'cursor'),
  opencode: path.join(fixtures, 'opencode'),
};

test('敏感工具函数', () => {
  assert.equal(looksSensitive('experimental_bearer_token = "sk-abc12345678901234567890"'), true);
  assert.equal(looksSensitive('const greeting = "hello world"'), false);
  const masked = maskSecrets('OPENAI_API_KEY=sk-abcd1234567890abcdefghijklmn');
  assert.ok(!masked.includes('sk-abcd1234567890abcdefghijklmn'), '完整密钥不应出现在脱敏结果中');
  assert.ok(masked.includes('****'));
});

test('首次扫描：两源均产出资产，凭证被标记', async () => {
  const [r] = await runScan(adapters, store, cas, { roots });
  assert.equal(r.tool, 'codex');
  assert.ok(r.total >= 8, `codex 资产数 ${r.total} 应 >= 8`);
  assert.equal(r.new, r.total);

  const all = store.listAssets({ limit: 500 });
  const auth = all.find((a) => a.path === 'auth.json');
  assert.ok(auth, 'auth.json 应入库');
  assert.equal(auth.kind, 'secret');
  assert.equal(auth.sensitive, 1);

  const cred = all.find((a) => a.path === 'v2/credentials.json');
  assert.ok(cred, 'zcode credentials.json 应入库');
  assert.equal(cred.sensitive, 1);

  // config.toml 文件名不敏感，但内容含 token → 内容级兜底命中
  const cfg = all.find((a) => a.path === 'config.toml');
  assert.ok(cfg, 'config.toml 应入库');
  assert.equal(cfg.sensitive, 1, 'config.toml 应被内容级扫描标记为敏感');

  const sess = all.find((a) => a.kind === 'session' && a.tool === 'codex');
  assert.ok(sess && sess.path.startsWith('sessions/'), 'codex 会话文件应入库');

  const mem = all.find((a) => a.kind === 'memory' && a.tool === 'zcode');
  assert.ok(mem, 'zcode 记忆文件应入库');
});

test('重复扫描幂等：零新增、零更新', async () => {
  const objectsBefore = countObjects(cas);
  const results = await runScan(adapters, store, cas, { roots });
  for (const r of results) {
    assert.equal(r.new, 0, `${r.tool} 不应有新增`);
    assert.equal(r.updated, 0, `${r.tool} 不应有更新`);
    assert.ok(r.unchanged > 0, `${r.tool} 应有未变资产`);
  }
  assert.equal(countObjects(cas), objectsBefore, '内容仓不应有新对象');
});

test('删除文件后扫描：标记失踪', async () => {
  fs.rmSync(path.join(fixtures, 'codex', 'cap_sid'), { force: true });
  const [r] = await runScan(adapters, store, cas, { roots, sources: ['codex'] });
  assert.equal(r.missing, 1, 'cap_sid 应标记失踪');
  const missing = store.listAssets({ includeMissing: true, limit: 500 }).filter((a) => a.status === 'missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].path, 'cap_sid');
});

// ---------- P2：索引 / 搜索 / 会话 ----------

test('四源扫描：cursor 与 opencode 均产出资产', async () => {
  await runScan(adapters, store, cas, { roots });
  const all = store.listAssets({ limit: 500 });
  assert.ok(all.some((a) => a.tool === 'cursor' && a.path === 'mcp.json'), 'cursor mcp.json 应入库');
  assert.ok(all.some((a) => a.tool === 'cursor' && a.kind === 'skill'), 'cursor skill 应入库');
  assert.ok(all.some((a) => a.tool === 'opencode' && a.path === 'data:auth.json' && a.sensitive === 1), 'opencode auth.json 应标记 secret');
  assert.ok(all.some((a) => a.tool === 'opencode' && a.kind === 'session'), 'opencode.db 应作为会话资产入库');
});

test('构建索引 + 中文/英文搜索', () => {
  const stats = buildIndex(adapters, store, cas);
  assert.ok(stats.assetsIndexed > 0, '应有资产被索引');
  assert.ok(stats.docsAdded > 0, '应有文档入索引');

  // 中文 bigram：会话正文与标题可命中
  const zh = store.search('语义检索', { limit: 20 });
  assert.ok(zh.length >= 2, `「语义检索」应命中多文档，实际 ${zh.length}`);
  assert.ok(zh.some((h) => h.docType === 'session_title'), '应命中会话标题');

  // 英文多词 AND
  const en = store.search('mcp server', { limit: 20 });
  assert.ok(en.length >= 1, '「mcp server」应有命中');

  // 分词器：空/无有效 token 返回空串（防注入与噪声）
  assert.equal(buildFtsQuery('a"b'), '');
  assert.equal(buildFtsQuery('语义'), '"语义"');
});

test('secret 资产永不入全文索引', () => {
  // auth.json / credentials.json 的 token 值在固件中独一无二，若入索引即可搜到
  for (const secret of ['sk-fixture000000000000000000000000000000', 'eyJfixtureTokenValue0000000000000000']) {
    const frag = secret.slice(8, 24); // 取中段做查询（bigram 命中即视为入索引）
    const hits = store.search(frag, { limit: 5 });
    assert.equal(hits.length, 0, `secret 片段 ${frag} 不应被搜到`);
  }
});

test('索引增量幂等：二次构建零资产', () => {
  const stats = buildIndex(adapters, store, cas);
  assert.equal(stats.assetsIndexed, 0, '无变化时不应重建索引');
  assert.equal(stats.docsAdded, 0);
});

test('会话清单：标题与来源富化', () => {
  const rows = store.listSessions({ limit: 100 });
  const zc = rows.find((s) => s.tool === 'zcode');
  assert.ok(zc && zc.title, 'zcode 会话应有标题');
  const oc = rows.find((s) => s.tool === 'opencode');
  assert.ok(oc && oc.title === '语义检索工具可用性测试', 'opencode 会话标题应来自 db');
  assert.ok(rows.some((s) => s.tool === 'codex' && s.title), 'codex 会话应有标题（fixture 首条用户消息）');
});

test('read 模式解析：会话消息完整返回', () => {
  const oc = adapters.find((a) => a.id === 'opencode');
  const dbAsset = store.listAssets({ tool: 'opencode', kind: 'session', limit: 10 })[0];
  assert.ok(dbAsset?.contentHash, 'opencode.db 应有内容哈希');
  const result = oc.parse(cas.pathFor(dbAsset.contentHash), { kind: 'session', path: dbAsset.path, tool: 'opencode' }, 'read');
  assert.ok(result, 'opencode.db 应可解析');
  assert.ok(result.docs.length >= 2, '应解析出 2 条消息');
  assert.ok(result.docs.some((d) => d.role === 'user' && d.text.includes('mcp server')), '应含用户消息');
  assert.ok(result.sessions[0].title === '语义检索工具可用性测试', '应含会话标题');
});

// ---------- P3：快照 / diff / zip / 复活 ----------

test('内容变更自动留快照 + 失踪复活', async () => {
  // 1. 修改 fixture 文件 → 扫描 → 旧版本留快照
  const cfgPath = path.join(fixtures, 'codex', 'config.toml');
  const oldHash = store.listAssets({ tool: 'codex', limit: 500 }).find((a) => a.path === 'config.toml').contentHash;
  fs.appendFileSync(cfgPath, '\n# p3 snapshot test\n');
  const [r] = await runScan(adapters, store, cas, { roots, sources: ['codex'] });
  assert.equal(r.updated, 1, 'config.toml 应更新 1');
  const asset = store.listAssets({ tool: 'codex', limit: 500 }).find((a) => a.path === 'config.toml');
  const snaps = store.listSnapshots(asset.id);
  assert.ok(snaps.some((s) => s.contentHash === oldHash), '旧版本应留存为快照');
  assert.ok(snaps.some((s) => s.contentHash === asset.contentHash), '新版本应有快照');

  // 2. diff 算法单测
  const d = diffLines('a\nb\nc\n', 'a\nx\nc\n');
  assert.deepEqual(d.filter((l) => l.op !== 'same'), [
    { op: 'del', text: 'b' },
    { op: 'add', text: 'x' },
  ]);
  assert.ok(collapseDiff(d).length >= 3, '折叠后应保留上下文');

  // 3. 误删 → 失踪 → 回归复活（不产生重复资产行）
  fs.rmSync(cfgPath);
  await runScan(adapters, store, cas, { roots, sources: ['codex'] });
  const missingRows = store.listAssets({ tool: 'codex', includeMissing: true, limit: 500 }).filter((a) => a.path === 'config.toml');
  assert.equal(missingRows.length, 1);
  assert.equal(missingRows[0].status, 'missing');
  fs.writeFileSync(cfgPath, 'model_provider = "custom"\nmodel = "test-model"\n\n[model_providers.custom]\nname = "test"\nbase_url = "https://example.invalid/v1"\nexperimental_bearer_token = "sk-fixture000000000000000000000000000000"\n\n# p3 snapshot test\n');
  await runScan(adapters, store, cas, { roots, sources: ['codex'] });
  const after = store.listAssets({ tool: 'codex', includeMissing: true, limit: 500 }).filter((a) => a.path === 'config.toml');
  assert.equal(after.length, 1, '复活不应产生重复行');
  assert.equal(after[0].status, 'active', '回归资产应复活为 active');
});

test('zip roundtrip', () => {
  const entries = [
    { name: 'objects/ab/cdef', data: Buffer.from('hello walle 中文内容 '.repeat(200)) },
    { name: 'walle.db', data: Buffer.alloc(4096, 7) },
    { name: 'empty.bin', data: Buffer.alloc(0) },
  ];
  const back = readZip(createZip(entries));
  assert.equal(back.length, entries.length);
  for (const e of back) {
    const orig = entries.find((x) => x.name === e.name);
    assert.ok(Buffer.compare(e.data, orig.data) === 0, `${e.name} 内容应一致`);
  }
});

function countObjects(cas) {
  let n = 0;
  for (const d of fs.readdirSync(cas.rootDir ?? path.join(process.env.WALLE_HOME, 'objects'))) {
    n += fs.readdirSync(path.join(process.env.WALLE_HOME, 'objects', d)).length;
  }
  return n;
}
