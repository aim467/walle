import os from 'node:os';
import path from 'node:path';
import { getToolPathOverride, walleHome } from '@walle/core';

/**
 * 各 AI 工具数据源根路径的统一定义与解析。
 * 优先级：config.json toolPaths 覆盖 > 环境变量（测试隔离用）> 默认路径。
 * 设置页（Web UI /api/settings）按此清单渲染可编辑项。
 */

export interface ToolRootDef {
  /** config.json toolPaths 的键（如 "cursor.appdata"） */
  key: string;
  /** 适配器 id */
  tool: string;
  /** UI 展示名 */
  label: string;
  /** 测试/环境重定向变量（优先级低于用户配置） */
  env?: string;
  /** 默认路径 */
  default(): string;
}

export const TOOL_ROOT_DEFS: ToolRootDef[] = [
  { key: 'codex', tool: 'codex', label: '配置根', default: () => path.join(os.homedir(), '.codex') },
  { key: 'zcode', tool: 'zcode', label: '配置根', default: () => path.join(os.homedir(), '.zcode') },
  { key: 'cursor', tool: 'cursor', label: '配置根', default: () => path.join(os.homedir(), '.cursor') },
  {
    key: 'cursor.appdata', tool: 'cursor', label: '应用数据根（globalStorage）', env: 'WALLE_CURSOR_APPDATA',
    default: () =>
      process.env.APPDATA
        ? path.join(process.env.APPDATA, 'Cursor')
        : path.join(os.homedir(), 'AppData', 'Roaming', 'Cursor'),
  },
  { key: 'opencode', tool: 'opencode', label: '配置根', default: () => path.join(os.homedir(), '.config', 'opencode') },
  {
    key: 'opencode.data', tool: 'opencode', label: '数据根（会话库）', env: 'WALLE_OPENCODE_DATA',
    default: () => path.join(os.homedir(), '.local', 'share', 'opencode'),
  },
  {
    key: 'workbuddy',
    tool: 'workbuddy',
    label: '国际版根（~/.workbuddy-ai）',
    env: 'WALLE_WORKBUDDY',
    default: () => path.join(os.homedir(), '.workbuddy-ai'),
  },
  {
    key: 'cline',
    tool: 'cline',
    label: 'Cline 根（~/.cline）',
    env: 'WALLE_CLINE',
    default: () => path.join(os.homedir(), '.cline'),
  },
  {
    key: 'workbuddy-cn', tool: 'workbuddy-cn', label: '国内版根（~/.workbuddy）', env: 'WALLE_WORKBUDDY_CN',
    default: () => path.join(os.homedir(), '.workbuddy'),
  },
  {
    key: 'agents', tool: 'agents', label: '技能共享库（~/.agents）', env: 'WALLE_AGENTS',
    default: () => path.join(os.homedir(), '.agents'),
  },
  {
    key: 'walle.knowledge', tool: 'walle', label: '知识库（~/.walle/knowledge）', env: 'WALLE_KNOWLEDGE',
    default: () => path.join(walleHome(), 'knowledge'),
  },
];

/** 解析某工具某根的实际路径（覆盖 > 环境变量 > 默认） */
export function resolveToolRoot(key: string): string {
  const def = TOOL_ROOT_DEFS.find((d) => d.key === key);
  if (!def) throw new Error(`未知的工具路径 key: ${key}`);
  return getToolPathOverride(key) ?? (def.env ? process.env[def.env] || undefined : undefined) ?? def.default();
}
