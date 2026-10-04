import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** 超过此大小的文件不入内容仓（只记元数据 + 哈希）。Codex logs_2.sqlite 117MB 是典型场景；
 *  上限需容纳会话库本体：ZCode db.sqlite 2026-10 已 22MB+，会话资产超限等于整体失能。 */
export const MAX_CONTENT_BYTES = 64 * 1024 * 1024;

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
 * SQLite 运行中库的 WAL 合并：工具边用边写时，未 checkpoint 的数据只在 -wal 里，
 * 仅拷主文件会丢数据（会话数偏少、新记忆缺失）。把 主文件+wal(+shm) 复制到临时目录并
 * 打开一次（连接关闭时自动 checkpoint 回主文件），用合并后的副本入仓。
 * 合并是幂等的：逻辑数据不变则副本字节不变，不会造成扫描空转更新。
 * 返回合并副本路径；不适用（非 SQLite / 无 wal / 合并失败）返回 null。
 */
function mergeSqliteWal(absPath: string): string | null {
  try {
    const fd = fs.openSync(absPath, 'r');
    const head = Buffer.alloc(16);
    try {
      fs.readSync(fd, head, 0, 16, 0);
    } finally {
      fs.closeSync(fd);
    }
    if (!head.toString('latin1').startsWith('SQLite format 3')) return null;
    const wal = absPath + '-wal';
    if (!fs.existsSync(wal) || fs.statSync(wal).size === 0) return null;
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'walle-wal-'));
    const main = path.join(tmpDir, path.basename(absPath));
    fs.copyFileSync(absPath, main);
    fs.copyFileSync(wal, main + '-wal');
    const shm = absPath + '-shm';
    if (fs.existsSync(shm)) fs.copyFileSync(shm, main + '-shm');
    try {
      // 读写打开 + 显式 checkpoint：连接关闭时 SQLite 自动将 WAL 合并回主文件
      const db = new DatabaseSync(main);
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      db.close();
    } catch {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return null;
    }
    return main;
  } catch {
    return null;
  }
}

/**
 * 内容寻址存储（CAS）：objects/<hash 前 2 位>/<剩余 hash>。
 * 同一内容天然去重；put 返回 stored=false 表示已存在（幂等）。
 * SQLite 库带 -wal 时入仓合并后的副本（见 mergeSqliteWal）。
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
    const merged = mergeSqliteWal(absPath);
    const src = merged ?? absPath;
    try {
      const hash = sha256File(src);
      const size = fs.statSync(src).size;
      if (size > maxBytes) return { hash, stored: false, skipped: true };
      const target = this.pathFor(hash);
      if (fs.existsSync(target)) return { hash, stored: false, skipped: false };
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(src, target);
      return { hash, stored: true, skipped: false };
    } finally {
      if (merged) fs.rmSync(path.dirname(merged), { recursive: true, force: true });
    }
  }

  get(hash: string): Buffer | null {
    const p = this.pathFor(hash);
    return fs.existsSync(p) ? fs.readFileSync(p) : null;
  }
}
