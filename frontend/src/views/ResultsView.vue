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

import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppEmpty from '@/components/AppEmpty.vue'
import StepHeader from '@/components/StepHeader.vue'
import { useProjectStore } from '@/stores/project'
import ExperimentDetail from './results/ExperimentDetail.vue'
import ExperimentList from './results/ExperimentList.vue'

const { t } = useI18n()
const project = useProjectStore()

const experiments = computed(() => project.file?.document.runs.experiments ?? [])

/**
 * 상세 패널 등록부가 보는 축 (`ml/metric-panels.ts`).
 *
 * 파일이 아직 없을 때 'tabular'로 두는 것은 화면이 그때 실험 목록 자리에 빈 상태를
 * 보여주기 때문이다 - 패널까지 내려가지 않는다.
 */
const dataType = computed(() => project.file?.document.manifest.dataType ?? 'tabular')

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

/**
 * 오른쪽 속의 DOM. **세로줄에서 실험을 고르면 여기로 스스로 스크롤한다** (§8.13).
 *
 * 좁은 화면에서는 두 열이 위아래로 접히므로 고른 결과가 화면 밖이고, 눌렀는데 아무 일도
 * 안 일어난 것처럼 보인다. `ExperimentDetail`이 모델 줄을 고를 때 하는 것과 같은 모양이다.
 */
const detailEl = ref<HTMLElement | null>(null)

function pick(id: string): void {
  selected.value = id
  // 고른 실험이 그려진 뒤라야 그 높이로 스크롤한다.
  void nextTick(() => {
    detailEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

const index = computed(() =>
  experiments.value.findIndex((experiment) => experiment.id === selected.value),
)
const current = computed(() => experiments.value[index.value])
const previous = computed(() => (index.value > 0 ? experiments.value[index.value - 1] : undefined))
</script>

<template>
  <!-- `min-h-full`인 이유는 `views/data/TabularPanel.vue`에 적어 두었다. -->
  <div class="flex min-h-full flex-col gap-5 p-4 sm:p-5">
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

    <div v-else class="flex min-h-96 flex-1 flex-col gap-5 md:flex-row">
      <div class="min-h-0 shrink-0 overflow-y-auto md:w-80">
        <ExperimentList :experiments="experiments" :selected="selected" @pick="pick" />
      </div>

      <div class="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <!--
          **스크롤 대상은 이 안쪽이지 바깥 상자가 아니다.** 바깥(`overflow-y-auto`)에
          `scrollIntoView`를 걸면 그 상자를 화면 안으로 들이기만 하고 **상자 안의 스크롤은
          내려간 그대로**라, 실험을 바꿔도 중간부터 보인다. 안쪽 머리를 가리키면 한 번에
          둘 다 맞는다 - 좁은 화면에서는 상자가 화면에 들어오고, 넓은 화면에서는 상자
          안이 맨 위로 올라간다.
        -->
        <div ref="detailEl">
          <ExperimentDetail
            v-if="current"
            :experiment="current"
            :order="index + 1"
            :previous="previous"
            :data-type="dataType"
          />
        </div>
      </div>
    </div>
  </div>
</template>
