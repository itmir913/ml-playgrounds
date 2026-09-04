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
