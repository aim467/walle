import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** 超过此大小的文件不入内容仓（只记元数据 + 哈希）。Codex logs_2.sqlite 117MB 是典型场景。 */
export const MAX_CONTENT_BYTES = 16 * 1024 * 1024;

/** 流式计算文件 sha256（大文件不整体载入内存） */
export function sha256File(absPath: string): string {
  const h = createHash('sha256');
  const fd = fs.openSync(absPath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    while (true) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      h.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

/**
 * 内容寻址存储（CAS）：objects/<hash 前 2 位>/<剩余 hash>。
 * 同一内容天然去重；put 返回 stored=false 表示已存在（幂等）。
 */
export class ContentStore {
  constructor(private readonly rootDir: string) {
    fs.mkdirSync(rootDir, { recursive: true });
  }

  pathFor(hash: string): string {
    return path.join(this.rootDir, hash.slice(0, 2), hash.slice(2));
  }

  has(hash: string): boolean {
    return fs.existsSync(this.pathFor(hash));
  }

  /** 哈希并按需入仓。超过 maxBytes 的文件只哈希不入仓。 */
  put(absPath: string, maxBytes = MAX_CONTENT_BYTES): { hash: string; stored: boolean; skipped: boolean } {
    const hash = sha256File(absPath);
    const size = fs.statSync(absPath).size;
    if (size > maxBytes) return { hash, stored: false, skipped: true };
    const target = this.pathFor(hash);
    if (fs.existsSync(target)) return { hash, stored: false, skipped: false };
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(absPath, target);
    return { hash, stored: true, skipped: false };
  }

  get(hash: string): Buffer | null {
    const p = this.pathFor(hash);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  }
}
