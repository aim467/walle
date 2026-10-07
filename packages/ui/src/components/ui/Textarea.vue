<script setup lang="ts">
import { cn } from '../../lib/utils';

/** shadcn 风格 Textarea（v1.25）：v-model:value 兼容 naive 迁移口径 */
const value = defineModel<string>('value', { default: '' });
interface Props {
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
  spellcheck?: boolean;
  /** default=带边框输入框；bare=无边框代码/正文编辑区（配合 font-mono 使用） */
  variant?: 'default' | 'bare';
}
const props = withDefaults(defineProps<Props>(), { rows: 4, variant: 'default', spellcheck: false });
</script>

<template>
  <textarea
    v-model="value"
    :rows="props.rows"
    :placeholder="placeholder"
    :disabled="disabled"
    :spellcheck="spellcheck"
    :class="cn(
      'w-full text-[13px] leading-relaxed outline-none transition-colors resize-y',
      'focus-visible:ring-2 focus-visible:ring-ring/50',
      props.variant === 'bare'
        ? 'bg-transparent text-foreground placeholder:text-muted-foreground/70 border-0 resize-none'
        : 'rounded-xl border border-input bg-card px-3.5 py-2.5 text-foreground placeholder:text-muted-foreground/70',
      $attrs.class ?? '',
    )"
  />
</template>
