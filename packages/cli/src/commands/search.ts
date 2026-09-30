import { openStores } from '../context.js';
import { pad, trunc } from '../format.js';

interface SearchOpts {
  kind?: string;
  source?: string;
  limit?: string;
  json?: boolean;
}

export async function cmdSearch(rest: string[]): Promise<void> {
  const opts: SearchOpts = { json: false };
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--kind') opts.kind = rest[++i];
    else if (a === '--source') opts.source = rest[++i];
    else if (a === '--limit') opts.limit = rest[++i];
    else if (a === '--json') opts.json = true;
    else positional.push(a);
  }
  const q = positional.join(' ').trim();
  if (!q) {
    console.error('用法: walle search <关键词> [--kind session] [--source codex] [--limit N]');
    process.exitCode = 1;
    return;
  }
  const { store } = openStores();
  try {
    const hits = store.search(q, { kind: opts.kind, tool: opts.source, limit: Number(opts.limit) || 30 });
    if (opts.json) {
      console.log(JSON.stringify(hits, null, 2));
      return;
    }
    if (hits.length === 0) {
      console.log(`没有匹配「${q}」的结果。`);
      return;
    }
    for (const h of hits) {
      const title = h.sessionTitle ?? h.assetName ?? h.path;
      const roleTag = h.role && h.role !== 'title' ? `[${h.role}]` : '';
      console.log(`${pad(`#${h.assetId}`, 6)}${pad(h.tool, 9)}${pad(h.kind, 9)}${trunc(title, 36)} ${roleTag}`);
      console.log(`  ${h.snippet.replace(/\n/g, ' ')}`);
    }
    console.log(`共 ${hits.length} 条命中（walle read <资产id> 阅读会话）`);
  } finally {
    store.close();
  }
}
