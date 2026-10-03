import fs from 'node:fs';
import path from 'node:path';
import type { Adapter, RawAsset, ScanOptions, SourceScanResult } from './types.js';
import type { WalleStore } from './store.js';
import type { ContentStore } from './cas.js';
import { looksSensitive } from './sensitive.js';

/** 读取文件头用于敏感内容兜底扫描 */
function readHead(absPath: string, bytes: number): string {
  const fd = fs.openSync(absPath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, null);
    return buf.subarray(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 扫描引擎：驱动各适配器发现资产，做增量比对与内容入仓。
 * 增量策略：(size, mtime) 未变 → 跳过哈希；变化 → 重哈希，内容不同才算 updated。
 * 例外：内容未变但元数据（kind/name/raw_format）漂移，或资产曾失踪，则只刷新元数据（不重哈希、不留快照）。
 * 幂等性：稳定资产在第二次扫描中零写入（不更新 last_seen）。
 */
export async function runScan(
  adapters: Adapter[],
  store: WalleStore,
  cas: ContentStore,
  opts: ScanOptions = {},
): Promise<SourceScanResult[]> {
  const maxBytes = opts.maxContentBytes ?? 16 * 1024 * 1024;
  const results: SourceScanResult[] = [];

  for (const adapter of adapters) {
    if (opts.sources && !opts.sources.includes(adapter.id)) continue;
    const started = Date.now();
    const result: SourceScanResult = {
      tool: adapter.id,
      displayName: adapter.displayName,
      root: null,
      scanned: false,
      total: 0,
      new: 0,
      updated: 0,
      unchanged: 0,
      missing: 0,
      byKind: {},
      errors: [],
      durationMs: 0,
    };

    const root = adapter.detect(opts.roots?.[adapter.id]);
    result.root = root;
    if (!root) {
      result.durationMs = Date.now() - started;
      results.push(result);
      continue;
    }
    result.scanned = true;
    const sourceId = store.upsertSource(adapter.id, adapter.displayName, root);
    const existing = store.getActiveAssets(sourceId);
    const keepIds = new Set<number>();
    const now = new Date().toISOString();

    try {
      for await (const raw of adapter.discover(root)) {
        result.total++;
        result.byKind[raw.kind] = (result.byKind[raw.kind] ?? 0) + 1;
        const prev = existing.get(raw.path);

        // 快路径：size+mtime+元数据均未变 → 视为 unchanged（不读内容、零写入）
        // 元数据（kind/name/raw_format）变化必须落到库里，否则适配器改了建模语义，旧行永远纠正不过来。
        if (prev && prev.size === raw.size && prev.mtime === raw.mtime && prev.contentHash) {
          const metaSame = prev.kind === raw.kind && prev.name === (raw.name ?? null) && prev.rawFormat === raw.rawFormat;
          if (!metaSame || prev.status === 'missing') {
            store.updateAssetMeta(prev.id, raw, now); // 内容未变：不重哈希、不留快照
            result.updated++;
          } else {
            result.unchanged++;
          }
          keepIds.add(prev.id);
          continue;
        }

        try {
          // 敏感兜底：内容头部扫描（适配器的文件名级判定先生效）
          const abs = adapter.resolve ? adapter.resolve(root, raw.path) : path.resolve(root, raw.path);
          let sensitive = raw.sensitive;
          if (!sensitive) {
            try {
              sensitive = looksSensitive(readHead(abs, 64 * 1024));
            } catch {
              /* 不可读时仅按文件名判定 */
            }
          }
          raw.sensitive = sensitive;

          const { hash } = cas.put(abs, maxBytes);
          if (!prev) {
            const id = store.insertAsset(sourceId, raw, hash, now);
            store.addSnapshot(id, hash, raw.size, now); // 初始版本
            keepIds.add(id);
            result.new++;
          } else if (prev.contentHash === hash) {
            store.touchAsset(prev.id, raw, now);
            keepIds.add(prev.id);
            result.unchanged++;
          } else {
            // 内容变化：旧版本留快照（旧对象仍在 CAS 中，按 hash 可回溯）
            if (prev.contentHash) store.addSnapshot(prev.id, prev.contentHash, prev.size, now);
            store.updateAsset(prev.id, raw, hash, now);
            store.addSnapshot(prev.id, hash, raw.size, now);
            keepIds.add(prev.id);
            result.updated++;
          }
        } catch (err) {
          result.errors.push(`${raw.path}: ${(err as Error).message}`);
        }
      }
      result.missing = store.markMissing(sourceId, keepIds, now);
    } catch (err) {
      result.errors.push(`discover 失败: ${(err as Error).message}`);
    }

    result.durationMs = Date.now() - started;
    results.push(result);
  }
  return results;
}
