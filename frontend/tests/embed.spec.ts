// @vitest-environment jsdom
// 가짜 Worker가 `new ErrorEvent`를 쓰는데 node에는 그 전역이 없다.
/**
 * 임베딩 경로의 계약.
 *
 * **진짜 백본을 돌리지 않는다.** TF.js도 `OffscreenCanvas`도 여기 없고, 있어도 그건
 * 우리 로직이 아니라 남의 라이브러리를 검사하는 것이다. 대신 이 층이 실제로 하는 일을
 * 본다 — **화소를 옮기는 계산 · 메시지 순서 · 실패 전달 · 워커 사망**.
 *
 * 진짜 백본이 도는지는 사용자가 자기 브라우저에서 본다 (CLAUDE.md §4).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { withoutComments } from './fixtures/source'
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
  /**
   * **주소를 손대지 않는다.** 등록부의 것은 원본의 절대 주소이고, 우리 산출물 어디에도
   * 그 파일이 없다 — 문서 기준으로 풀던 코드가 남아 있으면 앱 주소 밑을 뒤져 404가 난다.
   */
  it('등록부의 원본 주소를 그대로 넘긴다', () => {
    const worker = new FakeWorker()
    embedImages(DEFAULT_BACKBONE_ID, images(1), { createWorker: () => worker })
    expect(worker.posted[0]?.modelUrl).toBe(spec.modelUrl)
    expect(spec.modelUrl.startsWith('https://')).toBe(true)
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

/**
 * **캔버스에 남은 앞 사진의 화소를 막는다** (V11 R1 감사 B-2).
 *
 * `runner.ts`는 `OffscreenCanvas`를 요구해서 node에서 못 돌린다. 그래서 여기서는
 * **소스를 글자로 본다** — `ui-rules.spec.ts`와 같은 계열이고, 같은 한계를 갖는다:
 * **줄이 거기 있는지만 보지 그 줄이 실제로 도는지는 못 본다.**
 *
 * 무엇을 지키려는 것인가 — 캔버스를 한 번 만들어 사진마다 다시 쓰는데 `drawImage`는
 * 원본 크기로 그린다. 작은 정본이 오면 남는 자리에 **직전 사진의 화소가 그대로 남고**,
 * 두 사진이 섞인 벡터가 예외 없이 파일에 담긴다.
 */
describe('임베딩 캔버스가 앞 사진을 안 물려준다', () => {
  // `import.meta.url`이 file: 스킴이 아닌 환경이 있어 cwd에서 잡는다 (다른 소스 검사와 같다).
  const RAW = readFileSync(join(process.cwd(), 'src', 'ml', 'embed', 'runner.ts'), 'utf-8')

  /**
   * **주석을 걷어내고 본다** (R6 감사 B-12). 걷어내기 전에는 `clearRect(`를 주석 안으로
   * 옮긴 돌연변이에 이 검사가 그대로 통과했다 — 막으려는 것은 코드이지 설명이 아니다.
   */
  const SOURCE = withoutComments(RAW).join(String.fromCharCode(10))

  it('훑을 소스를 실제로 찾는다', () => {
    expect(SOURCE).toContain('drawImage')
  })

  it('주석은 걷어낸다 - 설명에 적힌 이름에 속지 않는다', () => {
    // 그 이름이 원문에는 있고 걷어낸 뒤에는 없어야 이 검사가 실제로 도는 것이다.
    expect(RAW).toContain('clearRect')
    expect(SOURCE).not.toContain('clearRect')
  })

  /**
   * **흰색으로 깐다.** `clearRect`가 까는 것은 투명 검정이고, 알파를 버리는
   * `packPixels`는 그 자리를 검정으로 읽는다 — 파이프라인 나머지는 전부 흰 여백이다
   * (`data/image/bake.ts`).
   */
  it('그리기 전에 흰색으로 깐다', () => {
    const fill = SOURCE.indexOf('fillRect(')
    const draw = SOURCE.indexOf('drawImage(')
    expect(fill, 'fillRect가 없다').toBeGreaterThan(-1)
    expect(fill, 'fillRect가 drawImage보다 뒤에 있다').toBeLessThan(draw)
    expect(SOURCE, '깔개가 흰색이 아니다').toContain("fillStyle = '#ffffff'")
  })

  it('정본 크기가 백본과 다르면 멈춘다', () => {
    // 깔기만으로는 부족하다 - 작은 정본은 여백을 얻고 그 벡터도 틀린 값이다.
    expect(SOURCE).toMatch(/bitmap\.width !== size \|\| bitmap\.height !== size/)
  })
})

/**
 * **백본을 받는 동안 얼마나 왔는지 흘린다** (2026-08-29 화면 실측 C-7).
 *
 * 12.4MB라 학교 회선에서는 이 구간이 몇십 초를 덮는데, 화면이 문장 하나로 서 있으면
 * 학생은 멈춘 줄 안다. TF.js의 `onProgress`가 주는 값이 여기까지 와야 화면이 말할 수
 * 있다 — **주는 쪽과 받는 쪽 사이에 자리가 넷이라, 하나만 빠져도 조용히 안 온다.**
 */
describe('내려받는 비율이 화면까지 온다', () => {
  it('핸들러가 비율을 그대로 흘린다', async () => {
    const messages = await collect(
      requestFor(1),
      fakeRunner({
        prepare: async (_target, onState) => {
          onState('downloading')
          onState('downloading', 0.42)
          onState('ready')
        },
      }),
    )
    const preparing = messages.filter((message) => message.type === 'preparing')

    expect(preparing.map((message) => message.fraction)).toEqual([undefined, 0.42, undefined])
  })

  /**
   * **비율이 없는 것과 0인 것은 다르다.** 아직 아무것도 모르는 상태를 0%로 그리면
   * 학생은 멈췄다고 읽는다 — `protocol.ts`가 이 필드를 선택으로 둔 이유다.
   */
  it('안 주면 필드가 아예 없다', async () => {
    const messages = await collect(requestFor(1))
    const preparing = messages.filter((message) => message.type === 'preparing')

    expect(preparing.length).toBeGreaterThan(0)
    for (const message of preparing) expect('fraction' in message).toBe(false)
  })
})
