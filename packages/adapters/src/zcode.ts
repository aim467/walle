import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, AssetKind, ParseMode, ParsedResult, RawAsset } from '@walle/core';
import { isSidecarOrLog, statAsset, toRel, walkFiles } from './util.js';
import { resolveToolRoot } from './roots.js';
import { parseFamilyDb } from './parse.js';

/**
 * ZCode 适配器。格式细节见 docs/data-sources/zcode.md（全部实测）。
 * 会话本体在 cli/db/db.sqlite；rollout 是模型 I/O 遥测；v2/credentials.json 是高敏感凭证。
 */

const IGNORE_DIRS = ['exec', 'log', 'cache', 'crash', 'certs', 'runtime', 'logs', 'tmp'];

/** 根下已知文件（相对 ~/.zcode） */
const ROOT_FILES: { file: string; kind: AssetKind; name?: string; sensitive?: boolean }[] = [
  { file: 'cli/db/db.sqlite', kind: 'session', name: 'session-db' },
  { file: 'cli/plugins/known_marketplaces.json', kind: 'plugin', name: 'known-marketplaces' },
  { file: 'v2/credentials.json', kind: 'secret', name: 'credentials', sensitive: true },
  { file: 'v2/provider_config.json', kind: 'config' },
  { file: 'v2/setting.json', kind: 'config' },
  { file: 'v2/onboarding-record.json', kind: 'config' },
  { file: 'v2/telemetry-state.json', kind: 'config' },
];

function fmt(rel: string): 'jsonl' | 'json' | 'sqlite' | 'markdown' {
  if (rel.endsWith('.jsonl')) return 'jsonl';
  if (rel.endsWith('.json')) return 'json';
  if (rel.endsWith('.sqlite')) return 'sqlite';
  return 'markdown';
}

export const zcodeAdapter: Adapter = {
  id: 'zcode',
  displayName: 'ZCode',
  parse(contentPath, raw, mode: ParseMode): ParsedResult | null {
    if (raw.kind === 'session' && raw.path.endsWith('.sqlite')) return parseFamilyDb(contentPath, mode);
    return null;
  },

  capabilities: { read: true, write: true },

  detect(rootOverride?: string): string | null {
    const root = rootOverride ?? resolveToolRoot('zcode');
    try {
      return fs.statSync(root).isDirectory() ? root : null;
    } catch {
      return null;
    }
  },

  async *discover(root: string): AsyncIterable<RawAsset> {
    // 1. 已知文件（含版本化命名的 bot-config.v3.json / tasks-index.sqlite 用 glob 兜底）
    for (const { file, kind, name, sensitive } of ROOT_FILES) {
      const a = statAsset(root, file, kind, fmt(file), { name, sensitive });
      if (a) yield a;
    }
    try {
      for (const e of fs.readdirSync(path.join(root, 'v2'), { withFileTypes: true })) {
        if (!e.isFile() || isSidecarOrLog(e.name)) continue;
        if (/^bot-(config|state)\.v\d+\.json$/.test(e.name)) {
          const a = statAsset(root, `v2/${e.name}`, 'config', 'json', { name: e.name.replace(/\.v\d+\.json$/, '') });
          if (a) yield a;
        } else if (/^tasks-index.*\.sqlite$/.test(e.name)) {
          const a = statAsset(root, `v2/${e.name}`, 'other', 'sqlite', { name: 'tasks-index' });
          if (a) yield a;
        }
      }
    } catch {
      /* v2 不存在则跳过 */
    }

    // 2. 记忆：cli/memories/**.md（含 MEMORY.md 索引）
    for (const f of walkFiles(root, 'cli/memories', { ignoreDirNames: IGNORE_DIRS })) {
      if (!f.rel.endsWith('.md')) continue;
      const a = statAsset(root, toRel(root, f.abs), 'memory', 'markdown', { name: path.basename(f.rel, '.md') });
      if (a) yield a;
    }

    // 3. 模型 I/O 遥测：cli/rollout/*.jsonl
    for (const f of walkFiles(root, 'cli/rollout', { ignoreDirNames: IGNORE_DIRS, maxDepth: 1 })) {
      if (isSidecarOrLog(path.basename(f.abs)) || !f.rel.endsWith('.jsonl')) continue;
      const a = statAsset(root, toRel(root, f.abs), 'other', 'jsonl', { name: `model-io:${path.basename(f.rel, '.jsonl').replace(/^model-io-/, '')}` });
      if (a) yield a;
    }

    // 4. 子代理记录：cli/agents/**
    for (const f of walkFiles(root, 'cli/agents', { ignoreDirNames: IGNORE_DIRS })) {
      if (isSidecarOrLog(path.basename(f.abs))) continue;
      const a = statAsset(root, toRel(root, f.abs), 'agent', 'text', { name: path.basename(f.abs) });
      if (a) yield a;
    }

    // cli/artifacts/**（大体积工具结果转储）不再入库：正文本就在 db.sqlite 的 tool part 中，
    // 资产库与索引被数百个转储文件刷屏（降噪）；需要原文时由会话详情 Files 页签按需读取（/api/artifacts）。
  },
};
