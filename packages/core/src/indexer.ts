import fs from 'node:fs';
import type { Adapter, IndexStats, ParsedDoc, ParsedResult, SessionMetaRow } from './types.js';
import type { WalleStore } from './store.js';
import type { ContentStore } from './cas.js';

/** 单条索引文档的文本上限（截断，超长消息不整体入索引） */
const DOC_TEXT_LIMIT = 32 * 1024;
/** 单资产文档数上限（防御异常解析器产出海量文档） */
const DOCS_PER_ASSET_LIMIT = 5000;
/** 默认文件级索引的读取上限（超大文本文件截断入索引） */
const FILE_TEXT_LIMIT = 512 * 1024;

/**
 * P2 索引器：对 pendingIndex() 的资产建立全文索引（search_doc + FTS5）与 session_meta。
 * 增量依据 asset.index_hash vs content_hash；敏感资产在 SQL 层即被排除（开发文档 §8：永不入索引）。
 */
export function buildIndex(
  adapters: Adapter[],
  store: WalleStore,
  cas: ContentStore,
  opts: { rebuild?: boolean } = {},
): IndexStats {
  const started = Date.now();
  const stats: IndexStats = {
    assetsIndexed: 0,
    docsAdded: 0,
    sessions: 0,
    skippedSensitive: 0,
    skippedNoContent: 0,
    errors: [],
    durationMs: 0,
  };

  if (opts.rebuild) {
    store.clearIndex();
    store.resetAllIndexState();
  }

  const adapterById = new Map(adapters.map((a) => [a.id, a]));
  const now = new Date().toISOString();
  // noDocs 标题来源延后到所有资产 delete/insert 完成后统一合并，
  // 避免会话文件资产自身的 deleteAssetDocs 误删先期合并结果
  const deferredMerges: { tool: string; sm: SessionMetaRow; assetId: number }[] = [];

  for (const asset of store.pendingIndex()) {
    const contentPath = cas.pathFor(asset.contentHash);
    if (!fs.existsSync(contentPath)) {
      // 超过内容仓上限的大文件（如 logs_2.sqlite）：标记已索引避免反复重试
      store.markIndexed(asset.id, asset.contentHash, now);
      stats.skippedNoContent++;
      continue;
    }
    try {
      store.deleteAssetDocs(asset.id);
      let result: ParsedResult | null = null;
      const adapter = adapterById.get(asset.tool);
      if (adapter?.parse) {
        try {
          result = adapter.parse(contentPath, { kind: asset.kind as never, path: asset.path, tool: asset.tool, name: asset.name ?? undefined }, 'index');
        } catch (err) {
          stats.errors.push(`${asset.path} parse: ${(err as Error).message}`);
        }
      }

      let docs: ParsedDoc[];
      if (result) {
        docs = result.docs;
        for (const sm of result.sessions) {
          if (sm.noDocs) {
            deferredMerges.push({ tool: asset.tool, sm, assetId: asset.id });
            continue;
          }
          store.addSessionMeta(asset.id, sm);
          stats.sessions++;
          if (sm.title) {
            docs.push({ subId: sm.subId, docType: 'session_title', seq: -1, role: 'title', text: sm.title });
          }
        }
      } else if (asset.rawFormat === 'sqlite') {
        docs = []; // 二进制库无适配器解析时不做文件级索引
      } else {
        const text = fs.readFileSync(contentPath, 'utf8').slice(0, FILE_TEXT_LIMIT);
        docs = text.trim() ? [{ docType: 'file', seq: 0, text }] : [];
      }

      let added = 0;
      for (const doc of docs) {
        if (added >= DOCS_PER_ASSET_LIMIT) {
          stats.errors.push(`${asset.path}: 文档数超上限 ${DOCS_PER_ASSET_LIMIT}，截断`);
          break;
        }
        const text = doc.text.length > DOC_TEXT_LIMIT ? doc.text.slice(0, DOC_TEXT_LIMIT) : doc.text;
        store.addDoc(asset.id, { ...doc, text });
        added++;
      }
      store.markIndexed(asset.id, asset.contentHash, now);
      stats.assetsIndexed++;
      stats.docsAdded += added;
    } catch (err) {
      stats.errors.push(`${asset.path}: ${(err as Error).message}`);
    }
  }
  // 第二段：合并标题来源（session_index / state_5 / conversation-search → 会话文件资产）。
  // 找不到 path 含 subId 的会话文件资产时（如 Cursor 库中有记录但转录文件已清理），挂回元数据来源资产本身，
  // 保证会话仍出现在清单中（详情无正文是真实状态）。
  for (const { tool, sm, assetId } of deferredMerges) {
    const target = store.findAssetIdByPathFragment(tool, sm.subId) ?? assetId;
    store.addSessionMeta(target, sm);
    stats.sessions++;
    if (sm.title) {
      // 会话文件资产自己的标题文档（如 jsonl ai-title / 首条提问）先删后插，避免双写
      store.deleteSessionTitleDoc(target, sm.subId);
      store.addDoc(target, { subId: sm.subId, docType: 'session_title', seq: -1, role: 'title', text: sm.title });
    }
  }

  stats.durationMs = Date.now() - started;
  return stats;
}
