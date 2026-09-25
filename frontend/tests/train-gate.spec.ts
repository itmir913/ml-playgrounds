/**
 * **[학습하기]의 gate** (`ml/selection.ts`의 `trainGate`, architecture.md §10.2). 버튼 잠금과
 * `startTraining`의 거절이 이 함수 하나를 본다. `ui-rules.spec.ts`는 템플릿의 조합만 보므로
 * 조건은 여기서 하나씩 묻는다.
 *
 * **조건마다 mount 없이 묻는다.** 화면이 이 판정을 그대로 쓰는지는
 * `option-cascade.spec.ts`의 *"유형이 빠진 파일에서 …"*와 *"담은 모델이 전부 잠기면 …"*이 본다.
 */

import { describe, expect, it } from 'vitest'

import { trainGate } from '../src/ml/selection'

const tree = { algorithm: 'decision_tree' }
const linear = { algorithm: 'linear_regression' }

describe('trainGate — [학습하기]를 막는 이유 목록', () => {
  it('유형도 모델도 있고 하나라도 돌 수 있으면 비어 있다', () => {
    expect(trainGate({ taskType: 'classification', chosen: [tree, linear] })).toEqual([])
  })

  it('유형이 없으면 그것이 첫 이유다 — 모델이 담겨 있어도', () => {
    expect(trainGate({ taskType: undefined, chosen: [tree] })).toEqual(['NO_TASK_TYPE'])
  })

  it('담은 모델이 없으면 막는다', () => {
    expect(trainGate({ taskType: 'classification', chosen: [] })).toEqual(['NO_MODEL'])
  })

  it('담은 모델이 전부 지금 유형에 안 맞으면 막는다', () => {
    expect(trainGate({ taskType: 'classification', chosen: [linear] })).toEqual([
      'NO_TRAINABLE_MODEL',
    ])
  })

  /** **근본적인 것이 먼저다** (§10.2) — 유형을 모르면 모델 이야기는 뒤다. */
  it('여럿이 겹치면 근본적인 것부터 순서대로 전부 준다', () => {
    expect(trainGate({ taskType: undefined, chosen: [] })).toEqual(['NO_TASK_TYPE', 'NO_MODEL'])
  })

  /** 유형을 모르면 "맞지 않는다"를 말할 수 없다 — 잠긴 줄 판정과 같다(`chosenModelBlocks`). */
  it('유형이 없으면 모델이 맞는지 판정하지 않는다', () => {
    expect(trainGate({ taskType: undefined, chosen: [linear] })).toEqual(['NO_TASK_TYPE'])
  })
})
