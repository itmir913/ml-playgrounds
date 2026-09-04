/**
 * 두 탭 잠금 — 같은 프로젝트를 두 번째 탭이 편집으로 열지 못하게 막는다
 * (open-decisions.md "프로젝트는 한 번에 하나만 연다").
 *
 * **왜 탭을 가로지르는 수단이 필요한가.** `saveProject`는 충돌을 감지하지 않는다 —
 * 잊힌 탭 B의 저장 한 번이 탭 A의 실험들을 흔적 없이 덮는다. 한 탭 안의 상태로는
 * 못 막는다: 학생이 주소창이나 Ctrl+N으로 두 번째 탭을 열면 앱의 규칙 밖이다.
 *
 * **Web Locks가 기본이고, 없으면 BroadcastChannel이다.** Web Locks는 탭이 죽으면
 * 브라우저가 잠금을 스스로 풀어 준다 — 크래시한 탭이 프로젝트를 영영 잠그는 경우가
 * 구조적으로 없다. 다만 보안 컨텍스트에만 있어서, 자가호스팅 도커를 `http://…`로 여는
 * 컴퓨터실이 정확히 그 밖이다. 거기서는 BroadcastChannel로 묻고 기다린다.
 *
 * **막는 대상은 "잊힌 탭"이다.** BroadcastChannel 쪽은 답을 기다리는 창이 있어 두 탭이
 * 같은 순간에 열면 못 가른다 — 그 창을 넘는 동시 열기는 결정문이 받아들인 가장자리다.
 * 크래시한 탭은 답할 이가 없으므로 잘못 잠기지 않는다.
 *
 * **잠그지 못하는 환경에서는 연다.** 수단이 둘 다 없으면(아주 옛 브라우저) 지금까지의
 * 동작 그대로다 — 잠금은 보호이지 기능의 전제가 아니다.
 */

import { TAB_LOCK_REPLY_WINDOW_MS } from '@/limits'

/** Web Locks의 자물쇠 이름. 잠금은 오리진 단위라 앱 이름을 접두로 붙인다. */
const LOCK_PREFIX = 'ml-playgrounds:project:'
/** BroadcastChannel의 채널 이름. 같은 오리진의 모든 탭이 이 하나로 묻고 답한다. */
const CHANNEL_NAME = 'ml-playgrounds:tab-lock'

/** 탭 사이를 오가는 메시지. `claim`은 "이 프로젝트 누가 쥐고 있나", `held`가 그 답이다. */
interface LockMessage {
  readonly kind: 'claim' | 'held'
  readonly id: string
}

/** 지금 이 탭이 쥔 프로젝트. 한 번에 하나만 연다는 전제가 여기도 산다. */
let heldId: string | null = null
/** Web Locks의 보류 중인 콜백을 끝내는 손잡이. 부르면 브라우저가 잠금을 놓는다. */
let releaseHeld: (() => void) | null = null
/** claim에 답하려고 열어 두는 채널. 잠금을 놓아도 채널은 두고 답만 멈춘다. */
let channel: BroadcastChannel | null = null

/**
 * **수단은 window의 것만 쓴다.** node 22부터 전역에 진짜 `navigator.locks`와
 * `BroadcastChannel`이 있고, 검사의 jsdom 전역에도 node 쪽이 새어 들어온다 — node의
 * BroadcastChannel은 **워커 스레드를 가로질러** 통해서, 병렬로 도는 스펙 파일들이
 * 같은 픽스처 프로젝트를 서로 "쥐고 있다"고 답해 준다. 진짜 탭에는 언제나 `window`가
 * 있고, 탭을 가로지르는 수단도 window의 것이어야 한다.
 */
function locksOf(): LockManager | undefined {
  if (typeof window === 'undefined') return undefined
  return window.navigator.locks
}

function channelClassOf(): typeof BroadcastChannel | undefined {
  if (typeof window === 'undefined') return undefined
  const Channel = window.BroadcastChannel
  if (Channel === undefined) return undefined
  // **node의 BroadcastChannel은 걸러낸다** — vitest의 jsdom은 window에까지 node의
  // 것을 올리는데, node의 채널은 **워커 스레드를 가로질러** 통해서 병렬 스펙 파일들이
  // 서로의 잠금에 답해 준다. node의 것만 `unref`를 갖는다(브라우저 명세에 없다) —
  // 그 지문으로 가른다. 진짜 탭과 검사의 가짜 채널에는 unref가 없다.
  if ('unref' in Channel.prototype) return undefined
  return Channel
}

/**
 * `ifAvailable`로 묻는다 — 이미 누가 쥐고 있으면 기다리지 않고 `null`을 받는다.
 *
 * 잠금은 콜백이 돌려준 약속이 끝날 때까지 산다. `releaseHeld`가 그 약속을 끝낸다.
 * 요청 자체가 던지면(있을 수 없는 이름 따위) **여는 쪽으로 실패한다** — 잘못 막힌
 * 학생은 할 일이 없지만, 잘못 열린 학생은 지금까지의 동작 그대로다.
 */
function acquireViaLocks(locks: LockManager, id: string): Promise<boolean> {
  return new Promise((resolve) => {
    locks
      .request(LOCK_PREFIX + id, { ifAvailable: true }, (lock) => {
        if (lock === null) {
          resolve(false)
          return undefined
        }
        resolve(true)
        return new Promise<void>((done) => {
          releaseHeld = done
        })
      })
      .catch(() => resolve(true))
  })
}

/** 채널을 열고, 우리가 쥔 프로젝트를 묻는 claim에 답하게 한다. */
function ensureChannel(): BroadcastChannel {
  if (channel === null) {
    const Channel = channelClassOf() as typeof BroadcastChannel
    channel = new Channel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<LockMessage>) => {
      const message = event.data
      if (message.kind === 'claim' && heldId !== null && message.id === heldId) {
        channel?.postMessage({ kind: 'held', id: message.id } satisfies LockMessage)
      }
    }
  }
  return channel
}

/**
 * claim을 방송하고 창이 닫힐 때까지 `held`를 기다린다. 답이 오면 잡힌 것이고,
 * 안 오면 없는 것이다 — 같은 기계 안 IPC 왕복은 밀리초 급이라 창이 그 수백 배다.
 */
function claimViaChannel(id: string): Promise<boolean> {
  const open = ensureChannel()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve(true)
    }, TAB_LOCK_REPLY_WINDOW_MS)
    const onAnswer = (event: MessageEvent<LockMessage>): void => {
      const message = event.data
      if (message.kind === 'held' && message.id === id) {
        cleanup()
        resolve(false)
      }
    }
    function cleanup(): void {
      clearTimeout(timer)
      open.removeEventListener('message', onAnswer)
    }
    open.addEventListener('message', onAnswer)
    open.postMessage({ kind: 'claim', id } satisfies LockMessage)
  })
}

/**
 * 프로젝트 하나를 이 탭의 것으로 잡는다. `false`면 **다른 탭이 쥐고 있다** — 부르는
 * 쪽은 열지 말고 그 사실을 말해야 한다 (stores/project.ts의 `open`).
 *
 * 다른 프로젝트를 쥔 채 부르면 앞의 것을 먼저 놓는다 — 편집 중인 프로젝트는 언제나
 * 하나이므로 잠금도 하나다.
 */
export function acquireTabLock(id: string): Promise<boolean> {
  /**
   * **요청은 온 순서대로 하나씩** (2026-09-04 R26 B-11).
   *
   * 사슬이 없으면 두 요청이 `await` 사이에서 겹친다 — 뒤 요청의 `releaseTabLock()`이
   * 앞 요청의 `releaseHeld`가 **아직 안 담긴 사이에** 지나가고, 그러면 앞 자물쇠가
   * 놓는 손잡이 없이 브라우저에 남는다. 그 탭은 **그 프로젝트를 다시 못 연다** —
   * 자기가 쥐고 있는데 `ifAvailable`이 `null`을 주기 때문이다. 탭을 닫아야 풀린다.
   *
   * 학생이 목록에서 프로젝트 둘을 빠르게 누르면 나는 일이다.
   */
  const next = pending.catch(() => undefined).then(() => acquireOne(id))
  pending = next.catch(() => undefined)
  return next
}

let pending: Promise<unknown> = Promise.resolve()

async function acquireOne(id: string): Promise<boolean> {
  if (heldId === id) return true
  releaseTabLock()

  const locks = locksOf()
  if (locks !== undefined) {
    const acquired = await acquireViaLocks(locks, id)
    if (acquired) heldId = id
    return acquired
  }

  if (channelClassOf() === undefined) return true

  const acquired = await claimViaChannel(id)
  if (acquired) heldId = id
  return acquired
}

/**
 * 쥔 것을 놓는다. 안 쥐었으면 아무 일도 없다.
 *
 * 탭이 닫힐 때는 부를 필요가 없다 — Web Locks는 브라우저가 놓고, BroadcastChannel은
 * 채널이 탭과 함께 죽어 답할 이가 없어진다. 같은 효과다.
 */
export function releaseTabLock(): void {
  heldId = null
  if (releaseHeld !== null) {
    releaseHeld()
    releaseHeld = null
  }
}
