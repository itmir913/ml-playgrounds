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

import { fit } from '../src/ml/engines/mljs'

/** 기본 특성 수. **특성 축은 따로 훑는다**(아래 `FEATURE_SWEEP`). */
const FEATURES = 8
const CLASSES = 3
const NOISE = 0.15

/** 예측에 쓰는 비율. 앱의 평가가 시험 몫으로 지나가는 그 자리다. */
const PREDICT_RATIO = 0.2

/**
 * **한 점이 이보다 오래 걸리면 그 사다리를 멈춘다.** 상한까지 다 재려다 랜덤포레스트
 * 하나에 7분을 태울 이유가 없다 — 표는 보간용이고, 큰 쪽은 기울기로 잇는다.
 */
export const CEILING_MS = 20_000

/** **다음 점이 이보다 오래 걸릴 것 같으면 아예 시작하지 않는다.** 마지막 점의 증가율로 본다. */
export const PROJECTION_MS = 60_000

/** 결정적 난수. **기기마다 같은 데이터를 봐야 배수가 데이터 차이를 안 담는다.** */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

interface Data {
  readonly features: number[][]
  readonly target: string[]
}

function synthetic(rows: number, columns: number, regression: boolean): Data {
  const random = lcg(42)
  const features: number[][] = []
  const target: string[] = []
  for (let row = 0; row < rows; row += 1) {
    const cluster = row % CLASSES
    const values: number[] = []
    for (let column = 0; column < columns; column += 1) values.push(cluster + random() * 2 - 1)
    features.push(values)
    if (regression) {
      // 회귀는 타깃이 수치다. 특성의 합에 잡음을 얹는다.
      target.push(String(values.reduce((sum, value) => sum + value, 0) + random()))
    } else {
      // 라벨의 15%를 흔든다. 완전히 분리되는 데이터는 솔버가 너무 쉽게 끝난다.
      const flipped = random() < NOISE ? (cluster + 1) % CLASSES : cluster
      target.push(String.fromCharCode(97 + flipped))
    }
  }
  return { features, target }
}

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
  const { features, target } = synthetic(job.rows, job.columns ?? FEATURES, job.regression ?? false)
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

/** 사다리 하나. `points`가 무엇을 바꾸는지는 `axis`가 말한다. */
export interface Ladder {
  readonly id: string
  readonly label: string
  readonly axis: 'rows' | 'nEstimators' | 'maxIter' | 'columns'
  readonly points: readonly number[]
  readonly job: (point: number) => Job
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
 * **교정 일감** — 앱이 학습 화면에서 배수를 내려고 돌릴 일감이다.
 *
 * **두 종류를 섞는다.** 트리는 분할 탐색이고 로지스틱은 행렬과 경사다 — 한쪽만 재면
 * 다른 쪽이 다른 배수를 갖는 기기에서 어긋난다. 실제로 2026-08-31의 Edge가 일감마다
 * 12.3 · 5.5 · 5.1 · 9.1배로 갈렸다.
 *
 * **개발 PC에서 둘을 합쳐 100ms 안쪽이어야 한다.** 12배 느린 환경에서도 1초대이고,
 * 학생이 알고리즘을 골라 [추가]를 누르기까지의 시간 안에 끝난다(결정문 "언제 재는가").
 */
export const CALIBRATION: readonly Job[] = [
  { algorithm: 'decision_tree', rows: 300 },
  // **여기서는 `maxIter`를 25로 낮춘다.** 천장(100)이면 이 행 수에서 1초가 넘는데,
  // 재려는 것은 절대 시간이 아니라 배수라 짧아도 된다.
  { algorithm: 'logistic_regression', rows: 5000, hyperparameters: { tol: 0, maxIter: 25 } },
]
