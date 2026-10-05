import fs from 'node:fs';
import path from 'node:path';
import { readZip } from '@walle/core';
import type { ZipEntry } from '@walle/core';

/** 技能导入（互联网下载）：GitHub 仓库 / 任意 zip 直链 → 共享库 ~/.agents/skills → 各工具链接/复制接入。
 *  零依赖：下载用内置 fetch，解包复用 core 的 readZip（ADR-001 D4）。
 *  设计为可注入 zip Buffer 的纯函数 + 网络/磁盘薄层，便于单测。 */

const ZIP_MAX_BYTES = 100 * 1024 * 1024; // 下载体积上限
const FETCH_TIMEOUT_MS = 30_000;

export interface SkillCandidate {
  /** 技能名（zip 内 SKILL.md 所在目录名） */
  name: string;
  /** zip 内技能目录路径（不含末尾 /），作为安装时的选取标识 */
  path: string;
  description: string | null;
}

export interface LinkTarget {
  tool: string;
  mode: 'link' | 'copy';
}

/** 从 SKILL.md frontmatter 提取 description（支持 >- / | 等块标量的多行折叠） */
export function extractDescription(text: string): string | null {
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

/** zip 条目名安全校验：拒绝绝对路径与 .. 穿越 */
function safeEntryName(name: string): boolean {
  if (/^([a-zA-Z]:)?[\\/]/.test(name)) return false;
  return !name.split(/[\\/]/).includes('..');
}

export interface ParsedSource {
  kind: 'github' | 'zip' | 'skillhub';
  /** 实际下载的 zip 地址（GitHub 按顺序尝试，codeload 失败回退 api zipball） */
  zipUrls: string[];
  /** 展示用的原始来源 */
  display: string;
  /** SkillHub 技能 slug（kind=skillhub 时用于目录命名） */
  slug?: string;
}

/** SkillHub（skillhub.cn）下载入口：302 到腾讯云 COS，国内直连稳定 */
const SKILLHUB_API = 'https://api.skillhub.cn';

/** 识别技能来源：GitHub 仓库/子目录链接 → codeload/api zipball 双通道；SkillHub 技能页链接 → 官方下载接口；其余按 zip 直链 */
export function parseSkillSource(input: string): ParsedSource {
  const raw = input.trim();
  if (!raw) throw new Error('请输入来源 URL');
  // 裸 owner/repo 形态
  if (/^[\w.-]+\/[\w.-]+$/.test(raw)) {
    return {
      kind: 'github',
      zipUrls: [`https://codeload.github.com/${raw}/zip/HEAD`, `https://api.github.com/repos/${raw}/zipball`],
      display: raw,
    };
  }
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error(`无法识别的来源: ${raw}`); }
  if (u.hostname === 'github.com') {
    const seg = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (seg.length < 2) throw new Error('GitHub 链接需包含 owner/repo');
    const repo = `${seg[0]}/${seg[1]}`;
    return {
      kind: 'github',
      zipUrls: [`https://codeload.github.com/${repo}/zip/HEAD`, `https://api.github.com/repos/${repo}/zipball`],
      display: repo,
    };
  }
  // SkillHub 技能页：skillhub.cn/skills/<slug>
  if (u.hostname === 'skillhub.cn' || u.hostname === 'www.skillhub.cn') {
    const seg = u.pathname.replace(/^\/+|\/+$/g, '').split('/');
    const i = seg.indexOf('skills');
    const slug = i >= 0 && seg[i + 1] ? seg[i + 1] : '';
    if (!slug) throw new Error('SkillHub 链接需形如 skillhub.cn/skills/<slug>');
    return { kind: 'skillhub', zipUrls: [`${SKILLHUB_API}/api/v1/download?slug=${encodeURIComponent(slug)}`], display: `skillhub:${slug}`, slug };
  }
  return { kind: 'zip', zipUrls: [u.toString()], display: u.hostname };
}

const FETCH_RETRIES = 2; // 每个地址的尝试次数（codeload 直连常被间歇重置，重试显著提高成功率）

async function fetchOnce(zipUrl: string): Promise<Buffer> {
  const resp = await fetch(zipUrl, { redirect: 'follow', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const len = Number(resp.headers.get('content-length') ?? 0);
  if (len > ZIP_MAX_BYTES) throw new Error(`压缩包超过 ${ZIP_MAX_BYTES / 1024 / 1024}MB 上限`);
  const buf = Buffer.from(await resp.arrayBuffer());
  if (buf.length > ZIP_MAX_BYTES) throw new Error(`压缩包超过 ${ZIP_MAX_BYTES / 1024 / 1024}MB 上限`);
  return buf;
}

/** 下载 zip：多地址依次回退 × 每地址重试；全部失败时抛出最后一次的底层错误 */
export async function fetchZipBytes(zipUrls: string[]): Promise<Buffer> {
  const errors: string[] = [];
  for (const zipUrl of zipUrls) {
    for (let i = 0; i < FETCH_RETRIES; i++) {
      try {
        return await fetchOnce(zipUrl);
      } catch (err) {
        const cause = (err as Error & { cause?: { code?: string } }).cause;
        errors.push(`${zipUrl}: ${cause?.code ?? (err as Error).message ?? '网络错误'}`);
        if (i < FETCH_RETRIES - 1) await new Promise((r) => setTimeout(r, 800));
      }
    }
  }
  throw new Error(`下载失败（${errors.join('；')}）`);
}

/** 解包 zip 并发现技能候选：所有 SKILL.md 按所在目录聚合 */
export function discoverSkillsFromZip(buf: Buffer): SkillCandidate[] {
  const entries = readZip(buf).filter((e) => safeEntryName(e.name));
  const byDir = new Map<string, string>(); // dir -> SKILL.md 文本
  for (const e of entries) {
    const norm = e.name.replace(/\\/g, '/');
    if (/(^|\/)SKILL\.MD$/i.test(norm)) {
      byDir.set(norm.replace(/(^|\/)SKILL\.MD$/i, ''), e.data.toString('utf8'));
    }
  }
  const out: SkillCandidate[] = [];
  for (const [dir, text] of byDir) {
    // zip 根目录直接放 SKILL.md（SkillHub 单技能包形态）
    const name = dir ? dir.split('/').filter(Boolean).pop() ?? '' : 'skill';
    if (!name) continue;
    out.push({ name, path: dir, description: extractDescription(text) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface InstallResult {
  name: string;
  installed: boolean;
  linked: { tool: string; mode: LinkTarget['mode']; ok: boolean; error?: string }[];
  error?: string;
}

/** 目标目录名清洗：技能名只允许安全字符，防目录注入 */
function safeSkillDirName(name: string): string {
  const cleaned = name.replace(/[^\w.-]/g, '-');
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error(`非法的技能目录名: ${name}`);
  return cleaned;
}

export function entriesForSkill(entries: ZipEntry[], skillPath: string): ZipEntry[] {
  if (!skillPath) return entries; // 根目录技能包（无前缀目录）
  const prefix = skillPath.replace(/\/+$/, '') + '/';
  return entries.filter((e) => e.name.replace(/\\/g, '/').startsWith(prefix));
}

/** 把已圈定的 zip 条目写入目标目录（ rel 为条目名或去掉前缀的相对路径） */
function writeZipEntries(scoped: ZipEntry[], dest: string, skillPath: string, overwrite: boolean): number {
  if (!scoped.length) throw new Error('所选技能在压缩包中不存在');
  if (fs.existsSync(dest)) {
    if (!overwrite) throw new Error(`目标已存在：${dest}（需要覆盖请勾选覆盖）`);
    fs.rmSync(dest, { recursive: true, force: true });
  }
  let count = 0;
  for (const e of scoped) {
    const norm = e.name.replace(/\\/g, '/');
    const rel = skillPath ? norm.slice(skillPath.length + 1) : norm;
    if (!rel) continue;
    const abs = path.resolve(dest, rel);
    if (!abs.startsWith(path.resolve(dest) + path.sep)) throw new Error('压缩包条目路径异常，已中止');
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, e.data);
    count++;
  }
  return count;
}

/** 写入技能目录（整目录落盘），返回写入文件数 */
export function writeSkillDir(entries: ZipEntry[], skillPath: string, dest: string, overwrite: boolean): number {
  return writeZipEntries(entriesForSkill(entries, skillPath), dest, skillPath, overwrite);
}

/** 接入一个工具：junction/符号链接或整目录复制（目标 <toolRoot>/skills/<name>） */
export function linkSkillToTool(storeDir: string, name: string, toolRoot: string, mode: LinkTarget['mode'], overwrite: boolean): void {
  const skillsDir = path.join(toolRoot, 'skills');
  const target = path.join(skillsDir, name);
  if (fs.existsSync(target) || fs.lstatSync(target, { throwIfNoEntry: false })) {
    if (!overwrite) throw new Error(`目标已存在：${target}`);
    fs.rmSync(target, { recursive: true, force: true });
  }
  fs.mkdirSync(skillsDir, { recursive: true });
  if (mode === 'link') {
    fs.symlinkSync(storeDir, target, process.platform === 'win32' ? 'junction' : 'dir');
  } else {
    fs.cpSync(storeDir, target, { recursive: true });
  }
}

/** 按目标接入工具并汇总结果（共享库本体目录 → 各工具 junction/复制） */
function linkAllTargets(
  dest: string, name: string,
  targets: LinkTarget[], toolRootOf: (tool: string) => string, overwrite: boolean,
): InstallResult['linked'] {
  const linked: InstallResult['linked'] = [];
  for (const t of targets) {
    try {
      linkSkillToTool(dest, name, toolRootOf(t.tool), t.mode, overwrite);
      linked.push({ tool: t.tool, mode: t.mode, ok: true });
    } catch (err) {
      linked.push({ tool: t.tool, mode: t.mode, ok: false, error: (err as Error).message });
    }
  }
  return linked;
}

/** 完整安装流程：解包 → 写共享库 → 按目标接入工具。注入 toolRootResolver 便于测试。 */
export function installSkillsFromZip(
  buf: Buffer,
  selectedPaths: string[],
  opts: { storeSkillsDir: string; targets: LinkTarget[]; overwrite: boolean; toolRootOf: (tool: string) => string },
): InstallResult[] {
  const entries = readZip(buf).filter((e) => safeEntryName(e.name));
  const results: InstallResult[] = [];
  for (const skillPath of selectedPaths) {
    const candDir = entriesForSkill(entries, skillPath).find((e) => e.name.toUpperCase().endsWith('SKILL.MD'));
    if (!candDir) { results.push({ name: skillPath || '(根目录)', installed: false, linked: [], error: '压缩包中未找到该技能' }); continue; }
    const name = safeSkillDirName(skillPath ? skillPath.split('/').filter(Boolean).pop() ?? '' : 'skill');
    const res: InstallResult = { name, installed: false, linked: [] };
    try {
      const dest = path.join(opts.storeSkillsDir, name);
      writeSkillDir(entries, skillPath, dest, opts.overwrite);
      res.installed = true;
      res.linked = linkAllTargets(dest, name, opts.targets, opts.toolRootOf, opts.overwrite);
    } catch (err) {
      res.error = (err as Error).message;
    }
    results.push(res);
  }
  return results;
}

/** SkillHub 单技能包安装：zip 是根目录技能形态，共享库目录名用 slug（buf 可传入已下载的包） */
export async function installSkillHubZip(
  slug: string,
  opts: { storeSkillsDir: string; targets: LinkTarget[]; overwrite: boolean; toolRootOf: (tool: string) => string },
  buf?: Buffer,
): Promise<InstallResult> {
  const zip = buf ?? await fetchZipBytes([`${SKILLHUB_API}/api/v1/download?slug=${encodeURIComponent(slug)}`]);
  const entries = readZip(zip).filter((e) => safeEntryName(e.name));
  const name = safeSkillDirName(slug);
  const res: InstallResult = { name, installed: false, linked: [] };
  try {
    const dest = path.join(opts.storeSkillsDir, name);
    writeZipEntries(entries, dest, '', opts.overwrite);
    res.installed = true;
    res.linked = linkAllTargets(dest, name, opts.targets, opts.toolRootOf, opts.overwrite);
  } catch (err) {
    res.error = (err as Error).message;
  }
  return res;
}

/** SkillHub 搜索（只读远端查询，不涉及本地写入） */
export interface HubSkill {
  slug: string; name: string; description: string | null;
  downloads: number; score: number; verified: boolean; version: string;
}

export async function searchSkillHub(keyword: string, page = 1, sortBy = 'score'): Promise<{ skills: HubSkill[]; total: number }> {
  const url = `${SKILLHUB_API}/api/skills?page=${page}&pageSize=24&sortBy=${encodeURIComponent(sortBy)}&order=desc&keyword=${encodeURIComponent(keyword)}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`SkillHub 搜索失败：HTTP ${resp.status}`);
  const j = JSON.parse(await resp.text()) as {
    code?: number; data?: { skills?: Record<string, unknown>[]; total?: number };
  };
  if (j.code !== 0) throw new Error('SkillHub 搜索返回异常');
  const skills = (j.data?.skills ?? []).map((s) => ({
    slug: String(s.slug ?? ''),
    name: String(s.name ?? s.slug ?? ''),
    description: (s.description_zh ?? s.description ?? '') as string | null || null,
    downloads: Number(s.downloads ?? 0),
    score: Number(s.score ?? 0),
    verified: !!s.verified,
    version: String(s.version ?? ''),
  })).filter((s) => s.slug);
  return { skills, total: Number(j.data?.total ?? skills.length) };
}
