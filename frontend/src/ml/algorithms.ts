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

import { SVM_ROW_LIMIT } from '../limits'
import { TASK_TYPES, type DataType, type TaskType } from '../project/schema'
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

// `SKLEARN_ONLY`가 있었고, 그 유일한 항목이 svm이었다. 순수 JS 솔버가 들어오면서
// 비었다 - 안 쓰는 목록을 남겨 두면 다음 사람이 "여기 넣으면 되나"로 읽는다.

/**
 * V1 알고리즘. **여기 추가하는 것은 포맷 변경이 아니다** (mlpx-spec.md 5.2).
 * 그래서 formatVersion이 오르지 않고, 모르는 알고리즘이 든 파일도 열린다.
 *
 * **svm도 순수 JS에서 돈다** (2026-08-06). 후보가 WASM(libsvm-js)뿐이라 sklearn 전용이었고,
 * 그 상태가 공식 배포(GitHub Pages)의 기본값이라 **대부분의 학생에게 SVM은 없는 물건이었다.**
 * 솔버는 벤더링한 SMO다 (ml/engines/svm-smo.ts).
 *
 * **성능이 낮다는 이유로 빼지 않는다.** 엔진마다 숫자가 다른 것은 이 설계가 이미
 * 받아들인 사실이고(그래서 run.engine을 기록한다), 어디까지가 "낮은 것"이고 어디부터가
 * "빼야 할 것"인지 그을 선이 없다. 실제 폭은 ml/engines/mljs.ts에 적어 두었다.
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
    runtimes: EVERYWHERE,
  },
  {
    id: 'svm',
    dataTypes: ['tabular'],
    taskTypes: ['classification'],
    runtimes: EVERYWHERE,
    // **이 알고리즘만 상한이 따로다** (limits.ts의 SVM_ROW_LIMIT). SMO는 행 수의 제곱으로
    // 붙고 학습 시작에 N×N 커널 행렬을 만든다.
    maxRows: SVM_ROW_LIMIT,
  },
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

/**
 * 학생에게 고르게 할 수 있는 과제 유형.
 *
 * **등록부에서 뽑는다.** 목록을 손으로 적어 두면 알고리즘이 하나도 없는 유형을 고를 수
 * 있게 되고, 학생은 아무것도 못 하는 프로젝트를 만든다. 군집 알고리즘을 등록하는 날
 * 여기가 저절로 따라온다.
 *
 * **데이터 종류를 함께 본다.** 유형과 데이터 종류는 독립이 아니다 - 이미지에 회귀는
 * 성립하지 않고, 그건 우리가 정하는 것이 아니라 **그 조합에 등록된 알고리즘이 없다는
 * 사실**이다. 안 보면 학생이 회귀를 고른 뒤에야 모델이 전부 꺼진 목록을 만난다.
 * `if (dataType === 'image')`를 쓰지 않는 이유는 이 파일의 첫 주석과 같다.
 *
 * 데이터를 아직 안 올렸으면 종류를 모른다. 그때는 **좁히지 않는다** - 무엇을 올릴지
 * 모르는 채로 유형을 지울 근거가 없다.
 *
 * 순서는 TASK_TYPES를 따른다 - 화면마다 순서가 다르면 안 된다.
 */
export function supportedTaskTypes(
  dataType?: DataType | undefined,
  algorithms: readonly Algorithm[] = ALGORITHMS,
): readonly TaskType[] {
  const usable = algorithms.filter(
    (algorithm) => dataType === undefined || algorithm.dataTypes.includes(dataType),
  )
  return TASK_TYPES.filter((taskType) =>
    usable.some((algorithm) => algorithm.taskTypes.includes(taskType)),
  )
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
