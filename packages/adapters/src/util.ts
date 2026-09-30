import fs from 'node:fs';
import path from 'node:path';
import type { AssetKind, RawAsset, RawFormat } from '@walle/core';

/** 适配器共享工具：目录遍历 + 文件级资产构造 */

/** SQLite sidecar 与日志文件不作为独立资产 */
export function isSidecarOrLog(fileName: string): boolean {
  return fileName.endsWith('-shm') || fileName.endsWith('-wal') || fileName.endsWith('.log');
}

export interface WalkOptions {
  /** 目录名级忽略（如 tmp、cache） */
  ignoreDirNames?: string[];
  maxDepth?: number;
}

/** 递归遍历 root/sub，产出相对 sub 的正斜杠路径 */
export function* walkFiles(root: string, sub: string, opts: WalkOptions = {}): Generator<{ abs: string; rel: string }> {
  const base = path.join(root, sub);
  if (!fs.existsSync(base)) return;
  const ignore = new Set([...(opts.ignoreDirNames ?? []), 'node_modules']);
  const rec = function* (dir: string, relDir: string, depth: number): Generator<{ abs: string; rel: string }> {
    if (opts.maxDepth !== undefined && depth > opts.maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = relDir ? `${relDir}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (ignore.has(e.name)) continue;
        yield* rec(abs, rel, depth + 1);
      } else if (e.isFile()) {
        yield { abs, rel };
      }
    }
  };
  yield* rec(base, '', 0);
}

/** 把一个文件构造为 RawAsset；文件不存在或不是普通文件则返回 null */
export function statAsset(
  root: string,
  rel: string,
  kind: AssetKind,
  rawFormat: RawFormat,
  opts: { name?: string; sensitive?: boolean } = {},
): RawAsset | null {
  const abs = path.join(root, rel);
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    return {
      kind,
      path: rel.split(path.sep).join('/'),
      name: opts.name ?? path.basename(rel),
      rawFormat,
      size: st.size,
      mtime: st.mtime.toISOString(),
      sensitive: opts.sensitive ?? false,
    };
  } catch {
    return null;
  }
}

/** 把绝对路径转换为相对 root 的正斜杠路径 */
export function toRel(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/');
}
