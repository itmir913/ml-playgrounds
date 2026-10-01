/**
 * 단추를 눌러야 도는 결과 화면의 계산 — 결정 경계(69)·혼동 행렬 칸의 행(98)·순열 특성 중요도(99)의
 * "감사 뒤".
 *
 * 계산은 `ml/predict-in-steps.ts`처럼 나눠 돌며 화면에 양보한다. 여기는 그 바깥을 맡는다.
 *
 * - **결과가 없으면 `undefined`다** — 아직 안 눌렀다. 계산이 낸 `null`(재료가 없다)과 가른다.
 * - **화면을 떠나거나 `reset`하면 도는 계산을 멈추고 그 결과를 버린다.** 다른 실행의 결과가 늦게
 *   도착해 이 실행의 그림으로 서지 않는다.
 * - 멈춤(`StepsCancelled`)은 삼키고, 다른 실패는 그대로 던진다(`AppButton`의 `action` 규칙).
 *
 * 무는 검사: `tests/step-work.spec.ts`.
 */

import { onBeforeUnmount, shallowRef, type ShallowRef } from 'vue'

import { StepsCancelled, type StepControl } from '@/ml/predict-in-steps'

export interface StepWork<T> {
  /** 계산의 결과. **아직 안 눌렀으면 `undefined`.** */
  readonly result: ShallowRef<T | undefined>
  /** `AppButton`의 `action`으로 준다. */
  readonly start: () => Promise<void>
  /** 결과를 버리고 도는 계산을 멈춘다 — 보이는 실행이 바뀔 때 부른다. */
  readonly reset: () => void
}

export function useStepWork<T>(work: (control: StepControl) => Promise<T>): StepWork<T> {
  const result = shallowRef<T | undefined>(undefined)
  /** 지금 유효한 계산의 번호. 바뀌면 그 전의 계산은 멈춘다. */
  let current = 0

  async function start(): Promise<void> {
    current += 1
    const mine = current
    try {
      const value = await work({ cancelled: () => mine !== current })
      if (mine === current) result.value = value
    } catch (error) {
      if (!(error instanceof StepsCancelled)) throw error
    }
  }

  function reset(): void {
    current += 1
    result.value = undefined
  }

  onBeforeUnmount(() => {
    current += 1
  })

  return { result, start, reset }
}
