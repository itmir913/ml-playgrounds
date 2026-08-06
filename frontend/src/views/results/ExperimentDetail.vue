<script setup lang="ts">
/**
 * 고른 실험의 속 (architecture.md §8.13).
 *
 * 위에서부터 — 바뀐 것 · 분할을 껐다는 사실 · 점수 표 · 고른 run의 속 · 실패한 run들.
 *
 * **표를 정렬하지 않는다. 담은 순서 그대로다.** 정렬은 비교를 순위로 바꾸는 장치이고
 * 이 화면이 하려는 일은 그 반대다. 대신 **지표별 최고값만 굵게** 한다.
 */

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppTable from '@/components/AppTable.vue'
import { useFormat } from '@/composables/useFormat'
import { errorMessageKey, type ClientErrorCode } from '@/errors'
import { describeChanges } from '@/ml/changes'
import { metricsOf } from '@/ml/metrics'
import { bestByMetric, doneRuns, failedRuns } from '@/ml/results'
import type { Experiment, Run } from '@/project/schema'
import ChangeList from './ChangeList.vue'
import RunDetail from './RunDetail.vue'

const props = defineProps<{
  experiment: Experiment
  /** 파일에서 이 실험 바로 앞의 것. 첫 실험이면 없다. */
  previous: Experiment | undefined
}>()

const { t } = useI18n()
const format = useFormat()

const displays = computed(() => metricsOf(props.experiment.settings.taskType))
const succeeded = computed(() => doneRuns(props.experiment))
const failed = computed(() => failedRuns(props.experiment))
const best = computed(() => bestByMetric(succeeded.value, displays.value))

/**
 * 바뀐 것들. **경로는 파일에 적힌 것을 쓰고 값만 두 실험에서 읽는다** — 우리가 다시
 * 계산하면 파일과 화면이 다른 말을 하게 된다.
 */
const changes = computed(() => {
  const previous = props.previous
  const paths = props.experiment.changed
  if (!previous || !paths) return []
  return describeChanges(previous, props.experiment, paths)
})

/** 속을 펼쳐 볼 run. 실험을 옮기면 그 실험의 첫 줄로 돌아간다. */
const openedRun = ref<string | null>(null)

watch(
  () => props.experiment.id,
  () => {
    openedRun.value = succeeded.value[0]?.id ?? null
  },
  { immediate: true },
)

const opened = computed<Run | undefined>(() =>
  succeeded.value.find((run) => run.id === openedRun.value),
)

/** 이 칸이 지금 실험에서 가장 좋은 값인가. 견줄 것이 없으면 아무것도 굵지 않다. */
function isBest(run: Run, metric: string): boolean {
  const value = run.metrics?.[metric]
  return value !== undefined && best.value.get(metric) === value
}

function metricText(run: Run, metric: string, format_: 'percent' | 'number'): string {
  const value = run.metrics?.[metric]
  return value === undefined ? t('meta.none') : format.metric(value, format_)
}

/**
 * 실패 사유의 문장.
 *
 * **키를 손으로 짓지 않는다.** 백엔드 코드는 `errors.*`이고 우리 코드는 `client.*`이라
 * 어느 쪽인지 아는 것은 `errorMessageKey` 하나다 — 여기서 `client.`을 박으면 백엔드에서
 * 온 사유가 통째로 키 문자열로 뜬다.
 */
function failureText(run: Run): string {
  const failure = run.failure
  if (!failure) return ''
  return t(errorMessageKey(failure.code as ClientErrorCode), { ...failure.params })
}

/** 라이브러리 원문. 우리 어휘가 아니라 번역하지 않고 따로 붙인다 (copy.md §5). */
function failureDetailOf(run: Run): string | null {
  const detail = run.failure?.params?.['detail']
  return typeof detail === 'string' && detail !== '' ? detail : null
}
</script>

<template>
  <div class="flex flex-col gap-5">
    <!-- 바뀐 것. 첫 실험에는 직전이 없고, 아무것도 안 바꾼 재학습도 있다. -->
    <section class="flex flex-col gap-1.5">
      <h3 class="font-bold text-ink-soft">{{ t('results.changeTitle') }}</h3>
      <p v-if="!props.previous" class="text-ink-soft">{{ t('results.firstRun') }}</p>
      <p v-else-if="changes.length === 0" class="text-ink-soft">{{ t('results.noChange') }}</p>
      <ChangeList v-else :changes="changes" />
    </section>

    <!--
      **분할을 껐다는 사실은 표 위에 둔다.** 표 전체에 걸리는 말이라 줄마다 배지를
      붙이면 같은 문장이 모델 수만큼 반복된다.
    -->
    <p
      v-if="props.experiment.settings.split.method === 'none'"
      class="rounded-panel border border-caution/30 bg-caution-soft p-3"
    >
      {{ t('results.trainScoreNote') }}
    </p>

    <section v-if="succeeded.length > 0" class="flex min-w-0 flex-col gap-1.5">
      <h3 class="font-bold text-ink-soft">{{ t('results.scoreTitle') }}</h3>
      <AppTable>
        <thead>
          <tr>
            <th>{{ t('results.model') }}</th>
            <th>{{ t('results.where') }}</th>
            <th v-for="display in displays" :key="display.name">
              {{ t(`metrics.${display.name}`) }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="run in succeeded"
            :key="run.id"
            class="cursor-pointer"
            :class="run.id === openedRun ? 'bg-brand-soft' : ''"
            @click="openedRun = run.id"
          >
            <th class="text-left">{{ t(`algorithms.${run.algorithm}`) }}</th>
            <td>{{ t(`execution.${run.computedBy}`) }}</td>
            <td
              v-for="display in displays"
              :key="display.name"
              :class="isBest(run, display.name) ? 'font-bold' : ''"
            >
              {{ metricText(run, display.name, display.format) }}
            </td>
          </tr>
        </tbody>
      </AppTable>
      <p class="text-ink-faint">{{ t('results.detailLead') }}</p>
    </section>

    <section v-else class="flex flex-col gap-1.5">
      <p class="font-bold">{{ t('results.noSuccess') }}</p>
      <p class="text-ink-soft">{{ t('results.noSuccessNext') }}</p>
    </section>

    <RunDetail v-if="opened" :run="opened" />

    <!-- 실패한 모델. 접어 둔다 — 학생이 먼저 볼 것은 나온 점수다. -->
    <details v-if="failed.length > 0" class="rounded-panel border border-line bg-surface">
      <summary class="cursor-pointer px-4 py-2.5 font-bold text-ink-soft">
        {{ t('results.failedTitle', failed.length) }}
      </summary>

      <ul class="flex flex-col gap-3 border-t border-line p-3">
        <li v-for="run in failed" :key="run.id" class="flex flex-col gap-1">
          <span class="font-bold">{{ t(`algorithms.${run.algorithm}`) }}</span>
          <span class="text-ink-soft">{{ failureText(run) }}</span>

          <!--
            **기술 원문은 번역하지 않고 따로 붙인다** (copy.md §5). 주 메시지는 언제나
            우리가 코드로 만든 문장이고, 이건 교사가 읽을 단서다.
          -->
          <details v-if="failureDetailOf(run)" class="text-ink-faint">
            <summary class="cursor-pointer">{{ t('results.failureDetail') }}</summary>
            <p class="mt-1 break-words">{{ failureDetailOf(run) }}</p>
          </details>
        </li>
      </ul>
    </details>
  </div>
</template>
