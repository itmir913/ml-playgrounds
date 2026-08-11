/**
 * 알고리즘 등록부와 "고를 수 있는가" 판정.
 *
 * **선택 가능한 모델은 세 축으로 결정된다** (mlpx-spec.md 0.1).
 *
 *   dataTypes   프로젝트를 만들 때 정해진다 - 표 프로젝트면 표 데이터용만
 *   taskTypes   **학생이 고른다** - 분류를 고르면 분류 모델만
 *   runtimes    실행 방법 - 서버가 없으면 브라우저에서 되는 것만 (ml/backend.ts)
 *
 * `if (dataType === 'image')` 도 `if (taskType === 'regression')` 도 만들지 마라.
 * **등록부에 항목을 추가하면 화면이 따라온다.** 지표도 같은 방식이다 (ml/metrics.ts).
 * 이미지·음성이 들어올 때 이 규칙이 값을 한다 (architecture.md 6).
 *
 * **축은 배열이 아니라 Record다** (ml/axes.ts, architecture.md §9.3). 배열이면 축 값이
 * 늘어도 컴파일이 조용하다 - 부분집합은 언제나 올바른 배열이기 때문이다. 줄마다
 * `false`를 다 적는 것이 장황해 보이지만, **그 장황함이 곧 이미지가 들어온 날
 * 다시 봐야 할 목록이다.**
 *
 * **비활성화하되 숨기지 않고, 왜 못 쓰는지 이유를 함께 준다.** 목록에서 사라지면 학생은
 * 그런 모델이 있다는 것조차 모르고, 이유 없이 회색이면 고장으로 본다.
 * 이유의 우선순위는 **데이터 타입 > 과제 유형 > 실행 위치**다 - 더 근본적인 것이 먼저다.
 * 이미지 데이터에 회귀를 고른 학생에게 "서버가 없습니다"라고 답하면 안 된다.
 */

import {
  MLJS_DECISION_TREE_ROW_LIMIT,
  MLJS_KMEANS_ROW_LIMIT,
  MLJS_KNN_ROW_LIMIT,
  MLJS_LINEAR_REGRESSION_ROW_LIMIT,
  MLJS_LOGISTIC_REGRESSION_ROW_LIMIT,
  MLJS_NAIVE_BAYES_ROW_LIMIT,
  MLJS_RANDOM_FOREST_ROW_LIMIT,
  MLJS_SVM_ROW_LIMIT,
} from '../limits'
import { TASK_TYPES, type DataType, type TaskType } from '../project/schema'
import { supports, type Axis } from './axes'
import {
  runtimeOptions,
  type AlgorithmSpec,
  type RuntimeContext,
  type RuntimeOption,
  UNMEASURED,
  type UnavailableReason,
} from './backend'

export interface Algorithm extends AlgorithmSpec {
  readonly dataTypes: Axis<DataType>
  readonly taskTypes: Axis<TaskType>
}

// `EVERYWHERE`라는 상수가 있었고 일곱 줄이 전부 그걸 가리켰다. **지웠다** - 실행 방법이
// 하나 늘면 그 상수 한 군데만 고치면 되고, 고치는 사람이 알고리즘 일곱 개를 대신
// 판단해 버린다. architecture.md §9.3.1이 금지한 "일괄 치환"이 상수 하나로 제도화된
// 꼴이었다. 같은 이유로 `SKLEARN_ONLY`도 두지 않는다.

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
    dataTypes: { tabular: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // 20000행 22초. 분할 탐색이 노드마다 O(특성 × 행²)이다.
    maxRows: { mljs: MLJS_DECISION_TREE_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
  },
  {
    id: 'knn',
    dataTypes: { tabular: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // **학습이 아니라 예측이 비싸고, 그 비용은 예측마다 되풀이된다.**
    maxRows: { mljs: MLJS_KNN_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
  },
  {
    id: 'logistic_regression',
    dataTypes: { tabular: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // 선형 회귀와 이름만 닮았다 - 경사하강이고 5000행에서 이미 4.3초다.
    maxRows: { mljs: MLJS_LOGISTIC_REGRESSION_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
  },
  {
    id: 'random_forest',
    dataTypes: { tabular: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // 5000행 100그루가 약 7분이다. **값이 안 바뀌어도 적는다** (backend.ts의 maxRows).
    maxRows: { mljs: MLJS_RANDOM_FOREST_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
  },
  {
    id: 'naive_bayes',
    dataTypes: { tabular: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // 10만 행 0.1초. 데이터를 한 번 훑는다.
    maxRows: { mljs: MLJS_NAIVE_BAYES_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
  },
  {
    id: 'svm',
    dataTypes: { tabular: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // SMO는 행 수의 제곱으로 붙고 학습 시작에 N×N 커널 행렬을 만든다. **여기가 알고리즘별
    // 상한의 시작이었고, 이제는 일곱 줄 전부가 자기 값을 든다** (open-decisions.md #13).
    maxRows: { mljs: MLJS_SVM_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
  },
  {
    id: 'linear_regression',
    dataTypes: { tabular: true },
    taskTypes: { classification: false, regression: true, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // 10만 행 0.3초. 브라우저 상한을 둘 이유가 없어 데이터셋 천장을 그대로 쓴다.
    maxRows: { mljs: MLJS_LINEAR_REGRESSION_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
  },
  {
    id: 'k_means',
    dataTypes: { tabular: true },
    taskTypes: { classification: false, regression: false, clustering: true },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // 할당과 갱신이 반복마다 O(n·k·d). 10만 행 k=20이 112회 반복 6.4초 (limits.ts).
    maxRows: { mljs: MLJS_KMEANS_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
  },
]

export interface AlgorithmOption {
  readonly algorithm: Algorithm
  readonly enabled: boolean
  /** enabled가 false일 때만 채워진다. 화면은 t()에 넣어 한 줄로 보여준다. */
  readonly reason?: UnavailableReason
  /**
   * 사유 문장이 쓸 행 상한. **사유를 가져온 그 칸의 값이다** (RuntimeOption.maxRows).
   *
   * 여기서 다시 고르지 않는다 - 어느 칸의 사유를 채택했는지는 아래 판정이 이미 알고
   * 있고, 부르는 쪽이 등록부를 다시 뒤지면 화면과 판정이 다른 숫자를 말한다.
   */
  readonly maxRows?: number
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
    (algorithm) => dataType === undefined || supports(algorithm.dataTypes, dataType),
  )
  return TASK_TYPES.filter((taskType) =>
    usable.some((algorithm) => supports(algorithm.taskTypes, taskType)),
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
    if (!supports(algorithm.dataTypes, selection.dataType)) {
      return { algorithm, enabled: false, reason: 'ALGORITHM_NOT_FOR_DATA_TYPE', runtimes }
    }
    if (!supports(algorithm.taskTypes, selection.taskType)) {
      return { algorithm, enabled: false, reason: 'ALGORITHM_NOT_FOR_TASK_TYPE', runtimes }
    }

    const usable = runtimes.find((option) => option.enabled)
    if (usable) return { algorithm, enabled: true, runtimes }

    // 어디서도 못 돈다. 이 알고리즘이 **실제로 지원하는** 실행 방법의 이유를 준다 -
    // 지원하지도 않는 것의 "여기서 실행할 수 없습니다"를 보여주면 아무 도움이 안 된다.
    const relevant = runtimes.find((option) => option.reason !== 'ALGORITHM_NOT_AVAILABLE_HERE')
    const reason = relevant?.reason ?? 'ALGORITHM_NOT_AVAILABLE_HERE'
    // 상한도 그 칸에서 함께 온다. 사유와 숫자가 다른 칸에서 오면 문장이 어긋난다.
    return {
      algorithm,
      enabled: false,
      reason,
      ...(relevant?.maxRows === undefined ? {} : { maxRows: relevant.maxRows }),
      runtimes,
    }
  })
}

/** 지금 고를 수 있는 알고리즘만. 기본 선택을 만들 때 쓴다. */
export function enabledAlgorithms(options: readonly AlgorithmOption[]): Algorithm[] {
  return options.filter((option) => option.enabled).map((option) => option.algorithm)
}
