import { DatabaseSync } from 'node:sqlite';
import type { RawAsset, AssetRecord, AssetKind } from './types.js';

/**
 * 元数据库（开发文档 §3.2）。所有 SQL 访问收敛在此文件 ——
 * 若未来 node:sqlite API 破坏性变更，切换 better-sqlite3 只改这里（ADR-001 D2）。
 */

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS source (
  id INTEGER PRIMARY KEY,
  tool TEXT NOT NULL UNIQUE,
  display_name TEXT,
  root_path TEXT NOT NULL,
  tool_version TEXT,
  last_scanned_at TEXT
);
CREATE TABLE IF NOT EXISTS asset (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES source(id),
  kind TEXT NOT NULL,
  name TEXT,
  path TEXT NOT NULL,
  raw_format TEXT,
  content_hash TEXT,
  size INTEGER,
  mtime TEXT,
  sensitive INTEGER DEFAULT 0,
  first_seen_at TEXT,
  last_seen_at TEXT,
  status TEXT DEFAULT 'active'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_source_path ON asset(source_id, path) WHERE status != 'deleted';
CREATE TABLE IF NOT EXISTS session_meta (
  asset_id INTEGER PRIMARY KEY REFERENCES asset(id)
);
CREATE TABLE IF NOT EXISTS snapshot (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES asset(id),
  captured_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size INTEGER,
  storage_path TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collection (id INTEGER PRIMARY KEY, name TEXT UNIQUE, note TEXT);
CREATE TABLE IF NOT EXISTS collection_item (
  collection_id INTEGER REFERENCES collection(id),
  asset_id INTEGER REFERENCES asset(id),
  PRIMARY KEY (collection_id, asset_id)
);
`;

type Row = Record<string, unknown>;

function toRow(v: unknown): Row {
  return (v ?? {}) as Row;
}
function num(v: unknown): number {
  return Number(v ?? 0);
}

export interface ListFilter {
  kind?: string;
  tool?: string;
  includeMissing?: boolean;
  limit?: number;
}

export class WalleStore {
  readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    const current = num(toRow(this.db.prepare('PRAGMA user_version').get()).user_version);
    if (current < 1) {
      this.db.exec(SCHEMA_V1);
      this.db.exec('PRAGMA user_version = 1');
    }
    // 后续版本在此追加 if (current < 2) { ... }
  }

  upsertSource(tool: string, displayName: string, rootPath: string): number {
    const existing = toRow(this.db.prepare('SELECT id FROM source WHERE tool = ?').get(tool));
    const now = new Date().toISOString();
    if (existing.id !== undefined) {
      this.db
        .prepare('UPDATE source SET display_name = ?, root_path = ?, last_scanned_at = ? WHERE id = ?')
        .run(displayName, rootPath, now, num(existing.id));
      return num(existing.id);
    }
    const r = this.db
      .prepare('INSERT INTO source (tool, display_name, root_path, last_scanned_at) VALUES (?, ?, ?, ?)')
      .run(tool, displayName, rootPath, now);
    return num(r.lastInsertRowid);
  }

  /** 当前 active 资产：path -> 关键字段（用于增量比对） */
  getActiveAssets(sourceId: number): Map<string, { id: number; contentHash: string | null; size: number | null; mtime: string | null }> {
    const rows = this.db
      .prepare("SELECT id, path, content_hash, size, mtime FROM asset WHERE source_id = ? AND status = 'active'")
      .all(sourceId) as unknown[];
    const map = new Map<string, { id: number; contentHash: string | null; size: number | null; mtime: string | null }>();
    for (const raw of rows) {
      const r = toRow(raw);
      map.set(String(r.path), {
        id: num(r.id),
        contentHash: r.content_hash == null ? null : String(r.content_hash),
        size: r.size == null ? null : num(r.size),
        mtime: r.mtime == null ? null : String(r.mtime),
      });
    }
    return map;
  }

  insertAsset(sourceId: number, raw: RawAsset, contentHash: string | null, now: string): number {
    const r = this.db
      .prepare(
        `INSERT INTO asset (source_id, kind, name, path, raw_format, content_hash, size, mtime, sensitive, first_seen_at, last_seen_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      )
      .run(sourceId, raw.kind, raw.name ?? null, raw.path, raw.rawFormat, contentHash, raw.size, raw.mtime, raw.sensitive ? 1 : 0, now, now);
    return num(r.lastInsertRowid);
  }

  updateAsset(id: number, raw: RawAsset, contentHash: string | null, now: string): void {
    this.db
      .prepare(
        `UPDATE asset SET kind = ?, name = ?, raw_format = ?, content_hash = ?, size = ?, mtime = ?, sensitive = ?, last_seen_at = ?, status = 'active'
         WHERE id = ?`,
      )
      .run(raw.kind, raw.name ?? null, raw.rawFormat, contentHash, raw.size, raw.mtime, raw.sensitive ? 1 : 0, now, id);
  }

  /** 内容未变但 mtime/size 变了（如 SQLite sidecar 合并）：只刷新定位信息，不视为变更 */
  touchAsset(id: number, raw: RawAsset, now: string): void {
    this.db.prepare('UPDATE asset SET size = ?, mtime = ?, last_seen_at = ? WHERE id = ?').run(raw.size, raw.mtime, now, id);
  }

  markMissing(sourceId: number, keepIds: Set<number>, now: string): number {
    let n = 0;
    const stmt = this.db.prepare("UPDATE asset SET status = 'missing', last_seen_at = ? WHERE id = ?");
    for (const row of this.db.prepare("SELECT id FROM asset WHERE source_id = ? AND status = 'active'").all(sourceId) as unknown[]) {
      const id = num(toRow(row).id);
      if (!keepIds.has(id)) {
        stmt.run(now, id);
        n++;
      }
    }
    return n;
  }

  listAssets(filter: ListFilter = {}): AssetRecord[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (!filter.includeMissing) where.push("a.status = 'active'");
    if (filter.kind) {
      where.push('a.kind = ?');
      params.push(filter.kind);
    }
    if (filter.tool) {
      where.push('s.tool = ?');
      params.push(filter.tool);
    }
    const sql = `
      SELECT a.id, a.source_id, s.tool, a.kind, a.name, a.path, a.raw_format, a.content_hash,
             a.size, a.mtime, a.sensitive, a.status, a.first_seen_at, a.last_seen_at
      FROM asset a JOIN source s ON s.id = a.source_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.kind, a.path
      LIMIT ?`;
    params.push(filter.limit ?? 100);
    return (this.db.prepare(sql).all(...params) as unknown[]).map((raw) => {
      const r = toRow(raw);
      return {
        id: num(r.id),
        sourceId: num(r.source_id),
        tool: String(r.tool),
        kind: String(r.kind) as AssetKind,
        name: r.name == null ? null : String(r.name),
        path: String(r.path),
        rawFormat: r.raw_format == null ? null : String(r.raw_format),
        contentHash: r.content_hash == null ? null : String(r.content_hash),
        size: r.size == null ? null : num(r.size),
        mtime: r.mtime == null ? null : String(r.mtime),
        sensitive: num(r.sensitive),
        status: String(r.status),
        firstSeenAt: String(r.first_seen_at),
        lastSeenAt: String(r.last_seen_at),
      };
    });
  }

  getAssetById(id: number): AssetRecord | null {
    const rows = this.listAssetsRaw(`WHERE a.id = ?`, [id], 1);
    return rows[0] ?? null;
  }

  private listAssetsRaw(where: string, params: (string | number)[], limit: number): AssetRecord[] {
    const sql = `
      SELECT a.id, a.source_id, s.tool, a.kind, a.name, a.path, a.raw_format, a.content_hash,
             a.size, a.mtime, a.sensitive, a.status, a.first_seen_at, a.last_seen_at
      FROM asset a JOIN source s ON s.id = a.source_id
      ${where} LIMIT ?`;
    const rows = this.db.prepare(sql).all(...params, limit) as unknown[];
    return rows.map((raw) => {
      const r = toRow(raw);
      return {
        id: num(r.id),
        sourceId: num(r.source_id),
        tool: String(r.tool),
        kind: String(r.kind) as AssetKind,
        name: r.name == null ? null : String(r.name),
        path: String(r.path),
        rawFormat: r.raw_format == null ? null : String(r.raw_format),
        contentHash: r.content_hash == null ? null : String(r.content_hash),
        size: r.size == null ? null : num(r.size),
        mtime: r.mtime == null ? null : String(r.mtime),
        sensitive: num(r.sensitive),
        status: String(r.status),
        firstSeenAt: String(r.first_seen_at),
        lastSeenAt: String(r.last_seen_at),
      };
    });
  }

  countAssets(): number {
    return num(toRow(this.db.prepare('SELECT COUNT(*) AS c FROM asset').get()).c);
  }

  close(): void {
    this.db.close();
  }
}
