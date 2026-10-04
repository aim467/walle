# Cursor 数据源调研报告

| | |
|---|---|
| 调研日期 | 2026-09-30（本机实测）；2026-10-04 补充会话正文方案 |
| 状态 | ✅ 已接入适配器（会话正文来自 projects 转录，conversations 表为会话索引） |
| 根目录 | 配置根 `~/.cursor`；应用根 `%APPDATA%/Cursor`（Windows） |
| 写回评估 | 见文末，P4 前只读 |

## 1. 资产清单

| 路径 | kind | 格式 | 说明 |
|---|---|---|---|
| `~/.cursor/mcp.json` | mcp | JSON | MCP 服务器配置（本机含 git server 示例） |
| `~/.cursor/ide_state.json` | config | JSON | IDE 状态 |
| `~/.cursor/skills-cursor/*/SKILL.md` | skill | Markdown | 内置技能目录（本机 27 个：automate/autopilot/canvas…），适配器只收 SKILL.md，附属文件不收（降噪） |
| `~/.cursor/agents/` | agent | 目录 | 会话式 agent 记录（本机为空） |
| `~/.cursor/projects/<项目slug>/agent-transcripts/<composerId>/<composerId>.jsonl` | session | JSONL | **明文会话转录（正文来源）**：行形如 `{role, message:{content:[{type:'text'|'tool_use',…}]}}`，无时间戳；subagents/ 子代理转录不收 |
| `appdata:User/globalStorage/state.vscdb` | other | SQLite | **VS Code 系状态 + Cursor 私有 KV**（10MB），聊天数据在 `cursorDiskKV` 表，详见 §2 |
| `appdata:User/globalStorage/conversation-search.db` | other | SQLite | Cursor 自带的会话搜索库；`conversations` 表（id/title/updated_at/is_archived）是权威会话索引 |
| `appdata:User/settings.json`、`storage.json` | config | JSON | 编辑器设置 |

## 2. 关键格式与已知限制：聊天消息

`state.vscdb` 的 `cursorDiskKV` 表（812 行）键前缀分布：`agentKv:blob`(510)、`bubbleId:<composerId>:<bubbleId>`(203)、`composerData:<id>`(15)、`composer.content.<hash>`(47)。

**P2 实测结论：state.vscdb 聊天正文不可直接读取** —— `bubbleId:*` 记录的 `text` 字段为空，正文疑似已迁移至 `composer.content.*`（明文但仅为附件代码片段）或受 `composerData.blobEncryptionKey` 加密。聊天提取需要跟进 Cursor 版本演进，**时间盒外搁置**（backlog）。

**2026-10-04 绕行方案**：`projects/*/agent-transcripts/` 是 agent 模式会话的明文 JSONL 转录（与 conversations 表的 composerId 一一对应），作为 kind=session 资产入索引（正文 + 标题兜底取首条用户提问，`<timestamp>/<user_query>` 注入包装剥离）；`conversation-search.db` conversations 表作权威会话索引（noDocs 合并标题/时间到转录资产，无转录的会话挂回 db 资产、详情如实为空）。注意 CAS 只拷 .db 主文件不拷 -wal，Cursor 运行中扫描会话数偏少，关闭 Cursor checkpoint 后下次扫描补全。

## 3. 读取方式与坑

- state.vscdb 带 -shm/-wal 运行中，`readOnly: true` 打开实测成功。
- 双根布局：应用根资产用 `appdata:` 前缀锚定（`WALLE_CURSOR_APPDATA` 供测试重定向）。
- skills-cursor 目录 43 个文件中 27 个 SKILL.md 是有效资产，其余为附属资源。

## 4. 写回评估（P4 参考）

| 资产 | 可写回性 | 风险 |
|---|---|---|
| mcp.json | ✅ 较安全 | 结构简单，是 P4 下发/迁移的首选目标 |
| skills-cursor | ✅ 较安全 | 纯 markdown 目录 |
| state.vscdb | ❌ 永不写回 | 应用内部状态库 |
