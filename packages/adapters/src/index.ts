import type { Adapter } from '@walle/core';
import { codexAdapter } from './codex.js';
import { zcodeAdapter } from './zcode.js';

/** 已注册适配器。P2 起新增 cursor / opencode 时在此追加。 */
export const adapters: Adapter[] = [codexAdapter, zcodeAdapter];

export { codexAdapter, zcodeAdapter };
