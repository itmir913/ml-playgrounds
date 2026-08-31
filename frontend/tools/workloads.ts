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

import { CALIBRATION_JOBS, syntheticData } from '../src/ml/calibration'
import { fit } from '../src/ml/engines/mljs'

/** 기본 특성 수. **특성 축은 알고리즘마다 따로 훑는다**(아래 `*_columns` 사다리들). */
const FEATURES = 8

/** 예측에 쓰는 비율. 앱의 평가가 시험 몫으로 지나가는 그 자리다. */
const PREDICT_RATIO = 0.2

/**
 * **한 점이 이보다 오래 걸리면 그 사다리를 멈춘다.** 상한까지 다 재려다 랜덤포레스트
 * 하나에 7분을 태울 이유가 없다 — 표는 보간용이고, 큰 쪽은 기울기로 잇는다.
 */
export const CEILING_MS = 20_000

/** **다음 점이 이보다 오래 걸릴 것 같으면 아예 시작하지 않는다.** 마지막 점의 증가율로 본다. */
export const PROJECTION_MS = 60_000

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
  predict(features.slice(0, Math.max(1, Math.round(job.rows * PREDICT_RATIO))))
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
function measureKMeans(rows: number, clusters: number): number {
  const { features, target } = uniformData(rows, FEATURES)
  const rowIndices = features.map((_, index) => index)
  const started = performance.now()
  fit('k_means', {
    features,
    rowIndices,
    target,
    hyperparameters: { nClusters: clusters },
    randomState: 42,
  })
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
    id: 'k_means',
    label: 'K-평균 · 행 수 (k=3)',
    axis: 'rows',
    points: [1000, 5000, 20_000, 50_000, 100_000],
    job: (rows) => ({ algorithm: 'k_means', rows, hyperparameters: { nClusters: 3 } }),
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
 * **교정 일감은 앱의 정의를 그대로 쓴다.**
 *
 * 기준값(`limits.ts`의 `CALIBRATION_BASELINE_MS`)을 잰 일감과 앱이 실제로 도는 일감이
 * 갈리면 배수가 통째로 어긋나는데, **그 어긋남은 아무 데서도 안 보인다.** 그래서 여기서
 * 다시 정의하지 않고 가져온다.
 */
export const CALIBRATION = CALIBRATION_JOBS
