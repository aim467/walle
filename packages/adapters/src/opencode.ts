import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, ParseMode, ParsedResult, RawAsset } from '@walle/core';
import { statAsset, toRel } from './util.js';
import { resolveToolRoot } from './roots.js';
import { parseFamilyDb } from './parse.js';

/**
 * opencode 适配器（P2）。
 * 双根：配置根 ~/.config/opencode（opencode.jsonc、skills/）；数据根 ~/.local/share/opencode
 * （opencode.db 会话库，schema 与 ZCode db.sqlite 同族，共用 parseFamilyDb；auth.json）。
 * 资产 path 前缀 "data:" 锚定数据根。
 * skills：配置根 skills/<name>/SKILL.md（v1.24 补，用户指正——opencode 有自己的技能目录，
 * 与 ZCode 链接接入共享库的形态并存）。
 */

/** 数据根 ~/.local/share/opencode；可被配置覆盖 / WALLE_OPENCODE_DATA 重定向 */
function dataRoot(): string {
  return resolveToolRoot('opencode.data');
}

export const opencodeAdapter: Adapter = {
  id: 'opencode',
  displayName: 'opencode',
  capabilities: { read: true, write: true },

  detect(rootOverride?: string): string | null {
    const root = rootOverride ?? resolveToolRoot('opencode');
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

    // skills/<name>/SKILL.md：每技能一个资产，技能名取 SKILL.md 父目录（附属文件不入库，对齐其他适配器）
    const skillsDir = path.join(root, 'skills');
    let skillEntries: fs.Dirent[] = [];
    try {
      skillEntries = fs.readdirSync(skillsDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of skillEntries) {
      if (!e.isDirectory()) continue;
      const rel = toRel(root, path.join(skillsDir, e.name, 'SKILL.md'));
      const a = statAsset(root, rel, 'skill', 'markdown', { name: e.name });
      if (a) yield a;
    }
  },

  parse(contentPath, raw, mode: ParseMode): ParsedResult | null {
    if (raw.kind === 'session' && raw.path.endsWith('.db')) return parseFamilyDb(contentPath, mode);
    return null;
  },
};
