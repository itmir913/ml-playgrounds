/**
 * scikit-learn(Pyodide) 브라우저 엔진.
 *
 * **Pyodide를 통해 진짜 scikit-learn이 브라우저에서 돈다.** ml.js의 JS 구현과 달리
 * sklearn 원본이므로 결과가 `python -c 'from sklearn ...'`과 완전히 같다.
 *
 * ## 번들에 아무것도 넣지 않는다
 *
 * Pyodide는 gzip 26.3MB + 시동 15.4초다 (architecture.md §7.4). 이 모듈은 번들에는
 * **어댑터 코드만** 넣고, Pyodide 자체는 학생이 상태 점검에서 "준비"를 눌렀을 때
 * 동적으로 받는다. 받기 전에는 `ENGINE_NOT_READY`로 잠겨 있고
 * (`runtimeOptions`가 `isReady`를 보므로), `fit()`이 불리는 일이 없다.
 *
 * ## Pyodide 인스턴스 주입
 *
 * 워커가 Pyodide를 부팅한 뒤 `setPyodide()`로 넣어 준다. 부팅 절차 자체는 이 모듈의
 * 책임이 아니다 — 여기는 "이미 떠 있는 Pyodide에 sklearn 코드를 먹인다"만 한다.
 * 이 분리가 테스트를 가능하게 한다: `parameters`·`resolve`는 Pyodide 없이 돌고,
 * `fit`은 브라우저에서 실물로 확인한다.
 *
 * ## 모델 직렬화
 *
 * **지금은 안 한다.** sklearn 모델을 우리 JSON 형식(`mlpx-*-v1`)으로 변환하려면
 * `model.tree_`·`model.coef_` 등 내부를 꺼내 JS 객체로 만드는 경로가 알고리즘마다
 * 필요하고, 그건 V3의 범위를 넘는다. `modelOmitted: 'engineUnsupported'`로 기록되고,
 * 화면이 학생에게 "이 실행 방법에서는 모델을 파일에 담지 않습니다"라고 말한다
 * (mlpx-spec.md §4.2).
 */

import { ClientError } from '../../errors'
import type { HyperparameterSpec } from '../hyperparams'
import { resolveWith } from '../hyperparams'
import type { FitInput, FitResult, Predict } from './mljs'
import { PYODIDE_SKLEARN_PARAMETERS } from './pyodide-sklearn-params'

// ---------------------------------------------------------------------------
// Pyodide 인터페이스 — pyodide npm 패키지를 의존성에 넣지 않기 위한 최소 계약.
// ---------------------------------------------------------------------------

/** Pyodide의 Python 값을 JS로 변환하는 프록시. */
interface PyProxy {
  toJs(): unknown
  destroy?(): void
}

/**
 * 우리가 Pyodide에서 쓰는 것 전부. `loadPyodide()`가 돌려주는 것의 부분집합이다.
 *
 * 전체 `PyodideInterface`를 쓰면 pyodide 패키지를 import해야 하고, 그러면 타입만
 * 가져가려 해도 번들러가 WASM까지 끌어온다. 그래서 우리가 쓰는 메서드만 적는다.
 */
export interface PyodideProxy {
  runPython(code: string): unknown
  globals: {
    get(name: string): PyProxy
    set(name: string, value: unknown): void
  }
}

// ---------------------------------------------------------------------------
// 모듈 상태 — 워커 부팅이 채운다
// ---------------------------------------------------------------------------

let py: PyodideProxy | null = null

/**
 * 워커가 Pyodide를 부팅한 뒤 여기에 넣는다. `fit()`은 이것이 있어야 돈다.
 *
 * **한 번만 부른다.** 재부팅은 워커를 새로 만드는 것으로 대신한다.
 */
export function setPyodide(instance: PyodideProxy): void {
  py = instance
}

/** 테스트가 상태를 초기화할 때. 앱에서는 쓰지 않는다. */
export function resetPyodide(): void {
  py = null
}

// ---------------------------------------------------------------------------
// 알고리즘 → sklearn 클래스 매핑
// ---------------------------------------------------------------------------

/**
 * 알고리즘 id에서 sklearn 임포트 경로와 클래스 이름을 뽑는다.
 *
 * **알고리즘 id가 과제 유형을 결정한다** — 등록부에서 `decision_tree`는
 * `classification: true`이므로 항상 `DecisionTreeClassifier`다. 같은 id로
 * Classifier와 Regressor를 고를 일이 없다 (algorithms.ts).
 *
 * **`fixed`는 우리가 고정하는 sklearn 옵션이다.** 학생에게 열지 않고 값이 바뀌지도
 * 않으므로 서술(`HyperparameterSpec`)이 아니라 여기 산다. 표의 칸으로 두는 이유는
 * `if (algorithm === 'knn')`을 만들지 않기 위해서다 (CLAUDE.md §2) — sklearn
 * 알고리즘이 하나 늘 때 고쳐야 하는 곳이 이 표 하나여야 한다.
 */
interface SklearnClass {
  readonly module: string
  readonly cls: string
  /** 생성자에 항상 붙는 인자. **Python 소스 조각이므로 우리 상수만 온다.** */
  readonly fixed?: readonly string[]
}

const SKLEARN_CLASSES: Readonly<Record<string, SklearnClass>> = {
  decision_tree: { module: 'sklearn.tree', cls: 'DecisionTreeClassifier' },
  // KNN: 교실 데이터에서 kd-tree 구축 비용이 오히려 크고, brute force가 가장 결정론적이다.
  knn: {
    module: 'sklearn.neighbors',
    cls: 'KNeighborsClassifier',
    fixed: ["algorithm='brute'"],
  },
  logistic_regression: { module: 'sklearn.linear_model', cls: 'LogisticRegression' },
  random_forest: { module: 'sklearn.ensemble', cls: 'RandomForestClassifier' },
  naive_bayes: { module: 'sklearn.naive_bayes', cls: 'GaussianNB' },
  // SVM: mljs의 우리 SMO와 같은 조건으로 맞춘다 (선형 커널).
  svm: { module: 'sklearn.svm', cls: 'SVC', fixed: ["kernel='linear'"] },
  linear_regression: { module: 'sklearn.linear_model', cls: 'LinearRegression' },
  // KMeans: 기본 알고리즘 'lloyd'와 init='k-means++'는 그대로 두고 n_init만 고정한다.
  k_means: { module: 'sklearn.cluster', cls: 'KMeans', fixed: ["n_init='auto'"] },
}

/** 등록부에 없는 알고리즘은 여기서 걸린다. */
function classOf(algorithm: string): SklearnClass {
  const info = SKLEARN_CLASSES[algorithm]
  if (!info) throw new ClientError('ALGORITHM_UNSUPPORTED', { algorithm })
  return info
}

// ---------------------------------------------------------------------------
// 공개 API — TrainingEngine 계약
// ---------------------------------------------------------------------------

export const PYODIDE_SKLEARN_ENGINE = { kind: 'pyodide-sklearn', version: '1' } as const

export const PYODIDE_SKLEARN_ALGORITHMS = Object.keys(SKLEARN_CLASSES)

export function parameters(algorithm: string): readonly HyperparameterSpec[] {
  return PYODIDE_SKLEARN_PARAMETERS[algorithm] ?? []
}

export function resolve(
  algorithm: string,
  given: Record<string, unknown>,
): Record<string, unknown> {
  return resolveWith(parameters(algorithm), given)
}

/**
 * Python 코드 안에서 쓸 하이퍼파라미터 문자열을 만든다.
 *
 * `{ max_depth: 5, min_samples_split: 2 }` → `"max_depth=5, min_samples_split=2"`
 *
 * **서술을 순회한다. 준 값의 키를 순회하지 않는다.** 이름이 우리 상수(`spec.name`)가
 * 되므로 학생 파일의 문자열이 Python 소스에 닿는 경로가 닫힌다. 예전에는
 * `Object.entries(hp)`를 돌았고, 그 키의 출처는 `.mlpx`의
 * `hyperparameters`(`z.record(z.string(), z.unknown())`)였다 — `resolveWith`는
 * 서술에 없는 키를 손대지 않고 통과시키므로 남의 파일에 든 임의의 문자열이
 * `runPython()`까지 갔다. `.mlpx`는 교사와 학생이 서로 주고받는 것이 이 도구의
 * 전제이고(CLAUDE.md §1.3), Pyodide의 Python은 `import js`로 IndexedDB와 `fetch`에
 * 닿는다. **지금은 `setPyodide()`를 부르는 코드가 없어 도달하지 않지만, 워커 배선이
 * 붙는 순간 열리는 경로다.**
 *
 * **값도 유한한 수치만 받는다.** 서술(`HyperparameterSpec`)이 수치 전용이다.
 * 예전 코드는 수치가 아니면 `JSON.stringify`를 했는데, 그러면 boolean이 Python에서
 * `true`(이름 오류)가 되고 문자열은 따옴표째 소스가 된다.
 *
 * **randomState는 여기서 넣지 않는다** — `random_state`는 모든 알고리즘에
 * 공통이고 FitInput에서 오므로 호출 쪽이 따로 붙인다.
 */
function formatHyperparameters(
  specs: readonly HyperparameterSpec[],
  hp: Record<string, unknown>,
): string {
  return specs
    .map((spec) => ({ name: spec.name, value: hp[spec.name] }))
    .filter(
      (entry): entry is { name: string; value: number } =>
        typeof entry.value === 'number' && Number.isFinite(entry.value),
    )
    .map((entry) => `${entry.name}=${entry.value}`)
    .join(', ')
}

/**
 * sklearn은 random_state를 받는 알고리즘과 안 받는 알고리즘이 있다.
 * GaussianNB와 LinearRegression은 결정론적이라 random_state가 없다.
 */
const SUPPORTS_RANDOM_STATE: ReadonlySet<string> = new Set([
  'decision_tree',
  'random_forest',
  'logistic_regression',
  'svm',
  'k_means',
])

/**
 * 분류·회귀 알고리즘의 학습 + 예측 Python 코드를 만든다.
 *
 * **하나의 문자열에 fit과 predict_fn 정의를 넣는다.** 이유는 Python 네임스페이스에
 * 모델과 예측 함수를 함께 남겨 놓아야 `predict()`가 나중에 불릴 때 쓸 수 있기
 * 때문이다. 매번 전체를 다시 만들면 Pyodide 전역이 점점 커진다.
 */
function buildFitCode(algorithm: string, hp: Record<string, unknown>, randomState: number): string {
  const info = classOf(algorithm)

  const params: string[] = []
  const formatted = formatHyperparameters(parameters(algorithm), hp)
  if (formatted) params.push(formatted)
  if (SUPPORTS_RANDOM_STATE.has(algorithm)) params.push(`random_state=${randomState}`)
  params.push(...(info.fixed ?? []))

  return `
import numpy as np
from ${info.module} import ${info.cls}

_X = np.array(_X_train_js.to_py(), dtype=np.float64)
_y = np.array(_y_train_js.to_py())
_model = ${info.cls}(${params.join(', ')})
_model.fit(_X, _y)
`
}

/**
 * K-Means 학습 코드. 분류·회귀와 달리 타깃이 없고, clusterResult를 돌려줘야 한다.
 */
function buildKMeansFitCode(hp: Record<string, unknown>, randomState: number): string {
  const info = classOf('k_means')

  const params: string[] = []
  const formatted = formatHyperparameters(parameters('k_means'), hp)
  if (formatted) params.push(formatted)
  params.push(`random_state=${randomState}`)
  params.push(...(info.fixed ?? []))

  return `
import numpy as np
from ${info.module} import ${info.cls}

_X = np.array(_X_train_js.to_py(), dtype=np.float64)
_model = ${info.cls}(${params.join(', ')})
_model.fit(_X)
_assignments = _model.labels_.tolist()
_centroids = _model.cluster_centers_.tolist()
`
}

/**
 * 예측 코드. `_model`이 이미 피팅된 상태여야 한다.
 */
const PREDICT_CODE = `
import numpy as np
_X_test = np.array(_X_test_js.to_py(), dtype=np.float64)
_predictions = _model.predict(_X_test).tolist()
`

/**
 * Pyodide에서 Python 리스트를 꺼내 JS 배열로 바꾼다.
 * **proxy.destroy()를 반드시 부른다** — 안 부르면 Pyodide가 참조를 놓지 않는다.
 */
function fetchList(name: string): unknown[] {
  if (!py) throw new ClientError('ENGINE_NOT_READY')
  const proxy = py.globals.get(name)
  const result = proxy.toJs() as unknown[]
  proxy.destroy?.()
  return result
}

function fetchNestedList(name: string): unknown[][] {
  if (!py) throw new ClientError('ENGINE_NOT_READY')
  const proxy = py.globals.get(name)
  const result = proxy.toJs() as unknown[][]
  proxy.destroy?.()
  return result
}

// ---------------------------------------------------------------------------
// fit — TrainingEngine.fit 계약
// ---------------------------------------------------------------------------

export async function fit(algorithm: string, input: FitInput): Promise<FitResult> {
  if (!py) throw new ClientError('ENGINE_NOT_READY')

  const hp = resolve(algorithm, input.hyperparameters)
  const isClustering = algorithm === 'k_means'

  // 1. 데이터를 Python에 넣는다
  py.globals.set('_X_train_js', input.features)
  if (!isClustering) {
    py.globals.set('_y_train_js', input.target)
  }

  // 2. 학습
  const code = isClustering
    ? buildKMeansFitCode(hp, input.randomState)
    : buildFitCode(algorithm, hp, input.randomState)
  py.runPython(code)

  // 3. 예측 함수
  const predict: Predict = (features) => {
    if (!py) throw new ClientError('ENGINE_NOT_READY')
    py.globals.set('_X_test_js', features)
    py.runPython(PREDICT_CODE)
    return fetchList('_predictions').map(String)
  }

  // 4. 군집 결과
  const clusterResult = isClustering
    ? {
        assignments: fetchList('_assignments') as number[],
        centroids: fetchNestedList('_centroids') as number[][],
      }
    : undefined

  return {
    predict,
    // **직렬화는 아직 안 한다** (이 파일 머리말). 사유 코드는 run.modelOmitted에 남고,
    // 원문은 run.modelOmittedDetail에 남아 교사가 읽을 수 있다 (mlpx-spec.md 4.2).
    modelOmittedDetail: 'serializer-missing:pyodide-sklearn',
    ...(clusterResult ? { clusterResult } : {}),
  }
}
