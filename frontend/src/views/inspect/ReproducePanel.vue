<script setup lang="ts">
/**
 * **대조 판** — 파일에 적힌 숫자가 그 설정에서 실제로 나오는가 (mlpx-spec.md §7.1).
 *
 * 해시는 "만들어진 뒤에 바뀌었는가"만 답한다. 학생이 **학습 전에** `runs.json`을 고치고
 * 저장했으면 해시는 멀쩡하다 — 그 주장을 검사하는 유일한 층이 여기다.
 *
 * **재실행은 저장하지 않는 학습이다** (open-decisions.md "재실행은 학습 경로를 그대로
 * 탄다"). 이 판은 학습이 쓰는 그 워커에 같은 요청을 보내고, 돌아온 실험을 파일의 것과
 * **견주기만** 한다 — 여기에 계산이 없다.
 *
 * **워커에서 도는 이유는 시간이다.** 신경망 50,000행이 개발 PC에서 88.7초이고 학교 PC는
 * 더 느리다. 메인 스레드에서 돌리면 그동안 교사의 탭이 멈추고 취소 손잡이도 함께 죽는다.
 *
 * **취소는 끝난 것을 남긴다** (같은 결정문). run 하나가 끝날 때마다 판정이 도착하므로,
 * 넷 중 셋이 끝난 뒤 멈춰도 그 셋은 화면에 남는다.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppTable from '@/components/AppTable.vue'
import { useWork } from '@/composables/useWork'
import { errorMessageKey, isClientError, type ClientErrorCode } from '@/errors'
import {
  compareExperiments,
  reproduceBlockers,
  reproduceInputOf,
  type Reproduction,
} from '@/ml/reproduce'
import { train } from '@/ml/worker/client'
import { spawnTrainingWorker } from '@/ml/worker/spawn'
import type { Dataset } from '@/ml/preprocess'
import type { DataType, Experiment } from '@/project/schema'

const props = defineProps<{
  experiment: Experiment
  dataType: DataType
  dataset: Dataset | null
  testDataset: Dataset | null
}>()

const { t } = useI18n()
const work = useWork()

/** 지금까지 도착한 판정. **취소해도 남는 것이 이것이다.** */
const found = ref<readonly Reproduction[]>([])
/** 대조가 통째로 실패한 사유. run 하나의 실패는 그 줄이 말한다. */
const failure = ref<ClientErrorCode | null>(null)

/** 무엇이 대조를 막는가. **boolean이 아니라 이유 목록이다** (CLAUDE.md §2). */
const blockers = computed(() =>
  reproduceBlockers({
    experiment: props.experiment,
    dataType: props.dataType,
    hasDataset: props.dataset !== null,
    hasTestDataset: props.testDataset !== null,
  }),
)

/**
 * 단추를 잠그는 것 전부. **이름 붙은 값 하나로 합친다** — 템플릿에서 조건을 조립하면
 * `ui-rules.spec.ts`가 잡고, 무엇보다 학생이든 교사든 **왜 못 누르는지 모르게 된다.**
 */
const cannotStart = computed(() => work.busy.value || blockers.value.length > 0)

/** 견줄 주장의 수. 진행을 셀 분모다. */
const claims = computed(() => props.experiment.runs.filter((run) => run.status === 'done').length)

async function reproduce(): Promise<void> {
  if (cannotStart.value || !props.dataset) return
  found.value = []
  failure.value = null

  const job = work.start()
  const request = {
    type: 'train' as const,
    input: reproduceInputOf({
      experiment: props.experiment,
      dataset: props.dataset,
      testDataset: props.testDataset,
      dataType: props.dataType,
    }),
  }

  const handle = train(request, { createWorker: spawnTrainingWorker })
  job.hold(handle)
  try {
    const { experiment } = await handle.result
    // **떠난 화면에는 안 앉힌다** (`useWork`의 `alive`). 교사가 다른 제출물로 옮겼는데
    // 앞 파일의 판정이 뒤늦게 이 자리에 앉으면 **무고한 학생에게 붙는다.**
    if (work.alive()) found.value = compareExperiments(props.experiment, experiment)
  } catch (error) {
    // **취소도 여기로 온다** (`JOB_CANCELLED`). 그때까지 온 것은 그대로 둔다.
    if (work.alive()) failure.value = isClientError(error) ? error.code : 'JOB_FAILED'
  } finally {
    job.done()
  }
}

/**
 * 차이를 **크기가 보이는 글자로** 쓴다 (open-decisions.md "재현 판정은 (알고리즘 × 엔진)이
 * 정하고, 못 가르는 자리는 교사에게 넘긴다").
 *
 * **반올림하면 화면이 자기모순이 된다** — 정직한 교차 브라우저 차이 1e-12가 `0.0000`으로
 * 서고 그 옆에 `판정하지 않음`이 붙는다.
 */
function deltaText(deltas: Readonly<Record<string, number>> | undefined): string {
  const differing = Object.entries(deltas ?? {}).filter(([, value]) => value !== 0)
  if (differing.length === 0) return ''
  // **한 문장은 한 키다** (CLAUDE.md §3의 규칙 3). 지표 이름과 숫자를 손으로 이어 붙이면 어순이
  // 다른 언어에서 무너지므로, 보간은 로케일 문장이 한다.
  return differing
    .map(([name, value]) =>
      t('inspect.delta', { metric: t(`metrics.${name}`), value: signed(value) }),
    )
    .join(' · ')
}

/** 부호를 붙인 차이. **크기가 보이는 형식이다** — 반올림하면 `0.0000`이 된다. */
function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toExponential(2)}`
}

/** 못 돌린 사유. 파일이 아니라 **이 기기**의 사정이다. */
function failureText(reproduction: Reproduction): string {
  const code = reproduction.failure?.code
  return code === undefined ? '' : t(errorMessageKey(code as ClientErrorCode))
}
</script>

<template>
  <section class="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4">
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h4 class="font-bold">{{ t('inspect.reproduce') }}</h4>
      <AppButton :disabled="cannotStart" :action="reproduce">
        {{ t('inspect.reproduceStart') }}
      </AppButton>
    </div>

    <p class="text-ink-soft">{{ t('inspect.reproduceLead') }}</p>

    <!--
      **잠긴 이유를 전부 말한다** (architecture.md §10). 이유 없이 회색인 단추는 고장으로
      보이고, 하나만 말하면 그 하나가 틀릴 수 있다.
    -->
    <ul v-if="blockers.length > 0" class="flex flex-col gap-1 text-ink-soft">
      <li v-for="blocker in blockers" :key="blocker">{{ t(`inspect.blocked.${blocker}`) }}</li>
    </ul>

    <p v-if="work.busy.value" class="text-ink-soft">
      {{ t('inspect.reproducing', { done: found.length, total: claims }) }}
    </p>

    <p v-if="failure" class="text-caution">{{ t(errorMessageKey(failure)) }}</p>

    <AppTable v-if="found.length > 0">
      <thead>
        <tr>
          <th scope="col" class="w-full">{{ t('results.model') }}</th>
          <th scope="col">{{ t('inspect.verdict') }}</th>
          <th scope="col">{{ t('inspect.difference') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="one in found" :key="one.runId">
          <td class="break-words">{{ t(`algorithms.${one.algorithm}`) }}</td>
          <td class="whitespace-nowrap">{{ t(`reproduction.${one.status}`) }}</td>
          <!--
            **뒤집힌 줄 수가 여기 선다.** 분류 지표의 눈금은 `1/시험 행 수`라 한 칸 올린
            변조와 한 행 뒤집힌 엔진 차이의 크기가 같다 — 차이만으로는 그 둘을 못 가르고,
            혼동 행렬이 가른다.
          -->
          <td class="break-words">
            <span v-if="one.flipped" class="mr-2">
              {{ t('inspect.flipped', { count: one.flipped }) }}
            </span>
            {{ failureText(one) || deltaText(one.deltas) }}
          </td>
        </tr>
      </tbody>
    </AppTable>
  </section>
</template>
