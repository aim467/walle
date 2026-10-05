# Walle（瓦力）

本地 AI 资产管理工具：把散落在各个 AI 工具里的配置、会话历史、记忆、Skills、MCP 配置统一收集、检索、备份和管理。

**当前支持 6 个数据源**：ZCode、Codex CLI、Cursor、opencode、WorkBuddy、agents 共享技能库（`~/.agents`，skills CLI 生态）。

- 设计与阶段规划见 [docs/开发文档.md](docs/开发文档.md)
- 数据源调研见 [docs/data-sources/](docs/data-sources/)
- 当前阶段：**Phase 0-4 ✅ · P5 进行中**（token 用量统计、技能管理面板与技能网络导入已上线；统一记忆层 / MCP server 是下一步）

## 功能总览

- **扫描与盘点**：`walle scan` 增量扫描全部工具目录（幂等、运行中工具不冲突，SQLite 自动合并 WAL）；内容入内容仓（CAS 按哈希去重）
- **浏览与检索**：FTS5 中文全文搜索（会话正文/标题/记忆/Skill，secret 永不入索引）；本地 Web UI 五视图——总览（含 token 用量统计与趋势）、资产库（浏览/编辑/快照）、会话（跨工具阅读器 + 按项目归集）、技能（跨工具全景 + 链接追踪 + 全文件浏览/预览 + 本地打开 + 从 SkillHub / GitHub / zip 导入安装到共享库并可链接/复制接入各工具）、设置（数据源路径自定义）
- **快照与备份**：变更自动留快照、版本对比、误删恢复、zip 导出/导入、`walle watch` 定时守护
- **写回与迁移**（默认关闭，`walle write-enable`）：三保险写回（快照/原子写/冲突检测）、跨工具同构下发、一键回滚

## 快速开始

```bash
npm install
npm run build

# 扫描本机全部 AI 资产（增量，幂等）
npm run walle -- scan

# 构建全文索引（首次或大变更后；--rebuild 全量重建）
npm run walle -- index

# 启动本地 Web UI（默认 http://127.0.0.1:4173）
npm run walle -- serve

# 常用命令
npm run walle -- list --kind skill --source codex   # 资产清单
npm run walle -- search "语义检索"                    # 跨工具全文搜索
npm run walle -- sessions                            # 会话清单（含 token 用量）
npm run walle -- show 12                             # 资产详情（敏感资产自动脱敏）
npm run walle -- backup                              # 全量备份（默认排除 secret）
```

数据落盘位置：`~/.walle/`（`walle.db` 元数据 + `objects/` 内容仓），可用环境变量 `WALLE_HOME` 重定向。

## 约束（重要）

- 纯本地，无遥测、无云端上报；
- 会话记录永远只读；其余资产写回需显式开启开关且全程留快照；
- 凭证类资产（auth.json / credentials.json / 含 token 的配置）自动标记 sensitive：展示脱敏、永不进全文索引、导出默认排除。

## 开发

```bash
npm test        # 构建 + 生成固件 + node:test 冒烟（40 用例，不依赖真机数据）
npm run verify  # Phase 0 格式验证脚本（读取真机 ~/.codex 与 ~/.zcode，只读）
```

文档：[开发文档](docs/开发文档.md)（阶段规划与修订记录） · [ADR-001 技术选型](docs/adr/ADR-001-tech-stack.md) · [数据源调研](docs/data-sources/)
