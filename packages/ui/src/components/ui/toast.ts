/** 极简 toast（替代 naive useMessage）：模块级 store + Toaster.vue 渲染 */
import { reactive } from 'vue';

export interface ToastItem { id: number; kind: 'success' | 'error' | 'warning' | 'info'; text: string }
let seq = 0;
export const toasts = reactive<ToastItem[]>([]);

function push(kind: ToastItem['kind'], text: string, ms = 3200) {
  const item: ToastItem = { id: ++seq, kind, text };
  toasts.push(item);
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === item.id);
    if (i >= 0) toasts.splice(i, 1);
  }, ms);
}

export const toast = {
  success: (t: string) => push('success', t),
  error: (t: string) => push('error', t, 5200),
  warning: (t: string) => push('warning', t),
  info: (t: string) => push('info', t),
};
