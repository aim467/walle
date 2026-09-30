import { parseArgs } from 'node:util';
import { runScan, buildIndex } from '@walle/core';
import { adapters } from '@walle/adapters';
import { openStores } from '../context.js';

/** P3：定时扫描 + 索引（walle watch）。变更自动留快照、自动入索引。 */

export async function cmdWatch(rest: string[]): Promise<void> {
  const { values } = parseArgs({
    args: rest,
    options: {
      interval: { type: 'string', default: '300' }, // 秒
      once: { type: 'boolean', default: false },
    },
  });
  const intervalSec = Math.max(10, Number(values.interval) || 300);
  const { store, cas } = openStores();

  const tick = async () => {
    const started = Date.now();
    try {
      const scans = await runScan(adapters, store, cas);
      const total = scans.reduce((s, r) => s + r.new + r.updated, 0);
      let idx = '';
      if (total > 0) {
        const stats = buildIndex(adapters, store, cas);
        idx = `，索引 ${stats.docsAdded} 文档`;
      }
      const changed = scans
        .filter((r) => r.new + r.updated > 0)
        .map((r) => `${r.tool}(+${r.new}/~${r.updated})`)
        .join(' ');
      console.log(`[${new Date().toLocaleTimeString()}] 扫描完成（${((Date.now() - started) / 1000).toFixed(1)}s）${changed ? '变更: ' + changed : '无变化'}${idx}`);
    } catch (err) {
      console.error(`[${new Date().toLocaleTimeString()}] 扫描出错:`, (err as Error).message);
    }
  };

  if (values.once) {
    await tick();
    store.close();
    return;
  }
  console.log(`walle watch：每 ${intervalSec}s 扫描一次（Ctrl+C 退出）。变更自动留快照并入索引。`);
  await tick();
  setInterval(() => void tick(), intervalSec * 1000);
}
