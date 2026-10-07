<script setup lang="ts">
import { DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuPortal, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from 'reka-ui';

/** shadcn 风格 DropdownMenu（reka-ui 封装）：替代 NDropdown 的 ··· 操作菜单 */
export interface MenuOption { label: string; key: string; disabled?: boolean; divider?: boolean }
defineProps<{ options: MenuOption[] }>();
const emit = defineEmits<{ select: [key: string] }>();
const open = defineModel<boolean>('open');
</script>

<template>
  <DropdownMenuRoot v-model:open="open">
    <DropdownMenuTrigger as-child>
      <slot name="trigger" />
    </DropdownMenuTrigger>
    <DropdownMenuPortal>
      <DropdownMenuContent
        :side-offset="6" align="end"
        class="z-[170] min-w-[180px] rounded-xl border border-border bg-card p-1.5 shadow-lg focus:outline-none"
      >
        <template v-for="o in options" :key="o.key">
          <DropdownMenuSeparator v-if="o.divider" class="my-1 h-px bg-border" />
          <DropdownMenuItem
            v-else
            :disabled="o.disabled"
            class="cursor-pointer select-none rounded-lg px-3 py-1.5 text-[12.5px] text-foreground outline-none data-[highlighted]:bg-muted data-[disabled]:pointer-events-none data-[disabled]:opacity-45"
            @select="emit('select', o.key)"
          >
            {{ o.label }}
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenuPortal>
  </DropdownMenuRoot>
</template>
