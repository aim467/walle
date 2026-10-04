import type { Adapter } from '@walle/core';
import { codexAdapter } from './codex.js';
import { zcodeAdapter } from './zcode.js';
import { cursorAdapter } from './cursor.js';
import { opencodeAdapter } from './opencode.js';
import { workbuddyAdapter } from './workbuddy.js';
import { agentsAdapter } from './agents.js';

/** 已注册适配器（P2：+cursor / +opencode；P5：+workbuddy；P5.2：+agents 共享技能库） */
export const adapters: Adapter[] = [codexAdapter, zcodeAdapter, cursorAdapter, opencodeAdapter, workbuddyAdapter, agentsAdapter];

export { codexAdapter, zcodeAdapter, cursorAdapter, opencodeAdapter, workbuddyAdapter, agentsAdapter };
export { TOOL_ROOT_DEFS, resolveToolRoot, type ToolRootDef } from './roots.js';
