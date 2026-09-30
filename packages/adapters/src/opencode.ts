import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Adapter, ParseMode, ParsedResult, RawAsset } from '@walle/core';
import { statAsset } from './util.js';
import { parseFamilyDb } from './parse.js';

/**
 * opencode 适配器（P2）。
 * 双根：配置根 ~/.config/opencode（opencode.jsonc）；数据根 ~/.local/share/opencode
 * （opencode.db 会话库，schema 与 ZCode db.sqlite 同族，共用 parseFamilyDb）。
 * 资产 path 前缀 "data:" 锚定数据根。
 */

/** 数据根 ~/.local/share/opencode，WALLE_OPENCODE_DATA 供测试重定向 */
function dataRoot(): string {
  if (process.env.WALLE_OPENCODE_DATA) return process.env.WALLE_OPENCODE_DATA;
  return path.join(os.homedir(), '.local', 'share', 'opencode');
}

export const opencodeAdapter: Adapter = {
  id: 'opencode',
  displayName: 'opencode',
  capabilities: { read: true, write: false },

  detect(rootOverride?: string): string | null {
    const root = rootOverride ?? path.join(os.homedir(), '.config', 'opencode');
    try {
      return fs.statSync(root).isDirectory() ? root : null;
    } catch {
      return null;
    }
  },

  resolve(root: string, rel: string): string {
    if (rel.startsWith('data:')) return path.join(dataRoot(), rel.slice('data:'.length));
    return path.resolve(root, rel);
  },

  async *discover(root: string): AsyncIterable<RawAsset> {
    const cfg = statAsset(root, 'opencode.jsonc', 'config', 'json', { name: 'opencode-config' });
    if (cfg) yield cfg;

    const data = dataRoot();
    const auth = statAsset(data, 'auth.json', 'secret', 'json', { name: 'auth', sensitive: true });
    if (auth) {
      // path 前缀 data: 由 resolve 映射回数据根
      yield { ...auth, path: 'data:auth.json' };
    }
    const db = statAsset(data, 'opencode.db', 'session', 'sqlite', { name: 'opencode-db' });
    if (db) yield { ...db, path: 'data:opencode.db' };
  },

  parse(contentPath, raw, mode: ParseMode): ParsedResult | null {
    if (raw.kind === 'session' && raw.path.endsWith('.db')) return parseFamilyDb(contentPath, mode);
    return null;
  },
};
