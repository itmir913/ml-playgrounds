/**
 * **sklearn이 배운 것을 우리 형식으로 옮긴다** (`mlpx-spec.md` §5).
 *
 * 이것이 없으면 sklearn으로 학습한 run은 지표만 남고 **예측 화면이 안 열린다** —
 * 모델이 파일에 없으니 그 단계가 잠긴다(`modelOmitted: 'engineUnsupported'`).
 *
 * ## 판단은 여기, 파이썬은 받아쓰기만
 *
 * **Pyodide 쪽 코드는 `tolist()`뿐이다.** 노드를 세고 임계값을 옮기고 클래스 순서를
 * 맞추는 일은 전부 이 파일에서 한다 — 그래야 **Pyodide 없이 검사가 돈다.** 파이썬에
 * 판단을 두면 그 코드는 27.3MB를 받아야만 실행되고, 이 저장소에서 그건 아무도 안 보는
 * 코드라는 뜻이다.
 *
 * ## 못 옮기면 안 옮긴다
 *
 * 모양이 예상과 다르면 **던지지 않고 `null`을 돌려준다.** 부르는 쪽이 그것을
 * `modelOmitted`로 적고 학습은 그대로 끝난다 — 직렬화 하나 때문에 학습을 잃는 것은
 * 학생에게 설명할 수 없는 손해다 (`ml/engines/mljs.ts`의 `serializeOrOmit`과 같은 규칙).
 */

import { KMEANS_FORMAT, type KMeansModel } from '../models/kmeans'
import { LINEAR_V2_FORMAT, type LinearModelV2 } from '../models/linear'
import { LINEAR_REGRESSION_FORMAT, type LinearRegressionModel } from '../models/linear-regression'
import { NAIVE_BAYES_FORMAT, type NaiveBayesModel } from '../models/naive-bayes'
import { REFERENCE_FORMAT, type ReferenceModel } from '../models/reference'
import { SVM_FORMAT, type SvmModel } from '../models/svm'
import { TREE_FORMAT, LEAF, type TreeModel, type TreeNode } from '../models/tree'

/**
 * 길이와 유한성을 함께 본다. **`unknown`을 받는 이유는 이 값이 `JSON.parse`에서
 * 오기 때문이다** — 타입은 우리가 붙인 기대일 뿐이고, 실제로 온 것은 아무 모양일 수 있다.
 */
function isVector(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((one) => typeof one === 'number' && Number.isFinite(one))
  )
}

function isMatrix(value: unknown, height: number, width: number): value is number[][] {
  return (
    Array.isArray(value) && value.length === height && value.every((row) => isVector(row, width))
  )
}

/** 열 수는 어느 형식에서나 같은 뜻이다. 0이면 곱할 것이 없다. */
function usableWidth(featureCount: number): boolean {
  return Number.isInteger(featureCount) && featureCount > 0
}

/**
 * 나무 하나를 파이썬이 받아쓴 모양. **sklearn `Tree` 객체의 배열 넷과 잎의 클래스다.**
 *
 * 넷의 길이가 같고 노드 번호가 그 배열의 인덱스다 (sklearn의 `tree_` 규약).
 */
export interface SklearnTreeDump {
  /** `children_left`. 잎이면 -1이다. */
  readonly left: readonly number[]
  /** `children_right`. 잎이면 -1이다. */
  readonly right: readonly number[]
  /** `feature`. 잎이면 음수다(sklearn은 -2를 쓴다). */
  readonly feature: readonly number[]
  /**
   * `threshold`를 **한 칸 올린 값**. 잎 자리는 아무 값이나 와도 안 쓴다.
   *
   * **왜 올리는가** — sklearn은 `x <= t`면 왼쪽인데 **우리 해석기는 `x < t`면
   * 왼쪽이다**(`ml/models/tree.ts`의 `classify`). 두 규칙은 **딱 임계값에서만** 갈리고,
   * sklearn의 임계값은 관측값 둘의 중점이라 **그 값이 실제로 데이터에 나타난다.**
   * `nextafter(t, ∞)`로 올리면 `x <= t`와 `x < nextafter(t)`가 모든 유한 배정도에서
   * 같은 답을 낸다 — 올리는 일은 파이썬이 한다(`numpy.nextafter`).
   */
  readonly threshold: readonly number[]
  /** 노드마다 `value`의 argmax. **잎에서만 쓴다.** `classes`의 인덱스다. */
  readonly leafClass: readonly number[]
}

export interface SklearnForestDump {
  readonly trees: readonly SklearnTreeDump[]
  /** sklearn의 `classes_`를 문자열로. **우리 정렬과 같은지 확인하는 데 쓴다.** */
  readonly classes: readonly string[]
}

/** 배열 넷의 길이가 같고 비어 있지 않은가. */
function sameLength(dump: SklearnTreeDump): boolean {
  const size = dump.left.length
  return (
    size > 0 &&
    dump.right.length === size &&
    dump.feature.length === size &&
    dump.threshold.length === size &&
    dump.leafClass.length === size
  )
}

/**
 * sklearn의 나무 하나를 우리 노드 배열로.
 *
 * **자식 번호를 안 바꾼다.** sklearn은 노드를 깊이 우선으로 쌓아 자식 번호가 언제나
 * 자기 번호보다 크고(`ml/models/tree.ts`의 검증이 요구하는 것과 같다), 그래서 그대로
 * 옮기면 된다. **맞는지는 해석기가 읽을 때 다시 본다** — 여기서 통과시켜도 거기서 걸린다.
 */
function nodesOf(
  dump: SklearnTreeDump,
  classCount: number,
  featureCount: number,
): readonly TreeNode[] | null {
  if (!sameLength(dump)) return null

  const nodes: TreeNode[] = []
  for (const [index, left] of dump.left.entries()) {
    const right = dump.right[index] ?? LEAF
    const isLeaf = left === LEAF && right === LEAF
    if (isLeaf) {
      const label = dump.leafClass[index]
      if (label === undefined || !Number.isInteger(label) || label < 0 || label >= classCount) {
        return null
      }
      nodes.push([LEAF, label, LEAF, LEAF])
      continue
    }

    const column = dump.feature[index]
    const threshold = dump.threshold[index]
    if (column === undefined || !Number.isInteger(column) || column < 0 || column >= featureCount) {
      return null
    }
    if (threshold === undefined || !Number.isFinite(threshold)) return null
    if (!Number.isInteger(left) || !Number.isInteger(right)) return null
    nodes.push([column, threshold, left, right])
  }
  return nodes
}

/**
 * 의사결정트리와 랜덤 포레스트. **둘은 같은 형식이다** — 나무가 하나인 포레스트가
 * 의사결정트리다 (`ml/models/tree.ts`).
 *
 * **클래스 순서가 우리 것과 같아야 한다.** 우리는 라벨을 문자열로 정렬하고
 * (`ml/engines/mljs.ts`의 `labelCodec`) sklearn도 `np.unique`로 정렬하지만, **그건 우리가
 * 확인한 사실이 아니라 두 구현의 습관이다.** 다르면 잎의 번호가 다른 라벨을 가리키고
 * **조용히 틀린 예측**이 된다 — 그래서 확인하고, 다르면 안 담는다.
 */
export function sklearnTreeModel(
  dump: SklearnForestDump,
  classes: readonly string[],
  featureCount: number,
): TreeModel | null {
  if (dump.trees.length === 0) return null
  if (dump.classes.length !== classes.length) return null
  if (dump.classes.some((label, index) => label !== classes[index])) return null
  if (!usableWidth(featureCount)) return null

  const trees: { nodes: readonly TreeNode[] }[] = []
  for (const tree of dump.trees) {
    const nodes = nodesOf(tree, classes.length, featureCount)
    if (nodes === null) return null
    trees.push({ nodes })
  }
  return { format: TREE_FORMAT, classes: [...classes], featureCount, trees }
}

// ---------------------------------------------------------------------------
// 선형 계열 — 줄 하나가 클래스 하나(로지스틱)이거나 클래스 쌍 하나(SVM)다
// ---------------------------------------------------------------------------

/** sklearn의 `coef_`와 `intercept_`를 그대로. **뜻은 부르는 쪽이 안다.** */
export interface SklearnLinearDump {
  readonly coef: readonly (readonly number[])[]
  readonly intercept: readonly number[]
}

/**
 * 로지스틱 회귀 → `mlpx-linear-v2` (`mlpx-spec.md` §5.4.1).
 *
 * **이진에서 줄 수가 갈린다.** sklearn은 클래스가 둘이면 `coef_`가 **한 줄**이고
 * 부호로 가르는데, 우리 형식은 클래스마다 한 줄이라 `[−w/2, +w/2]`로 나눈다 —
 * `softmax([−s/2, +s/2]) = sigmoid(s)`라 **확률까지 같다.** 순수 JS 엔진도 같은 규약으로
 * 담는다(`ml/engines/mljs.ts`의 `logistic_regression`).
 *
 * **절반이 아니라 통째로 두 줄(`[−w, +w]`)로 담으면 예측은 맞고 확률만 틀린다** —
 * `sigmoid(2s)`가 되어 경계에서 멀어질수록 실제보다 확신해 보인다. 그래서 눈에 안 띈다.
 */
export function sklearnLinearModel(
  dump: SklearnLinearDump,
  classes: readonly string[],
  featureCount: number,
): LinearModelV2 | null {
  if (classes.length < 2 || !usableWidth(featureCount)) return null

  const binary = classes.length === 2
  const rows = binary ? 1 : classes.length
  if (!isMatrix(dump.coef, rows, featureCount)) return null
  if (!isVector(dump.intercept, rows)) return null

  if (!binary) {
    return {
      format: LINEAR_V2_FORMAT,
      classes: [...classes],
      featureCount,
      weights: dump.coef.map((row) => [...row]),
      intercepts: [...dump.intercept],
    }
  }

  const half = dump.coef[0]!.map((value) => value / 2)
  const bias = dump.intercept[0]! / 2
  return {
    format: LINEAR_V2_FORMAT,
    classes: [...classes],
    featureCount,
    weights: [half.map((value) => -value), half],
    intercepts: [-bias, bias],
  }
}

/**
 * 선형 SVM → `mlpx-svm-v1` (`mlpx-spec.md` §5.8). **클래스 쌍마다 한 줄이다.**
 *
 * 줄의 순서는 sklearn의 순서 그대로 `(0,1) (0,2) … (1,2) …`이고, **여기서 그 순서를 다시
 * 세운다** — 파이썬이 준 것은 배열뿐이라 어느 줄이 어느 쌍인지는 이 규칙이 정한다.
 *
 * ## 부호가 클래스 수에 따라 갈린다
 *
 * 우리 형식은 **값이 양수면 `b`**(뒤 클래스)다. libsvm은 반대로 **앞 클래스**이므로
 * 다중 클래스에서는 뒤집어 담는다. **그런데 이진에서는 sklearn이 이미 뒤집어 놓는다** —
 * `BaseLibSVM._fit`이 클래스가 둘인 `c_svc`에서만 `dual_coef_`와 `intercept_`에 −1을
 * 곱해, 공개된 `coef_`는 *양수면 `classes_[1]`*이 된다.
 *
 * **이건 우리가 재서 확인한 사실이다** — `tests/sklearn-serialize.spec.ts`가 벌마다
 * sklearn의 예측과 한 줄씩 대조하고, 부호를 하나로 통일하면 이진 벌들이 **정확도가 뒤집힌
 * 채로** 운다.
 */
export function sklearnSvmModel(
  dump: SklearnLinearDump,
  classes: readonly string[],
  featureCount: number,
): SvmModel | null {
  if (classes.length < 2 || !usableWidth(featureCount)) return null

  const pairs: { readonly a: number; readonly b: number }[] = []
  for (let a = 0; a < classes.length; a += 1) {
    for (let b = a + 1; b < classes.length; b += 1) pairs.push({ a, b })
  }
  if (!isMatrix(dump.coef, pairs.length, featureCount)) return null
  if (!isVector(dump.intercept, pairs.length)) return null

  const sign = classes.length === 2 ? 1 : -1
  return {
    format: SVM_FORMAT,
    classes: [...classes],
    featureCount,
    classifiers: pairs.map((pair, index) => ({
      a: pair.a,
      b: pair.b,
      weights: dump.coef[index]!.map((value) => value * sign),
      intercept: dump.intercept[index]! * sign,
    })),
  }
}

/** 선형 회귀 → `mlpx-linear-regression-v1`. **줄이 하나뿐이라 부호도 순서도 없다.** */
export interface SklearnRegressionDump {
  readonly coef: readonly number[]
  readonly intercept: number
}

export function sklearnLinearRegressionModel(
  dump: SklearnRegressionDump,
  featureCount: number,
): LinearRegressionModel | null {
  if (!usableWidth(featureCount)) return null
  if (!isVector(dump.coef, featureCount)) return null
  if (typeof dump.intercept !== 'number' || !Number.isFinite(dump.intercept)) return null
  return {
    format: LINEAR_REGRESSION_FORMAT,
    featureCount,
    coefficients: [...dump.coef],
    intercept: dump.intercept,
  }
}

// ---------------------------------------------------------------------------
// 나머지 셋 — 분포·중심·참조
// ---------------------------------------------------------------------------

/**
 * `GaussianNB`의 `theta_`·`var_`·`class_prior_`. **사전확률은 로그를 씌워 온다** —
 * 우리 형식이 로그로 담고(`mlpx-spec.md` §5.5), 로그는 파이썬의 numpy가 더 정확하다.
 */
export interface SklearnNaiveBayesDump {
  readonly theta: readonly (readonly number[])[]
  readonly var: readonly (readonly number[])[]
  readonly logPriors: readonly number[]
}

export function sklearnNaiveBayesModel(
  dump: SklearnNaiveBayesDump,
  classes: readonly string[],
  featureCount: number,
): NaiveBayesModel | null {
  if (classes.length === 0 || !usableWidth(featureCount)) return null
  if (!isMatrix(dump.theta, classes.length, featureCount)) return null
  if (!isMatrix(dump.var, classes.length, featureCount)) return null
  if (!isVector(dump.logPriors, classes.length)) return null

  return {
    format: NAIVE_BAYES_FORMAT,
    classes: [...classes],
    featureCount,
    logPriors: [...dump.logPriors],
    means: dump.theta.map((row) => [...row]),
    // **평활을 더한 뒤의 값이다** (`mlpx-spec.md` §5.5). sklearn의 `var_`가 이미 그것이라
    // 여기서 더할 것이 없다 — 더하면 두 번 더해진다.
    variances: dump.var.map((row) => [...row]),
  }
}

/**
 * `KMeans`의 중심 → `mlpx-kmeans-v1`. **`k`는 중심의 수다** — 손잡이가 아니라 배운 것에서
 * 센다. 손잡이를 믿으면 sklearn이 빈 군집을 접었을 때 길이가 어긋난다.
 *
 * **여기만 sklearn과의 대조가 없다** (2026-09-19). 픽스처 여덟 벌은 분류·회귀뿐이고
 * 군집 벌이 없다 — `KMeans`를 픽스처에 들이면 스레드 수에 따라 마지막 자리가 흔들려
 * **관문이 이유 없이 빨개질 수 있다.** 그래서 아래 검사가 재는 것은 *옮기는 규칙*이고,
 * *같은 답을 내는가*는 브라우저에서 실물로 확인할 몫으로 남겨 두었다 —
 * `open-decisions.md`의 그 결정문에 남은 실측으로 적혀 있다.
 */
export interface SklearnKMeansDump {
  readonly centroids: readonly (readonly number[])[]
}

export function sklearnKMeansModel(
  dump: SklearnKMeansDump,
  featureCount: number,
): KMeansModel | null {
  if (!usableWidth(featureCount)) return null
  if (!Array.isArray(dump.centroids) || dump.centroids.length === 0) return null
  if (!isMatrix(dump.centroids, dump.centroids.length, featureCount)) return null
  return {
    format: KMEANS_FORMAT,
    featureCount,
    k: dump.centroids.length,
    centroids: dump.centroids.map((row) => [...row]),
  }
}

/**
 * KNN → `mlpx-reference-v1`. **파이썬에게 아무것도 안 묻는다.**
 *
 * 이 형식이 담는 것은 배운 값이 아니라 **어느 행을 봤는가**이고(`mlpx-spec.md` §5.6),
 * 그건 학습 입력에 이미 있다. 그래서 sklearn의 `KNeighborsClassifier` 내부를 꺼낼 일이
 * 없다 — 꺼낸다 해도 `_fit_X`는 우리가 넣어 준 행렬 그대로다.
 *
 * **그러므로 예측 규칙은 우리 것이다.** 학습 화면의 지표는 sklearn이 냈고 파일은 우리
 * 해석기가 읽으므로, 둘은 **sklearn이 규약을 정하지 않은 자리**에서만 갈릴 수 있다 —
 * k번째와 k+1번째 이웃의 거리가 같은 행이다. **픽스처 여덟 벌에서 그런 행이 387 중
 * 32였고 실제로 갈린 줄은 1이다** (sklearn 1.9.1). 세는 것은
 * `tests/sklearn-serialize.spec.ts`이고, **갈린 줄이 동점 행을 넘으면 거기서 운다.**
 */
export function sklearnReferenceModel(
  classes: readonly string[],
  featureCount: number,
  rowIndices: readonly number[],
  k: number,
): ReferenceModel | null {
  if (classes.length === 0 || !usableWidth(featureCount)) return null
  if (!Number.isInteger(k) || k <= 0) return null
  if (rowIndices.length === 0) return null
  if (!rowIndices.every((index) => Number.isInteger(index) && index >= 0)) return null
  return {
    format: REFERENCE_FORMAT,
    k,
    classes: [...classes],
    featureCount,
    trainIndices: [...rowIndices],
  }
}
