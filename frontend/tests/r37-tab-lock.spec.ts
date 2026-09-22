// @vitest-environment jsdom
// 잠금은 브라우저 API를 흉내 내야 보인다.
/**
 * R37 A-1을 무는 검사 (`docs/audit/report-R37.md`).
 *
 * **순서를 손에 쥐어야만 보인다.** `acquireTabLock`은 요청을 사슬로 줄 세우는데
 * `releaseTabLock`은 그 사슬 밖이라, **잡는 중에 놓으라는 말이 오면 그 말이 아무 일도
 * 안 하고** 뒤이어 허가가 떨어지면서 놓으라고 한 잠금을 도로 세웠다. 학생의 두 클릭이면
 * 난다 — 목록에서 프로젝트를 누르고 곧이어 레일의 [점검]을 누른다.
 *
 * **하니스는 감사 세션의 것을 그대로 받았다**(`zz-r37-lock.spec.ts`, 지웠다). 가짜 잠금의
 * 허가 시점을 쥐는 것이 이 검사의 전부다.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { TAB_LOCK_REPLY_WINDOW_MS } from '../src/limits'

type TabLockModule = typeof import('../src/project/tab-lock')

async function freshTab(): Promise<TabLockModule> {
  vi.resetModules()
  return await import('../src/project/tab-lock')
}

class FakeLocks {
  readonly held = new Set<string>()

  request = async (
    name: string,
    options: unknown,
    callback: (lock: { name: string } | null) => unknown,
  ): Promise<unknown> => {
    await new Promise((resolve) => setTimeout(resolve, 0))
    if (this.held.has(name)) {
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

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const KEY = 'ml-playgrounds:project:p-1'

describe('A-1 — 잡는 중에 놓으면 그 잠금은 안 선다', () => {
  it('Web Locks — 놓으라고 했으면 자물쇠가 안 남는다', async () => {
    const locks = new FakeLocks()
    stubLocks(locks)
    const tabA = await freshTab()
    const tabB = await freshTab()

    // 라우터 가드 둘이 겹친 자리: 들어가는 가드가 잡는 중에 나가는 가드가 놓는다.
    const claim = tabA.acquireTabLock('p-1')
    tabA.releaseTabLock()
    expect(await claim, 'a cancelled acquire must not report success').toBe(false)
    await settle()

    expect(locks.held.has(KEY), 'the lock must not stay held after release').toBe(false)
    expect(
      await tabB.acquireTabLock('p-1'),
      'another tab must be able to open an unheld project',
    ).toBe(true)
  })

  /**
   * **거짓을 돌려주는 것만으로는 부족하다.** 그 뒤 재진입이 `heldId === id` 지름길로
   * 통과하면 **잠금을 한 번도 안 묻는다** — 보고서의 `병` 줄이 그 모양이다.
   */
  it('취소된 뒤 다시 열면 잠금을 새로 묻는다', async () => {
    const locks = new FakeLocks()
    stubLocks(locks)
    const tabA = await freshTab()
    const tabB = await freshTab()

    const cancelled = tabA.acquireTabLock('p-1')
    tabA.releaseTabLock()
    await cancelled
    await settle()

    // 남이 쥐고 있으면 거절당해야 한다 — 지름길로 통과하면 참이 온다.
    expect(await tabB.acquireTabLock('p-1')).toBe(true)
    expect(await tabA.acquireTabLock('p-1'), 're-entry must ask for the lock again').toBe(false)
  })

  it('BroadcastChannel — 놓은 탭이 계속 답하지 않는다', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel)
    const tabA = await freshTab()
    const tabB = await freshTab()

    const claim = tabA.acquireTabLock('p-1')
    tabA.releaseTabLock()
    await vi.advanceTimersByTimeAsync(TAB_LOCK_REPLY_WINDOW_MS)
    expect(await claim).toBe(false)

    const claimB = tabB.acquireTabLock('p-1')
    await vi.advanceTimersByTimeAsync(TAB_LOCK_REPLY_WINDOW_MS)
    expect(await claimB, 'another tab must be able to open an unheld project').toBe(true)
  })

  /** 놓으라는 말이 없으면 **지금까지처럼** 잡는다. 고침이 정상 경로를 안 막았다. */
  it('가만두면 잡는다', async () => {
    const locks = new FakeLocks()
    stubLocks(locks)
    const tabA = await freshTab()
    expect(await tabA.acquireTabLock('p-1')).toBe(true)
    expect(locks.held.has(KEY)).toBe(true)
  })
})

describe('A-1의 이웃 — withTabLock이 끝나는 사이에 다른 프로젝트를 열면', () => {
  it('지운 프로젝트의 자물쇠가 안 남는다', async () => {
    const locks = new FakeLocks()
    stubLocks(locks)
    const tabA = await freshTab()
    const tabB = await freshTab()

    // 탭 B가 p-2를 쥐고 있어 아래 교체가 거절당한다.
    expect(await tabB.acquireTabLock('p-2')).toBe(true)

    let finish = (): void => {}
    const work = new Promise<void>((resolve) => {
      finish = resolve
    })
    const deleting = tabA.withTabLock('p-1', () => work)
    await settle()

    // 지우는 중에 다른 프로젝트를 열려 한다 — 교체가 시작된다.
    const opening = tabA.acquireTabLock('p-2')
    // 그 사이에 지우기가 끝나 `releaseTabLock()`이 돈다.
    finish()
    await deleting
    expect(await opening).toBe(false)
    await settle()

    expect(locks.held.has(KEY), 'the deleted project must not stay locked').toBe(false)
  })
})
