import fs from 'node:fs';
import path from 'node:path';
import type { Adapter } from './types.js';
import type { WalleStore } from './store.js';
import type { ContentStore } from './cas.js';
import { sha256File } from './cas.js';

/**
 * P4 写回引擎（开发文档 §7 Phase 4）。三保险，缺一不可：
 *   1. 强制先快照 —— 写前磁盘现状入 CAS + snapshot 表；
 *   2. 原子写 —— 同目录临时文件 + rename，中断不产生半写文件；
 *   3. 冲突检测 —— 磁盘现状哈希 ≠ 数据库记录（扫描后被外部/第三方工具改过）即拒绝。
 * 会话与内部库（rawFormat=sqlite 且 kind=session）永不写回。
 */

export interface WriteResult {
  ok: boolean;
  reason?: string;
  /** 写前快照 id（回滚锚点） */
  snapshotId?: number;
  newHash?: string;
}

/** 永不写回的资产形态 */
function isImmutableAsset(kind: string, rawFormat: string | null): boolean {
  if (kind === 'session') return true;
  if (rawFormat === 'sqlite') return true;
  if (rawFormat === 'dir') return true;
  return false;
}

export class WriteEngine {
  constructor(
    private readonly store: WalleStore,
    private readonly cas: ContentStore,
    private readonly adapters: Adapter[],
  ) {}

  /**
   * 把 content 写回 assetId 对应的源工具文件。
   * @param expectedHash 调用方看到的内容版本（冲突检测基准）；缺省用数据库当前值
   */
  write(assetId: number, content: Buffer, opts: { expectedHash?: string; force?: boolean } = {}): WriteResult {
    const asset = this.store.getAssetById(assetId);
    if (!asset) return { ok: false, reason: `找不到资产 #${assetId}` };
    if (isImmutableAsset(asset.kind, asset.rawFormat)) {
      return { ok: false, reason: `资产类型 ${asset.kind}/${asset.rawFormat} 为只读（会话与内部库永不写回）` };
    }

    const adapter = this.adapters.find((a) => a.id === asset.tool);
    if (!adapter) return { ok: false, reason: `未知工具 ${asset.tool}` };
    if (!adapter.capabilities.write && !opts.force) {
      return { ok: false, reason: `${asset.tool} 适配器未声明写能力` };
    }

    const source = this.store.db.prepare('SELECT root_path FROM source WHERE id = ?').get(asset.sourceId) as Record<string, unknown> | undefined;
    if (!source?.root_path) return { ok: false, reason: '源根目录缺失' };
    const abs = adapter.resolve
      ? adapter.resolve(String(source.root_path), asset.path)
      : path.resolve(String(source.root_path), asset.path);

    // 保险 3：冲突检测 —— 磁盘现状必须与数据库记录一致（否则第三方工具已改动）
    if (fs.existsSync(abs)) {
      const diskHash = sha256File(abs);
      const baseline = opts.expectedHash ?? asset.contentHash;
      if (baseline && diskHash !== baseline && !opts.force) {
        return {
          ok: false,
          reason: `冲突：文件在扫描后被外部修改过（磁盘 ${diskHash.slice(0, 8)} ≠ 记录 ${baseline.slice(0, 8)}）。先运行 walle scan 刷新，或用 --force 覆盖（当前磁盘内容会留快照）`,
        };
      }
      // 保险 1：写前快照（磁盘现状，确保可回滚）
      if (diskHash !== asset.contentHash) {
        const { hash } = this.cas.put(abs);
        this.store.updateAsset(asset.id, assetToRaw(asset, fs.statSync(abs).size, new Date(fs.statSync(abs).mtime).toISOString()), hash, new Date().toISOString());
        asset.contentHash = hash;
      }
      const snapId = this.store.addSnapshot(asset.id, diskHash, fs.statSync(abs).size, new Date().toISOString());

      // 保险 2：原子写
      const tmp = `${abs}.walle-tmp-${process.pid}`;
      try {
        fs.writeFileSync(tmp, content);
        fs.renameSync(tmp, abs);
      } catch (err) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* 尽力清理 */ }
        return { ok: false, reason: `原子写失败（原文件未动）: ${(err as Error).message}` };
      }

      // 写后登记
      const now = new Date().toISOString();
      const { hash: newHash } = this.cas.put(abs);
      this.store.updateAsset(asset.id, assetToRaw(asset, content.length, now), newHash, now);
      this.store.addSnapshot(asset.id, newHash, content.length, now);
      return { ok: true, snapshotId: snapId, newHash };
    }

    // 文件不存在（如恢复误删）：直接原子写
    const tmp = `${abs}.walle-tmp-${process.pid}`;
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(tmp, content);
      fs.renameSync(tmp, abs);
    } catch (err) {
      try { fs.rmSync(tmp, { force: true }); } catch { /* 尽力清理 */ }
      return { ok: false, reason: `原子写失败: ${(err as Error).message}` };
    }
    const now = new Date().toISOString();
    const { hash: newHash } = this.cas.put(abs);
    this.store.updateAsset(asset.id, assetToRaw(asset, content.length, now), newHash, now);
    this.store.addSnapshot(asset.id, newHash, content.length, now);
    return { ok: true, newHash };
  }
}

/** AssetRecord → RawAsset 形状（updateAsset 需要） */
function assetToRaw(a: { kind: string; name: string | null; path: string; rawFormat: string | null; sensitive: number }, size: number, mtime: string) {
  return {
    kind: a.kind as never,
    name: a.name ?? undefined,
    path: a.path,
    rawFormat: (a.rawFormat ?? 'text') as never,
    size,
    mtime,
    sensitive: !!a.sensitive,
  };
}
