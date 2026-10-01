/**
 * 나눠 예측하기 (`ml/predict-in-steps.ts`).
 *
 * **답은 한 번에 예측한 것과 같고, 조각마다 화면에 양보한다**를 문다. 양보가 없으면 결과 화면의
 * 패널이 KNN에서 초 단위로 멈췄다(0.30.13 이후 diff 감사 B-2·B-3).
 */

import { describe, expect, it, vi } from 'vitest'

import { RESULT_PREDICT_CHUNK_ROWS } from '../src/limits'
import type { Predict } from '../src/ml/models/types'
import { predictInSteps, StepsCancelled } from '../src/ml/predict-in-steps'

const double: Predict = (features) => features.map((row) => (row[0] ?? 0) * 2)

const rows = (count: number) => Array.from({ length: count }, (_value, index) => [index])

describe('predictInSteps', () => {
  it('한 번에 예측한 것과 같은 답을 같은 차례로 낸다', async () => {
    const features = rows(RESULT_PREDICT_CHUNK_ROWS * 2 + 7)
    expect(await predictInSteps(double, features)).toEqual(double(features))
  })

  it('한 번에 조각 하나만 예측한다', async () => {
    const predict = vi.fn(double)
    await predictInSteps(predict, rows(RESULT_PREDICT_CHUNK_ROWS * 2 + 7))
    expect(predict).toHaveBeenCalledTimes(3)
    for (const [features] of predict.mock.calls) {
      expect(features.length).toBeLessThanOrEqual(RESULT_PREDICT_CHUNK_ROWS)
    }
  })

  it('멈추라면 다음 조각을 예측하지 않고 던진다', async () => {
    const predict = vi.fn(double)
    let calls = 0
    const control = { cancelled: () => calls > 0 }
    const running = predictInSteps(
      (features) => {
        calls += 1
        return predict(features)
      },
      rows(RESULT_PREDICT_CHUNK_ROWS * 3),
      control,
    )
    await expect(running).rejects.toBeInstanceOf(StepsCancelled)
    expect(predict).toHaveBeenCalledTimes(1)
  })
})
