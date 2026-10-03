# WorkBuddy 数据源调研报告

| | |
|---|---|
| 调研日期 | 2026-10-01（本机实测，已接入适配器） |
| 根目录 | `~/.workbuddy-ai`（单根，无第二数据根） |
| 实测规模 | 扫描 127 个资产 · 16 个会话 · 索引 563 篇文档 / 30 个会话 |
| 写回评估 | 见文末，遵循全局"只读优先"约束 |

## 1. 资产清单

| 路径 | kind | 格式 | 说明 |
|---|---|---|---|
| `settings.json` | config | JSON | 主配置（sandbox 白名单、权限等，36KB 级） |
| `mcp-approvals.json` / `mcp-tool-list.json` | mcp | JSON | MCP 审批记录与工具清单 |
| `models.json` / `last-launch.json` / `user-state.json` / `workspace-state.json` / `ioa-im-override.json` | config | JSON | 模型、启动、状态与覆盖配置 |
| `.connectors-marketplace.meta.json` / `skill-cloud-sync/market-config-migration.json` | config | JSON | 连接器与技能市场元数据 |
| `.skill-list-cache.json` / `epoch-marker.json` / `usage-log.json` | other | JSON | 技能清单缓存与运行时标记 |
| `SOUL.md` / `IDENTITY.md` / `USER.md` / `BOOTSTRAP.md` / `MEMORY.md` | memory | Markdown | 身份与画像文件（持久化的"我是谁 / 用户是谁"） |
| `memory/*.md` | memory | Markdown | 用户级长期记忆（含云端记忆缓存，如 `<uid>_memory.md`） |
| `skills/<name>/SKILL.md` | skill | Markdown | 用户级技能（每个技能取 SKILL.md 一个资产，附属文件降噪不收） |
| `plugins/cache/<市场>/<插件>/<版本>/.codebuddy-plugin/plugin.json` | plugin | JSON | 插件清单（**只取在用版本**：带 `.in_use` 标记者，否则最新版本） |
| `plugins/cache/<市场>/<插件>/<版本>/.mcp.json` | mcp | JSON | 插件附带的 MCP 配置（如 mcp-miora / weixinpay） |
| `connectors/**/*.json` | config | JSON | 连接器状态 / 企业注册表 / 市场元数据（内容加密） |
| `connectors/<uid>/.master.key` | secret | binary | 连接器主密钥 ⚠️ |
| `keyblob` | secret | binary | 本机密钥块 ⚠️ |
| `projects/<项目slug>/<会话id>.jsonl` | session | JSONL | **会话主存储**，详见 §2 |
| `workbuddy.db` | other | SQLite | 会话索引库（sessions/workspaces/automations），标题合并来源，详见 §3 |
| `tasks/<会话id>/<n>.json` | other | JSON | 任务（待办）记录 |
| `audit-log/**/*.jsonl` | other | JSONL | 安全审计留痕（命令决策等） |

**明确排除（不入库）**：`blobs/`（内容寻址图片仓）、`clipboard-images/`、`cache/`、`logs/`、`tmp/`、`traces/`、`file-history/`、`changes-index/`、`changes-detail/`、`file-tree-manifests/`、`shell-snapshots/`、`binaries/`（Node/Python/PortableGit 运行时）、`app/`（Electron 运行时）、`storage/`、`security/`、`sessions/`（PID 心跳运行时态）、`pending-telemetry/`、`assistant-display/`、`artifact-index/`、`editor-sdk-sandbox-ws/`、`wbipc/`、`local_storage/`。这些目录均为缓存、运行时状态或二进制，无长期资产价值且体量巨大。

## 2. 关键格式：会话 JSONL（`projects/<slug>/<会话id>.jsonl`）

每行一个 JSON 对象，实测行类型：

| type | 说明 | 处理 |
|---|---|---|
| `session-meta` | `{ sessionId, cwd, meta }` | 提取 subId / 项目路径 |
| `ai-title` | `{ aiTitle, sessionId, cwd }` | **会话标题来源**（AI 生成） |
| `message` | `{ role, content[], timestamp }` | 正文；`content[].text`（`input_text` / `output_text`） |
| `reasoning` | 模型思考（`content` 常为空） | P2 不入索引 |
| `function_call` | `{ name, arguments, callId }` | 工具调用，P2 不入索引 |
| `function_call_result` | `{ name, output, status }` | 工具结果，P2 不入索引 |
| `file-history-snapshot` / `resend-fork-notice` | 侧车事件 | 忽略 |

**最关键的坑——用户提问藏在环境注入块里。** 每个 `user` 轮次的 `content[].text` 都以
`<system-reminder data-role="user-context">…</system-reminder>` 开头（内含 `user_info` / `current_time` /
`user_references` / `craft_mode` 等注入），**真实提问跟在 `</system-reminder>` 之后，通常包在 `<user_query>` 中**；
另有 `data-role="tool-hint"` / `error-recovery` 的纯注入轮次（剥离后为空，应整条跳过）。

> 因此适配器**不能**按"整条以 `<system-reminder` 开头就丢弃"处理（那会丢掉全部用户提问），
> 而是用 `stripInjectedBlocks()` 剥离注入块、解开 `<user_query>`，仅当剥离后为空才跳过。
> 该行为有单测守护（`workbuddy 会话：DB 标题合并 / ai-title 兜底 / 剥离注入块`）。

## 3. 关键格式：workbuddy.db

`~/.workbuddy.db`（SQLite）主要表：`sessions`（16 行）、`session_usage`（14）、`workspaces`（1）、
`automations` / `automation_runs` / `buddy_snapshots`（本机 0 行）、`__workbuddy_drizzle_migrations`（15）。

`sessions` 表关键列：`id`（= 会话 jsonl 文件名）、`title`、`custom_title`、`cwd`、`model`、`created_at`、
`updated_at`、`deleted_at`。适配器将其解析为 **noDocs 会话元数据**，由索引器按 `subId`（会话 id）
合并到 `projects/<slug>/<会话id>.jsonl` 会话资产上——标题优先 `custom_title`，回退 `title`；
当 DB 无记录时回退到 JSONL 的 `ai-title`（再回退到首条用户提问）。

## 4. 读取方式与坑

- **单根布局**：无第二数据根，无需 `config:` / `data:` 前缀，`path` 直接相对 `~/.workbuddy-ai`。
- **workbuddy.db 运行中带 -wal/-shm**：一律 `readOnly: true` 打开，绝不与工具争锁。
- **版本化插件目录**：同一插件存在多版本目录（如 `tencent-docx` 有 `5.5.2-*` 与 `5.6.2-*`），
  只取带 `.in_use` 的版本，避免同一插件入库多份。
- **会话文件为追加写**：扫描期间正在进行的会话会持续增长，幂等性依赖 (size, mtime) 快路径，
  内容变化时自动留快照，符合全局策略。
- **内容级敏感兜底可能命中会话**：WorkBuddy 会话 jsonl 头部含完整系统提示与工具输出，
  个别会话会因正文出现疑似密钥串被 `looksSensitive` 兜底标记为 sensitive 而排除出全文索引
  （本机 16 个会话中命中 1 个）。这是隐私优先的既有全局行为，非本适配器特有；
  若后续需要，可在索引器对 `kind='session'` 放宽内容级兜底（backlog）。

## 5. 写回评估（P4 参考）

| 资产 | 可写回性 | 风险 |
|---|---|---|
| `settings.json` / `models.json` 等配置 | ✅ 较安全 | 结构为普通 JSON；注意应用可能并发写 |
| `SOUL.md` / `USER.md` / `memory/*.md` | ✅ 安全 | 纯文本，价值高（跨工具记忆迁移首选） |
| `skills/<name>/SKILL.md` | ✅ 安全 | 单文件，可直接编辑下发 |
| `projects/**/*.jsonl`、`workbuddy.db` | ❌ 永不写回 | 会话记录永远只读 |
| `keyblob` / `.master.key` / `connectors/*` | ⚠️ 谨慎 | 加密密钥与连接器状态，写坏即登录态失效 |
