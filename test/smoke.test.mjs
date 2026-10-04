// Phase 1 冒烟测试（node:test，运行于 npm test：先构建 + 生成固件）
// 覆盖 DoD：扫描产出清单、敏感标记、增量幂等、失踪检测、脱敏函数。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runScan, buildIndex, WalleStore, ContentStore, ensureWalleHome, maskSecrets, looksSensitive, buildFtsQuery, createZip, readZip, diffLines, collapseDiff, WriteEngine } from '../packages/core/dist/index.js';
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
  workbuddy: path.join(fixtures, 'workbuddy'),
  agents: path.join(fixtures, 'agents-store'),
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

test('codex skill 粒度：每技能一个资产，附属文件不入库', () => {
  const all = store.listAssets({ tool: 'codex', limit: 500 });
  const skills = all.filter((a) => a.kind === 'skill');
  assert.equal(skills.length, 2, `codex 应产出 2 个 skill 资产，实际 ${skills.length}`);
  assert.deepEqual(
    skills.map((s) => s.name).sort(),
    ['fixture-skill', 'user-skill'],
    '技能名应取 SKILL.md 父目录名（`.system` 层级不参与命名）',
  );
  assert.ok(skills.every((s) => s.path.endsWith('/SKILL.md')), '只收 SKILL.md');
  assert.ok(skills.every((s) => s.rawFormat === 'markdown'), 'skill 应为 markdown 格式（对齐 cursor/workbuddy）');
  // 附属文件与系统 marker 不得成为资产
  for (const frag of ['/scripts/', '/references/', '/assets/', '.codex-system-skills.marker']) {
    assert.ok(!all.some((a) => a.path.includes(frag)), `${frag} 不应入库`);
  }
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

test('扫描纠正元数据漂移：内容未变也要更新 kind/name/raw_format', async () => {
  const skill = store.listAssets({ tool: 'codex', kind: 'skill', limit: 10 }).find((a) => a.name === 'fixture-skill');
  assert.ok(skill, '前置：codex fixture-skill 应存在');
  // 模拟历史扫描写入的错误元数据（内容不变）
  store.db.prepare("UPDATE asset SET kind = 'other', name = 'SKILL.md', raw_format = 'text' WHERE id = ?").run(skill.id);
  assert.equal(store.listAssets({ tool: 'codex', kind: 'skill', limit: 10 }).some((a) => a.id === skill.id), false, '前置：已从 skill 列表消失');

  const [r] = await runScan(adapters, store, cas, { roots, sources: ['codex'] });
  assert.equal(r.new, 0, '不应新增');
  assert.equal(r.updated, 1, '元数据漂移应计为 1 次更新');

  const fixed = store.listAssets({ tool: 'codex', kind: 'skill', limit: 10 }).find((a) => a.path === skill.path);
  assert.ok(fixed, '纠正后应重新出现在 skill 列表中');
  assert.equal(fixed.id, skill.id, '应原地纠正，不产生重复行');
  assert.equal(fixed.name, 'fixture-skill', 'name 应被纠正为技能目录名');
  assert.equal(fixed.rawFormat, 'markdown', 'raw_format 应被纠正');
  assert.equal(fixed.contentHash, skill.contentHash, '内容未变，哈希不应变化');

  // 再扫一次应回到幂等
  const [r2] = await runScan(adapters, store, cas, { roots, sources: ['codex'] });
  assert.equal(r2.updated, 0, '纠正后应恢复幂等');
});

test('失踪资产原样回归：内容与 mtime 均相同也应复活', async () => {
  const rel = 'rules/default.rules';
  const abs = path.join(fixtures, 'codex', 'rules', 'default.rules');
  const rules = store.listAssets({ tool: 'codex', limit: 500 }).find((a) => a.path === rel);
  assert.ok(rules, '前置：codex rules 应存在');
  const buf = fs.readFileSync(abs);
  const st = fs.statSync(abs);

  fs.rmSync(abs);
  const [r1] = await runScan(adapters, store, cas, { roots, sources: ['codex'] });
  assert.equal(r1.missing, 1, 'rules 应标记失踪');

  // 原样还原（模拟 git checkout / 备份还原：内容与 mtime 完全一致）
  fs.writeFileSync(abs, buf);
  fs.utimesSync(abs, st.atime, st.mtime);
  const [r2] = await runScan(adapters, store, cas, { roots, sources: ['codex'] });
  assert.equal(r2.missing, 0, '文件已回来，不应再次标记失踪');
  const back = store.listAssets({ tool: 'codex', limit: 500 }).find((a) => a.path === rel);
  assert.ok(back, '复活后应回到 active 列表');
  assert.equal(back.id, rules.id, '复活不应产生重复行');
});

test('删除文件后扫描：标记失踪', async () => {
  fs.rmSync(path.join(fixtures, 'codex', 'cap_sid'), { force: true });
  const [r] = await runScan(adapters, store, cas, { roots, sources: ['codex'] });
  assert.equal(r.missing, 1, 'cap_sid 应标记失踪');
  const missing = store.listAssets({ includeMissing: true, limit: 500 }).filter((a) => a.status === 'missing');
  assert.equal(missing.length, 1);
  assert.equal(missing[0].path, 'cap_sid');
  // 还原 fixture，避免同一份 fixtures 跑第二次套件时本用例前置不成立
  fs.writeFileSync(path.join(fixtures, 'codex', 'cap_sid'), 'sid-fixture');
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

test('五源扫描：workbuddy 产出资产并标记凭证', async () => {
  await runScan(adapters, store, cas, { roots });
  const all = store.listAssets({ limit: 1000 });
  const wb = all.filter((a) => a.tool === 'workbuddy');
  assert.ok(wb.length >= 12, `workbuddy 资产数 ${wb.length} 应 >= 12`);
  assert.ok(wb.some((a) => a.path === 'settings.json' && a.kind === 'config'), 'workbuddy settings.json 应入库');
  assert.ok(wb.some((a) => a.kind === 'mcp'), 'workbuddy mcp 配置应入库');
  assert.ok(wb.some((a) => a.kind === 'skill' && a.path === 'skills/fixture-skill/SKILL.md'), 'workbuddy skill 应入库');
  assert.ok(wb.some((a) => a.kind === 'memory' && a.path === 'USER.md'), 'workbuddy 身份文件应作为记忆入库');
  assert.ok(wb.some((a) => a.kind === 'plugin'), 'workbuddy 插件应入库');

  // 凭证：keyblob 与 connector master key
  const keyblob = wb.find((a) => a.path === 'keyblob');
  assert.ok(keyblob && keyblob.kind === 'secret' && keyblob.sensitive === 1, 'keyblob 应标记 secret');
  const master = wb.find((a) => a.path.endsWith('.master.key'));
  assert.ok(master && master.sensitive === 1, 'connector master key 应标记 secret');

  // 插件只收在用版本（0.9.0 未标记 .in_use，应被跳过）
  assert.ok(wb.some((a) => a.path.includes('fixture-plugin/1.0.0/.codebuddy-plugin/plugin.json')), '应取 .in_use 版本插件');
  assert.ok(!wb.some((a) => a.path.includes('fixture-plugin/0.9.0/')), '未在用版本插件不应入库');
  // 无在用标记：版本号数值比较取最大（10.0.0 优先于 0.9.0，字典序会取错）
  assert.ok(wb.some((a) => a.path.includes('fixture-plugin2/10.0.0/')), '无在用标记时应取版本号最大者');
  assert.ok(!wb.some((a) => a.path.includes('fixture-plugin2/0.9.0/')), '不应取字典序较小的版本');
});

test('workbuddy 凭证永不入全文索引', () => {
  const frag = 'connector-master-key'; // keyblob/master.key 内容片段
  const hits = store.search(frag, { limit: 5 });
  assert.equal(hits.length, 0, 'workbuddy 凭证片段不应被搜到');
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
  // Cursor：conversations 表为权威会话索引（noDocs），转录文件提供正文
  const cursorRows = rows.filter((s) => s.tool === 'cursor');
  assert.equal(cursorRows.length, 3, `cursor 应有 3 条会话元数据，实际 ${cursorRows.length}`);
  // 有转录的会话：DB 标题合并到转录资产（DB 优先于转录首条提问）
  const merged = cursorRows.find((s) => s.subId === 'cccc3333-0000-4000-8000-000000000003');
  assert.ok(merged, 'cursor 转录会话应入库');
  assert.equal(merged.title, 'fixture 数据库标题', 'DB 标题应合并到转录资产且优先');
  assert.ok(merged.assetPath.includes('agent-transcripts'), '合并目标应为转录文件资产');
  assert.ok(merged.startedAt, '合并后应有 DB 时间戳');
  // 无转录的会话：回退挂到 conversation-search.db 资产本身，仍计入会话数
  const dbOnly = cursorRows.find((s) => s.subId === 'aaaa1111-0000-4000-8000-000000000001');
  assert.ok(dbOnly, '无转录会话应保留在清单');
  assert.equal(dbOnly.title, 'fixture 会话：语义检索阈值', '无转录会话标题来自 conversations 表');
  assert.ok(dbOnly.assetPath.includes('conversation-search.db'), '无转录会话应挂到 db 资产');
  assert.equal(cursorRows.find((s) => s.subId === 'aaaa1111-0000-4000-8000-000000000002')?.title ?? null, null, '空标题应存为 null 而非空串');
});

test('cursor 转录正文：剥离注入包装、tool_use 入文档', () => {
  const cursor = adapters.find((a) => a.id === 'cursor');
  const asset = store.listAssets({ tool: 'cursor', kind: 'session', limit: 20 }).find((a) => a.path.includes('agent-transcripts'));
  assert.ok(asset, 'cursor 转录应作为 session 资产入库');
  const result = cursor.parse(cas.pathFor(asset.contentHash), { kind: 'session', path: asset.path, tool: 'cursor' }, 'read');
  assert.ok(result, 'cursor 转录应可解析');
  const user = result.docs.find((d) => d.role === 'user');
  assert.ok(user && user.text.includes('语义检索的阈值配置'), '应提取到用户真实提问');
  assert.ok(!user.text.includes('<timestamp>') && !user.text.includes('<user_query>'), '注入包装应被剥离');
  assert.ok(result.docs.some((d) => d.role === 'tool' && d.text.includes('[调用 Read]')), 'tool_use 应转为 tool 文档');
  assert.ok(result.docs.some((d) => d.role === 'assistant' && d.text.includes('0.7')), '应含助手回复');
  assert.equal(result.docs.filter((d) => d.text.includes('turn_ended')).length, 0, '控制行不应入文档');
});

test('workbuddy 会话：DB 标题合并 / ai-title 兜底 / 剥离注入块', () => {
  const rows = store.listSessions({ limit: 200 });
  const a = rows.find((s) => s.tool === 'workbuddy' && s.subId === '11111111-1111-4111-8111-111111111111');
  assert.ok(a, 'workbuddy 会话 A 应入库');
  assert.equal(a.title, 'WorkBuddy 数据库标题', 'workbuddy.db 标题应合并到会话资产');
  assert.equal(a.model, 'fixture-model', 'workbuddy.db model 应合并');

  const b = rows.find((s) => s.tool === 'workbuddy' && s.subId === '22222222-2222-4222-8222-222222222222');
  assert.ok(b, 'workbuddy 会话 B 应入库');
  assert.equal(b.title, 'JSONL 兜底标题', 'DB 无记录时应回退到 JSONL ai-title');

  // 会话 A 内容：用户真实提问从 <user_query> 提取，注入块被剥离
  const wb = adapters.find((x) => x.id === 'workbuddy');
  const asset = store.listAssets({ tool: 'workbuddy', kind: 'session', limit: 20 }).find((x) => x.path.includes('11111111'));
  const result = wb.parse(cas.pathFor(asset.contentHash), { kind: 'session', path: asset.path, tool: 'workbuddy' }, 'read');
  assert.ok(result, 'workbuddy 会话应可解析');
  const user = result.docs.find((d) => d.role === 'user');
  assert.ok(user && user.text.includes('语义检索'), '应提取到用户真实提问');
  assert.ok(!user.text.includes('system-reminder'), '注入块应被剥离');
  assert.ok(result.docs.some((d) => d.role === 'assistant'), '应含助手回复');
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

test('工具调用与文件文档：Codex function_call / ZCode tool part / opencode patch', () => {
  const cx = adapters.find((a) => a.id === 'codex');
  const cr = cx.parse(
    path.join(fixtures, 'codex/sessions/2026/07/08/rollout-2026-07-08T13-57-45-019f404d-bbb3-7eb0-a91e-ffed59995d84.jsonl'),
    { kind: 'session', path: 'sessions/2026/07/08/rollout.jsonl', tool: 'codex' }, 'read',
  );
  assert.ok(cr, 'codex 应可解析');
  assert.ok(cr.docs.some((d) => d.role === 'tool' && d.text.includes('[调用 shell_command]')), 'function_call 应转 tool 文档');
  const out = cr.docs.find((d) => d.role === 'tool' && d.text.startsWith('[结果 shell_command]'));
  assert.ok(out && out.text.includes('Exit code: 0'), 'function_call_output 应按 call_id 关联调用名');
  assert.ok(cr.docs.some((d) => d.docType === 'session_file' && d.text === 'src/foo.py'), 'apply_patch 变更文件应入 session_file');
  assert.ok(cr.docs.some((d) => d.role === 'assistant' && d.text === 'fixture reply'), '消息解析不受影响');

  const zc = adapters.find((a) => a.id === 'zcode');
  const zr = zc.parse(path.join(fixtures, 'zcode/cli/db/db.sqlite'), { kind: 'session', path: 'cli/db/db.sqlite', tool: 'zcode' }, 'read');
  assert.ok(zr, 'zcode db 应可解析');
  assert.ok(zr.docs.some((d) => d.role === 'tool' && d.text.includes('[调用 Read]')), 'tool part 应转 tool 文档');
  assert.ok(zr.docs.some((d) => d.docType === 'session_file' && d.text === 'D:\\fixture\\proj\\config.json'), 'input.file_path 应入 session_file');
  assert.ok(zr.docs.some((d) => d.role === 'user' && d.text.includes('语义检索')), '文本消息不受影响');

  const oc = adapters.find((a) => a.id === 'opencode');
  const orr = oc.parse(path.join(fixtures, 'opencode-data/opencode.db'), { kind: 'session', path: 'data:opencode.db', tool: 'opencode' }, 'read');
  assert.ok(orr.docs.some((d) => d.docType === 'session_file' && d.text === 'D:/fixture/proj/src/style.css'), 'opencode patch files 应入 session_file');
});

test('token 用量：Codex 取累计最大值 / ZCode step-finish 累加', () => {
  const cx = adapters.find((a) => a.id === 'codex');
  const cr = cx.parse(
    path.join(fixtures, 'codex/sessions/2026/07/08/rollout-2026-07-08T13-57-45-019f404d-bbb3-7eb0-a91e-ffed59995d84.jsonl'),
    { kind: 'session', path: 'sessions/rollout.jsonl', tool: 'codex' }, 'index',
  );
  assert.ok(cr.sessions[0]?.usage, 'codex 会话应有用量');
  assert.equal(cr.sessions[0].usage.total, 390, '应取 total_token_usage 的会话累计最大值');
  assert.equal(cr.sessions[0].usage.input, 300);
  assert.equal(cr.sessions[0].usage.output, 90);
  assert.equal(cr.sessions[0].usage.cacheRead, 60);

  const zc = adapters.find((a) => a.id === 'zcode');
  const zr = zc.parse(path.join(fixtures, 'zcode/cli/db/db.sqlite'), { kind: 'session', path: 'cli/db/db.sqlite', tool: 'zcode' }, 'read');
  const zs = zr.sessions.find((s) => s.subId === 'sess_fixture1');
  assert.ok(zs?.usage, 'zcode 会话应有用量');
  assert.equal(zs.usage.total, 1500, '两步 step-finish 应累加');
  assert.equal(zs.usage.input, 1300);
  assert.equal(zs.usage.output, 200);
  assert.equal(zs.usage.cacheRead, 300);
  assert.equal(zs.usage.cost, 0.75);
});

test('token 用量：入库与按工具聚合', () => {
  const rows = store.listSessions({ limit: 200 });
  const zc = rows.find((s) => s.tool === 'zcode' && s.subId === 'sess_fixture1');
  assert.ok(zc?.usage, '索引后 zcode 会话清单应带用量');
  assert.equal(zc.usage.total, 1500);
  const codexRow = rows.find((s) => s.tool === 'codex' && s.usage);
  assert.ok(codexRow, 'codex 会话清单应带用量');

  const byTool = Object.fromEntries(store.usageByTool().map((u) => [u.tool, u]));
  assert.ok(byTool.zcode, 'zcode 应出现在用量聚合');
  assert.equal(byTool.zcode.total, 1500);
  assert.equal(byTool.zcode.withUsage, 1);
  assert.ok((byTool.codex?.total ?? 0) > 0, 'codex 应出现在用量聚合');
});

test('token 用量：按天与按项目聚合', () => {
  // 用大窗口避免测试日期漂移导致 fixture 会话出窗
  const byDay = store.usageByDay(3650);
  const day = byDay.find((d) => d.day === '2026-09-30');
  assert.ok(day, 'zcode fixture 会话应计入按天聚合');
  assert.equal(day.total, 1500, '该日用量应等于 zcode fixture 会话总量');

  const byProject = store.usageByProject(10);
  const proj = byProject.find((p) => p.project.includes('fixture') && p.total === 1500);
  assert.ok(proj, '按项目聚合应含 zcode fixture 项目');
  assert.equal(proj.withUsage, 1);
  assert.ok(byProject.length >= 2, 'codex（cwd）与 zcode（directory）应各成一组');
  assert.ok((byProject[0].total ?? 0) >= (byProject[byProject.length - 1].total ?? 0), '按用量降序');
});

test('符号链接 skills：共享技能库链接进工具目录应被发现（walkFiles 防环）', () => {
  const all = store.listAssets({ tool: 'zcode', limit: 500 });
  // Windows 无特权环境建不了符号链接（固件退化为真实目录），按标记决定断言深度
  const symlinksOk = fs.existsSync(path.join(fixtures, 'zcode', 'skills', '.symlinks-ok'));
  const linked = all.find((a) => a.kind === 'skill' && a.name === 'linked-skill');
  assert.ok(linked, '链接进 zcode/skills 的共享技能应作为 skill 资产入库');
  assert.equal(linked.path, 'skills/linked-skill/SKILL.md');
  if (symlinksOk) {
    const content = cas.get(linked.contentHash)?.toString('utf8') ?? '';
    assert.ok(content.includes('shared skill store body'), '内容应跟随链接读到共享库本体');
  }
  // 防环：fixtures 中 loop-a ↔ loop-b 互链，扫描能正常完成（跑到这里即未死循环），且不产出环内路径资产
  assert.ok(!all.some((a) => a.path.includes('loop-a/to-') || a.path.includes('loop-b/to-')), '互链目录不应产出重复资产');
});

test('agents 共享技能库：本体与登记文件入库', () => {
  const all = store.listAssets({ tool: 'agents', limit: 100 });
  const linked = all.find((a) => a.kind === 'skill' && a.path === 'skills/linked-skill/SKILL.md');
  const solo = all.find((a) => a.kind === 'skill' && a.path === 'skills/solo-skill/SKILL.md');
  assert.ok(linked, '共享库技能本体应入库（含已链接者）');
  assert.ok(solo, '未被链接的技能也应入库');
  const lock = all.find((a) => a.name === 'skill-lock');
  assert.ok(lock, '.skill-lock.json 应入库');
});

test('CAS put 合并 SQLite -wal：运行中库不丢数据', () => {
  const cas2 = new ContentStore(path.join(process.env.WALLE_HOME, 'objects2'));
  const src = path.join(fixtures, 'zcode', 'cli', 'waltest.sqlite');
  assert.ok(fs.existsSync(src + '-wal'), '固件应带未 checkpoint 的 -wal');
  const r1 = cas2.put(src);
  assert.ok(r1.stored, '首次应入仓');
  const merged = (cas2.get(r1.hash) ?? Buffer.alloc(0)).toString('latin1');
  assert.ok(merged.includes('A-row-main'), '主文件数据应在副本中');
  assert.ok(merged.includes('B-row-wal'), '仅存在于 -wal 的数据应被合并入副本');
  const r2 = cas2.put(src);
  assert.equal(r2.hash, r1.hash, '合并幂等：再次 put 哈希一致');
  assert.equal(r2.stored, false, '同内容不应重复入仓');
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

// ---------- P4：写回三保险 ----------

test('写回成功路径：内容落盘 + 前后快照 + 无临时文件残留', async () => {
  const engine = new WriteEngine(store, cas, adapters);
  const cfg = store.listAssets({ tool: 'codex', limit: 500 }).find((a) => a.path === 'config.toml');
  const snapsBefore = store.listSnapshots(cfg.id).length;
  const result = engine.write(cfg.id, Buffer.from('model_provider = "custom"\nmodel = "test-model"\n\n[model_providers.custom]\nname = "test"\nbase_url = "https://example.invalid/v1"\nexperimental_bearer_token = "sk-fixture000000000000000000000000000000"\n# p4 written\n'));
  assert.ok(result.ok, `写回应成功: ${result.reason}`);
  assert.ok(result.snapshotId, '应返回写前快照 id');
  assert.ok(store.listSnapshots(cfg.id).length >= snapsBefore + 1, '写后应有新快照');
  const abs = path.join(fixtures, 'codex', 'config.toml');
  assert.ok(fs.readFileSync(abs, 'utf8').endsWith('# p4 written\n'), '内容应落盘');
  const leftovers = fs.readdirSync(path.dirname(abs)).filter((f) => f.includes('.walle-tmp-'));
  assert.equal(leftovers.length, 0, '不应有临时文件残留');
  assert.ok(!fs.existsSync(abs + '.walle-tmp-x'), '原文件未被半写');
});

test('冲突检测：扫描后外部改动 → 写回拒绝', async () => {
  const engine = new WriteEngine(store, cas, adapters);
  const cfg = store.listAssets({ tool: 'codex', limit: 500 }).find((a) => a.path === 'config.toml');
  // 外部直接改文件（不经 walle，无扫描）
  fs.appendFileSync(path.join(fixtures, 'codex', 'config.toml'), '\n# external edit\n');
  const result = engine.write(cfg.id, Buffer.from('malicious = true\n'));
  assert.equal(result.ok, false, '应被冲突检测拒绝');
  assert.match(result.reason ?? '', /冲突/, '拒绝原因应提示冲突');
  // 磁盘未被写坏
  assert.ok(fs.readFileSync(path.join(fixtures, 'codex', 'config.toml'), 'utf8').includes('# external edit'));
});

test('会话资产永不写回', () => {
  const engine = new WriteEngine(store, cas, adapters);
  const sess = store.listAssets({ tool: 'codex', kind: 'session', limit: 1 })[0];
  const result = engine.write(sess.id, Buffer.from('x'));
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /只读/);
});

test('跨工具下发：目标匹配与写入', async () => {
  // fixture：codex config.toml 内容 → 无跨工具同名资产（拒绝）；--to-asset 路径由 zcode setting.json 同名验证
  const engine = new WriteEngine(store, cas, adapters);
  const zSet = store.listAssets({ tool: 'zcode', limit: 500 }).find((a) => a.path === 'v2/setting.json');
  const result = engine.write(zSet.id, Buffer.from(JSON.stringify({ theme: 'written-by-walle' })));
  assert.ok(result.ok, `zcode setting.json 写回应成功: ${result.reason}`);
  assert.equal(fs.readFileSync(path.join(fixtures, 'zcode', 'v2', 'setting.json'), 'utf8'), JSON.stringify({ theme: 'written-by-walle' }));
});

function countObjects(cas) {
  let n = 0;
  for (const d of fs.readdirSync(cas.rootDir ?? path.join(process.env.WALLE_HOME, 'objects'))) {
    n += fs.readdirSync(path.join(process.env.WALLE_HOME, 'objects', d)).length;
  }
  return n;
}
