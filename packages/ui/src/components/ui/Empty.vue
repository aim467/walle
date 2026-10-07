<script setup lang="ts">
/** shadcn 风格 Empty（替代 NEmpty）：内联 SVG 空态插画 */
interface Props { description?: string; size?: 'small' | 'default' }
withDefaults(defineProps<Props>(), { description: '暂无数据', size: 'default' });
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2.5 py-10 text-center" :class="size === 'small' ? 'py-6' : ''">
    <svg viewBox="0 0 48 48" width="44" height="44" class="text-muted-foreground/45">
      <rect x="8" y="12" width="32" height="24" rx="4" fill="none" stroke="currentColor" stroke-width="2.4" />
      <path d="M8 20c8 4 24 4 32 0" fill="none" stroke="currentColor" stroke-width="2.4" />
      <circle cx="36" cy="34" r="7" class="fill-background" stroke="currentColor" stroke-width="2.2" />
      <path d="M33.5 34h5M36 31.5v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    </svg>
    <div class="text-xs text-muted-foreground" :class="size === 'small' ? '' : 'text-[12.5px]'">{{ description }}</div>
    <slot />
  </div>
</template>
