import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, ParsedResult, RawAsset } from '@walle/core';
import { statAsset, toRel } from './util.js';
import { resolveToolRoot } from './roots.js';
import { parseClineSession, parseClineSessionMeta } from './parse.js';

/**
 * Cline 适配器（v1.24）。格式细节见 docs/data-sources/cline.md（全部实测）。
 * Cline CLI/desktop 的家目录是 ~/.cline（与 VS Code 扩展共享）：
 * - data/sessions/<sessionId>/<sessionId>.messages.json —— 会话正文（kind=session）
 * - data/sessions/<sessionId>/<sessionId>.json —— 会话元数据（标题/用量/项目，noDocs 合并）
 * - data/globalState.json —— 配置状态（kind=config）；data/secrets.json —— API key（kind=secret）
 * - data/db/*.db、data/cache、data/checkpoint-scratch、data/logs、apps/<name>/sessions 流式日志
 *   均为内部运行时产物，不入库
 */

/** 会话目录扫描：正文与元数据各自存在即入库（只有元数据的孤儿会话也保留，挂回元数据资产本身） */
function* walkSessionDirs(root: string): Generator<{ dir: string; rel: string }> {
  const base = path.join(root, 'data', 'sessions');
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(base, e.name);
    if (!fs.existsSync(path.join(dir, `${e.name}.messages.json`)) && !fs.existsSync(path.join(dir, `${e.name}.json`))) continue;
    yield { dir, rel: toRel(root, dir) };
  }
}

export const clineAdapter: Adapter = {
  id: 'cline',
  displayName: 'Cline',
  parse(contentPath, raw): ParsedResult | null {
    if (raw.kind === 'session' && raw.path.endsWith('.messages.json')) return parseClineSession(contentPath, 'read');
    if (raw.kind === 'other' && raw.name?.endsWith('-meta') && raw.path.startsWith('data/sessions/')) return parseClineSessionMeta(contentPath);
    return null;
  },

  capabilities: { read: true, write: false },

  detect(rootOverride?: string): string | null {
    const root = rootOverride ?? resolveToolRoot('cline');
    try {
      return fs.statSync(root).isDirectory() ? root : null;
    } catch {
      return null;
    }
  },

  async *discover(root: string): AsyncIterable<RawAsset> {
    // 1. 会话目录：正文 + 元数据各自入库（元数据 noDocs 合并到正文资产；孤儿元数据挂自身）
    for (const { dir, rel } of walkSessionDirs(root)) {
      const sessionId = path.basename(dir);
      const msgs = statAsset(root, `${rel}/${sessionId}.messages.json`, 'session', 'json', { name: sessionId });
      if (msgs) yield msgs;
      const meta = statAsset(root, `${rel}/${sessionId}.json`, 'other', 'json', { name: `${sessionId}-meta` });
      if (meta) yield meta;
    }

    // 2. 配置状态与密钥
    const gs = statAsset(root, 'data/globalState.json', 'config', 'json', { name: 'global-state' });
    if (gs) yield gs;
    const secrets = statAsset(root, 'data/secrets.json', 'secret', 'json', { name: 'secrets', sensitive: true });
    if (secrets) yield secrets;
  },
};
