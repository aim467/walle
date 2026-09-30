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

/** walle push <asset-id> [--file <内容文件>] [--force]
 *  --file 缺省读 stdin。把内容写回资产对应的源工具文件（三保险）。 */
export async function cmdPush(rest: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { file: { type: 'string', short: 'f' }, force: { type: 'boolean', default: false }, json: { type: 'boolean', default: false } },
  });
  const deny = writeAllowed();
  if (deny) {
    console.error(deny);
    process.exitCode = 1;
    return;
  }
  const assetId = Number(positionals[0]);
  if (!Number.isInteger(assetId) || assetId <= 0) {
    console.error('用法: walle push <asset-id> [--file 内容文件] [--force]');
    process.exitCode = 1;
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

/** walle rollback <asset-id> [--snap <id>]
 *  把指定（或最近的）历史快照内容写回 —— 复用 WriteEngine 三保险。 */
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
