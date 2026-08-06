<script setup lang="ts">
/**
 * results 단계. **순위표가 아니라 변경 이력이다** (architecture.md §8.9, §8.13).
 *
 * 왼쪽이 실험 목록, 오른쪽이 고른 실험의 속이다. 왼쪽이 지금 하는 일이고 오른쪽이
 * 그 판단의 맥락이다 (§8.10.1).
 *
 * **직전 실험은 파일 순서에서 나온다.** `experiment.changed`가 학습 시점에 견준 상대가
 * 바로 앞 실험이므로, 화면이 다른 짝을 고르면 경로와 값이 어긋난다.
 */

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppEmpty from '@/components/AppEmpty.vue'
import StepHeader from '@/components/StepHeader.vue'
import { useProjectStore } from '@/stores/project'
import ExperimentDetail from './results/ExperimentDetail.vue'
import ExperimentList from './results/ExperimentList.vue'

const { t } = useI18n()
const project = useProjectStore()

const experiments = computed(() => project.file?.document.runs.experiments ?? [])

/** 고른 실험. 들어오면 가장 최근 것부터 본다 — 방금 학습한 것이 그것이다. */
const selected = ref<string | null>(null)

watch(
  experiments,
  (list) => {
    const exists = list.some((experiment) => experiment.id === selected.value)
    if (!exists) selected.value = list[list.length - 1]?.id ?? null
  },
  { immediate: true },
)

const index = computed(() =>
  experiments.value.findIndex((experiment) => experiment.id === selected.value),
)
const current = computed(() => experiments.value[index.value])
const previous = computed(() => (index.value > 0 ? experiments.value[index.value - 1] : undefined))
</script>

<template>
  <div class="flex h-full flex-col gap-5 p-4 sm:p-5">
    <StepHeader :title="t('steps.results.label')" :purpose="t('steps.results.purpose')">
      <template v-if="experiments.length > 0" #context>
        <div class="flex gap-1.5">
          <dt class="sr-only">{{ t('results.experimentTitle') }}</dt>
          <dd class="font-bold tabular-nums text-ink">
            {{ t('results.experimentCount', experiments.length) }}
          </dd>
        </div>
      </template>
    </StepHeader>

    <!--
      **레일이 이미 잠그지만 빈 상태는 여전히 필요하다** — 남의 파일을 열면 학습 기록이
      없는 채로 여기 도달할 수 있다. 왜 비었는지와 무엇을 하면 열리는지를 함께 준다 (§8.9).
    -->
    <div v-if="experiments.length === 0" class="grid min-h-0 flex-1 place-items-center">
      <AppEmpty :reason="t('results.emptyReason')" :next="t('results.emptyNext')" />
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col gap-5 md:flex-row">
      <div class="min-h-0 shrink-0 overflow-y-auto md:w-80">
        <ExperimentList :experiments="experiments" :selected="selected" @pick="selected = $event" />
      </div>

      <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <ExperimentDetail v-if="current" :experiment="current" :previous="previous" />
      </div>
    </div>
  </div>
</template>
