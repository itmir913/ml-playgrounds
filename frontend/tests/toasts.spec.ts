/**
 * 알림 (`stores/toasts.ts`) — **실패가 학생에게 닿는 마지막 자리다.**
 *
 * **이 파일에 닿는 스펙이 하나도 없었다** (V11 R5 B-1). `AUTO_DISMISS`에 `'danger'`를
 * 넣어 실패 알림이 6초 뒤 조용히 사라지게 만들어도 저장소 전체 1,917개가 통과했다.
 * 그 한 줄 위에는 왜 성공만 사라져도 되는지를 논증한 주석이 열여덟 줄 붙어 있다 —
 * **주석이 길수록 검사가 없다**는 이 저장소의 패턴이 그대로 나온 자리다(V11 R5 §9.2).
 *
 * 학생이 자리를 비운 사이 학습이 실패하면, 저절로 사라지는 알림은 **그 사실을 통째로
 * 없앤다.** 크래시가 아니라 알아야 할 것이 조용히 없어지는 쪽이다.
 */

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TOAST_DURATION_MS } from '../src/limits'
import { useToastStore } from '../src/stores/toasts'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

/** 알림 수명을 넘겨 돌린다. 넉넉히 넘긴다 - 경계를 재는 자리가 아니다. */
function waitOutTheToast(): void {
  vi.advanceTimersByTime(TOAST_DURATION_MS * 2)
}

describe('저절로 사라지는 것과 남는 것', () => {
  it('성공은 저절로 사라진다 - 읽고 닫으라고 붙들 이유가 없다', () => {
    const toasts = useToastStore()
    toasts.push('success', 'project.exportDone')
    expect(toasts.items).toHaveLength(1)

    waitOutTheToast()

    expect(toasts.items).toHaveLength(0)
  })

  it('실패는 안 사라진다 - 자리를 비운 사이 학습이 실패해도 그 사실이 남아야 한다', () => {
    const toasts = useToastStore()
    toasts.pushError(new Error('무언가 잘못됐다'))
    expect(toasts.items).toHaveLength(1)

    waitOutTheToast()

    expect(toasts.items).toHaveLength(1)
    expect(toasts.items[0]?.tone).toBe('danger')
  })

  it('주의와 안내도 안 사라진다', () => {
    const toasts = useToastStore()
    toasts.push('caution', 'data.tabular.droppedColumns', { names: '점수' })
    toasts.push('info', 'project.exportDropped', { count: 1 })

    waitOutTheToast()

    expect(toasts.items.map((one) => one.tone)).toEqual(['caution', 'info'])
  })

  it('학생이 닫으면 사라진다 - 남는다는 것이 못 닫는다는 뜻은 아니다', () => {
    const toasts = useToastStore()
    const id = toasts.pushError(new Error('무언가 잘못됐다'))

    toasts.dismiss(id)

    expect(toasts.items).toHaveLength(0)
  })
})

/**
 * **어조·키·파라미터가 전부 같을 때만 합친다.** 같은 코드라도 파라미터가 다르면 따로
 * 뜬다 — 사진 두 장이 서로 다른 이유로 빠진 것은 두 사실이기 때문이다.
 */
describe('같은 알림을 두 번 쌓지 않는다', () => {
  it('글자까지 같으면 하나다', () => {
    const toasts = useToastStore()
    toasts.push('caution', 'portfolio.photoSkipped', { count: 1 })
    toasts.push('caution', 'portfolio.photoSkipped', { count: 1 })

    expect(toasts.items).toHaveLength(1)
  })

  it('파라미터가 다르면 둘이다 - 다른 사실이다', () => {
    const toasts = useToastStore()
    toasts.push('caution', 'portfolio.photoSkipped', { count: 1 })
    toasts.push('caution', 'portfolio.photoSkipped', { count: 2 })

    expect(toasts.items).toHaveLength(2)
  })

  it('어조가 다르면 둘이다', () => {
    const toasts = useToastStore()
    toasts.push('info', 'project.exportDone')
    toasts.push('success', 'project.exportDone')

    expect(toasts.items).toHaveLength(2)
  })
})

/**
 * **떠나는 화면의 알림만 걷는다** (2026-08-29 화면 실측 B-8).
 *
 * 라우터가 `afterEach`에서 수위선을 들고 부른다 (`router/index.ts`). 통째로 지우면
 * **이동 도중에 뜬 알림**(가드의 flush 실패)이 새 화면에 닿기도 전에 사라진다.
 */
describe('화면을 옮기면 그 화면의 알림을 걷는다', () => {
  it('수위선 이하만 지운다', () => {
    const toasts = useToastStore()
    const before = toasts.push('danger', 'client.A')
    const mark = toasts.highWaterMark()
    const during = toasts.push('danger', 'client.B')

    toasts.dismissUpTo(mark)

    expect(toasts.items.map((toast) => toast.id)).toEqual([during])
    expect(before).toBeLessThanOrEqual(mark)
  })

  /** 이동이 끝나면 수위선을 다시 잡으므로, 살아남은 것도 **다음 이동 때는** 걷힌다. */
  it('살아남은 알림도 그다음 이동에서는 걷힌다', () => {
    const toasts = useToastStore()
    toasts.push('danger', 'client.A')
    toasts.dismissUpTo(toasts.highWaterMark())
    expect(toasts.items).toHaveLength(0)
  })

  it('아무것도 없으면 아무 일도 안 한다', () => {
    const toasts = useToastStore()
    expect(() => toasts.dismissUpTo(toasts.highWaterMark())).not.toThrow()
    expect(toasts.items).toHaveLength(0)
  })
})
