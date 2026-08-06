/**
 * ml.js가 학습한 트리를 **우리 형식**으로 옮긴다 (mlpx-spec.md 5.3).
 *
 * **`toJSON()`을 그대로 담지 않는다.** 그 안에는 예측에 안 쓰이는 것(gain, 표본 수,
 * 생성자 옵션)이 들어 있고, 무엇보다 **모양의 주인이 우리가 아니게 된다.** 라이브러리가
 * 구조를 바꾸면 학생이 지난 학기에 낸 파일이 안 열린다. 나이브 베이즈에서 방금 겪었다.
 *
 * 그래서 방향은 한쪽이다 - 여기(직렬화기)는 ml.js를 알아도 되고,
 * ml/models/(해석기)는 몰라야 한다.
 *
 * **읽는 값은 전부 런타임에 확인하고, 어긋나면 던진다.** ml-cart는 타입을 담고 있지 않고
 * ml-random-forest가 담은 타입은 그 안의 estimator를 타입 없는 ml-cart로 넘긴다. 확인
 * 없이 읽으면 라이브러리가 바뀐 날 조용히 이상한 모델이 나온다.
 */

import type { DecisionTreeClassifier } from 'ml-cart'
import type MultivariateLinearRegression from 'ml-regression-multivariate-linear'
import type LogisticRegression from 'ml-logistic-regression'
import { Matrix } from 'ml-matrix'
import type { RandomForestClassifier } from 'ml-random-forest'
import { z } from 'zod'

import { LINEAR_FORMAT, type LinearModel } from '../models/linear'
import { LINEAR_REGRESSION_FORMAT, type LinearRegressionModel } from '../models/linear-regression'
import { NAIVE_BAYES_FORMAT, type NaiveBayesModel } from '../models/naive-bayes'
import { LEAF, TREE_FORMAT, type TreeModel, type TreeNode } from '../models/tree'

/**
 * ml.js 내부 구조가 우리가 아는 모양이 아니다. **버그이지 학생의 문제가 아니다.**
 *
 * ClientError가 아닌 이유가 그것이다 - 이 예외는 화면에 닿지 않는다. ml/engines/mljs.ts가
 * 받아서 모델만 빼고 run은 살린다(지표는 멀쩡하다). 여기 오는 유일한 경로는 ml.js 버전이
 * 움직인 것이고, 그건 tests/mljs.spec.ts가 버전을 고정해 CI에서 먼저 걸린다.
 */
function drift(what: string): never {
  throw new Error(`mljs model shape changed: ${what}`)
}

/**
 * `toJSON()`을 부른다. **라이브러리 타입 선언에 이 메서드가 없다** - 실제로는 있고
 * 공개 API인데 `.d.ts`가 빠뜨렸다. 단언으로 통과시키지 않고 있는지 재고 없으면 드리프트로
 * 다룬다 - 이 파일이 지키는 규칙이 그것이다.
 */
function toJSONOf(value: object): unknown {
  const method = (value as { toJSON?: unknown }).toJSON
  if (typeof method !== 'function') drift('toJSON')
  return (method as () => unknown).call(value)
}

/**
 * 우리가 읽는 노드 필드. **값은 전부 unknown이다** - 여기서 타입을 주장하면 확인을
 * 건너뛰게 되고, 그게 바로 이 파일이 막으려는 것이다.
 */
interface RawNode {
  readonly splitColumn?: unknown
  readonly splitValue?: unknown
  readonly left?: unknown
  readonly right?: unknown
  readonly distribution?: unknown
}

/** object인지만 확인하고 좁힌다. 필드는 전부 unknown이라 여기서 새어 나가는 것이 없다. */
function nodeOf(value: unknown): RawNode {
  if (typeof value !== 'object' || value === null) drift('node')
  return value as RawNode
}

function numberOf(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) drift(what)
  return value
}

const rootedSchema = z.looseObject({ root: z.unknown() })

/** 로지스틱 회귀의 `toJSON()`. 우리가 읽는 것은 판별기별 가중치 한 줄뿐이다. */
const logisticSchema = z.looseObject({
  classifiers: z.array(z.looseObject({ weights: z.array(z.array(z.number())) })).min(1),
})

/** 분류기 하나에서 뿌리 노드를 꺼낸다. `toJSON()`은 공개 API라 입구로 쓴다. */
function rootOf(value: unknown, what: string): unknown {
  const parsed = rootedSchema.safeParse(value)
  if (!parsed.success || parsed.data.root === undefined) drift(what)
  return parsed.data.root
}

const forestSchema = z.looseObject({
  baseModel: z.looseObject({
    /** 나무마다 어떤 열을 썼는가. 특성 배깅이 열을 섞으므로 나무마다 다르다. */
    indexes: z.array(z.array(z.number())),
    estimators: z.array(z.unknown()),
  }),
})

/**
 * 잎이 고르는 클래스 번호.
 *
 * ml.js는 분포에 `maxRowIndex`를 걸어 고르고, 그건 `>` 비교라 **동점이면 번호가 작은 쪽이
 * 이긴다.** 여기서 같은 규칙으로 미리 접어 둔다 - 분포를 통째로 담아 봐야 예측에 쓰이는
 * 것은 이 번호 하나뿐이다(mlpx-spec.md 5.3).
 *
 * 분포의 폭이 전체 클래스 수보다 좁을 수 있다. 잎에 등장한 가장 큰 번호까지만 세기
 * 때문인데, 번호 자체는 전역이라 그대로 쓰면 된다.
 */
function leafClass(distribution: unknown): number {
  if (!(distribution instanceof Matrix)) drift('distribution')
  const counts = Float64Array.from(distribution.getRow(0))
  const first = counts[0]
  if (first === undefined) drift('distribution')

  let best = 0
  let bestCount = first
  for (let index = 1; index < counts.length; index += 1) {
    const count = counts[index]
    if (count === undefined) drift('distribution')
    if (count > bestCount) {
      bestCount = count
      best = index
    }
  }
  return best
}

/** 자리를 잡아 두는 값. 자식을 다 적은 뒤 곧바로 덮어쓴다. */
const PLACEHOLDER: TreeNode = [LEAF, 0, LEAF, LEAF]

/**
 * 노드 하나를 적고 그 인덱스를 돌려준다. **전위 순서로 쌓인다.**
 *
 * 자기 자리를 먼저 잡고 자식을 적으므로 **자식 인덱스는 언제나 자기보다 크다.** 해석기는
 * 그 성질에 기대어 순환 없이 걷는다 (ml/models/tree.ts).
 *
 * 잎 판정은 **자식이 있는가**로 한다. ml-cart의 classify()가 그렇게 하고, 실제로 분포와
 * splitColumn을 **둘 다** 가진 잎이 나온다 - 나눌 자리를 찾아 놓고 이득이 모자라 안 나눈
 * 노드가 그렇다. 분포의 유무로 갈랐다면 그 노드를 내부 노드로 적고 없는 자식을 찾으러 간다.
 */
function emit(raw: unknown, columns: readonly number[], nodes: TreeNode[]): number {
  const node = nodeOf(raw)
  const index = nodes.length

  if (node.left === undefined || node.right === undefined) {
    nodes.push([LEAF, leafClass(node.distribution), LEAF, LEAF])
    return index
  }

  nodes.push(PLACEHOLDER)
  const left = emit(node.left, columns, nodes)
  const right = emit(node.right, columns, nodes)

  // **배깅이 섞어 놓은 열 번호를 여기서 푼다.** 나무는 자기가 받은 행렬의 위치를 들고
  // 있고, 그 위치가 원래 몇 번 열이었는지는 columns가 안다. 풀어서 담으면 해석기는
  // 그런 것이 있었다는 사실조차 몰라도 된다.
  const column = columns[numberOf(node.splitColumn, 'splitColumn')]
  if (column === undefined) drift('splitColumn')

  nodes[index] = [column, numberOf(node.splitValue, 'splitValue'), left, right]
  return index
}

function treeOf(root: unknown, columns: readonly number[]): { nodes: TreeNode[] } {
  const nodes: TreeNode[] = []
  emit(root, columns, nodes)
  return { nodes }
}

function model(
  classes: readonly string[],
  featureCount: number,
  trees: readonly { nodes: TreeNode[] }[],
): TreeModel {
  return { format: TREE_FORMAT, classes: [...classes], featureCount, trees }
}

/** 열을 섞지 않은 나무가 쓰는 항등 사상. */
function identity(featureCount: number): number[] {
  return Array.from({ length: featureCount }, (_, index) => index)
}

/**
 * 결정트리. **나무 한 그루짜리 포레스트로 담는다.**
 *
 * 항등 사상을 넘겨 포레스트와 같은 길로 보낸다. 여기서 갈라 두면 길이 둘이 되고,
 * 나중에 한쪽만 고치게 된다.
 */
export function serializeTree(
  classifier: DecisionTreeClassifier,
  classes: readonly string[],
  featureCount: number,
): TreeModel {
  const root = rootOf(classifier.toJSON(), 'tree')
  return model(classes, featureCount, [treeOf(root, identity(featureCount))])
}

/** 랜덤포레스트. 나무마다 자기가 쓴 열 목록이 따로 있다. */
export function serializeForest(
  forest: RandomForestClassifier,
  classes: readonly string[],
  featureCount: number,
): TreeModel {
  const parsed = forestSchema.safeParse(forest.toJSON())
  if (!parsed.success) drift('forest')

  const { indexes, estimators } = parsed.data.baseModel
  if (estimators.length === 0 || indexes.length !== estimators.length) drift('estimators')

  const trees = estimators.map((estimator, position) => {
    const columns = indexes[position]
    if (columns === undefined) drift('indexes')
    for (const column of columns) {
      if (!Number.isInteger(column) || column < 0 || column >= featureCount) drift('indexes')
    }
    return treeOf(rootOf(estimator, 'estimator'), columns)
  })

  return model(classes, featureCount, trees)
}

/**
 * 로지스틱 회귀의 가중치를 꺼낸다 (mlpx-spec.md 5.4).
 *
 * **`toJSON()`이 Matrix 인스턴스를 그대로 담는다.** JSON으로 한 번 왕복시키지 않으면
 * `weights[0]`이 `undefined`라, 확인 없이 읽으면 빈 가중치로 조용히 넘어간다.
 * 그래서 여기서도 모양을 전부 확인한다.
 *
 * **클래스마다 한 줄이고 라이브러리가 그 순서를 우리 라벨 번호와 맞춰 만든다** -
 * `classifiers[i]`가 "i번 클래스인가"를 재는 판별기다(대상이 0, 나머지가 1이다).
 */
export function serializeLogistic(
  classifier: LogisticRegression,
  classes: readonly string[],
  featureCount: number,
): LinearModel {
  const parsed = logisticSchema.safeParse(JSON.parse(JSON.stringify(toJSONOf(classifier))))
  if (!parsed.success) drift('logistic')

  const { classifiers } = parsed.data
  // 판별기 수가 클래스 수와 다르면 어느 줄이 어느 클래스인지 알 수 없다.
  if (classifiers.length !== classes.length) drift('logistic classes')

  const weights = classifiers.map((one) => {
    const row = one.weights[0]
    if (row === undefined || one.weights.length !== 1) drift('logistic weights')
    if (row.length !== featureCount) drift('logistic featureCount')
    for (const value of row) numberOf(value, 'logistic weight')
    return [...row]
  })

  return { format: LINEAR_FORMAT, classes: [...classes], featureCount, weights }
}

/**
 * 학습된 나이브 베이즈의 계수. **직렬화기의 입력 계약이라 여기 산다** - 엔진이 이쪽을
 * 참조하는 방향은 이미 있고, 반대로 두면 의존이 양방향이 된다.
 */
export interface NaiveBayesParameters {
  /** 클래스마다의 로그 사전확률. **이미 로그다** (mlpx-spec.md 5.5). */
  readonly logPriors: readonly number[]
  readonly means: readonly (readonly number[])[]
  /** 평활을 **더한 뒤의** 값. 재현에 필요한 값은 파일 안에 있어야 한다. */
  readonly variances: readonly (readonly number[])[]
}

/**
 * 가우시안 나이브 베이즈 (mlpx-spec.md 5.5).
 *
 * **여기만 남의 구조를 읽지 않는다.** 이 알고리즘은 저장소 안에서 계산하므로 계수를
 * 우리가 들고 있고, 하는 일은 모양을 확인해 옮기는 것뿐이다. 그래도 확인은 한다 -
 * 학습 쪽 구현이 바뀌어 줄 수가 어긋나면 **읽을 때가 아니라 담을 때** 걸려야 한다.
 */
export function serializeNaiveBayes(
  parameters: NaiveBayesParameters,
  classes: readonly string[],
  featureCount: number,
): NaiveBayesModel {
  const { logPriors, means, variances } = parameters
  if (logPriors.length !== classes.length) drift('naive bayes classes')
  if (means.length !== classes.length || variances.length !== classes.length) {
    drift('naive bayes rows')
  }

  for (const value of logPriors) numberOf(value, 'naive bayes prior')
  for (const row of [...means, ...variances] as readonly (readonly number[])[]) {
    if (row.length !== featureCount) drift('naive bayes featureCount')
    for (const value of row) numberOf(value, 'naive bayes value')
  }

  return {
    format: NAIVE_BAYES_FORMAT,
    classes: [...classes],
    featureCount,
    logPriors: [...logPriors],
    means: means.map((row) => [...row]),
    variances: variances.map((row) => [...row]),
  }
}

/** 선형 회귀의 `toJSON()`. 절편은 가중치 행렬의 **마지막 줄**에 있다. */
const linearRegressionSchema = z.looseObject({
  weights: z.array(z.array(z.number())).min(1),
  inputs: z.number(),
  outputs: z.number(),
  intercept: z.boolean(),
})

/**
 * 선형 회귀 (mlpx-spec.md 5.7).
 *
 * **절편을 계수 배열에서 떼어낸다.** 라이브러리는 가중치 행렬의 마지막 줄에 절편을 두는데,
 * 그 규약을 그대로 담으면 `coefficients.length`가 `featureCount`와 안 맞아 "특성 수가
 * 맞는가"라는 가장 중요한 검사가 헷갈린다.
 *
 * 출력이 하나인 것만 담는다 - 타깃은 열 하나이고, 여럿인 모델은 우리가 만들지 않는다.
 */
export function serializeLinearRegression(
  regression: MultivariateLinearRegression,
  featureCount: number,
): LinearRegressionModel {
  const parsed = linearRegressionSchema.safeParse(JSON.parse(JSON.stringify(toJSONOf(regression))))
  if (!parsed.success) drift('linear regression')

  const { weights, inputs, outputs, intercept } = parsed.data
  if (outputs !== 1) drift('linear regression outputs')
  if (inputs !== featureCount) drift('linear regression inputs')
  // 절편이 있으면 줄이 하나 더 있다. 없으면 우리가 0으로 채운다.
  if (weights.length !== featureCount + (intercept ? 1 : 0)) drift('linear regression weights')

  const coefficients = weights.slice(0, featureCount).map((row) => {
    const value = row[0]
    if (row.length !== 1) drift('linear regression row')
    return numberOf(value, 'linear regression coefficient')
  })

  const last = intercept ? weights[featureCount]?.[0] : 0
  return {
    format: LINEAR_REGRESSION_FORMAT,
    featureCount,
    coefficients,
    intercept: numberOf(last, 'linear regression intercept'),
  }
}
