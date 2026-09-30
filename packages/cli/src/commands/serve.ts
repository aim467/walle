import http from 'node:http';
import { parseArgs } from 'node:util';
import { adapters } from '@walle/adapters';
import { openStores } from '../context.js';

/** P2 本地 Web UI：仅监听 127.0.0.1，只读 API（search / sessions / read / stats） */

interface ApiDoc {
  seq: number;
  role: string | null;
  ts: string | null;
  text: string;
}

const PAGE = `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>walle · 瓦力</title>
<style>
:root{
  --bg:#0f1115;--panel:#171a21;--panel2:#1d212b;--border:#2a2f3a;--text:#d7dce4;--dim:#8b93a1;
  --accent:#4f8cff;--user:#2d4a78;--assistant:#24313f;--system:#2b2436;--mark:#ffd54f;
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 "Segoe UI",system-ui,"Microsoft YaHei",sans-serif;height:100vh;display:flex;flex-direction:column}
header{display:flex;gap:10px;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--panel)}
header .logo{font-weight:700;color:var(--accent);white-space:nowrap}
#q{flex:1;background:var(--panel2);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px 12px;font-size:14px;outline:none}
#q:focus{border-color:var(--accent)}
select{background:var(--panel2);border:1px solid var(--border);border-radius:8px;color:var(--text);padding:8px}
main{flex:1;display:flex;min-height:0}
#list{width:420px;border-right:1px solid var(--border);overflow-y:auto;padding:8px}
#reader{flex:1;overflow-y:auto;padding:16px 22px}
.item{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer}
.item:hover{border-color:var(--accent)}
.item .meta{color:var(--dim);font-size:12px;display:flex;gap:8px;flex-wrap:wrap}
.item .title{font-weight:600;margin:2px 0}
.item .snip{color:var(--dim);font-size:13px}
mark{background:var(--mark);color:#000;border-radius:2px;padding:0 1px}
.msg{border-radius:12px;padding:10px 14px;margin-bottom:12px;max-width:860px;white-space:pre-wrap;word-break:break-word}
.msg .who{font-size:12px;color:var(--dim);margin-bottom:4px}
.msg.user{background:var(--user)}
.msg.assistant{background:var(--assistant)}
.msg.developer,.msg.system{background:var(--system);color:#b9aecb}
.msg .code{background:#0b0d10;border:1px solid var(--border);border-radius:6px;padding:8px;margin:6px 0;overflow-x:auto;white-space:pre;font-family:Consolas,monospace;font-size:13px}
.empty{color:var(--dim);text-align:center;margin-top:40px}
.tag{background:var(--panel2);border:1px solid var(--border);border-radius:4px;padding:0 6px;font-size:11px}
.hint{color:var(--dim);font-size:12px;padding:4px 10px 10px}
</style>
</head>
<body>
<header>
  <span class="logo">walle · 瓦力</span>
  <input id="q" placeholder="搜索全部会话与记忆…（Enter 搜索）" autofocus>
  <select id="tool"><option value="">全部来源</option></select>
  <select id="mode">
    <option value="search">搜索</option>
    <option value="sessions">会话列表</option>
  </select>
</header>
<main>
  <div id="list"><div class="empty">输入关键词搜索，或切换到「会话列表」</div></div>
  <div id="reader"><div class="empty">← 选择左侧结果查看完整内容</div></div>
</main>
<script>
const $=s=>document.querySelector(s);
const list=$('#list'),reader=$('#reader'),q=$('#q'),tool=$('#tool'),mode=$('#mode');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const roleLabel={user:'用户',assistant:'助手',developer:'系统注入',system:'系统',title:'标题'};
async function init(){
  const st=await (await fetch('/api/stats')).json();
  for(const s of st.sources){const o=document.createElement('option');o.value=s.tool;o.textContent=s.displayName;tool.appendChild(o);}
}
async function doSearch(){
  const query=q.value.trim();
  const p=new URLSearchParams();
  if(query)p.set('q',query);
  if(tool.value)p.set('tool',tool.value);
  if(mode.value==='sessions')p.set('sessions','1');
  const data=await (await fetch('/api/list?'+p)).json();
  if(data.error){list.innerHTML='<div class="empty">'+esc(data.error)+'</div>';return;}
  if(!data.hits||!data.hits.length){list.innerHTML='<div class="empty">没有结果</div>';return;}
  list.innerHTML='';
  for(const h of data.hits){
    const d=document.createElement('div');d.className='item';
    d.innerHTML='<div class="meta"><span class="tag">'+esc(h.tool)+'</span><span>'+esc(h.time??'')+'</span><span>'+esc(h.kind)+(h.role&&h.role!=='title'?' · '+esc(roleLabel[h.role]||h.role):'')+'</span></div>'
      +'<div class="title">'+esc(h.title??h.path)+'</div><div class="snip">'+h.snippet+'</div>';
    d.onclick=()=>openAsset(h.assetId);
    list.appendChild(d);
  }
}
async function openAsset(id){
  reader.innerHTML='<div class="empty">加载中…</div>';
  const data=await (await fetch('/api/read?asset='+id)).json();
  if(!data.messages||!data.messages.length){reader.innerHTML='<div class="empty">该资产没有可读消息（可能是未解析格式）</div>';return;}
  reader.innerHTML='<div class="hint">'+esc(data.title??'')+' · '+data.messages.length+' 条消息 · 来源 '+esc(data.tool)+'</div>';
  for(const m of data.messages){
    const div=document.createElement('div');div.className='msg '+esc(m.role||'assistant');
    const who=document.createElement('div');who.className='who';
    who.textContent=(roleLabel[m.role]||m.role||'未知')+(m.ts?' · '+m.ts.slice(0,19).replace('T',' '):'');
    const body=document.createElement('div');
    // 简单代码块渲染：\`\`\` 分段
    const parts=String(m.text).split('\`\`\`');
    parts.forEach((p,i)=>{
      if(i%2===1){const c=document.createElement('div');c.className='code';c.textContent=p.replace(/^\\w*\\n/,'');body.appendChild(c);}
      else body.appendChild(document.createTextNode(p));
    });
    div.appendChild(who);div.appendChild(body);reader.appendChild(div);
  }
}
q.addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();});
mode.addEventListener('change',()=>{if(q.value.trim()||mode.value==='sessions')doSearch();});
tool.addEventListener('change',doSearch);
init();
</script>
</body>
</html>`;

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
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(PAGE);
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
