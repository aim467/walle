#!/usr/bin/env node
// Phase 0 最小验证脚本：ZCode 数据源格式验证（全部只读）
// 验证项：
//   1. cli/db/db.sqlite 可只读打开（session/message 会话主存储）
//   2. cli/rollout/model-io-*.jsonl 可解析（模型 I/O 遥测格式）
//   3. cli/memories/projects 下的 .md 记忆文件可读取
//   4. v2/credentials.json 键名探测（不读取值，确认敏感标记必要性）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const zcodeRoot = path.join(os.homedir(), '.zcode');
let failures = 0;
const ok = (msg) => console.log(`  [OK] ${msg}`);
const fail = (msg) => { failures++; console.error(`  [FAIL] ${msg}`); };

// --- 1. db.sqlite 会话主存储（只读） ---
console.log('== 1. cli/db/db.sqlite 只读打开 ==');
try {
  const db = new DatabaseSync(path.join(zcodeRoot, 'cli', 'db', 'db.sqlite'), { readOnly: true });
  const sessions = db.prepare('SELECT COUNT(*) c FROM session').get().c;
  const messages = db.prepare('SELECT COUNT(*) c FROM message').get().c;
  const parts = db.prepare('SELECT COUNT(*) c FROM part').get().c;
  const sample = db.prepare('SELECT title, path FROM session ORDER BY time_created DESC LIMIT 1').get();
  ok(`session=${sessions} message=${messages} part=${parts}；最新: "${sample.title}" @ ${sample.path}`);
  db.close();
} catch (e) { fail(`db.sqlite 打开失败: ${e.message}`); }

// --- 2. rollout model-io JSONL ---
console.log('== 2. rollout/model-io JSONL 解析 ==');
try {
  const dir = path.join(zcodeRoot, 'cli', 'rollout');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  const target = path.join(dir, files[0]);
  const lines = fs.readFileSync(target, 'utf8').trim().split('\n');
  const first = JSON.parse(lines[0]);
  ok(`${files.length} 个文件；样本 ${path.basename(target)}：${lines.length} 行，每行一次模型调用`);
  ok(`记录键: ${Object.keys(first).join(', ')}`);
  ok(`模型: ${first.model?.modelId} @ ${first.model?.providerId}，耗时 ${first.durationMs}ms`);
} catch (e) { fail(`rollout 解析失败: ${e.message}`); }

// --- 3. memories markdown ---
console.log('== 3. memories/projects 记忆文件 ==');
try {
  const memRoot = path.join(zcodeRoot, 'cli', 'memories', 'projects');
  const projects = fs.readdirSync(memRoot);
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else files.push(p);
    }
  };
  walk(memRoot);
  const head = fs.readFileSync(files[0], 'utf8').split('\n').slice(0, 4).join(' | ');
  ok(`${projects.length} 个项目目录，${files.length} 个记忆文件`);
  ok(`样本 ${path.basename(files[0])} 头部: ${head.slice(0, 120)}`);
} catch (e) { fail(`memories 读取失败: ${e.message}`); }

// --- 4. v2/credentials.json 敏感确认（仅键名） ---
console.log('== 4. v2/credentials.json 敏感标记确认 ==');
try {
  const o = JSON.parse(fs.readFileSync(path.join(zcodeRoot, 'v2', 'credentials.json'), 'utf8'));
  ok(`键名（值为敏感不读取）: ${Object.keys(o).join(', ')}`);
  ok('结论: 该文件必须标记 sensitive=1，展示脱敏、不入全文索引');
} catch (e) { fail(`credentials.json 探测失败: ${e.message}`); }

console.log(failures === 0 ? '\n全部验证通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
