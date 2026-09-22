// @vitest-environment jsdom
// `pool.ts`에 DOM 부재 분기가 있다 — 안 밝히면 대체 경로를 재면서 초록이 된다.
/**
 * **워커가 답을 못 줄 때** (2026-09-23, R36 B-4·B-5 / R35 §6.2).
 *
 * 세 길이 있다 — 답(`message`), 워커가 죽음(`error`), **답이 복제에 실패함**
 * (`messageerror`). 셋째는 R26 B-6이 더한 것인데 **되돌려도 관문이 초록이었다**
 * (R36 B-4: 여섯 중 여섯이 조용). 안 듣는 길이 하나라도 있으면 **학습이 멈춘 채 영영
 * 안 끝난다** — 학생은 진행 막대가 선 채로 수업이 끝나는 것을 본다.
 *
 * **가짜 워커로 잰다.** 진짜 워커를 죽이는 길은 관문에 없고(`messageerror`는 복제 못 하는
 * 값을 보내야 난다), 우리가 재려는 것은 **우리가 그 사건을 듣는가**이지 브라우저의 복제
 * 규칙이 아니다. 「가짜가 진짜보다 관대했다」를 피하려고 **듣는 이름 셋을 소스에서도
 * 함께 센다** — 가짜가 안 쏘는 사건을 코드가 안 듣고 있으면 그 판이 잡는다.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { askWorker } from '../src/ml/worker/pool'

/**
 * 사건 하나를 쏘는 가짜 워커. `Worker`의 겉모양만 갖춘다 — `askWorker`가 쓰는 것은
 * `addEventListener`·`removeEventListener`·`postMessage` 셋뿐이다.
 */
class FakeWorker {
  private readonly listeners = new Map<string, Set<(event: unknown) => void>>()
  /** 몇 번 떼었나. **새는 청취자를 잡는다** — 안 떼면 다음 요청이 남의 답을 받는다. */
  removed = 0

  constructor(private readonly fire: (worker: FakeWorker) => void) {}

  addEventListener(name: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(name) ?? new Set()
    set.add(listener)
    this.listeners.set(name, set)
  }

  removeEventListener(name: string, listener: (event: unknown) => void): void {
    if (this.listeners.get(name)?.delete(listener) === true) this.removed += 1
  }

  postMessage(): void {
    // 진짜 워커처럼 **다음 태스크에** 답한다 — 같은 태스크에서 쏘면 청취자보다 빠를 수 있다.
    setTimeout(() => this.fire(this), 0)
  }

  emit(name: string, event: unknown): void {
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener(event)
  }
}

function ask(fire: (worker: FakeWorker) => void): {
  worker: FakeWorker
  reply: Promise<unknown>
} {
  const worker = new FakeWorker(fire)
  return { worker, reply: askWorker(worker as unknown as Worker, { kind: 'grow' }) }
}

describe('워커가 답을 못 주면 기다림이 끝난다', () => {
  it('답이 오면 그 값을 준다', async () => {
    const { worker, reply } = ask((one) => one.emit('message', { data: { ok: true } }))
    await expect(reply).resolves.toEqual({ ok: true })
    expect(worker.removed).toBe(3)
  })

  /** 워커가 죽으면 **그 사유로** 거절한다. 삼키면 학습이 안 끝난다. */
  it('워커가 죽으면 거절한다', async () => {
    const { worker, reply } = ask((one) => one.emit('error', { message: '터졌다' }))
    await expect(reply).rejects.toThrow('터졌다')
    expect(worker.removed).toBe(3)
  })

  /**
   * **답이 복제에 실패하는 길** (R26 B-6이 더했고 R36 B-4에서 무검사였다). 워커는 살아
   * 있고 `error`도 안 오므로, 이 사건을 안 들으면 **아무 일도 안 일어난다.**
   */
  it('답을 복제하지 못하면 거절한다', async () => {
    const { worker, reply } = ask((one) => one.emit('messageerror', {}))
    await expect(reply).rejects.toThrow(/clone/i)
    expect(worker.removed).toBe(3)
  })

  /**
   * **듣는 이름 셋을 소스에서도 센다.** 가짜가 안 쏘는 사건은 위 판들이 못 보므로
   * (가짜는 우리가 쓴 만큼만 관대하다), 넷째 길이 생기는 날 이 판이 먼저 운다.
   */
  it('세 사건을 다 듣고 다 뗀다', () => {
    const source = readFileSync(join(process.cwd(), 'src/ml/worker/pool.ts'), 'utf-8')
    for (const name of ['message', 'error', 'messageerror']) {
      expect(source, `add ${name}`).toContain(`addEventListener('${name}'`)
      expect(source, `remove ${name}`).toContain(`removeEventListener('${name}'`)
    }
  })
})
