# Claude Code（~/.claude）调研报告

| | |
|---|---|
| 调研日期 | 2026-10-09（本机实测，Claude Code 2.1.295，Windows） |
| 状态 | ✅ 已接入适配器（v1.28） |
| 根目录 | `~/.claude`（Claude Code CLI / IDE 扩展共享的家目录；另有家目录外的 `~/.claude.json`，本轮不收） |
| 写回评估 | 不写回（适配器 capabilities.write=false；会话/记忆/技能本轮无写回语义） |

## 1. 布局总览（真机实测）

```
~/.claude/
├── projects/<slug>/
│   ├── <sessionId>.jsonl            # 会话正文（JSONL，一行一个事件对象；含标题/用量/消息）
│   ├── <sessionId>/                 # 该会话的附属目录
│   │   ├── subagents/agent-*.jsonl  # 子代理（sidechain）转录 —— 不收
│   │   └── tool-results/*.txt       # 工具结果落盘 —— 不收
│   └── memory/*.md                  # 项目记忆（MEMORY.md + 条目文件）—— 收
├── skills/<name>/SKILL.md           # 用户技能 —— 收
├── settings.json                    # 配置（env 内含 API token ⚠️，不收）
├── history.jsonl                    # 提示历史（不收）
├── agents/ · commands/ · hooks/ · todos/   # 用户自定义目录（本轮不收）
├── plugins/marketplaces/            # 插件市场（git 克隆，本机 23MB，不收）
├── backups/ · cache/ · downloads/ · ide/ · sessions/ · session-env/ · shell-snapshots/ · statsig/
│                                    # 运行时产物（不收）
└── （家目录外）~/.claude.json        # 全局配置（mcpServers / 各项目用量统计，本轮不收）
```

**项目 slug 编码规则**：项目绝对路径的非字母数字字符替换为 `-`——`d:\CodingProject\walle` → `d--CodingProject-walle`，`C:/Users/Administrator` → `C--Users-Administrator`。反向解码有损（原始分隔符不可还原），故不用 slug 反推项目路径；真实项目路径以会话行内的 `cwd` 为准。

## 2. 会话格式（实测）

`projects/<slug>/<sessionId>.jsonl`，一行一个 JSON 事件对象。顶层字段：`type` / `sessionId` / `uuid` / `parentUuid` / `isSidechain` / `timestamp`（ISO）/ `cwd` / `version` / `gitBranch` / `entrypoint`。

**行类型**（本机样本统计）：

| type | 说明 | walle 处理 |
|---|---|---|
| `user` | 用户消息，`message.content` 为 block 数组 | 取 `text` → role=user；`tool_result` → role=tool |
| `assistant` | 助手消息（多 block 拆多行），`message.model`/`message.usage` | text/thinking/tool_use → 对应角色文档 |
| `ai-title` | 会话标题（`aiTitle`），模型生成 | 标题权威来源（回退首条 user 文本） |
| `queue-operation` / `attachment` / `file-history-snapshot` / `atis-latch` / `last-prompt` / `mode` / `permission-mode` / `cost-state` / `system` | 运行时状态与注入快照 | 不收 |

**content block 类型**：

| type | 形态 | walle 处理 |
|---|---|---|
| `text` | `{ text }` | role=user / assistant |
| `thinking` | `{ thinking }` | role=thinking（「思考」页签） |
| `tool_use` | `{ id, name, input }` | role=tool 文档 `[调用 name] {input JSON}`；input 里的 `file_path`/`path` 产 session_file（Files 页签） |
| `tool_result` | `{ tool_use_id, content }`（在 `user` 行内） | role=tool 文档 `[结果 name]` + content 文本；name 由 tool_use_id 反查前文 tool_use |

**⚠️ 关键坑（用量去重）**：**一条 API 助手消息会拆成多行 JSONL**——每个 content block 一行，`message.id` 相同、`message.usage` 完全相同，`apiBlockIndex` 递增。本机样本：20 行 assistant 行仅 11 个唯一 `message.id`，其中一个 id 占 6 行。因此 token 用量**必须按 `message.id` 去重后再累加**，否则高估 2–6 倍。固件用「两条同 id 行」+ 精确断言把这一口径锁死。

## 3. 采集口径（v1.28 适配器）

| 资产 | kind | name | 说明 |
|---|---|---|---|
| `projects/<slug>/<sessionId>.jsonl` | session | `<sessionId>` | 正文；subId=sessionId；单会话单文件 |
| `projects/<slug>/memory/*.md` | memory | 文件主名 | 项目记忆；路径为根内相对 |
| `skills/<name>/SKILL.md` | skill | `<name>` | 用户技能；只收 SKILL.md，附属文件不收（对齐 agents 口径） |

- **会话元数据同文件产出**：标题（ai-title）、用量、model、cwd、startedAt 全在同一 JSONL 内，故解析器直接产出一个**非 `noDocs`** 的会话行（索引器走 `store.addSessionMeta(asset.id, sm)` 直连归位），无需 Cline/Codex 那样的「另一个文件 + path fragment 合并」。
- **记忆作用域（如实说明）**：Claude 的项目记忆存于**家目录内**的相对路径 `projects/<slug>/memory/…`，而 `store.memoriesOverview()` 仅按 path 是否为绝对路径判作用域，故这些记忆在记忆面板归为 **「根记忆」（scope=global）**，而非项目记忆——项目分组信息丢失。两个项目各有 `MEMORY.md` 时会出现两条同名「MEMORY」（同 scopeKey=`global:claude`，不会误报「同名跨作用域」）。不按有损 slug 反解项目路径；后续如需项目分组，可循会话 `cwd` 反推。
- **不收**：`settings.json`（含 `env.ANTHROPIC_AUTH_TOKEN` 明文，⚠️ 不读不存）、`history.jsonl`、`agents/`、`commands/`、`plugins/`（市场克隆，本机 23MB）、`<sessionId>/subagents/` 侧链转录与 `tool-results/`（非递归 projects 目录即结构性跳过）、backups/cache/downloads/ide/sessions/session-env/shell-snapshots/statsig 等运行时产物、家目录外的 `~/.claude.json`。

## 4. 用量来源（token 统计）

来自会话 JSONL 中 `assistant` 行的 `message.usage`：`input_tokens`→input、`output_tokens`→output、`cache_read_input_tokens`→cacheRead、`cache_creation_input_tokens`→cacheWrite、`output_tokens_details.thinking_tokens`→reasoning；`total = input + output`（缓存不计入，与 Cline 同口径）；无成本字段 → `cost` 恒为 null。**统计前按 `message.id` 去重**（见 §2 关键坑）。

## 5. 技能：自有目录 ~/.claude/skills（与 Cline 口径不同）

Claude Code 有**自有**技能目录 `~/.claude/skills/<name>/SKILL.md`（本轮回收入库）。因此技能面板把 claude 作为**接入目标**（同 ZCode/Cursor/WorkBuddy）——进 `LINK_TOOLS` + `TARGET_DEFS`（hint `~/.claude/skills`），**不**按「原生发现 `~/.agents`」处理（异于 Cline：Cline 不存技能、原生读 `~/.agents`）。

## 6. 写回评估（P4 参考）

| 资产 | 可写回性 | 风险 |
|---|---|---|
| 会话 `<sessionId>.jsonl` | ❌ 不建议 | Claude Code 自身的会话账本，外部改写语义不明 |
| 项目记忆 `memory/*.md` | ⚠️ 中（远期） | 纯 Markdown 追加语义，可复用 P4 三保险；需适配器声明 write=true 并纳入 `/api/memory/targets` |
| 技能 `skills/*/SKILL.md` | ✅ 较安全（远期） | 纯 Markdown，可复用 P4 三保险 |

本轮 `capabilities.write=false`，只读。

## 7. 图标

`packages/ui/src/assets/logos/claude.svg` —— Claude「spark」徽标（12 芒星），品牌橙 `#D97757`，手写 SVG（轻量、随主题缩放清晰），2026-10-09。
