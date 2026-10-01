/**
 * 결과 화면의 패널이 저장된 모델로 **나눠 예측한다** — 결정 경계(69)·혼동 행렬 칸의 행(98)·순열 특성
 * 중요도(99)의 "감사 뒤".
 *
 * 패널은 학습이 끝난 모델로 테스트 데이터나 격자를 다시 예측한다. KNN은 한 행이 훈련 행 수만큼의 거리
 * 계산이라, 한 번에 예측하면 화면이 초 단위로 멈췄다(0.30.13 이후 diff 감사 B-2·B-3). 여기서
 * `RESULT_PREDICT_CHUNK_ROWS`행씩 나누고 **시작할 때와 조각마다 화면에 양보한다**(`screen.ts`의
 * `yieldToScreen` — 안 그러면 단추의 이중 실행 방지가 무력해진다).
 *
 * **답은 한 번에 예측한 것과 같다** — 행끼리 독립인 예측만 받는다(`Predict`). 무는 검사:
 * `tests/predict-in-steps.spec.ts`.
 */

import { RESULT_PREDICT_CHUNK_ROWS } from '@/limits'
import { yieldToScreen } from '@/screen'

import type { Prediction } from './metrics'
import type { Predict } from './models/types'

/** 계산을 멈췄다 — 패널을 떠났다. 부르는 쪽은 잡아서 조용히 지나간다. */
export class StepsCancelled extends Error {
  constructor() {
    super('steps cancelled')
    this.name = 'StepsCancelled'
  }
}

export interface StepControl {
  /** 참이면 다음 양보 뒤에 `StepsCancelled`를 던진다. */
  readonly cancelled?: (() => boolean) | undefined
}

/** 화면에 양보하고, 멈추라면 던진다. */
export async function pause(control: StepControl): Promise<void> {
  await yieldToScreen()
  if (control.cancelled?.()) throw new StepsCancelled()
}

/** `features`를 조각내 예측한다. 조각마다 화면에 양보한다. */
export async function predictInSteps(
  predict: Predict,
  features: readonly (readonly number[])[],
  control: StepControl = {},
): Promise<Prediction[]> {
  const out: Prediction[] = []
  for (let start = 0; start < features.length; start += RESULT_PREDICT_CHUNK_ROWS) {
    await pause(control)
    for (const one of predict(features.slice(start, start + RESULT_PREDICT_CHUNK_ROWS))) {
      out.push(one)
    }
  }
  return out
}
