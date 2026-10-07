# Agents 共享技能库（~/.agents）调研报告

| | |
|---|---|
| 调研日期 | 2026-10-04（本机实测） |
| 状态 | ✅ 已接入适配器（P5.2） |
| 根目录 | `~/.agents`（skills CLI 维护的跨工具共享技能库） |
| 写回评估 | P5.2 远期（skills 创建/下载/修改），当前只读 |

## 1. 关键发现：共享库不只是仓库，是运行时技能源

skills CLI（vercel-labs/skills）把技能安装到 `~/.agents/skills`，再接入各 AI 工具。**接入方式因工具而异**（2026-10-04 实测）：

| 工具 | 接入方式 | 实证 |
|---|---|---|
| Codex CLI 0.160 | **原生发现**：直接扫描 `~/.agents/skills` | codex.exe 二进制中硬编码 `.agents/skills` 技能发现路径（与 `.codex/skills` 并列）；`~/.codex` 下无链接也无技能目录，但 CLI 内可用 |
| ZCode | **符号链接** | `~/.zcode/skills/find-skills`、`grill-me` → `~/.agents/skills/*` |
| Cline（用户确认） | **原生发现**：读 `~/.agents/skills`，`.cline` 下不存技能 | 2026-10-07 用户确认；walle 技能面板按「原生发现」展示，无链接接入动作 |
| opencode（用户确认） | **双通道**：原生探测 `~/.agents/skills` + 自有 `~/.config/opencode/skills/` 目录 | 2026-10-07 用户确认；自有目录技能为目录副本语义，共享库技能按「原生发现」展示 |
| 其他（lock 文件记录） | skills CLI 的 `lastSelectedAgents` 含 amp/cursor/droid/gemini-cli 等 | `~/.agents/.skill-lock.json` |

**对 walle 的含义**：只扫各工具目录会漏掉"工具实际可用但目录里不存在"的技能（如 Codex 与 grill-me）。因此 `~/.agents` 必须作为独立数据源（tool=agents）扫描，技能管理面板按 realpath 聚合本体与各工具接入。

## 2. 资产清单

| 路径 | kind | 格式 | 说明 |
|---|---|---|---|
| `~/.agents/skills/<name>/SKILL.md` | skill | Markdown | 共享技能本体（name/description frontmatter），每技能一个资产 |
| `~/.agents/.skill-lock.json` | config | JSON | 安装登记：来源仓库/URL、skillFolderHash、安装时间、lastSelectedAgents |

技能目录的附属文件（agents/ 等子目录）暂不收（对齐 codex/cursor/workbuddy 的降噪粒度）。

## 3. 读取方式与坑

- Windows 下 Git Bash 的 `ln -s` 是复制不是链接；测试固件建链接必须用 `node fs.symlinkSync(..., 'dir')`（需要管理员/开发者模式，固件失败时自动降级为真实目录并写标记）。
- walkFiles 跟随符号链接后必须做 realpath 防环（互链目录会死循环），见 packages/adapters/src/util.ts。
- 链接判定：`realpathSync(abs) !== resolve(abs)`（大小写不敏感比较，Windows realpath 会还原真实大小写；目录连接 junction 同样算链接）。

## 4. 写回评估（远期）

| 能力 | 可行性 | 风险 |
|---|---|---|
| 新建技能（写 SKILL.md） | ✅ 较安全 | 纯新增 markdown；需同步更新 lock 文件语义 |
| 网络下载（skills CLI 协议） | ⚠️ 中 | 引入网络；需哈希校验与来源白名单 |
| 在线修改 | ✅ 复用 P4 三保险 | SKILL.md 非会话/SQLite，可写回 |

## 5. 项目级技能：`<项目>/.agents/skills/`（v1.13，2026-10-06 实测）

`.agents` 不只在 home 根存在——实测 x-tools 项目目录下有项目级 `.agents/skills/`（banner-design、brand、design-system 等 7 个技能，含 SKILL.md + references/ + scripts/ 完整结构）。它是"该项目专属的技能目录"，与共享库本体、链接接入的语义均不同。

采集（v1.13）：agents 适配器在 discover 内用 project-assets.ts 探测 `<项目>/.agents/skills/<name>/SKILL.md`（只收 SKILL.md，附属文件不收，与 home 根口径一致）。项目根线索来自 session_meta.project_path。技能聚合视图新增「项目本地」状态（/api/skills 的 storePath 仅授予 home 根资产，项目技能不会被误标为共享库本体）。
