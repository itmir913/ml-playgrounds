<script setup lang="ts">
/**
 * 그림 넷이 함께 쓰는 틀 — 캔버스 자리, 못 그릴 때의 말, 그리고 **그림 아래 한 줄**.
 *
 * **넷이 같은 자리에서 같은 문법으로 말하게 하는 것이 이 부품의 일이다.** 결측이 몇
 * 행인지, 표본을 뽑았는지, 구간을 줄였는지는 전부 *"네가 보는 것이 데이터 전부가
 * 아니다"*라는 같은 종류의 말이고, 그것이 그림마다 다른 자리에 다른 모양으로 뜨면
 * 학생은 그중 하나를 안 읽는다 (`StepActionBar`를 넷이 함께 쓰는 것과 같은 판단).
 *
 * **높이를 여기서 박는다.** 캔버스는 부모의 높이를 받아야 하는데, 그림마다 정하면
 * 창 안에서 도구를 바꿀 때 그림의 크기가 널뛴다.
 */

import AppEmpty from '@/components/AppEmpty.vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  /** 그릴 것이 없는 이유. 비어 있으면 그린다. */
  empty: string
  /** 그림에 안 들어간 빈 칸의 행 수. */
  missing: number
  /** 그림마다 다른 한 줄(표본·구간 줄임). 없으면 빈 문자열이다. */
  note: string
}>()

const { t } = useI18n()
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <div v-if="props.empty" class="grid min-h-64 flex-1 place-items-center">
      <AppEmpty :reason="props.empty" :next="t('data.charts.noValuesNext')" />
    </div>

    <!--
      **높이를 박지 않고 남은 자리를 받는다** (2026-09-22). 창이 화면의 95%가 되면서
      캔버스가 고정 높이로 남으면 **그 아래가 통째로 빈다.** 바닥값(`min-h-64`)은
      낮은 화면에서 캔버스가 0으로 눌리는 것을 막는다 (§8.14와 같은 사정).
    -->
    <div v-else class="min-h-64 min-w-0 flex-1">
      <slot />
    </div>

    <!--
      **본 것과 못 본 것을 그림 바로 아래에서 말한다.** 조용히 빼고 그리면 학생은
      자기 데이터가 다 거기 있다고 믿는다.
    -->
    <p v-if="!props.empty && (props.missing > 0 || props.note)" class="shrink-0 text-ink-faint">
      <span v-if="props.missing > 0">{{ t('data.charts.missing', props.missing) }}</span>
      <span v-if="props.missing > 0 && props.note"> · </span>
      <span v-if="props.note">{{ props.note }}</span>
    </p>
  </div>
</template>
