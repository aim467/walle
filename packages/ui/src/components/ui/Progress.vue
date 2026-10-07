<script setup lang="ts">
import { cn } from '../../lib/utils';

/** shadcn 风格 Progress（替代 NProgress type=line）：条形进度，on=false 时显示空槽 */
interface Props { percentage: number; on?: boolean }
const props = withDefaults(defineProps<Props>(), { on: true });
</script>

<template>
  <div class="h-[7px] w-full overflow-hidden rounded-full" :class="props.on ? 'bg-primary/15' : 'bg-muted'" role="progressbar" :aria-valuenow="props.percentage">
    <div
      :class="cn('h-full rounded-full transition-all', props.on ? 'bg-[#4c91ef] dark:bg-primary' : '')"
      :style="{ width: Math.max(0, Math.min(100, props.percentage)) + '%' }"
    />
  </div>
</template>
