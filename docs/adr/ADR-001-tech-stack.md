# ADR-001：技术选型定案

| | |
|---|---|
| 状态 | 已接受（2026-09-30）·已全面实施（Phase 1 起，node:sqlite / 零依赖 CLI / Vue UI 均按本决策落地） |
| 阶段 | Phase 0 |
| 背景 | 开发文档 §6 推荐 TypeScript monorepo，留待 Phase 0 结束时定案。本 ADR 依据本机实测环境做出最终决策。 |

## 决策

### D1 语言与运行时：TypeScript 5 + Node.js ≥ 22.13（ESM / NodeNext）

沿用开发文档推荐。理由不再重复；补充实测依据：本机 Node v22.22.0 可用。

### D2 SQLite 方案：`node:sqlite`（Node 内置），不引入 better-sqlite3

**这是对文档推荐的调整**（文档写的是 better-sqlite3）。实测依据：

- 本机 `node:sqlite` 可用且 **FTS5 可用**（`CREATE VIRTUAL TABLE … USING fts5` 实测通过），满足 P2 全文检索需求；
- 零原生依赖：Windows 上免 node-gyp 编译、免 prebuild 二进制下载，`npm install` 只装 typescript 一个 devDep，安装链路最短、最不易碎。

**代价与对策：**

- Node 22 中标记 Experimental（每次运行打印一条 ExperimentalWarning）→ CLI 入口注册 warning 过滤器（`packages/cli/src/warnings.ts`），业务输出不受干扰；
- API 变动风险（Node 大版本）→ `engines.node >=22.13` 锁定；若未来 API 破坏性变更，切换到 better-sqlite3 是局部改动（store.ts 单文件封装了全部 SQL 访问）。

### D3 monorepo：npm workspaces；adapters 为单包多模块

开发文档 §4.5 草案是"每工具一个包"。P1 规模下两个适配器拆包收益为负（版本联动、发布成本），改为 `@walle/adapters` 单包内 `src/codex.ts` / `src/zcode.ts` 模块级隔离。适配器间无共享状态，未来拆包是纯机械操作。

### D4 CLI 依赖策略：运行时零依赖

子命令分发与参数解析用 `node:util parseArgs` 自研，不引 commander/yargs。整个 CLI 的运行时依赖只有 Node 内置模块 —— 与"本地资产管理工具应当轻量可靠"的定位一致。类型检查与构建依赖仅 `typescript` + `@types/node`（devDependencies）。

### D5 构建：每包独立 tsc，root 脚本链式构建

无 bundler（CLI 不需要），`npm run build` 依 core → adapters → cli 顺序编译。测试用 Node 内置 `node:test`，测试数据用 `fixtures/`（脱敏合成样本）+ `WALLE_HOME` / `--root` 覆盖机制，不依赖真机数据。

## 后果

- 交付物 `walle` CLI 只需 `node packages/cli/dist/main.js` 即可运行，`npm i -g .` 后得到全局命令；
- 锁死 Node ≥ 22.13（node:sqlite 去 flag 门槛），README 与 package.json `engines` 双声明；
- better-sqlite3 保留为 D2 的兜底方案，触发条件：node:sqlite API 破坏性变更或 FTS5 需求无法满足。
