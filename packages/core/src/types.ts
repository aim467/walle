/** 资产类型（开发文档 §3.1） */
export type AssetKind =
  | 'config'
  | 'session'
  | 'memory'
  | 'skill'
  | 'knowledge'
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

/** discover 上下文：扫描器在遍历资产前可用的探测线索（P5.2 项目级采集） */
export interface DiscoverContext {
  /** 项目根绝对路径列表（来自 session_meta.project_path 线索或显式注入），适配器用它探测项目内点目录 */
  projectRoots: string[];
}

/** 适配器统一接口（开发文档 §4.3）。write 能力声明配合 WriteEngine 三保险使用；全局开关默认关闭。 */
export interface Adapter {
  id: string;
  displayName: string;
  /** 探测数据目录；rootOverride 用于测试/自定义路径，不存在返回 null */
  detect(rootOverride?: string): string | null;
  discover(root: string, ctx?: DiscoverContext): AsyncIterable<RawAsset>;
  /**
   * 相对路径 → 绝对路径。默认 path.resolve(root, rel)。
   * 多根工具（如 opencode 配置目录、Cursor 的 AppData）用 "config:" / "appdata:" 前缀锚定外部目录。
   */
  resolve?(root: string, rel: string): string;
  /** 结构化解析（会话等）。P2 起由索引器与阅读器调用 */
  parse?(contentPath: string, raw: { kind: AssetKind; path: string; tool: string; name?: string }, mode: ParseMode): ParsedResult | null;
  capabilities: { read: true; write: boolean };
}

/** 解析模式：index 给全文索引（过滤噪声、截断）；read 给阅读器（完整、含 developer/环境注入） */
export type ParseMode = 'index' | 'read';

export type DocType = 'session_message' | 'session_title' | 'session_file' | 'file';

export interface ParsedDoc {
  /** 多会话容器（如 ZCode/opencode 的 db.sqlite）内的会话 id；单会话文件可省略 */
  subId?: string;
  docType?: DocType;
  seq: number;
  role?: string | null;
  ts?: string | null;
  text: string;
}

/** 会话 token 用量（工具能提供的字段如实填充，取不到为 null——不硬造） */
export interface TokenUsage {
  input?: number | null;
  output?: number | null;
  reasoning?: number | null;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  total?: number | null;
  /** 成本数值，单位/币种由来源工具定义 */
  cost?: number | null;
}

export interface SessionMetaRow {
  subId: string;
  startedAt?: string | null;
  title?: string | null;
  model?: string | null;
  projectPath?: string | null;
  messageCount?: number | null;
  usage?: TokenUsage | null;
  /**
   * 标题来源记录（如 Codex session_index/state_5）：本身无消息文档。
   * 索引器会把 meta 合并到同工具下 path 含 subId 的会话资产上，而非挂在当前资产。
   */
  noDocs?: boolean;
}

export interface ParsedResult {
  docs: ParsedDoc[];
  sessions: SessionMetaRow[];
}

export interface SearchHit {
  docId: number;
  assetId: number;
  subId: string;
  docType: string;
  role: string | null;
  kind: string;
  tool: string;
  path: string;
  assetName: string | null;
  sessionTitle: string | null;
  snippet: string;
}

export interface SessionListRow {
  assetId: number;
  subId: string;
  tool: string;
  assetPath: string;
  title: string | null;
  model: string | null;
  startedAt: string | null;
  projectPath: string | null;
  messageCount: number | null;
  usage: TokenUsage | null;
}

/** 按工具聚合的 token 用量（store.usageByTool） */
export interface ToolUsageRow {
  tool: string;
  sessions: number;
  withUsage: number;
  input: number | null;
  output: number | null;
  reasoning: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  total: number | null;
  cost: number | null;
}

/** 逐日 token 用量（store.usageByDay，无数据的日期不返回） */
export interface UsageDayRow {
  day: string;
  input: number | null;
  output: number | null;
  total: number | null;
}

/** 按项目聚合的 token 用量（store.usageByProject） */
export interface UsageProjectRow {
  project: string;
  sessions: number;
  withUsage: number;
  input: number | null;
  output: number | null;
  total: number | null;
}

/** 统一记忆视图条目（store.memoriesOverview）：scope 区分根记忆与项目记忆 */
export interface MemoryEntry {
  assetId: number;
  tool: string;
  name: string;
  path: string;
  format: string | null;
  size: number | null;
  mtime: string | null;
  contentHash: string | null;
  sensitive: number;
  scope: 'global' | 'project';
  /** 项目记忆所属项目根（点目录之前的路径部分）；根记忆为 null */
  projectRoot: string | null;
}

/** 相似记忆分组（同名跨作用域 / 内容哈希一致） */
export interface MemorySimilarGroup {
  kind: 'name' | 'content';
  label: string;
  assetIds: number[];
}

export interface IndexStats {
  assetsIndexed: number;
  docsAdded: number;
  sessions: number;
  skippedSensitive: number;
  skippedNoContent: number;
  errors: string[];
  durationMs: number;
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
  /** 内容入仓上限（字节），超过只记元数据。默认 64MB */
  maxContentBytes?: number;
  /**
   * 项目级点目录探测线索（项目根绝对路径）。缺省由 store.sessionProjectPaths() 提供；
   * 显式传空数组表示禁用项目级探测（测试隔离用）。
   */
  projectRoots?: string[];
}
