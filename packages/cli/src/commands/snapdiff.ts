import { parseArgs } from 'node:util';
import { collapseDiff, diffLines } from '@walle/core';
import { openStores } from '../context.js';
import { humanSize, shortTime, trunc } from '../format.js';

/** 快照时间线：walle snap <asset-id> */
export async function cmdSnap(rest: string[]): Promise<void> {
  const { positionals } = parseArgs({ args: rest, allowPositionals: true });
  const assetId = Number(positionals[0]);
  if (!Number.isInteger(assetId) || assetId <= 0) {
    console.error('用法: walle snap <asset-id>');
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
    console.log(`#${asset.id} ${asset.path}（${asset.tool}）`);
    const snaps = store.listSnapshots(assetId);
    const seen = new Set<string>();
    let shown = 0;
    for (const s of snaps) {
      if (seen.has(s.contentHash)) continue; // 扫描会重复记同一版本，去重展示
      seen.add(s.contentHash);
      shown++;
      const exists = cas.has(s.contentHash);
      console.log(`  #${s.id}  ${shortTime(s.capturedAt)}  ${s.contentHash.slice(0, 12)}  ${humanSize(s.size)}${exists ? '' : '（内容已不在仓中）'}`);
    }
    if (asset.contentHash && !seen.has(asset.contentHash)) {
      console.log(`  当前  ${shortTime(asset.mtime)}  ${asset.contentHash.slice(0, 12)}  ${humanSize(asset.size)}`);
    }
    if (shown === 0 && !asset.contentHash) console.log('  （无版本记录）');
    console.log(`\nwalle diff ${asset.id} 对比当前与上一版本`);
  } finally {
    store.close();
  }
}

/** 版本对比：walle diff <asset-id> [--from <snap-id|now>] [--to <snap-id|now>] [--context n] */
export async function cmdDiff(rest: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      context: { type: 'string', default: '2' },
    },
  });
  const assetId = Number(positionals[0]);
  if (!Number.isInteger(assetId) || assetId <= 0) {
    console.error('用法: walle diff <asset-id> [--from <snap-id|now>] [--to <snap-id|now>] [--context n]');
    process.exitCode = 1;
    return;
  }
  const { store, cas } = openStores();
  try {
    const asset = store.getAssetById(assetId);
    if (!asset || !asset.contentHash) {
      console.error(`找不到资产 #${assetId} 或其无内容`);
      process.exitCode = 1;
      return;
    }
    const snaps = store.listSnapshots(assetId);
    const currentHash: string = asset.contentHash; // 前面已判空
    const resolveVersion = (spec: string | undefined, fallback: 'now' | 'prev'): { hash: string; label: string } | null => {
      if (spec) {
        if (spec === 'now') return { hash: currentHash, label: '当前' };
        const s = snaps.find((x) => x.id === Number(spec));
        if (!s) {
          console.error(`找不到快照 #${spec}`);
          return null;
        }
        return { hash: s.contentHash, label: `快照#${s.id}` };
      }
      if (fallback === 'now') return { hash: currentHash, label: '当前' };
      // 默认 from：最新一个内容不同于当前的快照；没有则取最新快照
      const avail = snaps.filter((s) => cas.has(s.contentHash));
      const pick = avail.find((s) => s.contentHash !== currentHash) ?? avail[0];
      if (!pick) return { hash: currentHash, label: '当前（无历史快照）' };
      return { hash: pick.contentHash, label: `快照#${pick.id}` };
    };
    const from = resolveVersion(values.from, 'prev');
    const to = resolveVersion(values.to, 'now');
    if (!from || !to) return;

    const readVer = (v: { hash: string; label: string }): string | null =>
      cas.has(v.hash) ? cas.get(v.hash)!.toString('utf8') : null;
    const aText = readVer(from);
    const bText = readVer(to);
    if (aText == null || bText == null) {
      console.error('版本内容不在内容仓中（可能为超限大文件）');
      process.exitCode = 1;
      return;
    }

    console.log(`#${asset.id} ${trunc(asset.path, 60)}（${asset.tool}）`);
    console.log(`- ${from.label} ${from.hash.slice(0, 12)}`);
    console.log(`+ ${to.label} ${to.hash.slice(0, 12)}`);
    console.log('');
    if (from.hash === to.hash) {
      console.log('两个版本内容相同。');
      return;
    }
    const collapsed = collapseDiff(diffLines(aText, bText), Number(values.context) || 2);
    let del = 0, add = 0;
    for (const l of collapsed) {
      if (l.gap) console.log(`  ⋯（${l.gap} 行未变）`);
      if (l.op === 'del') { del++; console.log(`- ${l.text}`); }
      else if (l.op === 'add') { add++; console.log(`+ ${l.text}`); }
      else console.log(`  ${l.text}`);
    }
    console.log(`\n共 ${del} 行删除 / ${add} 行新增`);
  } finally {
    store.close();
  }
}
