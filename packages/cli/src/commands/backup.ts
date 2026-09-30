import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { createZip, readZip, walleDbPath, walleObjectsDir } from '@walle/core';
import { openStores } from '../context.js';

const DB_ENTRY = 'walle.db';
const OBJ_PREFIX = 'objects/';

/** 步骤 4：walle backup / walle restore / walle recover */

/**
 * 误删恢复（P3 只读约束下不写回源目录）：把资产内容导出为用户指定文件。
 * 用法: walle recover <asset-id> [-o <file>] [--snap <snapshot-id>]
 */
export async function cmdRecover(rest: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { out: { type: 'string', short: 'o' }, snap: { type: 'string' } },
  });
  const assetId = Number(positionals[0]);
  if (!Number.isInteger(assetId) || assetId <= 0) {
    console.error('用法: walle recover <asset-id> [-o 输出文件] [--snap 快照id]');
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
    let hash = asset.contentHash;
    let label = '当前版本';
    if (values.snap) {
      const s = store.listSnapshots(assetId).find((x) => x.id === Number(values.snap));
      if (!s) {
        console.error(`找不到快照 #${values.snap}`);
        process.exitCode = 1;
        return;
      }
      hash = s.contentHash;
      label = `快照#${s.id}`;
    }
    if (!hash || !cas.has(hash)) {
      console.error('内容不在仓中（敏感对象被排除的归档恢复后可能出现）');
      process.exitCode = 1;
      return;
    }
    const out = path.resolve(values.out ?? path.basename(asset.path));
    fs.writeFileSync(out, cas.get(hash)!);
    console.log(`已恢复 ${asset.path}（${label}）→ ${out}`);
  } finally {
    store.close();
  }
}

export async function cmdBackup(rest: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { 'include-secrets': { type: 'boolean', default: false } },
  });
  const outFile = path.resolve(positionals[0] ?? `walle-backup-${new Date().toISOString().slice(0, 10)}.zip`);
  const { store } = openStores();
  try {
    // 敏感资产内容默认不进归档（开发文档 §8），--include-secrets 显式包含
    const sensitiveHashes = new Set<string>();
    if (!values['include-secrets']) {
      for (const a of store.listAssets({ limit: 1_000_000 })) {
        if (a.sensitive && a.contentHash) sensitiveHashes.add(a.contentHash);
      }
    }
    // checkpoint：把 WAL 合并进主库文件，保证单文件一致性（放最后，之后立即关闭）
    store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    store.close();

    const dbPath = walleDbPath();
    const objectsDir = walleObjectsDir();
    const entries: { name: string; data: Buffer }[] = [];

    entries.push({ name: DB_ENTRY, data: fs.readFileSync(dbPath) });

    let excluded = 0;
    for (const bucket of fs.readdirSync(objectsDir)) {
      const bucketDir = path.join(objectsDir, bucket);
      if (!fs.statSync(bucketDir).isDirectory()) continue;
      for (const f of fs.readdirSync(bucketDir)) {
        const hash = bucket + f;
        if (sensitiveHashes.has(hash)) {
          excluded++;
          continue;
        }
        entries.push({ name: OBJ_PREFIX + bucket + '/' + f, data: fs.readFileSync(path.join(bucketDir, f)) });
      }
    }

    // 写归档
    const zip = createZip(entries);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, zip);
    console.log(
      `备份完成: ${outFile}（${(zip.length / 1024 / 1024).toFixed(1)}MB，${entries.length} 个文件${excluded ? `，排除敏感对象 ${excluded} 个` : ''}）`,
    );
    if (excluded) console.log('提示：归档未含凭证类资产内容，恢复后此类资产将显示"内容不可用"。需要完整备份用 --include-secrets。');
  } catch (err) {
    try { store.close(); } catch { /* 已关闭 */ }
    throw err;
  }
}

export async function cmdRestore(rest: string[]): Promise<void> {
  const { positionals } = parseArgs({ args: rest, allowPositionals: true });
  const archive = path.resolve(positionals[0] ?? '');
  if (!positionals[0] || !fs.existsSync(archive)) {
    console.error('用法: walle restore <archive.zip>');
    process.exitCode = 1;
    return;
  }
  const zip = readZip(fs.readFileSync(archive));
  const dbEntry = zip.find((e) => e.name === DB_ENTRY);
  if (!dbEntry) {
    console.error('归档中缺少 walle.db，不是有效的 walle 备份');
    process.exitCode = 1;
    return;
  }
  const dbPath = walleDbPath();
  const objectsDir = walleObjectsDir();
  if (fs.existsSync(dbPath)) {
    const bak = dbPath + '.pre-restore';
    fs.copyFileSync(dbPath, bak);
    console.log(`现有元数据库已备份为 ${path.basename(bak)}`);
  }
  fs.mkdirSync(objectsDir, { recursive: true });
  let objects = 0;
  for (const e of zip) {
    if (e.name === DB_ENTRY) {
      fs.writeFileSync(dbPath, e.data);
      continue;
    }
    if (!e.name.startsWith(OBJ_PREFIX)) continue;
    const rel = e.name.slice(OBJ_PREFIX.length);
    const target = path.join(objectsDir, ...rel.split('/'));
    if (!target.startsWith(path.resolve(objectsDir) + path.sep)) continue; // 防穿越
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, e.data);
    objects++;
  }
  console.log(`恢复完成: 元数据库 + ${objects} 个内容对象 → ${path.dirname(dbPath)}`);
  console.log('建议执行 walle index --rebuild 重建全文索引。');
}
