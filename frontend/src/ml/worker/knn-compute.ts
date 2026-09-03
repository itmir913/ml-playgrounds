/**
 * KNN 예측 워커의 **판단 전부.** 워커 파일(`knn.worker.ts`)은 이것을 부르는 몇 줄만
 * 남는다 (`handler.ts`와 같은 사정).
 *
 * **예측 함수는 엔진의 `knnPredict` 그 함수다** — 여기 두 벌이 살면 직렬과 병렬이
 * 다른 답을 낼 자리가 생긴다. 신경망 컴퓨트 워커가 `accumulateChunk`를 그대로 부르는
 * 것과 같은 이유다 (open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와
 * 무관하다").
 *
 * **KNN은 학습이 아니라 예측을 가른다.** 담는 것이 행 번호뿐이라 학습에 비용이 없고,
 * 시험 행마다 이웃을 찾는 것이 전부다 — 그리고 **행마다 완전히 독립**이라 갈라도
 * 같은 답이 나온다.
 */

import { knnPredict } from '../models/reference'
import type { Predict } from '../models/types'

/** 워커가 학습 시작에 한 번 받는 것. 훈련 표본은 여기서 한 번만 건너간다. */
export interface KnnSeedMessage {
  readonly type: 'seed'
  readonly k: number
  readonly featureCount: number
  /** 훈련 행×열을 이어 붙인 표. */
  readonly rows: Float64Array
  readonly labels: readonly string[]
  /** 훈련 행의 원본 행 번호. 동점을 가르는 데 쓴다 (mlpx-spec.md §5.6). */
  readonly indices: readonly number[]
}

/** 스텝 하나 — 이 워커 몫의 시험 행들. */
export interface KnnStepMessage {
  readonly type: 'step'
  /** 시험 행×열을 이어 붙인 표. */
  readonly queries: Float64Array
}

export type KnnComputeRequest = KnnSeedMessage | KnnStepMessage

export interface KnnComputeReply {
  readonly type: 'answers'
  /** 받은 행 순서 그대로. 재조립은 풀이 행 번호로 한다. */
  readonly answers: readonly string[]
}

/** 이어 붙인 표를 행으로 되돌린다. 워커 경계를 넘는 모양이 언제나 이것이다. */
export function unflatten(flat: Float64Array, columns: number): number[][] {
  if (columns <= 0) return []
  const rows: number[][] = []
  for (let index = 0; index < flat.length; index += columns) {
    const row = new Array<number>(columns)
    for (let column = 0; column < columns; column += 1) row[column] = flat[index + column] as number
    rows.push(row)
  }
  return rows
}

/** 요청 하나를 처리하는 함수를 만든다. 훈련 표본과 예측 함수를 이 클로저가 든다. */
export function createKnnComputeHandler(): (
  request: KnnComputeRequest,
  emit: (reply: KnnComputeReply) => void,
) => void {
  let predict: Predict | null = null
  let featureCount = 0

  return (request, emit) => {
    if (request.type === 'seed') {
      featureCount = request.featureCount
      predict = knnPredict({
        k: request.k,
        featureCount: request.featureCount,
        rows: unflatten(request.rows, request.featureCount),
        labels: [...request.labels],
        indices: [...request.indices],
      })
      return
    }

    if (predict === null) {
      // 씨앗 전에 스텝이 왔다 — 프로토콜 위반이다. 빈 답을 내면 채점이 조용히 틀린다.
      throw new Error('knn compute: step before seed')
    }

    emit({
      type: 'answers',
      answers: predict(unflatten(request.queries, featureCount)).map(String),
    })
  }
}
