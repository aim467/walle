import { parseArgs } from 'node:util';
import { adapters } from '@walle/adapters';
import { openStores } from '../context.js';
import { shortTime } from '../format.js';

const ROLE_LABEL: Record<string, string> = {
  user: '用户',
  assistant: '助手',
  developer: '系统注入',
  system: '系统',
  tool: '工具',
  title: '标题',
};

/** 会话阅读器：按轮次/角色输出完整会话（read 模式解析，不过滤环境注入） */
export async function cmdRead(rest: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { json: { type: 'boolean', default: false }, limit: { type: 'string', default: '200' } },
  });
  const assetId = Number(positionals[0]);
  if (!Number.isInteger(assetId) || assetId <= 0) {
    console.error('用法: walle read <asset-id> [--limit N] [--json]');
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
    const adapter = adapters.find((a) => a.id === asset.tool);
    const docs: { seq: number; role: string | null; ts: string | null; text: string }[] = [];
    if (adapter?.parse && asset.contentHash && cas.has(asset.contentHash)) {
      const result = adapter.parse(cas.pathFor(asset.contentHash), { kind: asset.kind, path: asset.path, tool: asset.tool, name: asset.name ?? undefined }, 'read');
      if (result) {
        for (const d of result.docs) {
          if (d.subId && positionals[1] && d.subId !== positionals[1]) continue;
          docs.push({ seq: d.seq, role: d.role ?? null, ts: d.ts ?? null, text: d.text });
        }
      }
    }
    docs.sort((a, b) => a.seq - b.seq);
    const limited = docs.slice(0, Number(values.limit) || 200);
    if (values.json) {
      console.log(JSON.stringify({ asset: { id: asset.id, tool: asset.tool, path: asset.path }, messages: limited }, null, 2));
      return;
    }
    console.log(`# 会话 #${asset.id}（${asset.tool}）${asset.path}`);
    console.log('');
    if (limited.length === 0) {
      console.log('（该资产无消息文档：可能是未解析的格式或非会话资产）');
      return;
    }
    for (const d of limited) {
      const label = ROLE_LABEL[d.role ?? ''] ?? d.role ?? '未知';
      console.log(`── ${label}${d.ts ? `  ${shortTime(d.ts)}` : ''} ${'─'.repeat(10)}`);
      console.log(d.text.length > 4000 ? d.text.slice(0, 4000) + '\n…（截断）' : d.text);
      console.log('');
    }
    if (docs.length > limited.length) console.log(`…（共 ${docs.length} 条，--limit 提高上限）`);
  } finally {
    store.close();
  }
}
