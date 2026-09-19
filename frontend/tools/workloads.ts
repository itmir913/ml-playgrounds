/**
 * **실측 하니스가 재는 일감** — 화면이 없는 쪽이다.
 *
 * `bench.ts`에서 갈라 둔 이유는 **DOM 없이도 같은 정의를 돌려 볼 수 있어야 하기
 * 때문이다** (CLAUDE.md §4 "검증 가능한 로직을 컴포넌트 밖으로 빼라"). 같은 사다리를
 * 브라우저와 Node에서 재서 견주는 것이 2026-08-31에 Edge를 잡아낸 방법이다.
 *
 * **배포되지 않는다** — `tools/`는 vite의 빌드 입력 밖이고 `tests/bench-rules.spec.ts`가
 * 그것을 지킨다.
 */

import {
  MLJS_DECISION_TREE_ROW_LIMIT,
  MLJS_IMAGE_DECISION_TREE_ROW_LIMIT,
  MLJS_IMAGE_RANDOM_FOREST_ROW_LIMIT,
  MLJS_IMAGE_SVM_ROW_LIMIT,
  MLJS_KNN_ROW_LIMIT,
  MLJS_RANDOM_FOREST_ROW_LIMIT,
  MLJS_SVM_ROW_LIMIT,
  PYODIDE_DECISION_TREE_ROW_LIMIT,
  PYODIDE_IMAGE_RANDOM_FOREST_ROW_LIMIT,
  PYODIDE_IMAGE_SVM_ROW_LIMIT,
  PYODIDE_KNN_ROW_LIMIT,
  PYODIDE_RANDOM_FOREST_ROW_LIMIT,
  PYODIDE_SVM_ROW_LIMIT,
} from '../src/limits'
import { backboneFor, DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import {
  CALIBRATION_JOBS,
  measureJob,
  runCalibration,
  syntheticData,
  type CalibrationJob,
} from '../src/ml/calibration'
import { fit } from '../src/ml/engines/mljs'
import { fitKMeans } from '../src/ml/engines/mljs-kmeans'
import { fitNeural } from '../src/ml/engines/neural'
import { fit as pyodideFit } from '../src/ml/engines/pyodide-sklearn'
import { evaluate, evaluateCluster } from '../src/ml/metrics'
import {
  NEURAL_FORMAT,
  NEURAL_REGRESSION_FORMAT,
  loadNeuralModel,
  loadNeuralRegressionModel,
} from '../src/ml/models'
import { bootPyodide } from '../src/ml/engines/pyodide-runtime'

/** 기본 특성 수. **특성 축은 알고리즘마다 따로 훑는다**(아래 `*_columns` 사다리들). */
const FEATURES = 8

/**
 * 사진 한 장의 특성 수. **백본에서 꺼낸다** — 여기 `1280`이라고 적으면 백본이 바뀌는 날
 * 이 사다리가 조용히 다른 것을 재게 된다.
 *
 * **임베딩이 아니라 합성 데이터다.** 재려는 것은 (행 수 × 이 차원)에서 엔진이 무엇을
 * 하느냐이고, 진짜 임베딩을 뽑으려면 사진 수천 장과 TF.js가 먼저 필요하다. **트리 계열은
 * 데이터의 난이도에 시간이 갈리므로**(`limits.ts`의 결정 트리 칸 — 같은 행 수에서 3배)
 * 여기서 나온 값은 그 축에서 정확하지 않다. 상한(깨지는 지점)에는 그것이 안 걸리고,
 * 기준표에는 걸린다.
 */
const IMAGE_FEATURES = ((): number => {
  const backbone = backboneFor(DEFAULT_BACKBONE_ID)
  if (backbone === undefined) throw new Error(`백본이 없다: ${DEFAULT_BACKBONE_ID}`)
  return backbone.embeddingDim
})()

/** 예측에 쓰는 비율. 앱의 평가가 시험 몫으로 지나가는 그 자리다. */
const PREDICT_RATIO = 0.2

/**
 * **한 점이 이보다 오래 걸리면 그 사다리를 멈춘다.** 상한까지 다 재려다 랜덤포레스트
 * 하나에 7분을 태울 이유가 없다 — 기준표는 보간용이고, 큰 쪽은 기울기로 잇는다.
 *
 * **상한을 재는 사다리는 이 천장을 안 쓴다** (`FAILURE_CEILING_MS`). 거기서는 오래
 * 걸리는 것이 답의 일부다.
 */
export const CEILING_MS = 20_000

/** **다음 점이 이보다 오래 걸릴 것 같으면 아예 시작하지 않는다.** 마지막 점의 증가율로 본다. */
export const PROJECTION_MS = 60_000

/**
 * **상한을 재는 사다리의 천장.** 폭주만 막는다 — **앱의 상한이 아니다**
 * (`open-decisions.md` "그러면 상한은 시간으로 정하는 것이 아니다").
 *
 * 여기서 찾는 것은 **반드시 실패하는 지점**(메모리 부족·탭이 죽는 곳)이고, 느린 것은
 * 상한이 아니라 예상 시간이 말할 몫이다. 그래서 한 시간까지 기다린다.
 */
export const FAILURE_CEILING_MS = 60 * 60 * 1000

export interface Job {
  readonly algorithm: string
  readonly rows: number
  readonly columns?: number
  readonly hyperparameters?: Record<string, number>
  readonly regression?: boolean
}

/**
 * 한 점을 잰다. **데이터 생성은 시계 밖이다** — 재려는 것은 학습이지 난수가 아니다.
 *
 * **예측까지 지나간다.** KNN은 학습이 0초이고 값이 예측에 있는데, 학생이 기다리는 것은
 * [학습하기]를 누르고 결과가 나올 때까지다.
 *
 * **평가까지 지나간다** (2026-09-01). 앱의 [학습하기]는 `fit` 뒤에 지표를 낸다. 그 단계를
 * 빼고 재던 표는 전부 조금씩 짧았고, **군집화는 그것이 지배적인 비용**이라 표가 두
 * 자릿수로 틀렸다 — 실루엣이 `O(행² × 특성)`이다. 분류·회귀의 지표는 `O(행)`이라 빠뜨려도
 * 티가 안 났지만, **티가 안 나는 것과 안 재는 것은 다르다.**
 *
 * **시계 밖에 남은 것이 있다** (2026-09-01 감사 A-2). 앱의 `runExperiment`는 `fit` 앞에
 * `fitPreprocessor`와 `transform`을 지나고, 사진은 그 앞에 임베딩의 문자열 왕복까지 있다
 * (`ml/images.ts`). 감사자 실측으로 **사진 5,000장에서 시계 안 1,504ms · 시계 밖 5,868ms**,
 * 표 10만 행 나이브 베이즈에서 156ms 대 415ms다. 즉 **싼 알고리즘일수록 이 표가 짧게
 * 틀린다.**
 *
 * **무엇을 예상하기로 했는지가 먼저 정해져야 고칠 수 있다** — 엔진만 재고 고정 비용을
 * `estimate.ts`가 따로 더할지, 전처리까지 시계 안에 넣을지. 결정 전까지 이 표는
 * **엔진의 시간**이고, 그 사실이 여기 적혀 있어야 다음 사람이 표를 오해하지 않는다
 * (`open-decisions.md` "학습 예상 시간은 실측표에 기기 배수를 곱해 낸다").
 */
export async function measure(job: Job): Promise<number> {
  return measureWith(fit, job)
}

/**
 * 같은 일감을 **scikit-learn(Pyodide)으로** 잰다.
 *
 * **시동은 시계 밖이다.** 시동은 데이터 크기와 무관한 고정 비용이라(`bootPyodide`)
 * 안에 넣으면 사다리의 모든 점에 같은 상수가 얹혀 **행 수 곡선이 평평해 보인다** —
 * 1,000행과 20,000행이 둘 다 *"15초쯤"*이 되고, 그 표로는 보간을 못 한다. 시동은
 * `parts.boot`에 따로 실어 나란히 남긴다.
 *
 * **`fit` 자리만 갈아 끼운다.** 데이터 생성·예측 비율·평가까지 표 쪽과 한 글자도 다르지
 * 않아야 두 엔진의 숫자를 나란히 놓을 수 있다 — 교정 일감이 *"목록만 같고 절차가
 * 갈렸던"* 그 병(감사 B-4)을 여기서 되풀이하지 않는다.
 */
async function measurePyodide(job: Job): Promise<LadderResult> {
  const { parts } = await bootPyodide()
  /**
   * **군집화는 데이터도 평가도 다르다.** 표 쪽이 `measureKMeans`를 따로 둔 것과 같은
   * 이유이고, 여기서 갈라 두면 **sklearn 사다리는 `run`을 안 써도 된다** — `run`이 있으면
   * 그 안에서 엔진을 다시 고르게 되고, 잘못 고른 것을 아무도 못 본다.
   */
  const measured =
    shapeFor(job) === 'clustering'
      ? await measureKMeansPyodide(job)
      : { elapsed: await measureWith(pyodideFit, job) }
  return { ...measured, parts: { ...parts, boot: parts.total } }
}

/**
 * **이 일감이 어떤 데이터와 어떤 평가를 요구하는가.**
 *
 * `measurerFor`와 같은 이유로 밖에 있다 — sklearn 사다리는 27MB를 받아서 검사가 못
 * 돌리는데, **군집 사다리가 분류 데이터로 재어지는 것**은 표 쪽에서 실제로 났던 결함이다
 * (R15-A-1). 돌리지 않고도 그 갈래를 확인할 수 있어야 한다.
 */
export function shapeFor(job: Job): 'clustering' | 'supervised' {
  return job.algorithm === 'k_means' ? 'clustering' : 'supervised'
}

/** 엔진 하나로 점 하나를 잰다. **위 둘이 공유하는 절차이고, 갈라지면 안 된다.** */
async function measureWith(engineFit: typeof fit, job: Job): Promise<number> {
  const { features, target } = syntheticData(
    job.rows,
    job.columns ?? FEATURES,
    job.regression ?? false,
  )
  const rowIndices = features.map((_, index) => index)
  const started = performance.now()
  const { predict } = await engineFit(job.algorithm, {
    features,
    rowIndices,
    target,
    taskType: job.regression ? 'regression' : 'classification',
    hyperparameters: job.hyperparameters ?? {},
    randomState: 42,
  })
  const shown = Math.max(1, Math.round(job.rows * PREDICT_RATIO))
  const predictions = predict(features.slice(0, shown))
  // 앱이 시험 몫으로 채점하는 그 자리다.
  evaluate(job.regression ? 'regression' : 'classification', target.slice(0, shown), predictions)
  return Math.round(performance.now() - started)
}

/**
 * **군집 구조가 없는 데이터.** K-평균의 반복 횟수를 데이터가 정하기 때문에 따로 만든다.
 *
 * `syntheticData`는 군집이 이미 갈려 있어 **몇 번 만에 수렴한다** — 그래서 기준표에
 * `1,000행 4ms`가 적혔고, 학생 화면이 `약 1초`라 말하는데 실제로는 훨씬 오래 걸렸다
 * (2026-08-31, 사용자). 여기는 값을 고르게 흩뿌려 **중심점이 자리를 못 잡게** 한다.
 * 천장은 `KMEANS_DEFAULTS.maxIter`(300)이다.
 *
 * **앱 쪽(`ml/calibration.ts`)에 안 두는 이유**는 교정 일감이 이 데이터를 안 쓰기
 * 때문이다. 저기 두면 앱 번들에 안 쓰는 생성기가 하나 들어간다.
 */
function uniformData(rows: number, columns: number): { features: number[][]; target: string[] } {
  let state = 42
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  const features: number[][] = []
  const target: string[] = []
  for (let row = 0; row < rows; row += 1) {
    const values: number[] = []
    for (let column = 0; column < columns; column += 1) values.push(random())
    features.push(values)
    // 군집화는 타깃을 안 본다. 자리만 채운다.
    target.push('')
  }
  return { features, target }
}

/**
 * **신경망은 `tol`을 0으로 놓고 잰다.** `LOGISTIC_CEILING`과 같은 물건이고 같은 이유다 —
 * 기준표는 **에폭 상한을 다 도는 경우**로 정의돼 있는데(`limits.ts`의
 * `MLJS_NEURAL_NETWORK_BASELINE_MS`), 기본 `tol`에서는 행이 늘수록 에폭이 줄어 표의 위쪽이
 * 천장이 아니게 된다.
 *
 * **등록부를 안 지난다** (`ml/engines/mljs-params.ts`에 `tol`이 없다). 그래서 이 값은
 * `measureNeural`이 엔진을 직접 부를 때만 붙고, 학생 경로는 기본값 그대로다.
 */
const NEURAL_CEILING = { tol: 0 } as const

/**
 * **에폭을 다 도는 신경망 한 번.** `measure`를 안 쓰는 이유는 K-평균과 같다 — 데이터가
 * 반복 횟수를 정한다.
 *
 * `syntheticData`는 라벨이 특성에서 곧장 나오는 쉬운 데이터라 **손실이 금세 평평해지고
 * `n_iter_no_change`가 200 에폭 전에 멈춘다.** 실제로 그 데이터에서는 50,000행이
 * 20,000행의 1.4배밖에 안 걸렸다(둘 다 잰 값이다) — 행이 늘수록 **에폭이 줄어서**다.
 * 그 표를 그대로 쓰면 어려운 데이터에서 예상이 짧게 틀린다.
 *
 * 여기는 **라벨이 특성과 무관한 데이터**를 주고, 거기에 **`tol: 0`을 함께 건다**
 * (`NEURAL_CEILING`). 로지스틱과 같은 자리이고 목적도 같다: **천장을 잰다.**
 *
 * **데이터만으로는 모자랐다** (2026-09-09). 라벨이 무관해도 20,000행에서는 은닉 100개가
 * 그 잡음을 못 외워 **31 에폭에 멈췄고**, 그래서 20,000행이 10,000행보다 빨랐다 —
 * 행이 늘수록 에폭이 줄어 표가 가장 필요한 큰 행 쪽에서 곡선이 꺾인다. `tol: 0`이면
 * 그 판정 자체가 안 선다 (`open-decisions.md` "신경망도 tol을 0으로 놓고 잰다").
 */
async function measureNeural(
  rows: number,
  columns: number,
  layers: number,
  neurons: number,
  regression = false,
): Promise<LadderResult> {
  let state = 42
  const random = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
  const features: number[][] = []
  const encoded: number[] = []
  for (let row = 0; row < rows; row += 1) {
    features.push(Array.from({ length: columns }, () => random()))
    // **라벨이 특성과 무관하다.** 그래서 손실이 평평해지지 않는다.
    encoded.push(random() < 0.5 ? 0 : 1)
  }
  const classes = ['a', 'b']
  const target = encoded.map((one) => classes[one] as string)

  /**
   * **회귀는 이진 분류와 망 크기가 같다** — 출력이 양쪽 다 한 칸이다. 그래서 기준표를
   * 한 벌로 쓰는데, **그 말이 사실인지는 재야 안다** (`limits.ts`의 기준표 주석).
   */
  const targets = regression ? encoded.map((one) => one * 10 + 5) : encoded
  const started = performance.now()
  const fitted = await fitNeural(
    features,
    targets,
    regression ? { kind: 'regression' } : { kind: 'classification', classCount: classes.length },
    { hiddenLayers: layers, neuronsPerLayer: neurons, ...NEURAL_CEILING },
    42,
  )
  // **예측과 평가까지 지나간다** — 다른 사다리와 같은 자리를 재려면 그래야 한다
  // (`measure`의 머리말). 학생이 기다리는 것은 [학습하기]를 누르고 결과가 나올 때까지다.
  const layerFile = {
    featureCount: columns,
    weights: fitted.weights,
    intercepts: fitted.intercepts,
    lossCurve: fitted.lossCurve,
  }
  const predict = regression
    ? loadNeuralRegressionModel({ format: NEURAL_REGRESSION_FORMAT, ...layerFile })
    : loadNeuralModel({ format: NEURAL_FORMAT, classes, ...layerFile })
  const shown = Math.max(1, Math.round(rows * PREDICT_RATIO))
  evaluate(
    regression ? 'regression' : 'classification',
    (regression ? targets : target).slice(0, shown),
    predict(features.slice(0, shown)),
  )
  return { elapsed: Math.round(performance.now() - started), iterations: fitted.epochs }
}

/**
 * 점 하나의 결과. **반복 횟수는 자기 데이터로 재는 사다리(`run`)만 답한다** — 지금은
 * K-평균과 신경망 둘이다.
 */
export interface LadderResult {
  readonly elapsed: number
  /**
   * 반복이 몇 번 돌았나 — K-평균은 Lloyd 반복, 신경망은 에폭이다. **데이터가 정하는
   * 값이라 손잡이가 아니다.**
   *
   * **이게 없으면 특성 축을 못 읽는다** (2026-09-01 R17 감사 C-3). K-평균 한 번의 비용은
   * `O(행 × k × 특성 × 반복)`이라 **반복 하나의 비용은 특성에 선형이어야 하는데**,
   * 잰 사다리는 특성이 늘수록 내려간다. 내려간 것이 열 비용인지 반복 횟수인지는 ms
   * 하나로 절대 안 갈리고, **엔진은 이미 이 수를 세고 있다**(`mljs-kmeans.ts`).
   *
   * **신경망이 그 칸으로 잡혔다** (2026-09-09). 20,000행이 10,000행보다 빠른 것이
   * ms만으로는 잡음처럼 보였는데, 옆에 실린 `31`이 *"에폭이 줄었다"*고 말했다. 그래서
   * 이 칸은 K-평균만의 것이 아니다 (`open-decisions.md` "신경망도 tol을 0으로 놓고 잰다").
   */
  readonly iterations?: number
  /**
   * 국면마다 몇 ms인가. **scikit-learn 사다리만 답한다** — 시동이 넷으로 갈리고
   * (`BootParts`), 그 넷을 합계 하나로 뭉치면 **어디를 고쳐야 하는지가 사라진다.**
   *
   * **`elapsed`에는 안 들어간다.** 시동은 데이터와 무관한 고정 비용이라 시계 밖이고,
   * 여기 실린 값은 그 옆에 나란히 놓으라고 있는 것이다 (`measurePyodide`).
   */
  readonly parts?: Readonly<Record<string, number>>
  /**
   * **파이썬이 스스로 답한 버전들.** 시동 실측만 답한다.
   *
   * 우리가 적은 못(`PYODIDE_VERSION`)이 아니라 **실제로 뜬 것**이라, 원격이 조용히
   * 바뀌면 여기서 먼저 드러난다. `run.engine.version`에 무엇을 담을지가 이 값에 걸려 있다.
   */
  readonly versions?: Readonly<Record<string, string>>
}

/** 위 데이터로 K-평균 한 번. **`measure`를 안 쓰는 이유는 데이터가 다르기 때문이다.** */
function measureKMeans(rows: number, clusters: number, columns: number = FEATURES): LadderResult {
  const { features } = uniformData(rows, columns)
  const started = performance.now()
  // **엔진을 직접 부른다.** 평가에 배정과 중심점이 필요한데 `fit`은 그것을 안 돌려준다.
  const result = fitKMeans(features, clusters, 42)
  // **여기가 군집화의 진짜 비용이다** (`open-decisions.md` "실루엣 계수는 표본으로 낸다").
  evaluateCluster(features, result.assignments, result.centroids, 42)
  return { elapsed: Math.round(performance.now() - started), iterations: result.iterations }
}

/**
 * 같은 데이터로 **sklearn의** K-평균 한 번.
 *
 * **반복 횟수를 안 답한다.** 우리 엔진은 Lloyd 반복을 세어 돌려주지만(`mljs-kmeans.ts`)
 * sklearn의 `n_iter_`는 어댑터의 `clusterResult`에 없다 — **없는 수를 0으로 채우지
 * 않는다**(`LadderResult.iterations`의 규칙). 필요해지면 어댑터가 그 칸을 갖는 것이 먼저다.
 */
async function measureKMeansPyodide(job: Job): Promise<LadderResult> {
  const clusters = Number(job.hyperparameters?.n_clusters ?? 0)
  // **일감이 군집 수를 안 들고 오면 잰 것이 사다리가 아니다.** 기본값으로 메우면
  // 사다리의 점과 실제로 돈 `k`가 갈리고, 그 표는 조용히 다른 축을 말한다.
  if (!Number.isInteger(clusters) || clusters < 2) {
    throw new Error(`k_means ladder needs n_clusters: ${String(job.hyperparameters?.n_clusters)}`)
  }
  const { features } = uniformData(job.rows, job.columns ?? FEATURES)
  const rowIndices = features.map((_, index) => index)
  const started = performance.now()
  const { clusterResult } = await pyodideFit('k_means', {
    features,
    rowIndices,
    target: features.map(() => ''),
    taskType: 'clustering',
    hyperparameters: { n_clusters: clusters },
    randomState: 42,
  })
  if (clusterResult === undefined) throw new Error('k_means did not return clusters')
  // 표 쪽과 같은 자리를 잰다 — 군집화의 진짜 비용은 여기다.
  evaluateCluster(features, clusterResult.assignments, clusterResult.centroids, 42)
  return { elapsed: Math.round(performance.now() - started) }
}

/**
 * 사다리가 흔드는 축들. **어림의 지수를 이 목록이 정한다**(`projectionExponent`).
 *
 * **타입이 아니라 값이다** (2026-09-01 R17 감사 C-4). 타입만 있으면 축을 훑는 코드가
 * 목록을 손으로 다시 적어야 하고, 그 목록은 축이 늘어도 안 는다.
 */
export const AXES = [
  'rows',
  'nEstimators',
  'maxIter',
  'columns',
  'nClusters',
  'hiddenLayers',
  'neuronsPerLayer',
] as const

export type Axis = (typeof AXES)[number]

/**
 * 사다리가 무엇으로 재는가. **없으면 순수 JS다** — 오늘 사다리의 대부분이 그쪽이고,
 * 줄마다 `engine: 'mljs'`를 적게 하면 그 글자가 아무것도 안 막으면서 길어지기만 한다.
 *
 * **축이 필요한 이유는 등록부가 엔진마다 다른 칸을 갖기 때문이다** — `maxRows`와
 * `baseline`이 (알고리즘 × 종류 × 브라우저 실행 방법)이라(`ml/algorithms.ts`), 같은
 * 알고리즘의 두 사다리가 **다른 칸을 채운다.** 이름만으로 가르면
 * `tests/bench-rules.spec.ts`의 덮개 검사가 **sklearn 사다리 하나로 순수 JS 칸이 찼다고
 * 말한다.**
 */
export type LadderEngine = 'mljs' | 'pyodide-sklearn'

/** 사다리 하나. `points`가 무엇을 바꾸는지는 `axis`가 말한다. */
export interface Ladder {
  readonly id: string
  readonly label: string
  readonly axis: Axis
  readonly points: readonly number[]
  readonly job: (point: number) => Job
  /** 무엇으로 재나. **없으면 순수 JS다** (`LadderEngine`). */
  readonly engine?: LadderEngine
  /**
   * 이 사다리가 **자기 데이터로** 재는가. 없으면 `measure(job(point))`를 쓴다.
   *
   * **둘이 갖는다 — K-평균과 신경망.** 양쪽 다 반복 횟수를 데이터가 정하는데 공용
   * 생성기로는 천장을 안 지난다: K-평균은 군집이 이미 갈려 있어 즉시 수렴하고(위
   * `uniformData`), 신경망은 라벨이 특성에서 곧장 나와 손실이 금세 평평해진다
   * (위 `measureNeural`).
   */
  readonly run?: (point: number) => LadderResult | Promise<LadderResult>
  /**
   * **상한을 찾는 사다리인가.** 기준표를 만드는 사다리와 목적이 다르다.
   *
   * - 20초 천장을 안 쓴다. **오래 걸리는 것이 답의 일부다**(`FAILURE_CEILING_MS`).
   * - [전부 훑기]에 안 들어간다. 몇 시간짜리라 따로 돌린다.
   * - 던지면 그 자리가 답이다 — 메모리 부족이 그렇게 온다.
   */
  readonly findsLimit?: true
  /**
   * **이 사다리에서 시간이 축을 따라 몇 제곱으로 붙나.** 없으면 축의 기본값
   * (`projectionExponent`).
   *
   * **행 축의 기본값이 2인 것은 트리 계열 때문이다** — 분할 탐색이 노드마다
   * `O(특성 × 행²)`이라 다음 점을 크게 잡아야 폭주를 막는다. **에폭이 고정된 솔버는
   * 행에 선형**이라 그 규칙이 맞지 않고, 실제로 인공신경망 사다리가 첫 점을 재고
   * *"다음 점의 어림이 크다"*로 멈췄다 (2026-09-03). 재려던 것을 못 재는 어림은
   * 안전장치가 아니라 고장이다.
   */
  readonly growth?: number
}

/**
 * **로지스틱은 `tol`을 0으로 놓고 잰다.**
 *
 * 결정문이 "로지스틱의 예상은 `maxIter`가 다 도는 경우로 잡는다"이고, `tol: 0`이면 항상
 * 다 돈다. **그래야 절벽이 사라진다** — 고정 `tol`에서는 20,000행 0.2초와 24,000행
 * 16초가 이웃이라(결정문의 표) 행 수 보간이 통째로 거짓말이 된다. 천장을 재면 매끄럽다.
 */
const LOGISTIC_CEILING = { tol: 0, maxIter: 100 }

/**
 * **같은 물건의 sklearn 어휘다.** 이름이 다른 이유는 손잡이 이름이 엔진마다 다르기
 * 때문이고(`maxIter` 대 `max_iter`), 그것이 하이퍼파라미터를 (알고리즘 × 실행 방법)으로
 * 만든 이유다 (`ml/engines/pyodide-sklearn-params.ts`).
 */
const PYODIDE_LOGISTIC_CEILING = { tol: 0, max_iter: 100 }

export const LADDERS: readonly Ladder[] = [
  {
    id: 'naive_bayes',
    label: '나이브 베이즈 · 행 수',
    axis: 'rows',
    points: [1000, 5000, 20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'naive_bayes', rows }),
  },
  {
    id: 'linear_regression',
    label: '선형 회귀 · 행 수',
    axis: 'rows',
    points: [1000, 5000, 20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'linear_regression', rows, regression: true }),
  },
  {
    /**
     * **군집이 없는 데이터에서의 행 수.** 지금 기준표는 군집이 갈린 데이터라 몇 번 만에
     * 수렴하는데, 학생 데이터가 늘 그렇지는 않다. 이쪽이 "길게 틀린다"에 맞는 쪽이다.
     */
    id: 'k_means_hard',
    label: 'K-평균 · 행 수 (군집 없는 데이터, k=3)',
    axis: 'rows',
    points: [1000, 5000, 20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'k_means', rows, hyperparameters: { nClusters: 3 } }),
    run: (rows) => measureKMeans(rows, 3),
  },
  {
    /**
     * **`k`는 지배적인 손잡이다.** 비용이 `O(행 × k × 특성 × 반복)`이라 `k`에 선형인데,
     * 결정문이 `k`를 "시간을 크게 안 바꾸는 나머지"로 묶어 두었다 — **그게 틀렸다.**
     * 손잡이가 2에서 20까지 열려 있으니 그것만으로 열 배다.
     */
    id: 'k_means_clusters',
    label: 'K-평균 · 군집 수 (군집 없는 데이터, 20,000행)',
    axis: 'nClusters',
    points: [2, 5, 10, 20],
    job: (clusters) => ({
      algorithm: 'k_means',
      rows: 20_000,
      hyperparameters: { nClusters: clusters },
    }),
    run: (clusters) => measureKMeans(20_000, clusters),
  },
  {
    id: 'logistic_regression',
    label: '로지스틱 회귀 · 행 수 (maxIter 100 천장)',
    axis: 'rows',
    points: [1000, 5000, 20_000, 50_000, 100_000],
    job: (rows) => ({
      algorithm: 'logistic_regression',
      rows,
      hyperparameters: LOGISTIC_CEILING,
    }),
  },
  {
    id: 'logistic_regression_iterations',
    label: '로지스틱 회귀 · maxIter (20,000행)',
    axis: 'maxIter',
    points: [25, 50, 100, 200],
    job: (maxIter) => ({
      algorithm: 'logistic_regression',
      rows: 20_000,
      hyperparameters: { tol: 0, maxIter },
    }),
  },
  {
    /**
     * **천장까지 올려 본다.** 앱이 허용하는 `maxIter`는 1000까지인데, 20,000행 사다리는
     * 200에서 이미 20초라 거기까지 못 간다. 행 수를 낮춰 **곡선의 모양**을 본다 —
     * 25→50이 10.5배인데 100→200은 2.5배라(2026-08-31 Node) 초반이 유난히 싸다.
     * 이 모양을 모르고 200에서 1000을 외삽하면 크게 틀린다.
     */
    id: 'logistic_regression_iterations_deep',
    label: '로지스틱 회귀 · maxIter 천장까지 (2,000행)',
    axis: 'maxIter',
    points: [100, 200, 400, 800, 1000],
    job: (maxIter) => ({
      algorithm: 'logistic_regression',
      rows: 2000,
      hyperparameters: { tol: 0, maxIter },
    }),
  },
  {
    /**
     * **에폭 상한을 다 도므로 행 수에 선형이다** — 한 에폭의 비용이 `O(행 × 가중치 수)`이고
     * `max_iter`가 200에 고정이다.
     *
     * **"언제나 천장을 지난다"가 여기 적혀 있었고 틀렸다** (2026-09-09). 로지스틱의
     * 절벽이 모양만 바꿔서 여기도 있었다 — 저쪽은 수렴하면 빨라지고, 이쪽은 **행이
     * 늘수록 에폭이 줄어** 20,000행이 10,000행보다 빨랐다. 천장을 지나게 하는 것은
     * 데이터가 아니라 `NEURAL_CEILING`이다.
     */
    id: 'neural_network',
    label: '인공신경망 · 행 수 (1층 × 100뉴런)',
    axis: 'rows',
    points: [1000, 2000, 5000, 10_000, 20_000],
    job: (rows) => ({ algorithm: 'neural_network', rows }),
    run: (rows) => measureNeural(rows, FEATURES, 1, 100),
    growth: 1,
  },
  {
    /**
     * **위 사다리가 못 가는 한 점.** `tol: 0`을 걸면 20,000행이 `CEILING_MS`(20초) 위로
     * 올라가고, 그러면 그 다음 점은 **앞 점이 천장을 넘겼다**로 선다.
     *
     * **천장을 올리지 않는다** — 그것은 모든 사다리를 함께 올리는 값이고, 랜덤포레스트
     * 하나에 7분을 태우지 않으려고 거기 있다. 대신 **첫 점으로 들어간다**: `stopReason`은
     * 앞 점으로만 판정하므로 앞이 없는 점은 언제나 돈다.
     *
     * `logistic_regression_iterations_deep`이 같은 자리에 있다 — 본 사다리가 서는 곳
     * 너머의 모양을 따로 보려고 두는 한 판이다.
     *
     * **여기가 표의 끝인 이유**는 `MLJS_NEURAL_NETWORK_ROW_LIMIT`이 100,000이라서가
     * 아니다. 100,000행은 이 기계에서 4분이 넘고, **표는 보간용이라 큰 쪽은 기울기로
     * 잇는다**(`ml/estimate.ts`의 `interpolate`).
     */
    id: 'neural_network_deep',
    label: '인공신경망 · 행 수 천장 너머 한 점 (50,000행 · 1층 × 100뉴런)',
    axis: 'rows',
    points: [50_000],
    job: (rows) => ({ algorithm: 'neural_network', rows }),
    run: (rows) => measureNeural(rows, FEATURES, 1, 100),
    growth: 1,
  },
  {
    /**
     * **회귀가 분류와 같은 시간인지 잰다.** 기준표를 한 벌로 쓰기로 한 근거가 그것이고,
     * **근거는 재서 얻는다** — 출력이 양쪽 다 한 칸이라는 사실만으로는 문장이 아니다.
     */
    id: 'neural_network_regression',
    label: '인공신경망 · 회귀 · 행 수 (1층 × 100뉴런)',
    axis: 'rows',
    points: [1000, 2000, 5000],
    job: (rows) => ({ algorithm: 'neural_network', rows, regression: true }),
    run: (rows) => measureNeural(rows, FEATURES, 1, 100, true),
    growth: 1,
  },
  {
    /**
     * **뉴런 수는 지배적인 손잡이다.** 은닉층이 하나일 때 가중치 수가 `특성 × 뉴런`이라
     * 선형이어야 하는데, **그것이 사실인지는 재야 안다** — 층이 둘 이상이면 `뉴런²`이
     * 되고 그때 이 사다리의 모양이 갈린다.
     */
    id: 'neural_network_neurons',
    label: '인공신경망 · 층당 뉴런 수 (2,000행 · 1층)',
    axis: 'neuronsPerLayer',
    points: [25, 50, 100, 200],
    job: (neurons) => ({
      algorithm: 'neural_network',
      rows: 2000,
      hyperparameters: { hiddenLayers: 1, neuronsPerLayer: neurons },
    }),
    run: (neurons) => measureNeural(2000, FEATURES, 1, neurons),
  },
  {
    /**
     * **층을 늘리면 `뉴런²`짜리 덩어리가 하나씩 는다.** 첫 층만 `특성 × 뉴런`이라
     * 1층에서 2층 사이가 가장 크게 뛴다 — 그 모양을 모르고 곱셈으로 어림하면 크게 틀린다.
     */
    id: 'neural_network_layers',
    label: '인공신경망 · 은닉층 수 (2,000행 · 100뉴런)',
    axis: 'hiddenLayers',
    points: [1, 2, 3, 5],
    job: (layers) => ({
      algorithm: 'neural_network',
      rows: 2000,
      hyperparameters: { hiddenLayers: layers, neuronsPerLayer: 100 },
    }),
    run: (layers) => measureNeural(2000, FEATURES, layers, 100),
  },
  {
    /**
     * **곱셈 규칙이 맞는지 보는 자리.** 두 손잡이의 배수를 따로 재서 곱하면 예상이
     * 나오는가 — `estimate.ts`가 실제로 그렇게 계산하므로 **그 가정 자체를 재 둔다.**
     * 어긋나면 곱셈이 아니라 다른 모양이 필요하다는 뜻이다.
     */
    id: 'neural_network_both',
    label: '인공신경망 · 두 손잡이를 함께 (2,000행 · 2층 × 200뉴런)',
    axis: 'neuronsPerLayer',
    points: [200],
    job: (neurons) => ({
      algorithm: 'neural_network',
      rows: 2000,
      hyperparameters: { hiddenLayers: 2, neuronsPerLayer: neurons },
    }),
    run: (neurons) => measureNeural(2000, FEATURES, 2, neurons),
  },
  {
    id: 'neural_network_columns',
    label: '인공신경망 · 특성 수 (2,000행 · 1층 × 100뉴런)',
    axis: 'columns',
    points: [4, 8, 16, 32],
    job: (columns) => ({ algorithm: 'neural_network', rows: 2000, columns }),
    run: (columns) => measureNeural(2000, columns, 1, 100),
  },
  {
    id: 'knn',
    label: 'KNN · 행 수 (학습 + 20% 예측)',
    axis: 'rows',
    points: [1000, 2000, 5000, 10_000],
    job: (rows) => ({ algorithm: 'knn', rows }),
  },
  {
    id: 'decision_tree',
    label: '의사결정트리 · 행 수',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 5000, 10_000, 20_000],
    job: (rows) => ({ algorithm: 'decision_tree', rows }),
  },
  /**
   * **특성 축은 알고리즘마다 따로 잰다.**
   *
   * 이론으로는 넷 다 특성 수에 선형이다 — 트리의 분할 탐색도, 로지스틱의 행렬곱도,
   * KNN의 거리 계산도, SVM의 커널도 특성 하나가 늘면 그만큼 일이 는다. **그래도 잰다.**
   * 이 저장소는 재 보지 않은 칸에 숫자를 넣지 않고(`limits.ts`의 `UNMEASURED`),
   * "이론상 선형"과 "재 보니 선형"은 다음 사람에게 다른 문장이다.
   */
  {
    id: 'decision_tree_columns',
    label: '의사결정트리 · 특성 수 (2,000행)',
    axis: 'columns',
    points: [4, 8, 16, 32],
    job: (columns) => ({ algorithm: 'decision_tree', rows: 2000, columns }),
  },
  {
    id: 'logistic_regression_columns',
    label: '로지스틱 회귀 · 특성 수 (2,000행)',
    axis: 'columns',
    points: [4, 8, 16, 32],
    job: (columns) => ({
      algorithm: 'logistic_regression',
      rows: 2000,
      columns,
      hyperparameters: LOGISTIC_CEILING,
    }),
  },
  {
    id: 'knn_columns',
    label: 'KNN · 특성 수 (5,000행)',
    axis: 'columns',
    points: [4, 8, 16, 32],
    job: (columns) => ({ algorithm: 'knn', rows: 5000, columns }),
  },
  {
    id: 'svm_columns',
    label: 'SVM · 특성 수 (1,000행)',
    axis: 'columns',
    points: [4, 8, 16, 32],
    job: (columns) => ({ algorithm: 'svm', rows: 1000, columns }),
  },
  {
    id: 'naive_bayes_columns',
    label: '나이브 베이즈 · 특성 수 (50,000행)',
    axis: 'columns',
    points: [4, 8, 16, 32],
    job: (columns) => ({ algorithm: 'naive_bayes', rows: 50_000, columns }),
  },
  {
    id: 'linear_regression_columns',
    label: '선형 회귀 · 특성 수 (50,000행)',
    axis: 'columns',
    points: [4, 8, 16, 32],
    job: (columns) => ({ algorithm: 'linear_regression', rows: 50_000, columns, regression: true }),
  },
  {
    /**
     * **넷 중 이 사다리만 `run`이 없어 다른 것을 재고 있었다** (2026-09-01 감사 A-1).
     *
     * `run`이 없으면 `measure()`로 가고, 그것은 **군집이 이미 갈린 데이터**에 **분류
     * 지표**를 얹는다 — 앱이 하는 일도, `MLJS_KMEANS_BASELINE_MS`를 잰 방식도 아니다.
     *
     * **특성 축의 방향이 행 수에서 뒤집힌다** (2026-09-01 R16-B 실측). 실루엣 표본이
     * `1/√특성`으로 줄어(`ml/metrics.ts`), **표본이 행 수보다 작아지는 순간부터 특성이
     * 늘수록 총 시간이 준다.** 경계는 특성 4에서 12,500행이다.
     *
     * | 행 | 특성 8 → 32 | 어느 국면 |
     * |---|---|---|
     * | 2,000 | ×2.9 | 전수 |
     * | 4,000 | ×3.4 | 전수 |
     * | 20,000 | ×1.00 | 표본 |
     * | 50,000 | ×0.51 | 표본 |
     *
     * **표본 국면의 수는 한 번 잰 것이라 흔들린다** (2026-09-01 R17 감사 C-3). 감사자가
     * 같은 축을 다시 재니 50,000행이 ×0.88, 20,000행이 ×1.27이었다 — **바로 아래 문단이
     * *"실측 한 번으로 사다리 배치를 정하지 마라"*고 적어 놓고 위 표를 단정으로 실었다.**
     * 방향(표본 국면에서 완만하거나 내려간다)은 두 번 다 같았고, **배수는 못 믿는다.**
     *
     * **그래서 사다리가 둘이다.** 하나로는 한 국면만 보게 된다.
     *
     * **그런데 이 표가 재는 것이 열 비용이 아닐 수 있다.** `uniformData`는 군집이 없는
     * 균일 난수라 차원이 오르면 거리가 몰려(거리 집중) **Lloyd 반복이 더 일찍 멈춘다** —
     * 그러면 내려간 것은 열당 비용이 아니라 반복 횟수다. **두 사다리 다 같은 생성기를
     * 쓰므로 다시 돌려도 이 질문에는 답이 안 나온다.** 그래서 하니스가 점마다 **반복
     * 횟수를 ms 옆에 싣는다**(`bench.ts`의 `iterations`) — `ms / 반복`이 그 답이다.
     * 등록부(`ml/algorithms.ts`의 `k_means`)가 그 판단을 갖는다.
     */
    id: 'k_means_columns_full',
    label: 'K-평균 · 특성 수 (군집 없는 데이터, 2,000행 · 전수)',
    axis: 'columns',
    points: [4, 8, 16, 32],
    job: (columns) => ({
      algorithm: 'k_means',
      rows: 2000,
      columns,
      hyperparameters: { nClusters: 3 },
    }),
    run: (columns) => measureKMeans(2000, 3, columns),
  },
  {
    /**
     * 위 사다리의 표본 국면 짝. **행 수를 50,000으로 되돌렸다** (2026-09-01 R16-B).
     *
     * 20,000으로 내렸던 근거가 *"첫 점이 13.5초라 `PROJECTION_MS`가 둘째 점을 막는다"*
     * 였는데 **산술이 틀렸다** — 막으려면 15,000ms를 넘어야 했고, 축 지수를 선형으로
     * 바꾼 지금은 30,000ms다. 실측으로 50,000행 네 점이 전부 남는다
     * (10,977 · 7,203 · 4,269 · 3,664ms).
     *
     * **같은 점이 3배 흔들린다는 것도 그때 드러났다**(20,000×4가 7,577 / 3,805 / 2,505 /
     * 7,501ms). **실측 한 번으로 사다리 배치를 정하지 마라** — 하니스는 사다리 점을 한
     * 번만 잰다.
     *
     * 50,000행이면 `naive_bayes_columns`·`linear_regression_columns`와 같은 자리라
     * 특성 축을 알고리즘끼리 견줄 수 있다.
     */
    id: 'k_means_columns',
    label: 'K-평균 · 특성 수 (군집 없는 데이터, 50,000행 · 표본)',
    axis: 'columns',
    points: [4, 8, 16, 32],
    job: (columns) => ({
      algorithm: 'k_means',
      rows: 50_000,
      columns,
      hyperparameters: { nClusters: 3 },
    }),
    run: (columns) => measureKMeans(50_000, 3, columns),
  },
  {
    id: 'random_forest_columns',
    label: '랜덤 포레스트 · 특성 수 (500행)',
    axis: 'columns',
    points: [4, 8, 16, 32],
    job: (columns) => ({ algorithm: 'random_forest', rows: 500, columns }),
  },
  {
    id: 'svm',
    label: 'SVM · 행 수',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 3000],
    job: (rows) => ({ algorithm: 'svm', rows }),
  },
  {
    id: 'random_forest',
    label: '랜덤 포레스트 · 행 수 (기본 그루 수)',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 5000],
    job: (rows) => ({ algorithm: 'random_forest', rows }),
  },
  /**
   * **사진 쪽 기준표 — 넷은 여기서 다 찬다** (2026-09-01).
   *
   * **지금 등록부의 이미지 기준표는 하나도 안 차 있어(`UNMEASURED_BASELINE`) 사진 프로젝트는
   * 학습 예상 시간을 아예 못 낸다** (`ml/algorithms.ts`, `estimate.ts`가 그 자리에
   * `알 수 없음`을 남긴다). 상한을 끄는 스위치가 오면 예상이 그 짝인데
   * (`open-decisions.md` "상한은 누가 정했느냐" §2), **사진에는 짝이 될 것이 없다.**
   *
   * **표에서 쓰던 특성 배수로는 못 메운다.** 예상은 표 기준표(특성 8개)에 `특성/8`을
   * 곱하는데(`estimate.ts`), 1,280차원은 그 160배 자리라 재 보지 않은 외삽이다.
   * 게다가 KNN과 로지스틱은 특성에 곱하지도 않는다(`columns: 'flat'`) — 사진에서 그
   * 판정이 그대로일 이유가 없다. **그래서 사진은 사진으로 잰다.**
   *
   * **여기 넷은 상한이 이미 `MAX_IMAGE_COUNT`에 붙어 있는 것들이다.** 남은 셋(트리 ·
   * 랜덤 포레스트 · SVM)은 상한 사다리가 같은 점을 훨씬 위까지 재므로 그쪽이 기준표도
   * 겸한다 — 같은 일을 두 번 시키지 않는다.
   */
  {
    id: 'image_naive_bayes',
    label: '[사진] 나이브 베이즈 · 장 수',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 4000, 5000],
    job: (rows) => ({ algorithm: 'naive_bayes', rows, columns: IMAGE_FEATURES }),
  },
  {
    /**
     * **첫 층이 통째로 커진다.** 임베딩이 1,280차원이라 기본 손잡이에서도 가중치가
     * `1280 × 100 + 100 = 128,100`개 — 표 데이터 기본값(900)의 **142배**다. 그래서
     * 이 사다리가 사진에서 이 모델을 열 수 있는지를 정한다.
     *
     * **에폭 천장으로 잰다** (`measureNeural`) — 다른 사다리와 같은 이유다.
     */
    id: 'image_neural_network',
    label: '[사진] 인공신경망 · 장 수 (1층 × 100뉴런)',
    axis: 'rows',
    points: [125, 250, 500, 1000],
    job: (rows) => ({ algorithm: 'neural_network', rows, columns: IMAGE_FEATURES }),
    run: (rows) => measureNeural(rows, IMAGE_FEATURES, 1, 100),
    // **행에 선형이다** — 실측 148ms/장이 네 점에서 그대로다 (`limits.ts`).
    growth: 1,
  },
  {
    id: 'image_logistic_regression',
    label: '[사진] 로지스틱 회귀 · 장 수 (maxIter 100 천장)',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 4000, 5000],
    job: (rows) => ({
      algorithm: 'logistic_regression',
      rows,
      columns: IMAGE_FEATURES,
      hyperparameters: LOGISTIC_CEILING,
    }),
  },
  {
    /** **값이 예측에 있다.** 표 쪽과 같은 이유로 학습만 재면 0초로 보인다. */
    id: 'image_knn',
    label: '[사진] KNN · 장 수 (학습 + 20% 예측)',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 4000, 5000],
    job: (rows) => ({ algorithm: 'knn', rows, columns: IMAGE_FEATURES }),
  },
  {
    /** **군집이 없는 데이터로 잰다.** 표 쪽에서 옛 기준표를 두 자릿수로 틀리게 한 그 축이다. */
    id: 'image_k_means',
    label: '[사진] K-평균 · 장 수 (군집 없는 데이터, k=3)',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 4000, 5000],
    job: (rows) => ({
      algorithm: 'k_means',
      rows,
      columns: IMAGE_FEATURES,
      hyperparameters: { nClusters: 3 },
    }),
    run: (rows) => measureKMeans(rows, 3, IMAGE_FEATURES),
  },
  {
    id: 'random_forest_trees',
    label: '랜덤 포레스트 · 그루 수 (1,000행)',
    axis: 'nEstimators',
    points: [10, 25, 50, 100],
    job: (nEstimators) => ({
      algorithm: 'random_forest',
      rows: 1000,
      hyperparameters: { nEstimators },
    }),
  },
]

/**
 * **상한을 찾는 사다리.** 지금 상한에서 시작해 그 종류의 천장(표는 10만 행, 사진은
 * `MAX_IMAGE_COUNT`)까지 민다 (`open-decisions.md` "그러면 상한은 시간으로 정하는 것이
 * 아니다").
 *
 * **표 쪽이 넷뿐인 이유**는 나머지 넷이 이미 `MAX_DATASET_ROWS`에 붙어 있어서다 — 그
 * 위는 이 앱이 데이터로 받지도 않는다. **사진 쪽도 같은 셈으로 셋이다.**
 *
 * **찾는 것은 느린 지점이 아니라 깨지는 지점이다.** SVM은 N×N 커널이라 메모리에서
 * 먼저 죽을 것이고, 그게 상한이다. 나머지는 오래 걸릴 뿐일 수 있는데 **그건 상한이
 * 아니다** — 예상 시간이 말하고 학생이 정한다.
 */
const LIMIT_LADDERS: readonly Ladder[] = [
  {
    id: 'limit_svm',
    label: `상한 찾기 · SVM (지금 ${MLJS_SVM_ROW_LIMIT.toLocaleString()})`,
    axis: 'rows',
    points: [8000, 12_000, 20_000],
    job: (rows) => ({ algorithm: 'svm', rows }),
  },
  {
    id: 'limit_random_forest',
    label: `상한 찾기 · 랜덤 포레스트 (지금 ${MLJS_RANDOM_FOREST_ROW_LIMIT.toLocaleString()})`,
    axis: 'rows',
    points: [5000, 10_000, 20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'random_forest', rows }),
  },
  {
    id: 'limit_knn',
    label: `상한 찾기 · KNN (지금 ${MLJS_KNN_ROW_LIMIT.toLocaleString()})`,
    axis: 'rows',
    points: [50_000, 100_000],
    job: (rows) => ({ algorithm: 'knn', rows }),
  },
  {
    id: 'limit_decision_tree',
    label: `상한 찾기 · 의사결정트리 (지금 ${MLJS_DECISION_TREE_ROW_LIMIT.toLocaleString()})`,
    axis: 'rows',
    points: [50_000, 100_000],
    job: (rows) => ({ algorithm: 'decision_tree', rows }),
  },
  /**
   * **사진 쪽 셋.** 2026-09-01에 표 쪽 상한을 다시 재면서 사진 칸은 손대지 않았고,
   * 그래서 `MLJS_IMAGE_*_ROW_LIMIT` 일곱이 **2026-08-14의 근거 그대로** 남았다.
   *
   * **이 일곱은 기준표 칸과 다른 물건이다** (2026-09-01 R17 감사 C-5). 저쪽은 예상
   * 시간의 표(`baseline.image`)이고 이쪽은 행 상한이라 수도 다르다 — 한때 이 파일이
   * 둘을 같은 `일곱`으로 불러서, **저장소가 같은 낱말로 두 사실을 말했다.**
   *
   * **그 근거가 시간이다** — *"500장 113초"* · *"1,000장 58.7초"*. 표 쪽에서 그것이
   * 상한의 근거가 아니라고 정했으므로(위 결정문), 사진 쪽도 같은 질문을 다시 받아야 한다:
   * **어디서 깨지는가.**
   *
   * **작은 점부터 시작하는 이유는 기준표를 겸하기 때문이다.** 이 셋은 사진 기준표도
   * 비어 있어(`UNMEASURED_BASELINE`), 상한을 찾는 김에 그 표를 함께 채운다. 20초
   * 천장에 안 걸리는 사다리라야 큰 점까지 남는다.
   *
   * **SVM은 메모리가 먼저 올 것이다** — N×N 커널이 5,000장이면 200MB이고, 표 쪽에서
   * 8,000행(512MB)이 살아 있는 것은 봤다. 커널을 **만드는** 비용은 `N² × 특성`이라
   * 1,280차원에서는 같은 행 수가 전혀 다른 시간이다.
   */
  {
    id: 'limit_image_decision_tree',
    label: `상한 찾기 · [사진] 의사결정트리 (지금 ${MLJS_IMAGE_DECISION_TREE_ROW_LIMIT.toLocaleString()})`,
    axis: 'rows',
    points: [250, 500, 1000, 2000, 5000],
    job: (rows) => ({ algorithm: 'decision_tree', rows, columns: IMAGE_FEATURES }),
  },
  {
    id: 'limit_image_random_forest',
    label: `상한 찾기 · [사진] 랜덤 포레스트 (지금 ${MLJS_IMAGE_RANDOM_FOREST_ROW_LIMIT.toLocaleString()})`,
    axis: 'rows',
    points: [100, 250, 500, 1000, 2000, 5000],
    job: (rows) => ({ algorithm: 'random_forest', rows, columns: IMAGE_FEATURES }),
  },
  {
    id: 'limit_image_svm',
    label: `상한 찾기 · [사진] SVM (지금 ${MLJS_IMAGE_SVM_ROW_LIMIT.toLocaleString()})`,
    axis: 'rows',
    points: [500, 1000, 2000, 3000, 5000],
    job: (rows) => ({ algorithm: 'svm', rows, columns: IMAGE_FEATURES }),
  },
]

/**
 * **`findsLimit`은 배열이 정한다** (2026-09-01 감사 B-1).
 *
 * 항목마다 손으로 달던 때는 그 한 줄이 빠지면 **양쪽 버튼 어디에도 안 뜨는** 사다리가
 * 됐다 — `LIMIT_LADDERS`는 [전부 훑기]에 안 들어가고, `findsLimit`이 없으면 [상한 찾기]의
 * 걸러내기에도 안 걸린다. 개별 버튼으로만 돌고 그때는 20초 천장이 붙어 상한을 못 찾는다.
 * **검사로 막는 대신 빠질 수 없게 만든다.**
 */
/**
 * **scikit-learn(Pyodide) 사다리** (2026-09-19).
 *
 * **여기 나온 값이 등록부의 `pyodide-sklearn` 칸을 채운다.** 지금 그 칸은 알고리즘 여덟
 * 줄이 전부 `UNMEASURED`이고(`ml/algorithms.ts`), 그건 빠뜨림이 아니라 **아직 못 재는
 * 사실**이었다 — 어댑터를 띄우는 코드가 저장소에 없었다.
 *
 * **[전부 훑기]에 안 들어간다.** 점 하나마다 새 워커이고 워커마다 시동을 무므로
 * (`measurePyodide`) 표 쪽 사다리와 시간 자릿수가 다르다. 그리고 **네트워크를 탄다** —
 * 27MB를 받는 사다리를 순수 JS 훑기에 섞으면, 회선이 없을 때 표 쪽 실측까지 못 돈다.
 *
 * **점은 표 쪽 사다리와 같게 시작한다.** 두 엔진의 같은 점을 나란히 놓을 수 있어야
 * "sklearn이 몇 배인가"를 말할 수 있다. 위쪽은 20초 천장이 알아서 자른다.
 *
 * **상한 사다리는 아직 없다.** 깨지는 지점을 찾는 것은 기준표를 잰 다음이고, 시동이
 * 점마다 붙는 상태에서 몇 시간짜리 사다리를 돌리는 것은 순서가 틀렸다.
 */
export const PYODIDE_LADDERS: readonly Ladder[] = [
  {
    id: 'pyodide_naive_bayes',
    label: '[sklearn] 나이브 베이즈 · 행 수',
    axis: 'rows',
    points: [1000, 5000, 20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'naive_bayes', rows }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_linear_regression',
    label: '[sklearn] 선형 회귀 · 행 수',
    axis: 'rows',
    points: [1000, 5000, 20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'linear_regression', rows, regression: true }),
    engine: 'pyodide-sklearn',
  },
  {
    /**
     * **`max_iter`를 sklearn 기본값에 둔다.** 표 쪽은 `tol: 0`으로 천장을 재는데
     * (`LOGISTIC_CEILING`), sklearn 서술에는 `tol`이 있으므로 같은 손잡이를 줄 수는 있다.
     * **그래도 안 준다** — 먼저 알아야 하는 것은 *"학생이 기본값으로 눌렀을 때 얼마인가"*이고,
     * 천장 재기는 그 값이 절벽인 것을 본 다음이다 (표 쪽이 그 순서로 갔다).
     */
    id: 'pyodide_logistic_regression',
    label: '[sklearn] 로지스틱 회귀 · 행 수 (sklearn 기본값)',
    axis: 'rows',
    points: [1000, 5000, 20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'logistic_regression', rows }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_knn',
    label: '[sklearn] KNN · 행 수 (학습 + 20% 예측)',
    axis: 'rows',
    points: [1000, 2000, 5000, 10_000],
    job: (rows) => ({ algorithm: 'knn', rows }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_decision_tree',
    label: '[sklearn] 의사결정트리 · 행 수',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 5000, 10_000, 20_000],
    job: (rows) => ({ algorithm: 'decision_tree', rows }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_svm',
    label: '[sklearn] SVM · 행 수',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 3000],
    job: (rows) => ({ algorithm: 'svm', rows }),
    engine: 'pyodide-sklearn',
  },
  {
    /**
     * **그루 수가 sklearn 기본값(100)이다.** 우리 엔진의 기본값은 교실에 맞춘 10이라
     * (`mljs-params.ts`) 같은 점에서 열 배의 일을 한다 — **두 표를 나란히 놓을 때
     * 이것을 모르면 "sklearn이 열 배 느리다"고 읽는다.**
     */
    id: 'pyodide_random_forest',
    label: '[sklearn] 랜덤 포레스트 · 행 수 (sklearn 기본값 100그루)',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 5000],
    job: (rows) => ({ algorithm: 'random_forest', rows }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_k_means',
    label: '[sklearn] K-평균 · 행 수 (군집 없는 데이터, k=3)',
    axis: 'rows',
    points: [1000, 5000, 20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'k_means', rows, hyperparameters: { n_clusters: 3 } }),
    engine: 'pyodide-sklearn',
  },
  /**
   * **사진 쪽.** 1,280차원이 표의 160배 자리라 표의 값으로 외삽할 수 없다 — 표 쪽
   * 사다리가 사진을 따로 재는 것과 같은 이유다(`image_*`).
   *
   * **인공신경망은 여기 없다.** 등록부가 `'pyodide-sklearn': false`라고 선언한다
   * (`ml/algorithms.ts`) — sklearn의 `MLPClassifier`는 우리 손잡이와 모양이 다르다.
   */
  {
    id: 'pyodide_image_naive_bayes',
    label: '[sklearn][사진] 나이브 베이즈 · 장 수',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 4000, 5000],
    job: (rows) => ({ algorithm: 'naive_bayes', rows, columns: IMAGE_FEATURES }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_image_logistic_regression',
    label: '[sklearn][사진] 로지스틱 회귀 · 장 수 (sklearn 기본값)',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 4000, 5000],
    job: (rows) => ({ algorithm: 'logistic_regression', rows, columns: IMAGE_FEATURES }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_image_knn',
    label: '[sklearn][사진] KNN · 장 수 (학습 + 20% 예측)',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 4000, 5000],
    job: (rows) => ({ algorithm: 'knn', rows, columns: IMAGE_FEATURES }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_image_k_means',
    label: '[sklearn][사진] K-평균 · 장 수 (군집 없는 데이터, k=3)',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 4000, 5000],
    job: (rows) => ({
      algorithm: 'k_means',
      rows,
      columns: IMAGE_FEATURES,
      hyperparameters: { n_clusters: 3 },
    }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_image_decision_tree',
    label: '[sklearn][사진] 의사결정트리 · 장 수',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 5000],
    job: (rows) => ({ algorithm: 'decision_tree', rows, columns: IMAGE_FEATURES }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_image_random_forest',
    label: '[sklearn][사진] 랜덤 포레스트 · 장 수 (sklearn 기본값 100그루)',
    axis: 'rows',
    points: [100, 250, 500, 1000, 2000],
    job: (rows) => ({ algorithm: 'random_forest', rows, columns: IMAGE_FEATURES }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_image_svm',
    label: '[sklearn][사진] SVM · 장 수',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 3000],
    job: (rows) => ({ algorithm: 'svm', rows, columns: IMAGE_FEATURES }),
    engine: 'pyodide-sklearn',
  },
  /**
   * **로지스틱은 천장으로도 한 번 잰다** (2026-09-19 실측 뒤에 더했다).
   *
   * 위 두 사다리는 **sklearn 기본값**이라 *"학생이 그냥 눌렀을 때"*를 답하고, 여기는
   * `tol: 0`으로 **`max_iter`를 다 도는 경우**를 답한다. 표 쪽 기준표가 정의된 자리가
   * 그쪽이고(`LOGISTIC_CEILING`), 두 엔진을 나란히 놓으려면 같은 정의여야 한다.
   *
   * **그리고 합성 데이터는 쉽다.** 라벨이 특성에서 곧장 나와 일찍 수렴하므로, 기본값으로
   * 잰 값은 **학생의 어려운 데이터에서 짧게 틀린다** — 순수 JS 쪽이 2026-08-31에 그
   * 절벽(2만 행 0.2초 · 2.4만 행 16초)으로 한 번 무너진 자리다.
   *
   * **`tol: 0`은 서술의 범위 밖이다**(`min: 0.000001`). `resolveWith`는 범위를 안 자르므로
   * (`ml/hyperparams.ts`) 그대로 sklearn에 간다 — 학생 경로에서는 화면이 범위를 막는다.
   */
  {
    id: 'pyodide_logistic_regression_ceiling',
    label: '[sklearn] 로지스틱 회귀 · 행 수 (max_iter 100 천장)',
    axis: 'rows',
    points: [1000, 5000, 20_000, 50_000, 100_000],
    job: (rows) => ({
      algorithm: 'logistic_regression',
      rows,
      hyperparameters: PYODIDE_LOGISTIC_CEILING,
    }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_image_logistic_regression_ceiling',
    label: '[sklearn][사진] 로지스틱 회귀 · 장 수 (max_iter 100 천장)',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 4000, 5000],
    job: (rows) => ({
      algorithm: 'logistic_regression',
      rows,
      columns: IMAGE_FEATURES,
      hyperparameters: PYODIDE_LOGISTIC_CEILING,
    }),
    engine: 'pyodide-sklearn',
  },
]

/**
 * **sklearn의 상한 사다리** (2026-09-19 실측 뒤에 세웠다).
 *
 * **처음 훑기에서 실패가 0건이었다.** 열다섯 사다리가 전부 끝까지 갔고, 그래서 **깨지는
 * 지점을 하나도 못 봤다** — 사다리의 점이 거기까지였기 때문이지 거기가 천장이어서가 아니다.
 * 상한은 시간이 아니라 **깨지는 자리**이므로(`open-decisions.md` "그러면 상한은 시간으로
 * 정하는 것이 아니다"), 그 자리를 보려면 위쪽을 더 밀어야 한다.
 *
 * **여기 없는 칸은 이미 천장에 닿았다.** 표의 나이브 베이즈·선형 회귀·로지스틱·K-평균은
 * `MAX_DATASET_ROWS`(100,000)까지, 사진의 그 넷과 의사결정트리는 `MAX_IMAGE_COUNT`(5,000)까지
 * 실제로 돌았다 — **그 위는 이 앱이 데이터로 받지도 않는다.**
 *
 * **SVM이 먼저 깨질 것이다.** N×N 커널이라 2만 행이면 3.2GB다. 그 자리가 상한이고,
 * 그것은 오래 걸리는 것이 아니라 **워커가 죽는 것**으로 온다.
 */
const PYODIDE_LIMIT_LADDERS: readonly Ladder[] = [
  {
    id: 'pyodide_limit_decision_tree',
    label: `상한 찾기 · [sklearn] 의사결정트리 (지금 ${PYODIDE_DECISION_TREE_ROW_LIMIT.toLocaleString()})`,
    axis: 'rows',
    points: [20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'decision_tree', rows }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_limit_knn',
    label: `상한 찾기 · [sklearn] KNN (지금 ${PYODIDE_KNN_ROW_LIMIT.toLocaleString()})`,
    axis: 'rows',
    points: [10_000, 20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'knn', rows }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_limit_random_forest',
    label: `상한 찾기 · [sklearn] 랜덤 포레스트 (지금 ${PYODIDE_RANDOM_FOREST_ROW_LIMIT.toLocaleString()})`,
    axis: 'rows',
    points: [5000, 10_000, 20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'random_forest', rows }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_limit_svm',
    label: `상한 찾기 · [sklearn] SVM (지금 ${PYODIDE_SVM_ROW_LIMIT.toLocaleString()})`,
    axis: 'rows',
    points: [3000, 5000, 8000, 12_000, 20_000],
    job: (rows) => ({ algorithm: 'svm', rows }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_limit_image_random_forest',
    label: `상한 찾기 · [sklearn][사진] 랜덤 포레스트 (지금 ${PYODIDE_IMAGE_RANDOM_FOREST_ROW_LIMIT.toLocaleString()})`,
    axis: 'rows',
    points: [2000, 3000, 4000, 5000],
    job: (rows) => ({ algorithm: 'random_forest', rows, columns: IMAGE_FEATURES }),
    engine: 'pyodide-sklearn',
  },
  {
    id: 'pyodide_limit_image_svm',
    label: `상한 찾기 · [sklearn][사진] SVM (지금 ${PYODIDE_IMAGE_SVM_ROW_LIMIT.toLocaleString()})`,
    axis: 'rows',
    points: [3000, 4000, 5000],
    job: (rows) => ({ algorithm: 'svm', rows, columns: IMAGE_FEATURES }),
    engine: 'pyodide-sklearn',
  },
]

/**
 * **이 점을 무엇이 재는가.** `ladderPoint`가 이 답대로 고른다.
 *
 * **밖으로 꺼낸 이유는 검사가 닿아야 하기 때문이다.** sklearn 사다리는 27MB를 받으므로
 * 검사가 돌려 볼 수 없고, 그래서 *"이 사다리가 무엇으로 재는가"*는 **돌리지 않고
 * 확인할 수 있어야 한다.** 안에 두었다면 `engine` 칸을 안 보게 만들어도 아무것도 안
 * 울었을 것이다 — 그때 sklearn 사다리 전부가 **조용히 순수 JS를 잰다.**
 */
export function measurerFor(ladder: Pick<Ladder, 'engine' | 'run'>): LadderEngine | 'own' {
  if (ladder.run) return 'own'
  return ladder.engine ?? 'mljs'
}

/**
 * 사다리 하나의 한 점을 돌린다. **워커가 부르는 자리다** (`bench.worker.ts`).
 *
 * **없는 `id`는 던진다** — 조용히 `0`을 돌려주면 그게 기준표가 된다. 2026-09-01 감사가
 * 그 `throw`를 `return 0`으로 바꿔도 아무것도 안 우는 것을 보였다(돌연변이 15).
 *
 * **워커 파일이 아니라 여기 사는 이유**는 저쪽이 모듈 꼭대기에서 `self`를 만져 검사가
 * 들여올 수 없기 때문이다. 판단은 검사가 닿는 곳에 둔다.
 */
export async function ladderPoint(ladderId: string, point: number): Promise<LadderResult> {
  const ladder = ALL_LADDERS.find((one) => one.id === ladderId)
  if (ladder === undefined) throw new Error(`unknown ladder: ${ladderId}`)
  const measurer = measurerFor(ladder)
  if (measurer === 'own') return await (ladder.run as NonNullable<Ladder['run']>)(point)
  return measurer === 'pyodide-sklearn'
    ? await measurePyodide(ladder.job(point))
    : { elapsed: await measure(ladder.job(point)) }
}

/**
 * 워커가 돌려줄 것을 만든다. **`ladderPoint`가 던지면 그것도 답이다.**
 *
 * **워커 파일이 아니라 여기 있는 이유**는 저쪽이 모듈 꼭대기에서 `self`를 만져 검사가
 * 못 들여오기 때문이다 (2026-09-01 감사 B-2). 그 안에 있던 동안은 **던진 것을
 * `elapsed: 0` 성공으로 바꿔도 아무것도 안 울었다** — 0ms는 기준표에 들어갈 뿐 아니라
 * `stopsBefore`의 `previous`가 되어 **그 사다리를 맨 위까지 전부 돌게 한다.**
 */
type Outcome =
  ({ readonly ok: true } & LadderResult) | { readonly ok: false; readonly error: string }

export function benchOutcome(request: {
  readonly kind: 'ladder'
  readonly ladderId: string
  readonly point: number
}): Promise<Outcome>
export function benchOutcome(request: {
  readonly kind: 'calibration'
  readonly job: CalibrationJob
}): Promise<Outcome>
export function benchOutcome(request: { readonly kind: 'calibration-set' }): Promise<Outcome>
export function benchOutcome(request: { readonly kind: 'pyodide-boot' }): Promise<Outcome>
export async function benchOutcome(request: {
  readonly kind: 'ladder' | 'calibration' | 'calibration-set' | 'pyodide-boot'
  readonly ladderId?: string
  readonly point?: number
  readonly job?: CalibrationJob
}): Promise<Outcome> {
  try {
    // **교정 일감은 반복 횟수를 안 답한다.** K-평균이 아니라 그런 수가 없다.
    const result: LadderResult =
      request.kind === 'calibration-set'
        ? { elapsed: await measureCalibrationSet() }
        : request.kind === 'calibration'
          ? { elapsed: await measureCalibration(request.job as CalibrationJob) }
          : request.kind === 'pyodide-boot'
            ? await measureBoot()
            : await ladderPoint(request.ladderId as string, request.point as number)
    return { ok: true, ...result }
  } catch (error) {
    return { ok: false, error: String(error) }
  }
}

/**
 * **시동만 잰다** — 아무것도 학습하지 않는다.
 *
 * 이 값이 *"학습마다 낼 것인가, 상주시킬 것인가"*를 정한다. 2026-08-04에 잰 15.4초는
 * CPython 3.11 시절 배포판의 값이고, 그 숫자 하나로 **엔진을 켜는 자리를 따로 두는
 * 설계**가 섰다. 배포판이 바뀌었으니(`PYODIDE_VERSION`) 그 전제부터 다시 잰다.
 *
 * **점마다 새 워커라 세 번 부르면 세 번 다 차가운 시작이다** (`bench.ts`의 `runInWorker`).
 * 다만 **두 번째부터는 브라우저의 HTTP 캐시가 27MB를 대신 준다** — 그 차이가 곧
 * *"캐시가 지워 주는 값"*과 *"캐시가 못 지우는 값"*의 경계다.
 */
async function measureBoot(): Promise<LadderResult> {
  const { parts, versions } = await bootPyodide()
  return { elapsed: parts.total, parts, versions }
}

/**
 * 워커가 돌려보낼 답을 만든다. **없는 칸은 아예 안 싣는다.**
 *
 * `0`을 실으면 *"한 번도 안 돌았다"*로 읽히고, 빈 객체를 실으면 *"국면을 재 봤는데
 * 아무것도 없었다"*로 읽힌다 — 둘 다 **안 잰 것과 다른 말**이다.
 *
 * **워커 파일이 아니라 여기 있는 이유**는 저쪽이 모듈 꼭대기에서 `self`를 만져 검사가
 * 못 들여오기 때문이다 (감사 B-2와 같은 자리).
 */
export function replyOf(result: LadderResult): LadderResult {
  return {
    elapsed: result.elapsed,
    ...(result.iterations === undefined ? {} : { iterations: result.iterations }),
    ...(result.parts === undefined ? {} : { parts: result.parts }),
    ...(result.versions === undefined ? {} : { versions: result.versions }),
  }
}

/**
 * 다음 점을 어림할 때 증가율에 얹는 지수. **행 축만 제곱이다.**
 *
 * 행 축은 트리의 분할 탐색처럼 제곱으로 붙지만, 나머지 축은 실측이 선형이거나 그보다
 * 완만하다 — `algorithms.ts`의 `columns: 'linear'`가 특성 축을 그렇게 적고,
 * `MLJS_KMEANS_CLUSTERS_MS`는 `k`가 2에서 20으로 열 배 늘 때 1.5배다.
 */
export function projectionExponent(axis: Axis): number {
  return axis === 'rows' ? 2 : 1
}

/** 이 사다리가 쓸 지수. **사다리가 적어 두었으면 그것이고, 아니면 축의 기본값이다.** */
export function ladderExponent(ladder: Pick<Ladder, 'axis' | 'growth'>): number {
  return ladder.growth ?? projectionExponent(ladder.axis)
}

/**
 * 어림 규칙을 사람이 읽는 한 줄로. **결과 JSON에 함께 실린다.**
 *
 * **손으로 적지 않는다** (2026-09-01 R17 감사 C-4). 한때 `'rows: growth^2 · else:
 * growth'`라는 글자가 `bench.ts`에 박혀 있었는데, **그 글자가 규칙을 안 읽어서** 지수를
 * 다른 축으로 옮겨도 문자열만 조용히 거짓이 됐다. 이 필드를 넣은 이유가 *"규칙이 바뀐
 * 것을 JSON에서 구분하려고"*였으니 그러면 넣은 뜻이 없다.
 */
export function projectionRule(): string {
  const axes = AXES.map((axis) => `${axis}^${projectionExponent(axis)}`).join(' · ')
  // **사다리가 자기 지수를 적을 수 있다** (`Ladder.growth`). 어느 사다리가 그랬는지까지
  // 적어 두어야 결과 JSON만 보고도 어림이 어떻게 됐는지 읽을 수 있다.
  const overridden = LADDERS.filter((ladder) => ladder.growth !== undefined)
    .map((ladder) => `${ladder.id}^${ladder.growth}`)
    .join(' · ')
  return overridden === '' ? axes : `${axes} (사다리별: ${overridden})`
}

/** 멈춘 이유. **`null`이면 안 멈춘다.** */
export type StopReason = 'ceiling' | 'projection'

/**
 * 사유를 사람이 읽는 말로. **판정과 같은 집에 둔다.**
 *
 * 화면 쪽에 있던 동안은 검사가 못 닿았고, 그래서 두 말을 맞바꿔도 아무것도 안 울었다
 * (R17 감사 B-5). **이 파일은 앱이 아니라 하니스라** 한국어 문자열이 있어도 §1.4에
 * 걸리지 않는다 — 사다리 라벨이 이미 그렇다.
 */
export const STOP_WHY = {
  ceiling: '앞 점이 천장을 넘겼다',
  projection: '다음 점의 어림이 크다',
} as const satisfies Record<StopReason, string>

/**
 * **이 점을 멈출 것인가, 그리고 왜.** 앞 점의 시간으로 판정한다.
 *
 * 갈래가 둘이다. **상한을 찾는 사다리**는 오래 걸리는 것이 답의 일부라 20초에서 안 멈추고
 * `FAILURE_CEILING_MS`(한 시간)만 폭주를 막는다. **기준표 사다리**는 20초를 넘겼거나
 * 다음 점의 어림이 `PROJECTION_MS`를 넘으면 멈춘다 — 표는 보간용이고 큰 쪽은 기울기로 잇는다.
 *
 * **어림의 지수를 축이 정한다** (2026-09-01 감사 C-3). 행 축은 트리의 분할 탐색처럼
 * 제곱으로 붙지만, 나머지 축은 실측이 선형이거나 그보다 완만하다 — `limits.ts`의
 * `columns: 'linear'`가 특성 축을 그렇게 적고, `MLJS_KMEANS_CLUSTERS_MS`는 `k`가 2에서
 * 20으로 열 배 늘 때 1.5배다. 전부 제곱으로 어림하면 **폭주는 안 나지만 표가 조용히
 * 짧아진다.**
 *
 * **검사가 닿게 하려고 밖에 있다.** 화면 안에 있을 때는 두 천장을 맞바꿔도 아무것도
 * 안 울었다 (2026-09-01 감사, 돌연변이 9).
 *
 * **사유까지 여기서 낸다** (2026-09-01 R17 감사 B-5). 한때 `bench.ts`가 *"천장을
 * 넘겼나"*를 손으로 한 번 더 적었고, 그래서 **거기서 두 천장을 맞바꿔도 2675개가 전부
 * 초록**이었다(돌연변이 M1) — 저장된 JSON의 `why`가 통째로 거꾸로 적히는데도. 같은
 * 판정을 이 함수에서 바꾸면 즉시 빨개진다. **사유는 판정의 일부이지 표시가 아니다.**
 */
export function stopReason(
  ladder: Ladder,
  previous: { readonly point: number; readonly elapsed: number } | null,
  point: number,
): StopReason | null {
  if (previous === null) return null
  if (ladder.findsLimit) return previous.elapsed > FAILURE_CEILING_MS ? 'ceiling' : null
  if (previous.elapsed > CEILING_MS) return 'ceiling'
  const growth = point / previous.point
  const projected = previous.elapsed * growth ** ladderExponent(ladder)
  return projected > PROJECTION_MS ? 'projection' : null
}

/** 위와 같은 판정. **사유가 필요 없는 자리가 쓴다.** */
export function stopsBefore(
  ladder: Ladder,
  previous: { readonly point: number; readonly elapsed: number } | null,
  point: number,
): boolean {
  return stopReason(ladder, previous, point) !== null
}

export const ALL_LADDERS: readonly Ladder[] = [
  ...LADDERS,
  ...LIMIT_LADDERS.map((ladder) => ({ ...ladder, findsLimit: true as const })),
  ...PYODIDE_LADDERS,
  ...PYODIDE_LIMIT_LADDERS.map((ladder) => ({ ...ladder, findsLimit: true as const })),
]

/**
 * **교정 일감은 앱의 정의를 그대로 쓴다 — 목록도 절차도.**
 *
 * 기준값(`limits.ts`의 `CALIBRATION_BASELINE_MS`)을 잰 것과 앱이 실제로 도는 것이 갈리면
 * 배수가 통째로 어긋나는데, **그 어긋남은 아무 데서도 안 보인다.**
 *
 * **한동안 목록만 같고 절차가 갈려 있었다** (2026-09-01 감사 B-4에서 드러났다). 지금은
 * 아래 `measureCalibration`이 앱의 `measureJob`을 그대로 부른다.
 */
export const CALIBRATION = CALIBRATION_JOBS

/**
 * 교정 일감 하나를 **앱의 함수로** 잰다 (`ml/calibration.ts`의 `measureJob`).
 *
 * **위 `measure`를 안 쓴다** (2026-09-01 감사 B-4). 둘은 목록만 같고 절차가 갈려 있었다 —
 * `measure`는 평가까지 지나가고 `PREDICT_RATIO`를 자기 상수로 들고 있는데, 앱의 교정은
 * `fit` + 예측까지만이다. 감사자가 `PREDICT_RATIO`를 0.2에서 0.01로 바꾸고 `evaluate`를
 * 지워도 **아무것도 안 우는 것**을 보였다.
 *
 * 그 갈라짐은 **기기 배수를 통째로 어긋나게 한다** — 기준값(`CALIBRATION_BASELINE_MS`)을
 * 잰 절차와 앱이 도는 절차가 다르면 나눗셈의 두 항이 다른 것을 재는 것이다. 그래서 여기서
 * 다시 정의하지 않고 **가져와 부른다.**
 */
export async function measureCalibration(job: CalibrationJob): Promise<number> {
  return Math.round(await measureJob(job))
}

/**
 * **일감 전부를 앱과 같은 모양으로 한 번 잰다** (`ml/calibration.ts`의 `runCalibration`).
 *
 * **`CALIBRATION_BASELINE_MS`가 정의된 양이 바로 이것이다** — 일감마다 잰 값을 더한 것이
 * 아니다. 앱은 새 워커 하나에서 일감 둘을 **이어서** 돌리므로 **두 번째 일감은 따뜻하다.**
 * 위 `measureCalibration`은 일감마다 새 워커라 차가운 시작을 두 번 무는데, 그 값들을
 * 더하면 **앱보다 크게 나온다** (2026-09-01 실측: 66+72 = 138ms).
 *
 * **그래서 기준값을 이 함수로 잰다.** 위 갈래는 *"어느 일감이 얼마를 먹나"*를 보는 것이고,
 * 이쪽이 *"앱이 잴 값이 얼마인가"*다. 둘을 한 함수로 합치면 그 구분이 사라진다.
 */
export async function measureCalibrationSet(): Promise<number> {
  return Math.round(await runCalibration())
}
