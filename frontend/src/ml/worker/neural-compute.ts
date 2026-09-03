/**
 * 신경망 조각 계산 워커의 **판단 전부.** 워커 파일(neural-compute.worker.ts)은 이것을
 * 부르는 몇 줄만 남는다 — handler.ts와 같은 사정이다(jsdom에는 Worker가 없어서 워커
 * 파일은 테스트로 덮이지 않고, 덮이지 않는 곳에는 틀릴 수 있는 것을 두지 않는다).
 *
 * 계산 자체는 엔진의 `accumulateChunk` **그 함수**다 — 여기 두 벌이 살면 직렬과 병렬이
 * 다른 수학을 갖게 되고, "결과는 코어 수와 무관하다"가 함수 층에서 깨진다
 * (open-decisions.md "학습을 코어로 가른다 — 결과는 코어 수와 무관하다").
 */

import {
  accumulateChunk,
  objectiveFor,
  readParameters,
  type NeuralTask,
  type Objective,
} from '../engines/neural'

/** 풀이 워커에게 보내는 것 — 학습 시작에 씨앗 한 번, 그 뒤로는 스텝마다 하나다. */
export type NeuralComputeRequest =
  | {
      readonly type: 'seed'
      /** 행×열을 이어 붙인 표. 중첩 배열보다 복제가 훨씬 싸다. */
      readonly rows: Float64Array
      readonly columns: number
      readonly targets: Float64Array
      readonly sizes: readonly number[]
      readonly task: NeuralTask
    }
  | {
      readonly type: 'step'
      /** `flattenParameters`가 편 가중치·절편. */
      readonly parameters: Float64Array
      /** 이 워커 몫의 조각들 — 조각마다 표본 행 번호 목록이다. */
      readonly chunks: readonly (readonly number[])[]
    }

export interface NeuralComputeChunk {
  readonly lossSum: number
  readonly gradWeights: readonly Float64Array[]
  readonly gradIntercepts: readonly Float64Array[]
}

/** 스텝 하나의 답 — 받은 조각 순서 그대로다. 재조립은 풀이 조각 번호로 한다. */
export interface NeuralComputeReply {
  readonly type: 'chunks'
  readonly results: readonly NeuralComputeChunk[]
}

/**
 * 요청 하나를 처리하는 함수를 만든다. 씨앗(표본·목적함수)은 이 클로저가 든다.
 *
 * `emit`의 두 번째 인자는 이전(transfer) 목록이다 — 기울기 버퍼는 돌려주고 나면
 * 이 워커에 볼일이 없으므로 복사 대신 옮긴다.
 */
export function createNeuralComputeHandler(): (
  request: NeuralComputeRequest,
  emit: (reply: NeuralComputeReply, transfer: Transferable[]) => void,
) => void {
  let features: number[][] = []
  let targets: number[] = []
  let sizes: readonly number[] = []
  let objective: Objective | null = null
  let activations: Float64Array[] = []
  let deltas: Float64Array[] = []

  return (request, emit) => {
    if (request.type === 'seed') {
      const { columns } = request
      features = []
      if (columns > 0) {
        for (let offset = 0; offset < request.rows.length; offset += columns) {
          const row = new Array<number>(columns)
          for (let j = 0; j < columns; j += 1) row[j] = request.rows[offset + j] as number
          features.push(row)
        }
      } else {
        // 특성이 0열인 표 — 행 수는 타깃이 안다. 엔진과 같은 가장자리를 그대로 지난다.
        features = Array.from({ length: request.targets.length }, () => [])
      }
      targets = [...request.targets]
      sizes = request.sizes
      objective = objectiveFor(request.task)
      activations = sizes.map((size) => new Float64Array(size))
      deltas = sizes.slice(1).map((size) => new Float64Array(size))
      return
    }

    if (objective === null) {
      // 씨앗 전에 스텝이 왔다 — 프로토콜 위반이다. 조용히 빈 답을 내면 풀이 접는 값이
      // 통째로 틀리므로 던진다. 워커의 error 이벤트가 풀의 step을 거절로 끝낸다.
      throw new Error('neural compute: step before seed')
    }

    const { weights, intercepts } = readParameters(request.parameters, sizes)
    const results: NeuralComputeChunk[] = []
    const transfer: Transferable[] = []
    for (const rows of request.chunks) {
      const gradWeights = sizes
        .slice(0, -1)
        .map((size, layer) => new Float64Array(size * (sizes[layer + 1] as number)))
      const gradIntercepts = sizes.slice(1).map((size) => new Float64Array(size))
      const lossSum = accumulateChunk(
        weights,
        intercepts,
        features,
        targets,
        rows,
        objective,
        activations,
        deltas,
        gradWeights,
        gradIntercepts,
      )
      results.push({ lossSum, gradWeights, gradIntercepts })
      for (const grad of gradWeights) transfer.push(grad.buffer)
      for (const grad of gradIntercepts) transfer.push(grad.buffer)
    }
    emit({ type: 'chunks', results }, transfer)
  }
}
