<p align="center">
  <img src="assets/logo.png" width="112" height="112" alt="Walle">
</p>

<h1 align="center">Walle</h1>

<p align="center"><b>A local-first AI asset manager</b> — collects, indexes, backs up, and manages the configs, session histories, memories, Skills, and MCP configs scattered across your AI tools.</p>

<p align="center"><a href="README.md">简体中文</a> · <b>English</b></p>

**Local-only · No telemetry · Read-only by default · Content-addressed dedup · Zero native dependencies**

Walle currently supports **8 data sources**: ZCode, Codex CLI, Cursor, opencode, WorkBuddy (International / China), the `~/.agents` shared skill library, and Cline — plus Walle's own knowledge base.

> The name comes from WALL-E — quietly collecting, tidying up, and archiving treasures scattered all over the place.

---

## Table of Contents

- [Why Walle](#why-walle)
- [Core Capabilities](#core-capabilities)
- [Supported Data Sources](#supported-data-sources)
- [Quick Start](#quick-start)
- [CLI](#cli)
- [Local Web UI](#local-web-ui)
- [Architecture](#architecture)
- [Privacy & Security](#privacy--security)
- [Project Structure](#project-structure)
- [Development](#development)
- [License](#license)

---

## Why Walle

Every AI tool manages its own "assets" in its own silo, which brings a pile of problems:

- **Assets are scattered**: the same MCP config is written once in tool A and again in tool B; the same memory/rule has to be re-written in every tool.
- **Sessions are assets, but have nowhere to live**: tons of valuable conversations (debugging, design discussions, code snippets) sink into each tool's private directory and are lost the moment you switch tools or machines.
- **Formats are proprietary and volatile**: each vendor uses a different storage format (JSONL / TOML / SQLite / directory conventions) and changes it across versions — users can neither inspect nor migrate their own data.
- **No backup culture**: directories like `~/.codex`, `~/.cursor`, and `~/.workbuddy-ai` accumulate a lot of valuable data, yet have no versioning or backup at all.
- **Memories don't cross tools**: preferences you taught one tool have to be taught all over again in the next one.

Walle's approach: **never intrude on or replace any AI tool**. Instead, sit beside them as a unified "asset registry + vault + search engine", then gradually grow into a "sync engine / migrator".

---

## Core Capabilities

- **Scan & inventory** — `walle scan` incrementally scans every tool directory; idempotent and repeatable. Content goes into a content-addressed store (CAS, deduplicated by hash). Scanning while tools are running causes no conflicts (SQLite WAL is merged automatically / reads use a copy).
- **Browse & search** — FTS5 full-text search with CJK support (session bodies / titles / memories / Skills; sensitive content is never indexed); a local Web UI with seven views (Overview, Assets, Sessions, Skills, Memories, Knowledge, Settings).
- **Snapshots & backup** — snapshots are captured automatically on change, with version diffing, recovery from accidental deletion, zip export/import, and a `walle watch` scheduled guardian.
- **Write-back & migration** — off by default (enable with `walle write-enable`); triple-guarded writes (mandatory snapshot / atomic write / conflict detection), cross-tool isomorphic push, and one-click rollback.
- **Unified memory layer** — aggregates root and project memories across tools and detects same-name / same-content duplicates; `walle mcp` exposes memory and skill retrieval to AI tools as a read-only MCP server.
- **Knowledge base** — select messages on the Sessions page → (optionally LLM-assisted) distill them into knowledge cards / summary docs / memory entries, persisted as first-class, searchable, back-up-able assets.
- **Session intelligence** — token usage stats (aggregated by tool / day / project) and session-to-project grouping.

---

## Supported Data Sources

| Tool | Root directory | Main assets | Storage |
|---|---|---|---|
| **ZCode** | `~/.zcode` | session db, memories, agents, skills, rollout, plugins, v2 config/credentials | directory conventions + own db |
| **Codex CLI** | `~/.codex` | `config.toml` (config/MCP), `history.jsonl`, `sessions/`, `skills/`, `memories/`, `auth.json` (⚠️ credentials); also natively reads `~/.agents/skills` | TOML + JSONL + SQLite |
| **Cursor** | `~/.cursor` + `~/AppData/Roaming/Cursor` | `mcp.json`, skills, projects transcripts (plaintext session bodies), conversation-search.db, state.vscdb | JSON + SQLite |
| **opencode** | `~/.config/opencode` + `~/.local/share/opencode` | `opencode.jsonc`, `opencode.db` (sessions), its own skills, `auth.json` (⚠️ credentials) | JSONC + SQLite |
| **WorkBuddy (International)** | `~/.workbuddy-ai` | settings/MCP, SOUL/USER/memory (identity & memory), skills, plugins, connectors, projects (sessions), tasks, audit-log, keyblob (⚠️ credentials) | JSON + JSONL + SQLite + Markdown |
| **WorkBuddy (China)** | `~/.workbuddy` | same structure as International; managed separately as a distinct account | same as above |
| **agents shared skill library** | `~/.agents` | `skills/<name>/SKILL.md` (skills CLI shared body), `.skill-lock.json` | Markdown + JSON |
| **Cline** | `~/.cline` | data/sessions (session bodies + metadata), globalState.json, secrets.json (⚠️) | JSON |
| **Walle knowledge base** (self-managed) | `~/.walle/knowledge` | knowledge cards / summaries distilled from sessions (Markdown) | Markdown |

Walle also automatically collects **project-level memories and skills**: `<project>/.workbuddy*/memory/` and `<project>/.agents/skills/`, discovered via each session's `project_path` without scanning the whole disk.

---

## Quick Start

**Prerequisite**: Node.js ≥ 22.13 (relies on the built-in `node:sqlite`; no native compilation required).

```bash
npm install
npm run build

# Scan all local AI assets (incremental, idempotent)
npm run walle -- scan

# Build the full-text index (on first run or after big changes; --rebuild for a full rebuild)
npm run walle -- index

# Start the local Web UI (default http://127.0.0.1:4173)
npm run walle -- serve

# Common commands
npm run walle -- list --kind skill --source codex   # asset inventory
npm run walle -- search "semantic search"            # cross-tool full-text search
npm run walle -- sessions                            # session list (with token usage)
npm run walle -- show 12                             # asset details (sensitive assets auto-masked)
npm run walle -- backup                              # full backup (sensitive content excluded by default)
```

Data lives in `~/.walle/` (`walle.db` metadata + `objects/` content store + `exports/` output dir + `config.json`), and can be relocated with the `WALLE_HOME` environment variable.

---

## CLI

```
walle scan    [--source <id>] [--json]       Scan local AI-tool assets (incremental, idempotent)
walle index   [--rebuild]                    Build the full-text index (sensitive assets never indexed)
walle search  <term> [--kind] [--source] [--limit]   Cross-tool full-text search (CJK supported)
walle sessions [--source <id>]               Session list (with token usage)
walle read    <id>                           Read a session (full content by turn / role)
walle list    [--kind] [--source] [--all] [--json]  Asset inventory
walle show    <id> [--reveal] [--lines <n>]  Asset details & content (--reveal to unmask)
walle snap    <id>                           Asset snapshot timeline
walle diff    <id> [--from] [--to] [--context]  Version diff
walle recover <id> -o <file> [--snap <id>]   Recover a deleted asset to a file
walle backup  [file] [--include-secrets]     Full backup archive (zip; credentials excluded by default)
walle restore <zip>                          Restore from an archive
walle watch   [--interval <sec>] [--once]    Scheduled scan + index (snapshots on change)
walle serve   [--port <n>]                   Start the local Web UI
walle mcp                                    Read-only MCP server (stdio): exposes memory/skill search to AI tools
walle write-enable [--off]                   Toggle the write-back switch (off by default)
walle push    <id> [-f <file>] [--to <source>]  Write back or push across tools (triple-guarded)
walle rollback <id> [--snap <id>]            Roll back to a historical snapshot (reuses the triple guard)
```

---

## Local Web UI

After `walle serve`, open `http://127.0.0.1:4173`. Seven views:

| View | Contents |
|---|---|
| **Overview** | Source cards, change feed, token-usage card with a 14-day trend, Top projects, write-back status |
| **Assets** | Tool tabs + kind sidebar; details / edit / snapshot timeline (session assets live on the Sessions page — separated by concern) |
| **Sessions** | Finder-style three panes (tool → session list → reader); six tabs (Messages / Overview / Tools / Files / System / Raw); cross-tool full-text search, project grouping, token badges, and a ✦ distill entry point |
| **Skills** | Cross-tool skill overview, link tracking (origin / linked copies / tool coverage / project-local), full file browsing with Markdown preview, open locally, and import from SkillHub / GitHub / zip into any tool |
| **Memories** | Aggregates root × project memories across tools, with same-name / same-content detection |
| **Knowledge** | Knowledge cards and summaries distilled from sessions; tag filtering, Markdown reading, create / edit / delete, and source-session traceability |
| **Settings** | Custom data-source paths (native folder picker / built-in directory browser), the write-back switch, LLM (OpenAI-compatible) config, and light/dark theme |

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                    UI Layer                     │
│  CLI (zero-dep)  ·  Local Web UI (Vite + Vue 3) │
├─────────────────────────────────────────────────┤
│                 Service Layer                   │
│  Scan · Search · Snapshot/Backup · Write engine │
├─────────────────────────────────────────────────┤
│           Adapter Layer (one per tool)          │
│ zcode · codex · cursor · opencode · workbuddy · …│
│ Unified: discover() / read() / parse() / write() │
├─────────────────────────────────────────────────┤
│                 Storage Layer                   │
│  SQLite (metadata + FTS5) + CAS content store   │
└─────────────────────────────────────────────────┘
```

**Key design decisions:**

1. **Separate metadata from content** — SQLite stores only the index and metadata; asset content is stored in a content-addressed file store keyed by hash (CAS), which deduplicates identical content and directly powers snapshots and backup.
2. **Adapter pattern** — adding a new tool means writing a single adapter; upper layers (CLI / UI / search) are completely unaware of tool differences (measured: a tool with a similar schema took half a day to integrate).
3. **Read-only first** — the scanner accesses tool directories read-only (SQLite via a copy or `mode=ro`); any write capability must be explicitly enabled and always leaves a snapshot.
4. **Capability declaration over probing** — adapters explicitly declare whether they support writes via `capabilities.write`, and upper layers hard-block write requests accordingly.

---

## Privacy & Security

Walle has a complete policy for sensitive data (credentials / keys / sessions / memories):

- **Asset classification**: `secret` (credentials) · `private` (sessions / memories) · `normal`.
- **Masked display**: sensitive assets show only the first/last 4 characters in the CLI / UI by default; revealing plaintext requires an explicit action.
- **Index exclusion**: sensitive assets are **never written to the FTS full-text index**.
- **Export exclusion**: `walle backup` excludes sensitive content by default; use `--include-secrets` to include it explicitly.
- **Log safety**: no log or error ever prints a full credential (everything goes through a masking helper).

**Constraints & commitments:**

- Purely local: no telemetry, no cloud reporting; all data stays in `~/.walle/`.
- Session records are always read-only.
- Write-back for other assets requires an explicit switch and always leaves snapshots, with one-click rollback.
- Walle never changes any AI tool's proprietary format definition — it only adapts (when tools change formats, Walle follows).

---

## Project Structure

```
walle/
├── assets/                       # Brand assets: product icon (logo.svg master / logo.png)
├── docs/
│   ├── 开发文档.md               # Roadmap, domain model, architecture, changelog (Chinese)
│   ├── data-sources/             # One research report per data source
│   └── adr/                      # Architecture decision records (ADR-001 tech stack)
├── packages/
│   ├── core/                     # Domain model, SQLite store, content store, index, write engine
│   ├── adapters/                 # One adapter per tool
│   ├── cli/                      # CLI entry + local server + UI static hosting
│   └── ui/                       # Local Web UI (Vite + Vue 3)
├── fixtures/                     # Sanitized sample data per tool (test fixtures)
├── scripts/                      # Fixture generation & real-machine verification scripts
└── test/                         # node:test smoke tests
```

---

## Development

```bash
npm test        # build + generate fixtures + node:test smoke tests (no real-machine data needed)
npm run verify  # Phase 0 format verification scripts (read-only on the real ~/.codex and ~/.zcode)
```

- **Test fixtures**: one sanitized sample directory per tool; all adapter unit tests run on fixtures. When a tool changes its format, updating the fixture becomes a regression case.
- **Schema migration**: versioned via `PRAGMA user_version`; migration scripts are append-only.
- **Versioning**: semantic versioning (during 0.x, the stage number is the major version).

---

## License

Released under the [MIT License](LICENSE). Copyright (c) 2026 aim467.

You are free to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the software, provided that the copyright notice and this permission notice are retained in all copies or substantial portions. The software is provided "as is", without warranty of any kind.
