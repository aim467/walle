<script setup lang="ts">
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogClose } from 'reka-ui';

/** shadcn 风格 Dialog（reka-ui 封装）：替代 NModal 的模态弹窗 */
defineProps<{ open: boolean; title?: string; width?: string }>();
const emit = defineEmits<{ 'update:open': [v: boolean] }>();
</script>

<template>
  <DialogRoot :open="open" @update:open="emit('update:open', $event)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[180] bg-black/40 backdrop-blur-[2px] data-[state=closed]:animate-out" />
      <DialogContent
        :style="{ width: width ?? '640px', maxWidth: '92vw', maxHeight: '84vh' }"
        class="fixed left-1/2 top-1/2 z-[190] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl focus:outline-none"
      >
        <div class="mb-3 flex items-start justify-between gap-4">
          <DialogTitle class="text-[15px] font-bold leading-1.35 text-foreground">{{ title ?? '' }}</DialogTitle>
          <DialogClose
            class="inline-flex size-7 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="关闭"
          >
            <svg viewBox="0 0 24 24" width="14" height="14"><path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
          </DialogClose>
        </div>
        <slot />
        <div v-if="$slots.footer" class="mt-4 flex justify-end gap-2">
          <slot name="footer" />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
