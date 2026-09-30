/** 行级 LCS diff（步骤 2）。行数上限防 O(n²) 爆内存，超限退化为前后缀裁剪 + 粗标记。 */

export type DiffOp = 'same' | 'add' | 'del';

export interface DiffLine {
  op: DiffOp;
  text: string;
}

const MAX_DIFF_LINES = 2000;

export function diffLines(aText: string, bText: string): DiffLine[] {
  const a = aText.split('\n');
  const b = bText.split('\n');
  const n = a.length;
  const m = b.length;

  // 裁掉公共前后缀，缩小 dp 规模
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start++;
  let endA = n, endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) out.push({ op: 'same', text: a[i] });

  if (midA.length > MAX_DIFF_LINES || midB.length > MAX_DIFF_LINES) {
    // 超大文件：不做逐行对齐，整体标记
    if (midA.length) out.push({ op: 'del', text: `…（${midA.length} 行旧内容，超 diff 上限）` });
    if (midB.length) out.push({ op: 'add', text: `…（${midB.length} 行新内容，超 diff 上限）` });
  } else {
    // LCS dp
    const rows = midA.length, cols = midB.length;
    const dp: Uint32Array = new Uint32Array((rows + 1) * (cols + 1));
    const at = (i: number, j: number) => i * (cols + 1) + j;
    for (let i = rows - 1; i >= 0; i--) {
      for (let j = cols - 1; j >= 0; j--) {
        dp[at(i, j)] = midA[i] === midB[j] ? dp[at(i + 1, j + 1)] + 1 : Math.max(dp[at(i + 1, j)], dp[at(i, j + 1)]);
      }
    }
    let i = 0, j = 0;
    while (i < rows && j < cols) {
      if (midA[i] === midB[j]) { out.push({ op: 'same', text: midA[i] }); i++; j++; }
      else if (dp[at(i + 1, j)] >= dp[at(i, j + 1)]) { out.push({ op: 'del', text: midA[i] }); i++; }
      else { out.push({ op: 'add', text: midB[j] }); j++; }
    }
    while (i < rows) { out.push({ op: 'del', text: midA[i] }); i++; }
    while (j < cols) { out.push({ op: 'add', text: midB[j] }); j++; }
  }

  for (let k = endA; k < n; k++) out.push({ op: 'same', text: a[k] });
  return out;
}

/** 压缩 diff 输出：same 行折叠为上下文行（context 行数） */
export function collapseDiff(lines: DiffLine[], context = 2): (DiffLine & { gap?: number })[] {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, i) => {
    if (l.op !== 'same') {
      for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = true;
    }
  });
  const out: (DiffLine & { gap?: number })[] = [];
  let gap = 0;
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (gap > 0) out.push({ op: 'same', text: '⋯', gap });
      gap = 0;
      out.push(l);
    } else {
      gap++;
    }
  });
  if (gap > 0) out.push({ op: 'same', text: '⋯', gap });
  return out;
}
