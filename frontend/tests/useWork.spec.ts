/**
 * **화면 여섯이 매달린 원시 연산**(`composables/useWork.ts`)을 직접 잰다.
 *
 * R21이 이것을 세울 때 검사는 **화면을 통해서만** 있었다. 그래서 R22 감사가 돌연변이를
 * 심었을 때 **일곱 중 넷이 안 울었다** — 진행 순서를 뒤집어도, `cancelAll`이 목록을
 * 통째로 비워도, `hold`가 앞 손잡이를 이겨도, `clearIfHeld`가 **아무것도 안 치워도**
 * 2,797개가 초록이었다. 화면 여섯이 한 함수에 매달린 자리에서 그 함수의 검사가 0개였다.
 *
 * **여기서 지키는 것은 셈의 규칙이다.** 화면에서 실제로 그렇게 되는지는 각 화면의
 * 마운트 검사가 잰다 — `image-panel-drop`·`image-predict-race`·`image-prep-drop`.
 */

import { describe, expect, it } from 'vitest'
import { ref, shallowRef, toRaw } from 'vue'

import { clearIfHeld, useWork, type Cancellable } from '../src/composables/useWork'

/** 끊긴 횟수를 세는 손잡이. 워커 손잡이가 이 모양이다. */
function handle(): Cancellable & { cancelled: number } {
  const one = {
    cancelled: 0,
    cancel(): void {
      one.cancelled += 1
    },
  }
  return one
}

describe('바쁨은 셈이다', () => {
  it('한 일이 끝나도 아직 도는 일의 자물쇠는 안 열린다', () => {
    const work = useWork()
    const first = work.start()
    const second = work.start()
    expect(work.busy.value).toBe(true)

    // **먼저 끝난 쪽이 남의 것을 놓지 않는다.** boolean 하나였을 때가 R21의 병이다.
    second.done()
    expect(work.busy.value).toBe(true)

    first.done()
    expect(work.busy.value).toBe(false)
  })

  it('같은 일을 두 번 놓아도 셈이 음수로 가지 않는다', () => {
    const work = useWork()
    const job = work.start()
    const other = work.start()
    job.done()
    job.done()
    expect(work.busy.value).toBe(true)
    other.done()
    expect(work.busy.value).toBe(false)
  })

  /**
   * **막지 않는 일도 끊어야 한다.** 예측이 도는 동안에도 사진은 더 받지만(§8.10.3)
   * 떠날 때 임베딩 워커는 끊어야 한다 — 그 둘은 다른 질문이다.
   */
  it('막지 않는 일은 셈에 안 들어가지만 끊기는 한다', () => {
    const work = useWork()
    const embedding = handle()
    const job = work.start({ blocks: false })
    job.hold(embedding)
    expect(work.busy.value).toBe(false)

    work.cancelAll()
    expect(embedding.cancelled).toBe(1)
  })

  it('막는 일과 안 막는 일이 섞여도 막는 것만 센다', () => {
    const work = useWork()
    const blocking = work.start()
    const open = work.start({ blocks: false })
    expect(work.busy.value).toBe(true)

    blocking.done()
    // 안 막는 일이 아직 도는데 자물쇠는 풀려 있어야 한다.
    expect(work.busy.value).toBe(false)
    open.done()
    expect(work.busy.value).toBe(false)
  })

  /**
   * **읽기 전용이다.** 이 줄이 통과하면(=지시자가 쓸모없어지면) 컴파일이 깨진다.
   * 타입이 `Ref<boolean>`이던 동안 `busy.value = true`가 조용히 합법이었고, 실행 시에는
   * Vue가 그 쓰기를 버려 **되돌아간 화면이 영영 안 바쁜 채로 남았다** (R22 A-2).
   */
  it('바쁨과 진행에는 쓸 수 없다', () => {
    const work = useWork()
    // @ts-expect-error - busy는 ComputedRef다
    work.busy.value = true
    // @ts-expect-error - progress도 ComputedRef다
    work.progress.value = { completed: 1, total: 2 }
    expect(work.busy.value).toBe(false)
    expect(work.progress.value).toBeNull()
  })
})

describe('손잡이는 자루다', () => {
  it('떠날 때 맡긴 것을 전부 끊는다', () => {
    const work = useWork()
    const baking = handle()
    const embedding = handle()
    work.start().hold(baking)
    work.start().hold(embedding)

    work.cancelAll()
    // **한쪽만 끊기던 것이 R21의 병이다.** 칸이 하나라 나중 것이 앞의 것을 덮었다.
    expect(baking.cancelled).toBe(1)
    expect(embedding.cancelled).toBe(1)
  })

  /**
   * **끊는 것과 놓는 것은 다른 일이다.** 끊으면 그 일의 `finally`가 스스로 `done()`을
   * 부르므로 `cancelAll`은 목록을 안 비운다 — 비우면 **아직 도는 일이 안 바쁜 것이 되고**
   * 화면이 열린 채로 계산이 뒤에서 돈다.
   */
  it('끊었다고 해서 그 일이 놓아지지는 않는다', () => {
    const work = useWork()
    const job = work.start()
    job.hold(handle())

    work.cancelAll()
    expect(work.busy.value).toBe(true)

    // 거절이 도착해 `finally`가 도는 시점이 여기다.
    job.done()
    expect(work.busy.value).toBe(false)
  })

  it('놓은 일은 다음 취소가 다시 끊지 않는다', () => {
    const work = useWork()
    const done = handle()
    const job = work.start()
    job.hold(done)
    job.done()

    work.cancelAll()
    expect(done.cancelled).toBe(0)
  })

  /**
   * **한 일이 둘을 차례로 열면 마지막 것이 그 일의 손잡이다.** 지금 그런 자리는 없지만
   * 규칙이 없으면 다음 사람이 **앞 손잡이가 조용히 버려지는 것**을 모른다.
   */
  it('한 일이 두 번 맡기면 나중 것이 이긴다', () => {
    const work = useWork()
    const first = handle()
    const second = handle()
    const job = work.start()
    job.hold(first)
    job.hold(second)

    work.cancelAll()
    expect(first.cancelled).toBe(0)
    expect(second.cancelled).toBe(1)
  })
})

describe('진행도 일마다다', () => {
  it('한쪽이 끝나며 남의 진행 표시를 지우지 않는다', () => {
    const work = useWork()
    const first = work.start()
    const second = work.start()
    first.report(1, 10)
    second.report(3, 4)

    second.done()
    // 둘째가 나가면 남은 것은 첫째의 것이다 — `null`이 아니다.
    expect(work.progress.value).toEqual({ completed: 1, total: 10 })
  })

  /**
   * **가장 나중에 시작한 일의 것을 보인다.** 학생이 방금 한 일이 그것이라서다.
   * 순서를 뒤집어도 아무것도 안 울던 자리다 (R22 C-2).
   */
  it('겹치면 가장 나중에 시작한 일의 것을 보인다', () => {
    const work = useWork()
    const first = work.start()
    first.report(1, 10)
    const second = work.start()
    second.report(3, 4)

    expect(work.progress.value).toEqual({ completed: 3, total: 4 })
  })

  it('나중 일이 아직 보고를 안 했으면 앞 일의 것을 보인다', () => {
    const work = useWork()
    work.start().report(1, 10)
    work.start()

    expect(work.progress.value).toEqual({ completed: 1, total: 10 })
  })

  it('진행만 거두어도 일은 계속 돈다', () => {
    const work = useWork()
    const job = work.start()
    job.report(2, 5)
    job.clear()

    expect(work.progress.value).toBeNull()
    expect(work.busy.value).toBe(true)
  })

  it('도는 일이 없으면 진행도 없다', () => {
    const work = useWork()
    const job = work.start()
    job.report(2, 5)
    job.done()

    expect(work.progress.value).toBeNull()
  })
})

describe('내가 든 것만 치운다', () => {
  it('시작할 때 든 것이 아직 그대로면 비운다', () => {
    const slot = ref<readonly string[] | null>(['a.jpg'])
    const held = slot.value
    clearIfHeld(slot, held)
    expect(slot.value).toBeNull()
  })

  /**
   * **굽는 동안 학생이 새로 놓은 것은 남아야 한다.** 통째로 `null`을 쓰면 판에 선 것을
   * 보고 있던 학생이 말없이 잃는다 (R21 A-1).
   */
  it('그 사이에 새로 놓인 것은 안 치운다', () => {
    const slot = ref<readonly string[] | null>(['first.jpg'])
    const held = slot.value
    slot.value = ['second.jpg']

    clearIfHeld(slot, held)
    expect(slot.value).toEqual(['second.jpg'])
  })

  it('이미 비어 있으면 아무 일도 안 한다', () => {
    const slot = ref<readonly string[] | null>(null)
    clearIfHeld(slot, ['a.jpg'])
    expect(slot.value).toBeNull()
  })

  it('shallowRef에서도 같다', () => {
    const slot = shallowRef<readonly string[] | null>(['a.jpg'])
    const held = slot.value
    clearIfHeld(slot, ['a.jpg'])
    expect(slot.value).toEqual(['a.jpg'])

    clearIfHeld(slot, held)
    expect(slot.value).toBeNull()
  })

  /**
   * **한쪽만 원본이어도 맞는다.** `ref`는 값을 프록시로 감싸므로 든 것을 `toRaw`로
   * 들거나 스토어에서 원본을 받아 오면 동일성이 어긋나고, 그러면 이 함수는 **아무것도
   * 안 치우면서 아무 말도 안 한다.**
   */
  it('한쪽이 원본이고 한쪽이 프록시여도 같은 것으로 본다', () => {
    const slot = ref<readonly string[] | null>(['a.jpg'])
    const raw = toRaw(slot.value)
    expect(raw).not.toBe(slot.value)

    clearIfHeld(slot, raw)
    expect(slot.value).toBeNull()
  })

  it('내용이 같은 다른 객체는 안 치운다', () => {
    const slot = ref<readonly string[] | null>(['a.jpg'])
    clearIfHeld(slot, ['a.jpg'])
    expect(slot.value).toEqual(['a.jpg'])
  })
})
