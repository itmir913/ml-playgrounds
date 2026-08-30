/**
 * 학습 직전까지 — **행을 고르고, 뽑고, 분할하고, 전처리기를 학습한다.**
 *
 * ```
 * usableRows -> sampleRows -> splitRows -> fitPreprocessor   ← 여기까지가 planRun
 *                                       -> transform -> fit  ← 그 뒤는 runExperiment
 * ```
 *
 * **이 함수가 있는 이유는 화면이 같은 숫자를 말해야 하기 때문이다** (architecture.md
 * §9.1.3). 전처리 요약 카드가 "훈련 340행 / 테스트 85행"이라고 말하려면 그 숫자가
 * 실제로 학습할 때의 것과 같아야 하는데, **화면이 따로 계산하면 반드시 어긋난다.**
 * 어긋날 자리가 이미 셋이다.
 *
 * - 테스트 행 수의 반올림 — `round` 뒤에 1과 total-1로 자른다 (`ml/split.ts`).
 * - **뽑기가 분할보다 먼저다** — 비율의 분모가 전체가 아니라 뽑힌 행이다.
 * - **채움값과 스케일 기준은 훈련 데이터에서만 구한다** (`fitPreprocessor`). 전체로
 *   계산해 보여 주면 화면이 데이터 누수를 가르치는 꼴이 된다.
 *
 * **던지지 않는다.** 아직 타깃을 안 골랐거나 빈 칸이 남은 상태에서도 카드는 그려져야
 * 하는데, 예외로 흐름을 만들면 **어떤 예외를 삼킬지 카드가 결정하게 된다** — 그 순간
 * "무엇이 막는가"의 판정이 둘이 된다. 그래서 사유를 값으로 돌려주고, 던지는 일은
 * `runExperiment`가 한다.
 */

import { ClientError, isClientError, type ClientErrorCode, type ClientErrorParams } from '../errors'
import { dataSettings } from '../project/schema'
import type { Settings, TaskType } from '../project/schema'
import {
  detectKind,
  fitPreprocessor,
  missingColumns,
  targetValues,
  usableRows,
  type Dataset,
  type Preprocessor,
} from './preprocess'
import { sampleRows } from './sample'
// 전처리 화면이 [학습하기] 전에 같은 판정을 한다. 표가 두 벌이면 화면과 학습이 갈린다.
import { requiredTargetKind } from './selection'
import { splitRows } from './split'

export interface PlanInput {
  /** 정본 CSV를 읽은 표. 행 번호가 곧 분할 인덱스다. */
  dataset: Dataset
  /** 테스트 데이터. `split.method`가 `provided`일 때만 본다. 없으면 `null`이다. */
  testDataset: Dataset | null
  settings: Settings
  /**
   * **아직 안 골랐으면 `undefined`다.** 유형은 학습 화면에서 고르므로 전처리 화면에서는
   * 비어 있는 것이 정상이고, 그때는 분할이 어떻게 될지 말할 수 없다 — 군집은 분할하지
   * 않기 때문이다 (architecture.md §3.6).
   */
  taskType?: TaskType | undefined
}

/**
 * 계획을 세울 수 없는 이유.
 *
 * - `error` — 학습이 거부한다. 그대로 `ClientError`가 된다.
 * - `pending` — 학생이 아직 안 고른 것이 있다. **실패가 아니다.** 화면은 "고르면
 *   정해집니다"라고 말하고, 학습 경로에서는 나올 수 없다(그쪽은 유형을 받고 온다).
 */
export type PlanBlock =
  | { kind: 'error'; code: ClientErrorCode; params: ClientErrorParams }
  | { kind: 'pending'; missing: 'taskType' }

export interface PlanFacts {
  /** 정본의 전체 행 수. 무엇이 얼마나 빠졌는지의 분모다. */
  totalRows: number
  /** 학습에 쓸 수 있는 행의 **원본 번호**. 타깃이 비었거나 `drop`으로 걸린 행이 빠졌다. */
  usable: readonly number[]
  /** 뽑힌 행. 뽑기를 안 켰으면 `usable`과 같다. 분할되는 것은 이쪽이다. */
  sampled: readonly number[]
  split: { readonly trainIndices: readonly number[]; readonly testIndices: readonly number[] }
  /**
   * `testIndices`가 **`testDataset`의 행 번호인가.** `provided`일 때만 참이고, 그때는
   * `trainIndices`와 서로 다른 정본을 가리킨다 (mlpx-spec.md §1.1).
   */
  testFromProvided: boolean
  /** 훈련 데이터에서 구한 전처리기. 채움값·스케일 기준·범주 목록이 여기 있다. */
  preprocessor: Preprocessor
  /** 뽑힌 행의 타깃 값. 군집이면 빈 배열이다. */
  labels: readonly string[]
  /** 분할하지 않는가 (architecture.md §3.6). */
  isClustering: boolean
}

export type RunPlan = ({ ok: true } & PlanFacts) | { ok: false; reason: PlanBlock }

const blocked = (code: ClientErrorCode, params: ClientErrorParams = {}): RunPlan => ({
  ok: false,
  reason: { kind: 'error', code, params },
})

/**
 * 지금 설정으로 학습하면 무엇이 되는가.
 *
 * **`runExperiment`가 부르는 그 함수다.** 여기서 나온 값이 그대로 학습에 들어간다 —
 * 화면이 보는 것과 모델이 보는 것이 같은 객체다.
 */
export function planRun(input: PlanInput): RunPlan {
  const { dataset, testDataset, settings, taskType } = input
  /**
   * **여기서 읽는 설정은 언제나 표의 모양이다.** 이미지도 임베딩을 열 이름 붙인 표로
   * 바꿔서 들어온다 (open-decisions.md "이미지 학습은 표 문제로 바꿔서 푼다").
   */
  const data = dataSettings('tabular', settings)
  const { target } = data

  // 유형을 모르면 분할을 말할 수 없다. **거부가 아니라 아직 정해지지 않은 것이다.**
  if (taskType === undefined) return { ok: false, reason: { kind: 'pending', missing: 'taskType' } }

  const isClustering = taskType === 'clustering'

  // 군집화에는 타깃이 없다 (architecture.md §3.6). 분류·회귀는 정답 열이 있어야
  // 학습도 채점도 된다.
  if (!isClustering && (target === undefined || target === '')) {
    return blocked('TARGET_NOT_SELECTED')
  }

  // provided일 때만 쓰는 테스트 데이터셋의 usableRows. holdout이면 undefined다 -
  // splitRows가 그때는 아예 보지 않는다 (ml/split.ts).
  // 군집화에는 테스트 데이터셋이 없다 — 전체 데이터로 학습한다.
  const testFromProvided = !isClustering && settings.split.method === 'provided' && !!testDataset
  const providedTestRows = testFromProvided
    ? usableRows(testDataset!, data.features, target!, data.preprocessing.missing)
    : undefined

  // 군집화에는 타깃이 없으므로 usableRows에 undefined를 넘긴다. usableRows는
  // target이 없으면 타깃 결측 검사를 건너뛴다.
  const usable = usableRows(
    dataset,
    data.features,
    isClustering ? undefined : target,
    data.preprocessing.missing,
  )
  const usableLabels = isClustering ? [] : targetValues(dataset, usable, target!)

  // **성립하지 않는 조합은 분할보다 먼저 거부한다.** 여기서 넘기면 지표가 NaN인 채로
  // run이 done으로 끝나고, 그 파일은 저장은 되는데 다시 열리지 않는다.
  // 군집화에는 타깃 자료형 요구가 없다.
  if (!isClustering) {
    const required = requiredTargetKind(taskType)
    // **표본이 아니라 쓸 수 있는 행 전부를 본다.** 타깃이 숫자인지 범주인지는 열의
    // 성질이지 뽑기의 결과가 아니고, 표본으로 판정하면 nSamples를 움직일 때마다
    // 같은 데이터의 판정이 흔들릴 수 있다.
    if (required && detectKind(usableLabels) !== required.kind) {
      return blocked(required.code, { target: target! })
    }
  }

  // **"아무것도 안 함"은 빈 칸이 있으면 거부한다.** 조용히 두는 길이 없어서다 - 수치
  // 열의 빈 칸은 결국 0이 되고, 그러면 그 이름으로 0 채우기를 하는 셈이 된다
  // (open-decisions.md "전처리도 분할도 끌 수 있다"). **전체**를 본다 - provided면
  // 테스트 데이터셋도 같은 전처리를 받으므로(mlpx-spec.md §1.1) 거기도 봐야 한다.
  // 군집화에는 타깃이 없으므로 특성만 본다.
  if (data.preprocessing.missing === 'none') {
    const checked = isClustering ? [...data.features] : [...data.features, target!]
    const blank =
      missingColumns(dataset, checked)[0] ??
      (testFromProvided ? missingColumns(testDataset!, checked)[0] : undefined)
    if (blank) return blocked('FEATURE_HAS_MISSING', { feature: blank.name, count: blank.count })
  }

  /**
   * **여기부터는 던지는 코드다.** 뽑기·분할·전처리기는 성립하지 않는 조합에서
   * `ClientError`를 던진다 — 층화할 수 없는 타깃, 너무 적은 행, 통째로 빈 특성,
   * 하나도 안 남은 특성. **전부 학생이 화면에서 만들 수 있는 상태이므로** 카드가
   * 사유로 말할 수 있어야 한다.
   *
   * 삼키는 자리를 여기 하나로 모은다. 부르는 쪽마다 `try`를 두면 무엇을 삼킬지가
   * 자리마다 갈리고, 그러면 화면과 학습이 다른 목록을 본다.
   */
  try {
    // **뽑고 나서 나눈다** (open-decisions.md #22). 뽑힌 행만 분할되므로 trainIndices와
    // testIndices의 뜻은 그대로이고, **뽑히지 않은 행은 그 둘의 여집합**이라 따로 적지
    // 않는다. nSamples가 없으면 usable을 그대로 돌려주므로 지금까지의 동작과 같다.
    const sampled = sampleRows(
      { rows: usable, ...(isClustering ? {} : { labels: usableLabels }) },
      settings.split,
      settings.nSamples,
    )
    // 뽑힌 행의 정답이다. usableLabels를 잘라 쓰지 않는 이유는 sampleRows가 원본 행
    // 번호를 오름차순으로 돌려주지 usable의 위치를 돌려주지 않기 때문이다 - 위치로
    // 착각해 자르면 라벨이 조용히 다른 행의 것이 된다.
    const labels = isClustering ? [] : targetValues(dataset, sampled, target!)

    // **군집화는 나누지 않는다** (architecture.md §3.6). 전체 데이터로 학습하고,
    // trainIndices는 전체, testIndices는 빈 배열이다. 교실에서 "왜 나누지 않나요?"는
    // 비지도학습을 이해하는 좋은 질문이고, 그것을 설명할 자리가 생기는 것이 교육적 가치다.
    const split = isClustering
      ? { trainIndices: sampled, testIndices: [] as number[] }
      : splitRows(
          { rows: sampled, labels },
          settings.split,
          providedTestRows ? { rows: providedTestRows } : undefined,
        )

    const preprocessor = fitPreprocessor(
      dataset,
      split.trainIndices,
      data.features,
      data.preprocessing,
    )

    return {
      ok: true,
      totalRows: dataset.rows.length,
      usable,
      sampled,
      split,
      testFromProvided,
      preprocessor,
      labels,
      isClustering,
    }
  } catch (error) {
    if (isClientError(error)) return blocked(error.code, error.params)
    throw error
  }
}

/**
 * 계획을 세우거나 그 사유로 던진다. **학습 경로가 쓴다.**
 *
 * `pending`은 여기서 나올 수 없다 — 이 경로는 유형을 받고 온다. 그래도 조용히
 * 넘어가지 않고 시끄럽게 죽는다.
 */
export function planRunOrThrow(input: PlanInput & { taskType: TaskType }): PlanFacts {
  const plan = planRun(input)
  if (plan.ok) return plan
  if (plan.reason.kind === 'error') throw new ClientError(plan.reason.code, plan.reason.params)
  throw new Error(`planRun returned pending for a known task type: ${plan.reason.missing}`)
}
