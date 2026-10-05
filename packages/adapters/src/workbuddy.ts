import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, AssetKind, ParseMode, ParsedResult, RawAsset } from '@walle/core';
import { isSidecarOrLog, statAsset, toRel, walkFiles } from './util.js';
import { resolveToolRoot } from './roots.js';
import { parseWorkbuddyRollout, parseWorkbuddyDb } from './parse.js';

/**
 * WorkBuddy 适配器。格式细节见 docs/data-sources/workbuddy.md（全部实测）。
 * 双根（cursor.appdata 同模式）：
 *   主根 ~/.workbuddy-ai（旧实例）/ 第二实例根 ~/.workbuddy（新实例，结构同构）。
 *   第二根资产路径打 'home:' 前缀（resolve 反解），tool id 不变 → UI 图标/标签自动复用。
 * 会话正文在 projects/<项目slug>/<会话id>.jsonl；workbuddy.db 是会话索引（标题/cwd/model）；
 * skills/ 为技能，plugins/cache/ 为插件，connectors/ 与 keyblob 含凭证（secret）；
 * memory/ 与根身份文件是记忆/画像。
 * blobs / cache / logs / traces / binaries / app / sessions（CLI 心跳元数据）等
 * 纯缓存与运行时目录/文件一律排除。
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

/** 版本号逐段数值比较（字典序会把 10.x 排在 9.x 前面）；不可解析的段按字符串比 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = /^\d+$/.test(pa[i] ?? '') ? Number(pa[i]) : NaN;
    const nb = /^\d+$/.test(pb[i] ?? '') ? Number(pb[i]) : NaN;
    if (!isNaN(na) && !isNaN(nb) && na !== nb) return na - nb;
    const sa = pa[i] ?? '';
    const sb = pb[i] ?? '';
    if (sa !== sb) return sa < sb ? -1 : 1;
  }
  return 0;
}

/** 插件版本目录：优先带 .in_use 标记的版本，否则取版本号最大者（最新） */
function pickPluginVersion(pluginDir: string): string | null {
  let versions: string[];
  try {
    versions = fs.readdirSync(pluginDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(compareVersions);
  } catch {
    return null;
  }
  if (!versions.length) return null;
  const inUse = versions.find((v) => fs.existsSync(path.join(pluginDir, v, '.in_use')));
  return inUse ?? versions[versions.length - 1];
}

/** 第二实例根（~/.workbuddy，新版 WorkBuddy home，结构与主根同构） */
function homeRoot(): string {
  return resolveToolRoot('workbuddy.home');
}

/** 遍历单个实例根下的全部可入库资产；prefix 为路径前缀（主根 ''，第二根 'home:'） */
async function* walkWorkbuddyBase(base: string, prefix: string): AsyncIterable<RawAsset> {
  // 1. 根目录已知文件 + 凭证
  for (const { file, kind, name, sensitive } of ROOT_FILES) {
    const a = statAsset(base, file, kind, fmt(file), { name, sensitive });
    if (a) yield { ...a, path: prefix + a.path };
  }
  for (const { file, name } of ROOT_SECRETS) {
    const a = statAsset(base, file, 'secret', fmt(file), { name, sensitive: true });
    if (a) yield { ...a, path: prefix + a.path };
  }

  // 2. 记忆：memory/**.md（用户级长期记忆）
  for (const f of walkFiles(base, 'memory', { ignoreDirNames: IGNORE_DIRS })) {
    if (!f.rel.endsWith('.md')) continue;
    const a = statAsset(base, toRel(base, f.abs), 'memory', 'markdown', { name: path.basename(f.rel, '.md') });
    if (a) yield { ...a, path: prefix + a.path };
  }

  // 3. 技能：skills/<name>/SKILL.md（每个技能一个资产，附属文件 P2 降噪不收）
  for (const f of walkFiles(base, 'skills', { ignoreDirNames: IGNORE_DIRS })) {
    if (path.basename(f.rel) !== 'SKILL.md') continue;
    const skillName = f.rel.split('/')[0];
    const a = statAsset(base, toRel(base, f.abs), 'skill', 'markdown', { name: skillName });
    if (a) yield { ...a, path: prefix + a.path };
  }

  // 4. 插件：plugins/cache/<市场>/<插件>/<版本>/.codebuddy-plugin/plugin.json（取在用版本）
  try {
    const marketRoot = path.join(base, 'plugins', 'cache');
    for (const market of fs.readdirSync(marketRoot, { withFileTypes: true })) {
      if (!market.isDirectory()) continue;
      const marketDir = path.join(marketRoot, market.name);
      for (const plugin of fs.readdirSync(marketDir, { withFileTypes: true })) {
        if (!plugin.isDirectory()) continue;
        const pluginDir = path.join(marketDir, plugin.name);
        const ver = pickPluginVersion(pluginDir);
        if (!ver) continue;
        const rel = toRel(base, path.join(pluginDir, ver));
        const manifest = statAsset(base, `${rel}/.codebuddy-plugin/plugin.json`, 'plugin', 'json', { name: plugin.name });
        if (manifest) yield { ...manifest, path: prefix + manifest.path };
        const mcpCfg = statAsset(base, `${rel}/.mcp.json`, 'mcp', 'json', { name: `${plugin.name}-mcp` });
        if (mcpCfg) yield { ...mcpCfg, path: prefix + mcpCfg.path };
      }
    }
  } catch {
    /* plugins/cache 不存在则跳过 */
  }

  // 5. 连接器：connectors/**/*.json 为配置，.master.key 为凭证
  for (const f of walkFiles(base, 'connectors', { ignoreDirNames: IGNORE_DIRS })) {
    const baseName = path.basename(f.rel);
    const rel = toRel(base, f.abs);
    if (baseName === '.master.key') {
      const a = statAsset(base, rel, 'secret', 'text', { name: 'connector-master-key', sensitive: true });
      if (a) yield { ...a, path: prefix + a.path };
    } else if (baseName.endsWith('.json')) {
      const a = statAsset(base, rel, 'config', 'json', { name: baseName.replace(/\.json$/, '') });
      if (a) yield { ...a, path: prefix + a.path };
    }
  }

  // 6. 会话：projects/<slug>/<会话id>.jsonl（file-rollback 侧车排除）
  for (const f of walkFiles(base, 'projects', { ignoreDirNames: IGNORE_DIRS })) {
    const baseName = path.basename(f.rel);
    if (!baseName.endsWith('.jsonl') || baseName.endsWith('.file-rollback.ndjson')) continue;
    if (isSidecarOrLog(baseName)) continue;
    const a = statAsset(base, toRel(base, f.abs), 'session', 'jsonl', { name: baseName.replace(/\.jsonl$/, '') });
    if (a) yield { ...a, path: prefix + a.path };
  }

  // 7. 任务记录：tasks/<会话id>/<n>.json
  for (const f of walkFiles(base, 'tasks', { ignoreDirNames: IGNORE_DIRS })) {
    if (!f.rel.endsWith('.json') || isSidecarOrLog(path.basename(f.abs))) continue;
    const a = statAsset(base, toRel(base, f.abs), 'other', 'json', { name: 'task' });
    if (a) yield { ...a, path: prefix + a.path };
  }

  // 8. 审计日志：audit-log/**/*.jsonl（安全决策留痕）
  for (const f of walkFiles(base, 'audit-log', { ignoreDirNames: IGNORE_DIRS })) {
    if (!f.rel.endsWith('.jsonl')) continue;
    const a = statAsset(base, toRel(base, f.abs), 'other', 'jsonl', { name: 'audit-log' });
    if (a) yield { ...a, path: prefix + a.path };
  }
}

export const workbuddyAdapter: Adapter = {
  id: 'workbuddy',
  displayName: 'WorkBuddy',
  capabilities: { read: true, write: true },

  parse(contentPath, raw, mode: ParseMode): ParsedResult | null {
    if (raw.kind === 'session' && raw.path.endsWith('.jsonl')) return parseWorkbuddyRollout(contentPath, mode);
    if (raw.path === 'workbuddy.db' || raw.path.endsWith(':workbuddy.db')) return parseWorkbuddyDb(contentPath);
    return null;
  },

  /** 资产相对路径 → 磁盘绝对路径（'home:' 前缀指向第二实例根） */
  resolve(root: string, rel: string): string {
    if (rel.startsWith('home:')) return path.join(homeRoot(), rel.slice('home:'.length));
    return path.resolve(root, rel);
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
    yield* walkWorkbuddyBase(root, '');
    // 第二实例根（~/.workbuddy）：不存在则静默跳过
    try {
      const home = homeRoot();
      if (fs.statSync(home).isDirectory()) yield* walkWorkbuddyBase(home, 'home:');
    } catch {
      /* 第二实例根未配置或不可访问 */
    }
  },
};
