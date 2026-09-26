/**
 * **[학습하기]의 gate** (`ml/selection.ts`의 `trainGate`, architecture.md §10.2). 버튼 잠금과
 * `startTraining`의 거절이 이 함수 하나를 본다. `ui-rules.spec.ts`는 템플릿의 조합만 보므로
 * 조건은 여기서 하나씩 묻는다.
 *
 * **잠금은 보수적으로 둔다** (architecture.md §10.6, `open-decisions.md` 60). 이유는 모델에 관한
 * 둘뿐이고, 유형이 빠진 것은 잠금이 아니라 누를 때의 실패 알림이다.
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

  /** 유형이 빠진 파일은 잠그지 않는다 — 누르면 학습 화면이 실패를 알린다(결정문 60). */
  it('유형이 없어도 모델이 담겨 있으면 막지 않는다', () => {
    expect(trainGate({ taskType: undefined, chosen: [tree] })).toEqual([])
  })

  it('담은 모델이 없으면 막는다', () => {
    expect(trainGate({ taskType: 'classification', chosen: [] })).toEqual(['NO_MODEL'])
    expect(trainGate({ taskType: undefined, chosen: [] })).toEqual(['NO_MODEL'])
  })

  it('담은 모델이 전부 지금 유형에 안 맞으면 막는다', () => {
    expect(trainGate({ taskType: 'classification', chosen: [linear] })).toEqual([
      'NO_TRAINABLE_MODEL',
    ])
  })

  /** 유형을 모르면 "맞지 않는다"를 말할 수 없다 — 잠긴 줄 판정과 같다(`chosenModelBlocks`). */
  it('유형이 없으면 모델이 맞는지 판정하지 않는다', () => {
    expect(trainGate({ taskType: undefined, chosen: [linear] })).toEqual([])
  })
})
