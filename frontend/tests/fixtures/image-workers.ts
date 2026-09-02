/**
 * 이미지 화면을 **띄워서** 보는 검사들의 하니스.
 *
 * **순수 함수로는 안 잡히는 것이 있다** (2026-09-02 R20). 굽기와 임베딩은 각각 워커를
 * 열고, 그 둘이 겹치는 창에서 학생이 무엇을 하면 무슨 일이 나는지는 **컴포넌트를 띄우고
 * 워커의 끝나는 시점을 손으로 정해야** 보인다. R20 감사자가 그렇게 결함 둘을 꺼냈고,
 * 그 하니스를 여기로 옮겨 다음 검사들이 다시 안 짜게 했다.
 *
 * **워커는 답하는 시점을 검사가 정한다.** `embed`에 쌓인 손잡이를 부를 때까지 임베딩은
 * 안 끝나고, `holdBake`가 참이면 굽기도 `bake`의 손잡이를 부를 때까지 안 끝난다 —
 * **그 사이가 겹치는 창이다.**
 */

import { hashBytes } from '../../src/hash'
import type { CanonicalizeWorker } from '../../src/data/image/client'
import type { CanonicalizeMessage } from '../../src/data/image/protocol'
import type { EmbedWorker } from '../../src/ml/embed/client'
import type { EmbedMessage } from '../../src/ml/embed/protocol'
import { backboneFor, DEFAULT_BACKBONE_ID } from '../../src/ml/backbones'
import { newProjectDocument } from '../../src/project/create'
import { IMAGE_UNLABELED, type ProjectFile } from '../../src/project/format'
import { addImages } from '../../src/project/images'

/** 검사가 워커의 시점을 잡는 손잡이. **`beforeEach`에서 `resetImageWorkers`를 부른다.** */
export const workerState = {
  /** 아직 안 끝난 임베딩 요청들. `deliver()`가 그 하나를 끝낸다. */
  embed: [] as { deliver: () => void }[],
  /** 굽기 요청이 몇 번 갔나. */
  baked: 0,
  /**
   * 참이면 굽기가 **바로** 답하지 않는다 — 굽는 창을 열어 둔다. 그때의 요청은 아래
   * `bake`에 손잡이로 쌓이고, 검사가 원하는 시점에 `deliver()`로 끝낸다.
   */
  holdBake: false,
  /** 붙들어 둔 굽기 요청들. */
  bake: [] as { deliver: () => void }[],
}

export function resetImageWorkers(): void {
  workerState.embed.length = 0
  workerState.bake.length = 0
  workerState.baked = 0
  workerState.holdBake = false
}

/** 벡터는 전부 1이다. **값이 아니라 시점이 이 하니스의 주제다.** */
export function fakeEmbedWorker(): EmbedWorker {
  const worker: EmbedWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(request) {
      const dim = 4
      const vectors = new Float32Array(request.images.length * dim).fill(1)
      workerState.embed.push({
        deliver: () => {
          const message: EmbedMessage = { type: 'done', vectors, dim }
          worker.onmessage?.({ data: message } as MessageEvent<EmbedMessage>)
        },
      })
    },
    terminate() {},
  }
  return worker
}

/** 구운 바이트는 `baked:<파일이름>`이다 — 해시가 이름에서 나오므로 검사가 셀 수 있다. */
export function fakeCanonicalizeWorker(): CanonicalizeWorker {
  const worker: CanonicalizeWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage(request) {
      workerState.baked += 1
      const images = request.files.map((file: File) => {
        const bytes = new TextEncoder().encode(`baked:${file.name}`)
        return { sourceName: file.name, hash: hashBytes(bytes), bytes }
      })
      const message = { type: 'done', format: 'webp', images, skipped: [] } as CanonicalizeMessage
      const deliver = (): void => {
        worker.onmessage?.({ data: message } as MessageEvent<CanonicalizeMessage>)
      }
      if (workerState.holdBake) {
        workerState.bake.push({ deliver })
        return
      }
      queueMicrotask(deliver)
    },
    terminate() {},
  }
  return worker
}

export const HARNESS_BACKBONE = backboneFor(DEFAULT_BACKBONE_ID)

/** 예측 자리에 사진이 든 이미지 프로젝트. `seeds` 하나가 사진 하나다. */
export function imagePredictProject(seeds: readonly string[]): ProjectFile {
  const backbone = HARNESS_BACKBONE
  if (!backbone) throw new Error('backbone not found')
  const document = newProjectDocument(
    { name: '개와 고양이', locale: 'ko', dataType: 'image' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-09-02T08:00:00.000Z',
      randomState: 42,
    },
  )
  const empty: ProjectFile = {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  return addImages(
    empty,
    seeds.map((seed) => {
      const bytes = new TextEncoder().encode(`가짜jpg:${seed}`)
      return { hash: hashBytes(bytes), bytes, category: IMAGE_UNLABELED }
    }),
    {
      canonicalSize: backbone.canonicalSize,
      now: '2026-09-02T09:00:00.000Z',
      role: 'predict',
      format: 'webp',
    },
  ).project
}

/**
 * jsdom에는 `<dialog>`의 열고 닫기가 없다. **없으면 언마운트가 던진다** —
 * `AppDialog`가 `onBeforeUnmount`에서 `close()`를 부르기 때문이고, 그 예외는 화면을
 * 떠나는 것을 보는 검사마다 걸린다.
 */
export function stubDialogElement(): void {
  const proto = globalThis.HTMLDialogElement?.prototype
  if (!proto) return
  proto.showModal = function showModal(this: HTMLDialogElement): void {
    this.open = true
  }
  proto.close = function close(this: HTMLDialogElement): void {
    this.open = false
  }
}

/** 판에 사진을 끌어다 놓는 것. **jsdom에는 `DragEvent`가 없다.** */
export function dropEvent(files: readonly File[]): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files } })
  return event
}
