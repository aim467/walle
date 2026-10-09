import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ParsedDoc, ParsedResult, SessionMetaRow, ParseMode, TokenUsage } from '@walle/core';

/** 数值安全提取（非有限数返回 null） */
function numOf(v: unknown): number | null {
  return typeof v === 'number' && isFinite(v) ? v : null;
}

/** 求和；全部为 null 返回 null（0 是有效值，参与累加） */
function sumOrNull(...vals: (number | null)[]): number | null {
  let acc = 0;
  let any = false;
  for (const v of vals) if (v != null) { acc += v; any = true; }
  return any ? acc : null;
}

/**
 * opencode 家族 session 行 → 用量。token.md：opencode.db 的 session 表记录每个会话用量，
 * 含 tokens_input / tokens_output / tokens_cache_read / tokens_cache_write（另有 reasoning 与 cost）。
 * 列缺失为 null；六项全空返回 null（不硬造）。total 由 input+output+reasoning 求和（缓存不计入，与 Codex/ZCode 口径一致）。
 */
function sessionRowUsage(r: Record<string, unknown>): TokenUsage | null {
  const input = numOf(r.tokens_input);
  const output = numOf(r.tokens_output);
  const reasoning = numOf(r.tokens_reasoning);
  const cacheRead = numOf(r.tokens_cache_read);
  const cacheWrite = numOf(r.tokens_cache_write);
  const cost = numOf(r.cost);
  if (input == null && output == null && reasoning == null && cacheRead == null && cacheWrite == null && cost == null) return null;
  return { input, output, reasoning, cacheRead, cacheWrite, total: sumOrNull(input, output, reasoning), cost };
}

/**
 * ZCode 家族 model_usage 表 → 按 session_id 聚合用量。token.md：zcode 的 db.sqlite 的 model_usage
 * 表记录每个会话的用量（每次模型调用一行）。字段映射：
 * input_tokens / output_tokens / reasoning_tokens / cache_creation_input_tokens→cacheWrite /
 * cache_read_input_tokens→cacheRead；total 取 computed_total_tokens（回退 provider_total_tokens，再回退 input+output+reasoning）。
 * model_usage 无成本列 → cost 恒为 null。
 */
function familyModelUsage(db: DatabaseSync): Map<string, TokenUsage> {
  const out = new Map<string, TokenUsage>();
  if (!tableExists(db, 'model_usage')) return out;
  const c = cols(db, 'model_usage');
  if (!c.has('session_id')) return out;
  const sum = (col: string) => (c.has(col) ? `SUM("${col}")` : 'NULL');
  const rows = db
    .prepare(
      `SELECT session_id,
              ${sum('input_tokens')} input, ${sum('output_tokens')} output, ${sum('reasoning_tokens')} reasoning,
              ${sum('cache_read_input_tokens')} cache_read, ${sum('cache_creation_input_tokens')} cache_write,
              ${sum('computed_total_tokens')} total, ${sum('provider_total_tokens')} total_alt
       FROM model_usage GROUP BY session_id`,
    )
    .all() as unknown[];
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    if (r.session_id == null) continue;
    const input = numOf(r.input);
    const output = numOf(r.output);
    const reasoning = numOf(r.reasoning);
    const cacheRead = numOf(r.cache_read);
    const cacheWrite = numOf(r.cache_write);
    const total = numOf(r.total) ?? numOf(r.total_alt) ?? sumOrNull(input, output, reasoning);
    if (input == null && output == null && reasoning == null && cacheRead == null && cacheWrite == null && total == null) continue;
    out.set(String(r.session_id), { input, output, reasoning, cacheRead, cacheWrite, total, cost: null });
  }
  return out;
}

/**
 * 会话解析器集合（P2）。输入是 CAS 内容仓副本（只读），输出统一 ParsedResult。
 * - parseFamilyDb: ZCode / opencode 同族 schema（session + message + part，内容在 data JSON 列）；
 *   用量按 schema 自适应：opencode 取 session 表 token 列，ZCode 取 model_usage 表按会话聚合
 * - parseCodexRollout: Codex 会话 JSONL（session_meta + response_item）；用量恒空（token.md 未列入）
 * - parseCodexSessionIndex / parseCodexState: Codex 会话标题来源（noDocs 合并到会话文件资产）
 * - parseWorkbuddyRollout: WorkBuddy 会话 JSONL（session-meta / ai-title / message）
 * - parseWorkbuddyDb: WorkBuddy workbuddy.db sessions 表（权威标题/cwd/model，noDocs 合并）；
 *   用量取 session_usage 表（仅总量 used）
 * - parseCursorConversationSearch: Cursor conversation-search.db conversations 表（权威会话索引，noDocs 合并）
 * - parseCursorTranscript: Cursor agent-transcripts JSONL（明文消息正文，正文加密的绕行方案）
 * - parseClineSession / parseClineSessionMeta: Cline 会话正文与元数据（meta 提供标题/用量）
 * - parseClaudeSession: Claude Code 会话 JSONL（ai-title 标题 + assistant.message.usage 用量，按 message.id 去重）
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

/** 从工具调用 input 对象提取涉及的文件路径（path/file 类键的字符串值），供 Files 页签 */
function extractInputPaths(input: unknown): string[] {
  if (input == null || typeof input !== 'object') return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v !== 'string' || v.length === 0 || v.length > 500) continue;
    if (!/^(file_?path|filepath|path|notebook_path)$/i.test(k)) continue;
    if (!v.includes('/') && !v.includes('\\')) continue;
    if (/^[a-z]+:\/\//i.test(v)) continue;
    out.push(v);
  }
  return out;
}

/** 从 apply_patch 风格的补丁文本提取变更文件（*** Update/Add/Delete File: <path>） */
function extractPatchFilePaths(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^\*\*\* (?:Update|Add|Delete|Move to) File: (.+)$/gm)) {
    const p = m[1].trim();
    if (p) out.push(p);
  }
  return out;
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
    // 用量列（opencode：session 表自带 token 列）；ZCode 无此列，走下方 model_usage 表
    const hasSessionUsage = sCols.has('tokens_input') || sCols.has('tokens_output');
    const usageCols = ['tokens_input', 'tokens_output', 'tokens_reasoning', 'tokens_cache_read', 'tokens_cache_write', 'cost']
      .filter((c) => sCols.has(c));
    const sessSel = ['id', 'title', ...(hasDir ? ['directory'] : []), ...(hasTime ? ['time_created'] : []), ...usageCols].join(', ');
    const sessRows = db.prepare(`SELECT ${sessSel} FROM session ORDER BY id`).all() as unknown[];
    for (const raw of sessRows) {
      const r = raw as Record<string, unknown>;
      sessions.push({
        subId: String(r.id),
        title: r.title == null ? null : String(r.title),
        startedAt: toIso(r.time_created),
        projectPath: hasDir && r.directory != null ? String(r.directory) : null,
        messageCount: null,
        usage: hasSessionUsage ? sessionRowUsage(r) : null,
      });
    }
    // ZCode：session 表无 token 列时，用量取 model_usage 表按会话聚合（token.md 指定）
    if (!hasSessionUsage) {
      const bySession = familyModelUsage(db);
      if (bySession.size > 0) for (const s of sessions) s.usage = bySession.get(s.subId) ?? null;
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
        if (!d) continue;
        const subId = String(r.session_id);
        const msgTs = roleByMsg.get(String(r.message_id))?.ts ?? null;
        if (d.type === 'step-finish') {
          // 用量不再从 step-finish part 累加：改由 session 表（opencode）/ model_usage 表（ZCode）提供
          continue;
        }
        if (d.type === 'tool') {
          // 工具调用（ZCode/opencode 同构）：state.{status,input,output,time} → Tools 页签 + 涉及文件
          const name = typeof d.tool === 'string' ? d.tool : 'tool';
          const state = (d.state ?? {}) as Record<string, unknown>;
          const status = typeof state.status === 'string' && state.status !== 'completed' ? ` (${state.status})` : '';
          const ts = toIso((state.time as Record<string, unknown> | undefined)?.start) ?? msgTs;
          const input = state.input == null ? '' : JSON.stringify(state.input);
          if (input || status) {
            docs.push({ subId, docType: 'session_message', seq: seq++, role: 'tool', ts, text: `[调用 ${name}]${status}${input ? ' ' + input : ''}` });
          }
          const output = typeof state.output === 'string' ? state.output : '';
          if (output.trim()) {
            docs.push({ subId, docType: 'session_message', seq: seq++, role: 'tool', ts, text: `[结果 ${name}]${status}${output ? '\n' + output : ''}` });
          }
          for (const p of extractInputPaths(state.input)) {
            docs.push({ subId, docType: 'session_file', seq: seq++, role: 'tool', ts, text: p });
          }
          continue;
        }
        if (d.type === 'patch' && Array.isArray(d.files)) {
          // opencode patch part：直接给出本段变更的文件清单
          for (const p of d.files) {
            if (typeof p === 'string' && p) docs.push({ subId, docType: 'session_file', seq: seq++, role: 'tool', ts: msgTs, text: p });
          }
          continue;
        }
        if (d.type === 'reasoning') {
          // 思考内容（ZCode/opencode reasoning part）：独立 role=thinking，供会话页「思考」页签
          const text = typeof d.text === 'string' ? d.text : '';
          if (text.trim()) docs.push({ subId, docType: 'session_message', seq: seq++, role: 'thinking', ts: msgTs, text });
          continue;
        }
        const text = typeof d.text === 'string' ? d.text : '';
        if (!text.trim()) continue;
        docs.push({
          subId,
          docType: 'session_message',
          seq: seq++,
          role: roleByMsg.get(String(r.message_id))?.role ?? null,
          ts: msgTs,
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

/**
 * Codex 会话 JSONL → 消息文档（不产 meta，标题由 session_index/state_5 合并）。
 * 工具调用：function_call（name+arguments）/ custom_tool_call（name+input，apply_patch 形态）/
 * web_search_call（action.query），输出为 *_output（call_id 关联名称）→ role=tool 文档（Tools 页签）；
 * apply_patch 的 *** File 行另产 session_file 文档（Files 页签）。
 * 用量：token.md 未列入 Codex，即便 rollout 内含 token_count 事件也一律置空（不硬造）。
 */
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
  const callNames = new Map<string, string>();
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
    if (o.type !== 'response_item') continue;
    const ts = toIso(o.timestamp);
    if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const name = typeof payload.name === 'string' ? payload.name : 'tool';
      const callId = payload.call_id == null ? null : String(payload.call_id);
      if (callId) callNames.set(callId, name);
      const args = typeof payload.arguments === 'string' ? payload.arguments.trim() : typeof payload.input === 'string' ? payload.input.trim() : '';
      if (args || callId) {
        docs.push({ subId, docType: 'session_message', seq: seq++, role: 'tool', ts, text: `[调用 ${name}]${args ? ' ' + args : ''}` });
      }
      if (args.includes('*** ')) {
        for (const p of extractPatchFilePaths(args)) {
          docs.push({ subId, docType: 'session_file', seq: seq++, role: 'tool', ts, text: p });
        }
      } else if (payload.type === 'function_call') {
        for (const p of extractInputPaths(safeJsonParse(args || null))) {
          docs.push({ subId, docType: 'session_file', seq: seq++, role: 'tool', ts, text: p });
        }
      }
      continue;
    }
    if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      const callId = payload.call_id == null ? '' : String(payload.call_id);
      const name = callNames.get(callId) ?? (callId ? callId.slice(0, 16) : 'tool');
      const out = typeof payload.output === 'string' ? payload.output : '';
      if (!out.trim() && !callId) continue;
      docs.push({ subId, docType: 'session_message', seq: seq++, role: 'tool', ts, text: `[结果 ${name}]${out ? '\n' + out : ''}` });
      continue;
    }
    if (payload.type === 'web_search_call') {
      const action = payload.action as Record<string, unknown> | undefined;
      const query = action && typeof action.query === 'string' ? action.query : '';
      if (query) docs.push({ subId, docType: 'session_message', seq: seq++, role: 'tool', ts, text: `[调用 web_search] ${query}` });
      continue;
    }
    if (payload.type !== 'message') continue;
    const role = typeof payload.role === 'string' ? payload.role : null;
    const content = Array.isArray(payload.content) ? (payload.content as Record<string, unknown>[]) : [];
    const body = content.map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n').trim();
    if (!body) continue;
    // 索引模式跳过环境注入块（首条 user 消息常为 <environment_context>）
    if (mode === 'index' && role === 'user' && body.startsWith('<environment_context>')) continue;
    if (!firstUser && role === 'user') firstUser = body;
    docs.push({ subId, docType: 'session_message', seq: seq++, role, ts, text: body });
  }
  if (subId) {
    sessions.push({
      subId,
      title: firstUser ? firstUser.replace(/\s+/g, ' ').slice(0, 60) : null,
      startedAt,
      projectPath,
      messageCount: docs.length,
      usage: null,
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

  // 预扫各行类型：思考模式（Hy3 等）下模型的思考独白以 type=message role=assistant 标准形态写入，
  // 与正常回复无法从行内字段区分；其可靠特征是后面紧跟 function_call（思考 → 调工具）。
  const lineTypes: string[] = [];
  const objs: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as Record<string, unknown>;
      objs.push(o);
      lineTypes.push(typeof o.type === 'string' ? o.type : '');
    } catch {
      /* 坏行跳过 */
    }
  }

  for (let li = 0; li < objs.length; li++) {
    const o = objs[li];
    const type = lineTypes[li];
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
      if (type === 'function_call') {
        const args = typeof o.arguments === 'string' ? o.arguments.trim() : '';
        const paths = args.includes('*** ') ? extractPatchFilePaths(args) : extractInputPaths(safeJsonParse(args || null));
        for (const p of paths) {
          docs.push({ subId, docType: 'session_file', seq: seq++, role: 'tool', ts, text: p });
        }
      }
      continue;
    }
    if (type === 'reasoning') {
      // 思考行（思考模型的思考，rawContent=[{type:'reasoning_text',text}]；content 恒空）→ role=thinking
      const raw = Array.isArray(o.rawContent) ? (o.rawContent as Record<string, unknown>[]) : [];
      const body = raw.map((c) => (typeof c.text === 'string' ? c.text : '')).join('\n');
      if (body.trim()) docs.push({ subId, docType: 'session_message', seq: seq++, role: 'thinking', ts: toIso(o.timestamp), text: body });
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
    // 思考模式的工具前独白（后面紧跟 function_call）→ role=thinking（不混入助手消息，可在「思考」页签查看）
    if (role === 'assistant' && lineTypes[li + 1] === 'function_call') {
      docs.push({ subId, docType: 'session_message', seq: seq++, role: 'thinking', ts, text: body });
      continue;
    }
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
 * 用量：token.md 指定取 session_usage 表，该表只记总量（used）——input/output 等一律为 null。
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
    // 会话用量（session_usage.session_id → used，仅总量）
    const usageBySession = new Map<string, TokenUsage>();
    if (tableExists(db, 'session_usage')) {
      const uc = cols(db, 'session_usage');
      if (uc.has('session_id') && uc.has('used')) {
        const urows = db.prepare('SELECT session_id, used FROM session_usage').all() as unknown[];
        for (const raw of urows) {
          const r = raw as Record<string, unknown>;
          const used = numOf(r.used);
          if (r.session_id != null && used != null) usageBySession.set(String(r.session_id), { total: used });
        }
      }
    }
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
      const subId = String(r.id);
      sessions.push({
        subId,
        title: t,
        startedAt: toIso(r.created_at) ?? toIso(r.updated_at),
        model: r.model ? String(r.model) : null,
        projectPath: r.cwd ? String(r.cwd) : null,
        usage: usageBySession.get(subId) ?? null,
        noDocs: true,
      });
    }
    return { docs: [], sessions };
  } finally {
    db.close();
  }
}

/**
 * Cursor conversation-search.db conversations 表 → 权威会话索引（id / title / updated_at）。
 * 消息正文受 blobEncryptionKey 加密（FTS body 为空），此处仅作标题来源（noDocs）：
 * 由索引器合并到 agent-transcripts 会话文件资产上，找不到对应文件资产的会话挂回本资产（仍计入会话数）。
 */
export function parseCursorConversationSearch(contentPath: string): ParsedResult | null {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(contentPath, { readOnly: true });
  } catch {
    return null;
  }
  const sessions: SessionMetaRow[] = [];
  try {
    if (!tableExists(db, 'conversations')) return null;
    const rows = db.prepare('SELECT id, title, updated_at FROM conversations ORDER BY updated_at').all() as unknown[];
    for (const raw of rows) {
      const r = raw as Record<string, unknown>;
      if (r.id == null) continue;
      const title = r.title ? String(r.title).trim() : '';
      sessions.push({
        subId: String(r.id),
        title: title || null,
        startedAt: toIso(r.updated_at),
        messageCount: null,
        noDocs: true,
      });
    }
    return { docs: [], sessions };
  } finally {
    db.close();
  }
}

/**
 * Cursor agent-transcripts JSONL（projects/<项目slug>/agent-transcripts/<composerId>/<composerId>.jsonl）
 * → 消息文档 + 会话元数据。行形如 {role, message:{content:[{type:'text'|'tool_use', text, name, input}]}}，
 * 另有无 role 的 turn_ended 控制行（跳过）。行内无时间戳；user 首轮带 <timestamp>/<user_query> 注入包装，剥离。
 * 标题取首条用户提问兜底，conversation-search.db 合并时以库内标题为准。
 * composerId 需由调用方从资产路径取（正文行内无会话 id；contentPath 是 CAS 哈希文件名，不可作 subId）。
 */
export function parseCursorTranscript(contentPath: string, composerId: string): ParsedResult | null {
  let text: string;
  try {
    text = fs.readFileSync(contentPath, 'utf8');
  } catch {
    return null;
  }
  const docs: ParsedDoc[] = [];
  const sessions: SessionMetaRow[] = [];
  const subId = composerId;
  let firstUser: string | null = null;
  let seq = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const role = typeof o.role === 'string' ? o.role : null;
    if (!role) continue; // turn_ended 等控制行
    const msg = o.message as Record<string, unknown> | undefined;
    const content = msg && Array.isArray(msg.content) ? (msg.content as Record<string, unknown>[]) : [];
    for (const item of content) {
      if (item.type === 'tool_use') {
        const name = typeof item.name === 'string' ? item.name : 'tool';
        const input = item.input == null ? '' : JSON.stringify(item.input);
        docs.push({ subId, docType: 'session_message', seq: seq++, role: 'tool', ts: null, text: `[调用 ${name}]${input ? ' ' + input : ''}` });
        for (const p of extractInputPaths(item.input)) {
          docs.push({ subId, docType: 'session_file', seq: seq++, role: 'tool', ts: null, text: p });
        }
        continue;
      }
      if (item.type !== 'text' || typeof item.text !== 'string') continue;
      const body = item.text
        .replace(/<timestamp\b[\s\S]*?<\/timestamp>/gi, '')
        .replace(/<\/?user_query>/gi, '')
        .trim();
      if (!body) continue;
      if (!firstUser && role === 'user') firstUser = body.replace(/\s+/g, ' ').slice(0, 60);
      docs.push({ subId, docType: 'session_message', seq: seq++, role, ts: null, text: body });
    }
  }
  if (subId) {
    sessions.push({ subId, title: firstUser, startedAt: null, projectPath: null, messageCount: docs.length });
  }
  return { docs, sessions };
}

// ============================== Cline（v1.24）==============================
// ~/.cline/data/sessions/<sessionId>/<sessionId>.messages.json 是会话正文（明文 JSON），
// <sessionId>.json 是会话元数据（标题/用量/项目，noDocs 合并到会话资产）。
// 流式 chunk 日志（apps/<name>/sessions/*.jsonl）与 data/db/*.db 均为内部运行时产物，不收。

/** 读整个 JSON 文件（损坏/缺失返回 null） */
function readJsonFile(contentPath: string): unknown | null {
  let text: string;
  try {
    text = fs.readFileSync(contentPath, 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

interface ClineContentItem {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

/** <user_input mode="act">…</user_input> 注入包装 → 剥壳留正文（与 Cursor 转录同口径） */
function stripClineUserInput(text: string): string {
  const m = text.match(/^<user_input[^>]*>([\s\S]*?)<\/user_input>\s*$/);
  return m ? m[1] : text;
}

/** tool_result 的 content 数组（[{query,result}] 或 [{type,text}]）拍平为可索引文本 */
function clineToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const c of content) {
    if (c == null || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    if (typeof o.result === 'string') parts.push(o.result);
    else if (typeof o.text === 'string') parts.push(o.text);
  }
  return parts.join('\n');
}

/** Cline 会话正文：messages JSON（单会话一文件，subId = session_id） */
export function parseClineSession(contentPath: string, mode: ParseMode): ParsedResult | null {
  void mode;
  const j = readJsonFile(contentPath) as { sessionId?: unknown; messages?: unknown } | null;
  if (!j) return null;
  const subId = typeof j.sessionId === 'string' && j.sessionId ? j.sessionId : null;
  if (!Array.isArray(j.messages)) return null;
  const docs: ParsedDoc[] = [];
  let seq = 0;
  for (const m of j.messages) {
    if (m == null || typeof m !== 'object') continue;
    const msg = m as { role?: unknown; ts?: unknown; content?: unknown };
    const role = msg.role === 'user' || msg.role === 'assistant' ? msg.role : null;
    if (!role || !Array.isArray(msg.content)) continue;
    const ts = toIso(msg.ts);
    for (const c of msg.content as ClineContentItem[]) {
      if (c == null || typeof c !== 'object') continue;
      if (c.type === 'text' && typeof c.text === 'string' && c.text.trim()) {
        const text = role === 'user' ? stripClineUserInput(c.text) : c.text;
        docs.push({ subId: subId ?? undefined, docType: 'session_message', seq: seq++, role, ts, text });
      } else if (c.type === 'thinking' && typeof c.thinking === 'string' && c.thinking.trim()) {
        docs.push({ subId: subId ?? undefined, docType: 'session_message', seq: seq++, role: 'thinking', ts, text: c.thinking });
      } else if (c.type === 'tool_use') {
        const name = typeof c.name === 'string' ? c.name : 'unknown';
        const args = c.input == null ? '' : JSON.stringify(c.input);
        docs.push({ subId: subId ?? undefined, docType: 'session_message', seq: seq++, role: 'tool', ts, text: `[调用 ${name}]${args ? ' ' + args : ''}` });
        for (const p of extractInputPaths(c.input)) {
          docs.push({ subId: subId ?? undefined, docType: 'session_file', seq: seq++, role: 'tool', ts, text: p });
        }
      } else if (c.type === 'tool_result') {
        const name = typeof c.name === 'string' ? c.name : 'unknown';
        const output = clineToolResultText(c.content);
        docs.push({ subId: subId ?? undefined, docType: 'session_message', seq: seq++, role: 'tool', ts, text: `[结果 ${name}]${output ? '\n' + output : ''}` });
      }
    }
  }
  const sessions: SessionMetaRow[] = subId
    ? [{ subId, title: null, startedAt: null, projectPath: null, messageCount: docs.length }]
    : [];
  return { docs, sessions };
}

/** Cline 会话元数据：<sessionId>.json（标题/项目/用量权威来源，noDocs 合并到 messages 资产） */
export function parseClineSessionMeta(contentPath: string): ParsedResult | null {
  const j = readJsonFile(contentPath) as Record<string, unknown> | null;
  if (!j) return null;
  const subId = typeof j.session_id === 'string' && j.session_id ? j.session_id : null;
  if (!subId) return null;
  const meta = (j.metadata ?? {}) as Record<string, unknown>;
  // token.md：cline 的 json 文件里含 token 用量（metadata.tokensIn/tokensOut/cacheReads/cacheWrites/totalCost）
  const tokensIn = numOf(meta.tokensIn);
  const tokensOut = numOf(meta.tokensOut);
  const cacheRead = numOf(meta.cacheReads);
  const cacheWrite = numOf(meta.cacheWrites);
  const usage: TokenUsage | null = tokensIn != null || tokensOut != null || cacheRead != null || cacheWrite != null
    ? {
        input: tokensIn,
        output: tokensOut,
        cacheRead,
        cacheWrite,
        cost: numOf(meta.totalCost),
        total: sumOrNull(tokensIn, tokensOut),
      }
    : null;
  return {
    docs: [],
    sessions: [
      {
        subId,
        title: typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim() : (typeof j.prompt === 'string' && j.prompt.trim() ? j.prompt.trim() : null),
        startedAt: toIso(j.started_at),
        model: typeof j.model === 'string' ? j.model : null,
        projectPath: typeof j.cwd === 'string' ? j.cwd : null,
        messageCount: null,
        usage,
        noDocs: true,
      },
    ],
  };
}

// ============================== Claude Code（v1.28）==============================
// ~/.claude/projects/<slug>/<sessionId>.jsonl 是会话正文（JSONL，一行一个事件对象）。
// 关键坑：一条 API 助手消息会拆成多行（每个 content block 一行），message.id 相同、message.usage 完全相同，
// 因此用量必须按 message.id 去重后再累加，否则高估 2–6 倍。标题取 ai-title 行（权威），回退首条 user 文本。
// 噪声行（queue-operation / attachment / file-history-snapshot / atis-latch / last-prompt / mode /
// permission-mode / cost-state / system）一律不收。标题/用量/正文全在同一文件，故产出一个非 noDocs 的会话行。

/** 不产文档的 Claude 事件类型（运行时状态/注入快照，非对话内容） */
const CLAUDE_NOISE_TYPES = new Set([
  'queue-operation',
  'attachment',
  'file-history-snapshot',
  'atis-latch',
  'last-prompt',
  'mode',
  'permission-mode',
  'cost-state',
  'system',
]);

/** <system-reminder>…</system-reminder> 等注入包装 → 剥壳留正文（与 Cursor/Cline 同口径） */
function stripClaudeInjected(text: string): string {
  return text.replace(/<system-reminder\b[^>]*>[\s\S]*?<\/system-reminder>/gi, '').trim();
}

/** 事件 message.content → block 数组（容错：非数组/非对象项过滤） */
function claudeContentBlocks(msg: Record<string, unknown>): Record<string, unknown>[] {
  const c = msg.content;
  if (!Array.isArray(c)) return [];
  return c.filter((b): b is Record<string, unknown> => b != null && typeof b === 'object');
}

/** 单次 API 调用的用量映射（token.md/文档口径：无 cost 列） */
function claudeUsage(u: Record<string, unknown>): TokenUsage | null {
  const input = numOf(u.input_tokens);
  const output = numOf(u.output_tokens);
  const cacheRead = numOf(u.cache_read_input_tokens);
  const cacheWrite = numOf(u.cache_creation_input_tokens);
  const details = (u.output_tokens_details ?? {}) as Record<string, unknown>;
  const reasoning = numOf(details.thinking_tokens);
  if (input == null && output == null && cacheRead == null && cacheWrite == null && reasoning == null) return null;
  return { input, output, reasoning, cacheRead, cacheWrite, total: sumOrNull(input, output), cost: null };
}

/** tool_result 的 content（字符串或 [{type:'text',text}]）拍平为可索引文本 */
function claudeToolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const c of content) {
    if (c == null || typeof c !== 'object') continue;
    const o = c as Record<string, unknown>;
    if (typeof o.text === 'string') parts.push(o.text);
  }
  return parts.join('\n');
}

/** 首条 user 文本（非 tool_result）→ 标题回退值，单行截断 60 字 */
function claudeFirstUserText(msg: Record<string, unknown>): string | null {
  const texts: string[] = [];
  if (typeof msg.content === 'string') texts.push(msg.content);
  else for (const b of claudeContentBlocks(msg)) if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
  const body = stripClaudeInjected(texts.join('\n')).replace(/\s+/g, ' ').trim();
  return body ? body.slice(0, 60) : null;
}

/** Claude Code 会话 JSONL：单文件含标题（ai-title）/用量/正文，subId = sessionId */
export function parseClaudeSession(contentPath: string, mode: ParseMode): ParsedResult | null {
  void mode;
  let text: string;
  try {
    text = fs.readFileSync(contentPath, 'utf8');
  } catch {
    return null;
  }
  const events: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    const o = safeJsonParse(line);
    if (o) events.push(o);
  }
  if (!events.length) return null;

  // 第一遍：会话级元数据 + 按 message.id 去重的用量 + tool_use_id→name 映射
  let subId: string | null = null;
  let projectPath: string | null = null;
  let model: string | null = null;
  let startedAt: string | null = null;
  let title: string | null = null;
  let firstUserText: string | null = null;
  const toolNameById = new Map<string, string>();
  const usageById = new Map<string, TokenUsage>();
  for (const e of events) {
    if (subId == null && typeof e.sessionId === 'string' && e.sessionId) subId = e.sessionId;
    if (projectPath == null && typeof e.cwd === 'string' && e.cwd) projectPath = e.cwd;
    if (startedAt == null) startedAt = toIso(e.timestamp);
    if (e.type === 'ai-title' && typeof e.aiTitle === 'string' && e.aiTitle.trim()) title = e.aiTitle.trim();
    if (e.type !== 'assistant' && e.type !== 'user') continue;
    const msg = (e.message ?? null) as Record<string, unknown> | null;
    if (!msg) continue;
    if (e.type === 'assistant') {
      if (model == null && typeof msg.model === 'string') model = msg.model;
      // 同一条 API 消息拆成多行（同 message.id、同 usage）——只记一次，避免高估
      if (typeof msg.id === 'string' && msg.id && msg.usage && typeof msg.usage === 'object' && !usageById.has(msg.id)) {
        const u = claudeUsage(msg.usage as Record<string, unknown>);
        if (u) usageById.set(msg.id, u);
      }
      for (const b of claudeContentBlocks(msg)) {
        if (b.type === 'tool_use' && typeof b.id === 'string' && typeof b.name === 'string') toolNameById.set(b.id, b.name);
      }
    } else if (firstUserText == null) {
      firstUserText = claudeFirstUserText(msg);
    }
  }
  const sid = subId ?? path.basename(contentPath).replace(/\.jsonl$/, '');

  // 第二遍：产文档（按行序 seq 递增）
  const docs: ParsedDoc[] = [];
  let seq = 0;
  for (const e of events) {
    const type = typeof e.type === 'string' ? e.type : '';
    if (CLAUDE_NOISE_TYPES.has(type) || e.isMeta === true) continue;
    const msg = (e.message ?? null) as Record<string, unknown> | null;
    if (!msg) continue;
    const ts = toIso(e.timestamp);
    if (type === 'user') {
      if (typeof msg.content === 'string') {
        const body = stripClaudeInjected(msg.content);
        if (body) docs.push({ subId: sid, docType: 'session_message', seq: seq++, role: 'user', ts, text: body });
        continue;
      }
      for (const b of claudeContentBlocks(msg)) {
        if (b.type === 'text' && typeof b.text === 'string') {
          const body = stripClaudeInjected(b.text);
          if (body) docs.push({ subId: sid, docType: 'session_message', seq: seq++, role: 'user', ts, text: body });
        } else if (b.type === 'tool_result') {
          const name = typeof b.tool_use_id === 'string' ? toolNameById.get(b.tool_use_id) ?? '' : '';
          const output = claudeToolResultText(b.content);
          docs.push({ subId: sid, docType: 'session_message', seq: seq++, role: 'tool', ts, text: `[结果 ${name}]${output ? '\n' + output : ''}` });
        }
      }
    } else if (type === 'assistant') {
      for (const b of claudeContentBlocks(msg)) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
          docs.push({ subId: sid, docType: 'session_message', seq: seq++, role: 'assistant', ts, text: b.text });
        } else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim()) {
          docs.push({ subId: sid, docType: 'session_message', seq: seq++, role: 'thinking', ts, text: b.thinking });
        } else if (b.type === 'tool_use') {
          const name = typeof b.name === 'string' ? b.name : 'unknown';
          const args = b.input == null ? '' : JSON.stringify(b.input);
          docs.push({ subId: sid, docType: 'session_message', seq: seq++, role: 'tool', ts, text: `[调用 ${name}]${args ? ' ' + args : ''}` });
          for (const p of extractInputPaths(b.input)) {
            docs.push({ subId: sid, docType: 'session_file', seq: seq++, role: 'tool', ts, text: p });
          }
        }
      }
    }
  }

  // 用量按 message.id 去重后跨会话累加（无数据如实为空）
  let usage: TokenUsage | null = null;
  if (usageById.size) {
    const vals = [...usageById.values()];
    const pick = (k: 'input' | 'output' | 'reasoning' | 'cacheRead' | 'cacheWrite') => sumOrNull(...vals.map((u) => u[k] ?? null));
    const input = pick('input');
    const output = pick('output');
    const reasoning = pick('reasoning');
    const cacheRead = pick('cacheRead');
    const cacheWrite = pick('cacheWrite');
    if (input != null || output != null || reasoning != null || cacheRead != null || cacheWrite != null) {
      usage = { input, output, reasoning, cacheRead, cacheWrite, total: sumOrNull(input, output), cost: null };
    }
  }

  return {
    docs,
    sessions: [{ subId: sid, title: title ?? firstUserText, startedAt, model, projectPath, messageCount: docs.length, usage }],
  };
}
