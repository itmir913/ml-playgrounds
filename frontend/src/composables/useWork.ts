/**
 * 이 화면에서 **지금 도는 일들.** 바쁜지, 무엇을 끊을 수 있는지, 어디까지 갔는지.
 *
 * **한 화면에서 일이 둘 이상 겹친다** (architecture.md §8.10.4). 긴 계산이 도는 동안
 * 학생이 사진을 놓는 것은 막을 일이 아니라 받아서 지킬 일이라고 정한 뒤로(§8.10.3),
 * 화면마다 들고 있던 **칸 하나짜리 상태가 전부 주인이 둘이 됐다** — `busy` boolean,
 * 손잡이 `ref`, 진행 `ref`. **칸이 하나인데 주인이 둘이면 먼저 끝난 쪽이 남의 것을
 * 지운다:** 굽는 중인데 잠금이 풀리고, 떠날 때 워커가 한쪽만 끊기고, 한쪽이 끝나며
 * 남의 진행 표시가 사라진다. R21 감사가 화면 넷에서 실측했다.
 *
 * **그래서 여기서는 셈이고 자루다.** 일마다 하나씩 잡고 자기 것만 놓는다.
 *
 * ```ts
 * const { busy, start, cancelAll } = useWork()
 *
 * async function bake(): Promise<void> {
 *   if (busy.value) return          // 겹치면 안 되는 일은 스스로 막는다
 *   const job = start()
 *   try {
 *     const handle = canonicalizeImages(...)
 *     job.hold(handle)              // 떠나면 이것도 함께 끊긴다
 *     await handle.result
 *   } finally {
 *     job.done()                    // 내 몫만 놓는다
 *   }
 * }
 * onBeforeUnmount(retire)          // 끊고, 끝났다고 표시한다
 * ```
 *
 * **`busy`는 `computed`라 쓸 수 없다.** 옛 모양(`busy.value = true`)은 검사가 아니라
 * 타입에서 선다 — 다음 사람이 되돌아가는 길을 막는 것은 이쪽이 확실하다.
 *
 * **그 말이 한동안 거짓이었다** (2026-09-02 R22 A-2). 돌려주는 타입이 `Ref<boolean>`이면
 * `computed`를 담아도 **소비자가 받는 것은 쓸 수 있는 칸이다** — `busy.value = true`가
 * 컴파일을 통과했고, 실행 시에는 Vue가 그 쓰기를 조용히 버렸다. 되돌아간 화면은
 * **`busy`가 영영 거짓인 채 아무것도 안 우는** 상태가 된다. 그래서 `ComputedRef`다.
 * 그 타입이 정말 서는지는 `tests/useWork.spec.ts`의 `@ts-expect-error`가 지킨다 —
 * 쓰기가 다시 합법이 되면 그 지시자가 **쓸모없어져서** 컴파일이 깨진다.
 */

import { computed, ref, toRaw, type ComputedRef, type Ref } from 'vue'

/** 끊을 수 있는 것. 워커 손잡이들이 이 모양이다. */
export interface Cancellable {
  cancel: () => void
}

/** 어디까지 갔는가. 백분율은 화면이 만든다. */
export interface WorkProgress {
  readonly completed: number
  readonly total: number
}

/** 일을 잡을 때 정하는 것. */
export interface StartOptions {
  /**
   * 도는 동안 화면을 막는가. **기본은 막는다.**
   *
   * **막지 않는 일도 끊어야 한다** — 예측이 도는 동안에도 사진은 더 받지만(§8.10.3),
   * 떠날 때 임베딩 워커는 끊어야 한다. 그 둘은 다른 질문이다.
   */
  blocks?: boolean
}

/** 도는 일 하나. `start()`가 준다. */
export interface Job {
  /**
   * 끊을 수 있는 것을 이 일에 맡긴다. **떠날 때 `cancelAll()`이 이것도 끊는다.**
   * 한 일이 여럿을 차례로 열면 마지막 것이 이 일의 손잡이다.
   *
   * **이미 떠났으면 맡아 주지 않고 그 자리에서 끊는다** (R23 재감사 A-1) — 맡기기
   * 전의 `await`가 몇 개든 늦게 뜬 워커가 앉을 수 없게 하는 것이 이 문의 일이다.
   */
  hold: (handle: Cancellable) => void
  /** 진행을 알린다. **다른 일의 표시를 건드리지 않는다.** */
  report: (completed: number, total: number) => void
  /** 진행 표시만 거둔다. 일은 계속 돈다 — 남은 것이 화면에 안 그려질 때 쓴다. */
  clear: () => void
  /** 이 일을 놓는다. **남의 자물쇠를 열지 않는다.** `finally`에서 부른다. */
  done: () => void
}

/** 화면이 받는 것. */
export interface Work {
  /** 화면을 막는 일이 하나라도 도는가. **읽기 전용이다** — 위 머리말이 그 이유다. */
  busy: ComputedRef<boolean>
  /** 보여줄 진행. **가장 나중에 시작한 일의 것이다** — 학생이 방금 한 일이 그것이다. */
  progress: ComputedRef<WorkProgress | null>
  start: (options?: StartOptions) => Job
  /** 도는 것을 전부 끊는다. **[취소]가 부른다** — 화면은 살아 있다. */
  cancelAll: () => void
  /**
   * **이 화면이 아직 살아 있는가.** 긴 계산 뒤에 스토어를 만지기 전에 본다.
   *
   * `cancelAll()`은 **맡긴 것**만 끊는데, 파일을 읽는 구간에는 맡길 손잡이가 없다
   * (`readImageZip`은 워커가 아니다). 그래서 읽는 동안 떠나면 끊을 것이 없고, 읽기가
   * 끝난 뒤 **죽은 화면의 코드가 워커를 열어 지금 열린 파일에 얹는다** — 그 사이 학생이
   * 다른 프로젝트를 열었으면 **그쪽에 앉는다** (2026-09-02 R23 B-2).
   */
  alive: () => boolean
  /**
   * **떠난다.** 도는 것을 전부 끊고 이 화면이 끝났다고 표시한다.
   * `onBeforeUnmount(retire)`가 이 함수의 유일한 자리다.
   */
  retire: () => void
}

export function useWork(): Work {
  /** 도는 일들. **시작한 순서다** — 진행 표시가 그 순서를 쓴다. */
  const live = ref<symbol[]>([])
  /** 그중 화면을 막는 것들. */
  const blocking = ref<symbol[]>([])
  const shown = ref(new Map<symbol, WorkProgress>())
  /**
   * 일 -> 끊을 것. **반응형 밖에 둔다** — 워커 손잡이를 `ref` 안에 넣으면 Vue가
   * 프록시로 감싸고, 화면이 읽을 일도 없는 것을 반응형으로 만들 이유가 없다.
   */
  const handles = new Map<symbol, Cancellable>()

  /**
   * 화면이 아직 살아 있는가. **반응형이 아니다** — 화면이 그리는 값이 아니라 긴 계산
   * 뒤에 "계속해도 되는가"를 묻는 자리라, `ref`로 두면 템플릿에서 읽으라고 부추긴다.
   */
  let living = true

  const busy = computed(() => blocking.value.length > 0)

  const progress = computed<WorkProgress | null>(() => {
    for (let index = live.value.length - 1; index >= 0; index -= 1) {
      const id = live.value[index]
      const found = id === undefined ? undefined : shown.value.get(id)
      if (found) return found
    }
    return null
  })

  function forget(id: symbol): void {
    const next = new Map(shown.value)
    if (next.delete(id)) shown.value = next
  }

  function start(options?: StartOptions): Job {
    const id = Symbol('work')
    live.value = [...live.value, id]
    if (options?.blocks !== false) blocking.value = [...blocking.value, id]

    return {
      hold(handle: Cancellable): void {
        // **떠난 뒤에 온 손잡이는 맡아 주지 않고 그 자리에서 끊는다**
        // (2026-09-02 R23 재감사 A-1).
        //
        // `alive()`를 `await`마다 놓는 처방은 **하나를 빠뜨린다** — 실제로 읽기 뒤에만
        // 놓았더니 `hold()` 앞에 자리 묻기가 하나 더 있었고, 그 창에서 떠나면 죽은
        // 화면이 워커를 열어 **지금 열린 파일에 얹었다.** 화면 셋에서 실측됐다.
        //
        // **그래서 맡기는 문 하나가 판정한다.** `await`가 앞에 몇 개든 상관없어진다.
        if (!living) {
          handle.cancel()
          return
        }
        handles.set(id, handle)
      },
      report(completed: number, total: number): void {
        shown.value = new Map(shown.value).set(id, { completed, total })
      },
      clear(): void {
        forget(id)
      },
      done(): void {
        handles.delete(id)
        forget(id)
        live.value = live.value.filter((one) => one !== id)
        blocking.value = blocking.value.filter((one) => one !== id)
      },
    }
  }

  function cancelAll(): void {
    // **끊는 것과 놓는 것은 다른 일이다.** 끊으면 그 일의 `finally`가 스스로 `done()`을
    // 부르므로 여기서 목록을 비우지 않는다 — 비우면 아직 도는 일이 안 바쁜 것이 된다.
    for (const handle of [...handles.values()]) handle.cancel()
  }

  function retire(): void {
    // **끊는 것과 끝난 것은 다른 일이다.** [취소]도 `cancelAll()`을 부르는데 그것은
    // 화면이 죽은 것이 아니다 — 한 함수로 묶으면 [취소] 한 번에 화면이 죽은 것이 된다.
    living = false
    cancelAll()
  }

  return { busy, progress, start, cancelAll, alive: () => living, retire }
}

/**
 * **내가 든 것만 치운다.** 확인 판(`pending`·`opened`)을 비우는 자리에서, 시작할 때 든
 * 값이 아직 그대로일 때만 비운다.
 *
 * 통째로 `null`을 쓰면 **그 사이에 학생이 새로 놓은 것이 함께 날아간다** — §8.10.3이
 * 스토어에서 고친 것과 같은 병이고 자리만 화면이다 (R21 A-1).
 *
 * **원본끼리 견준다.** `ref`는 값을 프록시로 감싸므로 든 것을 `slot.value`에서 읽었으면
 * 양쪽이 같은 프록시라 그냥도 맞다. 하지만 **한쪽만 원본이면 조용히 어긋난다** —
 * `toRaw`로 들거나 `shallowRef`로 바뀌는 날이 그날이고, 그때 이 함수는 아무것도 안
 * 치우면서 아무 말도 안 한다. `toRaw`는 프록시가 아닌 것에는 그대로라 손해가 없다.
 *
 * **못 보는 것: 내용이 같은 다른 객체.** 이것은 동일성이지 같음이 아니다 — 새로 읽은
 * 묶음이 우연히 같은 파일들이어도 그건 학생이 새로 놓은 것이므로 안 치우는 쪽이 맞다.
 */
export function clearIfHeld<T>(slot: Ref<T | null>, held: T): void {
  if (toRaw(slot.value) === toRaw(held)) slot.value = null
}
