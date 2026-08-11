/**
 * scikit-learn(Pyodide) 엔진이 받는 손잡이들. **이 엔진에서 이 값들의 유일한 출처다.**
 *
 * `mljs-params.ts`와 같은 이유로 엔진 본체에서 분리했다 — 전처리 화면이 이 표를
 * 읽어야 하는데, 여기에 Pyodide를 당기면 WASM이 첫 화면 번들에 딸려 온다.
 *
 * **이름은 sklearn의 것이다.** 같은 결정트리라도 ml.js는 `maxDepth`, sklearn은
 * `max_depth`이다. 이것이 하이퍼파라미터 키를 (알고리즘, 실행 방법)으로 만든 이유다
 * (architecture.md §3.3, mlpx-spec.md §3). 학생이 sklearn으로 갈아타는 것이 이 도구의
 * 목적이고, 여기서 익힌 이름이 거기서 그대로 통해야 한다 (CLAUDE.md "파이썬 관행").
 *
 * **기본값은 sklearn의 기본값 그대로다.** mljs 엔진은 교실에 맞춰 기본값을 조정했지만
 * (예: 랜덤포레스트 10그루) sklearn 엔진은 sklearn 그대로 쓴다 — 학생이 sklearn으로
 * 옮겼을 때 숫자가 달라지는 이유가 "우리가 바꿔 뒀다"면 발판이 아니라 함정이다.
 *
 * 예외: `max_depth`의 sklearn 기본값은 `None`(제한 없음)이다. 우리 서술은 수치만
 * 담으므로 100으로 대신한다 — 교실 데이터에서 깊이 100에 닿는 나무는 없다.
 * `n_clusters`의 sklearn 기본값은 8이지만 교실에서는 k=2~5가 대부분이라 3으로 둔다 —
 * mljs 엔진과 같은 판단이고, 어긋나면 학생이 엔진을 바꿨을 때 군집 수가 뜬금없이
 * 달라진다.
 */

import type { HyperparameterSpec } from '../hyperparams'

export const PYODIDE_SKLEARN_PARAMETERS: Readonly<
  Record<string, readonly HyperparameterSpec[]>
> = {
  // sklearn DecisionTreeClassifier
  decision_tree: [
    { name: 'max_depth', integer: true, min: 1, max: 100, step: 1, default: 100 },
    // sklearn 기본값 2. mljs의 minNumSamples(기본값 3)와 이름·기본값 모두 다르다.
    { name: 'min_samples_split', integer: true, min: 2, max: 100, step: 1, default: 2 },
  ],
  // sklearn RandomForestClassifier — sklearn 기본값 n_estimators=100.
  random_forest: [{ name: 'n_estimators', integer: true, min: 1, max: 500, step: 1, default: 100 }],
  naive_bayes: [],
  // sklearn KNeighborsClassifier — sklearn 기본값 n_neighbors=5.
  knn: [{ name: 'n_neighbors', integer: true, min: 1, max: 100, step: 1, default: 5 }],
  // sklearn LogisticRegression — 기본값은 sklearn 그대로.
  logistic_regression: [
    { name: 'C', integer: false, min: 0.01, max: 100, step: 0.01, default: 1 },
    { name: 'max_iter', integer: true, min: 1, max: 1000, step: 1, default: 100 },
    { name: 'tol', integer: false, min: 0.000001, max: 0.01, step: 0.000001, default: 0.0001 },
  ],
  linear_regression: [],
  // sklearn SVC — 기본값 C=1.0.
  svm: [{ name: 'C', integer: false, min: 0.01, max: 100, step: 0.01, default: 1 }],
  // sklearn KMeans — sklearn 기본값은 n_clusters=8이지만 교실에 맞춰 3.
  k_means: [{ name: 'n_clusters', integer: true, min: 2, max: 20, step: 1, default: 3 }],
}
