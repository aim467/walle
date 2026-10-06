import fs from 'node:fs';
import path from 'node:path';
import type { AssetKind, RawAsset, RawFormat } from '@walle/core';
import { walkFiles } from './util.js';

/**
 * 项目级点目录采集（P5.2）。AI 工具会在工作目录下生成点目录存放项目记忆/技能（实测 2026-10-06）：
 *   <项目>/.workbuddy-ai/memory/ 下的 .md   —— WorkBuddy 国际版项目记忆（日志 + MEMORY.md 长期记忆）
 *   <项目>/.workbuddy/memory/ 下的 .md      —— WorkBuddy 国内版项目记忆（双账户语义与 home 根一致）
 *   <项目>/.agents/skills/<name>/SKILL.md   —— 项目级共享技能库
 * 项目根线索来自 session_meta.project_path（walle 已从会话得知用户在哪些目录工作），不做全盘扫描。
 * 资产 path 直接用绝对路径（POSIX 化）：扫描器/阅读器对绝对 rel 的 path.resolve(root, rel)
 * 原样返回，无需额外寻址协议。防重复：项目点目录若与适配器 home 根为同一目录
 * （realpath 相等，如 cwd=home 的会话线索），该文件已被 home 根扫描覆盖，跳过。
 */

interface ProjectDotDef {
  /** 项目内点目录名 */
  dir: string;
  /** 收集 memory 目录（含子目录）下的 .md 文件 */
  memory?: boolean;
  /** 收集 skills/<name>/SKILL.md */
  skills?: boolean;
}

export const PROJECT_DOT_DIRS: Record<string, ProjectDotDef> = {
  workbuddy: { dir: '.workbuddy-ai', memory: true },
  'workbuddy-cn': { dir: '.workbuddy', memory: true },
  agents: { dir: '.agents', skills: true },
};

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

function dirKey(p: string): string | null {
  try {
    const real = fs.realpathSync(p);
    return process.platform === 'win32' ? real.toLowerCase() : real;
  } catch {
    return null;
  }
}

/** 归一化项目根线索：realpath 解析真实大小写并去重；已消失/非目录的剔除 */
export function normalizeProjectRoots(roots: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of roots) {
    const p = raw.replace(/^\\\\\?\\/, '');
    const key = dirKey(p);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fs.realpathSync(p));
  }
  return out;
}

function fmtOf(file: string): RawFormat {
  if (file.endsWith('.md')) return 'markdown';
  if (file.endsWith('.json')) return 'json';
  return 'text';
}

function statProjectAsset(abs: string, kind: AssetKind, name: string): RawAsset | null {
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    return {
      kind,
      path: toPosix(abs),
      name,
      rawFormat: fmtOf(abs),
      size: st.size,
      mtime: st.mtime.toISOString(),
      sensitive: false, // 敏感判定交给扫描器内容级兜底
    };
  } catch {
    return null;
  }
}

/** 采集某工具在给定项目根下的项目级资产（tool 决定探测哪个点目录；adapterRoot 为 home 防护基准） */
export async function* collectProjectAssets(
  tool: string,
  projectRoots: string[],
  adapterRoot: string | null,
): AsyncIterable<RawAsset> {
  const def = PROJECT_DOT_DIRS[tool];
  if (!def || !projectRoots.length) return;
  for (const project of normalizeProjectRoots(projectRoots)) {
    const dotDir = path.join(project, def.dir);
    if (dirKey(dotDir) === null) continue;
    // home 根防护：点目录就是适配器自身根时已被 home 扫描覆盖，避免同文件双份入库
    if (adapterRoot && dirKey(dotDir) === dirKey(adapterRoot)) continue;
    if (def.memory) {
      for (const f of walkFiles(dotDir, 'memory')) {
        if (!f.rel.endsWith('.md')) continue;
        const a = statProjectAsset(f.abs, 'memory', path.basename(f.rel, '.md'));
        if (a) yield a;
      }
    }
    if (def.skills) {
      for (const f of walkFiles(dotDir, 'skills')) {
        // 只收技能目录内的 SKILL.md（skills/SKILL.md 顶层文件不是技能形态）
        if (!f.rel.endsWith('/SKILL.md')) continue;
        const a = statProjectAsset(f.abs, 'skill', f.rel.split('/')[0]);
        if (a) yield a;
      }
    }
  }
}
