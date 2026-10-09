# WorkBuddy 数据源调研报告

| | |
|---|---|
| 调研日期 | 2026-10-01（本机实测） |
| 状态 | ✅ 已接入适配器（最近更新 2026-10-04：function_call 工具调用文档、注入块剥离） |
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

`workbuddy.db`（SQLite，国际版 `~/.workbuddy-ai/workbuddy.db` / 国内版 `~/.workbuddy/workbuddy.db`）主要表：
`sessions`、`session_usage`、`workspaces`、`automations` / `automation_runs` / `buddy_snapshots`、
`__workbuddy_drizzle_migrations`。

`sessions` 表关键列：`id`（= 会话 jsonl 文件名）、`title`、`custom_title`、`cwd`、`model`、`created_at`、
`updated_at`、`deleted_at`。适配器将其解析为 **noDocs 会话元数据**，由索引器按 `subId`（会话 id）
合并到 `projects/<slug>/<会话id>.jsonl` 会话资产上——标题优先 `custom_title`，回退 `title`；
当 DB 无记录时回退到 JSONL 的 `ai-title`（再回退到首条用户提问）。

**用量来源（token 统计）**：`session_usage` 表——`session_id` + `used`（**只有总量，没有输入/输出明细**）。
适配器仅填 `total = used`，其余字段（input/output/…）一律为空；该表**无成本列 → cost 为空**。
> `size` 列是上下文窗口上限（如 300000），非用量，不采集。

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

## 国内版 / 国际版双账户（v1.12，2026-10-05 实测）

真机上存在两个 WorkBuddy 实例：`~/.workbuddy-ai`（国际版）与 `~/.workbuddy`（国内版）。实测两者目录结构完全同构（settings/SOUL/USER/memory/skills/plugins/connectors/projects/tasks/audit-log/workbuddy.db/keyblob），但它们是**不同账户的两次登录**，不是同一账户的双安装——必须作为两个独立数据源分开管理。

- 两个独立适配器：workbuddy（国际版，`~/.workbuddy-ai`）与 workbuddy-cn（国内版，`~/.workbuddy`）；TOOL_ROOT_DEFS 键分别为 workbuddy / workbuddy-cn（env WALLE_WORKBUDDY_CN）。国内版根不存在时 detect 返回 null、源不出现。
- 扫描/解析逻辑同构，复用 workbuddy.ts 导出的 walkWorkbuddyBase。
- 账户隔离：noDocs 标题合并的 findAssetIdByPathFragment 按 tool 过滤，国内版 db 的会话行不会合并到国际版会话资产上；国内版 db 中无对应 jsonl 的孤儿会话行以国内版 db 资产为载体出现在会话清单（db 即会话索引，如实反映）。
- `sessions/*.json` 不收：CLI 宿主进程心跳元数据（pid/heartbeat/endpoint/version），运行时噪音。
- UI 图标复用 workbuddy.svg，靠「国际版/国内版」文字标签区分；用量统计、技能组、会话清单天然按账户分开。

（历史注：v1.11 曾把 `~/.workbuddy` 当作同账户第二实例按 home: 前缀双根接入，v1.12 澄清语义错误后整体撤销，上文即现行方案。）

## 项目级记忆：`<项目>/.workbuddy*/memory/`（v1.13，2026-10-06 实测）

WorkBuddy 除了 home 根的全局记忆，还会在**工作目录**下生成点目录存放项目记忆（每工作一个项目就写一份）：

- `<项目>/.workbuddy-ai/memory/` —— 国际版项目记忆（按日日志 `YYYY-MM-DD.md` + `MEMORY.md` 长期记忆）
- `<项目>/.workbuddy/memory/` —— 国内版项目记忆（结构同上，双账户语义与 home 根一致）

实测 D:\CodingProject 下 9 个项目 7 个有此类目录；`MEMORY.md` 内容质量高（项目约定、技术决策、踩坑记录），是统一记忆视图最有价值的素材之一。

**采集方案（v1.13）**：项目根线索来自 `session_meta.project_path`（walle 从会话已知用户在哪些目录工作），不做全盘扫描；project-assets.ts 在 workbuddy / workbuddy-cn 适配器的 discover 内探测各自点目录的 `memory/` 下 `.md` 文件。项目资产 path 为绝对 POSIX 路径；项目点目录与 home 根 realpath 相等时跳过（防同文件双份入库）。项目目录删除或线索消失后，重扫自动标 missing。首次安装需 scan→index→scan 两轮（线索来自上一轮索引）。项目记忆为纯 Markdown，走文件级全文索引，敏感判定交给扫描器内容级兜底。
