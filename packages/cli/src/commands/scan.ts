import { parseArgs } from 'node:util';
import { runScan } from '@walle/core';
import { adapters } from '@walle/adapters';
import { openStores } from '../context.js';
import type { SourceScanResult } from '@walle/core';

export async function cmdScan(rest: string[]): Promise<void> {
  const { values } = parseArgs({
    args: rest,
    options: {
      source: { type: 'string', multiple: true },
      json: { type: 'boolean', default: false },
    },
  });
  const { store, cas } = openStores();
  try {
    const results = await runScan(adapters, store, cas, {
      sources: values.source?.length ? values.source : undefined,
    });
    if (values.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }
    printResults(results);
  } finally {
    store.close();
  }
}

function printResults(results: SourceScanResult[]): void {
  const kindLabel: Record<string, string> = {
    config: '配置', session: '会话', memory: '记忆', skill: 'Skill', mcp: 'MCP',
    rule: '规则', prompt: '输入历史', agent: '子代理', plugin: '插件', secret: '凭证', other: '其他',
  };
  for (const r of results) {
    if (!r.scanned) {
      console.log(`○ ${r.displayName}：未检测到数据目录，跳过`);
      continue;
    }
    console.log(`● ${r.displayName}  ${r.root}`);
    const parts = [`资产 ${r.total}`];
    if (r.new) parts.push(`新增 ${r.new}`);
    if (r.updated) parts.push(`更新 ${r.updated}`);
    if (r.unchanged) parts.push(`未变 ${r.unchanged}`);
    if (r.missing) parts.push(`失踪 ${r.missing}`);
    console.log(`  ${parts.join(' · ')}（${(r.durationMs / 1000).toFixed(1)}s）`);
    const kinds = Object.entries(r.byKind)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${kindLabel[k] ?? k} ${n}`)
      .join(' · ');
    if (kinds) console.log(`  ${kinds}`);
    for (const e of r.errors) console.log(`  ! ${e}`);
  }
  const anyScanned = results.some((r) => r.scanned);
  if (!anyScanned) console.log('未发现任何 AI 工具数据源。');
}
