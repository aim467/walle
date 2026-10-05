// 技能导入测试（node:test）：URL 解析 / zip 发现 / 安装到共享库 / 链接与复制接入。
// 不触碰网络与真实目录：zip 用 createZip 合成，toolRoot 注入临时目录。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createZip, readZip } from '../packages/core/dist/index.js';
import {
  parseSkillSource, discoverSkillsFromZip, installSkillsFromZip, installSkillHubZip, extractDescription, entriesForSkill,
} from '../packages/cli/dist/skills-import.js';

const FOO_SKILL = `---
name: foo
description: >-
  多行折叠的描述
  第二行
---

# foo
正文`;

test('parseSkillSource：GitHub 形态 → codeload HEAD，其它按 zip 直链', () => {
  assert.equal(parseSkillSource('owner/repo').zipUrls[0], 'https://codeload.github.com/owner/repo/zip/HEAD');
  assert.equal(parseSkillSource('https://github.com/owner/repo').zipUrls[0], 'https://codeload.github.com/owner/repo/zip/HEAD');
  assert.equal(parseSkillSource('https://github.com/owner/repo/tree/main/skills/foo').zipUrls[0], 'https://codeload.github.com/owner/repo/zip/HEAD');
  assert.equal(parseSkillSource('https://example.com/skills.zip').zipUrls[0], 'https://example.com/skills.zip');
  assert.throws(() => parseSkillSource('   '), /来源 URL/);
  assert.throws(() => parseSkillSource('https://github.com/only-owner'), /owner\/repo/);
});

test('extractDescription：块标量多行折叠', () => {
  assert.equal(extractDescription(FOO_SKILL), '多行折叠的描述 第二行');
});

test('discoverSkillsFromZip：按 SKILL.md 目录聚合，过滤穿越条目', () => {
  const buf = createZip([
    { name: 'repo-main/skills/foo/SKILL.md', data: Buffer.from(FOO_SKILL) },
    { name: 'repo-main/skills/foo/scripts/run.py', data: Buffer.from('print(1)') },
    { name: 'repo-main/skills/bar/SKILL.md', data: Buffer.from('---\ndescription: bar 技能\n---\n') },
    { name: 'repo-main/README.md', data: Buffer.from('not a skill') },
  ]);
  const cands = discoverSkillsFromZip(buf);
  assert.deepEqual(cands.map((c) => c.name).sort(), ['bar', 'foo']);
  const foo = cands.find((c) => c.name === 'foo');
  assert.equal(foo.path, 'repo-main/skills/foo');
  assert.equal(foo.description, '多行折叠的描述 第二行');
});

test('installSkillsFromZip：装入共享库 + junction 链接与目录复制两种接入', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walle-import-'));
  const buf = createZip([
    { name: 'repo-main/skills/foo/SKILL.md', data: Buffer.from(FOO_SKILL) },
    { name: 'repo-main/skills/foo/scripts/run.py', data: Buffer.from('print(1)') },
  ]);
  const storeSkillsDir = path.join(tmp, 'agents', 'skills');
  const zcodeRoot = path.join(tmp, 'zcode');
  const cursorRoot = path.join(tmp, 'cursor');

  const results = installSkillsFromZip(buf, ['repo-main/skills/foo'], {
    storeSkillsDir,
    targets: [{ tool: 'zcode', mode: 'link' }, { tool: 'cursor', mode: 'copy' }],
    overwrite: false,
    toolRootOf: (tool) => (tool === 'zcode' ? zcodeRoot : cursorRoot),
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].installed, true, results[0].error);
  assert.deepEqual(results[0].linked.map((l) => [l.tool, l.ok]), [['zcode', true], ['cursor', true]]);

  // 共享库本体落盘（含子目录）
  const storeDir = path.join(storeSkillsDir, 'foo');
  assert.equal(fs.readFileSync(path.join(storeDir, 'SKILL.md'), 'utf8'), FOO_SKILL);
  assert.equal(fs.readFileSync(path.join(storeDir, 'scripts', 'run.py'), 'utf8'), 'print(1)');
  // 链接接入：junction 指向共享库，读得到内容
  const link = path.join(zcodeRoot, 'skills', 'foo');
  assert.equal(fs.readlinkSync(link).toLowerCase(), storeDir.toLowerCase());
  assert.ok(fs.existsSync(path.join(link, 'scripts', 'run.py')));
  // 复制接入：独立目录
  assert.equal(fs.readFileSync(path.join(cursorRoot, 'skills', 'foo', 'SKILL.md'), 'utf8'), FOO_SKILL);
  // 复制体与本体不是同一 inode 视角：改本体不影响副本
  fs.writeFileSync(path.join(storeDir, 'SKILL.md'), 'changed');
  assert.notEqual(fs.readFileSync(path.join(cursorRoot, 'skills', 'foo', 'SKILL.md'), 'utf8'), 'changed');
});

test('installSkillsFromZip：已存在且未勾覆盖 → 拒绝；勾覆盖 → 替换', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walle-import-'));
  const buf = createZip([{ name: 'repo-main/skills/foo/SKILL.md', data: Buffer.from(FOO_SKILL) }]);
  const opts = {
    storeSkillsDir: path.join(tmp, 'skills'),
    targets: [],
    toolRootOf: () => path.join(tmp, 'tool'),
  };
  assert.equal(installSkillsFromZip(buf, ['repo-main/skills/foo'], { ...opts, overwrite: false })[0].installed, true);
  const again = installSkillsFromZip(buf, ['repo-main/skills/foo'], { ...opts, overwrite: false })[0];
  assert.equal(again.installed, false);
  assert.match(again.error, /已存在/);
  assert.equal(installSkillsFromZip(buf, ['repo-main/skills/foo'], { ...opts, overwrite: true })[0].installed, true);
});

test('installSkillsFromZip：压缩包中不存在所选技能 → 如实报错', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walle-import-'));
  const buf = createZip([{ name: 'repo-main/skills/foo/SKILL.md', data: Buffer.from(FOO_SKILL) }]);
  const r = installSkillsFromZip(buf, ['repo-main/skills/nope'], {
    storeSkillsDir: path.join(tmp, 'skills'), targets: [], toolRootOf: () => tmp,
  })[0];
  assert.equal(r.installed, false);
  assert.match(r.error, /未找到/);
});

test('entriesForSkill：按目录前缀圈定条目', () => {
  const buf = createZip([
    { name: 'r/foo/SKILL.md', data: Buffer.from('a') },
    { name: 'r/foo/x.txt', data: Buffer.from('b') },
    { name: 'r/foobar/SKILL.md', data: Buffer.from('c') },
  ]);
  assert.equal(entriesForSkill(readZip(buf), 'r/foo').length, 2);
});

test('parseSkillSource：SkillHub 技能页链接 → 官方下载接口', () => {
  const p = parseSkillSource('https://skillhub.cn/skills/writer-ai-assistant');
  assert.equal(p.kind, 'skillhub');
  assert.equal(p.slug, 'writer-ai-assistant');
  assert.equal(p.zipUrls[0], 'https://api.skillhub.cn/api/v1/download?slug=writer-ai-assistant');
  assert.throws(() => parseSkillSource('https://skillhub.cn/other/x'), /skills\/<slug>/);
});

test('discoverSkillsFromZip：根目录 SKILL.md（SkillHub 单技能包形态）可发现', () => {
  const buf = createZip([{ name: 'SKILL.md', data: Buffer.from(FOO_SKILL) }]);
  const cands = discoverSkillsFromZip(buf);
  assert.equal(cands.length, 1);
  assert.equal(cands[0].path, '');
  assert.equal(cands[0].description, '多行折叠的描述 第二行');
});

test('installSkillHubZip：根目录 zip 按 slug 落盘共享库并接入工具', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'walle-hub-'));
  const buf = createZip([
    { name: 'SKILL.md', data: Buffer.from(FOO_SKILL) },
    { name: 'scripts/run.py', data: Buffer.from('print(1)') },
  ]);
  const r = await installSkillHubZip('writer-ai-assistant', {
    storeSkillsDir: path.join(tmp, 'skills'),
    targets: [{ tool: 'zcode', mode: 'link' }],
    overwrite: false,
    toolRootOf: () => path.join(tmp, 'zcode'),
  }, buf);
  assert.equal(r.installed, true, r.error);
  assert.equal(r.name, 'writer-ai-assistant');
  assert.equal(fs.readFileSync(path.join(tmp, 'skills', 'writer-ai-assistant', 'SKILL.md'), 'utf8'), FOO_SKILL);
  assert.ok(fs.existsSync(path.join(tmp, 'zcode', 'skills', 'writer-ai-assistant', 'scripts', 'run.py')));
});
