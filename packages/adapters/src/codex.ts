import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Adapter, AssetKind, ParseMode, ParsedResult, RawAsset } from '@walle/core';
import { isSidecarOrLog, statAsset, toRel, walkFiles } from './util.js';
import { parseCodexRollout, parseCodexSessionIndex, parseCodexState } from './parse.js';

/**
 * Codex CLI 适配器。格式细节见 docs/data-sources/codex.md（全部实测）。
 * 版本化文件名（state_5 / logs_2 …）一律 glob 匹配，不硬编码版本号。
 */

const ROOT_FILES: { file: string; kind: AssetKind; name?: string }[] = [
  { file: 'config.toml', kind: 'config' },
  { file: 'config.toml.pebrel-bak', kind: 'config' },
  { file: 'hooks.json', kind: 'config' },
  { file: 'hooks.pebrel-managed.json', kind: 'config' },
  { file: 'history.jsonl', kind: 'prompt', name: 'command-history' },
  { file: 'session_index.jsonl', kind: 'other', name: 'session-index' },
  { file: 'version.json', kind: 'other' },
  { file: 'cc-switch-model-catalog.json', kind: 'other' },
  { file: 'cap_sid', kind: 'other' },
  { file: 'installation_id', kind: 'other' },
];

/** 根目录 SQLite 库：前缀 -> kind（memories 是记忆，其余为内部库） */
const SQLITE_PREFIX_KINDS: [RegExp, AssetKind][] = [
  [/^memories_\d+\.sqlite$/, 'memory'],
  [/^state_\d+\.sqlite$/, 'other'],
  [/^thread_history_\d+\.sqlite$/, 'other'],
  [/^goals_\d+\.sqlite$/, 'other'],
  [/^queue_\d+\.sqlite$/, 'other'],
  [/^logs_\d+\.sqlite$/, 'other'],
];

/** 会话/技能/规则目录与 sqlite 前缀在这些子目录下递归 */
const IGNORE_DIRS = ['.sandbox', '.sandbox-bin', '.sandbox-secrets', 'tmp', '.tmp', 'thread-writer-locks', 'rollout-migrations', 'packages'];

function fmt(rel: string): 'jsonl' | 'json' | 'toml' | 'text' {
  if (rel.endsWith('.jsonl')) return 'jsonl';
  if (rel.endsWith('.json')) return 'json';
  if (rel.endsWith('.toml')) return 'toml';
  return 'text';
}

export const codexAdapter: Adapter = {
  id: 'codex',
  displayName: 'Codex CLI',
  parse(contentPath, raw, mode: ParseMode): ParsedResult | null {
    if (raw.kind === 'session') return parseCodexRollout(contentPath, mode);
    if (raw.path === 'session_index.jsonl') return parseCodexSessionIndex(contentPath);
    if (raw.kind === 'other' && /state_\d+\.sqlite$/.test(raw.path)) return parseCodexState(contentPath);
    return null;
  },

  capabilities: { read: true, write: true },

  detect(rootOverride?: string): string | null {
    const root = rootOverride ?? path.join(os.homedir(), '.codex');
    try {
      return fs.statSync(root).isDirectory() ? root : null;
    } catch {
      return null;
    }
  },

  async *discover(root: string): AsyncIterable<RawAsset> {
    // 1. 根目录已知文件（auth.json 按文件名直接判 secret）
    for (const { file, kind, name } of ROOT_FILES) {
      const a = statAsset(root, file, kind, fmt(file), { name });
      if (a) yield a;
    }
    const auth = statAsset(root, 'auth.json', 'secret', 'json', { name: 'auth', sensitive: true });
    if (auth) yield auth;

    // 2. 根目录版本化 SQLite 库（glob 匹配，不硬编码版本号）
    let rootEntries: fs.Dirent[] = [];
    try {
      rootEntries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of rootEntries) {
      if (!e.isFile() || isSidecarOrLog(e.name)) continue;
      for (const [re, kind] of SQLITE_PREFIX_KINDS) {
        if (re.test(e.name)) {
          const a = statAsset(root, e.name, kind, 'sqlite', { name: e.name.replace(/\.sqlite$/, '') });
          if (a) yield a;
          break;
        }
      }
    }

    // 3. 会话文件：sessions/**.jsonl（每文件一个会话）
    for (const f of walkFiles(root, 'sessions', { ignoreDirNames: IGNORE_DIRS })) {
      if (isSidecarOrLog(path.basename(f.abs)) || !f.rel.endsWith('.jsonl')) continue;
      const a = statAsset(root, toRel(root, f.abs), 'session', 'jsonl', { name: path.basename(f.rel, '.jsonl') });
      if (a) yield a;
    }

    // 4. skills / rules
    for (const f of walkFiles(root, 'skills', { ignoreDirNames: IGNORE_DIRS })) {
      if (isSidecarOrLog(path.basename(f.abs))) continue;
      const a = statAsset(root, toRel(root, f.abs), 'skill', 'text', { name: path.basename(f.abs) });
      if (a) yield a;
    }
    for (const f of walkFiles(root, 'rules', { ignoreDirNames: IGNORE_DIRS })) {
      if (isSidecarOrLog(path.basename(f.abs))) continue;
      const a = statAsset(root, toRel(root, f.abs), 'rule', 'text', { name: path.basename(f.abs) });
      if (a) yield a;
    }
  },
};
