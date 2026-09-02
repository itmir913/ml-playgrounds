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
  /** 아직 안 끝난 임베딩 요청들. `deliver()`가 그 하나를 끝내고 `fail()`이 죽인다. */
  embed: [] as { deliver: () => void; fail: () => void }[],
  /** 굽기 요청이 몇 번 갔나. */
  baked: 0,
  /**
   * 참이면 굽기가 **바로** 답하지 않는다 — 굽는 창을 열어 둔다. 그때의 요청은 아래
   * `bake`에 손잡이로 쌓이고, 검사가 원하는 시점에 `deliver()`로 끝낸다.
   */
  holdBake: false,
  /** 붙들어 둔 굽기 요청들. */
  bake: [] as { deliver: () => void }[],
  /**
   * 끊긴 워커의 수. **떠날 때 무엇이 끊겼는지가 이 하니스로만 보인다** — 굽기와 임베딩이
   * 겹치면 손잡이가 칸 하나일 때 한쪽만 끊긴다 (R21 B-2).
   */
  terminated: { embed: 0, bake: 0 },
}

export function resetImageWorkers(): void {
  workerState.embed.length = 0
  workerState.bake.length = 0
  workerState.baked = 0
  workerState.holdBake = false
  workerState.terminated = { embed: 0, bake: 0 }
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
        /**
         * **워커가 죽는다.** 스크립트를 못 받았거나 wasm이 안 서는 자리이고, 검사에서는
         * **성공도 취소도 아닌 셋째 끝**이 필요할 때 쓴다 — 그 길로도 화면의 잠금이
         * 풀리는지는 아무도 안 봤다 (2026-09-02 R22 B-4).
         */
        fail: () => {
          worker.onerror?.(new ErrorEvent('error', { message: '워커가 죽었다' }))
        },
      })
    },
    terminate() {
      workerState.terminated.embed += 1
    },
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
    terminate() {
      workerState.terminated.bake += 1
    },
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

/**
 * 붙여넣은 것. **jsdom에는 `ClipboardEvent`가 없다** — `DragEvent`와 같은 사정이다.
 *
 * **`window`에 던진다** — 화면이 리스너를 거기 건다(`composables/usePasteImages.ts`).
 * `target`을 주면 글자 쓰는 자리에서 누른 붙여넣기를 흉내 낼 수 있다.
 */
export function pasteEvent(files: readonly File[], target?: EventTarget): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: { files } })
  if (target) Object.defineProperty(event, 'target', { value: target })
  return event
}

/** 클립보드에서 온 사진 한 장. **이름이 언제나 `image.png`인 것이 요점이다.** */
export function pastedPhoto(bytes = [1, 2, 3]): File {
  return new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' })
}

/**
 * **저장이 끝날 때까지 기다린다.** `project.save` 뒤에 오는 것(알림·판 비우기)을 재는
 * 검사가 쓴다.
 *
 * **틱 몇 번으로는 모자란다.** 스토어는 `file.value`를 **먼저** 바꾸고 IndexedDB 쓰기를
 * `await`하므로, 사진 수 같은 동기 값은 바로 보이는데 **그 뒤의 알림은 아직 안 온다.**
 * 격리 실행에서는 우연히 맞고 **전체 실행에서만 어긋난다** — 거짓 빨강이 진짜 빨강을
 * 가린다 (2026-09-02 R24 B-4, `flaky-gate-under-load`).
 */
export async function settleSave(
  project: { saving: boolean },
  flush: () => Promise<void>,
): Promise<void> {
  for (let round = 0; round < 200 && project.saving; round += 1) {
    await flush()
  }
  // 쓰기가 끝난 뒤의 마이크로태스크(알림·판 비우기)를 한 번 더 흘린다.
  await flush()
}
