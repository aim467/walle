import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, RawAsset } from '@walle/core';
import { walkFiles } from './util.js';
import { resolveToolRoot } from './roots.js';

/**
 * walle 知识库适配器（P5.2 会话提炼）：扫 ~/.walle/knowledge/ 下的 .md 知识卡片/总结文档。
 * 卡片由 Web UI「提炼」流程创建（POST /api/knowledge），是 walle 自管的一等资产——
 * 真实文件落盘 + CAS 入仓 + FTS 索引 + /api/write 编辑快照，全部复用现有机制。
 * frontmatter 记录来源会话（tool/assetId/subId/title），UI 与 mcp 可溯源。
 */

export const knowledgeAdapter: Adapter = {
  id: 'walle',
  displayName: '知识库',
  capabilities: { read: true, write: true },

  detect(rootOverride?: string): string | null {
    const root = rootOverride ?? resolveToolRoot('walle.knowledge');
    try {
      return fs.statSync(root).isDirectory() ? root : null;
    } catch {
      return null;
    }
  },

  async *discover(root: string): AsyncIterable<RawAsset> {
    for (const f of walkFiles(root, '.')) {
      if (!f.rel.endsWith('.md')) continue;
      const st = fs.statSync(f.abs);
      yield {
        kind: 'knowledge',
        path: f.rel,
        name: path.basename(f.rel, '.md'),
        rawFormat: 'markdown',
        size: st.size,
        mtime: st.mtime.toISOString(),
        sensitive: false,
      };
    }
  },
};
