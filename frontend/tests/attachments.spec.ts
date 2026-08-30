/**
 * 포트폴리오에 붙일 사진을 굽는 자리 (`project/attachments.ts`, mlpx-spec.md §8.6.1).
 *
 * **이 모듈을 부르는 스펙이 하나도 없었다** (R14-4 감사 B-1 → 2026-08-31 사각 감사 A-2).
 * 그때는 *"canvas가 필요해 node에서 못 돈다"*고 보고 접었는데, **그 전제가 틀렸다** —
 * 이 저장소는 이미 `OffscreenCanvas`를 세우는 하니스를 갖고 있고(`image-room.spec.ts`),
 * 거기에 `createImageBitmap` 하나만 더 세우면 그대로 돈다.
 *
 * **세우는 것은 브라우저뿐이고 판정은 진짜 함수가 한다.**
 */

import { afterEach, describe, expect, it } from 'vitest'

import { bakeAttachments, imagesFromClipboard } from '../src/project/attachments'

/** 그림을 굽는 흉내. 크기와 형식은 진짜 함수가 정하고 여기서는 바이트만 돌려준다. */
class FakeCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(): { drawImage: () => void; fillStyle: string; fillRect: () => void } {
    // 형식 프로브가 화소 하나를 실제로 칠한다 (`data/image/bake.ts`).
    return { drawImage: (): void => {}, fillStyle: '', fillRect: (): void => {} }
  }
  convertToBlob({ type }: { type: string }): Promise<Blob> {
    return Promise.resolve(new Blob([new Uint8Array([1, 2, 3])], { type }))
  }
}

function withBrowser(decodable: (file: Blob) => boolean): () => void {
  Object.defineProperty(globalThis, 'OffscreenCanvas', { value: FakeCanvas, configurable: true })
  Object.defineProperty(globalThis, 'createImageBitmap', {
    value: (file: Blob) =>
      decodable(file)
        ? Promise.resolve({ width: 40, height: 20, close: (): void => {} })
        : Promise.reject(new Error('못 읽는다')),
    configurable: true,
  })
  return () => {
    Reflect.deleteProperty(globalThis, 'OffscreenCanvas')
    Reflect.deleteProperty(globalThis, 'createImageBitmap')
  }
}

const photo = (name: string, type = 'image/png') =>
  new File([new Uint8Array([9, 9])], name, { type })

let restore: (() => void) | null = null

afterEach(() => {
  restore?.()
  restore = null
})

describe('첨부는 정본과 같은 형식으로 굽는다', () => {
  it('구운 것마다 확장자와 mime가 함께 온다', async () => {
    restore = withBrowser(() => true)
    const baked = await bakeAttachments([photo('a.png'), photo('b.png')])

    expect(baked).toHaveLength(2)
    for (const one of baked) {
      expect(one.bytes.byteLength).toBeGreaterThan(0)
      // 확장자는 무엇으로 구웠는지의 기록이다. 비면 zip 엔트리 이름이 깨진다.
      expect(one.extension).toMatch(/^\.\w+$/)
      expect(one.mime).toMatch(/^image\//)
    }
  })

  it('못 읽는 파일은 조용히 빠진다 - 부르는 쪽이 몇 장이 빠졌는지 말한다', async () => {
    restore = withBrowser((file) => (file as File).name !== '메모.txt')
    const baked = await bakeAttachments([photo('a.png'), photo('메모.txt', 'text/plain')])

    expect(baked).toHaveLength(1)
  })

  it('빈 목록에는 브라우저를 안 부른다', async () => {
    // 형식 프로브도 안 돌아야 한다 - 아무것도 안 굽는데 캔버스를 세울 이유가 없다.
    expect(await bakeAttachments([])).toEqual([])
  })
})

describe('붙여넣기에서 사진만 골라낸다', () => {
  const clipboard = (files: File[]) => ({ files }) as unknown as DataTransfer

  it('사진만 고른다 - 글을 붙여넣으면 아무 일도 안 일어난다', () => {
    const picked = imagesFromClipboard(clipboard([photo('a.png'), photo('메모.txt', 'text/plain')]))
    expect(picked.map((file) => file.name)).toEqual(['a.png'])
  })

  it('아무것도 안 왔으면 빈 목록이다', () => {
    expect(imagesFromClipboard(null)).toEqual([])
    expect(imagesFromClipboard(clipboard([]))).toEqual([])
  })
})
