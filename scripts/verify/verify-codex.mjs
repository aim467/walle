#!/usr/bin/env node
// Phase 0 最小验证脚本：Codex 数据源格式验证（全部只读）
// 验证项：
//   1. sessions 下的会话 .jsonl 文件可解析（类型分布 + 首条用户消息）
//   2. state_5.sqlite 可只读打开（threads 会话元数据表）
//   3. memories_1.sqlite 可只读打开（记忆表结构）
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const codexRoot = path.join(os.homedir(), '.codex');
let failures = 0;
const ok = (msg) => console.log(`  [OK] ${msg}`);
const fail = (msg) => { failures++; console.error(`  [FAIL] ${msg}`); };

// --- 1. 会话 JSONL ---
console.log('== 1. 会话 JSONL 解析 ==');
try {
  const sessionDir = path.join(codexRoot, 'sessions');
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) files.push(p);
    }
  };
  walk(sessionDir);
  files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const target = files[0];
  const lines = fs.readFileSync(target, 'utf8').trim().split('\n');
  const types = {};
  let firstUser = null;
  for (const l of lines) {
    try {
      const o = JSON.parse(l);
      types[o.type] = (types[o.type] || 0) + 1;
      if (!firstUser && o.type === 'response_item' && o.payload?.type === 'message' && o.payload?.role === 'user') {
        firstUser = o.payload.content?.[0]?.text?.slice(0, 80);
      }
    } catch { /* 跳过坏行 */ }
  }
  const meta = JSON.parse(lines[0]).payload;
  ok(`共 ${files.length} 个会话文件；样本 ${path.basename(target)}：${lines.length} 行`);
  ok(`类型分布 ${JSON.stringify(types)}`);
  ok(`session_meta 含 cwd=${meta.cwd}，cli_version=${meta.cli_version}，model_provider=${meta.model_provider}`);
  ok(`首条用户消息预览: ${firstUser ?? '(无)'}`);
} catch (e) { fail(`会话解析失败: ${e.message}`); }

// --- 2. state_5.sqlite（只读） ---
console.log('== 2. state_5.sqlite 只读打开 ==');
try {
  const db = new DatabaseSync(path.join(codexRoot, 'state_5.sqlite'), { readOnly: true });
  const threads = db.prepare('SELECT COUNT(*) c FROM threads').get().c;
  const sample = db.prepare('SELECT title, cwd, model, tokens_used, created_at FROM threads ORDER BY updated_at DESC LIMIT 1').get();
  ok(`threads 表 ${threads} 行；最新: "${sample.title}" @ ${sample.cwd}`);
  db.close();
} catch (e) { fail(`state_5.sqlite 打开失败: ${e.message}`); }

// --- 3. memories_1.sqlite（只读） ---
console.log('== 3. memories_1.sqlite 只读打开 ==');
try {
  const db = new DatabaseSync(path.join(codexRoot, 'memories_1.sqlite'), { readOnly: true });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t) => t.name);
  ok(`表: ${tables.join(', ')}`);
  const n = db.prepare('SELECT COUNT(*) c FROM stage1_outputs').get().c;
  ok(`stage1_outputs（记忆主表）${n} 行`);
  db.close();
} catch (e) { fail(`memories_1.sqlite 打开失败: ${e.message}`); }

console.log(failures === 0 ? '\n全部验证通过 ✅' : `\n${failures} 项失败 ❌`);
process.exit(failures === 0 ? 0 : 1);
