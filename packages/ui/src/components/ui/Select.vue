<script setup lang="ts">
import { SelectRoot, SelectTrigger, SelectValue, SelectPortal, SelectContent, SelectViewport, SelectItem, SelectItemText, SelectItemIndicator } from 'reka-ui';
import { cn } from '../../lib/utils';

/** shadcn 风格 Select（reka-ui 封装）：v-model:value，options 支持分组 {type:'group',label,children}
 *  注意：选项 value 不能为空字符串——reka-ui 保留空串表示「清空选择→显示 placeholder」，
 *  传入会在 SelectItem 内直接抛错。需要「全部/不限」这类选项时请用非空哨兵值（如 '__all__'）。 */
export interface SelectOption { label: string; value: string | number; disabled?: boolean }
export interface SelectGroup { type: 'group'; label: string; children: SelectOption[] }
interface Props {
  options?: (SelectOption | SelectGroup)[];
  placeholder?: string;
  disabled?: boolean;
}
const props = defineProps<Props>();
const value = defineModel<string | number>('value');

function isGroup(o: SelectOption | SelectGroup): o is SelectGroup {
  return (o as SelectGroup).type === 'group';
}
</script>

<template>
  <SelectRoot v-model="value as string" :disabled="disabled">
    <SelectTrigger
      :class="cn(
        'inline-flex h-8 min-w-0 items-center justify-between gap-1.5 rounded-full border border-input bg-card px-3.5 text-[13px] text-foreground',
        'transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        'disabled:opacity-50', $attrs.class ?? '',
      )"
    >
      <SelectValue :placeholder="placeholder ?? '请选择'" class="truncate" />
      <svg viewBox="0 0 24 24" width="12" height="12" class="flex-shrink-0 text-muted-foreground"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </SelectTrigger>
    <SelectPortal>
      <SelectContent
        position="popper" :side-offset="6"
        class="z-[150] max-h-[320px] min-w-[var(--reka-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-card shadow-lg"
      >
        <SelectViewport class="p-1.5">
          <template v-for="(o, i) in props.options ?? []" :key="i">
            <div v-if="isGroup(o)" class="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">{{ o.label }}</div>
            <template v-else>
              <SelectItem
                :value="String(o.value)" :disabled="o.disabled"
                class="relative flex cursor-pointer select-none items-center rounded-lg py-1.5 pl-8 pr-3 text-[13px] text-foreground outline-none data-[highlighted]:bg-muted data-[state=checked]:font-semibold"
              >
                <SelectItemText>{{ o.label }}</SelectItemText>
                <SelectItemIndicator class="absolute left-2.5 inline-flex">
                  <svg viewBox="0 0 24 24" width="13" height="13" class="text-primary"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </SelectItemIndicator>
              </SelectItem>
            </template>
            <template v-if="isGroup(o)">
              <SelectItem
                v-for="c in o.children" :key="String(c.value)" :value="String(c.value)" :disabled="c.disabled"
                class="relative flex cursor-pointer select-none items-center rounded-lg py-1.5 pl-8 pr-3 text-[13px] text-foreground outline-none data-[highlighted]:bg-muted data-[state=checked]:font-semibold"
              >
                <SelectItemText>{{ c.label }}</SelectItemText>
                <SelectItemIndicator class="absolute left-2.5 inline-flex">
                  <svg viewBox="0 0 24 24" width="13" height="13" class="text-primary"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </SelectItemIndicator>
              </SelectItem>
            </template>
          </template>
          <div v-if="!props.options?.length" class="px-3 py-6 text-center text-xs text-muted-foreground">暂无选项</div>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
