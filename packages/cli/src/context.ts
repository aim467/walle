import { ContentStore, WalleStore, ensureWalleHome, walleDbPath, walleObjectsDir } from '@walle/core';

/** 命令共享的打开逻辑：确保 ~/.walle 存在并打开元数据库与内容仓 */
export function openStores(): { store: WalleStore; cas: ContentStore } {
  ensureWalleHome();
  return {
    store: new WalleStore(walleDbPath()),
    cas: new ContentStore(walleObjectsDir()),
  };
}
