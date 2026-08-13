<script setup lang="ts">
/**
 * 고른 실험의 속 (architecture.md §8.13).
 *
 * 위에서부터 — 바뀐 것 · 분할을 껐다는 사실 · 점수 표 · 고른 run의 속 · 실패한 run들.
 *
 * **표를 정렬하지 않는다. 담은 순서 그대로다.** 정렬은 비교를 순위로 바꾸는 장치이고
 * 이 화면이 하려는 일은 그 반대다. 대신 **지표별 최고값만 굵게** 한다.
 */

import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import AppTable from '@/components/AppTable.vue'
import TermPopover from '@/components/TermPopover.vue'
import { useFormat } from '@/composables/useFormat'
import { errorMessageKey, type ClientErrorCode } from '@/errors'
import { describeChanges } from '@/ml/changes'
import { metricsOf, type MetricDisplay } from '@/ml/metrics'
import type { Dataset, Preprocessor } from '@/ml/preprocess'
import { bestByMetric, doneRuns, failedRuns, whereTrainedKeyOf } from '@/ml/results'
import type { DataType, Experiment, Run } from '@/project/schema'
import ChangeList from './ChangeList.vue'
import RunDetail from './RunDetail.vue'

const props = defineProps<{
  experiment: Experiment
  /** 몇 번째 학습인지. 파일 순서에서 매긴다 (`results/ExperimentList.vue`와 같은 번호). */
  order: number
  /** 파일에서 이 실험 바로 앞의 것. 첫 실험이면 없다. */
  previous: Experiment | undefined
  /**
   * 이 프로젝트의 데이터 종류. 상세 패널 등록부가 이 축을 본다 (`ml/metric-panels.ts`).
   *
   * **manifest에서 온다. taskType처럼 스냅샷일 필요가 없다.**
   *
   * taskType이 실험 스냅샷에 들어간 이유는 **학생이 그것을 바꿔도 옛 실험이 남기**
   * 때문이다(schema.ts의 experimentSettings 주석). dataType에는 그 조건이 성립하지
   * 않는다 — 프로젝트를 만들 때 한 번 정해지고 아무도 안 고치며, 데이터를 갈아 끼우면
   * **그 순간 실험을 통째로 버린다**(project/dataset.ts, mlpx-spec.md §4.3). 그러므로
   * manifest의 현재 값과 남아 있는 실험이 어긋날 경로가 없다.
   */
  dataType: DataType
  /**
   * 아래 셋은 **상세 패널의 재료**다 (`ml/metric-panels.ts`의 `PanelInput`). 이 화면은
   * 쓰지 않고 `RunDetail`로 넘기기만 한다 — 파일에서 꺼내는 일은 스토어를 아는
   * `ResultsView`의 몫이고, 그 아래는 받은 것을 나르기만 한다.
   */
  dataset: Dataset | null
  preprocessor: Preprocessor | null
  /** 모델 경로 → 바이트. 어느 run의 것을 꺼낼지는 여기서 정해진다 (`openedModelBytes`). */
  models: ReadonlyMap<string, Uint8Array>
}>()

const { t, te } = useI18n()
const format = useFormat()

const displays = computed(() => metricsOf(props.experiment.settings.taskType))

/**
 * 지표의 수식 조각. **없는 지표는 빈 문자열이라 수식이 안 그려진다** (`TermPopover`).
 *
 * 회귀 지표(R²·RMSE·MAE)는 수식이 한 줄에 안 들어가서 안 넣었다 - 분수 하나로 못 쓰는
 * 것을 억지로 접으면 오히려 못 읽는다.
 */
function formulaOf(display: MetricDisplay, part: 'top' | 'bottom'): string {
  const key = `metricFormula.${display.label ?? display.name}.${part}`
  return te(key) ? t(key) : ''
}
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

/**
 * 표 아래로 접힌 속. 표를 정렬 없이 두는 것과 같은 이유로 표 안에서 안 펼치지만
 * (architecture.md §8.13), 표가 길면 학생이 클릭해도 아래가 화면 밖이라 바뀐 걸 못
 * 본다. 그래서 줄을 고르면 여기로 스스로 스크롤한다.
 */
const runDetailEl = ref<HTMLElement | null>(null)

function pickRun(runId: string): void {
  openedRun.value = runId
  void nextTick(() => {
    runDetailEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  })
}

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

/**
 * 펼친 run의 모델 바이트. **담기지 않았으면 없다** (`run.modelOmitted`, mlpx-spec.md §4.2).
 *
 * 파싱하지 않고 바이트 그대로 넘긴다 — 모델 JSON을 읽는 것은 그것을 쓰는 패널의 일이고,
 * 그 패널은 지연 로딩이라 **분류만 보는 학생은 모델을 파싱하지 않는다.**
 */
const openedModelBytes = computed<Uint8Array | undefined>(() => {
  const path = opened.value?.model?.path
  return path === undefined ? undefined : props.models.get(path)
})

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
    <h3 class="font-bold text-ink-soft">
      {{ t('results.experimentName', { index: props.order }) }}
    </h3>

    <!-- 바뀐 것. 첫 실험에는 직전이 없고, 아무것도 안 바꾼 재학습도 있다. -->
    <section class="flex flex-col gap-1.5">
      <h3 class="font-bold text-ink-soft">{{ t('results.changeTitle') }}</h3>
      <!--
        **줄 전체가 문구인 것도 배지다** (§8.13). 그 자리에 있는 것이 값이 아니라 상태의
        이름이라, plaintext로 두면 그것만 "바뀐 값"처럼 읽힌다. `self-start`인 이유는
        알약이 줄 전체로 늘어나면 배지가 아니라 띠가 되기 때문이다.
      -->
      <AppBadge v-if="!props.previous" class="self-start">{{ t('results.firstRun') }}</AppBadge>
      <AppBadge v-else-if="changes.length === 0" class="self-start">
        {{ t('results.noChange') }}
      </AppBadge>
      <ChangeList v-else :changes="changes" />
    </section>

    <section v-if="succeeded.length > 0" class="flex min-w-0 flex-col gap-1.5">
      <h3 class="font-bold text-ink-soft">{{ t('results.scoreTitle') }}</h3>
      <!--
        **안내는 제목 바로 아래다.** 표를 지나 아래에 두면 눌러도 된다는 것을 표를
        다 읽은 뒤에야 알게 된다.
      -->
      <p class="text-ink-faint">{{ t('results.detailLead') }}</p>
      <AppTable>
        <thead>
          <tr>
            <th>{{ t('results.model') }}</th>
            <th>{{ t('results.where') }}</th>
            <!--
              **머리글을 눌러 설명을 연다** (§8.13). 키는 등록부가 준 이름으로 만든다 -
              지표가 늘면 로케일에 두 줄(이름·설명)을 더하는 것으로 끝난다.
            -->
            <th v-for="display in displays" :key="display.name">
              <TermPopover
                :title="t(`metrics.${display.label ?? display.name}`)"
                :body="t(`metricHelp.${display.label ?? display.name}`)"
                :numerator="formulaOf(display, 'top')"
                :denominator="formulaOf(display, 'bottom')"
              />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="run in succeeded"
            :key="run.id"
            class="cursor-pointer"
            :class="run.id === openedRun ? 'bg-brand-soft' : ''"
            @click="pickRun(run.id)"
          >
            <th class="text-left">{{ t(`algorithms.${run.algorithm}`) }}</th>
            <td>{{ t(whereTrainedKeyOf(run)) }}</td>
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
    </section>

    <section v-else class="flex flex-col gap-1.5">
      <p class="font-bold">{{ t('results.noSuccess') }}</p>
      <p class="text-ink-soft">{{ t('results.noSuccessNext') }}</p>
    </section>

    <!--
      **`scroll-mt-*`로 여백을 남긴다.** `scrollIntoView`는 목표를 화면 맨 위에 딱
      붙여 놓아서, 도착한 자리가 무엇의 시작인지 위쪽 맥락이 하나도 안 보인다.
      JS에 오프셋을 계산해 넣지 않는 이유는 그 값이 화면마다 갈리기 때문이다.

      **값은 블록을 쌓는 `gap-5`와 같다.** 스크롤이 멎은 자리가 위 블록과 벌어진 만큼만
      벌어져서, 도착한 화면이 평소의 세로 리듬 그대로 보인다.
    -->
    <div v-if="opened" ref="runDetailEl" class="scroll-mt-5">
      <RunDetail
        :run="opened"
        :experiment="props.experiment"
        :data-type="props.dataType"
        :task-type="props.experiment.settings.taskType"
        :dataset="props.dataset"
        :preprocessor="props.preprocessor"
        :model-bytes="openedModelBytes"
      />
    </div>

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
