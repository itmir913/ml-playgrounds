/**
 * scikit-learn(Pyodide) 브라우저 엔진.
 *
 * **Pyodide를 통해 진짜 scikit-learn이 브라우저에서 돈다.** ml.js의 JS 구현과 달리
 * sklearn 원본이므로 결과가 `python -c 'from sklearn ...'`과 완전히 같다.
 *
 * ## 번들에 아무것도 넣지 않는다
 *
 * Pyodide는 27.3MB + 시동 8.7초다 (`architecture.md` §7.4). 이 모듈은 번들에는
 * **어댑터 코드만** 넣고, Pyodide 자체는 **학습이 시작될 때** 원본에서 받는다 —
 * `prepare()`가 `fit()` 바로 앞에서 그것을 한다(`pyodide-runtime.ts`).
 *
 * **잠그지 않는다.** 한때 받기 전에는 카드가 `ENGINE_NOT_READY`로 잠겨 있었는데,
 * **켜는 자리를 안 만들기로 하면서 그 잠금이 열리지 않는 문이 됐다**
 * (`open-decisions.md` "scikit-learn(Pyodide)은 원본에서 받고, 시동은 학습마다 낸다").
 * 대신 화면이 고르기 전에 비용을 말한다.
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
 * **여덟 중 일곱을 담는다** (2026-09-19). 등록부의 `serializer` 칸이 파이썬에게 물을 것과
 * 그것을 우리 형식으로 옮기는 함수를 함께 갖고, 옮기는 일은 전부 `pyodide-serialize.ts`가
 * 한다 — 그래야 Pyodide 없이 검사가 돈다. **칸이 빈 알고리즘은 모델을 안 담고**
 * `modelOmitted: 'engineUnsupported'`로 기록된다(mlpx-spec.md §4.2).
 *
 * **랜덤 포레스트만 비어 있고, 그건 못 해서가 아니라 안 하는 것이다** — 아래 그 항목에
 * 이유와 실측이 있다.
 */

import { ClientError } from '../../errors'
import type { HyperparameterSpec } from '../hyperparams'
import { resolveWith } from '../hyperparams'
import type { FitInput, FitResult, Predict } from './mljs'
import type { ModelFile } from '../models'
import {
  sklearnKMeansModel,
  sklearnLinearModel,
  sklearnLinearRegressionModel,
  sklearnNaiveBayesModel,
  sklearnReferenceModel,
  sklearnSvmModel,
  sklearnTreeModel,
  type SklearnForestDump,
  type SklearnKMeansDump,
  type SklearnLinearDump,
  type SklearnNaiveBayesDump,
  type SklearnRegressionDump,
} from './pyodide-serialize'
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
  /** 배운 것을 파일에 담는 법. **없으면 그 알고리즘은 모델을 안 담는다**(`modelOmitted`). */
  readonly serializer?: SklearnSerializer
}

/**
 * 배운 것을 우리 형식으로 옮기는 한 벌.
 *
 * **받아쓰기와 판단을 가른다.** `dump`은 `tolist()`로 배열을 꺼내는 파이썬 한 조각이고,
 * 세거나 고르거나 옮기는 일은 전부 `build`가 — 즉 `pyodide-serialize.ts`가 — 한다.
 * 판단을 파이썬에 두면 그 코드는 27.3MB를 받아야만 돌고, **검사가 영영 못 본다.**
 *
 * `_dump`에 **JSON 문자열**을 넣는다. 사전을 그대로 꺼내지 않는 이유는 `toJs()`가
 * 배포판마다 다른 모양을 주기 때문이다 (`pyodide-runtime.ts`에서 실제로 물렸다).
 *
 * **`dump`이 없는 칸이 있다** — 참조형(KNN)은 배운 값이 아니라 *어느 행을 봤는가*를
 * 담으므로 파이썬에게 물을 것이 없다. 그때 `build`은 `undefined`를 받는다.
 */
interface SklearnSerializer {
  /** `_dump`에 담길 파이썬 식. **사전 하나여야 하고 `classes`를 함께 넣는다.** */
  readonly dump?: string
  readonly build: (dumped: unknown, context: SerializeContext) => ModelFile | null
}

/** 옮기는 데 필요한 것 중 파이썬 밖에 있는 것. **학습 입력에서 온다.** */
interface SerializeContext {
  /** 라벨을 정렬한 순서. 학습에 쓴 것과 같은 규칙으로 센다. */
  readonly classes: readonly string[]
  readonly featureCount: number
  readonly rowIndices: readonly number[]
  /** **기본값이 채워진 뒤의** 손잡이다 (`resolve`). */
  readonly hyperparameters: Record<string, unknown>
}

/** 손잡이에서 정수 하나. 없거나 수가 아니면 `null`이고, 그러면 안 담는다. */
function integerOption(hp: Record<string, unknown>, name: string): number | null {
  const value = hp[name]
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/**
 * 나무 하나를 받아쓰는 도우미. **갈림값을 우리 해석기의 규칙으로 옮겨 보낸다.**
 *
 * 둘이 두 군데서 다르다.
 *
 * 1. sklearn은 `x <= t`면 왼쪽이고 **우리는 `x < t`면 왼쪽이다**
 *    (`ml/models/tree.ts`의 `classify`).
 * 2. **sklearn은 나무를 float32로 비교한다** — 학습도 예측도 X를 `np.float32`로 바꿔
 *    한다. 우리 해석기는 배정도 그대로 본다.
 *
 * 그래서 보내는 값은 **`float32(x) > t`가 되는 가장 작은 배정도**다 — t보다 큰 첫
 * float32를 찾고 그 앞 float32와의 중점을 잡는다.
 *
 * **2번을 빼먹으면 실물에서 갈린다** (2026-09-19에 픽스처 대조가 잡았다). 어떤 행의
 * 값이 `5.6`인데 임계값이 정확히 `float32(5.6)`이라, 배정도로 재면 오른쪽이고 sklearn은
 * 왼쪽이었다. **`scripts/generate_sklearn_fixtures.py`의 `split_boundary`와 같은 식이고,
 * `tests/sklearn-serialize.spec.ts`가 그 식으로 만든 나무를 진짜 예측과 대조한다.**
 */
const TREE_DUMP_HELPER = `
def _mlpx_boundary(threshold):
    t = _np.asarray(threshold, dtype=_np.float64)
    nearest = t.astype(_np.float32)
    above = _np.where(
        nearest.astype(_np.float64) <= t,
        _np.nextafter(nearest, _np.float32(_np.inf)),
        nearest,
    )
    below = _np.nextafter(above, _np.float32(-_np.inf))
    return (above.astype(_np.float64) + below.astype(_np.float64)) / 2.0


def _mlpx_tree(t):
    return {
        "left": t.children_left.tolist(),
        "right": t.children_right.tolist(),
        "feature": t.feature.tolist(),
        "threshold": _mlpx_boundary(t.threshold).tolist(),
        "leafClass": t.value[:, 0, :].argmax(axis=1).tolist(),
    }
`

/** 선형 계열 둘이 같은 것을 묻는다. **뜻은 옮기는 쪽이 안다** (일대다냐 쌍이냐). */
const LINEAR_DUMP =
  '{"coef": _model.coef_.tolist(), "intercept": _model.intercept_.tolist(), "classes": _classes}'

const SKLEARN_CLASSES: Readonly<Record<string, SklearnClass>> = {
  decision_tree: {
    module: 'sklearn.tree',
    cls: 'DecisionTreeClassifier',
    serializer: {
      dump: '{"trees": [_mlpx_tree(_model.tree_)], "classes": _classes}',
      build: (dumped, context) =>
        sklearnTreeModel(dumped as SklearnForestDump, context.classes, context.featureCount),
    },
  },
  // KNN: 교실 데이터에서 kd-tree 구축 비용이 오히려 크고, brute force가 가장 결정론적이다.
  knn: {
    module: 'sklearn.neighbors',
    cls: 'KNeighborsClassifier',
    fixed: ["algorithm='brute'"],
    serializer: {
      // **파이썬에게 안 묻는다** — 담는 것이 배운 값이 아니라 본 행이다.
      build: (_dumped, context) => {
        const k = integerOption(context.hyperparameters, 'n_neighbors')
        return k === null
          ? null
          : sklearnReferenceModel(context.classes, context.featureCount, context.rowIndices, k)
      },
    },
  },
  logistic_regression: {
    module: 'sklearn.linear_model',
    cls: 'LogisticRegression',
    serializer: {
      dump: LINEAR_DUMP,
      build: (dumped, context) =>
        sklearnLinearModel(dumped as SklearnLinearDump, context.classes, context.featureCount),
    },
  },
  /**
   * **모델을 안 담는다** (2026-09-19). 나무를 옮기는 것은 되는데 **예측 규칙이 다르다** —
   * sklearn의 포레스트는 나무마다의 **확률을 평균**해 고르고, 우리 형식의 해석기는
   * **다수결**이다 (`ml/models/tree.ts`의 `vote`, ml.js가 그렇게 한다).
   *
   * **재 보니 387행 중 12행(3.1%)이 갈렸다** — 픽스처 여덟 벌의 실측이고
   * `tests/sklearn-serialize.spec.ts`가 그 사실을 지킨다. 서른 줄에 한 줄꼴로 **학습
   * 화면의 정확도와 예측 화면의 답이 다른 말을 하는 것**이라, 담는 것이 안 담는 것보다
   * 나쁘다.
   *
   * **여는 길은 형식을 하나 더 두는 것이다** — 잎에 분포를 담는 `mlpx-tree-v2`.
   */
  random_forest: { module: 'sklearn.ensemble', cls: 'RandomForestClassifier' },
  naive_bayes: {
    module: 'sklearn.naive_bayes',
    cls: 'GaussianNB',
    serializer: {
      dump: `{
    "theta": _model.theta_.tolist(),
    "var": _model.var_.tolist(),
    "logPriors": _np.log(_model.class_prior_).tolist(),
    "classes": _classes,
}`,
      build: (dumped, context) =>
        sklearnNaiveBayesModel(
          dumped as SklearnNaiveBayesDump,
          context.classes,
          context.featureCount,
        ),
    },
  },
  // SVM: mljs의 우리 SMO와 같은 조건으로 맞춘다 (선형 커널).
  svm: {
    module: 'sklearn.svm',
    cls: 'SVC',
    fixed: ["kernel='linear'"],
    serializer: {
      dump: LINEAR_DUMP,
      build: (dumped, context) =>
        sklearnSvmModel(dumped as SklearnLinearDump, context.classes, context.featureCount),
    },
  },
  linear_regression: {
    module: 'sklearn.linear_model',
    cls: 'LinearRegression',
    serializer: {
      // **`coef_`가 1차원이다** — 타깃이 하나뿐이라 줄이 없다 (`mlpx-spec.md` §5.7).
      dump: '{"coef": _model.coef_.tolist(), "intercept": float(_model.intercept_)}',
      build: (dumped, context) =>
        sklearnLinearRegressionModel(dumped as SklearnRegressionDump, context.featureCount),
    },
  },
  // KMeans: 기본 알고리즘 'lloyd'와 init='k-means++'는 그대로 두고 n_init만 고정한다.
  k_means: {
    module: 'sklearn.cluster',
    cls: 'KMeans',
    fixed: ["n_init='auto'"],
    serializer: {
      dump: '{"centroids": _model.cluster_centers_.tolist(), "classes": _classes}',
      build: (dumped, context) =>
        sklearnKMeansModel(dumped as SklearnKMeansDump, context.featureCount),
    },
  },
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

/**
 * **버전이 여기 없다.** 이 엔진의 버전은 *우리 코드의 판*이 아니라 **받아 오는 Pyodide
 * 배포판의 이름**이고, 그것을 아는 것은 띄우는 쪽이다(`pyodide-runtime.ts`의
 * `PYODIDE_VERSION`). 여기서 그쪽을 들여오면 **순환 임포트**가 된다 — 띄우는 쪽이 이
 * 파일의 `setPyodide`를 부른다. 그래서 등록부(`ml/engines/index.ts`)가 붙인다.
 */
export const PYODIDE_SKLEARN_ENGINE = { kind: 'pyodide-sklearn' } as const

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
 * 닿는다. **2026-09-19에 배선이 붙어 그 경로가 실제로 열렸다** — `prepare()`가 학습
 * 앞에서 Pyodide를 띄우므로 여기 오는 문자열은 진짜 `runPython()`까지 간다.
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
import numpy as _np
from ${info.module} import ${info.cls}

_X = np.array(_X_train_js.to_py(), dtype=np.float64)
_y = np.array(_y_train_js.to_py())
_model = ${info.cls}(${params.join(', ')})
_model.fit(_X, _y)
_classes = [str(c) for c in getattr(_model, "classes_", [])]
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
_classes = []
`
}

/**
 * 배운 것을 받아쓰는 코드. **`_dump`에 JSON 문자열이 남는다.**
 *
 * `_np`를 여기서 다시 임포트한다 — 학습 코드가 이미 했지만 **군집 쪽은 안 했고**,
 * 두 번 임포트하는 비용은 파이썬 사전 조회 한 번이다.
 */
function buildDumpCode(dump: string): string {
  return `
import json
import numpy as _np
${TREE_DUMP_HELPER}
_dump = json.dumps(${dump})
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

  // 5. 배운 것을 우리 형식으로
  const model = serialize(algorithm, input, hp)

  return {
    predict,
    ...(model
      ? { model }
      : // **못 담는 것은 정상이다** — 그 알고리즘에 아직 직렬화기가 없다는 뜻이고, 사유는
        // run.modelOmitted에, 원문은 run.modelOmittedDetail에 남는다 (mlpx-spec.md §4.2).
        { modelOmittedDetail: `serializer-missing:pyodide-sklearn:${algorithm}` }),
    ...(clusterResult ? { clusterResult } : {}),
  }
}

/**
 * 배운 것을 파이썬에서 받아 우리 형식으로. **못 옮기면 `undefined`다.**
 *
 * **여기서 던지지 않는다.** 직렬화 하나 때문에 학습을 통째로 잃는 것은 학생에게 설명할
 * 수 없는 손해다 — 지표는 이미 나왔고 모델만 안 담긴다 (`mljs.ts`의 `serializeOrOmit`과
 * 같은 규칙).
 */
function serialize(
  algorithm: string,
  input: FitInput,
  hyperparameters: Record<string, unknown>,
): ModelFile | undefined {
  const serializer = SKLEARN_CLASSES[algorithm]?.serializer
  if (!serializer || !py) return undefined

  /**
   * **여기서 나는 어떤 사고도 학습을 죽이지 않는다.** 파이썬이 다른 모양을 주거나 JSON이
   * 깨져 있어도 잃는 것은 모델 하나이고, 지표는 이미 나와 있다. 던지면 그 run이 통째로
   * 실패하고 **학생은 학습을 다시 해야 한다** — 담을 것이 없는 것보다 나쁘다.
   */
  try {
    // **학습에 쓴 것과 같은 규칙으로 센다** (`mljs.ts`의 `labelCodec`).
    const classes = [...new Set(input.target.map(String))].sort()
    const context: SerializeContext = {
      classes,
      featureCount: input.features[0]?.length ?? 0,
      rowIndices: input.rowIndices,
      hyperparameters,
    }

    let dumped: unknown
    if (serializer.dump !== undefined) {
      py.runPython(buildDumpCode(serializer.dump))
      const proxy = py.globals.get('_dump')
      const text = String(proxy.toJs?.() ?? proxy)
      proxy.destroy?.()
      dumped = JSON.parse(text)
      if (!agrees(dumped, classes)) return undefined
    }

    return serializer.build(dumped, context) ?? undefined
  } catch {
    return undefined
  }
}

/**
 * sklearn이 센 클래스 순서가 우리 것과 같은가. **다르면 아무것도 안 담는다.**
 *
 * 우리는 라벨을 문자열로 정렬하고 sklearn도 `np.unique`로 정렬하지만, **그건 우리가 확인한
 * 사실이 아니라 두 구현의 습관이다.** 다르면 계수·잎·쌍의 번호가 전부 다른 라벨을 가리켜
 * **조용히 틀린 예측**이 된다 — 형식마다 따로 볼 일이 아니라서 여기 하나로 둔다.
 */
function agrees(dumped: unknown, classes: readonly string[]): boolean {
  if (typeof dumped !== 'object' || dumped === null) return false
  const listed = (dumped as { classes?: unknown }).classes
  // **없으면 묻지 않은 것이다** — 회귀는 클래스가 없다.
  if (listed === undefined) return true
  return (
    Array.isArray(listed) &&
    listed.length === classes.length &&
    listed.every((label, index) => String(label) === classes[index])
  )
}
