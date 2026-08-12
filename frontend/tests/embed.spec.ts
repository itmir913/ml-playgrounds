// @vitest-environment jsdom
// 가짜 Worker가 MessageEvent 등 DOM 쪽 전역을 쓴다.
/**
 * 임베딩 경로의 계약.
 *
 * **진짜 백본을 돌리지 않는다.** TF.js도 `OffscreenCanvas`도 여기 없고, 있어도 그건
 * 우리 로직이 아니라 남의 라이브러리를 검사하는 것이다. 대신 이 층이 실제로 하는 일을
 * 본다 — **화소를 옮기는 계산 · 메시지 순서 · 실패 전달 · 워커 사망**.
 *
 * 진짜 백본이 도는지는 사용자가 자기 브라우저에서 본다 (CLAUDE.md §4).
 */

import { describe, expect, it, vi } from 'vitest'

import { isClientError } from '../src/errors'
import { BACKBONES, DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { embedImages, type EmbedWorker } from '../src/ml/embed/client'
import { handleEmbed } from '../src/ml/embed/handler'
import { packPixels } from '../src/ml/embed/pixels'
import type { EmbedMessage, EmbedRequest } from '../src/ml/embed/protocol'
import type { BackboneRunner } from '../src/ml/embed/runner'

const spec = BACKBONES[0]!

describe('화소를 백본이 먹는 숫자로 옮긴다', () => {
  const rgba = (...pixels: number[][]): Uint8ClampedArray =>
    new Uint8ClampedArray(pixels.flatMap(([r, g, b, a]) => [r!, g!, b!, a ?? 255]))

  it('범위를 그대로 옮긴다', () => {
    const out = new Float32Array(3 * 4)
    packPixels(rgba([0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 128, 255]), 2, [-1, 1], out)
    expect(out[0]).toBeCloseTo(-1, 6)
    expect(out[3]).toBeCloseTo(1, 6)
    expect([out[6], out[7], out[8]]).toEqual([1, -1, -1])
    expect(out[10]).toBeCloseTo(128 / 127.5 - 1, 6)
  })

  it('범위가 [0,1]이면 그 범위로 옮긴다', () => {
    const out = new Float32Array(3)
    packPixels(rgba([0, 51, 255]), 1, [0, 1], out)
    expect([...out].map((v) => Math.round(v * 100) / 100)).toEqual([0, 0.2, 1])
  })

  it('알파는 버린다 — 정본은 흰 배경으로 이미 합성돼 있다', () => {
    const opaque = new Float32Array(3)
    const transparent = new Float32Array(3)
    packPixels(rgba([10, 20, 30, 255]), 1, [0, 1], opaque)
    packPixels(rgba([10, 20, 30, 0]), 1, [0, 1], transparent)
    expect([...transparent]).toEqual([...opaque])
  })

  it('offset부터 이어 쓴다 — 사진마다 배열을 새로 만들지 않는다', () => {
    const out = new Float32Array(6)
    packPixels(rgba([255, 255, 255]), 1, [0, 1], out, 3)
    expect([...out]).toEqual([0, 0, 0, 1, 1, 1])
  })

  it('자리가 모자라면 조용히 자르지 않고 던진다', () => {
    expect(() => packPixels(rgba([1, 2, 3]), 2, [0, 1], new Float32Array(12))).toThrow(/화소/)
    expect(() => packPixels(rgba([1, 2, 3]), 1, [0, 1], new Float32Array(2))).toThrow(/자리/)
  })
})

// ---------------- 워커 안쪽 ----------------

function fakeRunner(overrides: Partial<BackboneRunner> = {}) {
  const runner: BackboneRunner & { disposed: number } = {
    disposed: 0,
    prepare: async (_target, onState) => {
      onState('downloading')
      onState('downloaded')
      onState('ready')
    },
    embed: async (_target, images, onProgress) => {
      images.forEach((_image, index) => onProgress(index + 1))
      return new Float32Array(images.length * spec.embeddingDim)
    },
    dispose: () => {
      runner.disposed += 1
    },
    ...overrides,
  }
  return runner
}

const requestFor = (count = 2): EmbedRequest => ({
  type: 'embed',
  backboneId: DEFAULT_BACKBONE_ID,
  modelUrl: 'https://example.test/app/backbones/mobilenet-v2/model.json',
  images: Array.from({ length: count }, () => new Uint8Array(new ArrayBuffer(4))),
})

async function collect(
  request: EmbedRequest,
  runner: BackboneRunner = fakeRunner(),
): Promise<EmbedMessage[]> {
  const messages: EmbedMessage[] = []
  await handleEmbed(
    request,
    (message) => messages.push(message),
    () => runner,
  )
  return messages
}

describe('임베딩 핸들러', () => {
  it('준비 단계를 먼저 흘리고 그 다음 사진을 센다', async () => {
    const messages = await collect(requestFor(2))
    expect(messages.map((message) => message.type)).toEqual([
      'preparing',
      'preparing',
      'preparing',
      'progress',
      'progress',
      'done',
    ])
    expect(messages.slice(0, 3).map((message) => (message as { state: string }).state)).toEqual([
      'downloading',
      'downloaded',
      'ready',
    ])
  })

  it('결과는 사진 수 × 차원짜리 배열 하나다', async () => {
    const messages = await collect(requestFor(3))
    const done = messages.at(-1)
    expect(done).toMatchObject({ type: 'done', dim: spec.embeddingDim })
    expect((done as { vectors: Float32Array }).vectors.length).toBe(3 * spec.embeddingDim)
  })

  it('등록부에 없는 백본이면 준비를 시작하지도 않는다', async () => {
    const runner = fakeRunner()
    const messages: EmbedMessage[] = []
    await handleEmbed(
      { ...requestFor(), backboneId: 'no-such-backbone' as typeof DEFAULT_BACKBONE_ID },
      (message) => messages.push(message),
      () => runner,
    )
    expect(messages).toEqual([
      { type: 'failed', code: 'BACKBONE_UNAVAILABLE', params: expect.anything() },
    ])
    expect(runner.disposed).toBe(0)
  })

  it('준비가 터져도 던지지 않고 코드로 내보낸다', async () => {
    const runner = fakeRunner({
      prepare: () => Promise.reject(new Error('WebGPU 어댑터가 없다')),
    })
    const messages = await collect(requestFor(), runner)
    expect(messages).toEqual([
      { type: 'failed', code: 'BACKBONE_UNAVAILABLE', params: { detail: 'WebGPU 어댑터가 없다' } },
    ])
  })

  it('어떤 경로로 끝나든 runner를 놓는다', async () => {
    const ok = fakeRunner()
    await collect(requestFor(), ok)
    expect(ok.disposed).toBe(1)

    const broken = fakeRunner({ embed: () => Promise.reject(new Error('메모리')) })
    await collect(requestFor(), broken)
    expect(broken.disposed).toBe(1)
  })
})

// ---------------- 메인 스레드 쪽 ----------------

class FakeWorker implements EmbedWorker {
  onmessage: ((event: MessageEvent<EmbedMessage>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null
  readonly posted: EmbedRequest[] = []
  terminated = 0

  postMessage(message: EmbedRequest): void {
    this.posted.push(message)
  }

  terminate(): void {
    this.terminated += 1
  }

  emit(message: EmbedMessage): void {
    this.onmessage?.({ data: message } as MessageEvent<EmbedMessage>)
  }

  crash(message = '', filename = '', lineno = 0): void {
    this.onerror?.(new ErrorEvent('error', { message, filename, lineno }))
  }
}

/** 진짜 워커처럼 비동기로 답한다. 동기로 답하면 client가 못 잡는 순서를 놓친다. */
class HandlerWorker extends FakeWorker {
  constructor(private readonly runner: BackboneRunner = fakeRunner()) {
    super()
  }

  override postMessage(message: EmbedRequest): void {
    super.postMessage(message)
    queueMicrotask(() => {
      void handleEmbed(
        message,
        (outgoing) => this.emit(outgoing),
        () => this.runner,
      )
    })
  }
}

const images = (count: number) =>
  Array.from({ length: count }, () => new Uint8Array(new ArrayBuffer(4)))

describe('임베딩 클라이언트', () => {
  it('등록부의 상대 경로를 문서 기준으로 풀어 넘긴다', () => {
    const worker = new FakeWorker()
    embedImages(DEFAULT_BACKBONE_ID, images(1), {
      createWorker: () => worker,
      resolveUrl: (path) => `https://example.test/ml-playgrounds/${path}`,
    })
    expect(worker.posted[0]?.modelUrl).toBe(`https://example.test/ml-playgrounds/${spec.modelPath}`)
  })

  it('준비와 진행을 흘리고 결과를 준 뒤 워커를 끝낸다', async () => {
    const worker = new HandlerWorker()
    const states: string[] = []
    const progress: number[] = []
    const { result } = embedImages(DEFAULT_BACKBONE_ID, images(2), {
      createWorker: () => worker,
      onState: (state) => states.push(state),
      onProgress: (completed) => progress.push(completed),
    })

    const { vectors, dim } = await result
    expect(states).toEqual(['downloading', 'downloaded', 'ready'])
    expect(progress).toEqual([1, 2])
    expect(dim).toBe(spec.embeddingDim)
    expect(vectors.length).toBe(2 * spec.embeddingDim)
    expect(worker.terminated).toBe(1)
  })

  it('워커가 통째로 죽으면 실패로 바꾼다 — 예외로는 안 온다', async () => {
    const worker = new FakeWorker()
    const { result } = embedImages(DEFAULT_BACKBONE_ID, images(1), {
      createWorker: () => worker,
    })
    worker.crash('Out of memory', 'embed.worker.js', 12)

    await expect(result).rejects.toSatisfy((error: unknown) => {
      if (!isClientError(error)) return false
      expect(error.code).toBe('BACKBONE_UNAVAILABLE')
      // 원문까지 싣는다. 없으면 교사가 손쓸 것이 없다.
      expect(error.params).toEqual({ detail: 'Out of memory embed.worker.js:12' })
      return true
    })
    expect(worker.terminated).toBe(1)
  })

  it('취소하면 워커가 끝나고 이후 메시지는 버린다', async () => {
    const worker = new FakeWorker()
    const onProgress = vi.fn()
    const { result, cancel } = embedImages(DEFAULT_BACKBONE_ID, images(3), {
      createWorker: () => worker,
      onProgress,
    })

    cancel()
    worker.emit({ type: 'progress', completed: 1, total: 3 })

    await expect(result).rejects.toSatisfy(
      (error: unknown) => isClientError(error) && error.code === 'JOB_CANCELLED',
    )
    expect(onProgress).not.toHaveBeenCalled()
    expect(worker.terminated).toBe(1)
  })
})
