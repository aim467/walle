import { parseArgs } from 'node:util';
import { buildIndex } from '@walle/core';
import { adapters } from '@walle/adapters';
import { openStores } from '../context.js';

export async function cmdIndex(rest: string[]): Promise<void> {
  const { values } = parseArgs({
    args: rest,
    options: { rebuild: { type: 'boolean', default: false }, json: { type: 'boolean', default: false } },
  });
  const { store, cas } = openStores();
  try {
    const stats = buildIndex(adapters, store, cas, { rebuild: values.rebuild });
    if (values.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }
    console.log(
      `索引完成：资产 ${stats.assetsIndexed} · 文档 ${stats.docsAdded} · 会话 ${stats.sessions} · 跳过(大文件/无内容) ${stats.skippedNoContent}（${(stats.durationMs / 1000).toFixed(1)}s）`,
    );
    for (const e of stats.errors.slice(0, 10)) console.log(`! ${e}`);
  } finally {
    store.close();
  }
}
