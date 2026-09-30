import { parseArgs } from 'node:util';
import { WalleStore } from '@walle/core';
import { openStores } from '../context.js';
import { humanSize, pad, shortTime, trunc } from '../format.js';

export async function cmdList(rest: string[]): Promise<void> {
  const { values } = parseArgs({
    args: rest,
    options: {
      kind: { type: 'string' },
      source: { type: 'string' },
      all: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      limit: { type: 'string', default: '100' },
    },
  });
  const { store } = openStores();
  try {
    const assets = store.listAssets({
      kind: values.kind,
      tool: values.source,
      includeMissing: values.all,
      limit: Number(values.limit) || 100,
    });
    if (values.json) {
      console.log(JSON.stringify(assets, null, 2));
      return;
    }
    if (assets.length === 0) {
      console.log('没有资产。先运行 walle scan。');
      return;
    }
    console.log(
      `${pad('ID', 6)}${pad('类型', 9)}${pad('来源', 8)}${pad('S', 3)}${pad('大小', 10)}${pad('修改时间', 21)}路径`,
    );
    for (const a of assets) {
      console.log(
        `${pad(String(a.id), 6)}${pad(a.kind, 9)}${pad(a.tool, 8)}${pad(a.sensitive ? '⚠' : '', 3)}${pad(
          humanSize(a.size),
          10,
        )}${pad(shortTime(a.mtime), 21)}${trunc(a.path, 64)}${a.status !== 'active' ? ` [${a.status}]` : ''}`,
      );
    }
    console.log(`共 ${assets.length} 条（⚠ = 敏感资产，展示脱敏）`);
  } finally {
    store.close();
  }
}
