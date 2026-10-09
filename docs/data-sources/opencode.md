# opencode 数据源调研报告

| | |
|---|---|
| 调研日期 | 2026-09-30（本机实测） |
| 状态 | ✅ 已接入适配器（最近更新 2026-10-04：tool/patch part 与用量解析） |
| 根目录 | 配置根 `~/.config/opencode`；数据根 `~/.local/share/opencode` |
| 写回评估 | 见文末，P4 前只读 |

## skills/<name>/SKILL.md（v1.24 补，用户指正）

opencode 有自己的技能目录：配置根 `~/.config/opencode/skills/<name>/SKILL.md`（真机实测 hyperframes-creative，含 templates/scripts 等附属目录）。采集口径与其他适配器一致：每技能一个资产（只收 SKILL.md，附属文件不收），技能名取 SKILL.md 父目录。它是 opencode 自有技能（目录副本语义），与 ZCode 符号链接接入共享库的形态并存。
## 1. 资产清单

| 路径 | kind | 格式 | 说明 |
|---|---|---|---|
| `<config>/opencode.jsonc` | config | JSONC | 主配置（本机仅 `$schema` 一行） |
| `<data>/auth.json` | secret | JSON | 键 `opencode-go`（含 token）⚠️ |
| `<data>/opencode.db` | session | SQLite | **会话主存储**，详见 §2 |
| `<data>/project/`、`<data>/snapshot/`、`<data>/log/` | — | 目录 | 项目与快照数据，P2 暂不入库（量小价值低，backlog） |

## 2. 关键格式：opencode.db

表结构与 **ZCode db.sqlite 同族**（session + message + part，内容在 data JSON 列），但存在两处差异（适配器已动态适配）：

1. **message/part 表无 sequence 列**（ZCode 有）→ ORDER BY 需条件化；
2. session 表的目录列是 `directory`（ZCode 为 path）。

本机实测：session 3、message 34、part 115。另有 `account/credential` 表（本机 0 行，若启用需按 secret 处理）。

**用量来源（token 统计）**：与 ZCode 不同，opencode 的用量**直接落在 `session` 表**（`tokens_input` / `tokens_output` /
`tokens_reasoning` / `tokens_cache_read` / `tokens_cache_write` / `cost`），一个会话一行、即该会话的累计值。
适配器据此填充：input/output/reasoning/cacheRead/cacheWrite/cost 如实映射，`total = input+output+reasoning`（缓存不计入）。
> 适配器按 session 表是否含 token 列自动区分 opencode 与 ZCode 同族库：有列走 session 表，无列走 ZCode 的 model_usage 表。

## 3. 读取方式与坑

- opencode.db 带 -shm/-wal 运行中，`readOnly: true` 打开实测成功；CAS 副本不含 WAL，未 checkpoint 的最新消息会延迟到下次扫描（可接受）。
- 双根布局：资产 path 用 `data:` 前缀锚定数据根（`WALLE_OPENCODE_DATA` 环境变量供测试重定向）。

## 4. 写回评估（P4 参考）

| 资产 | 可写回性 | 风险 |
|---|---|---|
| opencode.jsonc | ✅ 较安全 | 结构简单 |
| opencode.db | ❌ 永不写回 | 会话库只读 |
| auth.json | ⚠️ 谨慎 | 更换登录态 |
