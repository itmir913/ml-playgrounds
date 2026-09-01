<script setup lang="ts">
/**
 * 파일에 담긴 양 (architecture.md §8.18, mlpx-spec.md §8.6.1).
 *
 * **늘 보인다.** "어느 선을 넘으면 보인다"의 그 선이 곧 근거 없는 임계값이고, 사진을
 * 붙이는 화면에서 남은 양은 상시 정보다. 상한이 있는데 남은 양을 볼 자리가 없으면
 * 학생은 **글을 치다가 갑자기 거절당하는 것으로** 그 상한을 처음 만난다.
 *
 * **막대와 숫자를 함께 준다.** 막대만으로는 얼마나 남았는지 모르고, 숫자만으로는 5MB가
 * 큰지 작은지 모른다. 색이 바뀌는 지점은 하나뿐이다 - **상한을 실제로 넘은 때**다.
 * 그건 임계값이 아니라 사실이다.
 *
 * 너비는 값이라 class가 아니라 style이다 (`TrainView`의 진행 막대와 같은 모양).
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { BYTES_PER_MB } from '@/limits'

const props = defineProps<{
  /** 지금 담긴 바이트. */
  used: number
  /** 담을 수 있는 바이트. */
  limit: number
}>()

const { t } = useI18n()

/**
 * 소수 한 자리. 0.0MB에서 5.0MB 사이를 말하는 자리라 정수로는 거의 안 움직인다.
 *
 * **넘긴 값은 올린다.** 5.04MB에서 색과 막대는 넘겼다고 하는데 숫자는 `5.0 / 5.0`이라
 * 화면이 스스로와 어긋났다 (V11 R5 C-5). 자릿수를 늘리는 것은 답이 아니다 — 위 주석의
 * 이유가 그대로 살아 있다.
 */
function mb(bytes: number, roundUp = false): string {
  const value = bytes / BYTES_PER_MB
  return (roundUp ? Math.ceil(value * 10) / 10 : value).toFixed(1)
}

const over = computed(() => props.used > props.limit)
const width = computed(() => `${Math.min(100, (props.used / props.limit) * 100).toFixed(2)}%`)

/**
 * **상한을 껐으면 상한을 말하지 않는다** (`limits-switch.ts`). `Infinity`를 그대로 넣으면
 * 이 자리가 `0.3MB / InfinityMB`가 된다 — 막대는 0%로 멀쩡해 보이고 글자만 틀린다.
 *
 * **막대는 그대로 둔다.** 담긴 양을 보여주는 것이 이 부품의 일이고, 그건 상한이 없어도
 * 볼 거리다 (`architecture.md` §8.18) — 다만 채울 선이 없으니 늘 비어 있다.
 */
const label = computed(() =>
  Number.isFinite(props.limit)
    ? t('portfolio.size', { used: mb(props.used, over.value), limit: mb(props.limit) })
    : t('portfolio.sizeOpen', { used: mb(props.used) }),
)
</script>

<template>
  <div class="flex items-center gap-2">
    <div
      class="h-2 w-16 overflow-hidden rounded-pill bg-surface-sunken"
      role="progressbar"
      :aria-valuenow="props.used"
      aria-valuemin="0"
      :aria-valuemax="Number.isFinite(props.limit) ? props.limit : undefined"
      :aria-label="label"
    >
      <div
        class="h-full rounded-pill transition-all"
        :class="over ? 'bg-danger' : 'bg-brand'"
        :style="{ width }"
      />
    </div>

    <span class="tabular-nums" :class="over ? 'text-danger' : 'text-ink-soft'">{{ label }}</span>
  </div>
</template>
