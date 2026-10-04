import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WriteEngine, readWalleConfig, writeWalleConfig, runScan, maskSecrets } from '@walle/core';
import { adapters, resolveToolRoot, TOOL_ROOT_DEFS } from '@walle/adapters';
import { openStores } from '../context.js';

/** P2 本地 Web UI：仅监听 127.0.0.1，只读 API（search / sessions / read / stats）。
 *  页面为独立静态文件 packages/cli/ui/（不内嵌），改页面刷新即生效、无需重新构建。 */

interface ApiDoc {
  seq: number;
  role: string | null;
  ts: string | null;
  text: string;
  docType: string;
}

/** 单条 API 消息/文档的文本上限（超大工具结果截断预览） */
const API_DOC_TEXT_LIMIT = 64 * 1024;

const isSidecar = (name: string): boolean => name.endsWith('-shm') || name.endsWith('-wal') || name.endsWith('.log');

/** 从 SKILL.md frontmatter 提取 description（支持 >- / | 等块标量的多行折叠） */
function extractDescription(text: string): string | null {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!fm) return null;
  const lines = fm[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^description:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const inline = m[1].trim();
    if (inline && !/^[>|][+-]?$/.test(inline)) return inline;
    const folded: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (!/^\s+\S/.test(lines[j])) break;
      folded.push(lines[j].trim());
    }
    return folded.length ? folded.join(' ') : null;
  }
  return null;
}

/** UI 静态文件目录：WALLE_UI_DIR > Vue 构建产物 ui/dist > 旧版单文件 ui/ */
function resolveUiDir(): string | null {
  if (process.env.WALLE_UI_DIR && fs.existsSync(process.env.WALLE_UI_DIR)) return process.env.WALLE_UI_DIR;
  const pkgUi = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'ui');
  const dist = path.join(pkgUi, 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) return dist;
  if (fs.existsSync(pkgUi)) return pkgUi;
  return null;
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
  let scanning = false; // 防止扫描请求并发重入（扫描与 serve 共用同一 store 连接）

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    try {
      if (url.pathname === '/' || UI_MIME[path.extname(url.pathname).toLowerCase()]) {
        serveUiFile(res, url.pathname);
        return;
      }
      if (url.pathname === '/api/assets') {
        // 资产库浏览：kind/tool 过滤，全量（UI 端截断）
        const all = store.listAssets({
          kind: url.searchParams.get('kind') || undefined,
          tool: url.searchParams.get('tool') || undefined,
          limit: 100_000,
        });
        json(res, all);
        return;
      }
      if (url.pathname === '/api/snapshots') {
        const assetId = Number(url.searchParams.get('asset'));
        json(res, { snapshots: store.listSnapshots(assetId) });
        return;
      }
      if (url.pathname === '/api/overview') {
        // 总览：源统计 + 最近变更流（含跨工具 mtime 对比——"谁刚被改过"）
        const sources = store.db.prepare('SELECT id, tool, display_name, root_path, last_scanned_at FROM source ORDER BY tool').all() as unknown[];
        const perSource = (sources as Record<string, unknown>[]).map((s) => {
          const sid = Number(s.id);
          const counts = store.db
            .prepare(`SELECT kind, COUNT(*) c FROM asset WHERE source_id = ? AND status = 'active' GROUP BY kind`)
            .all(sid) as unknown[];
          const byKind: Record<string, number> = {};
          let total = 0;
          for (const r of counts as Record<string, unknown>[]) { byKind[String(r.kind)] = Number(r.c); total += Number(r.c); }
          return {
            tool: String(s.tool),
            displayName: String(s.display_name ?? s.tool),
            rootPath: String(s.root_path),
            lastScannedAt: s.last_scanned_at ? String(s.last_scanned_at) : null,
            total,
            byKind,
          };
        });
        const recent = store.listAssets({ limit: 1_000_000 })
          .filter((a) => a.status === 'active')
          .sort((a, b) => (b.mtime ?? '').localeCompare(a.mtime ?? ''))
          .slice(0, 25)
          .map((a) => ({ id: a.id, tool: a.tool, kind: a.kind, name: a.name, path: a.path, mtime: a.mtime, size: a.size, sensitive: !!a.sensitive }));
        json(res, {
          sources: perSource, recent, allowWrite: !!readWalleConfig().allowWrite,
          usage: store.usageByTool(), usageDaily: store.usageByDay(30), usageProjects: store.usageByProject(10),
        });
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
          const rows = store.listSessions({ tool, limit: Number(url.searchParams.get('limit')) || 80 });
          json(res, {
            hits: rows.map((s) => ({
              assetId: s.assetId, subId: s.subId, tool: s.tool, kind: 'session', role: null,
              time: s.startedAt, title: s.title ?? '(无标题)', path: s.assetPath,
              model: s.model, projectPath: s.projectPath, messageCount: s.messageCount,
              tokensTotal: s.usage?.total ?? null, tokensInput: s.usage?.input ?? null, tokensOutput: s.usage?.output ?? null,
              snippet: `${s.model ?? ''} ${s.projectPath ?? ''}`.trim(),
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
            assetId: h.assetId, subId: h.subId, tool: h.tool, kind: h.kind, role: h.role,
            time: null, title: h.sessionTitle ?? h.assetName ?? h.path, snippet: h.snippet, path: h.path,
          })),
        });
        return;
      }
      if (url.pathname === '/api/source') {
        // 编辑器取原文；raw=1 时只读预览放宽到会话资产（jsonl 等文本），sqlite 仍拒绝
        const raw = url.searchParams.get('raw') === '1';
        const asset = store.getAssetById(Number(url.searchParams.get('asset')));
        if (!asset) { json(res, { error: 'asset not found' }); return; }
        if (asset.rawFormat === 'sqlite' || asset.rawFormat === 'dir') {
          json(res, { error: raw ? '二进制库不支持原文预览' : '该资产类型不可编辑' });
          return;
        }
        if (asset.kind === 'session' && !raw) { json(res, { error: '该资产类型不可编辑' }); return; }
        if (!asset.contentHash || !cas.has(asset.contentHash)) { json(res, { error: '内容不在仓中' }); return; }
        let text = cas.get(asset.contentHash)!.toString('utf8');
        let truncated = false;
        if (text.length > 512 * 1024) { text = text.slice(0, 512 * 1024); truncated = true; }
        if (asset.sensitive) text = maskSecrets(text);
        json(res, { assetId: asset.id, tool: asset.tool, path: asset.path, kind: asset.kind, sensitive: !!asset.sensitive, content: text, truncated });
        return;
      }
      if (url.pathname === '/api/config') {
        json(res, { allowWrite: !!readWalleConfig().allowWrite });
        return;
      }
      if (url.pathname === '/api/settings') {
        // 设置页：各工具数据源根路径（覆盖/默认/生效值）
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (c) => {
            body += c;
            if (body.length > 256 * 1024) req.destroy();
          });
          req.on('end', () => {
            try {
              const { toolPaths } = JSON.parse(body) as { toolPaths?: Record<string, unknown> };
              if (toolPaths !== undefined && (typeof toolPaths !== 'object' || toolPaths === null)) {
                json(res, { ok: false, error: 'toolPaths 必须是对象' });
                return;
              }
              const clean: Record<string, string> = {};
              for (const [k, v] of Object.entries(toolPaths ?? {})) {
                if (!TOOL_ROOT_DEFS.some((d) => d.key === k)) {
                  json(res, { ok: false, error: `未知的路径配置项: ${k}` });
                  return;
                }
                if (typeof v !== 'string') {
                  json(res, { ok: false, error: `路径配置项 ${k} 的值必须是字符串` });
                  return;
                }
                const t = v.trim();
                if (t) clean[k] = t; // 空串 = 恢复默认
              }
              const cfg = readWalleConfig();
              writeWalleConfig({ ...cfg, toolPaths: clean });
              json(res, { ok: true, toolPaths: clean, hint: '已保存。重新执行 walle scan 后新路径生效。' });
            } catch (err) {
              json(res, { ok: false, error: (err as Error).message });
            }
          });
          return;
        }
        const cfg = readWalleConfig();
        json(res, {
          allowWrite: !!cfg.allowWrite,
          toolPaths: cfg.toolPaths ?? {},
          roots: TOOL_ROOT_DEFS.map((d) => {
            const override = cfg.toolPaths?.[d.key];
            const env = d.env ? process.env[d.env] : undefined;
            const effective = d.env ? process.env[d.env] || undefined : undefined;
            const root = override || effective || d.default();
            return {
              key: d.key,
              tool: d.tool,
              label: d.label,
              defaultRoot: d.default(),
              envRedirect: env && !override ? env : null,
              override: override ?? null,
              effectiveRoot: root,
              exists: fs.existsSync(root),
            };
          }),
        });
        return;
      }
      if (url.pathname === '/api/scan' && req.method === 'POST') {
        // 触发重新扫描（Web UI 设置改路径 / 总览刷新数据）；?source=<tool> 只扫单个工具
        if (scanning) {
          json(res, { ok: false, error: '已有一次扫描正在进行，请稍候' });
          return;
        }
        const source = url.searchParams.get('source') || undefined;
        scanning = true;
        runScan(adapters, store, cas, { sources: source ? [source] : undefined })
          .then((results) =>
            json(res, {
              ok: true,
              results: results.map((r) => ({
                tool: r.tool, displayName: r.displayName, root: r.root, scanned: r.scanned,
                total: r.total, new: r.new, updated: r.updated, unchanged: r.unchanged, missing: r.missing,
              })),
            }),
          )
          .catch((err) => json(res, { ok: false, error: (err as Error).message }))
          .finally(() => { scanning = false; });
        return;
      }
      if (url.pathname === '/api/write' && req.method === 'POST') {
        // P4 Web UI 编辑下发：body = { assetId, content, force? }
        // 仅监听 127.0.0.1 的本机页面可访问；仍要求全局写回开关已开启
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 2 * 1024 * 1024) req.destroy(); // 2MB 上限
        });
        req.on('end', () => {
          try {
            const cfg = readWalleConfig();
            if (!cfg.allowWrite) {
              json(res, { ok: false, error: '写回开关未开启（walle write-enable）' });
              return;
            }
            const { assetId, content, force } = JSON.parse(body) as { assetId: number; content: string; force?: boolean };
            const engine = new WriteEngine(store, cas, adapters);
            const result = engine.write(Number(assetId), Buffer.from(String(content), 'utf8'), { force: !!force });
            json(res, result);
          } catch (err) {
            json(res, { ok: false, error: (err as Error).message });
          }
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
        // 多会话容器（如 ZCode/opencode 的 db.sqlite）：?sub=<subId> 精确选取会话；
        // 未传时回退容器内第一个会话（单会话文件如 Codex rollout 即此形态）
        const subParam = url.searchParams.get('sub');
        const sessMeta = store.listSessions({ tool: asset.tool, limit: 1000 });
        const metaRow = sessMeta.find((s) => s.assetId === asset.id && (!subParam || s.subId === subParam));
        const title = metaRow?.title ?? null;
        let messages: ApiDoc[] = [];
        const adapter = adapters.find((a) => a.id === asset.tool);
        if (adapter?.parse && asset.contentHash && cas.has(asset.contentHash)) {
          const result = adapter.parse(
            cas.pathFor(asset.contentHash),
            { kind: asset.kind, path: asset.path, tool: asset.tool, name: asset.name ?? undefined },
            'read',
          );
          if (result) {
            const wanted = subParam ?? result.sessions[0]?.subId;
            messages = result.docs
              .filter((d) => d.docType !== 'session_title')
              .filter((d) => !wanted || !d.subId || d.subId === wanted)
              .sort((a, b) => a.seq - b.seq)
              .slice(0, 500)
              .map((d) => ({
                seq: d.seq, role: d.role ?? null, ts: d.ts ?? null, docType: d.docType ?? 'file',
                text: d.text.length > API_DOC_TEXT_LIMIT ? d.text.slice(0, API_DOC_TEXT_LIMIT) + '\n…（超长截断，完整内容见资产原文）' : d.text,
              }));
          }
        }
        json(res, {
          tool: asset.tool, path: asset.path, title, messages,
          meta: metaRow ? {
            model: metaRow.model, projectPath: metaRow.projectPath, startedAt: metaRow.startedAt,
            messageCount: metaRow.messageCount, subId: metaRow.subId, usage: metaRow.usage,
          } : null,
        });
        return;
      }
      // ZCode 工具结果转储按需读取（不入资产库）：/api/artifacts?asset=<id>&sub=<sessionId>[&file=<name>]
      if (url.pathname === '/api/artifacts') {
        const assetId = Number(url.searchParams.get('asset'));
        const asset = store.getAssetById(assetId);
        const sub = url.searchParams.get('sub') ?? '';
        // 目录/文件名白名单校验，防路径穿越
        const safeSeg = (s: string) => /^[\w][\w.-]{0,120}$/.test(s) ? s : null;
        const dir = asset?.tool === 'zcode' && asset.contentHash && safeSeg(sub)
          ? path.join(resolveToolRoot('zcode'), 'cli', 'artifacts', sub)
          : null;
        if (!dir || !fs.existsSync(dir)) {
          json(res, { files: [] });
          return;
        }
        const fileParam = url.searchParams.get('file');
        if (fileParam != null) {
          const name = safeSeg(fileParam);
          const abs = name ? path.join(dir, name) : null;
          if (!abs || !fs.existsSync(abs) || !fs.statSync(abs).isFile() || path.dirname(abs) !== path.resolve(dir)) {
            json(res, { error: 'file not found' });
            return;
          }
          const buf = fs.readFileSync(abs);
          const text = buf.subarray(0, 512 * 1024).toString('utf8');
          json(res, { name, size: buf.length, truncated: buf.length > 512 * 1024, text });
          return;
        }
        const files = fs.readdirSync(dir, { withFileTypes: true })
          .filter((e) => e.isFile() && !isSidecar(e.name))
          .map((e) => {
            const st = fs.statSync(path.join(dir, e.name));
            return { name: e.name, size: st.size, mtime: st.mtime.toISOString() };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        json(res, { files });
        return;
      }
      // 技能聚合视图：各工具 skill 资产 + agents 共享库本体，按 realpath 分组（P5.2）
      if (url.pathname === '/api/skills') {
        const srcRows = store.db.prepare('SELECT tool, root_path FROM source').all() as unknown[];
        const rootByTool = new Map((srcRows as Record<string, unknown>[]).map((s) => [String(s.tool), String(s.root_path)]));
        const skillAssets = store.listAssets({ kind: 'skill', limit: 2000 });
        const groups = new Map<string, { key: string; name: string; description: string | null; storePath: string | null; entries: unknown[] }>();
        for (const a of skillAssets) {
          const adapter = adapters.find((x) => x.id === a.tool);
          const root = rootByTool.get(a.tool);
          if (!adapter || !root) continue;
          const abs = adapter.resolve ? adapter.resolve(root, a.path) : path.resolve(root, a.path);
          let real = abs;
          let linked = false;
          try {
            real = fs.realpathSync(abs);
            // 大小写不敏感比较（Windows realpath 会还原真实大小写，目录连接/符号链接均算链接）
            linked = real.toLowerCase() !== path.resolve(abs).toLowerCase();
          } catch {
            /* 文件已消失：仍按原路径展示 */
          }
          const key = process.platform === 'win32' ? real.toLowerCase() : real;
          // frontmatter description 从 CAS 副本提取（支持块标量）
          let description: string | null = null;
          if (a.contentHash) {
            description = extractDescription(cas.get(a.contentHash)?.toString('utf8') ?? '');
          }
          const g = groups.get(key) ?? { key, name: a.name ?? '', description, storePath: null, entries: [] };
          if (!g.description && description) g.description = description;
          if (a.tool === 'agents' && !g.storePath) g.storePath = abs;
          g.entries.push({ tool: a.tool, assetId: a.id, path: a.path, abs, linked, size: a.size ?? 0, mtime: a.mtime ?? '' });
          groups.set(key, g);
        }
        const skills = [...groups.values()].sort((x, y) => (x.storePath ? 0 : 1) - (y.storePath ? 0 : 1) || x.name.localeCompare(y.name));
        json(res, { skills });
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
