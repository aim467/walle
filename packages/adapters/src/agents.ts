import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, DiscoverContext, RawAsset } from '@walle/core';
import { statAsset, toRel, walkFiles } from './util.js';
import { resolveToolRoot } from './roots.js';
import { collectProjectAssets } from './project-assets.js';

/**
 * agents 适配器（P5.2）：skills CLI 的跨工具共享技能库 ~/.agents。
 * 关键实测（2026-10-04）：Codex CLI 0.160 的二进制中硬编码了 `.agents/skills` 技能发现路径——
 * 该目录不只是存储仓库，本身就是 Codex 等工具的运行时技能源；ZCode 等则以符号链接接入
 * （见 docs/data-sources/agents.md）。只收 skills/<name>/SKILL.md 与 .skill-lock.json。
 */

const IGNORE_DIRS = ['node_modules', 'cache'];

export const agentsAdapter: Adapter = {
  id: 'agents',
  displayName: 'Skills 共享库',
  capabilities: { read: true, write: false },

  detect(rootOverride?: string): string | null {
    const root = rootOverride ?? resolveToolRoot('agents');
    try {
      return fs.statSync(root).isDirectory() ? root : null;
    } catch {
      return null;
    }
  },

  /** 项目级技能的 path 是绝对路径，直接返回（home 根相对路径照常拼接） */
  resolve(root: string, rel: string): string {
    return path.isAbsolute(rel) ? rel : path.resolve(root, rel);
  },

  async *discover(root: string, ctx?: DiscoverContext): AsyncIterable<RawAsset> {
    // 1. 共享技能本体：skills/<name>/SKILL.md
    for (const f of walkFiles(root, 'skills', { ignoreDirNames: IGNORE_DIRS })) {
      if (!f.rel.endsWith('/SKILL.md') && f.rel !== 'SKILL.md') continue;
      const skillName = path.basename(path.dirname(f.rel));
      const a = statAsset(root, toRel(root, f.abs), 'skill', 'markdown', { name: skillName });
      if (a) yield a;
    }

    // 2. 安装登记：.skill-lock.json（技能来源/哈希/安装时间，聚合视图用它识别本体）
    const lock = statAsset(root, '.skill-lock.json', 'config', 'json', { name: 'skill-lock' });
    if (lock) yield lock;

    // 3. 项目级技能：<项目>/.agents/skills/<name>/SKILL.md（线索来自 session_meta.project_path）
    yield* collectProjectAssets('agents', ctx?.projectRoots ?? [], root);
  },
};
