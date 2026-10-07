<script setup lang="ts">
import { cn } from '../../lib/utils';

/** shadcn 风格 Badge（替代 NTag）：info=蓝/success/warning/error/default 四态语义 */
interface Props { type?: 'default' | 'info' | 'success' | 'warning' | 'error'; size?: 'tiny' | 'small' }
const props = withDefaults(defineProps<Props>(), { type: 'default', size: 'tiny' });
const typeCls: Record<string, string> = {
  default: 'bg-muted text-muted-foreground',
  info: 'bg-primary/10 text-primary',
  success: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  error: 'bg-red-500/12 text-red-600 dark:text-red-400',
};
</script>

<template>
  <span
    :class="cn(
      'inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap',
      props.size === 'tiny' ? 'h-[18px] px-2 text-[10.5px]' : 'h-6 px-2.5 text-xs',
      typeCls[props.type], $attrs.class ?? '',
    )"
  >
    <slot />
  </span>
</template>
