# Walle（瓦力）

本地 AI 资产管理工具：把散落在各个 AI 工具（ZCode、Codex CLI、Cursor、opencode、WorkBuddy，后续 VS Code）里的配置、会话历史、记忆、Skills、MCP 配置统一收集、检索、备份。

- 设计与阶段规划见 [docs/开发文档.md](docs/开发文档.md)
- 数据源调研见 [docs/data-sources/](docs/data-sources/)
- 当前阶段：**Phase 1（只读扫描 CLI）** —— 对所有工具目录只读

## 快速开始

```bash
npm install
npm run build

# 扫描本机全部 AI 资产（增量，幂等）
npm run walle -- scan

# 查看资产清单
npm run walle -- list
npm run walle -- list --kind session --source codex

# 查看单个资产详情与内容（敏感资产自动脱敏，--reveal 显式查看）
npm run walle -- show 12
```

数据落盘位置：`~/.walle/`（`walle.db` 元数据 + `objects/` 内容仓），可用环境变量 `WALLE_HOME` 重定向。

## 约束（重要）

- 纯本地，无遥测、无云端上报；
- Phase 4 之前对所有 AI 工具目录**只读**；
- 凭证类资产（auth.json / credentials.json / 含 token 的配置）自动标记 sensitive：展示脱敏、永不进全文索引、导出默认排除。

## 开发

```bash
npm test        # 构建 + 生成固件 + node:test 冒烟（不依赖真机数据）
npm run verify  # Phase 0 格式验证脚本（读取真机 ~/.codex 与 ~/.zcode，只读）
```
