<p align="center">
  <img src="assets/logo.png" width="112" height="112" alt="Walle（瓦力）产品图标">
</p>

<h1 align="center">Walle（瓦力）</h1>

<p align="center"><b>本地 AI 资产管理工具</b> —— 把散落在各个 AI 工具里的配置、会话历史、记忆、Skills、MCP 配置统一收集、检索、备份和管理。</p>

<p align="center"><b>简体中文</b> · <a href="README.en.md">English</a></p>

**纯本地 · 无遥测 · 只读优先 · 内容寻址去重 · 零原生依赖**

当前支持 **8 个数据源**：ZCode、Codex CLI、Cursor、opencode、WorkBuddy（国际版 / 国内版）、agents 共享技能库、Cline，外加 Walle 自有的知识库。

> 名字来自 WALL-E —— 默默收集、整理、归档散落一地的宝藏。

---

## 目录

- [为什么需要 Walle](#为什么需要-walle)
- [核心能力](#核心能力)
- [支持的数据源](#支持的数据源)
- [快速开始](#快速开始)
- [命令行](#命令行)
- [本地 Web UI](#本地-web-ui)
- [架构](#架构)
- [隐私与安全](#隐私与安全)
- [项目结构](#项目结构)
- [开发](#开发)
- [开源许可](#开源许可)

---

## 为什么需要 Walle

每个 AI 工具都自成体系地管理自己的"资产"，随之而来的是一堆麻烦：

- **资产散落**：同一个 MCP 配置在 A 工具配一份、B 工具又配一份；同一段记忆/规则要在每个工具里各写一遍。
- **会话即资产，却无处安放**：大量有价值的对话（调试过程、方案讨论、代码片段）沉在各工具的私有目录里，换工具、换机器就丢了。
- **格式私有且易变**：各家存储格式不同（JSONL / TOML / SQLite / 目录约定），还随版本升级变化，用户既无从查阅更无从迁移。
- **没有备份意识**：`~/.codex`、`~/.cursor`、`~/.workbuddy-ai` 这些目录里积累了大量有价值数据，却没有任何版本化与备份手段。
- **记忆无法跨工具**：在这个工具里教会的偏好，到另一个工具里要重新教。

Walle 的思路是：**不侵入、不替代任何 AI 工具**，在旁边做一个统一的「资产登记处 + 保险柜 + 检索器」，再逐步补上「同步器 / 迁移器」。

---

## 核心能力

- **扫描与盘点** —— `walle scan` 增量扫描全部工具目录，幂等、可重复执行；内容入内容仓（CAS 按哈希去重）；工具运行中扫描也不冲突（SQLite 自动合并 WAL / 副本读取）。
- **浏览与检索** —— FTS5 中文全文搜索（会话正文 / 标题 / 记忆 / Skill，敏感内容永不入索引）；本地 Web UI 七视图（总览、资产库、会话、技能、记忆、知识库、设置）。
- **快照与备份** —— 变更自动留快照、版本对比、误删恢复、zip 导出 / 导入、`walle watch` 定时守护。
- **写回与迁移** —— 默认关闭（`walle write-enable` 开启）；三保险写回（强制快照 / 原子写 / 冲突检测）、跨工具同构下发、一键回滚。
- **统一记忆层** —— 跨工具聚合根记忆与项目记忆、同名/同内容相似检测；`walle mcp` 以只读 MCP server 形式向 AI 工具暴露记忆与技能检索。
- **知识库** —— 会话页圈选消息 →（可选 LLM 辅助）提炼为知识卡片 / 纪要文档 / 记忆条目，落盘为可检索、可备份的一等资产。
- **会话智能** —— token 用量统计（按工具 / 按天 / 按项目聚合）与会话项目归集。

---

## 支持的数据源

| 工具 | 根目录 | 主要资产 | 存储形态 |
|---|---|---|---|
| **ZCode** | `~/.zcode` | 会话 db、memories、agents、skills、rollout、plugins、v2 配置/凭证 | 目录约定 + 自有 db |
| **Codex CLI** | `~/.codex` | `config.toml`（配置/MCP）、`history.jsonl`、`sessions/`、`skills/`、`memories/`、`auth.json`（⚠️ 凭证）；另原生读取 `~/.agents/skills` | TOML + JSONL + SQLite |
| **Cursor** | `~/.cursor` + `~/AppData/Roaming/Cursor` | `mcp.json`、skills、projects 转录（明文会话正文）、conversation-search.db、state.vscdb | JSON + SQLite |
| **opencode** | `~/.config/opencode` + `~/.local/share/opencode` | `opencode.jsonc`、`opencode.db`（会话）、自有 skills、`auth.json`（⚠️ 凭证） | JSONC + SQLite |
| **WorkBuddy 国际版** | `~/.workbuddy-ai` | settings/MCP、SOUL/USER/memory（身份与记忆）、skills、plugins、connectors、projects（会话）、tasks、audit-log、keyblob（⚠️ 凭证） | JSON + JSONL + SQLite + Markdown |
| **WorkBuddy 国内版** | `~/.workbuddy` | 结构与国际版同构，独立账户分开管理 | 同上 |
| **agents 共享技能库** | `~/.agents` | `skills/<name>/SKILL.md`（skills CLI 共享本体）、`.skill-lock.json` | Markdown + JSON |
| **Cline** | `~/.cline` | data/sessions（会话正文 + 元数据）、globalState.json、secrets.json（⚠️） | JSON |
| **Walle 知识库**（自管） | `~/.walle/knowledge` | 会话提炼产出的知识卡片 / 纪要（Markdown） | Markdown |

此外还自动采集**项目级记忆与技能**：`<项目>/.workbuddy*/memory/`、`<项目>/.agents/skills/`，以会话的 `project_path` 作线索发现，无需全盘扫描。

---

## 快速开始

**前置条件**：Node.js ≥ 22.13（依赖内置 `node:sqlite`，无需任何原生编译）。

```bash
npm install
npm run build

# 扫描本机全部 AI 资产（增量、幂等）
npm run walle -- scan

# 构建全文索引（首次或大变更后；--rebuild 全量重建）
npm run walle -- index

# 启动本地 Web UI（默认 http://127.0.0.1:4173）
npm run walle -- serve

# 常用命令示例
npm run walle -- list --kind skill --source codex   # 资产清单
npm run walle -- search "语义检索"                    # 跨工具全文搜索
npm run walle -- sessions                            # 会话清单（含 token 用量）
npm run walle -- show 12                             # 资产详情（敏感资产自动脱敏）
npm run walle -- backup                              # 全量备份（默认排除敏感内容）
```

数据落盘位置：`~/.walle/`（`walle.db` 元数据 + `objects/` 内容仓 + `exports/` 导出目录 + `config.json` 配置），可用环境变量 `WALLE_HOME` 重定向。

---

## 命令行

```
walle scan    [--source <id>] [--json]       扫描本机 AI 工具资产（增量、幂等）
walle index   [--rebuild]                    构建全文索引（敏感资产永不入索引）
walle search  <词> [--kind] [--source] [--limit]   跨工具全文搜索（支持中文）
walle sessions [--source <id>]               会话清单（含 token 用量）
walle read    <id>                           阅读会话（按轮次 / 角色输出完整内容）
walle list    [--kind] [--source] [--all] [--json]  资产清单
walle show    <id> [--reveal] [--lines <n>]  资产详情与内容（--reveal 不脱敏）
walle snap    <id>                           资产快照时间线
walle diff    <id> [--from] [--to] [--context]  版本对比
walle recover <id> -o <file> [--snap <id>]   误删恢复：导出资产内容到文件
walle backup  [file] [--include-secrets]     全量备份归档（zip，默认排除凭证）
walle restore <zip>                          从归档恢复
walle watch   [--interval <秒>] [--once]     定时扫描 + 索引（变更自动留快照）
walle serve   [--port <n>]                   启动本地 Web UI
walle mcp                                    只读 MCP server（stdio）：向 AI 工具暴露记忆/技能检索
walle write-enable [--off]                   开启 / 关闭写回开关（默认关闭）
walle push    <id> [-f <file>] [--to <source>]  写回或跨工具下发（三保险）
walle rollback <id> [--snap <id>]            回滚到历史快照（复用三保险）
```

---

## 本地 Web UI

`walle serve` 后打开 `http://127.0.0.1:4173`，提供七个视图：

| 视图 | 内容 |
|---|---|
| **总览** | 数据源卡片、变更流、token 用量卡与 14 天趋势、Top 项目榜、写回状态 |
| **资产库** | 工具 Tab + 类型侧栏，详情 / 编辑 / 快照时间线（会话类资产归入会话页，职责分离） |
| **会话** | Finder 式三栏（工具 → 会话列表 → 阅读器）；消息 / 概览 / Tools / Files / System / Raw 六页签；跨工具全文搜索、按项目归集、token 徽标、✦ 提炼入口 |
| **技能** | 跨工具技能全景、链接追踪（本体 / 链接副本 / 工具覆盖 / 项目本地）、全文件浏览与 Markdown 预览、本地打开、从 SkillHub / GitHub / zip 导入并接入各工具 |
| **记忆** | 跨工具根记忆 × 项目记忆聚合，同名 / 同内容相似检测 |
| **知识库** | 会话提炼产出的知识卡片与纪要，标签过滤、Markdown 阅读、新建 / 编辑 / 删除、来源会话溯源 |
| **设置** | 数据源路径自定义、写回开关、大模型（OpenAI 兼容接口）配置、明暗主题切换 |

---

## 架构

```
┌───────────────────────────────────────────────────┐
│                 界面层                             │
│        CLI（零依赖）  ·  本地 Web UI（Vite+Vue 3） │
├───────────────────────────────────────────────────┤
│                       服务层                       │
│   扫描调度 · 全文检索 · 快照/备份 · 写回引擎       │
├───────────────────────────────────────────────────┤
│                 适配器层（每工具一个）             │
│  zcode │ codex │ cursor │ opencode │ workbuddy │…  │
│  统一接口: discover() / read() / parse() / write() │
├───────────────────────────────────────────────────┤
│                       存储层                       │
│   SQLite（元数据 + FTS5 全文索引） + 内容仓（CAS） │
└───────────────────────────────────────────────────┘
```

**关键设计决策：**

1. **元数据与内容分离** —— SQLite 只存索引与元数据，资产内容按哈希存入内容寻址文件仓（CAS），同一内容天然去重，并直接支撑快照与备份。
2. **适配器模式** —— 接入一个新工具只需写一个 adapter，上层（CLI / UI / 检索）完全不感知工具差异（实测：同族 schema 的工具半天即可接入）。
3. **只读优先** —— 扫描器对工具目录只读访问（SQLite 用副本或 `mode=ro`）；任何写能力都需显式开启并强制快照。
4. **能力声明而非探测** —— 适配器通过 `capabilities.write` 显式声明是否支持写，上层据此硬性拦截写请求。

---

## 隐私与安全

Walle 对敏感数据（凭证 / 密钥 / 会话 / 记忆）有一整套策略：

- **资产分级**：`secret`（凭证）· `private`（会话 / 记忆）· `normal`。
- **展示脱敏**：敏感资产在 CLI / UI 中默认只显示前后 4 字符，明文查看需显式操作。
- **索引排除**：敏感资产**永不进入 FTS 全文索引**。
- **导出排除**：`walle backup` 默认排除敏感内容，需 `--include-secrets` 显式包含。
- **日志安全**：任何日志 / 报错都不打印完整凭证（统一走脱敏函数）。

**约束与承诺：**

- 纯本地，无遥测、无云端上报，所有数据留在 `~/.walle/`；
- 会话记录永远只读；
- 其余资产的写回需显式开启开关，且全程留快照、可一键回滚；
- 不修改任何 AI 工具的私有格式定义，只做适配（工具改格式，Walle 跟着改）。

---

## 项目结构

```
walle/
├── assets/                       # 品牌资产：产品图标（logo.svg 母版 / logo.png）
├── docs/
│   ├── 开发文档.md               # 阶段规划、领域模型、架构与修订记录
│   ├── data-sources/             # 每个数据源一份调研报告
│   └── adr/                      # 技术决策记录（ADR-001 技术选型）
├── packages/
│   ├── core/                     # 领域模型、SQLite 存储、内容仓、索引、写回引擎
│   ├── adapters/                 # 每个工具一个适配器
│   ├── cli/                      # 命令行入口 + 本地服务 + UI 静态托管
│   └── ui/                       # 本地 Web UI（Vite + Vue 3）
├── fixtures/                     # 各工具的脱敏样本数据（测试固件）
├── scripts/                      # 固件生成与真机验证脚本
└── test/                         # node:test 冒烟测试
```

---

## 开发

```bash
npm test        # 构建 + 生成固件 + node:test 冒烟测试（不依赖真机数据）
npm run verify  # Phase 0 格式验证脚本（读取真机 ~/.codex 与 ~/.zcode，只读）
```

- **测试固件（fixtures）**：每个工具一份脱敏样本目录，适配器单测全部跑在固件上；工具升级格式时更新固件即形成回归用例。
- **Schema 迁移**：`PRAGMA user_version` 版本化，迁移脚本只增不改。
- **版本策略**：语义化版本（0.x 阶段以阶段号为大版本）。

---

## 开源许可

本项目基于 [MIT License](LICENSE) 开源，版权所有 (c) 2026 aim467。

你可以自由地使用、复制、修改、合并、发布、分发、再许可和/或销售本软件的副本，唯一的要求是在所有副本或实质性部分中保留上述版权声明与许可声明。本软件按「原样」提供，不附带任何形式的担保。
