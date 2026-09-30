/**
 * 敏感内容识别（开发文档 §8）。
 * 两级判定：文件名级（适配器调用）+ 内容级（扫描器对文件头 64KB 兜底扫描）。
 * 凭证类资产内容仍入内容仓（备份需要），但展示脱敏、永不入全文索引、导出默认排除。
 */

const SENSITIVE_NAME_RE = /(auth|credential|secret|token|\.env|password|apikey)/i;

/** 命中 secret 形态的值：key/value 或 key = value 形式，值长度 >= 20 */
const SECRET_VALUE_RE =
  /(?:api[_-]?key|bearer|token|secret|password)\s*[":=]+\s*["']?[A-Za-z0-9_\-]{20,}/i;

export function isSensitiveName(name: string): boolean {
  return SENSITIVE_NAME_RE.test(name);
}

export function looksSensitive(head: string): boolean {
  return SECRET_VALUE_RE.test(head);
}

/** 展示用脱敏：保留前 4 后 4 字符 */
export function maskSecrets(text: string): string {
  return text
    .replace(/(sk-[A-Za-z0-9]{4})[A-Za-z0-9\-]{4,}([A-Za-z0-9]{4})/g, '$1****$2')
    .replace(
      /((?:api[_-]?key|bearer|token|secret|password)["']?\s*[":=]+\s*["']?)([A-Za-z0-9_\-]{8})[A-Za-z0-9_\-]+([A-Za-z0-9_\-]{4})/gi,
      '$1$2****$3',
    );
}
