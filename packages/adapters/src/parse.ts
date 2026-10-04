import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ParsedDoc, ParsedResult, SessionMetaRow, ParseMode } from '@walle/core';

/**
 * 会话解析器集合（P2）。输入是 CAS 内容仓副本（只读），输出统一 ParsedResult。
 * - parseFamilyDb: ZCode / opencode 同族 schema（session + message + part，内容在 data JSON 列）
 * - parseCodexRollout: Codex 会话 JSONL（session_meta + response_item）
 * - parseCodexSessionIndex / parseCodexState: Codex 会话标题来源（noDocs 合并到会话文件资产）
 * - parseWorkbuddyRollout: WorkBuddy 会话 JSONL（session-meta / ai-title / message）
 * - parseWorkbuddyDb: WorkBuddy workbuddy.db sessions 表（权威标题/cwd/model，noDocs 合并）
 */

/** epoch 毫秒/秒 或 ISO 字符串 → ISO；无法识别返回 null */
function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'number' || /^\d{10,13}$/.test(String(v))) {
    const n = Number(v);
    const ms = n > 1e12 ? n : n * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = String(v);
  return isNaN(Date.parse(s)) ? null : s;
}

function safeJsonParse(text: string | null | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function cols(db: DatabaseSync, table: string): Set<string> {
  try {
    return new Set((db.prepare(`PRAGMA table_info("${table}")`).all() as unknown[]).map((r) => String((r as Record<string, unknown>).name)));
  } catch {
    return new Set();
  }
}

function tableExists(db: DatabaseSync, table: string): boolean {
  try {
    const r = db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name=?").get(table) as Record<string, unknown> | undefined;
    return Number(r?.c ?? 0) > 0;
  } catch {
    return false;
  }
}

/** ZCode / opencode 家族：session/message/part + data JSON */
export function parseFamilyDb(contentPath: string, mode: ParseMode): ParsedResult | null {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(contentPath, { readOnly: true });
  } catch {
    return null;
  }
  const docs: ParsedDoc[] = [];
  const sessions: SessionMetaRow[] = [];
  try {
    if (!tableExists(db, 'session') || !tableExists(db, 'message')) return null;
    const sCols = cols(db, 'session');
    const hasDir = sCols.has('directory');
    const hasTime = sCols.has('time_created');
    const sessRows = db
      .prepare(
        `SELECT id, title${hasDir ? ', directory' : ''}${hasTime ? ', time_created' : ''} FROM session ORDER BY id`,
      )
      .all() as unknown[];
    for (const raw of sessRows) {
      const r = raw as Record<string, unknown>;
      sessions.push({
        subId: String(r.id),
        title: r.title == null ? null : String(r.title),
        startedAt: toIso(r.time_created),
        projectPath: hasDir && r.directory != null ? String(r.directory) : null,
        messageCount: null,
      });
    }
    // 消息正文：part.data(type=text).text；角色来自 message.data.role
    const roleByMsg = new Map<string, { role: string | null; ts: string | null }>();
    const mCols = cols(db, 'message');
    const msgOrder = `ORDER BY session_id${mCols.has('time_created') ? ', time_created' : ''}${mCols.has('sequence') ? ', sequence' : ''}`;
    const msgRows = db
      .prepare(
        `SELECT id, session_id, data${mCols.has('time_created') ? ', time_created' : ''} FROM message ${msgOrder}`,
      )
      .all() as unknown[];
    for (const raw of msgRows) {
      const r = raw as Record<string, unknown>;
      const d = safeJsonParse(r.data == null ? null : String(r.data));
      roleByMsg.set(String(r.id), {
        role: d && typeof d.role === 'string' ? d.role : null,
        ts: toIso(r.time_created) ?? (d ? toIso((d.time as Record<string, unknown> | undefined)?.created) : null),
      });
    }
    const pCols = cols(db, 'part');
    let partRows: unknown[] = [];
    if (tableExists(db, 'part')) {
      partRows = db
        .prepare(
          `SELECT p.message_id, p.session_id, p.data FROM part p ORDER BY p.session_id, p.message_id${pCols.has('sequence') ? ', p.sequence' : ''}`,
        )
        .all() as unknown[];
    }
    let seq = 0;
    if (partRows.length > 0) {
      for (const raw of partRows) {
        const r = raw as Record<string, unknown>;
        const d = safeJsonParse(r.data == null ? null : String(r.data));
        const text = d && typeof d.text === 'string' ? d.text : '';
        if (!text.trim()) continue;
        const msg = roleByMsg.get(String(r.message_id));
        docs.push({
          subId: String(r.session_id),
          docType: 'session_message',
          seq: seq++,
          role: msg?.role ?? null,
          ts: msg?.ts ?? null,
          text,
        });
      }
    } else {
      // 无 part 表的库：message.data 若含文本字段直接取用
      for (const raw of msgRows) {
        const r = raw as Record<string, unknown>;
        const d = safeJsonParse(r.data == null ? null : String(r.data));
        const text = d && typeof d.content === 'string' ? d.content : '';
        if (!text.trim()) continue;
        docs.push({
          subId: String(r.session_id),
          docType: 'session_message',
          seq: seq++,
          role: d && typeof d.role === 'string' ? d.role : null,
          ts: toIso(r.time_created),
          text,
        });
      }
    }
    // 消息表为空时用输入历史兜底（kind='prompt'）
    if (docs.length === 0 && tableExists(db, 'input_history') && cols(db, 'input_history').has('text')) {
      const ih = db.prepare("SELECT session_id, text, time_created FROM input_history WHERE kind='prompt' ORDER BY time_created").all() as unknown[];
      for (const raw of ih) {
        const r = raw as Record<string, unknown>;
        if (!r.text) continue;
        docs.push({ subId: String(r.session_id), docType: 'session_message', seq: seq++, role: 'user', ts: toIso(r.time_created), text: String(r.text) });
      }
    }
    return { docs, sessions };
  } finally {
    db.close();
  }
}

/** Codex 会话 JSONL → 消息文档（不产 meta，标题由 session_index/state_5 合并） */
export function parseCodexRollout(contentPath: string, mode: ParseMode): ParsedResult | null {
  let text: string;
  try {
    text = fs.readFileSync(contentPath, 'utf8');
  } catch {
    return null;
  }
  const docs: ParsedDoc[] = [];
  const sessions: SessionMetaRow[] = [];
  let subId = '';
  let projectPath: string | null = null;
  let startedAt: string | null = null;
  let seq = 0;
  let firstUser: string | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const payload = o.payload as Record<string, unknown> | undefined;
    if (!payload) continue;
    if (o.type === 'session_meta') {
      subId = payload.session_id ? String(payload.session_id) : subId;
      projectPath = payload.cwd ? String(payload.cwd) : null;
      startedAt = toIso(payload.timestamp);
      continue;
    }
    if (o.type !== 'response_item' || payload.type !== 'message') continue;
    const role = typeof payload.role === 'string' ? payload.role : null;
    const content = Array.isArray(payload.content) ? (payload.content as Record<string, unknown>[]) : [];
    const body = content.map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n').trim();
    if (!body) continue;
    // 索引模式跳过环境注入块（首条 user 消息常为 <environment_context>）
    if (mode === 'index' && role === 'user' && body.startsWith('<environment_context>')) continue;
    if (!firstUser && role === 'user') firstUser = body;
    docs.push({ subId, docType: 'session_message', seq: seq++, role, ts: toIso(o.timestamp), text: body });
  }
  if (subId) {
    sessions.push({
      subId,
      title: firstUser ? firstUser.replace(/\s+/g, ' ').slice(0, 60) : null,
      startedAt,
      projectPath,
      messageCount: docs.length,
    });
  }
  return { docs, sessions };
}

/** Codex session_index.jsonl：轻量标题（noDocs 合并） */
export function parseCodexSessionIndex(contentPath: string): ParsedResult | null {
  let text: string;
  try {
    text = fs.readFileSync(contentPath, 'utf8');
  } catch {
    return null;
  }
  const sessions: SessionMetaRow[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!o.id) continue;
    sessions.push({ subId: String(o.id), title: o.thread_name ? String(o.thread_name) : null, startedAt: toIso(o.updated_at), noDocs: true });
  }
  return { docs: [], sessions };
}

/** Codex state_*.sqlite threads 表：权威会话元数据（noDocs 合并） */
export function parseCodexState(contentPath: string): ParsedResult | null {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(contentPath, { readOnly: true });
  } catch {
    return null;
  }
  const sessions: SessionMetaRow[] = [];
  try {
    if (!tableExists(db, 'threads')) return null;
    const rows = db.prepare('SELECT id, title, cwd, model, first_user_message, created_at, updated_at FROM threads ORDER BY id').all() as unknown[];
    for (const raw of rows) {
      const r = raw as Record<string, unknown>;
      if (r.id == null) continue;
      sessions.push({
        subId: String(r.id),
        title: r.title ? String(r.title) : r.first_user_message ? String(r.first_user_message).slice(0, 60) : null,
        startedAt: toIso(r.created_at) ?? toIso(r.updated_at),
        model: r.model ? String(r.model) : null,
        projectPath: r.cwd ? String(r.cwd) : null,
        noDocs: true,
      });
    }
    return { docs: [], sessions };
  } finally {
    db.close();
  }
}

/**
 * 剥离 WorkBuddy 的 <system-reminder> 环境注入块，只留用户真实输入。
 * 每个 user 轮次都以 data-role="user-context" 的注入块开头（user_info/current_time/工具提示等），
 * 真实提问跟在 </system-reminder> 之后（通常包在 <user_query> 中）；纯注入轮次剥离后为空。
 */
function stripInjectedBlocks(text: string): string {
  const t = text
    .replace(/<system-reminder\b[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/<\/?user_query>/gi, '');
  return t.trim();
}

/**
 * WorkBuddy 会话 JSONL（projects/<项目slug>/<会话id>.jsonl）→ 消息文档 + 会话元数据。
 * 行类型：session-meta（sessionId/meta）、ai-title（AI 生成的会话标题）、message（user/assistant，
 * content[].text）、function_call / function_call_result（工具调用与结果，role=tool 入索引）、
 * reasoning（思考，不入索引）、file-history-snapshot / resend-fork-notice（侧车事件）。
 * subId 取 session-meta/ai-title 的 sessionId，缺省用文件名（会话 uuid）。
 */
export function parseWorkbuddyRollout(contentPath: string, mode: ParseMode): ParsedResult | null {
  let text: string;
  try {
    text = fs.readFileSync(contentPath, 'utf8');
  } catch {
    return null;
  }
  const docs: ParsedDoc[] = [];
  const sessions: SessionMetaRow[] = [];
  let subId = path.basename(contentPath).replace(/\.jsonl$/, '');
  let title: string | null = null;
  let projectPath: string | null = null;
  let startedAt: string | null = null;
  let seq = 0;
  let firstUser: string | null = null;

  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = typeof o.type === 'string' ? o.type : '';
    if (o.sessionId) subId = String(o.sessionId);
    if (typeof o.cwd === 'string' && !projectPath) projectPath = o.cwd;
    if (type === 'ai-title' && typeof o.aiTitle === 'string') {
      title = o.aiTitle;
      continue;
    }
    if (type === 'function_call' || type === 'function_call_result') {
      // 工具调用 / 结果 → role=tool 文档（会话详情 Tools 页签）
      const name = typeof o.name === 'string' ? o.name : (typeof o.callId === 'string' ? String(o.callId) : 'tool');
      let body: string;
      if (type === 'function_call') {
        const args = typeof o.arguments === 'string' ? o.arguments.trim() : '';
        body = `[调用 ${name}]${args ? ' ' + args : ''}`;
      } else {
        const out = o.output as Record<string, unknown> | undefined;
        const outText = out && typeof out.text === 'string' ? out.text : '';
        const status = typeof o.status === 'string' && o.status !== 'completed' ? ` (${o.status})` : '';
        body = `[结果 ${name}]${status}${outText ? '\n' + outText : ''}`;
      }
      if (!body.trim()) continue;
      const ts = toIso(o.timestamp);
      if (!startedAt && ts) startedAt = ts;
      docs.push({ subId, docType: 'session_message', seq: seq++, role: 'tool', ts, text: body });
      continue;
    }
    if (type !== 'message') continue;
    const role = typeof o.role === 'string' ? o.role : null;
    const content = Array.isArray(o.content) ? (o.content as Record<string, unknown>[]) : [];
    const body = stripInjectedBlocks(content.map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n'));
    // 纯注入轮次（工具提示 / 错误恢复等）剥离后为空，跳过
    if (!body) continue;
    if (!firstUser && role === 'user') firstUser = body.replace(/\s+/g, ' ').slice(0, 60);
    const ts = toIso(o.timestamp);
    if (!startedAt && ts) startedAt = ts;
    docs.push({ subId, docType: 'session_message', seq: seq++, role, ts, text: body });
  }

  if (subId) {
    sessions.push({
      subId,
      title: title ?? firstUser,
      startedAt,
      projectPath,
      messageCount: docs.length,
    });
  }
  return { docs, sessions };
}

/**
 * WorkBuddy workbuddy.db sessions 表：权威会话索引（标题 / cwd / model / 创建时间）。
 * 无消息文档（noDocs），由索引器按 subId 合并到 projects 下的 <会话id>.jsonl 会话资产上。
 */
export function parseWorkbuddyDb(contentPath: string): ParsedResult | null {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(contentPath, { readOnly: true });
  } catch {
    return null;
  }
  const sessions: SessionMetaRow[] = [];
  try {
    if (!tableExists(db, 'sessions')) return null;
    const c = cols(db, 'sessions');
    const pick = (name: string) => (c.has(name) ? name : null);
    const sel = ['id', pick('title'), pick('custom_title'), pick('cwd'), pick('model'), pick('created_at'), pick('updated_at')]
      .filter((x): x is string => x != null)
      .join(', ');
    // 软删除标记存在时过滤已删会话
    const where = c.has('deleted_at') ? 'WHERE deleted_at IS NULL' : '';
    const rows = db.prepare(`SELECT ${sel} FROM sessions ${where}`).all() as unknown[];
    for (const raw of rows) {
      const r = raw as Record<string, unknown>;
      if (r.id == null) continue;
      const t = r.custom_title ? String(r.custom_title) : r.title ? String(r.title) : null;
      sessions.push({
        subId: String(r.id),
        title: t,
        startedAt: toIso(r.created_at) ?? toIso(r.updated_at),
        model: r.model ? String(r.model) : null,
        projectPath: r.cwd ? String(r.cwd) : null,
        noDocs: true,
      });
    }
    return { docs: [], sessions };
  } finally {
    db.close();
  }
}
