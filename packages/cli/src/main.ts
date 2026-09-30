import './warnings.js';
import { cmdScan } from './commands/scan.js';
import { cmdList } from './commands/list.js';
import { cmdShow } from './commands/show.js';

const VERSION = '0.1.0';

const HELP = `walle（瓦力）— 本地 AI 资产管理工具 v${VERSION}
当前阶段：Phase 1 只读扫描（对所有 AI 工具目录只读）

用法: walle <命令> [选项]

命令:
  scan              扫描本机 AI 工具资产（增量、幂等）
    --source <id>   只扫描指定源（可多次: --source codex --source zcode）
    --json          JSON 输出
  list              列出资产清单
    --kind <kind>   按类型过滤（config/session/memory/secret/...）
    --source <id>   按来源过滤
    --all           包含失踪资产
    --limit <n>     最多显示条数（默认 100）
    --json          JSON 输出
  show <id>         查看资产详情与内容
    --reveal        敏感资产不脱敏
    --lines <n>     文本内容最多显示行数（默认 40）
    --json          JSON 输出
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
    case 'list':
      await cmdList(rest);
      break;
    case 'show':
      await cmdShow(rest);
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
