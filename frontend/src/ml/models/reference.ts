/**
 * `mlpx-reference-v1` — KNN (mlpx-spec.md 5.6).
 *
 * **여기 있는 예측 함수를 학습 쪽도 그대로 쓴다.** 그래서 "저장했다가 읽은 모델의 예측이
 * 원본과 같다"가 테스트로 확인하는 성질이 아니라 **구조로 보장되는 성질**이 된다.
 * `ml-knn`을 뺀 이유가 그것이다 - 그쪽은 동점을 KDTree 내부 힙 순서로 갈라서, 파일에서
 * 읽은 모델이 그걸 재현하려면 남의 자료구조를 통째로 옮겨 와야 했다.
 *
 * **거리는 제곱근을 씌우지 않는다.** 순서가 같고 `Math.sqrt`가 만드는 반올림 차이가 없어
 * 동점 판정이 더 정확하다.
 *
 * **완전 정렬하지 않는다.** 필요한 것은 k개이지 전체 순서가 아니다. 크기 k로 제한한
 * 최대 힙이 `O(n log k)`이고, 무엇보다 **쿼리마다 n개의 쌍을 할당하던 것이 k개로 줄어든다**
 * (실측: 2000행에서 205ms -> 20ms, 5000행에서 1347ms -> 82ms, 결과는 완전히 동일).
 */

import { z } from 'zod'

import { ClientError } from '../../errors'
import type { LoadContext, ModelFile, Predict } from './types'

export const REFERENCE_FORMAT = 'mlpx-reference-v1'

export interface ReferenceModel extends ModelFile {
  readonly format: typeof REFERENCE_FORMAT
  readonly k: number
  /** 라벨을 **정렬한** 순서. 예측이 돌려주는 문자열이 여기서 나온다. */
  readonly classes: readonly string[]
  readonly featureCount: number
  /** `dataset/data.csv`의 행 번호. 헤더를 빼고 0부터 센다 (mlpx-spec.md 5.1). */
  readonly trainIndices: readonly number[]
}

const referenceModelSchema = z.looseObject({
  format: z.literal(REFERENCE_FORMAT),
  k: z.number(),
  classes: z.array(z.string()).min(1),
  featureCount: z.number(),
  trainIndices: z.array(z.number()).min(1),
})

function invalid(field: string): never {
  throw new ClientError('MODEL_FILE_INVALID', { field })
}

export interface NeighborhoodInput {
  readonly k: number
  readonly featureCount: number
  /** 전처리를 마친 학습 행렬. */
  readonly rows: readonly (readonly number[])[]
  /** rows와 같은 순서의 정답. */
  readonly labels: readonly string[]
  /** rows[i]의 **원본 행 번호.** 동점을 가르는 마지막 기준이다. */
  readonly indices: readonly number[]
}

/**
 * (거리, 행 번호)의 사전식 전순서에서 **더 나쁜 쪽**인가.
 *
 * 이 순서 하나가 **규칙 1**을 정한다 (mlpx-spec.md 5.6). 득표 동점(규칙 3)은 이제 라벨의
 * 정렬 순서가 정하므로 여기가 아니다 — 2026-08-10에 sklearn 규약으로 바꿨다.
 * 전순서로 고른 k개 집합은 유일하므로
 * **힙으로 고르든 완전 정렬로 고르든 반드시 같은 집합**이 나온다.
 */
function worse(distanceA: number, indexA: number, distanceB: number, indexB: number): boolean {
  return distanceA > distanceB || (distanceA === distanceB && indexA > indexB)
}

/**
 * KNN 예측 함수를 만든다. **학습 쪽과 해석기 쪽이 이 함수 하나를 공유한다.**
 *
 * 득표 집계에 이웃의 순서는 필요 없다 - 클래스마다 개수만 들고 있으면 규칙 2~3이
 * 그대로 계산된다. 득표 동점은 **정렬 순서가 앞선 클래스**가 이긴다 - sklearn
 * `KNeighborsClassifier`와 같은 답이다 (mlpx-spec.md 5.6, 2026-08-10에 바꿨다).
 */
export function knnPredict(input: NeighborhoodInput): Predict {
  const { k, featureCount, rows, labels, indices } = input
  if (!Number.isInteger(k) || k <= 0) invalid('k')
  if (rows.length === 0) invalid('trainIndices')
  if (labels.length !== rows.length || indices.length !== rows.length) invalid('trainIndices')

  const matrix = rows.map((row) => {
    if (row.length !== featureCount) invalid('featureCount')
    return Float64Array.from(row)
  })
  // 이웃 수가 학습 행보다 많을 수는 없다. 있는 만큼만 본다.
  const neighbors = Math.min(k, matrix.length)

  return (features) =>
    features.map((query) => {
      if (query.length !== featureCount) invalid('featureCount')

      // 크기 k의 최대 힙. 꼭대기가 **지금 뽑아 둔 것 중 가장 나쁜 이웃**이다.
      const heapDistance = new Float64Array(neighbors)
      const heapRow = new Int32Array(neighbors)
      let size = 0

      const swap = (a: number, b: number): void => {
        const distance = heapDistance[a] ?? 0
        heapDistance[a] = heapDistance[b] ?? 0
        heapDistance[b] = distance
        const row = heapRow[a] ?? 0
        heapRow[a] = heapRow[b] ?? 0
        heapRow[b] = row
      }

      const worseAt = (a: number, b: number): boolean =>
        worse(heapDistance[a] ?? 0, heapRow[a] ?? 0, heapDistance[b] ?? 0, heapRow[b] ?? 0)

      matrix.forEach((row, position) => {
        let distance = 0
        for (let column = 0; column < featureCount; column += 1) {
          const gap = (query[column] ?? 0) - (row[column] ?? 0)
          distance += gap * gap
        }
        const rowIndex = indices[position] ?? 0

        if (size < neighbors) {
          let child = size
          size += 1
          heapDistance[child] = distance
          heapRow[child] = rowIndex
          while (child > 0) {
            const parent = (child - 1) >> 1
            if (!worseAt(child, parent)) break
            swap(child, parent)
            child = parent
          }
          return
        }

        if (!worse(heapDistance[0] ?? 0, heapRow[0] ?? 0, distance, rowIndex)) return
        heapDistance[0] = distance
        heapRow[0] = rowIndex
        let parent = 0
        for (;;) {
          const left = parent * 2 + 1
          const right = left + 1
          let worst = parent
          if (left < size && worseAt(left, worst)) worst = left
          if (right < size && worseAt(right, worst)) worst = right
          if (worst === parent) break
          swap(parent, worst)
          parent = worst
        }
      })

      // 클래스마다 개수. 순서는 필요 없다.
      const byLabel = new Map<string, number>()
      const rowToLabel = new Map<number, string>()
      indices.forEach((rowIndex, position) => {
        rowToLabel.set(rowIndex, labels[position] ?? '')
      })

      for (let slot = 0; slot < size; slot += 1) {
        const label = rowToLabel.get(heapRow[slot] ?? 0) ?? ''
        byLabel.set(label, (byLabel.get(label) ?? 0) + 1)
      }

      // 득표 동점은 정렬 순서가 앞선 클래스 - sklearn과 같은 답이다 (mlpx-spec.md 5.6).
      let best: string | undefined
      let bestCount = -1
      for (const [label, count] of byLabel) {
        if (count > bestCount || (count === bestCount && best !== undefined && label < best)) {
          best = label
          bestCount = count
        }
      }

      if (best === undefined) invalid('trainIndices')
      return best
    })
}

/**
 * 파일을 예측 함수로. **원본 학습 행이 있어야 한다** (mlpx-spec.md 5.0).
 *
 * 행을 고르는 것은 여기다 - 부르는 쪽은 그 실험의 학습 행을 통째로 주고, 이 모델이
 * 그중 어느 것을 쓰는지는 `trainIndices`가 안다. 그래서 부르는 쪽에 형식 지식이 없다.
 */
export function loadReferenceModel(file: unknown, context: LoadContext): Predict {
  const parsed = referenceModelSchema.safeParse(file)
  if (!parsed.success) invalid('payload')

  const { k, classes, featureCount, trainIndices } = parsed.data
  if (!Number.isInteger(featureCount) || featureCount <= 0) invalid('featureCount')

  const training = context.trainingRows
  if (!training) throw new ClientError('MODEL_NEEDS_DATASET', { format: REFERENCE_FORMAT })

  const known = new Map<number, number>()
  training.indices.forEach((rowIndex, position) => known.set(rowIndex, position))

  const rows: (readonly number[])[] = []
  const labels: string[] = []
  const indices: number[] = []
  for (const rowIndex of trainIndices) {
    const position = known.get(rowIndex)
    // **파일이 가리키는 행이 데이터에 없다.** 데이터가 통째로 없는 것과 다르다 - 이건
    // 파일 안에서 앞뒤가 안 맞는 것이라 학생이 할 수 있는 일은 다시 학습하는 것이다.
    if (position === undefined) invalid('trainIndices')
    const row = training.features[position]
    const label = training.target[position]
    if (row === undefined || label === undefined) invalid('trainIndices')
    if (!classes.includes(label)) invalid('classes')
    rows.push(row)
    labels.push(label)
    indices.push(rowIndex)
  }

  return knnPredict({ k, featureCount, rows, labels, indices })
}
