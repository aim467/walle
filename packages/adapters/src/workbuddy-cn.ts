import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, DiscoverContext, ParseMode, ParsedResult, RawAsset } from '@walle/core';
import { resolveToolRoot } from './roots.js';
import { parseWorkbuddyRollout, parseWorkbuddyDb } from './parse.js';
import { walkWorkbuddyBase } from './workbuddy.js';
import { collectProjectAssets } from './project-assets.js';

/**
 * WorkBuddy 国内版适配器（~/.workbuddy）。
 * 与国际版（workbuddy.ts，~/.workbuddy-ai）是不同账户的两个独立实例，目录结构同构，
 * 故扫描/解析逻辑复用 walkWorkbuddyBase；tool id 独立（workbuddy-cn）——
 * 资产、会话、用量统计、UI Tab 全部分开管理，UI 图标与文字靠 label 区分。
 * 格式细节见 docs/data-sources/workbuddy.md。
 */
export const workbuddyCnAdapter: Adapter = {
  id: 'workbuddy-cn',
  displayName: 'WorkBuddy 国内版',
  capabilities: { read: true, write: true },

  parse(contentPath, raw, mode: ParseMode): ParsedResult | null {
    if (raw.kind === 'session' && raw.path.endsWith('.jsonl')) return parseWorkbuddyRollout(contentPath, mode);
    if (raw.path === 'workbuddy.db') return parseWorkbuddyDb(contentPath);
    return null;
  },

  detect(rootOverride?: string): string | null {
    const root = rootOverride ?? resolveToolRoot('workbuddy-cn');
    try {
      return fs.statSync(root).isDirectory() ? root : null;
    } catch {
      return null;
    }
  },

  /** 项目级资产的 path 是绝对路径，直接返回（home 根相对路径照常拼接） */
  resolve(root: string, rel: string): string {
    return path.isAbsolute(rel) ? rel : path.resolve(root, rel);
  },

  async *discover(root: string, ctx?: DiscoverContext): AsyncIterable<RawAsset> {
    yield* walkWorkbuddyBase(root);
    // 项目级记忆：<项目>/.workbuddy/memory/*.md（国内版账户，与国际版点目录分开）
    yield* collectProjectAssets('workbuddy-cn', ctx?.projectRoots ?? [], root);
  },
};
