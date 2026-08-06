/**
 * 확인 모달이 걸린 라디오 그룹의 되돌리기 (`architecture.md` §8.15).
 *
 * **라디오는 값이 실제로 안 바뀌면 Vue가 `checked`를 다시 안 써 준다.** 어떤 옵션을
 * 고르는 게 확인 모달을 거쳐야 하면(예: 붙어 있던 파일을 떼는 것), 취소했을 때 모델
 * 값은 그대로다 - Vue 입장에서는 "바뀐 게 없다"라 DOM을 안 건드린다. 그런데 브라우저는
 * 클릭한 순간 이미 **같은 이름의 라디오 그룹 전체**의 네이티브 `checked`를 새로 고른
 * 옵션에 맞게 바꿔 둔 뒤다. 그래서 취소하면 이 훅으로 그룹 전체를 실제 값에 맞게
 * 손으로 되돌려야 한다 - 하나만 되돌리면 나머지가 브라우저가 꺼 둔 채로 남아 아무것도
 * 선택 안 된 것처럼 보인다.
 *
 * **옵션이 몇 개든 이 훅을 고칠 필요가 없다.** 값별로 노드를 등록해 두고, 되돌릴 때
 * 등록된 것을 전부 훑는다.
 */

export interface RadioGroupGuard<T extends string> {
  /**
   * 템플릿 `:ref`에 그대로 물린다: `:ref="guard.register('holdout')"`.
   * 라디오가 아닌 것이 물리면(v-if로 사라지는 등) 등록을 지운다.
   */
  register: (value: T) => (el: unknown) => void
  /** 등록된 라디오 전부를 `expected`에 맞게 되돌린다. */
  resync: (expected: T) => void
}

export function useRadioGroupGuard<T extends string>(): RadioGroupGuard<T> {
  const nodes = new Map<T, HTMLInputElement>()

  function register(value: T) {
    return (el: unknown): void => {
      if (el instanceof HTMLInputElement) {
        nodes.set(value, el)
      } else {
        nodes.delete(value)
      }
    }
  }

  function resync(expected: T): void {
    for (const [value, el] of nodes) {
      el.checked = value === expected
    }
  }

  return { register, resync }
}
