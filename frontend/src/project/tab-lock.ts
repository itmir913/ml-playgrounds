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

import { ClientError } from '@/errors'
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
 * 다른 프로젝트를 쥔 채 부르면 **새 것을 잡은 뒤에** 앞의 것을 놓는다 — 편집 중인
 * 프로젝트는 언제나 하나이므로 잠금도 하나이고, **거절당하면 쥐던 것이 그대로 남는다**
 * (`acquireOne`의 머리말, 2026-09-04 R27 A-2).
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
  /**
   * **놓으라는 말이 이미 왔는가를 재는 자리** (2026-09-22 R37 A-1).
   *
   * `acquireTabLock`은 사슬로 줄을 서는데 **`releaseTabLock`은 그 사슬 밖**이라, 잡는
   * 중에 놓으라는 말이 오면 `heldId`도 `releaseHeld`도 아직 `null`이어서 **그 말이 아무
   * 일도 안 하고**, 뒤이어 `acquireOne`이 `heldId = id`를 쓰면서 **놓으라고 한 잠금을
   * 도로 세운다.** 학생의 두 클릭이면 난다 — 목록에서 프로젝트를 누르고 곧이어 레일의
   * [점검]을 누른다.
   *
   * **번호를 여기서 동기로 잡아야 한다.** `acquireOne` 안에서 잡으면 `releaseTabLock`이
   * **`acquireOne`이 시작하기 전에** 올 수 있어(사슬의 `.then` 밖) 세 자리 중 하나만
   * 닫힌다 — 둘 다 심어서 쟀다.
   */
  const startedAt = generation
  const next = pending.catch(() => undefined).then(() => acquireOne(id, startedAt))
  pending = next.catch(() => undefined)
  return next
}

/**
 * 놓으라는 말이 몇 번 왔는가. **값에 뜻이 없고 달라졌다는 것에만 뜻이 있다.**
 *
 * 취소 신호를 `boolean`으로 두면 **겹친 요청 둘이 서로의 신호를 지운다** — 번호는
 * 그럴 수 없다.
 */
let generation = 0

let pending: Promise<unknown> = Promise.resolve()

/**
 * **앞의 것은 새 것을 잡은 뒤에만 놓는다** (2026-09-04 R27 A-2).
 *
 * 먼저 놓으면 거절당했을 때 **화면이 든 프로젝트와 이 탭이 쥔 자물쇠가 어긋난다** —
 * 탭 A가 P를 열어 둔 채 다른 탭이 쥔 Q를 열려 하면 P의 자물쇠만 풀리고 Q는 거절된다.
 * 라우터는 목록으로 되돌리는데 **그 두 번째 가드 통과의 `flush()`가 P를 쓴 뒤에야**
 * `close()`가 돌고, 그 사이에 다른 탭이 P를 정상적으로 연다. **두 탭이 P를 쓰는 상태**,
 * 이 잠금이 막으려던 바로 그것이다.
 *
 * **BroadcastChannel 갈래는 다른 줄이 낸다** (2026-09-26 R41 B-1). 거기서 "쥐고 있다"는
 * `heldId`가 `claim`에 답하는 것이라, **새 것을 묻는 동안에도 `heldId`는 앞의 것으로
 * 남아야 한다** — 먼저 비우면 그 창 안에서 P를 물은 탭이 "비었다"를 듣고, Q가 거절되면
 * 이 탭은 P로 되돌아온다. 그래서 여기서는 `releaseHeld`만 비운다. 검사:
 * tab-lock.spec.ts "다른 탭이 쥔 프로젝트로 옮기려는 동안에도 쥐던 것은 남에게 안 간다".
 */
async function acquireOne(id: string, startedAt: number): Promise<boolean> {
  if (heldId === id) return true

  // 놓는 손잡이를 들고만 있는다. 실패하면 이대로 되돌려 앞 잠금이 이어진다.
  // `heldId`는 비우지 않는다 — 위 머리말의 BroadcastChannel 갈래.
  const previousId = heldId
  const previousRelease = releaseHeld
  releaseHeld = null

  const acquired = await acquireNew(id)

  /**
   * **기다리는 동안 놓으라는 말이 왔으면 둘 다 놓는다** (R37 A-1).
   *
   * 방금 잡은 것을 세우면 **아무도 편집하지 않는 프로젝트를 이 탭이 쥔 채**가 되고,
   * 앞의 것을 되살리면 **닫으라고 한 프로젝트의 자물쇠**가 남는다. 취소는 둘 다
   * 버리라는 뜻이다.
   */
  if (generation !== startedAt) {
    /**
     * **방금 잡은 손잡이를 버리면 자물쇠가 샌다** (2026-09-22 R37 A-1′). `releaseHeld`는
     * 이 시점에 **방금 잡은** 것의 놓는 손잡이라, `null`로 덮으면 놓을 길이 이 탭에서
     * 영영 사라진다 — `releaseTabLock()`은 `releaseHeld === null`을 보고 아무 일도 안 한다.
     * 위 §"요청은 온 순서대로 하나씩"이 적어 둔 그 실패다: **그 탭은 그 프로젝트를 다시
     * 못 연다.** 들고 있다가 놓는다.
     */
    // **캐스팅하는 이유.** 위에서 `releaseHeld = null`을 쓴 뒤라 TypeScript는 이 자리에서
    // 그 값을 `null`로 좁혀 두는데, 그 사이 `await acquireNew(id)`가 모듈 변수를 다시
    // 채운다 — 컴파일러가 못 보는 것은 타입이 아니라 그 대입이다.
    const fresh = releaseHeld as (() => void) | null
    releaseHeld = null
    heldId = null
    previousRelease?.()
    fresh?.()
    return false
  }

  if (acquired) {
    // 새 것을 잡았으니 이제 앞의 것을 놓는다. 편집 중인 프로젝트는 언제나 하나다.
    previousRelease?.()
    heldId = id
    return true
  }

  heldId = previousId
  releaseHeld = previousRelease
  return false
}

/**
 * 수단을 골라 실제로 잡아 본다. **여기서는 앞 잠금을 모른다** — 놓는 순서를 아는 곳은
 * `acquireOne` 하나여야 어긋남이 한 자리에만 산다.
 */
async function acquireNew(id: string): Promise<boolean> {
  const locks = locksOf()
  if (locks !== undefined) return await acquireViaLocks(locks, id)
  if (channelClassOf() === undefined) return true
  return await claimViaChannel(id)
}

/**
 * **잠금을 잡거나, 못 잡으면 던진다** (2026-09-04 R27 A-1·B-1).
 *
 * `acquireTabLock`이 `boolean`을 주는 것은 라우터 가드가 이동을 되돌려야 해서다.
 * **저장소에 쓰려는 쪽은 다르다** — 못 잡았으면 할 일이 "쓰지 않고 말하기" 하나뿐이고,
 * `false`를 돌려주면 부르는 쪽마다 그 문장을 다시 조립하게 된다. 던지면 이미 있는
 * `catch` + `pushError`가 그대로 받는다.
 *
 * 잡은 것은 **놓지 않고 넘긴다** — 부르는 쪽이 그대로 편집 화면으로 이어 갈 수 있어야
 * 하고, 라우터가 곧 부르는 `open(id)`은 `heldId === id` 지름길로 통과한다.
 */
export async function claimTabLock(id: string): Promise<void> {
  if (!(await acquireTabLock(id))) throw new ClientError('PROJECT_OPEN_ELSEWHERE')
}

/**
 * **잠금을 쥔 동안만 일한다.** 끝나면(실패해도) 놓는다.
 *
 * 지우기처럼 **끝나고 나면 쥘 대상이 없어지는** 쓰기가 이것을 쓴다 — 없어진 프로젝트를
 * 쥔 채로 두면 그 탭이 다음 프로젝트를 열 때까지 유령 잠금이 남는다.
 */
export async function withTabLock<T>(id: string, work: () => Promise<T>): Promise<T> {
  await claimTabLock(id)
  try {
    return await work()
  } finally {
    releaseTabLock()
  }
}

/**
 * 쥔 것을 놓는다. 안 쥐었으면 아무 일도 없다.
 *
 * 탭이 닫힐 때는 부를 필요가 없다 — Web Locks는 브라우저가 놓고, BroadcastChannel은
 * 채널이 탭과 함께 죽어 답할 이가 없어진다. 같은 효과다.
 */
export function releaseTabLock(): void {
  // **잡는 중인 요청에게도 들리게 한다** (R37 A-1). 사슬 밖에서 오는 말이라, 번호를
  // 올리는 것이 "네가 잡고 있는 것은 이미 놓으라고 한 것이다"를 전하는 유일한 길이다.
  generation += 1
  heldId = null
  if (releaseHeld !== null) {
    releaseHeld()
    releaseHeld = null
  }
}
