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
 * 넷 중 셋이 끝난 뒤 멈춰도 그 셋은 화면에 남는다 — `onProgress`가 그 통로다.
 *
 * **한동안 이 문단이 거짓이었다** (2026-09-18 R28 B-2). 판정을 `handle.result` 한 번에
 * 받아 앉히고 있어서 진행 숫자가 `(0/N)`에 붙박여 있었고 멈출 손잡이도 없었는데,
 * **주석만 지금처럼 적혀 있었다.** 이 저장소에서 가장 위험한 입력이 그 모양이다.
 */

import { computed, onBeforeUnmount, onMounted, ref, triggerRef } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppBadge from '@/components/AppBadge.vue'
import { useWork } from '@/composables/useWork'
import { summarizeColumns } from '@/data/columns'
import { errorMessageKey, isClientError, type ClientErrorCode } from '@/errors'
import {
  compareExperiments,
  compareRun,
  reproduceBlockers,
  reproduceInputOf,
  type Reproduction,
} from '@/ml/reproduce'
import { succeeded } from '@/ml/results'
import { factorFrom, readFactor, writeFactor } from '@/ml/calibration'
import { describe as describeEstimate, estimateMs, type Estimate } from '@/ml/estimate'
import { estimatedFeatureWidth } from '@/ml/preprocess'
import { calibrateDevice, train } from '@/ml/worker/client'
import { spawnTrainingWorker } from '@/ml/worker/spawn'
import type { Dataset } from '@/ml/preprocess'
import { DATA_SCHEMAS, type DataType, type Experiment } from '@/project/schema'

const props = defineProps<{
  experiment: Experiment
  /**
   * 몇 번째 실험인가. **이 판이 상세에서 떨어져 나오면서 필요해졌다** (§8.21,
   * 2026-09-18 사용자) — 상세 옆에 붙어 있을 때는 어느 실험의 대조인지를 자리가 말해
   * 줬고, 무결성 아래로 오면서 그것을 판이 들고 가야 한다.
   *
   * **번호는 결과 화면이 매기는 그것이다** (`experimentOrder`) — 교사와 학생이 같은
   * 실험을 다른 번호로 부르면 안 된다.
   */
  order: number
  dataType: DataType
  dataset: Dataset | null
  testDataset: Dataset | null
}>()

const { t } = useI18n()
/**
 * **떠날 때 워커를 끊는다** (`useWork`). 이 판은 학습 워커를 직접 여는데
 * `onBeforeUnmount(retire)`가 없었고, 그래서 **대조가 도는 중에 다른 제출물을 눌러도
 * 워커가 끝까지 돌았다** — 서른 개를 넘기며 누르면 그만큼 쌓인다. 더 조용한 쪽은
 * `alive()`였다: `retire`가 없으면 그 값이 영영 참이라 아래 가드 둘이 **죽은 채로**
 * 초록이었다 (2026-09-18 R28 A-1).
 */
const { busy, start, alive, retire, cancelAll } = useWork()

onBeforeUnmount(retire)

/**
 * **판정은 실험에 붙는다** (2026-09-18, 사용자). 실험 id → 그 실험의 판정들.
 *
 * 이 판은 실험을 바꿔도 **같은 컴포넌트가 그대로 산다.** 값을 칸 하나에 두면 3번째 실험의
 * 판정이 2번째 실험의 자리에 그대로 서서, **다른 실험의 점수를 이 실험의 것으로 읽게
 * 된다** — 이 화면이 가장 하면 안 되는 일이다.
 *
 * **그렇다고 지우지도 않는다.** 3번을 대조하고 2번을 들렀다 3번으로 돌아오면 그 판정이
 * 다시 서야 한다 — 서른 명을 훑는 교사에게 같은 계산을 두 번 시키지 않는다. 파일을 바꾸면
 * 이 판이 통째로 새로 서므로(`InspectView`의 `:key`) 남의 판정이 얹힐 자리는 없다.
 */
const byExperiment = ref(new Map<string, readonly Reproduction[]>())

/** 통째로 실패한 사유도 실험에 붙는다. run 하나의 실패는 그 줄이 말한다. */
const failures = ref(new Map<string, ClientErrorCode>())

/**
 * 지금 대조가 도는 **실험의 id**. 다른 실험을 보고 있으면 그 진행은 여기 안 뜬다.
 *
 * **바쁨도 손잡이도 아니다.** 도는지 여부는 `busy`가, 끊을 것은 `job.hold()`가
 * 갖는다(`useWork`) — 여기 있는 것은 **그 일이 어느 실험의 것인가**이고, 그건 일을
 * 쥔 쪽이 알 수 없는 값이다. 이름에 `running`을 안 쓰는 이유는 `ui-rules.spec.ts`가
 * 그 낱말을 **손잡이 칸의 이름으로** 못 박아 두었기 때문이다.
 */
const comparing = ref<string | null>(null)

/** 지금 실험의 판정들. */
const found = computed<readonly Reproduction[]>(
  () => byExperiment.value.get(props.experiment.id) ?? [],
)

const failure = computed<ClientErrorCode | null>(
  () => failures.value.get(props.experiment.id) ?? null,
)

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
const cannotStart = computed(() => busy.value || blockers.value.length > 0)

/** 견줄 주장의 수. 진행을 셀 분모다. */
const claims = computed(() => props.experiment.runs.filter((run) => run.status === 'done').length)

/**
 * **이 기기가 개발 PC보다 몇 배 느린가** (`ml/calibration.ts`). 학습 화면과 같은 값을
 * 같은 자리에서 읽고 쓴다 — 브라우저당 한 번 재고 `localStorage`에 남는다.
 */
const deviceFactor = ref<number | null>(readFactor())

onMounted(() => {
  if (deviceFactor.value !== null) return
  void calibrateDevice(spawnTrainingWorker).then((elapsed) => {
    const factor = elapsed === null ? null : factorFrom(elapsed)
    if (factor !== null && alive()) {
      deviceFactor.value = factor
      writeFactor(factor)
    }
  })
})

/**
 * 이 실험의 표 설정. **종류를 비교하지 않고 스키마에 묻는다** (architecture.md §9.1) —
 * `if (dataType === 'image')`를 화면에 적으면 종류가 늘 때 고칠 자리가 등록부 하나가
 * 아니라 그 사실을 아는 화면 전부가 된다.
 *
 * 사진 실험이면 `null`이고, 그때 아래 예상은 `알 수 없음`으로 선다 — 사진은 특성 수가
 * 백본이 정해 늘 같아서 이 표가 말할 수 있는 것이 아니다.
 */
const tabularSnapshot = computed(() => {
  const parsed = DATA_SCHEMAS.tabular.snapshot.safeParse(props.experiment.settings.data)
  return parsed.success ? parsed.data : null
})

/**
 * 대조가 얼마나 걸릴까. **누르기 전에 말한다** — 교사가 서른 개를 이어 여는 자리라
 * "지금 눌러도 되는 일인가"가 그 순간의 질문이다 (open-decisions.md "학습 예상 시간은
 * 실측표에 기기 배수를 곱해 낸다").
 *
 * **모르면 지어내지 않는다.** 아직 못 잰 기기, 표가 아닌 프로젝트, 우리가 모르는 기기에서
 * 돈 줄(서버·pyodide)이 그 자리다 — 학습 화면과 같은 규칙이다.
 *
 * **실험 하나가 통째로 도는 시간이다.** 모델은 하나씩 차례로 돌므로 합이 곧 기다림이다.
 */
const estimate = computed<Estimate>(() => {
  const factor = deviceFactor.value
  const data = tabularSnapshot.value
  if (factor === null || !data || !props.dataset) return { kind: 'unknown' }

  const columns = estimatedFeatureWidth(
    summarizeColumns(props.dataset),
    data.features,
    data.preprocessing.categoricalEncoding,
  )
  const rows = props.experiment.settings.trainIndices.length

  let total = 0
  for (const run of props.experiment.runs) {
    if (run.status !== 'done') continue
    // **브라우저의 순수 JS만 안다.** 나머지는 우리가 모르는 기기다.
    if (run.engine?.kind !== 'mljs') return { kind: 'unknown' }
    const ms = estimateMs(
      {
        algorithm: run.algorithm,
        dataType: props.dataType,
        rows,
        columns,
        hyperparameters: run.hyperparameters,
      },
      factor,
    )
    if (ms === null) return { kind: 'unknown' }
    total += ms
  }
  return describeEstimate(total)
})

/** 예상 시간 한 줄. **문구는 학습 화면의 것을 그대로 쓴다** — 같은 말이다. */
const estimateText = computed(() => {
  if (estimate.value.kind === 'unknown') return t('train.estimateUnknown')
  const key =
    estimate.value.kind === 'minutes' ? 'train.estimate.minutes' : 'train.estimate.seconds'
  return t(key, { value: estimate.value.value })
})

/**
 * 교사가 멈춘 실험의 id. **`ref`가 아니다** — 화면이 그리는 값이 아니라 아래 `try`가
 * "통째로 앉혀도 되는가"를 묻는 자리다. 반응형으로 두면 읽는 곳 없는 상태가 하나 더 생긴다.
 */
let stopped: string | null = null

async function reproduce(): Promise<void> {
  if (cannotStart.value || !props.dataset) return
  // **시작할 때의 실험을 손에 쥔다.** 도는 동안 교사가 다른 실험으로 옮기면 `props`는
  // 그쪽을 가리키고, 그때 돌아온 판정을 그 자리에 앉히면 남의 실험의 점수가 된다.
  const claim = props.experiment
  const target = claim.id
  byExperiment.value.delete(target)
  failures.value.delete(target)
  comparing.value = target

  const job = start()
  const request = {
    type: 'train' as const,
    input: reproduceInputOf({
      experiment: claim,
      dataset: props.dataset,
      testDataset: props.testDataset,
      dataType: props.dataType,
    }),
  }

  const handle = train(request, {
    createWorker: spawnTrainingWorker,
    /**
     * **run 하나가 끝날 때마다 앉힌다** (§8.21). 통째로 기다렸다 한 번에 앉히면 진행
     * 숫자가 `(0/N)`에 붙박이고, 무엇보다 **멈춘 자리에 아무것도 안 남는다.**
     *
     * 실패한 주장은 여기서도 건너뛴다 — 견줄 점수가 없다(`compareExperiments`와 같은 규칙).
     */
    onProgress: (fresh, _completed, _total, index) => {
      if (!alive()) return
      const one = claim.runs[index]
      if (!one || !succeeded(one)) return
      const before = byExperiment.value.get(target) ?? []
      seat(byExperiment.value, target, [...before, compareRun(one, fresh)])
    },
  })
  job.hold(handle)
  try {
    const { experiment } = await handle.result
    // **떠난 화면에는 안 앉힌다** (`useWork`의 `alive`). 교사가 다른 제출물로 옮겼는데
    // 앞 파일의 판정이 뒤늦게 이 자리에 앉으면 **무고한 학생에게 붙는다.**
    //
    // **멈춘 실험에는 안 앉힌다.** 멈추기는 도착한 run만으로 실험을 조립해 돌려주므로
    // (`ml/worker/client.ts`), 통째로 견주면 **안 돌린 run이 `엔진 없음`으로 선다** —
    // 우리가 멈춘 일을 파일의 사정으로 말하는 것이 된다. 온 것은 이미 앉아 있다.
    if (alive() && stopped !== target) {
      seat(byExperiment.value, target, compareExperiments(claim, experiment))
    }
  } catch (error) {
    // **끊은 것은 실패가 아니다.** 멈추기도, 떠나기도 `JOB_CANCELLED`로 오고 그때까지
    // 앉은 판정이 그대로 남는다 — 여기서 삼키지 않으면 "학습을 멈췄습니다"가 붉게 뜬다.
    if (isClientError(error) && error.code === 'JOB_CANCELLED') return
    if (alive()) seat(failures.value, target, isClientError(error) ? error.code : 'JOB_FAILED')
  } finally {
    if (comparing.value === target) comparing.value = null
    if (stopped === target) stopped = null
    job.done()
  }
}

/**
 * **멈춘다.** 끝난 run의 판정은 그대로 남는다 (open-decisions.md "멈추기가 끝난 것을
 * 남긴다").
 *
 * **묻지 않는다.** 학습 화면은 한 번 묻는데 거기서 잃는 것은 학생의 수행평가이고, 여기서
 * 잃는 것은 교사가 다시 누르면 되는 계산이다.
 */
function stop(): void {
  stopped = comparing.value
  cancelAll()
}

/** 맵에 앉히고 화면에 알린다. **`ref`가 든 `Map`은 넣는 것만으로는 안 깨어난다.** */
function seat<Value>(map: Map<string, Value>, key: string, value: Value): void {
  map.set(key, value)
  triggerRef(byExperiment)
  triggerRef(failures)
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

/**
 * 그 줄의 `차이` 칸. **비워 두지 않는다** — 빈 칸은 못 쟀다는 뜻으로 읽힌다.
 *
 * 못 돌린 줄은 사유를, 돌린 줄은 지표마다의 차이를, 차이가 없으면 없다고 적는다.
 */
function differenceText(reproduction: Reproduction): string {
  const failed = failureText(reproduction)
  if (failed !== '') return failed
  return deltaText(reproduction.deltas) || t('inspect.noDifference')
}

/** 못 돌린 사유. 파일이 아니라 **이 기기**의 사정이다. */
function failureText(reproduction: Reproduction): string {
  const code = reproduction.failure?.code
  return code === undefined ? '' : t(errorMessageKey(code as ClientErrorCode))
}
</script>

<template>
  <!--
    **무결성의 이웃이라 같은 절 모양이다** (`IntegrityPanel`, 그쪽도 `ExperimentDetail`의
    절을 따른다) — 이름표는 `font-bold text-ink-soft`, 이름표와 내용 사이는 `gap-1.5`,
    안내는 이름표 바로 아래다.

    **카드는 여기서 안 두른다.** 왼쪽 열의 판 셋을 같은 카드가 감싸고, 그 카드는
    `InspectView`의 `PANEL`이 한 자리에서 준다 (2026-09-18, 사용자).
  -->
  <section class="flex min-w-0 flex-col gap-1.5">
    <!--
      **머리 줄에는 글자만 선다** (2026-09-18, 사용자). 단추를 여기 두면 그 높이만큼 줄이
      두꺼워지고, `items-baseline`이라 **이름표가 아래로 밀려 카드 위 여백이 이웃 카드보다
      넓어 보인다.** 옆 카드(무결성)의 머리 줄은 글자 둘이라 그 일이 안 생긴다.

      **어느 실험의 대조인지를 판이 말한다** (§8.21). 실험 상세 옆에 있을 때는 자리가
      말해 주던 것이고, 무결성 아래로 오면서 이 자리가 그것을 들고 간다.
    -->
    <div class="flex flex-wrap items-baseline justify-between gap-2">
      <h3 class="font-bold text-ink-soft">{{ t('inspect.reproduce') }}</h3>
      <AppBadge class="whitespace-nowrap font-bold">{{
        t('results.experimentName', { index: props.order })
      }}</AppBadge>
    </div>

    <p class="text-ink-faint">{{ t('inspect.reproduceLead') }}</p>

    <!--
      **잠긴 이유를 전부 말한다** (architecture.md §10). 이유 없이 회색인 단추는 고장으로
      보이고, 하나만 말하면 그 하나가 틀릴 수 있다.
    -->
    <ul v-if="blockers.length > 0" class="flex flex-col gap-1 text-ink-soft">
      <li v-for="blocker in blockers" :key="blocker">{{ t(`inspect.blocked.${blocker}`) }}</li>
    </ul>

    <!--
      **동작은 설명 다음이다.** 무엇을 하는 판인지 읽고 나서 누르는 순서이고, 머리 줄을
      글자만으로 두어 이웃 카드와 리듬이 맞는다.

      **누르기 전에 얼마나 걸릴지 말한다.** 교사의 질문은 "지금 눌러도 되는 일인가"다.
    -->
    <div class="mt-1 flex flex-wrap items-center gap-3">
      <!--
        **도는 동안에는 자리가 [멈추기]다** (학습 화면과 같은 문법). 서른 개를 훑는
        교사가 잘못 누른 대조에 88초를 묶여 있을 이유가 없고, 끝난 run의 판정은 멈춰도
        그대로 남는다.
      -->
      <AppButton v-if="comparing === props.experiment.id" variant="secondary" @click="stop">
        {{ t('train.stop') }}
      </AppButton>
      <AppButton v-else :disabled="cannotStart" :action="reproduce">
        {{ t('inspect.reproduceStart') }}
      </AppButton>
      <span v-if="blockers.length === 0" class="text-ink-faint">{{ estimateText }}</span>
    </div>

    <!-- **진행은 그 실험의 자리에서만 보인다.** 다른 실험을 보는 동안에는 남의 진행이다. -->
    <p v-if="comparing === props.experiment.id" class="text-ink-soft">
      {{ t('inspect.reproducing', { done: found.length, total: claims }) }}
    </p>

    <p v-if="failure" class="text-caution">{{ t(errorMessageKey(failure)) }}</p>

    <!--
      **표가 아니라 나열이다** (2026-09-18, 실측). 이 판이 무결성 아래로 오면서 폭이
      3분의 1 열(1024px에서 카드 286px)이 됐고, 거기서 세 열짜리 표는 **모델 이름이 넉 줄로
      접히고 `차이` 열이 73px 잘려 나갔다.** 비교하려고 표를 쓰는데 그 폭에서는 비교가
      안 되므로, 좁은 자리의 관용구인 나열로 바꾼다.

      **이름은 배지, 값은 plaintext다** (§8.16, `ui-rules.spec.ts`가 지킨다).
    -->
    <ul v-if="found.length > 0" class="flex flex-col gap-3">
      <li
        v-for="one in found"
        :key="one.runId"
        class="flex flex-col gap-1 border-t border-line pt-3 first:border-t-0 first:pt-0"
      >
        <p class="font-bold break-words">{{ t(`algorithms.${one.algorithm}`) }}</p>

        <dl class="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <div class="flex items-baseline gap-1.5">
            <dt>
              <AppBadge>{{ t('inspect.verdict') }}</AppBadge>
            </dt>
            <dd>{{ t(`reproduction.${one.status}`) }}</dd>
          </div>

          <!--
            **뒤집힌 줄 수가 여기 선다.** 분류 지표의 눈금은 `1/시험 행 수`라 한 칸 올린
            변조와 한 행 뒤집힌 엔진 차이의 크기가 같다 — 차이만으로는 그 둘을 못 가르고,
            혼동 행렬이 가른다.

            **빈 자리는 "안 쟀다"로 읽힌다** (2026-09-18, 사용자). 차이가 0인 것은
            결과이지 빈 것이 아니므로 그렇게 적는다.
          -->
          <div class="flex items-baseline gap-1.5">
            <dt>
              <AppBadge>{{ t('inspect.difference') }}</AppBadge>
            </dt>
            <dd class="break-words text-ink-soft">
              <span v-if="one.flipped" class="mr-2">
                {{ t('inspect.flipped', { count: one.flipped }) }}
              </span>
              {{ differenceText(one) }}
            </dd>
          </div>
        </dl>
      </li>
    </ul>
  </section>
</template>
