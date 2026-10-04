import type { Adapter } from '@walle/core';
import { codexAdapter } from './codex.js';
import { zcodeAdapter } from './zcode.js';
import { cursorAdapter } from './cursor.js';
import { opencodeAdapter } from './opencode.js';
import { workbuddyAdapter } from './workbuddy.js';

/** 已注册适配器（P2：+cursor / +opencode；P5：+workbuddy） */
export const adapters: Adapter[] = [codexAdapter, zcodeAdapter, cursorAdapter, opencodeAdapter, workbuddyAdapter];

export { codexAdapter, zcodeAdapter, cursorAdapter, opencodeAdapter, workbuddyAdapter };
export { TOOL_ROOT_DEFS, resolveToolRoot, type ToolRootDef } from './roots.js';
