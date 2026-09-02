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
  MLJS_IMAGE_DECISION_TREE_ROW_LIMIT,
  MLJS_IMAGE_KMEANS_ROW_LIMIT,
  MLJS_IMAGE_KNN_ROW_LIMIT,
  MLJS_IMAGE_LOGISTIC_REGRESSION_ROW_LIMIT,
  MLJS_IMAGE_NAIVE_BAYES_ROW_LIMIT,
  MLJS_IMAGE_NEURAL_NETWORK_BASELINE_MS,
  MLJS_IMAGE_NEURAL_NETWORK_ROW_LIMIT,
  MLJS_IMAGE_RANDOM_FOREST_ROW_LIMIT,
  MLJS_IMAGE_SVM_ROW_LIMIT,
  MLJS_KMEANS_ROW_LIMIT,
  MLJS_KNN_ROW_LIMIT,
  MLJS_DECISION_TREE_BASELINE_MS,
  MLJS_KMEANS_BASELINE_MS,
  MLJS_KNN_BASELINE_MS,
  MLJS_LINEAR_REGRESSION_BASELINE_MS,
  MLJS_LOGISTIC_REGRESSION_BASELINE_MS,
  MLJS_NAIVE_BAYES_BASELINE_MS,
  MLJS_NEURAL_NETWORK_BASELINE_MS,
  MLJS_RANDOM_FOREST_BASELINE_MS,
  MLJS_SVM_BASELINE_MS,
  MLJS_LINEAR_REGRESSION_ROW_LIMIT,
  MLJS_LOGISTIC_REGRESSION_ROW_LIMIT,
  MLJS_NAIVE_BAYES_ROW_LIMIT,
  MLJS_NEURAL_NETWORK_ROW_LIMIT,
  MLJS_RANDOM_FOREST_ROW_LIMIT,
  MLJS_SVM_ROW_LIMIT,
} from '../limits'
import { TASK_TYPES, type DataType, type TaskType } from '../project/schema'
import { supports, type Axis } from './axes'
import { DEFAULT_BACKBONE_ID, backboneFor } from './backbones'
import {
  runtimeOptions,
  type AlgorithmSpec,
  type RuntimeContext,
  type RuntimeOption,
  UNMEASURED,
  UNMEASURED_BASELINE,
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
 * **이미지에도 거의 다 연다** (open-decisions.md "이미지 학습의 모양"). 임베딩이 숫자
 * 표이므로 코드 추가 없이 그 위에서 돈다. **트리 계열이 눈에 띄게 뒤처질 것이고, 그래도
 * 빼지 않는다** - 표에서 잘 되던 것이 이미지에서 안 되는 것을 학생이 직접 보는 것이 이
 * 도구가 줄 수 있는 수업 장면이다. 회귀만 닫혀 있다(백본 등록부가 과제를 좁힌다).
 *
 * **`maxRows`는 데이터 종류마다 다르다** (2026-08-14에 쟀다, open-decisions.md #13).
 * 이미지는 특성이 1,280개라 같은 행 수가 같은 시간을 뜻하지 않는다 - 표에서 2만 행이
 * 22초인 결정 트리가 사진 1,500장에서 136초다. **트리 계열 둘만 눈에 띄게 낮고, 나머지는
 * 사진 수 상한을 그대로 쓴다.**
 *
 * **성능이 낮다는 이유로 빼지 않는다.** 엔진마다 숫자가 다른 것은 이 설계가 이미
 * 받아들인 사실이고(그래서 run.engine을 기록한다), 어디까지가 "낮은 것"이고 어디부터가
 * "빼야 할 것"인지 그을 선이 없다. 실제 폭은 ml/engines/mljs.ts에 적어 두었다.
 */
export const ALGORITHMS: readonly Algorithm[] = [
  {
    id: 'decision_tree',
    dataTypes: { tabular: true, image: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // 20,000행이 최악 145.6초다(2026-08-31 재실측, limits.ts). 분할 탐색이 노드마다
    // O(특성 × 행²)이고, 데이터가 잘 갈릴수록 얕게 끝난다. **이미지에서 가장 크게
    // 갈린다** - 1,000장 58.7초이고 1,500장이면 136초다.
    maxRows: {
      tabular: { mljs: MLJS_DECISION_TREE_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
      image: { mljs: MLJS_IMAGE_DECISION_TREE_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
    },
    baseline: {
      tabular: { ms: MLJS_DECISION_TREE_BASELINE_MS, columns: 'linear' },
      image: UNMEASURED_BASELINE,
    },
  },
  {
    id: 'knn',
    dataTypes: { tabular: true, image: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // **학습이 아니라 예측이 비싸고, 그 비용은 예측마다 되풀이된다.**
    maxRows: {
      tabular: { mljs: MLJS_KNN_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
      image: { mljs: MLJS_IMAGE_KNN_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
    },
    baseline: {
      tabular: { ms: MLJS_KNN_BASELINE_MS, columns: 'flat' },
      image: UNMEASURED_BASELINE,
    },
  },
  {
    id: 'logistic_regression',
    dataTypes: { tabular: true, image: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // 선형 회귀와 이름만 닮았다 - 경사하강이고 5000행에서 이미 4.3초다.
    maxRows: {
      tabular: { mljs: MLJS_LOGISTIC_REGRESSION_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
      image: { mljs: MLJS_IMAGE_LOGISTIC_REGRESSION_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
    },
    baseline: {
      tabular: { ms: MLJS_LOGISTIC_REGRESSION_BASELINE_MS, columns: 'flat' },
      image: UNMEASURED_BASELINE,
    },
  },
  {
    id: 'random_forest',
    dataTypes: { tabular: true, image: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // 5000행 100그루가 약 7분이다. **값이 안 바뀌어도 적는다** (backend.ts의 maxRows).
    // 이미지는 1,000장이 521.7초라 등록부에서 가장 낮은 칸이 됐다.
    maxRows: {
      tabular: { mljs: MLJS_RANDOM_FOREST_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
      image: { mljs: MLJS_IMAGE_RANDOM_FOREST_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
    },
    baseline: {
      tabular: { ms: MLJS_RANDOM_FOREST_BASELINE_MS, columns: 'linear' },
      image: UNMEASURED_BASELINE,
    },
  },
  {
    id: 'naive_bayes',
    dataTypes: { tabular: true, image: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // 10만 행 0.1초. 데이터를 한 번 훑는다.
    maxRows: {
      tabular: { mljs: MLJS_NAIVE_BAYES_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
      image: { mljs: MLJS_IMAGE_NAIVE_BAYES_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
    },
    baseline: {
      tabular: { ms: MLJS_NAIVE_BAYES_BASELINE_MS, columns: 'linear' },
      image: UNMEASURED_BASELINE,
    },
  },
  {
    id: 'svm',
    dataTypes: { tabular: true, image: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // SMO는 행 수의 제곱으로 붙고 학습 시작에 N×N 커널 행렬을 만든다. **여기가 알고리즘별
    // 상한의 시작이었고, 이제는 일곱 줄 전부가 자기 값을 든다** (open-decisions.md #13).
    // **이미지 칸의 값이 같은 것은 우연이다** - 커널 크기는 특성 수를 안 가린다.
    maxRows: {
      tabular: { mljs: MLJS_SVM_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
      image: { mljs: MLJS_IMAGE_SVM_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
    },
    baseline: {
      tabular: { ms: MLJS_SVM_BASELINE_MS, columns: 'linear' },
      image: UNMEASURED_BASELINE,
    },
  },
  {
    /**
     * 다층 퍼셉트론 (`open-decisions.md` "인공신경망을 넣는다").
     *
     * **사진도 연다** (2026-09-03에 재고 열었다). 임베딩이 1,280차원이라 첫 층만으로
     * 가중치가 128,100개(기본 손잡이의 142배)인데, **장당 148ms로 완전히 선형이다** —
     * 트리 계열처럼 한 칸 위가 절벽인 자리가 없다 (`limits.ts`의 상한 주석).
     *
     * **`taskTypes.regression`이 사진까지 열지는 않는다.** 이미지에서 무슨 과제를 할 수
     * 있는지는 **백본이 답한다**(`backbones.ts`의 `tasks`) — 두 축을 곱해 놓고 교집합을
     * 여기 적으면 등록부가 자기 축으로 표현할 수 없는 사실을 품게 된다.
     *
     * **에폭 상한이 시간의 천장을 쥔다.** 행에는 선형이고 가중치는 행 수에 안 붙어
     * 깨지는 지점이 없다 — 표에서는 데이터셋 천장이 그대로 상한이고, 사진에서는
     * 45분 수업이 상한을 정했다.
     */
    id: 'neural_network',
    dataTypes: { tabular: true, image: true },
    // **분류와 회귀를 함께 하는 첫 줄이다.** 갈리는 것은 출력층 셋(칸 수·활성·손실)뿐이고
    // 역전파는 한 줄도 안 갈린다 — 그래서 엔진 하나로 둘을 한다 (mlpx-spec.md §5.11).
    taskTypes: { classification: true, regression: true, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': false, 'server-sklearn': false },
    maxRows: {
      tabular: { mljs: MLJS_NEURAL_NETWORK_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
      image: { mljs: MLJS_IMAGE_NEURAL_NETWORK_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
    },
    baseline: {
      // **`flat`이다.** 특성은 첫 층 하나에만 붙지 학습 전체에 선형이 아니고, 그 몫은
      // 손잡이 배수표(`MLJS_NEURAL_NETWORK_WEIGHTS_MS`)가 가중치 수로 함께 받는다.
      // **사진 표도 같다** — 거기는 차원이 표 안에 이미 들어 있다.
      tabular: { ms: MLJS_NEURAL_NETWORK_BASELINE_MS, columns: 'flat' },
      image: { ms: MLJS_IMAGE_NEURAL_NETWORK_BASELINE_MS, columns: 'flat' },
    },
  },
  {
    id: 'linear_regression',
    dataTypes: { tabular: true, image: false },
    taskTypes: { classification: false, regression: true, clustering: false },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // 10만 행 0.3초. 브라우저 상한을 둘 이유가 없어 데이터셋 천장을 그대로 쓴다.
    // **이미지 칸은 `UNMEASURED`다** - 위 `dataTypes`가 이미 닫아서 판정이 여기까지
    // 오지 않는다. 숫자를 지어 넣으면 재 본 값처럼 보인다 (backend.ts의 UNMEASURED).
    maxRows: {
      tabular: { mljs: MLJS_LINEAR_REGRESSION_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
      image: { mljs: UNMEASURED, 'pyodide-sklearn': UNMEASURED },
    },
    baseline: {
      tabular: { ms: MLJS_LINEAR_REGRESSION_BASELINE_MS, columns: 'linear' },
      image: UNMEASURED_BASELINE,
    },
  },
  {
    id: 'k_means',
    dataTypes: { tabular: true, image: true },
    taskTypes: { classification: false, regression: false, clustering: true },
    runtimes: { mljs: true, 'pyodide-sklearn': true, 'server-sklearn': true },
    // 할당과 갱신이 반복마다 O(n·k·d). 10만 행 k=20이 112회 반복 6.4초 (limits.ts).
    maxRows: {
      tabular: { mljs: MLJS_KMEANS_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
      image: { mljs: MLJS_IMAGE_KMEANS_ROW_LIMIT, 'pyodide-sklearn': UNMEASURED },
    },
    /**
     * **`'linear'`인데 잰 사다리는 내려간다** (2026-09-01 R17 감사 C-3). 그래도 안 바꾼다.
     *
     * `tools/`의 특성 사다리가 50,000행에서 특성 8→32일 때 **×0.51**(다시 재니 ×0.88)로
     * 나온다. 그런데 **그것이 열 비용을 잰 것이 아니다.** K-평균 한 번의 비용은
     * `O(행 × k × 특성 × 반복)`이라 반복 하나는 특성에 선형이어야 하고, 내려간 것은
     * **반복 횟수**로 보인다 — 사다리의 `uniformData`가 군집 없는 균일 난수라 차원이
     * 오르면 거리가 몰려(거리 집중) Lloyd가 더 일찍 멈춘다. 학생이 K-평균에 가져오는
     * 데이터는 군집이 있는 쪽이다.
     *
     * **그래서 값을 안 바꾸고 나눠 잴 수 있게 했다.** 하니스가 이제 점마다 반복 횟수를
     * ms 옆에 싣는다(`tools/bench.ts`의 `iterations`). `ms / 반복`이 선형이면 `'linear'`이
     * 맞고 내리막은 픽스처로 전부 설명되며, 아니면 **그때는 바꿀 실측 숫자가 손에 있다.**
     * 지금은 없다.
     *
     * **틀리는 방향은 안전하다.** `'linear'`은 50,000×32에서 길게 말하고, 예상 시간은
     * 경고라 길게 틀리는 쪽이 이 저장소가 정한 방향이다.
     *
     * **군집 있는 생성기를 새로 만드는 안은 접었다** — 진짜 군집 수와 퍼짐 정도가 전부
     * 임의 상수라 근거가 없다. 반복 횟수는 엔진이 이미 세고 있는 값이다.
     */
    baseline: {
      tabular: { ms: MLJS_KMEANS_BASELINE_MS, columns: 'linear' },
      image: UNMEASURED_BASELINE,
    },
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
 * **데이터 종류를 함께 본다.** 유형과 데이터 종류는 독립이 아니다 - 안 보면 학생이
 * 회귀를 고른 뒤에야 모델이 전부 꺼진 목록을 만난다.
 * `if (dataType === 'image')`를 쓰지 않는 이유는 이 파일의 첫 주석과 같다.
 *
 * **사진에서는 백본에게도 묻는다** (2026-09-03). 그전까지 이미지 회귀가 막힌 것은
 * **그 조합에 등록된 알고리즘이 없어서**였고, `backbones.ts`와 결정문이 입을 모아
 * *"화면의 `v-if`가 아니라 `tasks`가 짧아서 막힌다"*고 적어 두었지만 **그 필드를 읽는
 * 코드가 없었다** (V11 R1 감사 B-4가 그것을 찾아 `tests/backbones.spec.ts`에
 * 트립와이어를 세워 두었다).
 *
 * **인공신경망이 그 트립와이어를 울렸다.** 표에서는 분류와 회귀를 함께 하고 사진에서는
 * 분류만 하는 첫 알고리즘인데, 등록부의 축은 `dataTypes × taskTypes`라 **그 교집합을
 * 표현할 수 없다.** 둘 중 하나를 끄는 것은 둘 다 틀린 답이라(사진을 닫거나, 있지도 않은
 * 이미지 회귀를 열거나) **감사가 가리키던 자리를 여기서 막는다** — 사진에서 무슨 과제를
 * 할 수 있는지는 **백본이 답한다.**
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
  /**
   * 사진에서 이 백본이 할 줄 아는 과제. **표에서는 `null`이고 아무것도 안 좁힌다.**
   *
   * **백본을 못 찾으면 좁히지 않는다.** 그 상태는 프로젝트가 모르는 백본을 가리키는
   * 것이고, 거기서 유형을 지우면 학생은 **이유 없이 비어 버린 목록**을 만난다 — 못 읽는
   * 이유를 말하는 자리는 여기가 아니다.
   */
  const byBackbone = dataType === 'image' ? (backboneFor(DEFAULT_BACKBONE_ID)?.tasks ?? null) : null

  return TASK_TYPES.filter(
    (taskType) =>
      (byBackbone === null || byBackbone.includes(taskType)) &&
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
