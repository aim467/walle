import { parseArgs } from 'node:util';
import { maskSecrets } from '@walle/core';
import { openStores } from '../context.js';
import { humanSize, shortTime } from '../format.js';

const SHOW_CONTENT_LIMIT = 200 * 1024;

export async function cmdShow(rest: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      reveal: { type: 'boolean', default: false },
      lines: { type: 'string', default: '40' },
      json: { type: 'boolean', default: false },
    },
  });
  const id = Number(positionals[0]);
  if (!Number.isInteger(id) || id <= 0) {
    console.error('用法: walle show <asset-id> [--reveal] [--lines N] [--json]');
    process.exitCode = 1;
    return;
  }
  const { store, cas } = openStores();
  try {
    const a = store.getAssetById(id);
    if (!a) {
      console.error(`找不到资产 #${id}`);
      process.exitCode = 1;
      return;
    }
    const meta = {
      id: a.id, kind: a.kind, source: a.tool, path: a.path, format: a.rawFormat,
      size: a.size, mtime: a.mtime, sensitive: !!a.sensitive, status: a.status,
      contentHash: a.contentHash, firstSeen: a.firstSeenAt, lastSeen: a.lastSeenAt,
    };
    if (values.json) {
      console.log(JSON.stringify({ ...meta, content: readContent(a, cas, values) }, null, 2));
      return;
    }
    console.log(`#${a.id} [${a.kind}] 来源=${a.tool} 格式=${a.rawFormat ?? '-'} 大小=${humanSize(a.size)}`);
    console.log(`路径: ${a.path}`);
    console.log(`修改: ${shortTime(a.mtime)}  首见: ${shortTime(a.firstSeenAt)}  末见: ${shortTime(a.lastSeenAt)}  状态: ${a.status}`);
    console.log(`哈希: ${a.contentHash ?? '-'}${a.sensitive ? '  ⚠ 敏感资产' : ''}`);
    console.log('');

    const content = readContent(a, cas, values);
    if (content === null) {
      console.log('（内容副本不可用：超过入仓上限或为二进制库，仅记录元数据）');
    } else if (content === '') {
      console.log('（空文件）');
    } else {
      if (a.sensitive && !values.reveal) console.log('⚠ 敏感资产，以下内容已脱敏（--reveal 查看原文）：');
      console.log('─'.repeat(60));
      console.log(content);
      console.log('─'.repeat(60));
    }
  } finally {
    store.close();
  }
}

function readContent(
  a: { contentHash: string | null; rawFormat: string | null; sensitive: number },
  cas: { has(hash: string): boolean; get(hash: string): Buffer | null },
  values: { reveal?: boolean; lines?: string },
): string | null {
  if (!a.contentHash || !cas.has(a.contentHash)) return null;
  if (a.rawFormat === 'sqlite') return null; // 二进制库不展示
  const buf = cas.get(a.contentHash);
  if (!buf) return null;
  if (buf.length > SHOW_CONTENT_LIMIT) return null;
  let text = buf.toString('utf8');
  if (a.sensitive && !values.reveal) text = maskSecrets(text);
  const maxLines = Number(values.lines) || 40;
  const lines = text.split('\n');
  if (lines.length > maxLines) text = lines.slice(0, maxLines).join('\n') + `\n…（共 ${lines.length} 行，--lines N 查看更多）`;
  return text;
}
