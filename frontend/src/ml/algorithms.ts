/**
 * 알고리즘 등록부와 "고를 수 있는가" 판정.
 *
 * **선택 가능한 모델은 세 축으로 결정된다** (mlpx-spec.md 0.1).
 *
 *   dataTypes   업로드한 데이터에서 온다 - CSV면 표 데이터용만
 *   taskTypes   **학생이 고른다** - 분류를 고르면 분류 모델만
 *   runtimes    실행 방법 - 서버가 없으면 브라우저에서 되는 것만 (ml/backend.ts)
 *
 * `if (dataType === 'image')` 도 `if (taskType === 'regression')` 도 만들지 마라.
 * **등록부에 항목을 추가하면 화면이 따라온다.** 지표도 같은 방식이다 (ml/metrics.ts).
 * 이미지·음성이 들어오는 V5에서 이 규칙이 값을 한다 (architecture.md 6).
 *
 * **비활성화하되 숨기지 않고, 왜 못 쓰는지 이유를 함께 준다.** 목록에서 사라지면 학생은
 * 그런 모델이 있다는 것조차 모르고, 이유 없이 회색이면 고장으로 본다.
 * 이유의 우선순위는 **데이터 타입 > 과제 유형 > 실행 위치**다 - 더 근본적인 것이 먼저다.
 * 이미지 데이터에 회귀를 고른 학생에게 "서버가 없습니다"라고 답하면 안 된다.
 */

import type { DataType, TaskType } from '../project/schema'
import {
  runtimeOptions,
  type AlgorithmSpec,
  type RuntimeContext,
  type RuntimeOption,
  type UnavailableReason,
} from './backend'

export interface Algorithm extends AlgorithmSpec {
  readonly dataTypes: readonly DataType[]
  readonly taskTypes: readonly TaskType[]
}

/** 순수 JS와 sklearn 양쪽에 구현이 있는 것. */
const EVERYWHERE = ['mljs', 'pyodide-sklearn', 'server-sklearn'] as const

/** 순수 JS 구현이 없어 sklearn에서만 도는 것. */
const SKLEARN_ONLY = ['pyodide-sklearn', 'server-sklearn'] as const

/**
 * V1 알고리즘. **여기 추가하는 것은 포맷 변경이 아니다** (mlpx-spec.md 5.2).
 * 그래서 formatVersion이 오르지 않고, 모르는 알고리즘이 든 파일도 열린다.
 *
 * 순수 JS에 없는 것이 둘이다. 숨기지 않고 등록해 둔다 - 목록에서 빠지면 학생은
 * 그런 모델이 있다는 것조차 모른다.
 *
 * - svm: 후보가 WASM(libsvm-js)뿐이다
 * - naive_bayes: ml-naivebayes가 붓꽃에서 0.70이다(sklearn은 같은 분할에서 0.9667).
 *   27%p 차이는 "엔진 차이"가 아니라 틀린 답에 가깝고, 교과서 알고리즘이라
 *   학생이 "나이브 베이즈는 원래 나쁘구나"를 잘못 배운다
 */
export const ALGORITHMS: readonly Algorithm[] = [
  {
    id: 'decision_tree',
    dataTypes: ['tabular'],
    taskTypes: ['classification'],
    runtimes: EVERYWHERE,
  },
  { id: 'knn', dataTypes: ['tabular'], taskTypes: ['classification'], runtimes: EVERYWHERE },
  {
    id: 'logistic_regression',
    dataTypes: ['tabular'],
    taskTypes: ['classification'],
    runtimes: EVERYWHERE,
  },
  {
    id: 'random_forest',
    dataTypes: ['tabular'],
    taskTypes: ['classification'],
    runtimes: EVERYWHERE,
  },
  {
    id: 'naive_bayes',
    dataTypes: ['tabular'],
    taskTypes: ['classification'],
    runtimes: SKLEARN_ONLY,
  },
  { id: 'svm', dataTypes: ['tabular'], taskTypes: ['classification'], runtimes: SKLEARN_ONLY },
  {
    id: 'linear_regression',
    dataTypes: ['tabular'],
    taskTypes: ['regression'],
    runtimes: EVERYWHERE,
  },
]

export interface AlgorithmOption {
  readonly algorithm: Algorithm
  readonly enabled: boolean
  /** enabled가 false일 때만 채워진다. 화면은 t()에 넣어 한 줄로 보여준다. */
  readonly reason?: UnavailableReason
  /**
   * 실행 방법별 판정. **enabled가 false여도 채운다** - 학생이 "왜 못 쓰지"를 열어봤을 때
   * 실행 방법마다 이유가 달라야 무엇을 하면 되는지 알 수 있다.
   */
  readonly runtimes: RuntimeOption[]
}

export interface Selection {
  dataType: DataType
  /** 자동으로 판정하지 않는다 - 학생이 고른다 (mlpx-spec.md 0.1). */
  taskType: TaskType
}

/**
 * 지금 이 데이터와 이 과제 유형에서 알고리즘마다 고를 수 있는지 판정한다.
 *
 * 순수 함수다. 화면은 이 결과를 그대로 그리기만 한다.
 */
export function algorithmOptions(
  selection: Selection,
  context: RuntimeContext,
  algorithms: readonly Algorithm[] = ALGORITHMS,
): AlgorithmOption[] {
  return algorithms.map((algorithm): AlgorithmOption => {
    const runtimes = runtimeOptions(algorithm, context)

    // 순서가 곧 이유의 우선순위다. 더 근본적인 것이 먼저 걸린다.
    if (!algorithm.dataTypes.includes(selection.dataType)) {
      return { algorithm, enabled: false, reason: 'ALGORITHM_NOT_FOR_DATA_TYPE', runtimes }
    }
    if (!algorithm.taskTypes.includes(selection.taskType)) {
      return { algorithm, enabled: false, reason: 'ALGORITHM_NOT_FOR_TASK_TYPE', runtimes }
    }

    const usable = runtimes.find((option) => option.enabled)
    if (usable) return { algorithm, enabled: true, runtimes }

    // 어디서도 못 돈다. 이 알고리즘이 **실제로 지원하는** 실행 방법의 이유를 준다 -
    // 지원하지도 않는 것의 "여기서 실행할 수 없습니다"를 보여주면 아무 도움이 안 된다.
    const relevant = runtimes.find((option) => option.reason !== 'ALGORITHM_NOT_AVAILABLE_HERE')
    const reason = relevant?.reason ?? 'ALGORITHM_NOT_AVAILABLE_HERE'
    return { algorithm, enabled: false, reason, runtimes }
  })
}

/** 지금 고를 수 있는 알고리즘만. 기본 선택을 만들 때 쓴다. */
export function enabledAlgorithms(options: readonly AlgorithmOption[]): Algorithm[] {
  return options.filter((option) => option.enabled).map((option) => option.algorithm)
}
