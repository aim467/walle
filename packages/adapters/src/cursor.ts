import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, AssetKind, ParseMode, ParsedResult, RawAsset } from '@walle/core';
import { isSidecarOrLog, statAsset, toRel, walkFiles } from './util.js';
import { resolveToolRoot } from './roots.js';
import { parseCursorConversationSearch, parseCursorTranscript } from './parse.js';

/**
 * Cursor 适配器（P2）。
 * 双根：配置根 ~/.cursor（mcp.json、skills-cursor、projects 下的 agent-transcripts）；应用根 ~/AppData/Roaming/Cursor（globalStorage 的 SQLite）。
 * state.vscdb 聊天消息经实测不可读：bubbleId:* 正文为空，composerData 带 blobEncryptionKey（见调研报告）——
 * 资产照常入库备份，全文索引不覆盖。
 * 会话正文绕行方案：~/.cursor/projects 下各项目的 agent-transcripts/<composerId>/<composerId>.jsonl 为明文 JSONL，
 * 作为 kind=session 资产入索引；conversation-search.db conversations 表为权威会话索引（noDocs 合并标题/时间）。
 */

const IGNORE_DIRS = ['extensions', 'plugins', 'cache'];

/** 应用根（Windows 为 %APPDATA%\Cursor）；可被配置覆盖 / WALLE_CURSOR_APPDATA 重定向 */
function appdataRoot(): string {
  return resolveToolRoot('cursor.appdata');
}

/** 应用根（AppData）下的资产，path 用 "appdata:" 前缀锚定 */
const APPDATA_FILES: { file: string; kind: AssetKind; name?: string }[] = [
  { file: 'User/globalStorage/state.vscdb', kind: 'other', name: 'cursor-state-db' },
  { file: 'User/globalStorage/conversation-search.db', kind: 'other', name: 'conversation-search-db' },
  { file: 'User/globalStorage/storage.json', kind: 'config' },
  { file: 'User/settings.json', kind: 'config' },
];

function fmt(rel: string): 'json' | 'jsonl' | 'sqlite' | 'markdown' | 'text' {
  if (rel.endsWith('.json')) return 'json';
  if (rel.endsWith('.jsonl')) return 'jsonl';
  if (rel.endsWith('.sqlite') || rel.endsWith('.db')) return 'sqlite';
  if (rel.endsWith('.md')) return 'markdown';
  return 'text';
}

export const cursorAdapter: Adapter = {
  id: 'cursor',
  displayName: 'Cursor',
  capabilities: { read: true, write: true },

  detect(rootOverride?: string): string | null {
    const root = rootOverride ?? resolveToolRoot('cursor');
    try {
      return fs.statSync(root).isDirectory() ? root : null;
    } catch {
      return null;
    }
  },

  resolve(root: string, rel: string): string {
    if (rel.startsWith('appdata:')) {
      return path.join(appdataRoot(), rel.slice('appdata:'.length));
    }
    return path.resolve(root, rel);
  },

  parse(contentPath, raw, _mode: ParseMode): ParsedResult | null {
    if (raw.path === 'appdata:User/globalStorage/conversation-search.db') {
      return parseCursorConversationSearch(contentPath);
    }
    if (raw.kind === 'session' && raw.path.includes('/agent-transcripts/')) {
      return parseCursorTranscript(contentPath, path.basename(raw.path).replace(/\.jsonl$/, ''));
    }
    return null;
  },

  async *discover(root: string): AsyncIterable<RawAsset> {
    // 1. 配置根已知文件
    const mcp = statAsset(root, 'mcp.json', 'mcp', 'json');
    if (mcp) yield mcp;
    const ideState = statAsset(root, 'ide_state.json', 'config', 'json');
    if (ideState) yield ideState;

    // 2. skills-cursor：每个技能目录的 SKILL.md 为一个资产（P2 降噪，不收附属文件）
    for (const f of walkFiles(root, 'skills-cursor', { ignoreDirNames: IGNORE_DIRS })) {
      if (!f.rel.endsWith('/SKILL.md') && f.rel !== 'SKILL.md') continue;
      const skillName = f.rel.split('/')[0];
      const a = statAsset(root, toRel(root, f.abs), 'skill', 'markdown', { name: skillName });
      if (a) yield a;
    }

    // 3. agents 目录（会话式 agent 记录）
    for (const f of walkFiles(root, 'agents', { ignoreDirNames: IGNORE_DIRS })) {
      if (isSidecarOrLog(path.basename(f.abs))) continue;
      const a = statAsset(root, toRel(root, f.abs), 'agent', 'text', { name: path.basename(f.abs) });
      if (a) yield a;
    }

    // 4. 应用根：聊天库与设置（state.vscdb 10MB 级，入内容仓 OK）
    // path 前缀 appdata: 由 resolve 映射回应用根（此前误用配置根拼接，这批资产从未被发现）
    const aroot = appdataRoot();
    for (const { file, kind, name } of APPDATA_FILES) {
      const a = statAsset(aroot, file, kind, fmt(file), { name });
      if (a) yield { ...a, path: `appdata:${file}` };
    }

    // 5. projects/*/agent-transcripts/<composerId>/<composerId>.jsonl：明文会话转录（正文来源）
    // 只收顶层转录；subagents/ 子代理转录与 .agent-data-cleanup-* 清理目录降噪跳过
    for (const f of walkFiles(root, 'projects', { ignoreDirNames: IGNORE_DIRS })) {
      if (!f.rel.includes('/agent-transcripts/') || !f.rel.endsWith('.jsonl')) continue;
      if (f.rel.includes('/subagents/')) continue;
      if (f.rel.split('/').some((seg) => seg.startsWith('.'))) continue;
      const a = statAsset(root, toRel(root, f.abs), 'session', 'jsonl', { name: path.basename(f.rel, '.jsonl') });
      if (a) yield a;
    }
  },
};
