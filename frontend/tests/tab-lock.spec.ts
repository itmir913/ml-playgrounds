// @vitest-environment jsdom
/**
 * 두 탭 잠금 (project/tab-lock.ts, open-decisions.md "프로젝트는 한 번에 하나만 연다").
 *
 * **"탭"은 새로 불러온 모듈 하나다.** `vi.resetModules()` 뒤의 import가 모듈 상태
 * (쥔 프로젝트·놓는 손잡이)를 새로 받으므로, 같은 가짜 수단을 보는 모듈 둘이 곧
 * 탭 둘이다 — 진짜 크로스탭 의미를 우리 코드 경계에서 그대로 잰다.
 *
 * jsdom에는 `navigator.locks`도 `BroadcastChannel`도 없다 — 수단은 전부 여기서
 * 세운 가짜다. 진짜 플랫폼 API의 동작은 플랫폼의 몫이고, 여기서 재는 것은
 * **우리가 그 API를 옳은 순서로 쓰는가**다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { TAB_LOCK_REPLY_WINDOW_MS } from '../src/limits'

type TabLockModule = typeof import('../src/project/tab-lock')

/** 새 "탭" — 모듈 상태를 새로 받은 tab-lock 모듈. */
async function freshTab(): Promise<TabLockModule> {
  vi.resetModules()
  return await import('../src/project/tab-lock')
}

/**
 * Web Locks의 가짜. `ifAvailable` 의미 그대로 — 잡혀 있으면 `null`로 콜백을 부르고,
 * 아니면 잡은 채 콜백의 약속이 끝날 때까지 기다렸다가 놓는다.
 */
class FakeLocks {
  readonly held = new Set<string>()
  /** 요청마다 넘어온 옵션. 아래 검사가 `ifAvailable`을 여기서 본다. */
  readonly options: unknown[] = []

  request = async (
    name: string,
    options: unknown,
    callback: (lock: { name: string } | null) => unknown,
  ): Promise<unknown> => {
    this.options.push(options)
    /**
     * **진짜 Web Locks는 콜백을 나중 태스크에서 부른다** (2026-09-04 R26 B-11).
     *
     * 이 가짜가 동기로 부르던 동안에는 요청 둘을 겹쳐도 아무 일이 안 났다 — 앞
     * 요청의 놓는 손잡이가 **이미 담겨 있어서** 뒤 요청이 그것을 제대로 놓았다.
     * 실물에서는 그 손잡이가 아직 없어서 앞 자물쇠가 고아가 된다.
     * **가짜가 진짜보다 관대하면 그 차이만큼이 사각이다.**
     *
     * **마이크로태스크로는 아직 모자랐다** (2026-09-04 R27 C-5). 진짜 Web Locks의
     * 콜백은 **태스크**이고 마이크로태스크는 그보다 이르다 — 늦추는 순간 아무 검사도
     * 안 울었으니 지금 그 차이에 걸리는 코드는 없지만, **한 번에 맞췄다고 믿지 않는다.**
     */
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (this.held.has(name)) {
      /**
       * **진짜 Web Locks는 `ifAvailable` 없이 부르면 거절하지 않고 기다린다**
       * (2026-09-04 R26 A-5). 이 가짜가 옵션을 안 보던 동안에는 그 옵션을 지워도
       * 검사 열셋이 초록이었다 — 그런데 실물에서는 둘째 탭이 "다른 탭이 쓰고 있다"
       * 대신 **첫 탭이 닫힐 때까지 멈춘 화면**을 본다.
       */
      if ((options as { ifAvailable?: boolean } | null)?.ifAvailable !== true)
        return new Promise(() => {})
      return callback(null)
    }
    this.held.add(name)
    try {
      return await callback({ name })
    } finally {
      this.held.delete(name)
    }
  }
}

function stubLocks(locks: FakeLocks | undefined): void {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
}

/** BroadcastChannel의 가짜. 같은 이름의 다른 인스턴스에게만 동기로 배달한다. */
class FakeBroadcastChannel {
  static byName = new Map<string, Set<FakeBroadcastChannel>>()

  onmessage: ((event: { data: unknown }) => void) | null = null
  private readonly listeners = new Set<(event: { data: unknown }) => void>()

  constructor(readonly name: string) {
    const peers = FakeBroadcastChannel.byName.get(name) ?? new Set()
    peers.add(this)
    FakeBroadcastChannel.byName.set(name, peers)
  }

  postMessage(data: unknown): void {
    for (const peer of FakeBroadcastChannel.byName.get(this.name) ?? []) {
      if (peer === this) continue
      peer.onmessage?.({ data })
      for (const listener of peer.listeners) listener({ data })
    }
  }

  addEventListener(_type: string, listener: (event: { data: unknown }) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: string, listener: (event: { data: unknown }) => void): void {
    this.listeners.delete(listener)
  }
}

afterEach(() => {
  stubLocks(undefined)
  vi.unstubAllGlobals()
  vi.useRealTimers()
  FakeBroadcastChannel.byName.clear()
})

/** 미뤄진 정리(가짜 locks의 finally)가 도착할 시간을 준다. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('Web Locks 경로', () => {
  it('첫 탭이 쥐면 두 번째 탭은 못 연다', async () => {
    const locks = new FakeLocks()
    stubLocks(locks)
    const tabA = await freshTab()
    const tabB = await freshTab()

    expect(await tabA.acquireTabLock('p-1')).toBe(true)
    expect(await tabB.acquireTabLock('p-1')).toBe(false)
    // 다른 프로젝트는 상관없다 — 잠금은 프로젝트 하나 단위다.
    expect(await tabB.acquireTabLock('p-2')).toBe(true)
  })

  it('놓으면 다음 탭이 쥘 수 있다', async () => {
    const locks = new FakeLocks()
    stubLocks(locks)
    const tabA = await freshTab()
    const tabB = await freshTab()

    expect(await tabA.acquireTabLock('p-1')).toBe(true)
    tabA.releaseTabLock()
    await settle()
    expect(await tabB.acquireTabLock('p-1')).toBe(true)
  })

  it('다른 프로젝트를 열면 앞의 잠금을 놓는다 — 편집 중인 프로젝트는 하나다', async () => {
    const locks = new FakeLocks()
    stubLocks(locks)
    const tabA = await freshTab()
    const tabB = await freshTab()

    expect(await tabA.acquireTabLock('p-1')).toBe(true)
    expect(await tabA.acquireTabLock('p-2')).toBe(true)
    await settle()
    expect(await tabB.acquireTabLock('p-1')).toBe(true)
  })

  it('이미 쥔 프로젝트를 다시 잡으면 그대로 참이다', async () => {
    const locks = new FakeLocks()
    stubLocks(locks)
    const tab = await freshTab()

    expect(await tab.acquireTabLock('p-1')).toBe(true)
    expect(await tab.acquireTabLock('p-1')).toBe(true)
    // 자물쇠는 여전히 하나만 잡혀 있다 — 두 번 잡고 한 번 놓는 상태가 안 생긴다.
    expect(locks.held.size).toBe(1)
  })

  /**
   * **`ifAvailable`이 빠지면 둘째 탭이 영영 매달린다** (2026-09-04 R26 A-5).
   *
   * 위 가짜가 그 의미를 지키게 됐으니 옵션을 지우면 약속이 안 풀려 검사가 시간
   * 초과로 죽는다. 그건 **느리게 우는 것**이고, 여기서는 넘어간 옵션을 직접 봐서
   * **빠르고 분명하게** 운다.
   */
  it('언제나 `ifAvailable`로 묻는다 — 기다리는 것은 멈춘 화면이다', async () => {
    const locks = new FakeLocks()
    stubLocks(locks)
    const tabA = await freshTab()
    const tabB = await freshTab()
    await tabA.acquireTabLock('p-1')
    await tabB.acquireTabLock('p-1')

    expect(locks.options.length).toBeGreaterThan(0)
    expect(locks.options).toEqual(locks.options.map(() => ({ ifAvailable: true })))
  })

  it('요청 자체가 던지면 여는 쪽으로 실패한다', async () => {
    stubLocks({
      request: () => Promise.reject(new Error('broken')),
    } as unknown as FakeLocks)
    const tab = await freshTab()

    expect(await tab.acquireTabLock('p-1')).toBe(true)
  })
})

describe('BroadcastChannel 폴백 (Web Locks가 없는 비보안 컨텍스트)', () => {
  it('쥔 탭이 답하면 두 번째 탭은 못 연다', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const tabA = await freshTab()
    const tabB = await freshTab()

    const claimA = tabA.acquireTabLock('p-1')
    await vi.advanceTimersByTimeAsync(TAB_LOCK_REPLY_WINDOW_MS)
    expect(await claimA).toBe(true)

    // A가 쥐고 있으므로 답이 곧바로 온다 — 창이 끝나기를 기다릴 필요가 없다.
    expect(await tabB.acquireTabLock('p-1')).toBe(false)
  })

  it('아무도 안 쥐었으면 창이 닫힌 뒤 연다', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const tab = await freshTab()

    const claim = tab.acquireTabLock('p-1')
    await vi.advanceTimersByTimeAsync(TAB_LOCK_REPLY_WINDOW_MS)
    expect(await claim).toBe(true)
  })

  it('놓은 탭은 더 이상 답하지 않는다', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const tabA = await freshTab()
    const tabB = await freshTab()

    const claimA = tabA.acquireTabLock('p-1')
    await vi.advanceTimersByTimeAsync(TAB_LOCK_REPLY_WINDOW_MS)
    expect(await claimA).toBe(true)
    tabA.releaseTabLock()

    const claimB = tabB.acquireTabLock('p-1')
    await vi.advanceTimersByTimeAsync(TAB_LOCK_REPLY_WINDOW_MS)
    expect(await claimB).toBe(true)
  })
})

describe('수단이 없는 환경', () => {
  it('둘 다 없으면 연다 — 잠금은 보호이지 기능의 전제가 아니다', async () => {
    const tab = await freshTab()
    expect(await tab.acquireTabLock('p-1')).toBe(true)
  })
})

/**
 * **node의 채널을 걸러내는 지문에 무는 검사가 0건이었다** (2026-09-04 R26 B-1).
 *
 * 두 방향 모두 조용히 실패하는 자리다. 지문을 지우면 node의 채널이 **워커 스레드를
 * 가로질러** 통해 병렬로 도는 스펙 파일들이 서로의 잠금에 답한다 — 격리하면 초록이고
 * 전체 실행에서만 빨간, 가장 알아보기 어려운 실패다(실제로 한 번 그랬다). 반대로
 * 브라우저가 언젠가 `unref`를 넣으면 **잠금이 통째로 조용히 꺼진다.**
 */
describe('node의 BroadcastChannel은 안 쓴다', () => {
  /** node의 것에만 있는 것. 브라우저 명세에는 없다. */
  class NodeLikeChannel extends FakeBroadcastChannel {
    unref(): void {}
  }

  it('`unref`를 가진 채널은 수단으로 안 쓴다 — 잠금 없이 연다', async () => {
    vi.stubGlobal('BroadcastChannel', NodeLikeChannel)
    const tabA = await freshTab()
    const tabB = await freshTab()

    // 채널이 없는 것과 같은 길이다. 둘 다 참을 받고 창을 기다리지도 않는다.
    expect(await tabA.acquireTabLock('p-1')).toBe(true)
    expect(await tabB.acquireTabLock('p-1')).toBe(true)
  })

  it('`unref`가 없는 채널은 그대로 쓴다 — 지문이 브라우저를 안 막는다', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const tabA = await freshTab()
    const tabB = await freshTab()

    const claimA = tabA.acquireTabLock('p-1')
    await vi.advanceTimersByTimeAsync(TAB_LOCK_REPLY_WINDOW_MS)
    expect(await claimA).toBe(true)
    expect(await tabB.acquireTabLock('p-1')).toBe(false)
  })
})

/**
 * **빠르게 두 번 열기** (2026-09-04 R26 B-11). 목록에서 프로젝트 둘을 연달아 누르면
 * 두 요청이 `await` 사이에서 겹친다.
 */
describe('두 요청이 겹쳐도 자물쇠가 고아가 안 된다', () => {
  it('연달아 다른 프로젝트를 열어도 앞의 것을 다시 열 수 있다', async () => {
    const locks = new FakeLocks()
    stubLocks(locks)
    const tab = await freshTab()

    // 기다리지 않고 둘을 동시에 던진다 — 이것이 학생의 두 번 누르기다.
    const [first, second] = await Promise.all([
      tab.acquireTabLock('p-1'),
      tab.acquireTabLock('p-2'),
    ])
    expect([first, second]).toEqual([true, true])
    await settle()

    // 자물쇠는 마지막 것 하나만 남아야 한다. 앞의 것이 고아로 남으면 여기가 2다.
    expect(locks.held.size).toBe(1)
    // 그리고 앞 프로젝트를 다시 열 수 있어야 한다 — 고아가 있으면 `false`가 온다.
    expect(await tab.acquireTabLock('p-1')).toBe(true)
  })
})

/**
 * **거절당해도 쥐고 있던 것을 잃지 않는다** (2026-09-04 R27 A-2).
 *
 * 앞의 것을 먼저 놓고 새 것을 잡으러 가면, 거절당한 탭은 **자기가 화면에 들고 있는
 * 프로젝트의 자물쇠를 잃은 채** 목록으로 밀려난다. 라우터의 두 번째 가드 통과가
 * `flush()`로 그것을 쓰는 동안 다른 탭이 정상적으로 그 프로젝트를 연다 —
 * **두 탭이 같은 프로젝트를 쓰는 상태**, 이 잠금이 막으려던 그것이다.
 */
describe('잠금 교체가 실패하면 앞의 것이 그대로 남는다', () => {
  it('남이 쥔 프로젝트를 열려다 거절당해도 쥐던 것을 남이 못 가져간다', async () => {
    const locks = new FakeLocks()
    stubLocks(locks)
    const tabA = await freshTab()
    const tabB = await freshTab()
    const tabC = await freshTab()

    expect(await tabA.acquireTabLock('p-1')).toBe(true)
    expect(await tabB.acquireTabLock('p-2')).toBe(true)

    // 탭 A가 탭 B의 프로젝트를 열려 한다. 거절이 맞다.
    expect(await tabA.acquireTabLock('p-2')).toBe(false)
    await settle()

    // **p-1이 사라지면 안 된다.** 화면은 아직 p-1을 들고 있고 flush가 그것을 쓴다.
    expect(locks.held.has('ml-playgrounds:project:p-1')).toBe(true)
    // 그래서 제3의 탭이 p-1을 가져갈 수 없다.
    expect(await tabC.acquireTabLock('p-1')).toBe(false)
    // 그리고 탭 A는 자기 것을 여전히 쥔 것으로 안다 — heldId와 자물쇠가 안 어긋난다.
    expect(await tabA.acquireTabLock('p-1')).toBe(true)
    await settle()
    expect(locks.held.size).toBe(2)
  })

  it('거절 뒤에 스스로 놓으면 그때는 남이 가져간다', async () => {
    const locks = new FakeLocks()
    stubLocks(locks)
    const tabA = await freshTab()
    const tabB = await freshTab()
    const tabC = await freshTab()

    await tabA.acquireTabLock('p-1')
    await tabB.acquireTabLock('p-2')
    expect(await tabA.acquireTabLock('p-2')).toBe(false)

    // 붙들고 있는 것이지 새는 것이 아니다 — 놓으면 놓인다.
    tabA.releaseTabLock()
    await settle()
    expect(await tabC.acquireTabLock('p-1')).toBe(true)
  })
})
