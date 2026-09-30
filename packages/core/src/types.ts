/** 资产类型（开发文档 §3.1） */
export type AssetKind =
  | 'config'
  | 'session'
  | 'memory'
  | 'skill'
  | 'mcp'
  | 'rule'
  | 'prompt'
  | 'agent'
  | 'plugin'
  | 'secret'
  | 'other';

export type RawFormat = 'jsonl' | 'toml' | 'json' | 'sqlite' | 'markdown' | 'text' | 'dir';

/** 适配器产出的未入库资产（文件级） */
export interface RawAsset {
  kind: AssetKind;
  /** 相对 source 根目录，统一正斜杠 */
  path: string;
  name?: string;
  rawFormat: RawFormat;
  size: number;
  /** ISO 时间戳 */
  mtime: string;
  /** 适配器按文件名判定的敏感标记；扫描器还会做内容级兜底扫描 */
  sensitive: boolean;
}

/** 适配器统一接口（开发文档 §4.3）。P1-P3 所有适配器 write 均不可用。 */
export interface Adapter {
  id: string;
  displayName: string;
  /** 探测数据目录；rootOverride 用于测试/自定义路径，不存在返回 null */
  detect(rootOverride?: string): string | null;
  discover(root: string): AsyncIterable<RawAsset>;
  capabilities: { read: true; write: false };
}

/** DB 中的资产记录 */
export interface AssetRecord {
  id: number;
  sourceId: number;
  tool: string;
  kind: AssetKind;
  name: string | null;
  path: string;
  rawFormat: string | null;
  contentHash: string | null;
  size: number | null;
  mtime: string | null;
  sensitive: number;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SourceScanResult {
  tool: string;
  displayName: string;
  root: string | null;
  scanned: boolean;
  total: number;
  new: number;
  updated: number;
  unchanged: number;
  missing: number;
  byKind: Record<string, number>;
  errors: string[];
  durationMs: number;
}

export interface ScanOptions {
  /** 覆盖适配器根目录：{ codex: 'D:/x', zcode: 'D:/y' } */
  roots?: Record<string, string>;
  /** 只扫描指定源 */
  sources?: string[];
  /** 内容入仓上限（字节），超过只记元数据。默认 16MB */
  maxContentBytes?: number;
}
