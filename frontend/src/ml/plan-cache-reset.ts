/**
 * 표 계획 캐시(`ml/plan-cache.ts`)를 **비우는 신호만** 따로 둔 자리.
 *
 * **첫 화면이 계획 코드를 안 받게 하려고 갈랐다.** 스토어는 프로젝트를 열고 닫을 때 캐시를
 * 비우는데, 그것 하나 때문에 `plan-cache`를 바로 들이면 계획(`ml/plan.ts`)·CSV 파서
 * (`papaparse`)까지 첫 화면에 실렸다. 컴퓨터실 PC는 차시마다 리셋되어 매번 첫 방문이라
 * 그 몫을 매 수업 치른다.
 *
 * **캐시가 아직 안 실렸으면 비울 것도 없다** — 그래서 캐시 쪽이 실릴 때 제 비우기를 여기
 * 맡기고(`onForgetTabularPlan`), 스토어는 여기만 부른다. 무는 검사: `tabular-plan-cache.spec.ts`
 * *"프로젝트를 닫거나 바꾸면 캐시가 빈다"*, `entry-chunks.spec.ts`.
 */

const resets = new Set<() => void>()

/** 캐시 쪽이 실릴 때 한 번 부른다. */
export function onForgetTabularPlan(reset: () => void): void {
  resets.add(reset)
}

/** 다른 프로젝트를 열거나 닫을 때 스토어가 부른다. */
export function forgetTabularPlan(): void {
  for (const reset of resets) reset()
}
