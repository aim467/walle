/**
 * 必须是 main.ts 的第一个 import（ESM 按语句顺序求值）：
 * Node 22 中 'warning' 事件的内部默认打印 handler 与用户监听器并存，
 * 仅注册监听器拦不住 ExperimentalWarning 的默认输出（实测 22.22），
 * 因此先 removeAllListeners 移除内部 handler，再挂自己的过滤器（ADR-001 D2）。
 */
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (/Experimental/i.test(String(w?.name))) return;
  console.error(w);
});
