import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { WriteEngine, readWalleConfig, writeAllowed, writeWalleConfig } from '@walle/core';
import { openStores } from '../context.js';
import { adapters } from '@walle/adapters';

/** P4 写回命令：write-enable / push / rollback。全局开关默认关闭。 */

export async function cmdWriteEnable(rest: string[]): Promise<void> {
  const { values } = parseArgs({ args: rest, options: { off: { type: 'boolean', default: false } } });
  const cfg = readWalleConfig();
  if (values.off) {
    writeWalleConfig({ ...cfg, allowWrite: false });
    console.log('写回开关已关闭。');
    return;
  }
  writeWalleConfig({ ...cfg, allowWrite: true });
  console.log('写回开关已开启（记录在 ~/.walle/config.json）。所有写回均强制：先快照 → 原子写 → 冲突检测。');
  console.log('关闭: walle write-enable --off');
}

/** walle push <asset-id> [--file <内容文件>] [--to <tool>] [--to-asset <id>] [--force]
 *  缺省：把内容写回资产对应的源工具文件（三保险）。
 *  --to：跨工具同构下发；--to-asset：精确指定目标资产。 */
export async function cmdPush(rest: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { file: { type: 'string', short: 'f' }, force: { type: 'boolean', default: false }, json: { type: 'boolean', default: false }, to: { type: 'string' }, 'to-asset': { type: 'string' } },
  });
  const deny = writeAllowed();
  if (deny) {
    console.error(deny);
    process.exitCode = 1;
    return;
  }
  const assetId = Number(positionals[0]);
  if (!Number.isInteger(assetId) || assetId <= 0) {
    console.error('用法: walle push <asset-id> [--file 内容文件 | --to <tool> | --to-asset <id>] [--force]');
    process.exitCode = 1;
    return;
  }
  if (values['to-asset']) {
    await pushToAsset(assetId, Number(values['to-asset']), { force: values.force });
    return;
  }
  if (values.to) {
    await cmdPushTo(assetId, values.to, { force: values.force });
    return;
  }
  let content: Buffer;
  if (values.file) {
    content = fs.readFileSync(path.resolve(values.file));
  } else {
    content = fs.readFileSync(0); // stdin
  }
  const { store, cas } = openStores();
  try {
    const engine = new WriteEngine(store, cas, adapters);
    const result = engine.write(assetId, content, { force: values.force });
    if (values.json) {
      console.log(JSON.stringify(result));
      return;
    }
    if (!result.ok) {
      console.error(`写回被拒绝: ${result.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(`写回成功（新哈希 ${result.newHash?.slice(0, 12)}）。写前快照 #${result.snapshotId ?? '-'}，可 walle rollback ${assetId} 回滚。`);
  } finally {
    store.close();
  }
}

/** walle push <asset-id> --to <tool>：跨工具同构下发
 *  在目标工具中查找 kind+name 相同的资产，把内容写过去（三保险）。
 *  找不到目标资产时拒绝并列出候选（第一版不凭空创建，避免猜路径写坏工具目录）。 */
export async function cmdPushTo(assetId: number, toTool: string, opts: { force?: boolean }): Promise<void> {
  const { store, cas } = openStores();
  try {
    const src = store.getAssetById(assetId);
    if (!src) {
      console.error(`找不到资产 #${assetId}`);
      process.exitCode = 1;
      return;
    }
    if (!src.contentHash || !cas.has(src.contentHash)) {
      console.error('源内容不可用');
      process.exitCode = 1;
      return;
    }
    const candidates = store.listAssets({ tool: toTool, kind: src.kind, limit: 1000 })
      .filter((a) => a.status === 'active' && (a.name === src.name || path.basename(a.path) === path.basename(src.path)));
    if (candidates.length === 0) {
      const sameKind = store.listAssets({ tool: toTool, kind: src.kind, limit: 10 });
      console.error(`目标工具 ${toTool} 中没有同类型同名的资产（${src.kind}/${src.name ?? src.path}）。`);
      if (sameKind.length) {
        console.error(`该工具的 ${src.kind} 类资产有：`);
        for (const c of sameKind) console.error(`  #${c.id} ${c.path}`);
      }
      process.exitCode = 1;
      return;
    }
    if (candidates.length > 1) {
      console.error('多个候选目标，请用资产 id 精确指定：');
      for (const c of candidates) console.error(`  walle push ${assetId} --to-asset ${c.id}`);
      process.exitCode = 1;
      return;
    }
    await pushToAsset(assetId, candidates[0].id, opts);
  } finally {
    store.close();
  }
}

/** 把 srcAsset 的内容写到 dstAssetId（迁移核心） */
export async function pushToAsset(srcAssetId: number, dstAssetId: number, opts: { force?: boolean }): Promise<void> {
  const { store, cas } = openStores();
  try {
    const src = store.getAssetById(srcAssetId);
    const dst = store.getAssetById(dstAssetId);
    if (!src?.contentHash || !cas.has(src.contentHash)) {
      console.error('源内容不可用');
      process.exitCode = 1;
      return;
    }
    if (!dst) {
      console.error(`找不到目标资产 #${dstAssetId}`);
      process.exitCode = 1;
      return;
    }
    const engine = new WriteEngine(store, cas, adapters);
    const result = engine.write(dst.id, cas.get(src.contentHash)!, { force: opts.force });
    if (!result.ok) {
      console.error(`下发被拒绝: ${result.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(`已把 #${src.id}（${src.tool}/${src.name ?? src.path}）下发到 #${dst.id}（${dst.tool}/${dst.path}）`);
    console.log(`目标写前快照 #${result.snapshotId ?? '-'}，可 walle rollback ${dst.id} 回滚。`);
  } finally {
    store.close();
  }
}

/** walle rollback <asset-id> [--snap <id>]：把指定（或最近的）历史快照内容写回 —— 复用 WriteEngine 三保险。 */
export async function cmdRollback(rest: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { snap: { type: 'string' }, force: { type: 'boolean', default: false } },
  });
  const deny = writeAllowed();
  if (deny) {
    console.error(deny);
    process.exitCode = 1;
    return;
  }
  const assetId = Number(positionals[0]);
  if (!Number.isInteger(assetId) || assetId <= 0) {
    console.error('用法: walle rollback <asset-id> [--snap 快照id]');
    process.exitCode = 1;
    return;
  }
  const { store, cas } = openStores();
  try {
    const asset = store.getAssetById(assetId);
    if (!asset) {
      console.error(`找不到资产 #${assetId}`);
      process.exitCode = 1;
      return;
    }
    const snaps = store.listSnapshots(assetId).filter((s) => cas.has(s.contentHash));
    // 默认回滚目标：除当前内容外最新的快照
    const target = values.snap
      ? snaps.find((s) => s.id === Number(values.snap))
      : snaps.find((s) => s.contentHash !== asset.contentHash);
    if (!target) {
      console.error('没有可回滚的历史版本');
      process.exitCode = 1;
      return;
    }
    const engine = new WriteEngine(store, cas, adapters);
    const result = engine.write(assetId, cas.get(target.contentHash)!, { force: values.force });
    if (!result.ok) {
      console.error(`回滚失败: ${result.reason}`);
      process.exitCode = 1;
      return;
    }
    console.log(`已回滚到快照#${target.id}（${target.contentHash.slice(0, 12)}）。写前内容留有快照 #${result.snapshotId ?? '-'}，可再次 rollback 恢复。`);
  } finally {
    store.close();
  }
}
