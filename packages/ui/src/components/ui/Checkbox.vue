<script setup lang="ts">
import { CheckboxRoot, CheckboxIndicator } from 'reka-ui';

/** shadcn 风格 Checkbox（reka-ui 封装）：checked 单选态；数组多选由父层组合 */
const checked = defineModel<boolean>('checked');
</script>

<template>
  <CheckboxRoot
    v-model:checked="checked"
    class="inline-flex size-[15px] flex-shrink-0 items-center justify-center rounded-[4px] border border-input bg-card transition-colors hover:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=checked]:border-primary data-[state=checked]:bg-primary"
  >
    <CheckboxIndicator>
      <svg viewBox="0 0 24 24" width="11" height="11" class="text-primary-foreground"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
