import type { Adapter } from '@walle/core';
import { codexAdapter } from './codex.js';
import { zcodeAdapter } from './zcode.js';
import { cursorAdapter } from './cursor.js';
import { opencodeAdapter } from './opencode.js';

/** 已注册适配器（P2：+cursor / +opencode） */
export const adapters: Adapter[] = [codexAdapter, zcodeAdapter, cursorAdapter, opencodeAdapter];

export { codexAdapter, zcodeAdapter, cursorAdapter, opencodeAdapter };
