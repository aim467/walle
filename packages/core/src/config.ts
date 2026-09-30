import fs from 'node:fs';
import path from 'node:path';
import { walleHome } from './paths.js';

/** walle 自身配置（~/.walle/config.json）。写回能力默认关闭（开发文档 §7 Phase 4）。 */

export interface WalleConfig {
  /** 写回开关：false 时所有写回命令直接拒绝 */
  allowWrite?: boolean;
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
