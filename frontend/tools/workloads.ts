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

import { backboneFor, DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { CALIBRATION_JOBS, syntheticData } from '../src/ml/calibration'
import { fit } from '../src/ml/engines/mljs'
import { fitKMeans } from '../src/ml/engines/mljs-kmeans'
import { evaluate, evaluateCluster } from '../src/ml/metrics'

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
 */
/**
 * **평가까지 지나간다** (2026-09-01). 앱의 [학습하기]는 `fit` 뒤에 지표를 낸다
 * (`ml/experiment.ts`). 그 단계를 빼고 재던 표는 전부 조금씩 짧았고, **군집화는 그것이
 * 지배적인 비용**이라 표가 두 자릿수로 틀렸다 — 실루엣이 `O(행² × 특성)`이다.
 *
 * 분류·회귀의 지표는 `O(행)`이라 빠뜨려도 티가 안 났지만, **티가 안 나는 것과 안 재는
 * 것은 다르다.**
 */
export function measure(job: Job): number {
  const { features, target } = syntheticData(
    job.rows,
    job.columns ?? FEATURES,
    job.regression ?? false,
  )
  const rowIndices = features.map((_, index) => index)
  const started = performance.now()
  const { predict } = fit(job.algorithm, {
    features,
    rowIndices,
    target,
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

/** 위 데이터로 K-평균 한 번. **`measure`를 안 쓰는 이유는 데이터가 다르기 때문이다.** */
function measureKMeans(rows: number, clusters: number, columns: number = FEATURES): number {
  const { features } = uniformData(rows, columns)
  const started = performance.now()
  // **엔진을 직접 부른다.** 평가에 배정과 중심점이 필요한데 `fit`은 그것을 안 돌려준다.
  const result = fitKMeans(features, clusters, 42)
  // **여기가 군집화의 진짜 비용이다** (`open-decisions.md` "실루엣 계수는 표본으로 낸다").
  evaluateCluster(features, result.assignments, result.centroids, 42)
  return Math.round(performance.now() - started)
}

/** 사다리 하나. `points`가 무엇을 바꾸는지는 `axis`가 말한다. */
export interface Ladder {
  readonly id: string
  readonly label: string
  readonly axis: 'rows' | 'nEstimators' | 'maxIter' | 'columns' | 'nClusters'
  readonly points: readonly number[]
  readonly job: (point: number) => Job
  /**
   * 이 사다리가 **자기 데이터로** 재는가. 없으면 `measure(job(point))`를 쓴다.
   *
   * K-평균만 이것을 갖는다 — 반복 횟수를 데이터가 정하는데 공용 생성기는 군집이
   * 이미 갈려 있어 즉시 수렴한다(위 `uniformData`).
   */
  readonly run?: (point: number) => number
  /**
   * **상한을 찾는 사다리인가.** 기준표를 만드는 사다리와 목적이 다르다.
   *
   * - 20초 천장을 안 쓴다. **오래 걸리는 것이 답의 일부다**(`FAILURE_CEILING_MS`).
   * - [전부 훑기]에 안 들어간다. 몇 시간짜리라 따로 돌린다.
   * - 던지면 그 자리가 답이다 — 메모리 부족이 그렇게 온다.
   */
  readonly findsLimit?: true
}

/**
 * **로지스틱은 `tol`을 0으로 놓고 잰다.**
 *
 * 결정문이 "로지스틱의 예상은 `maxIter`가 다 도는 경우로 잡는다"이고, `tol: 0`이면 항상
 * 다 돈다. **그래야 절벽이 사라진다** — 고정 `tol`에서는 20,000행 0.2초와 24,000행
 * 16초가 이웃이라(결정문의 표) 행 수 보간이 통째로 거짓말이 된다. 천장을 재면 매끄럽다.
 */
const LOGISTIC_CEILING = { tol: 0, maxIter: 100 }

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
    id: 'k_means_columns',
    label: 'K-평균 · 특성 수 (50,000행)',
    axis: 'columns',
    points: [4, 8, 16, 32],
    job: (columns) => ({
      algorithm: 'k_means',
      rows: 50_000,
      columns,
      hyperparameters: { nClusters: 3 },
    }),
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
   * **지금 등록부의 이미지 칸은 일곱이 전부 `UNMEASURED_BASELINE`이라, 사진 프로젝트는
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
    label: '상한 찾기 · SVM (지금 3,000)',
    axis: 'rows',
    points: [3000, 5000, 8000, 12_000, 20_000],
    job: (rows) => ({ algorithm: 'svm', rows }),
    findsLimit: true,
  },
  {
    id: 'limit_random_forest',
    label: '상한 찾기 · 랜덤 포레스트 (지금 5,000)',
    axis: 'rows',
    points: [5000, 10_000, 20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'random_forest', rows }),
    findsLimit: true,
  },
  {
    id: 'limit_knn',
    label: '상한 찾기 · KNN (지금 10,000)',
    axis: 'rows',
    points: [10_000, 20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'knn', rows }),
    findsLimit: true,
  },
  {
    id: 'limit_decision_tree',
    label: '상한 찾기 · 의사결정트리 (지금 20,000)',
    axis: 'rows',
    points: [20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'decision_tree', rows }),
    findsLimit: true,
  },
  /**
   * **사진 쪽 셋.** 2026-09-01에 표 쪽 상한을 다시 재면서 사진 칸은 손대지 않았고,
   * 그래서 일곱이 **2026-08-14의 근거 그대로** 남았다 (`limits.ts`의 `MLJS_IMAGE_*`).
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
    label: '상한 찾기 · [사진] 의사결정트리 (지금 1,000)',
    axis: 'rows',
    points: [250, 500, 1000, 2000, 5000],
    job: (rows) => ({ algorithm: 'decision_tree', rows, columns: IMAGE_FEATURES }),
    findsLimit: true,
  },
  {
    id: 'limit_image_random_forest',
    label: '상한 찾기 · [사진] 랜덤 포레스트 (지금 500)',
    axis: 'rows',
    points: [100, 250, 500, 1000, 2000, 5000],
    job: (rows) => ({ algorithm: 'random_forest', rows, columns: IMAGE_FEATURES }),
    findsLimit: true,
  },
  {
    id: 'limit_image_svm',
    label: '상한 찾기 · [사진] SVM (지금 3,000)',
    axis: 'rows',
    points: [500, 1000, 2000, 3000, 5000],
    job: (rows) => ({ algorithm: 'svm', rows, columns: IMAGE_FEATURES }),
    findsLimit: true,
  },
]

export const ALL_LADDERS: readonly Ladder[] = [...LADDERS, ...LIMIT_LADDERS]

/**
 * **교정 일감은 앱의 정의를 그대로 쓴다.**
 *
 * 기준값(`limits.ts`의 `CALIBRATION_BASELINE_MS`)을 잰 일감과 앱이 실제로 도는 일감이
 * 갈리면 배수가 통째로 어긋나는데, **그 어긋남은 아무 데서도 안 보인다.** 그래서 여기서
 * 다시 정의하지 않고 가져온다.
 */
export const CALIBRATION = CALIBRATION_JOBS
