# Codex CLI 数据源调研报告

| | |
|---|---|
| 调研日期 | 2026-09-30（全部结论来自本机实测，验证脚本 `scripts/verify/verify-codex.mjs`） |
| 根目录 | `~/.codex`（即 `C:\Users\Administrator\.codex`） |
| 工具版本 | 0.156.1（session_meta 取值，2026-10-04 实测已升 0.160.0） |
| 状态 | ✅ 已接入适配器（最近更新 2026-10-04：function_call/custom_tool_call 工具调用与 token_count 用量解析） |
| 写回评估 | 见文末，P4 前只读 |

## 1. 资产清单

| 路径（相对根目录） | kind | 格式 | 变更频率 | 说明 |
|---|---|---|---|---|
| `config.toml` | config | TOML | 低 | 主配置。**含明文 bearer token**（`model_providers.*.experimental_bearer_token`），必须标记 sensitive ⚠️ |
| `config.toml.pebrel-bak` | config | TOML | 一次性 | 第三方工具（pebrel）留下的备份，可佐证配置历史 |
| `auth.json` | secret | JSON | 极低 | 键：`OPENAI_API_KEY`。整文件按 secret 处理 |
| `hooks.json` / `hooks.pebrel-managed.json` | config | JSON | 低 | hooks 配置；后者为 pebrel 托管副本 |
| `history.jsonl` | prompt | JSONL | 高 | 用户输入历史，每行 `{session_id, ts, text}` |
| `session_index.jsonl` | other | JSONL | 高 | 会话轻量索引，每行 `{id, thread_name, updated_at}` —— **会话标题的现成来源** |
| `sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl` | session | JSONL | 每会话一文件 | 会话主存储，本机 40 个，详见 §2.1 |
| `state_5.sqlite` | other | SQLite | 高 | 会话元数据库（threads 表 40 行，含 title/cwd/model/tokens_used/first_user_message 等 40+ 列）+ projects 表。**注意版本号在文件名里**（`_5`），大版本升级会换文件名 |
| `thread_history_1.sqlite` | other | SQLite | 高 | 会话内容投影缓存（thread_items 1111 行，item_json），含增量位点表（projection_state） |
| `memories_1.sqlite` | other | SQLite | 中 | **记忆管线的内部暂存/任务队列库**（`stage1_outputs` + `jobs` + `consolidation_progress`），不是记忆本体——2026-10-06 修正（曾误标 memory）。本机 0 行（config.toml 未开启记忆功能），读取需容忍空库 |
| `memories/**.<name>.md` | memory | Markdown | 高 | **记忆本体**：仅当 config.toml 开启记忆功能后，Codex 把用户记忆写入 `memories/` 目录（本机未开启故目录不存在）；适配器递归采集 md 文件，未开启时自然不产出资产 |
| `goals_1.sqlite` | other | SQLite | 低 | thread_goals（本机 0 行） |
| `queue_1.sqlite` / `logs_2.sqlite` | other | SQLite | 极高 | 内部队列 / 日志库。**logs_2.sqlite 高达 117MB 且 WAL 活跃写入** |
| `skills/<name>/SKILL.md` | skill | Markdown | 低 | 系统技能在 `skills/.system/<name>/` 下（多一层）。**每个技能目录只收 `SKILL.md` 一个资产**，附属 `scripts/`、`references/`、`assets/`、`agents/`、`LICENSE.txt` 与 `skills/.system/.codex-system-skills.marker` 不入资产库；技能名取 `SKILL.md` 的父目录名（对齐 cursor/workbuddy 粒度） |
| `~/.agents/skills/<name>/SKILL.md` | skill | Markdown | 低 | **不在 ~/.codex 内，但 Codex 实际可用**（2026-10-04 实测：codex.exe 二进制硬编码 .agents/skills 技能发现路径，原生读取跨工具共享库，无需链接）。由 agents 适配器（docs/data-sources/agents.md）单独扫描 |
| `rules/default.rules` | rule | 文本 | 低 | 全局规则 |
| `version.json` / `installation_id` / `cap_sid` | other | 文本 | 极低 | 版本与安装标识 |
| `cc-switch-model-catalog.json` | other | JSON | 低 | cc-switch 的模型目录（280KB），佐证本机装了 cc-switch |

**忽略清单**（不入资产）：`*.log`、`sandbox.*.log`、`.sandbox/`、`.sandbox-bin/`、`.sandbox-secrets/`、`tmp/`、`.tmp/`、`thread-writer-locks/`、`rollout-migrations/`、`packages/`、`*-shm`、`*-wal`（SQLite sidecar，属于其主文件）。

## 2. 关键格式细节

### 2.1 会话 rollout JSONL（核心资产）

- 每行一条记录：`{timestamp, ordinal, type, payload}`，实测类型：`session_meta`（每文件 1 条，首行）、`event_msg`、`response_item`、`turn_context`、`world_state`、`token_usage_record`。
- `session_meta.payload`：`session_id, id, timestamp, cwd, originator, cli_version, source, model_provider, base_instructions, git` 等。
- 对话内容在 `response_item.payload`：`{type:'message', role, content:[{type:'text', text}]}`，role ∈ developer/user/assistant。
- ⚠️ **首条 "user" 消息往往是 `<environment_context>` 注入块**（cwd/shell 环境信息），提取标题或做全文索引时应识别并跳过。
- 文件名内嵌时间戳与线程 uuid：`rollout-2026-07-08T13-57-45-<uuid>.jsonl`。

### 2.2 会话元数据：state_5.sqlite.threads（P2 session_meta 表的数据来源）

40+ 列，关键列：`id, rollout_path, cwd, title, model, tokens_used, first_user_message, created_at, updated_at, archived, cli_version, git_branch`。与 sessions/ 文件通过 `rollout_path` / uuid 关联。schema 由 `_sqlx_migrations` 管理（55 个迁移），列只增不减的概率高，但适配器仍应宽松取列。

## 3. 读取方式与坑（实测结论）

1. **带 -shm/-wal 的库正被写入时，`readOnly: true` 打开实测成功**（state_5、memories_1、thread_history_1 均验证）。但 logs_2 处于活跃写入（117MB + WAL 增长中），仍可能 SQLITE_BUSY → 统一策略：readOnly + 失败跳过并记录 error，绝不重试抢锁。
2. SQLite 大文件（logs_2 117MB）超过 P1 内容仓上限（16MB），只记元数据不入内容仓；且其内容哈希随写入持续变化，mtime+size 判定变更即可，不需要深度读取。
3. 版本化文件名（`state_5`、`logs_2`、`memories_1`、`thread_history_1`）：适配器用 `state_*.sqlite` 这类 glob 匹配，不要硬编码版本号。
4. `config.toml` 含明文 token：入内容仓（备份需要）但展示脱敏、永不入全文索引（开发文档 §8）。
5. Windows 路径：threads.cwd 出现 `\\?\C:\...` 扩展长度前缀，比较/展示时需归一化。

## 4. 变更频率与扫描策略

- 高频：sessions/（新会话产生新文件，旧文件基本不变）、history、session_index、state_5、thread_history_1、logs_2。
- mtime+size 增量判定足够；会话文件追加写会导致 mtime 变化 → 重哈希（可接受，Codex 会话文件单文件最大数百 KB 量级）。

## 5. 写回评估（P4 参考）

| 资产 | 可写回性 | 风险 |
|---|---|---|
| config.toml | ⚠️ 谨慎 | 需保留注释与格式的 TOML 编辑；**pebrel/cc-switch 会并发改写此文件**（实测存在 .pebrel-bak 与托管副本），冲突检测必须做 |
| auth.json | ⚠️ 谨慎 | 等于更换凭证，格式极简但影响登录态 |
| skills/ rules/ | ✅ 较安全 | 纯文件追加，无并发方 |
| sessions/ state_*.sqlite | ❌ 永不写回 | 会话与内部库只读 |
