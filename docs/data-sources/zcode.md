# ZCode 数据源调研报告

| | |
|---|---|
| 调研日期 | 2026-09-30（全部结论来自本机实测，验证脚本 `scripts/verify/verify-zcode.mjs`） |
| 根目录 | `~/.zcode`（即 `C:\Users\Administrator\.zcode`） |
| 工具版本 | 0.16.9（取自 session 表 version 列） |
| 写回评估 | 见文末，P4 前只读 |

## 1. 资产清单

| 路径（相对根目录） | kind | 格式 | 变更频率 | 说明 |
|---|---|---|---|---|
| `cli/db/db.sqlite` | session | SQLite | 极高（每次会话写入） | **会话主存储**，详见 §2.1 |
| `cli/rollout/model-io-sess_*.jsonl` | other | JSONL | 高 | 模型 I/O 遥测（每次模型调用一行，含完整请求/响应体，单行可达 ~100KB，单文件 1.7MB+）。**不是用户视角的会话本体**，会话本体在 db.sqlite |
| `cli/memories/projects/<project-hash>/memory/*.md` | memory | Markdown | 低 | 记忆文件 + `MEMORY.md` 索引，人类可读，带 frontmatter |
| `cli/agents/sess_*/agent_*/` | agent | 目录（metadata.json / output.txt / task.output） | 低 | 子代理运行记录，按会话 id 组织 |
| `cli/artifacts/sess_*/call_*-tool-result-*.json` | other | JSON | 中 | 工具调用结果转储，按会话组织。**2026-10-04 起不再入库（降噪）**：正文本就在 db.sqlite 的 tool part 中；需要原文时由会话详情 Files 页签按需读取（/api/artifacts） |
| `skills/<name>/SKILL.md` | skill | Markdown | 低 | 用户技能（2026-10-04 起接入）。skills CLI 把 `~/.agents/skills` 共享库**符号链接**到此，适配器经 walkFiles 跟随链接取本体内容（realpath 防环）；只收 SKILL.md |
| `cli/plugins/known_marketplaces.json` | plugin | JSON | 极低 | 插件市场登记 |
| `cli/plugins/{cache,data,marketplaces}/` | plugin | 目录 | 低 | 插件缓存与安装明细（本机 385 文件，官方市场 11 个插件）。P1 只记顶层清单，明细 P2 再入库 |
| `v2/credentials.json` | secret | JSON | 极低 | **高敏感**：OAuth access_token、JWT、api-key（键名实测：`oauth:bigmodel:access_token`、`zcodejwttoken`、`account-provider:...:api-key` 等）⚠️ |
| `v2/provider_config.json` / `v2/setting.json` / `v2/bot-config.v3.json` / `v2/bot-state.v3.json` | config | JSON | 低 | 模型提供商、设置、机器人配置与状态。provider_config 可能含 key，靠内容扫描兜底标记 sensitive |
| `v2/tasks-index.sqlite` | other | SQLite | 中 | 任务索引（带 -shm/-wal） |

**忽略清单**：`cli/exec/**`（命令 stdout 与 shell 快照）、`cli/log/**`（应用结构化日志，按天滚动）、`v2/{cache,crash,certs,runtime,logs}/**`、`workspace/**`、`plugin-workspace/**`、`*-shm`、`*-wal`。

## 2. 关键格式细节

### 2.1 db.sqlite（会话主存储）

实测表结构（22 张表，`schema_migration` 管版本）：

| 表 | 行数（本机） | 关键列 | 用途 |
|---|---|---|---|
| `session` | 5 | id, title, path, version, project_id, parent_id, slug | 会话头：标题、项目路径、工具版本 |
| `message` | 61 | id, session_id, data(JSON), sequence, time_created | 消息（内容在 data 列 JSON） |
| `part` | 229 | message_id, session_id, data(JSON), sequence | 消息分片（工具调用等结构化部分） |
| `input_history` | 6 | session_id, kind('prompt'), text, attachments | 用户输入历史（对应 Codex 的 history.jsonl） |
| `todo` / `model_usage` / `turn_usage` / `tool_usage` | — | — | 任务清单与用量统计（P2/P5 检索与统计的数据源） |
| `workflow_*` / `session_task_link` 等 | 0 | — | 工作流引擎表，本机未使用 |

**P2 解析路径**：session → message（按 sequence）→ part（按 message_id），data 列 JSON 内含角色与内容。

### 2.2 rollout model-io JSONL

每行一次模型调用：`{type:'model_io', startedAt, completedAt, durationMs, requestId, attempt, model:{modelId, providerId}, request:{body}, response, sessionId, turnId, traceId, querySource}`。

- ⚠️ 单行巨大（含完整请求体），**必须逐行流式读取**，禁止整个文件 JSON.parse。
- 实测 `request.body.metadata.user_id` 已被 ZCode 自身脱敏为 `[REDACTED]`，但请求体其余部分（系统提示、上下文）仍是完整明文 → 全文索引（P2）时应纳入的是 db.sqlite 解析结果而非 model-io 原文。

### 2.3 v2/credentials.json

键名含 OAuth token、JWT、api-key —— **整文件 secret**，展示脱敏、永不入全文索引、导出默认排除（开发文档 §8）。

## 3. 读取方式与坑（实测结论）

1. **db.sqlite 在 ZCode 运行中（本调研即在 ZCode 会话内进行）readOnly 打开成功** —— WAL 模式允许只读并发。策略同 Codex：readOnly、失败跳过、绝不抢锁。
2. session.path 列为 Windows 反斜杠绝对路径，入库时归一化为正斜杠。
3. `cli/plugins/cache` 下 385 个文件多为插件包缓存，全量入库会淹没资产清单 → P1 忽略目录明细，仅记 `known_marketplaces.json`。
4. rollout 文件名内嵌会话 id（`model-io-sess_<id>.jsonl`），与 db.sqlite 的 session.id 直接对应。
5. v2 下的 `*.v3.json` 是版本化命名（类似 Codex 的 `state_5`），glob 匹配而非硬编码。

## 4. 变更频率与扫描策略

- db.sqlite 每次交互都追加（mtime 持续变化）→ 每次扫描都会重哈希（几 MB，可接受）；内容变更检测天然成立。
- 其余资产低频。mtime+size 增量判定足够。

## 5. 写回评估（P4 参考）

| 资产 | 可写回性 | 风险 |
|---|---|---|
| memories/*.md | ✅ 较安全 | 纯 markdown 追加/编辑，无并发方，是最适合率先开放写回的资产 |
| cli/plugins | ✅ 较安全 | 目录结构简单，但重装插件即被工具自身覆盖 |
| v2/credentials.json | ⚠️ 谨慎 | 等于更换登录态；格式为简单 JSON |
| db.sqlite / rollout | ❌ 永不写回 | 会话与内部库只读 |
