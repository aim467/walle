<script setup lang="ts">
import { ref } from 'vue';
import { cn } from '../../lib/utils';

/** shadcn 风格 Input（v1.25）：v-model:value 兼容 naive 迁移口径 */
const value = defineModel<string>('value', { default: '' });
interface Props { placeholder?: string; type?: string; disabled?: boolean; password?: boolean; clearable?: boolean }
const props = withDefaults(defineProps<Props>(), { type: 'text' });
const showPwd = ref(false);
</script>

<template>
  <span class="relative inline-flex w-full items-center">
    <input
      v-model="value"
      :type="password && !showPwd ? 'password' : 'text'"
      :placeholder="placeholder"
      :disabled="disabled"
      :class="cn(
        'h-8 w-full rounded-full border border-input bg-card px-3.5 text-[13px] text-foreground placeholder:text-muted-foreground/70',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:border-transparent',
        'disabled:opacity-50', password ? 'pr-9' : '', $attrs.class ?? '',
      )"
    >
    <button
      v-if="password"
      type="button" tabindex="-1"
      class="absolute right-2.5 flex h-5 w-5 items-center justify-center text-muted-foreground hover:text-foreground"
      :title="showPwd ? '隐藏' : '显示'"
      @click="showPwd = !showPwd"
    >
      <svg viewBox="0 0 24 24" width="13" height="13"><path v-if="showPwd" d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" fill="none" stroke="currentColor" stroke-width="2" /><circle v-if="showPwd" cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2" /><path v-else d="M17.94 17.94A10.9 10.9 0 0112 19c-7 0-11-7-11-7a19.8 19.8 0 015.06-5.94M9.9 4.24A9.9 9.9 0 0112 5c7 0 11 7 11 7a19.7 19.7 0 01-3.22 4.31M1 1l22 22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
    </button>
  </span>
</template>
