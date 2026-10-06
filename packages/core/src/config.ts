import fs from 'node:fs';
import path from 'node:path';
import { walleHome } from './paths.js';

/** walle 自身配置（~/.walle/config.json）。写回能力默认关闭（开发文档 §7 Phase 4）。 */

export interface WalleConfig {
  /** 写回开关：false 时所有写回命令直接拒绝 */
  allowWrite?: boolean;
  /** 各 AI 工具数据源路径覆盖：key 见 @walle/adapters 的 TOOL_ROOT_DEFS（如 codex / cursor.appdata），
   *  值为绝对路径；未配置时适配器回退默认路径。改动后需重新 scan 才会生效。 */
  toolPaths?: Record<string, string>;
  /** 大模型配置（OpenAI 兼容接口：Ollama /v1、DeepSeek、OpenAI 等均可）。未配置时提炼为纯手动模式 */
  llm?: LlmConfig;
}

/** 大模型配置（OpenAI 兼容）。apiKey 属敏感凭证：展示层一律脱敏，永不完整回显 */
export interface LlmConfig {
  /** 接口基础地址，如 https://api.deepseek.com/v1 或 http://127.0.0.1:11434/v1（Ollama） */
  baseUrl?: string;
  /** API Key */
  apiKey?: string;
  /** 模型名，如 qwen3:8b / deepseek-chat */
  model?: string;
}

/** 读取某工具路径覆盖（未配置返回 undefined） */
export function getToolPathOverride(key: string): string | undefined {
  const v = readWalleConfig().toolPaths?.[key];
  return v && v.trim() ? v.trim() : undefined;
}

export function readWalleConfig(): WalleConfig {
  const p = path.join(walleHome(), 'config.json');
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as WalleConfig;
  } catch {
    return {};
  }
}

export function writeWalleConfig(cfg: WalleConfig): void {
  const p = path.join(walleHome(), 'config.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
}

/** 写回前置检查：开关未开则返回错误信息 */
export function writeAllowed(): string | null {
  if (readWalleConfig().allowWrite) return null;
  return '写回开关未开启（默认关闭，防止误写工具目录）。执行 walle write-enable 开启。';
}
