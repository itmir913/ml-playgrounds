// @vitest-environment jsdom
// 가짜 Worker와 File이 DOM 쪽 전역을 쓴다.
/**
 * 사진을 받아 정본으로 굽는 경로의 계약.
 *
 * **진짜로 굽지 않는다.** `OffscreenCanvas`가 여기 없고, 있어도 그건 우리 로직이 아니라
 * 브라우저를 검사하는 것이다. 대신 이 층이 실제로 하는 일을 본다 — **한 장이 실패해도
 * 나머지를 굽는가 · 해시가 정본 바이트에서 나오는가 · 진행이 장마다 흐르는가 · 워커가
 * 죽으면 실패로 바뀌는가.**
 */

import { describe, expect, it, vi } from 'vitest'

import { canonicalizeImages, type CanonicalizeWorker } from '../src/data/image/client'
import { CANONICAL_FORMATS } from '../src/data/image/formats'
import { handleCanonicalize, type Bake, type DetectFormat } from '../src/data/image/handler'
import type { CanonicalizeMessage, CanonicalizeRequest } from '../src/data/image/protocol'
import { isClientError } from '../src/errors'
import { hashBytes } from '../src/hash'

const SIZE = 224

const fileOf = (name: string) => new File([new Uint8Array([1, 2, 3])], name)

const bytesFor = (name: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(new TextEncoder().encode(`구운:${name}`))

/** 이름에 `깨진`이 든 파일은 못 읽는 척한다. */
const fakeBake: Bake = (file) =>
  Promise.resolve(file.name.includes('깨진') ? null : bytesFor(file.name))

/** 캔버스가 없는 곳이라 형식 판정도 가짜다. 여기서 보는 것은 판정이 아니라 전달이다. */
const detectWebp: DetectFormat = () => Promise.resolve(CANONICAL_FORMATS.webp)

async function collect(
  files: readonly File[],
  bake: Bake = fakeBake,
  detect: DetectFormat = detectWebp,
): Promise<CanonicalizeMessage[]> {
  const messages: CanonicalizeMessage[] = []
  await handleCanonicalize(
    { type: 'canonicalize', files, size: SIZE },
    (message) => messages.push(message),
    bake,
    detect,
  )
  return messages
}

/** 마지막 메시지가 `done`인지 확인하고 좁힌다. 캐스팅으로 넘기면 검사가 거짓말을 한다. */
function doneOf(messages: readonly CanonicalizeMessage[]) {
  const last = messages.at(-1)
  if (last?.type !== 'done') throw new Error(`done이 안 왔다: ${last?.type}`)
  return last
}

describe('정본 변환 핸들러', () => {
  it('장마다 진행을 보고하고 마지막에 결과를 준다', async () => {
    const messages = await collect([fileOf('a.jpg'), fileOf('b.jpg')])
    expect(messages.map((message) => message.type)).toEqual(['progress', 'progress', 'done'])
    expect(messages[0]).toEqual({ type: 'progress', completed: 1, total: 2 })
  })

  it('해시는 정본 바이트에서 나온다 - 원본이 아니다', async () => {
    const [image] = doneOf(await collect([fileOf('a.jpg')])).images
    expect(image?.hash).toBe(hashBytes(bytesFor('a.jpg')))
    expect(image?.sourceName).toBe('a.jpg')
  })

  it('한 장이 실패해도 나머지는 굽는다', async () => {
    const done = doneOf(await collect([fileOf('a.jpg'), fileOf('깨진.txt'), fileOf('b.jpg')]))
    expect(done.images.map((image) => image.sourceName)).toEqual(['a.jpg', 'b.jpg'])
    // **조용히 버리지 않는다.** 화면이 몇 장이 빠졌는지 말할 수 있어야 한다.
    expect(done.skipped).toEqual([{ sourceName: '깨진.txt' }])
  })

  it('굽다가 터져도 던지지 않고 코드로 내보낸다', async () => {
    const messages = await collect([fileOf('a.jpg')], () => Promise.reject(new Error('메모리')))
    expect(messages).toEqual([
      { type: 'failed', code: 'UNEXPECTED_ERROR', params: { detail: '메모리' } },
    ])
  })

  it('파일이 하나도 없으면 빈 결과다 - 실패가 아니다', async () => {
    expect(await collect([])).toEqual([{ type: 'done', format: 'webp', images: [], skipped: [] }])
  })
})

class FakeWorker implements CanonicalizeWorker {
  onmessage: ((event: MessageEvent<CanonicalizeMessage>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  readonly posted: CanonicalizeRequest[] = []
  terminated = 0

  postMessage(message: CanonicalizeRequest): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated += 1
  }

  emit(message: CanonicalizeMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<CanonicalizeMessage>)
  }

  crash(message = ''): void {
    this.onerror?.(new ErrorEvent('error', { message }))
  }
}

/**
 * **형식은 요청마다 한 번 정하고, 결과와 함께 돌아온다** (open-decisions.md "정본은
 * WebP로 굽는다"). 여기서 보는 것은 인코더가 아니라 그 전달이다 — 진짜 판정은
 * `OffscreenCanvas`가 있는 곳에서만 할 수 있다.
 */
describe('정본 형식', () => {
  it('고른 형식이 결과에 실려 온다', async () => {
    const done = doneOf(await collect([fileOf('a.jpg')]))
    expect(done.format).toBe('webp')
  })

  it('jpg로 내려간 브라우저에서는 jpg가 실려 온다', async () => {
    const messages = await collect([fileOf('a.jpg')], fakeBake, () =>
      Promise.resolve(CANONICAL_FORMATS.jpeg),
    )
    expect(doneOf(messages).format).toBe('jpeg')
  })

  it('한 요청 안에서 한 번만 잰다 - 장마다 다시 재면 같은 업로드가 두 확장자로 담긴다', async () => {
    const detect = vi.fn(() => Promise.resolve(CANONICAL_FORMATS.webp))
    await collect([fileOf('a.jpg'), fileOf('b.jpg'), fileOf('c.jpg')], fakeBake, detect)
    expect(detect).toHaveBeenCalledTimes(1)
  })

  it('구울 형식이 하나도 없으면 실패로 끝난다 - 조용히 png를 담지 않는다', async () => {
    const messages = await collect([fileOf('a.jpg')], fakeBake, () => {
      throw new Error('정본으로 구울 수 있는 형식이 하나도 없다')
    })
    expect(messages.at(-1)?.type).toBe('failed')
  })

  it('고른 형식으로 굽는다 - 굽는 쪽이 다시 고르지 않는다', async () => {
    const bake = vi.fn(fakeBake)
    await collect([fileOf('a.jpg')], bake, () => Promise.resolve(CANONICAL_FORMATS.jpeg))
    expect(bake).toHaveBeenCalledWith(expect.anything(), SIZE, CANONICAL_FORMATS.jpeg)
  })
})

describe('정본 변환 클라이언트', () => {
  it('정본 크기를 실어 보낸다', () => {
    const worker = new FakeWorker()
    canonicalizeImages([fileOf('a.jpg')], { createWorker: () => worker, size: SIZE })
    expect(worker.posted[0]?.size).toBe(SIZE)
  })

  it('진행을 흘리고 결과를 준 뒤 워커를 끝낸다', async () => {
    const worker = new FakeWorker()
    const onProgress = vi.fn()
    const { result } = canonicalizeImages([fileOf('a.jpg')], {
      createWorker: () => worker,
      size: SIZE,
      onProgress,
    })
    worker.emit({ type: 'progress', completed: 1, total: 1 })
    worker.emit({ type: 'done', format: 'webp', images: [], skipped: [] })

    await expect(result).resolves.toEqual({ format: 'webp', images: [], skipped: [] })
    expect(onProgress).toHaveBeenCalledWith(1, 1)
    expect(worker.terminated).toBe(1)
  })

  it('워커가 통째로 죽으면 실패로 바꾼다', async () => {
    const worker = new FakeWorker()
    const { result } = canonicalizeImages([fileOf('a.jpg')], {
      createWorker: () => worker,
      size: SIZE,
    })
    worker.crash('Out of memory')

    await expect(result).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'UNEXPECTED_ERROR',
    )
    expect(worker.terminated).toBe(1)
  })

  it('취소하면 워커가 끝나고 이후 보고는 버린다', async () => {
    const worker = new FakeWorker()
    const onProgress = vi.fn()
    const { result, cancel } = canonicalizeImages([fileOf('a.jpg')], {
      createWorker: () => worker,
      size: SIZE,
      onProgress,
    })
    cancel()
    worker.emit({ type: 'progress', completed: 1, total: 1 })

    await expect(result).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'JOB_CANCELLED',
    )
    expect(onProgress).not.toHaveBeenCalled()
  })
})
