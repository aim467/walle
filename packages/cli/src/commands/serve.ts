import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { adapters } from '@walle/adapters';
import { openStores } from '../context.js';

/** P2 本地 Web UI：仅监听 127.0.0.1，只读 API（search / sessions / read / stats）。
 *  页面为独立静态文件 packages/cli/ui/（不内嵌），改页面刷新即生效、无需重新构建。 */

interface ApiDoc {
  seq: number;
  role: string | null;
  ts: string | null;
  text: string;
}

/** UI 静态文件目录：WALLE_UI_DIR > 包根 ui/（dist/commands/serve.js 上三级） */
function resolveUiDir(): string | null {
  if (process.env.WALLE_UI_DIR && fs.existsSync(process.env.WALLE_UI_DIR)) return process.env.WALLE_UI_DIR;
  const pkgUi = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ui');
  return fs.existsSync(pkgUi) ? pkgUi : null;
}

const UI_DIR = resolveUiDir();

/** 读取 UI 静态文件；仅允许 ui 目录内的普通文件（防路径穿越），带扩展名的静态类型映射 */
const UI_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serveUiFile(res: http.ServerResponse, rel: string): void {
  if (!UI_DIR) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('未找到 UI 静态文件目录（packages/cli/ui/）。请检查安装完整性，或用 WALLE_UI_DIR 指定。');
    return;
  }
  const relPath = rel === '/' ? 'index.html' : rel.replace(/^\/+/, '');
  const abs = path.resolve(UI_DIR, relPath);
  if (!abs.startsWith(path.resolve(UI_DIR) + path.sep) || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const type = UI_MIME[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(fs.readFileSync(abs));
}

function json(res: http.ServerResponse, data: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

export async function cmdServe(rest: string[]): Promise<void> {
  const { values } = parseArgs({ args: rest, options: { port: { type: 'string', default: '4173' } } });
  const port = Number(values.port) || 4173;
  const { store, cas } = openStores();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (url.pathname === '/' || UI_MIME[path.extname(url.pathname).toLowerCase()]) {
        serveUiFile(res, url.pathname);
        return;
      }
      if (url.pathname === '/api/stats') {
        const sources = store.db.prepare('SELECT tool, display_name FROM source ORDER BY tool').all() as unknown[];
        json(res, { sources: sources.map((s) => ({ tool: String((s as Record<string, unknown>).tool), displayName: String((s as Record<string, unknown>).display_name ?? '') })) });
        return;
      }
      if (url.pathname === '/api/list') {
        const q = url.searchParams.get('q')?.trim() ?? '';
        const tool = url.searchParams.get('tool') || undefined;
        const wantSessions = url.searchParams.get('sessions') === '1';
        if (wantSessions) {
          const rows = store.listSessions({ tool, limit: 80 });
          json(res, {
            hits: rows.map((s) => ({
              assetId: s.assetId, tool: s.tool, kind: 'session', role: null,
              time: s.startedAt, title: s.title ?? '(无标题)', path: s.assetPath, snippet: `${s.model ?? ''} ${s.projectPath ?? ''}`.trim(),
            })),
          });
          return;
        }
        if (!q) {
          json(res, { error: '输入关键词搜索，或切换到「会话列表」' });
          return;
        }
        const hits = store.search(q, { tool, limit: 60 });
        json(res, {
          hits: hits.map((h) => ({
            assetId: h.assetId, tool: h.tool, kind: h.kind, role: h.role,
            time: null, title: h.sessionTitle ?? h.assetName ?? h.path, snippet: h.snippet, path: h.path,
          })),
        });
        return;
      }
      if (url.pathname === '/api/read') {
        const assetId = Number(url.searchParams.get('asset'));
        const asset = store.getAssetById(assetId);
        if (!asset) {
          json(res, { error: 'asset not found' });
          return;
        }
        const title = store.listSessions({ tool: asset.tool, limit: 1000 }).find((s) => s.assetId === asset.id)?.title ?? null;
        let messages: ApiDoc[] = [];
        const adapter = adapters.find((a) => a.id === asset.tool);
        if (adapter?.parse && asset.contentHash && cas.has(asset.contentHash)) {
          const result = adapter.parse(
            cas.pathFor(asset.contentHash),
            { kind: asset.kind, path: asset.path, tool: asset.tool, name: asset.name ?? undefined },
            'read',
          );
          if (result) {
            const subId = result.sessions[0]?.subId;
            messages = result.docs
              .filter((d) => d.docType !== 'session_title')
              .filter((d) => !d.subId || !subId || d.subId === subId)
              .sort((a, b) => a.seq - b.seq)
              .slice(0, 500)
              .map((d) => ({ seq: d.seq, role: d.role ?? null, ts: d.ts ?? null, text: d.text }));
          }
        }
        json(res, { tool: asset.tool, path: asset.path, title, messages });
        return;
      }
      res.writeHead(404);
      res.end('not found');
    } catch (err) {
      json(res, { error: (err as Error).message });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`walle Web UI: http://127.0.0.1:${port}（Ctrl+C 退出）`);
  });
  const close = () => {
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', close);
}
