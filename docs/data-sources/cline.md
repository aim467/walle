# Cline（~/.cline）调研报告

| | |
|---|---|
| 调研日期 | 2026-10-07（本机实测） |
| 状态 | ✅ 已接入适配器（v1.24） |
| 根目录 | `~/.cline`（Cline CLI / desktop 桌面版家目录，与 VS Code 扩展共享——扩展会话 source 标 `vscode`） |
| 写回评估 | 不写回（适配器 capabilities.write=false；会话/密钥均无写回语义） |

## 1. 布局总览（真机实测，Cline 版本 4.x）

```
~/.cline/
├── data/
│   ├── sessions/<sessionId>/
│   │   ├── <sessionId>.json            # 会话元数据（标题/项目/用量权威来源）
│   │   └── <sessionId>.messages.json   # 会话正文（明文 JSON）
│   ├── db/                             # 运行时库（sessions.db / session-search.db FTS / tasks.db / cron.db / hub-*.db / teams.db / connectors.db，均带 -wal/-shm）
│   ├── globalState.json                # 配置状态（provider/model/toggles，非凭证）
│   ├── secrets.json                    # API key（敏感！）
│   ├── cache/ · checkpoint-scratch/ · locks/ · logs/   # 运行时产物
├── apps/<app>/sessions/*.jsonl         # kanban 等子应用的流式 chunk 日志（冗余，正文在 data/sessions）
├── cron/ · tasks/                      # 空（真机实测）
```

注意：用户指正 Cline 家目录在 `~/.cline`，**不是** VS Code globalStorage（`%APPDATA%/Code/User/globalStorage/saoudrizwan.claude-dev` 是旧扩展形态；本机 Cline 已迁移到独立家目录布局）。

## 2. 会话格式（实测）

**`<sessionId>.json`（元数据）**：`session_id` / `source`（`vscode` | `desktop`）/ `started_at`（ISO）/ `status` / `provider` / `model`（如 `anthropic/claude-sonnet-5`、`auto`、`hy3`）/ `cwd` / `workspace_root` / `prompt`（首条提问）/ `metadata`：`{ title, tokensIn, tokensOut, totalCost, size, git.branch, checkpoint… }`。

**`<sessionId>.messages.json`（正文）**：`{ version, updated_at, agent, sessionId, origin: {source, mode, sessionId}, messages: [...], system_prompt }`。消息为 `{ id, role: user|assistant, ts: epoch ms, content: [items] }`，content item 类型实测四种：

| type | 形态 | walle 处理 |
|---|---|---|
| `text` | `{ text }`；user 首轮被 `<user_input mode="act">…</user_input>` 包装 | 剥壳入 session_message（与 Cursor 转录剥壳同口径） |
| `thinking` | `{ thinking }` | role=thinking（「思考」页签） |
| `tool_use` | `{ id, name, input }`（如 read_files 的 `{files:[{path}]}`） | role=tool 文档 `[调用 name] {input JSON}`；input 里的 path 类键产 session_file（Files 页签） |
| `tool_result` | `{ tool_use_id, name, content: [{query, result}] }` | role=tool 文档 `[结果 name]` + result 文本 |

**sessionId 形态**：CLI 会话 `<epoch>_<5位随机>`（如 `1791304315653_z6w4w`）；desktop/kanban 会话带 `session_` 前缀。

## 3. 采集口径（v1.24 适配器）

| 资产 | kind | 说明 |
|---|---|---|
| `data/sessions/<id>/<id>.messages.json` | session | 正文；subId=session_id；单会话单文件 |
| `data/sessions/<id>/<id>.json` | other（`<id>-meta`） | noDocs 权威元数据：标题（metadata.title，回退 prompt）/ started_at / model / cwd→project_path / 用量（tokensIn/tokensOut/totalCost）。索引器按 path fragment 合并到正文资产 |
| `data/globalState.json` | config | 工具配置状态 |
| `data/secrets.json` | secret | sensitive=1，永不入全文索引 |

- 孤儿元数据（只有 `<id>.json` 无 messages，如会话未产生对话）仍入库：noDocs 合并按 path fragment 找不到会话文件资产时挂回元数据资产本身（对齐 Cursor conversation-search 回退语义），如实出现在会话清单。
- **不收**：`data/db/*.db`（运行时库，sessions.db 与 sessions/ 目录一一对应、无增量价值；session-search.db 的 FTS 索引自建）、`apps/*/sessions/*.jsonl`（流式 chunk 冗余日志）、cache/checkpoint-scratch/locks/logs。

## 4. 技能：原生读 ~/.agents，.cline 不存技能（用户确认，2026-10-07）

Cline 不在 `~/.cline` 下维护技能目录——技能来自 `~/.agents/skills` 共享库（skills CLI 的 lastSelectedAgents 也含 cline）。因此：cline 适配器**不收技能资产**（本就不收，正确）；技能面板 Skills.vue 把 Cline 作为共享库消费方展示——inToolScope/toolState 对 storePath 技能显示「原生发现」（与 Codex 同口径，LINK_TOOLS 加 cline 但 **TARGET_DEFS 不加**——`.cline` 无技能目录，无链接接入动作）。

## 5. 图标

`packages/ui/src/assets/logos/cline.png` —— Cline 官方 favicon 180px（cline.bot/assets/branding/favicons/apple-touch-icon.png，深底白机器人徽章，自带圆角底），2026-10-07 下载。真机由用户确认家目录位置后接入。
