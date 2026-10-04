/**
 * 의사결정트리의 분할 탐색 — **우리 구현이다. 원본은 `ml-cart@2.1.1`(MIT, mljs).**
 *
 * 원본: https://github.com/mljs/decision-tree-cart · `src/TreeNode.js`의 `bestSplit`·
 * `featureSplit`·`split`과 `src/utils.js`의 `giniGain`·`giniImpurity`.
 * Copyright (c) 2016 ml.js contributors. MIT License.
 *
 * **왜 갈아 끼우는가** (open-decisions.md "순수 JS 의사결정트리의 분할 탐색을 우리
 * 코드로 바꾼다 — 같은 나무를 더 빨리"). 원본은 분할 후보마다 행 전체를 새 배열로
 * 다시 나누고(`split`), 그 지니를 셀 때마다 클래스 수를 `filter`+`indexOf`로 다시
 * 센다(`getNumberOfClasses`). 노드·특성 하나에 O(n²)을 넘는다. 여기는 정렬 한 번
 * 뒤 클래스 개수를 누적하며 훑는다 — O(n log n).
 *
 * **고르는 분할은 원본과 비트 단위로 같다.** 같은 후보를 같은 순서로 만들고(같은
 * 안정 정렬, 같은 `(a + b) / 2`), 이득은 원본과 **같은 연산 순서로** 센다. 원본의
 * 확률은 `1 / 길이`를 개수만큼 **거듭 더한 값**이라 `개수 / 길이`와 마지막 자리가
 * 다를 수 있다. 그래서 두 단계로 고른다:
 *
 * 1. 모든 후보의 이득을 `개수 / 길이`로 어림한다 (빠르다).
 * 2. 어림 최댓값에서 띠(`approximationBand`) 안에 드는 후보만 원본의 연산으로 다시 세어,
 *    원본의 규칙(앞선 후보가 이기고, 엄격히 클 때만 바뀐다)으로 고른다.
 *
 * 띠 밖의 후보는 정확히 세어도 최댓값에 못 닿으므로 결과가 같다. 같음은
 * `cart-split.spec.ts`가 원본 `bestSplit`과 맞대어 문다.
 *
 * **원본에서 바꾼 것 — 셋이다.**
 *
 * 1. 후보마다 배열을 나누는 대신 정렬된 순서를 한 번 훑으며 왼쪽 클래스 개수를 쌓는다.
 * 2. 이득을 두 단계로 센다 (위).
 * 3. 지니 분류가 아니면(`kind`·`gainFunction`·`splitFunction`이 다르면) 원본을 그대로
 *    부른다. 회귀 트리는 이 앱이 안 쓴다.
 *
 * **라이브러리의 `TreeNode.prototype`에 끼운다.** `ml-random-forest`가 안에서
 * `ml-cart`의 나무를 직접 지으므로 그 경로까지 닿는 자리는 거기뿐이다. 프로토타입은
 * 살아 있는 나무에서 얻는다 — `ml-cart/src/TreeNode.js`를 직접 들여오면 번들러와
 * 실행기마다 다른 사본(`cart.js`와 `src/`)이 잡혀 끼운 것이 안 닿는다.
 */

import { DecisionTreeClassifier } from 'ml-cart'

/** `TreeNode`에서 우리가 읽는 것. 원본의 필드 이름 그대로다. */
interface SplitHost {
  readonly kind: string
  readonly gainFunction: string
  readonly splitFunction: string
}

/** 원본 `bestSplit`이 돌려주는 모양. 후보가 없으면 셋이 `undefined`다. */
export interface SplitChoice {
  maxGain: number
  maxColumn: number | undefined
  maxValue: number | undefined
  numberSamples: number | undefined
}

/** `XTranspose`에서 우리가 쓰는 것 — `ml-matrix`의 `Matrix`다. */
interface TransposedRows {
  readonly rows: number
  getRow(index: number): number[]
}

type BestSplit = (this: SplitHost, transposed: TransposedRows, labels: number[]) => SplitChoice

interface TreeNodePrototype {
  bestSplit: BestSplit
}

/**
 * 어림 이득과 원본 이득의 차이가 넘지 않는 폭.
 *
 * 원본의 확률은 `1 / L`을 `k`번 거듭 더한 값이고, 그 오차는 `k`번의 반올림이라
 * `k · 2⁻⁵³` 이하이고, `L`은 그 노드의 행 수를 넘지 않는다. 지니 하나의
 * 오차는 확률 오차의 두 배 이하이고 이득은 지니 셋의 가중합이라, 어림 오차는 확률 오차의
 * 열두 배를 넘지 않는다. **띠는 노드의 행 수에서 센다** — 상한과 무관하게 근거가 선다. 그 백 배를
 * 둔다 — 넓을수록 느려질 뿐 틀리지는 않는다. (띠가 같은 답을 내는지는 `cart-split.spec.ts`가 문다.)
 */
function approximationBand(rows: number): number {
  return 100 * 12 * rows * 2 ** -53
}

/** 원본의 확률 하나 — `1 / length`를 `count`번 거듭 더한다 (`toDiscreteDistribution`). */
function libraryProbability(count: number, length: number): number {
  let sum = 0
  for (let step = 0; step < count; step += 1) sum += 1 / length
  return sum
}

/** 원본의 지니 불순도 (`giniImpurity`). 클래스 순서대로 제곱을 더한다. */
function libraryGini(counts: ArrayLike<number>, length: number): number {
  if (length === 0) return 0
  let sum = 0.0
  for (let label = 0; label < counts.length; label += 1) {
    const probability = libraryProbability(counts[label] as number, length)
    sum += probability * probability
  }
  return 1 - sum
}

/** 어림 지니. 확률을 `개수 / 길이`로 센다. */
function approximateGini(counts: ArrayLike<number>, length: number): number {
  if (length === 0) return 0
  let sum = 0
  for (let label = 0; label < counts.length; label += 1) {
    const probability = (counts[label] as number) / length
    sum += probability * probability
  }
  return 1 - sum
}

/** 띠 안에 남긴 후보 하나. 왼쪽(`lesser`) 클래스 개수를 복사해 든다. */
interface Candidate {
  readonly column: number
  readonly value: number
  readonly approximate: number
  readonly lesserCounts: Int32Array
  readonly lesserLength: number
}

/**
 * 원본 `bestSplit`과 같은 답을 내는 빠른 분할 탐색. **라벨은 0부터의 정수다** — 원본도
 * 라벨을 배열 첨자로 쓴다(`counts[array[i]]`).
 */
export function fastBestSplit(transposed: TransposedRows, labels: number[]): SplitChoice {
  const total = labels.length
  let classCount = 0
  for (const label of labels) if (label + 1 > classCount) classCount = label + 1
  const totalCounts = new Int32Array(classCount)
  for (const label of labels) totalCounts[label] = (totalCounts[label] as number) + 1
  const parentApproximate = approximateGini(totalCounts, total)
  const band = approximationBand(total)

  const order = new Array<number>(total)
  const lesserCounts = new Int32Array(classCount)
  const greaterCounts = new Int32Array(classCount)
  let kept: Candidate[] = []
  let bestApproximate = -Infinity

  for (let column = 0; column < transposed.rows; column += 1) {
    const feature = transposed.getRow(column)
    for (let index = 0; index < total; index += 1) order[index] = index
    // 원본은 [x, y] 쌍을 `a[0] - b[0]`로 안정 정렬한다. 첨자를 같은 비교로 안정 정렬하면
    // 같은 순서가 나온다.
    order.sort((a, b) => (feature[a] as number) - (feature[b] as number))

    lesserCounts.fill(0)
    let lesserLength = 0
    for (let position = 1; position < total; position += 1) {
      const before = order[position - 1] as number
      const after = order[position] as number
      if (labels[before] === labels[after]) continue
      const value = ((feature[before] as number) + (feature[after] as number)) / 2
      // 후보 값은 정렬 순서를 따라 줄지 않으므로 포인터가 되돌아가지 않는다.
      while (lesserLength < total && (feature[order[lesserLength] as number] as number) < value) {
        const label = labels[order[lesserLength] as number] as number
        lesserCounts[label] = (lesserCounts[label] as number) + 1
        lesserLength += 1
      }
      const greaterLength = total - lesserLength
      for (let label = 0; label < classCount; label += 1) {
        greaterCounts[label] = (totalCounts[label] as number) - (lesserCounts[label] as number)
      }
      const approximate =
        parentApproximate -
        ((approximateGini(greaterCounts, greaterLength) * greaterLength) / total +
          (approximateGini(lesserCounts, lesserLength) * lesserLength) / total)
      if (approximate < bestApproximate - band) continue
      if (approximate > bestApproximate) {
        bestApproximate = approximate
        kept = kept.filter((one) => one.approximate >= bestApproximate - band)
      }
      kept.push({ column, value, approximate, lesserCounts: lesserCounts.slice(), lesserLength })
    }
  }

  const choice: SplitChoice = {
    maxGain: -Infinity,
    maxColumn: undefined,
    maxValue: undefined,
    numberSamples: undefined,
  }
  if (kept.length === 0) return choice

  const parent = libraryGini(totalCounts, total)
  for (const candidate of kept) {
    const greaterLength = total - candidate.lesserLength
    for (let label = 0; label < classCount; label += 1) {
      greaterCounts[label] =
        (totalCounts[label] as number) - (candidate.lesserCounts[label] as number)
    }
    // 원본 `giniGain`의 순서다 — 0.0에서 시작해 greater를 먼저, lesser를 나중에 더한다.
    let splitsImpurity = 0.0
    splitsImpurity += (libraryGini(greaterCounts, greaterLength) * greaterLength) / total
    splitsImpurity +=
      (libraryGini(candidate.lesserCounts, candidate.lesserLength) * candidate.lesserLength) / total
    const gain = parent - splitsImpurity
    if (gain > choice.maxGain) {
      choice.maxGain = gain
      choice.maxColumn = candidate.column
      choice.maxValue = candidate.value
      choice.numberSamples = total
    }
  }
  return choice
}

/** 살아 있는 나무에서 `TreeNode.prototype`을 얻는다. */
function treeNodePrototype(): TreeNodePrototype {
  const probe = new DecisionTreeClassifier({ minNumSamples: 1 })
  probe.train([[0], [1]], [0, 1])
  const root = (probe.toJSON() as { root: object }).root
  return Object.getPrototypeOf(root) as TreeNodePrototype
}

const prototype = treeNodePrototype()

/** 끼우기 전의 원본. 검사가 맞대는 상대다. */
export const libraryBestSplit: BestSplit = prototype.bestSplit

const patched: BestSplit = function (this: SplitHost, transposed, labels) {
  if (this.kind !== 'classifier' || this.gainFunction !== 'gini' || this.splitFunction !== 'mean') {
    return libraryBestSplit.call(this, transposed, labels)
  }
  return fastBestSplit(transposed, labels)
}

/** 빠른 분할 탐색을 끼운다. 여러 번 불러도 한 번이다. */
export function installFastSplit(): void {
  prototype.bestSplit = patched
}

/** 원본으로 되돌린다. 검사만 쓴다. */
export function uninstallFastSplit(): void {
  prototype.bestSplit = libraryBestSplit
}
