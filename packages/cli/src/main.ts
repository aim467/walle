import './warnings.js';
import { cmdScan } from './commands/scan.js';
import { cmdList } from './commands/list.js';
import { cmdShow } from './commands/show.js';
import { cmdSearch } from './commands/search.js';
import { cmdSessions } from './commands/sessions.js';
import { cmdRead } from './commands/read.js';
import { cmdIndex } from './commands/index.js';
import { cmdServe } from './commands/serve.js';
import { cmdSnap, cmdDiff } from './commands/snapdiff.js';
import { cmdBackup, cmdRestore, cmdRecover } from './commands/backup.js';
import { cmdWatch } from './commands/watch.js';

const VERSION = '0.3.0';

const HELP = `walle（瓦力）— 本地 AI 资产管理工具 v${VERSION}
当前阶段：Phase 2 浏览与检索（对所有 AI 工具目录只读）

用法: walle <命令> [选项]

命令:
  scan              扫描本机 AI 工具资产（增量、幂等）
    --source <id>   只扫描指定源（codex/zcode/cursor/opencode）
    --json          JSON 输出
  index             构建全文索引（敏感资产永不入索引）
    --rebuild       丢弃现有索引全量重建
  search <词>       跨工具全文搜索（支持中文）
    --kind <kind>   按类型过滤   --source <id> 按来源过滤
    --limit <n>     最多显示条数（默认 30）
  sessions          会话清单（按时间倒序）
    --source <id>   按来源过滤
  read <id>         阅读会话（按轮次/角色输出完整内容）
  list              列出资产清单
    --kind/--source/--all/--limit/--json
  show <id>         查看资产详情与内容
    --reveal        敏感资产不脱敏   --lines <n>
  snap <id>         资产快照时间线
  diff <id>         版本对比（默认 当前 vs 上一版本）
    --from/--to <快照id|now>   --context <n>
  recover <id>      误删恢复：导出资产内容到文件
    -o <file>       输出路径   --snap <快照id>
  backup [file]     全量备份归档（zip）
    --include-secrets  凭证类内容也打包（默认排除）
  restore <zip>     从归档恢复（到 ~/.walle）
  watch             定时扫描+索引（变更自动留快照）
    --interval <秒> 间隔（默认 300）   --once 只跑一次
  serve             启动本地 Web UI（http://127.0.0.1:4173）
    --port <n>      指定端口
  help              显示本帮助

数据落盘: ~/.walle/（可用 WALLE_HOME 环境变量重定向）
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const rest = argv.slice(1);

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
    return;
  }
  if (cmd === '--version' || cmd === '-v') {
    console.log(VERSION);
    return;
  }

  switch (cmd) {
    case 'scan':
      await cmdScan(rest);
      break;
    case 'index':
      await cmdIndex(rest);
      break;
    case 'search':
      await cmdSearch(rest);
      break;
    case 'sessions':
      await cmdSessions(rest);
      break;
    case 'read':
      await cmdRead(rest);
      break;
    case 'list':
      await cmdList(rest);
      break;
    case 'show':
      await cmdShow(rest);
      break;
    case 'snap':
      await cmdSnap(rest);
      break;
    case 'diff':
      await cmdDiff(rest);
      break;
    case 'recover':
      await cmdRecover(rest);
      break;
    case 'backup':
      await cmdBackup(rest);
      break;
    case 'restore':
      await cmdRestore(rest);
      break;
    case 'watch':
      await cmdWatch(rest);
      break;
    case 'serve':
      await cmdServe(rest);
      break;
    default:
      console.error(`未知命令: ${cmd}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('walle 出错:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
