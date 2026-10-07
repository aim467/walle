<script setup lang="ts">
import { toasts } from './toast';

/** toast 渲染出口（替代 NMessageProvider）：右上角浮层，带语义色条 */
const kindCls: Record<string, { bar: string; icon: string }> = {
  success: { bar: 'bg-emerald-500', icon: '✓' },
  error: { bar: 'bg-red-500', icon: '✕' },
  warning: { bar: 'bg-amber-500', icon: '!' },
  info: { bar: 'bg-primary', icon: 'i' },
};
</script>

<template>
  <Teleport to="body">
    <div class="pointer-events-none fixed right-4 top-4 z-[200] flex w-[340px] max-w-[90vw] flex-col gap-2">
      <TransitionGroup name="toast">
        <div
          v-for="t in toasts" :key="t.id"
          class="pointer-events-auto flex items-stretch overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        >
          <span class="w-1 flex-shrink-0" :class="kindCls[t.kind].bar" />
          <span class="flex items-center gap-2 px-3.5 py-2.5 text-[12.5px] leading-snug text-foreground">
            <span class="font-bold" :class="kindCls[t.kind].bar.replace('bg-', 'text-')">{{ kindCls[t.kind].icon }}</span>
            {{ t.text }}
          </span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,.toast-leave-active{transition:all .22s ease}
.toast-enter-from{opacity:0;transform:translateX(24px)}
.toast-leave-to{opacity:0;transform:translateY(-8px)}
</style>
