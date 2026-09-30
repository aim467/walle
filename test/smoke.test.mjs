// Phase 1 冒烟测试（node:test，运行于 npm test：先构建 + 生成固件）
// 覆盖 DoD：扫描产出清单、敏感标记、增量幂等、失踪检测、脱敏函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runScan, WalleStore, ContentStore, ensureWalleHome, maskSecrets, looksSensitive } from '../packages/core/dist/index.js';
import { adapters } from '../packages/adapters/dist/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = path.join(root, 'fixtures');

// 独立的 WALLE_HOME，绝不触碰真实 ~/.walle
process.env.WALLE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'walle-test-'));
ensureWalleHome();
const store = new WalleStore(path.join(process.env.WALLE_HOME, 'walle.db'));
const cas = new ContentStore(path.join(process.env.WALLE_HOME, 'objects'));
const roots = { codex: path.join(fixtures, 'codex'), zcode: path.join(fixtures, 'zcode') };

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

function countObjects(cas) {
  let n = 0;
  for (const d of fs.readdirSync(cas.rootDir ?? path.join(process.env.WALLE_HOME, 'objects'))) {
    n += fs.readdirSync(path.join(process.env.WALLE_HOME, 'objects', d)).length;
  }
  return n;
}
