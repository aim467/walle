import { DatabaseSync } from 'node:sqlite';
import type { RawAsset, AssetRecord, AssetKind, ParsedDoc, SessionMetaRow, SearchHit, SessionListRow } from './types.js';
import { cjkTokenize, buildFtsQuery } from './tokenize.js';

/**
 * 元数据库（开发文档 §3.2）。所有 SQL 访问收敛在此文件 ——
 * 若未来 node:sqlite API 破坏性变更，切换 better-sqlite3 只改这里（ADR-001 D2）。
 *
 * schema v2（P2）：新增 search_doc / asset_fts（FTS5）/ 多会话 session_meta / asset.index_hash。
 * v1→v2 为破坏性迁移（DROP 重建）：开发阶段元数据库是可重建的缓存，重扫即恢复。
 */

const SCHEMA_V2 = `
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
  status TEXT DEFAULT 'active',
  index_hash TEXT,
  indexed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_asset_source_path ON asset(source_id, path) WHERE status != 'deleted';
CREATE TABLE IF NOT EXISTS session_meta (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES asset(id),
  sub_id TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  title TEXT,
  model TEXT,
  message_count INTEGER,
  project_path TEXT,
  UNIQUE (asset_id, sub_id)
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
CREATE TABLE IF NOT EXISTS search_doc (
  id INTEGER PRIMARY KEY,
  asset_id INTEGER NOT NULL REFERENCES asset(id),
  sub_id TEXT NOT NULL DEFAULT '',
  doc_type TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  role TEXT,
  ts TEXT,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_search_doc_asset ON search_doc(asset_id, sub_id, seq);
CREATE VIRTUAL TABLE IF NOT EXISTS asset_fts USING fts5(text);
`;

type Row = Record<string, unknown>;

function toRow(v: unknown): Row {
  return (v ?? {}) as Row;
}
function num(v: unknown): number {
  return Number(v ?? 0);
}
function str(v: unknown): string | null {
  return v == null ? null : String(v);
}

export interface ListFilter {
  kind?: string;
  tool?: string;
  includeMissing?: boolean;
  limit?: number;
}

const ASSET_SELECT = `
  SELECT a.id, a.source_id, s.tool, a.kind, a.name, a.path, a.raw_format, a.content_hash,
         a.size, a.mtime, a.sensitive, a.status, a.first_seen_at, a.last_seen_at
  FROM asset a JOIN source s ON s.id = a.source_id`;

function mapAsset(raw: unknown): AssetRecord {
  const r = toRow(raw);
  return {
    id: num(r.id),
    sourceId: num(r.source_id),
    tool: String(r.tool),
    kind: String(r.kind) as AssetKind,
    name: str(r.name),
    path: String(r.path),
    rawFormat: str(r.raw_format),
    contentHash: str(r.content_hash),
    size: r.size == null ? null : num(r.size),
    mtime: str(r.mtime),
    sensitive: num(r.sensitive),
    status: String(r.status),
    firstSeenAt: String(r.first_seen_at),
    lastSeenAt: String(r.last_seen_at),
  };
}

export interface PendingIndexAsset {
  id: number;
  tool: string;
  kind: string;
  path: string;
  name: string | null;
  rawFormat: string | null;
  contentHash: string;
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
    if (current < 2) {
      // v1→v2 破坏性迁移：清空重建（元数据可由重扫恢复）。
      // DROP 需在 FK 关闭下进行（子表行存在时删父表会 FK 失败），按依赖顺序删除双保险。
      this.db.exec('PRAGMA foreign_keys = OFF');
      const tables = this.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as unknown[];
      for (const t of tables) this.db.exec(`DROP TABLE IF EXISTS "${toRow(t).name}"`);
      const idx = this.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'").all() as unknown[];
      for (const i of idx) this.db.exec(`DROP INDEX IF EXISTS "${toRow(i).name}"`);
      this.db.exec(SCHEMA_V2);
      this.db.exec('PRAGMA foreign_keys = ON');
      this.db.exec('PRAGMA user_version = 2');
    }
    // v1 首建也走同一段 DDL（IF NOT EXISTS 幂等）
    this.db.exec(SCHEMA_V2);
  }

  // ---------- source / asset（P1 能力，保持不变） ----------

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

  /** 当前未删除资产（含失踪——回归时需复活）：path -> 关键字段（用于增量比对） */
  getActiveAssets(sourceId: number): Map<string, { id: number; contentHash: string | null; size: number | null; mtime: string | null }> {
    const rows = this.db
      .prepare("SELECT id, path, content_hash, size, mtime FROM asset WHERE source_id = ? AND status IN ('active', 'missing')")
      .all(sourceId) as unknown[];
    const map = new Map<string, { id: number; contentHash: string | null; size: number | null; mtime: string | null }>();
    for (const raw of rows) {
      const r = toRow(raw);
      map.set(String(r.path), {
        id: num(r.id),
        contentHash: str(r.content_hash),
        size: r.size == null ? null : num(r.size),
        mtime: str(r.mtime),
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

  touchAsset(id: number, raw: RawAsset, now: string): void {
    this.db.prepare("UPDATE asset SET size = ?, mtime = ?, last_seen_at = ?, status = 'active' WHERE id = ?").run(raw.size, raw.mtime, now, id);
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
    const sql = `${ASSET_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.kind, a.path LIMIT ?`;
    params.push(filter.limit ?? 100);
    return (this.db.prepare(sql).all(...params) as unknown[]).map(mapAsset);
  }

  getAssetById(id: number): AssetRecord | null {
    const rows = this.db.prepare(`${ASSET_SELECT} WHERE a.id = ? LIMIT 1`).all(id) as unknown[];
    return rows.length ? mapAsset(rows[0]) : null;
  }

  countAssets(): number {
    return num(toRow(this.db.prepare('SELECT COUNT(*) AS c FROM asset').get()).c);
  }

  // ---------- P3：快照 ----------

  /** 记录一次内容版本（内容本身已在 CAS 中，按 hash 寻址） */
  addSnapshot(assetId: number, contentHash: string, size: number | null, now: string): number {
    const r = this.db
      .prepare('INSERT INTO snapshot (asset_id, captured_at, content_hash, size, storage_path) VALUES (?, ?, ?, ?, ?)')
      .run(assetId, now, contentHash, size, `objects/${contentHash.slice(0, 2)}/${contentHash.slice(2)}`);
    return num(r.lastInsertRowid);
  }

  listSnapshots(assetId: number): { id: number; capturedAt: string; contentHash: string; size: number | null }[] {
    return (this.db
      .prepare('SELECT id, captured_at, content_hash, size FROM snapshot WHERE asset_id = ? ORDER BY captured_at DESC, id DESC')
      .all(assetId) as unknown[]).map((raw) => {
      const r = toRow(raw);
      return {
        id: num(r.id),
        capturedAt: String(r.captured_at),
        contentHash: String(r.content_hash),
        size: r.size == null ? null : num(r.size),
      };
    });
  }

  // ---------- P2：索引 / 搜索 / 会话 ----------

  /** 待索引资产：active、非敏感、有内容哈希、且与已索引版本不同 */
  pendingIndex(): PendingIndexAsset[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, s.tool, a.kind, a.path, a.name, a.raw_format, a.content_hash
         FROM asset a JOIN source s ON s.id = a.source_id
         WHERE a.status = 'active' AND a.sensitive = 0 AND a.content_hash IS NOT NULL
           AND (a.index_hash IS NULL OR a.index_hash != a.content_hash)`,
      )
      .all() as unknown[];
    return rows.map((raw) => {
      const r = toRow(raw);
      return {
        id: num(r.id),
        tool: String(r.tool),
        kind: String(r.kind),
        path: String(r.path),
        name: str(r.name),
        rawFormat: str(r.raw_format),
        contentHash: String(r.content_hash),
      };
    });
  }

  resetAllIndexState(): void {
    this.db.exec('UPDATE asset SET index_hash = NULL, indexed_at = NULL');
  }

  clearIndex(): void {
    this.db.exec('DELETE FROM asset_fts');
    this.db.exec('DELETE FROM search_doc');
    this.db.exec('DELETE FROM session_meta');
  }

  deleteAssetDocs(assetId: number): void {
    const ids = (this.db.prepare('SELECT id FROM search_doc WHERE asset_id = ?').all(assetId) as unknown[]).map((r) => num(toRow(r).id));
    if (ids.length) {
      const del = this.db.prepare('DELETE FROM asset_fts WHERE rowid = ?');
      for (const id of ids) del.run(id);
    }
    this.db.prepare('DELETE FROM search_doc WHERE asset_id = ?').run(assetId);
    this.db.prepare('DELETE FROM session_meta WHERE asset_id = ?').run(assetId);
  }

  addDoc(assetId: number, doc: ParsedDoc): number {
    const r = this.db
      .prepare('INSERT INTO search_doc (asset_id, sub_id, doc_type, seq, role, ts, text) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(assetId, doc.subId ?? '', doc.docType ?? 'file', doc.seq, doc.role ?? null, doc.ts ?? null, doc.text);
    const id = num(r.lastInsertRowid);
    this.db.prepare('INSERT INTO asset_fts (rowid, text) VALUES (?, ?)').run(id, cjkTokenize(doc.text));
    return id;
  }

  addSessionMeta(assetId: number, row: SessionMetaRow): void {
    this.db
      .prepare(
        `INSERT INTO session_meta (asset_id, sub_id, started_at, title, model, message_count, project_path)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (asset_id, sub_id) DO UPDATE SET
           started_at = excluded.started_at, title = excluded.title, model = excluded.model,
           message_count = excluded.message_count, project_path = excluded.project_path`,
      )
      .run(assetId, row.subId, row.startedAt ?? null, row.title ?? null, row.model ?? null, row.messageCount ?? null, row.projectPath ?? null);
  }

  markIndexed(assetId: number, contentHash: string, now: string): void {
    this.db.prepare('UPDATE asset SET index_hash = ?, indexed_at = ? WHERE id = ?').run(contentHash, now, assetId);
  }

  search(query: string, filter: { tool?: string; kind?: string; limit?: number } = {}): SearchHit[] {
    const match = buildFtsQuery(query);
    if (!match) return [];
    const where = ['f.text MATCH ?', "a.status = 'active'"];
    const params: (string | number)[] = [match];
    if (filter.tool) {
      where.push('s.tool = ?');
      params.push(filter.tool);
    }
    if (filter.kind) {
      where.push('a.kind = ?');
      params.push(filter.kind);
    }
    const sql = `
      SELECT f.rowid doc_id, sd.asset_id, sd.sub_id, sd.doc_type, sd.role, a.kind, s.tool, a.path, a.name,
             sm.title session_title,
             snippet(asset_fts, 0, '«', '»', '…', 14) snip
      FROM asset_fts f
      JOIN search_doc sd ON sd.id = f.rowid
      JOIN asset a ON a.id = sd.asset_id
      JOIN source s ON s.id = a.source_id
      LEFT JOIN session_meta sm ON sm.asset_id = a.id AND sm.sub_id = sd.sub_id
      WHERE ${where.join(' AND ')}
      ORDER BY bm25(asset_fts)
      LIMIT ?`;
    params.push(filter.limit ?? 30);
    return (this.db.prepare(sql).all(...params) as unknown[]).map((raw) => {
      const r = toRow(raw);
      return {
        docId: num(r.doc_id),
        assetId: num(r.asset_id),
        subId: String(r.sub_id ?? ''),
        docType: String(r.doc_type),
        role: str(r.role),
        kind: String(r.kind),
        tool: String(r.tool),
        path: String(r.path),
        assetName: str(r.name),
        sessionTitle: str(r.session_title),
        snippet: String(r.snip ?? ''),
      };
    });
  }

  /** 按 path 片段找会话资产 id（noDocs 标题合并用，如 rollout 文件名含线程 uuid） */
  findAssetIdByPathFragment(tool: string, fragment: string): number | null {
    if (!fragment) return null;
    const r = toRow(
      this.db
        .prepare(
          `SELECT a.id FROM asset a JOIN source s ON s.id = a.source_id
           WHERE s.tool = ? AND a.kind = 'session' AND a.path LIKE ? LIMIT 1`,
        )
        .get(tool, `%${fragment}%`),
    );
    return r.id !== undefined ? num(r.id) : null;
  }

  /** 会话清单（按开始时间倒序） */
  listSessions(filter: { tool?: string; limit?: number } = {}): SessionListRow[] {
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.tool) {
      where.push('s.tool = ?');
      params.push(filter.tool);
    }
    const sql = `
      SELECT sm.asset_id, sm.sub_id, s.tool, a.path asset_path, sm.title, sm.model, sm.started_at, sm.project_path, sm.message_count
      FROM session_meta sm
      JOIN asset a ON a.id = sm.asset_id
      JOIN source s ON s.id = a.source_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY sm.started_at DESC NULLS LAST
      LIMIT ?`;
    params.push(filter.limit ?? 100);
    return (this.db.prepare(sql).all(...params) as unknown[]).map((raw) => {
      const r = toRow(raw);
      return {
        assetId: num(r.asset_id),
        subId: String(r.sub_id),
        tool: String(r.tool),
        assetPath: String(r.asset_path),
        title: str(r.title),
        model: str(r.model),
        startedAt: str(r.started_at),
        projectPath: str(r.project_path),
        messageCount: r.message_count == null ? null : num(r.message_count),
      };
    });
  }

  close(): void {
    this.db.close();
  }
}
