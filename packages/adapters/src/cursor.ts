import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Adapter, AssetKind, RawAsset } from '@walle/core';
import { isSidecarOrLog, statAsset, toRel, walkFiles } from './util.js';

/**
 * Cursor 适配器（P2）。
 * 双根：配置根 ~/.cursor（mcp.json、skills-cursor）；应用根 ~/AppData/Roaming/Cursor（globalStorage 的 SQLite）。
 * 聊天消息解析经实测搁置：bubbleId:* 正文为空，composerData 带 blobEncryptionKey（见调研报告）——
 * 资产照常入库备份，全文索引暂不覆盖 Cursor 聊天。
 */

const IGNORE_DIRS = ['extensions', 'plugins', 'cache'];

/** 应用根（Windows 为 %APPDATA%\Cursor），WALLE_CURSOR_APPDATA 供测试重定向 */
function appdataRoot(): string {
  if (process.env.WALLE_CURSOR_APPDATA) return process.env.WALLE_CURSOR_APPDATA;
  return process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Cursor')
    : path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor');
}

/** 应用根（AppData）下的资产，path 用 "appdata:" 前缀锚定 */
const APPDATA_FILES: { file: string; kind: AssetKind; name?: string }[] = [
  { file: 'User/globalStorage/state.vscdb', kind: 'other', name: 'cursor-state-db' },
  { file: 'User/globalStorage/conversation-search.db', kind: 'other', name: 'conversation-search-db' },
  { file: 'User/globalStorage/storage.json', kind: 'config' },
  { file: 'User/settings.json', kind: 'config' },
];

function fmt(rel: string): 'json' | 'sqlite' | 'markdown' | 'text' {
  if (rel.endsWith('.json')) return 'json';
  if (rel.endsWith('.sqlite') || rel.endsWith('.db')) return 'sqlite';
  if (rel.endsWith('.md')) return 'markdown';
  return 'text';
}

export const cursorAdapter: Adapter = {
  id: 'cursor',
  displayName: 'Cursor',
  capabilities: { read: true, write: true },

  detect(rootOverride?: string): string | null {
    const root = rootOverride ?? path.join(os.homedir(), '.cursor');
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
    for (const { file, kind, name } of APPDATA_FILES) {
      const a = statAsset(root, file, kind, fmt(file), { name });
      if (a) yield a;
    }
  },
};
