/**
 * **브라우저가 쿼터로 쓰기를 거절하는 순간을 세운다** (open-decisions.md 73).
 *
 * 쓰기 전에 여유를 재던 시절(`ensureRoom`)에는 `navigator.storage.estimate()`를 작게 흉내 내면
 * 저장이 거절됐다. 그 검사를 뺀 뒤로 거절은 **실제 쓰기**에서만 나므로, 여기서도 쓰기 자체가
 * `QuotaExceededError`를 던지게 한다 — 브라우저가 내는 것과 같은 이름이고, 그것을 우리 코드로
 * 바꾸는 것은 진짜 `saveProject`다.
 *
 * **프로젝트의 두 store만 거절한다.** 언어 선택·상한 해제(`preferences`)는 원래 실패를 삼키는
 * 자리라 여기서 막을 이유가 없다.
 */

import { vi } from 'vitest'

const REFUSED_STORES: ReadonlySet<string> = new Set(['projects', 'datasets'])

export function refuseWrites(): { restore: () => void } {
  const original = IDBObjectStore.prototype.put
  const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<IDBObjectStore['put']>
  ) {
    if (REFUSED_STORES.has(this.name)) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    }
    return original.apply(this, args)
  })
  return { restore: () => spy.mockRestore() }
}
