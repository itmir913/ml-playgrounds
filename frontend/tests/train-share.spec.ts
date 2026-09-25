/**
 * **학습 예상 시간이 곱하는 훈련 몫** (`ml/selection.ts`의 `trainShare`). 테스트 데이터를
 * 따로 올렸으면(`provided`) 정본은 전부 훈련이고, 군집은 아예 나누지 않는다. 화면이 이 함수를
 * 쓰는지는 `train-prep-kind.spec.ts`의 *"예상 시간의 행 수가 계획의 훈련 행 수와 같다"*가 본다.
 */

import { describe, expect, it } from 'vitest'

import { trainShare } from '../src/ml/selection'

describe('trainShare', () => {
  it('holdout이면 시험 몫을 뺀다', () => {
    expect(trainShare({ method: 'holdout', testSize: 0.2 }, 'classification')).toBeCloseTo(0.8)
  })

  it('테스트 데이터를 따로 올렸으면 정본은 전부 훈련이다', () => {
    expect(trainShare({ method: 'provided', testSize: 0.2 }, 'regression')).toBe(1)
  })

  it('군집은 나누지 않으므로 전부 훈련이다', () => {
    expect(trainShare({ method: 'holdout', testSize: 0.2 }, 'clustering')).toBe(1)
  })

  /** 유형을 모르면 나눈다고 본다 — `splitsData`와 같다. */
  it('유형을 모르면 holdout의 시험 몫을 뺀다', () => {
    expect(trainShare({ method: 'holdout', testSize: 0.25 }, undefined)).toBeCloseTo(0.75)
  })
})
