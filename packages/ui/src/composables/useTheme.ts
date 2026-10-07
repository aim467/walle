import { ref, watchEffect } from 'vue';

/** 明暗主题（v1.25 shadcn 化）：.dark 类 + localStorage 持久化；未设置跟随系统 */
type Theme = 'light' | 'dark';
const stored = localStorage.getItem('walle-theme') as Theme | null;
const theme = ref<Theme>(stored ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

watchEffect(() => {
  document.documentElement.classList.toggle('dark', theme.value === 'dark');
  localStorage.setItem('walle-theme', theme.value);
});

export function useTheme() {
  return {
    theme,
    toggle: () => { theme.value = theme.value === 'dark' ? 'light' : 'dark'; },
  };
}
