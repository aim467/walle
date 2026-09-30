import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/** walle 自身数据根目录（开发文档 §4.2），可用 WALLE_HOME 重定向（测试用） */
export function walleHome(): string {
  return process.env.WALLE_HOME ?? path.join(os.homedir(), '.walle');
}

export function walleDbPath(): string {
  return path.join(walleHome(), 'walle.db');
}

export function walleObjectsDir(): string {
  return path.join(walleHome(), 'objects');
}

export function ensureWalleHome(): string {
  const home = walleHome();
  fs.mkdirSync(path.join(home, 'objects'), { recursive: true });
  return home;
}
