import { maskSecrets } from '@walle/core';
import type { WalleStore, ContentStore } from '@walle/core';
import { openStores } from '../context.js';

/**
 * `walle mcp`（P5.2 收尾）：只读 MCP server（stdio，JSON-RPC 2.0，按行分帧）。
 * 向各 AI 工具暴露 walle 已采集的记忆/技能检索——只有读取，没有任何写方法。
 * 日志一律走 stderr（stdout 是协议通道）。
 */

const READ_LIMIT = 64 * 1024;
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_VERSION = '0.3.0';

interface JsonRpcMsg {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const rpcOk = (id: JsonRpcMsg['id'], result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcErr = (id: JsonRpcMsg['id'], code: number, message: string) => ({
  jsonrpc: '2.0',
  id,
  error: { code, message },
});

/** MCP 工具定义（tools/list 返回） */
const TOOLS = [
  {
    name: 'list_memories',
    description: '列出 walle 采集的全部记忆（跨 AI 工具聚合：根记忆与项目记忆）。可选按项目路径或来源工具过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: '项目路径子串过滤（如 D:/CodingProject/walle 或目录名）' },
        tool: { type: 'string', description: '来源工具 id 过滤（codex/zcode/cursor/opencode/workbuddy/workbuddy-cn/agents）' },
      },
    },
  },
  {
    name: 'read_memory',
    description: '读取一条记忆的完整内容（list_memories 结果中的 assetId）。',
    inputSchema: {
      type: 'object',
      properties: { assetId: { type: 'number', description: '记忆资产 id' } },
      required: ['assetId'],
    },
  },
  {
    name: 'search_memory',
    description: '全文检索记忆内容（支持中文）。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词' },
        limit: { type: 'number', description: '最多返回条数（默认 10）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_skills',
    description: '全文检索已采集的技能（SKILL.md，含各工具目录与共享库）。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词' },
        limit: { type: 'number', description: '最多返回条数（默认 10）' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_skill',
    description: '读取一个技能的 SKILL.md 完整内容（search_skills 结果中的 assetId）。',
    inputSchema: {
      type: 'object',
      properties: { assetId: { type: 'number', description: '技能资产 id' } },
      required: ['assetId'],
    },
  },
  {
    name: 'search_knowledge',
    description: '检索 walle 知识库——从会话提炼的知识卡片与总结文档（含来源会话信息，支持中文全文检索）。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '检索关键词；留空返回全部条目' },
        limit: { type: 'number', description: '最多返回条数（默认 10）' },
      },
    },
  },
  {
    name: 'read_knowledge',
    description: '读取一条知识卡片/总结文档的完整内容（search_knowledge 结果中的 assetId）。',
    inputSchema: {
      type: 'object',
      properties: { assetId: { type: 'number', description: '知识资产 id' } },
      required: ['assetId'],
    },
  },
];

function fmtTime(iso: string | null): string {
  return iso ? iso.replace('T', ' ').slice(0, 19) : '-';
}

function humanSize(b: number | null): string {
  if (b == null) return '-';
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1048576).toFixed(1)}MB`;
}

export function createMcpHandler(deps: { store: WalleStore; cas: ContentStore }) {
  const { store, cas } = deps;

  /** 读取记忆/技能/知识正文：敏感资产脱敏，超长截断 */
  const readContent = (assetId: number, expectKind: 'memory' | 'skill' | 'knowledge'): string => {
    const a = store.getAssetById(assetId);
    if (!a || a.status !== 'active') throw new Error(`资产 #${assetId} 不存在`);
    if (a.kind !== expectKind) throw new Error(`资产 #${assetId} 是 ${a.kind}，不是 ${expectKind}`);
    if (!a.contentHash || !cas.has(a.contentHash)) throw new Error(`资产 #${assetId} 的内容不在仓中（可能从未索引）`);
    let text = cas.get(a.contentHash)!.toString('utf8');
    if (a.sensitive) text = maskSecrets(text);
    if (text.length > READ_LIMIT) text = text.slice(0, READ_LIMIT) + '\n…（截断，完整内容见本地文件）';
    return `${a.path}\n${'—'.repeat(40)}\n${text}`;
  };

  const callTool = (name: string, args: Record<string, unknown>): string => {
    switch (name) {
      case 'list_memories': {
        const { memories, similar } = store.memoriesOverview();
        const project = typeof args.project === 'string' ? args.project.toLowerCase() : null;
        const tool = typeof args.tool === 'string' ? args.tool : null;
        let list = memories;
        if (tool) list = list.filter((m) => m.tool === tool);
        if (project) list = list.filter((m) => (m.projectRoot ?? '').toLowerCase().includes(project) || m.path.toLowerCase().includes(project));
        if (!list.length) return '没有匹配的记忆。';
        const simById = new Map<number, string[]>();
        for (const g of similar) {
          for (const id of g.assetIds) simById.set(id, [...(simById.get(id) ?? []), g.kind === 'name' ? '同名' : '同内容']);
        }
        return list
          .map((m) => {
            const scope = m.scope === 'project' ? `项目 ${m.projectRoot}` : `根（${m.tool}）`;
            const flags = simById.get(m.assetId)?.join('/') ?? '';
            return `#${m.assetId} ${m.name} [${m.tool} · ${scope}${flags ? ' · ' + flags : ''}] ${humanSize(m.size)} · ${fmtTime(m.mtime)}\n  ${m.path}`;
          })
          .join('\n');
      }
      case 'read_memory':
        return readContent(Number(args.assetId), 'memory');
      case 'search_memory':
      case 'search_skills': {
        const q = String(args.query ?? '').trim();
        if (!q) throw new Error('query 不能为空');
        const kind = name === 'search_memory' ? 'memory' : 'skill';
        const limit = Math.min(Number(args.limit) || 10, 50);
        const hits = store.search(q, { kind, limit });
        if (!hits.length) return `没有匹配的${kind === 'memory' ? '记忆' : '技能'}。`;
        return hits.map((h) => `#${h.assetId} [${h.tool}] ${h.assetName ?? h.path}\n  ${h.path}\n  …${h.snippet}…`).join('\n');
      }
      case 'read_skill':
        return readContent(Number(args.assetId), 'skill');
      case 'search_knowledge': {
        const q = String(args.query ?? '').trim();
        const limit = Math.min(Number(args.limit) || 10, 50);
        const hits = q ? store.search(q, { kind: 'knowledge', limit }) : store.listAssets({ kind: 'knowledge', limit }).map((a) => ({
          assetId: a.id, tool: a.tool, path: a.path, assetName: a.name, snippet: `${humanSize(a.size)} · ${fmtTime(a.mtime)}`,
        }));
        if (!hits.length) return '知识库为空或没有匹配条目。';
        return hits.map((h) => `#${h.assetId} [知识] ${h.assetName ?? h.path}\n  ${h.path}\n  ${h.snippet}`).join('\n');
      }
      case 'read_knowledge':
        return readContent(Number(args.assetId), 'knowledge');
      default:
        throw new Error(`未知工具: ${name}`);
    }
  };

  return async function handle(msg: JsonRpcMsg): Promise<Record<string, unknown> | null> {
    if (msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return rpcErr(msg.id ?? null, -32600, 'Invalid Request');
    }
    const isNotification = msg.id === undefined;
    switch (msg.method) {
      case 'initialize':
        if (isNotification) return null;
        return rpcOk(msg.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'walle', version: SERVER_VERSION },
        });
      case 'notifications/initialized':
        return null;
      case 'ping':
        return isNotification ? null : rpcOk(msg.id, {});
      case 'tools/list':
        return isNotification ? null : rpcOk(msg.id, { tools: TOOLS });
      case 'tools/call': {
        const params = (msg.params ?? {}) as { name?: string; arguments?: Record<string, unknown> };
        if (!params.name) return isNotification ? null : rpcErr(msg.id, -32602, '缺少工具名');
        try {
          const text = callTool(params.name, params.arguments ?? {});
          return isNotification ? null : rpcOk(msg.id, { content: [{ type: 'text', text }] });
        } catch (e) {
          return isNotification ? null : rpcOk(msg.id, { content: [{ type: 'text', text: `错误: ${(e as Error).message}` }], isError: true });
        }
      }
      default:
        return isNotification ? null : rpcErr(msg.id, -32601, `未知方法: ${msg.method}`);
    }
  };
}

export async function cmdMcp(_rest: string[]): Promise<void> {
  const { store, cas } = openStores();
  const handle = createMcpHandler({ store, cas });
  process.stderr.write('[walle mcp] 只读 MCP server 已启动（stdio JSON-RPC）\n');

  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      void (async () => {
        let msg: JsonRpcMsg;
        try {
          msg = JSON.parse(line);
        } catch {
          process.stdout.write(JSON.stringify(rpcErr(null, -32700, 'Parse error')) + '\n');
          return;
        }
        const resp = await handle(msg);
        if (resp) process.stdout.write(JSON.stringify(resp) + '\n');
      })();
    }
  });
  process.stdin.on('end', () => {
    store.close();
    process.exit(0);
  });
}
