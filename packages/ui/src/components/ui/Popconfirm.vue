<script setup lang="ts">
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent, PopoverArrow } from 'reka-ui';

/** shadcn 风格 Popconfirm（Popover 组合）：替代 NPopconfirm，确认/取消语义色 */
defineProps<{ text?: string }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const open = defineModel<boolean>('open');
</script>

<template>
  <PopoverRoot v-model:open="open">
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        :side-offset="8"
        class="z-[160] w-64 rounded-xl border border-border bg-card p-3.5 shadow-lg focus:outline-none"
      >
        <div class="text-[12.5px] leading-relaxed text-foreground">
          <slot>{{ text }}</slot>
        </div>
        <div class="mt-3 flex justify-end gap-2">
          <button
            class="h-7 rounded-full border border-border px-3 text-xs text-foreground transition-colors hover:bg-muted"
            @click="emit('cancel'); open = false"
          >取消</button>
          <button
            class="h-7 rounded-full bg-destructive px-3 text-xs font-medium text-white transition-colors hover:bg-destructive/90"
            @click="emit('confirm'); open = false"
          >删除</button>
        </div>
        <PopoverArrow class="fill-card" :width="14" :height="7" />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
