/** shadcn 风格 cn 工具（clsx + tailwind-merge） */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * token 数量格式化。
 *
 * 缩写单位（M=10^6、k=10^3）在中文语境常被误读成「万」——例如把
 * 442.70 M 读成「四百多万」。因此 ≥ 1万 时并列给出中文单位，例如
 * 442.70 M（4.43亿）、553.9 k（23.33万），让量级不会再被读错。
 * 目的是消除歧义而非提升精度：精确值用 fmtTokExact 走 tooltip。
 */
export function fmtTok(n: number | null | undefined): string {
  if (n == null) return '-';
  // 缩写侧保持原有固定小数位（442.70 M），只在其后并列中文单位；
  // 精确值交给 fmtTokExact 走 tooltip。
  const short =
    n >= 1e9 ? (n / 1e9).toFixed(2) + ' B'
    : n >= 1e6 ? (n / 1e6).toFixed(2) + ' M'
    : n >= 1e3 ? (n / 1e3).toFixed(1) + ' k'
    : null;
  if (short == null) return Math.round(n).toLocaleString('en-US');
  const cn = cnUnit(n);
  return cn == null ? short : `${short}（${cn}）`;
}

/** 精确值，用于 title / tooltip，避免缩写丢精度后无法核对 */
export function fmtTokExact(n: number | null | undefined): string {
  if (n == null) return '-';
  return Math.round(n).toLocaleString('en-US');
}

/** 取不超过量级的最大中文单位（亿 / 万），小数位随量级收敛并去掉尾零 */
function cnUnit(n: number): string | null {
  const [base, suffix] = n >= 1e8 ? [1e8, '亿'] : n >= 1e4 ? [1e4, '万'] : [0, ''];
  if (base === 0) return null;
  const v = n / base;
  return trimZeros(v.toFixed(v >= 1000 ? 0 : v >= 100 ? 1 : 2)) + suffix;
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}
