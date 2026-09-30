/**
 * 中文优先的索引分词（FTS5 unicode61 不切分 CJK，整段汉字会被当成单 token，子串无法命中）。
 * 策略：ASCII 词原样保留（小写），CJK 连续段滑窗切二元（bigram），空格连接。
 * 查询侧用同一分词，token 之间隐式 AND —— 两个字及以上的中文词、英文词、中英混合均可命中。
 */

const ASCII_WORD = /[a-z0-9_]+/g;
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/; // 汉字 + 假名

function segment(text: string): string[] {
  const tokens: string[] = [];
  let buf = '';
  const flush = () => {
    if (!buf) return;
    if (buf.length === 1) {
      tokens.push(buf);
    } else {
      for (let i = 0; i < buf.length - 1; i++) tokens.push(buf.slice(i, i + 2));
      // 尾部单字补一元，保证最后一个字单独可查
      tokens.push(buf.slice(buf.length - 1));
    }
    buf = '';
  };
  for (const ch of text) {
    if (CJK.test(ch)) {
      buf += ch;
    } else {
      flush();
    }
  }
  flush();
  return tokens;
}

/** 把文本转为空格分隔的索引 token 串（ASCII 词 + CJK bigram） */
export function cjkTokenize(text: string): string {
  const parts: string[] = [];
  for (const m of text.toLowerCase().matchAll(ASCII_WORD)) {
    if (m[0].length >= 2 || /^[0-9]+$/.test(m[0])) parts.push(m[0]);
  }
  parts.push(...segment(text));
  return parts.join(' ');
}

/** 把用户查询转为 FTS5 MATCH 表达式（token 加引号防语法注入，隐式 AND） */
export function buildFtsQuery(query: string): string {
  const q = query.trim().toLowerCase();
  if (!q) return '';
  const tokens: string[] = [];
  for (const m of q.matchAll(ASCII_WORD)) tokens.push(m[0]);
  tokens.push(...segment(q));
  const uniq = [...new Set(tokens.filter((t) => t.length >= 2))];
  if (uniq.length === 0) return '';
  return uniq.map((t) => `"${t}"`).join(' ');
}
