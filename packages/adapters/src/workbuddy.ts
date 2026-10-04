import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, AssetKind, ParseMode, ParsedResult, RawAsset } from '@walle/core';
import { isSidecarOrLog, statAsset, toRel, walkFiles } from './util.js';
import { resolveToolRoot } from './roots.js';
import { parseWorkbuddyRollout, parseWorkbuddyDb } from './parse.js';

/**
 * WorkBuddy 适配器。格式细节见 docs/data-sources/workbuddy.md（全部实测）。
 * 单根 ~/.workbuddy-ai：会话正文在 projects/<项目slug>/<会话id>.jsonl；
 * workbuddy.db 是会话索引（标题/cwd/model）；skills/ 为技能，plugins/cache/ 为插件，
 * connectors/ 与 keyblob 含凭证（secret）；memory/ 与根身份文件是记忆/画像。
 * blobs / cache / logs / traces / binaries / app 等纯缓存与运行时目录一律排除。
 */

/**
 * 遍历时忽略的子目录。仅纳入会进入资产库的根目录（memory/skills/plugins/connectors/projects/tasks/audit-log）；
 * blobs、cache、logs、traces、binaries、app、storage、security、file-history 等纯缓存/运行时/二进制目录
 * 根本不被遍历，故无需列出。
 */
const IGNORE_DIRS = ['cache', 'tmp', 'logs', 'node_modules'];

/** 根下已知文件（相对 ~/.workbuddy-ai） */
const ROOT_FILES: { file: string; kind: AssetKind; name?: string; sensitive?: boolean }[] = [
  { file: 'settings.json', kind: 'config' },
  { file: 'mcp-approvals.json', kind: 'mcp', name: 'mcp-approvals' },
  { file: 'mcp-tool-list.json', kind: 'mcp', name: 'mcp-tool-list' },
  { file: 'models.json', kind: 'config' },
  { file: 'last-launch.json', kind: 'config', name: 'last-launch' },
  { file: 'user-state.json', kind: 'config', name: 'user-state' },
  { file: 'workspace-state.json', kind: 'config', name: 'workspace-state' },
  { file: 'epoch-marker.json', kind: 'other', name: 'epoch-marker' },
  { file: 'ioa-im-override.json', kind: 'config', name: 'ioa-im-override' },
  { file: 'usage-log.json', kind: 'other', name: 'usage-log' },
  { file: '.connectors-marketplace.meta.json', kind: 'config', name: 'connectors-marketplace-meta' },
  { file: '.skill-list-cache.json', kind: 'other', name: 'skill-list-cache' },
  // 身份 / 画像文件（持久化的"我是谁 / 用户是谁"）
  { file: 'SOUL.md', kind: 'memory', name: 'SOUL' },
  { file: 'IDENTITY.md', kind: 'memory', name: 'IDENTITY' },
  { file: 'USER.md', kind: 'memory', name: 'USER' },
  { file: 'BOOTSTRAP.md', kind: 'memory', name: 'BOOTSTRAP' },
  { file: 'MEMORY.md', kind: 'memory', name: 'MEMORY' },
  { file: 'skill-cloud-sync/market-config-migration.json', kind: 'config', name: 'market-config-migration' },
  // 会话索引库（sessions/workspaces/automations），标题由解析器合并到会话文件资产
  { file: 'workbuddy.db', kind: 'other', name: 'workbuddy-db' },
];

/** 凭证类根文件（密钥块） */
const ROOT_SECRETS: { file: string; name: string }[] = [{ file: 'keyblob', name: 'keyblob' }];

function fmt(rel: string): 'json' | 'jsonl' | 'sqlite' | 'markdown' | 'text' | 'toml' {
  if (rel.endsWith('.jsonl') || rel.endsWith('.ndjson')) return 'jsonl';
  if (rel.endsWith('.json')) return 'json';
  if (rel.endsWith('.sqlite') || rel.endsWith('.db')) return 'sqlite';
  if (rel.endsWith('.md')) return 'markdown';
  if (rel.endsWith('.toml')) return 'toml';
  return 'text';
}

/** 插件版本目录：优先带 .in_use 标记的版本，否则取字典序最大者（最新） */
function pickPluginVersion(pluginDir: string): string | null {
  let versions: string[];
  try {
    versions = fs.readdirSync(pluginDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return null;
  }
  if (!versions.length) return null;
  const inUse = versions.find((v) => fs.existsSync(path.join(pluginDir, v, '.in_use')));
  return inUse ?? versions[versions.length - 1];
}

export const workbuddyAdapter: Adapter = {
  id: 'workbuddy',
  displayName: 'WorkBuddy',
  capabilities: { read: true, write: true },

  parse(contentPath, raw, mode: ParseMode): ParsedResult | null {
    if (raw.kind === 'session' && raw.path.endsWith('.jsonl')) return parseWorkbuddyRollout(contentPath, mode);
    if (raw.path === 'workbuddy.db') return parseWorkbuddyDb(contentPath);
    return null;
  },

  detect(rootOverride?: string): string | null {
    const root = rootOverride ?? resolveToolRoot('workbuddy');
    try {
      return fs.statSync(root).isDirectory() ? root : null;
    } catch {
      return null;
    }
  },

  async *discover(root: string): AsyncIterable<RawAsset> {
    // 1. 根目录已知文件 + 凭证
    for (const { file, kind, name, sensitive } of ROOT_FILES) {
      const a = statAsset(root, file, kind, fmt(file), { name, sensitive });
      if (a) yield a;
    }
    for (const { file, name } of ROOT_SECRETS) {
      const a = statAsset(root, file, 'secret', fmt(file), { name, sensitive: true });
      if (a) yield a;
    }

    // 2. 记忆：memory/**.md（用户级长期记忆）
    for (const f of walkFiles(root, 'memory', { ignoreDirNames: IGNORE_DIRS })) {
      if (!f.rel.endsWith('.md')) continue;
      const a = statAsset(root, toRel(root, f.abs), 'memory', 'markdown', { name: path.basename(f.rel, '.md') });
      if (a) yield a;
    }

    // 3. 技能：skills/<name>/SKILL.md（每个技能一个资产，附属文件 P2 降噪不收）
    for (const f of walkFiles(root, 'skills', { ignoreDirNames: IGNORE_DIRS })) {
      if (path.basename(f.rel) !== 'SKILL.md') continue;
      const skillName = f.rel.split('/')[0];
      const a = statAsset(root, toRel(root, f.abs), 'skill', 'markdown', { name: skillName });
      if (a) yield a;
    }

    // 4. 插件：plugins/cache/<市场>/<插件>/<版本>/.codebuddy-plugin/plugin.json（取在用版本）
    try {
      const marketRoot = path.join(root, 'plugins', 'cache');
      for (const market of fs.readdirSync(marketRoot, { withFileTypes: true })) {
        if (!market.isDirectory()) continue;
        const marketDir = path.join(marketRoot, market.name);
        for (const plugin of fs.readdirSync(marketDir, { withFileTypes: true })) {
          if (!plugin.isDirectory()) continue;
          const pluginDir = path.join(marketDir, plugin.name);
          const ver = pickPluginVersion(pluginDir);
          if (!ver) continue;
          const rel = toRel(root, path.join(pluginDir, ver));
          const manifest = statAsset(root, `${rel}/.codebuddy-plugin/plugin.json`, 'plugin', 'json', { name: plugin.name });
          if (manifest) yield manifest;
          const mcpCfg = statAsset(root, `${rel}/.mcp.json`, 'mcp', 'json', { name: `${plugin.name}-mcp` });
          if (mcpCfg) yield mcpCfg;
        }
      }
    } catch {
      /* plugins/cache 不存在则跳过 */
    }

    // 5. 连接器：connectors/**/*.json 为配置，.master.key 为凭证
    for (const f of walkFiles(root, 'connectors', { ignoreDirNames: IGNORE_DIRS })) {
      const base = path.basename(f.rel);
      const rel = toRel(root, f.abs);
      if (base === '.master.key') {
        const a = statAsset(root, rel, 'secret', 'text', { name: 'connector-master-key', sensitive: true });
        if (a) yield a;
      } else if (base.endsWith('.json')) {
        const a = statAsset(root, rel, 'config', 'json', { name: base.replace(/\.json$/, '') });
        if (a) yield a;
      }
    }

    // 6. 会话：projects/<slug>/<会话id>.jsonl（file-rollback 侧车排除）
    for (const f of walkFiles(root, 'projects', { ignoreDirNames: IGNORE_DIRS })) {
      const base = path.basename(f.rel);
      if (!base.endsWith('.jsonl') || base.endsWith('.file-rollback.ndjson')) continue;
      if (isSidecarOrLog(base)) continue;
      const a = statAsset(root, toRel(root, f.abs), 'session', 'jsonl', { name: base.replace(/\.jsonl$/, '') });
      if (a) yield a;
    }

    // 7. 任务记录：tasks/<会话id>/<n>.json
    for (const f of walkFiles(root, 'tasks', { ignoreDirNames: IGNORE_DIRS })) {
      if (!f.rel.endsWith('.json') || isSidecarOrLog(path.basename(f.abs))) continue;
      const a = statAsset(root, toRel(root, f.abs), 'other', 'json', { name: 'task' });
      if (a) yield a;
    }

    // 8. 审计日志：audit-log/**/*.jsonl（安全决策留痕）
    for (const f of walkFiles(root, 'audit-log', { ignoreDirNames: IGNORE_DIRS })) {
      if (!f.rel.endsWith('.jsonl')) continue;
      const a = statAsset(root, toRel(root, f.abs), 'other', 'jsonl', { name: 'audit-log' });
      if (a) yield a;
    }
  },
};
