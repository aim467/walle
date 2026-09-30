import { parseArgs } from 'node:util';
import { openStores } from '../context.js';
import { pad, shortTime, trunc } from '../format.js';

export async function cmdSessions(rest: string[]): Promise<void> {
  const { values } = parseArgs({
    args: rest,
    options: {
      source: { type: 'string' },
      limit: { type: 'string', default: '50' },
      json: { type: 'boolean', default: false },
    },
  });
  const { store } = openStores();
  try {
    const rows = store.listSessions({ tool: values.source, limit: Number(values.limit) || 50 });
    if (values.json) {
      console.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) {
      console.log('没有会话元数据。先运行 walle scan && walle index。');
      return;
    }
    console.log(`${pad('ASSET', 7)}${pad('来源', 10)}${pad('开始时间', 21)}${pad('消息', 6)}标题`);
    for (const s of rows) {
      console.log(
        `${pad(String(s.assetId), 7)}${pad(s.tool, 10)}${pad(shortTime(s.startedAt), 21)}${pad(
          s.messageCount == null ? '-' : String(s.messageCount),
          6,
        )}${trunc(s.title ?? '(无标题)', 56)}`,
      );
    }
    console.log(`共 ${rows.length} 个会话（walle read <asset-id> 阅读）`);
  } finally {
    store.close();
  }
}
