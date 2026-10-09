import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, ParsedResult, RawAsset } from '@walle/core';
import { isSidecarOrLog, statAsset, toRel, walkFiles } from './util.js';
import { resolveToolRoot } from './roots.js';
import { parseClaudeSession } from './parse.js';

/**
 * Claude Code 适配器（v1.28）。格式细节见 docs/data-sources/claude.md（全部实测）。
 * 家目录 ~/.claude，本轮只收会话 + 项目记忆 + 技能三类：
 * - projects/<slug>/<sessionId>.jsonl —— 会话正文（kind=session，subId=sessionId，单文件含标题/用量/正文）
 * - projects/<slug>/memory/*.md —— 项目记忆（kind=memory；路径为根内相对，故面板归「根记忆」作用域）
 * - skills/<name>/SKILL.md —— 用户技能（kind=skill）
 * 不收：settings.json（含 API token ⚠️）、agents/、commands/、history.jsonl、plugins/（市场克隆）、
 * <sessionId>/subagents/ 侧链转录（非递归 projects 目录即结构性跳过）、todos/backups/cache/ide/
 * sessions/session-env/shell-snapshots/statsig 等运行时产物，以及家目录外的 ~/.claude.json。
 */

/** 列出 projects/ 下的项目 slug 目录（不存在返回空） */
function* listSlugs(root: string): Generator<string> {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(path.join(root, 'projects'), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) if (e.isDirectory()) yield e.name;
}

export const claudeAdapter: Adapter = {
  id: 'claude',
  displayName: 'Claude Code',
  parse(contentPath, raw): ParsedResult | null {
    if (raw.kind === 'session' && raw.path.endsWith('.jsonl')) return parseClaudeSession(contentPath, 'read');
    return null; // 记忆/技能走整文件文本兜底（indexer 默认分支）
  },

  capabilities: { read: true, write: false },

  detect(rootOverride?: string): string | null {
    const root = rootOverride ?? resolveToolRoot('claude');
    try {
      return fs.statSync(root).isDirectory() ? root : null;
    } catch {
      return null;
    }
  },

  async *discover(root: string): AsyncIterable<RawAsset> {
    for (const slug of listSlugs(root)) {
      // 1. 会话正文：只读 slug 目录下的文件（不递归——<sid>/ 下的 subagents 侧链结构性跳过）
      let files: fs.Dirent[] = [];
      try {
        files = fs.readdirSync(path.join(root, 'projects', slug), { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (f.name === 'subagents' || !f.isFile()) continue; // 防御性守卫：布局变动也不收侧链
        if (!f.name.endsWith('.jsonl') || isSidecarOrLog(f.name)) continue;
        const a = statAsset(root, `projects/${slug}/${f.name}`, 'session', 'jsonl', { name: f.name.replace(/\.jsonl$/, '') });
        if (a) yield a;
      }

      // 2. 项目记忆：projects/<slug>/memory/**/*.md（多数项目无此目录，try/catch 静默）
      for (const f of walkFiles(root, `projects/${slug}/memory`)) {
        if (!f.rel.endsWith('.md')) continue;
        const a = statAsset(root, toRel(root, f.abs), 'memory', 'markdown', { name: path.basename(f.rel, '.md') });
        if (a) yield a;
      }
    }

    // 3. 用户技能：skills/<name>/SKILL.md（只收技能定义文件，附属文件不收，与 agents 同口径）
    for (const f of walkFiles(root, 'skills', { ignoreDirNames: ['node_modules'] })) {
      if (!f.rel.endsWith('/SKILL.md')) continue;
      const a = statAsset(root, toRel(root, f.abs), 'skill', 'markdown', { name: path.basename(path.dirname(f.rel)) });
      if (a) yield a;
    }
  },
};
