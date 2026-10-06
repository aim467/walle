import type { Adapter } from '@walle/core';
import { codexAdapter } from './codex.js';
import { zcodeAdapter } from './zcode.js';
import { cursorAdapter } from './cursor.js';
import { opencodeAdapter } from './opencode.js';
import { workbuddyAdapter } from './workbuddy.js';
import { workbuddyCnAdapter } from './workbuddy-cn.js';
import { agentsAdapter } from './agents.js';
import { knowledgeAdapter } from './knowledge.js';

/** 已注册适配器（P2：+cursor / +opencode；P5：+workbuddy；P5.2：+agents 共享技能库；v1.12：+workbuddy-cn 国内版账户；v1.18：+walle 知识库） */
export const adapters: Adapter[] = [codexAdapter, zcodeAdapter, cursorAdapter, opencodeAdapter, workbuddyAdapter, workbuddyCnAdapter, agentsAdapter, knowledgeAdapter];

export { codexAdapter, zcodeAdapter, cursorAdapter, opencodeAdapter, workbuddyAdapter, workbuddyCnAdapter, agentsAdapter, knowledgeAdapter };
export { TOOL_ROOT_DEFS, resolveToolRoot, type ToolRootDef } from './roots.js';
