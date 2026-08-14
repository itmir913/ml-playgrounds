/**
 * 답에 붙는 증거 등록부 (`ml/answer-evidence.ts`).
 *
 * **여기서 지키는 것은 "답 목록에 조건이 안 생기는가"다.** 축 어휘는 타입이 지키므로
 * (`ml/axes.ts`) 다시 세지 않는다. 타입이 못 잡는 셋을 본다 — 아무 데서도 안 서는 줄,
 * 붙을 것이 없는 조합에서 조용한가, 그리고 재료가 없는 실행을 걸러내는가.
 *
 * **음성이 오는 날 여기 줄 하나가 는다.** 그때 `AnswerList`는 한 줄도 안 고쳐야 한다 —
 * 그 사실을 지키는 것이 이 파일이다.
 */

import { describe, expect, it } from 'vitest'

import { ANSWER_EVIDENCE, answerEvidenceFor } from '../src/ml/answer-evidence'
import { DATA_TYPES, TASK_TYPES, type Run } from '../src/project/schema'

function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    algorithm: 'k_means',
    hyperparameters: {},
    trainedAt: '2026-08-14T00:00:00.000Z',
    status: 'done',
    computedBy: 'browser',
    ...overrides,
  }
}

/** 모델이 담긴 군집 실행. 배정을 되계산할 재료가 있는 상태다. */
const clustered = run({
  model: {
    path: 'model/run-1.json',
    format: 'mlpx-kmeans-v1',
    includesPreprocessing: false,
    sizeBytes: 10,
  },
})

describe('증거 등록부', () => {
  it('id가 겹치지 않는다', () => {
    expect(new Set(ANSWER_EVIDENCE.map((entry) => entry.id)).size).toBe(ANSWER_EVIDENCE.length)
  })

  it('아무 데서도 안 서는 줄이 없다', () => {
    // 칸을 다 채웠는데 전부 false인 줄은 화면 어디에도 안 나온다. 지웠어야 할 줄이다.
    for (const entry of ANSWER_EVIDENCE) {
      expect(
        DATA_TYPES.some((dataType) => entry.dataTypes[dataType]),
        entry.id,
      ).toBe(true)
      expect(
        TASK_TYPES.some((taskType) => entry.taskTypes[taskType]),
        entry.id,
      ).toBe(true)
    }
  })
})

describe('답에 무엇을 붙이나', () => {
  it('이미지 군집 답에는 사진이 붙는다', () => {
    expect(answerEvidenceFor('image', 'clustering', clustered)?.id).toBe('image-cluster-members')
  })

  /**
   * **표 군집에는 안 붙는다.** 거기는 산점도와 이웃이 목록 밖에 이미 서 있다
   * (architecture.md §8.13.1) — 같은 것을 두 자리에서 말하면 학생이 둘을 견준다.
   */
  it('표 군집 답에는 안 붙는다', () => {
    expect(answerEvidenceFor('tabular', 'clustering', clustered)).toBeNull()
  })

  /** 분류 답은 그 자체가 범주 이름이라 더 할 말이 없다. */
  it('분류 답에는 안 붙는다', () => {
    expect(answerEvidenceFor('image', 'classification', clustered)).toBeNull()
  })

  /**
   * **재료가 없으면 여는 단추도 안 단다** (§9.5). 군집 배정은 파일에 안 담기고 모델로
   * 되계산하므로, 모델이 예산에서 밀린 실행에는 열어도 보여줄 것이 없다.
   */
  it('모델이 안 담긴 실행에는 안 붙는다', () => {
    expect(answerEvidenceFor('image', 'clustering', run())).toBeNull()
  })
})
