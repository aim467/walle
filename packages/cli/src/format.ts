/** 终端输出格式化工具 */

export function humanSize(bytes: number | null | undefined): string {
  if (bytes == null) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
}

export function pad(s: string, n: number): string {
  const wide = [...s];
  return wide.length >= n ? s : s + ' '.repeat(n - wide.length);
}

/** 按显示宽度截断长路径（保留尾部） */
export function trunc(s: string, n: number): string {
  const wide = [...s];
  if (wide.length <= n) return s;
  return '…' + wide.slice(wide.length - n + 1).join('');
}

export function shortTime(iso: string | null): string {
  if (!iso) return '-';
  return iso.replace('T', ' ').slice(0, 19);
}
