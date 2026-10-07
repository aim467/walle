<script setup lang="ts">
import { cn } from '../../lib/utils';

/** shadcn 风格 Button（v1.25）：variant/size 语义对齐 shadcn-vue，rounded 全站沿用 Apple 圆角胶囊 */
interface Props {
  variant?: 'default' | 'secondary' | 'ghost' | 'outline' | 'destructive';
  size?: 'xs' | 'sm' | 'default';
  type?: 'button' | 'submit';
  disabled?: boolean;
  loading?: boolean;
  title?: string;
}
const props = withDefaults(defineProps<Props>(), { variant: 'default', size: 'sm', type: 'button' });

const variantCls: Record<string, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm',
  secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/70',
  ghost: 'hover:bg-muted text-foreground',
  outline: 'border border-border bg-card hover:bg-muted text-foreground',
  destructive: 'bg-destructive text-white hover:bg-destructive/90',
};
const sizeCls: Record<string, string> = {
  xs: 'h-6 px-2 text-[11px]',
  sm: 'h-7 px-3 text-xs',
  default: 'h-9 px-4 text-sm',
};
</script>

<template>
  <button
    :type="props.type"
    :disabled="disabled || loading"
    :title="title"
    :class="cn(
      'inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-50 disabled:pointer-events-none',
      variantCls[props.variant], sizeCls[props.size], $attrs.class ?? '',
    )"
  >
    <span v-if="loading" class="inline-block size-3 animate-spin rounded-full border border-current border-t-transparent" />
    <slot />
  </button>
</template>
