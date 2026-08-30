/**
 * **사진이 이 기기에 들어가는지 굽기 전에 묻는가**
 * (`open-decisions.md` "이미지가 들어갈 자리는 굽기 전에 묻는다").
 *
 * **이 검사의 알맹이는 시점이다.** 거절 자체는 전부터 됐다 — `saveProject`가 쓰기
 * 직전에 물었고 `STORAGE_QUOTA_EXCEEDED`로 곱게 실패했다. 갈리는 것은 **학생이
 * 사진을 다 굽고 백본을 다 돌린 뒤에 그 말을 듣느냐**이고, 그게 한 차시를 날렸다.
 *
 * **판정하는 문턱은 우리 상수가 아니다.** 브라우저가 보고하는 쿼터이고, 우리가 정하는
 * 것은 "얼마나 들어갈지"의 추정뿐이다. 그래서 여기서 무는 것도 그 추정이 실측과
 * 어긋나지 않는가와, 굽는 화면이 실제로 묻는가 둘이다.
 */

import { describe, expect, it } from 'vitest'

import { CANONICAL_FORMATS } from '../src/data/image/formats'
import { imageRoomShortfall } from '../src/data/image/room'
import {
  BYTES_PER_MB,
  IMAGE_JPEG_ESTIMATED_BYTES,
  IMAGE_WEBP_ESTIMATED_BYTES,
  MAX_IMAGE_COUNT,
  STORAGE_SAFETY_FACTOR,
} from '../src/limits'
import { backboneFor, DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { estimatedImageBytes } from '../src/project/images'
import { sourceFiles, withoutComments } from './fixtures/source'

import { join } from 'node:path'
import { readFileSync } from 'node:fs'

const SRC = join(process.cwd(), 'src')
/** 결정문의 100MB도 화면 문구도 이 단위다 (open-decisions.md "MB는 십진 백만이다"). */
const MB = BYTES_PER_MB
const backbone = backboneFor(DEFAULT_BACKBONE_ID)
if (!backbone) throw new Error(`기본 백본을 등록부에서 못 찾았다: ${DEFAULT_BACKBONE_ID}`)

describe('사진이 들어갈 자리', () => {
  it('장당은 정본과 임베딩을 더한 것이다', () => {
    // 임베딩은 `embeddingDim` × Float32Array의 원소 크기다. 1,280 × 4 = 5,120바이트.
    const embedding = backbone.embeddingDim * Float32Array.BYTES_PER_ELEMENT
    expect(embedding).toBe(5120)

    expect(estimatedImageBytes(1, CANONICAL_FORMATS.webp, backbone.embeddingDim)).toBe(
      IMAGE_WEBP_ESTIMATED_BYTES + embedding,
    )
    expect(estimatedImageBytes(1, CANONICAL_FORMATS.jpeg, backbone.embeddingDim)).toBe(
      IMAGE_JPEG_ESTIMATED_BYTES + embedding,
    )
  })

  it('임베딩 몫이 등록부에서 유도된다', () => {
    // **상수로 박으면 백본을 바꾼 날 조용히 틀린다.** 차원이 달라지면 값도 달라져야 한다.
    const half = estimatedImageBytes(1, CANONICAL_FORMATS.webp, backbone.embeddingDim / 2)
    const full = estimatedImageBytes(1, CANONICAL_FORMATS.webp, backbone.embeddingDim)
    expect(full - half).toBe((backbone.embeddingDim / 2) * Float32Array.BYTES_PER_ELEMENT)
  })

  /**
   * **문서가 인용하는 두 숫자를 여기서 문다.**
   *
   * `open-decisions.md`의 "정본은 WebP로 굽는다"와 "상한은 누가 정했느냐" §3이 둘 다
   * *"사진 수 상한을 채운 프로젝트가 webp 81MB · jpg 109MB"*를 근거로 든다. §3은 그
   * 숫자로 **100MB 문턱을 골랐다** — 50MB로 두면 정상적으로 제출되는 webp 프로젝트에
   * 경고가 뜬다는 것이 그 결정의 이유였다. 이 산수가 흔들리면 **그 결정문의 근거가
   * 함께 흔들린다.**
   *
   * **단위가 두 벌이던 것은 2026-08-20에 닫았다** (위 "MB는 십진 백만이다"). 그전에는
   * 코드의 `BYTES_PER_MB`가 `1024 × 1024`라 **같은 파일이 문서에서 109MB, 화면에서
   * 104MB로 읽혔다.** 지금은 한 축이고, 아래가 그것을 쓴다.
   *
   * **문서의 "81"과 1.5MB 차이가 나는 것은 문서가 반올림했기 때문이다** — 임베딩
   * 5,120바이트를 "5kB"로 적어 장당 16.3kB로 셌다. 실제 장당은 16,420바이트다.
   */
  it('상한을 채운 프로젝트가 결정문이 고른 100MB의 어느 쪽인가', () => {
    const webp = estimatedImageBytes(MAX_IMAGE_COUNT, CANONICAL_FORMATS.webp, backbone.embeddingDim)
    const jpeg = estimatedImageBytes(MAX_IMAGE_COUNT, CANONICAL_FORMATS.jpeg, backbone.embeddingDim)

    expect(Math.round(webp / MB)).toBe(82)
    expect(Math.round(jpeg / MB)).toBe(109)

    // **webp가 100MB 아래이고 jpg는 위다.** §3이 문턱을 100MB로 고른 자리이고,
    // 로드맵이 "최악의 경로는 WebP를 못 굽는 기기다"라고 적은 자리다.
    expect(webp).toBeLessThan(100 * MB)
    expect(jpeg).toBeGreaterThan(100 * MB)
  })

  /**
   * **굽는 화면은 굽기 전에 자리를 물어야 한다.**
   *
   * 이 규칙이 없으면 셋째 화면이 사진을 받게 될 때 조용히 빠진다 — 그 화면은 멀쩡히
   * 돌고, 학생만 다 구운 뒤에 거절당한다. 눈으로도 타입으로도 안 걸리는 종류다.
   */
  it('사진을 굽는 화면이 전부 자리를 먼저 묻는다', () => {
    const missing: string[] = []
    for (const path of sourceFiles(SRC)) {
      const kept = withoutComments(readFileSync(path, 'utf8')).join('\n')
      if (!kept.includes('canonicalizeImages(')) continue
      // 워커를 띄우는 층(`data/image/client.ts`)은 화면이 아니라 도구다.
      if (!path.includes('views')) continue
      if (!kept.includes('imageRoomShortfall(')) {
        missing.push(path.slice(SRC.length + 1).replace(/\\/g, '/'))
      }
    }
    expect(missing, '굽기 전에 자리를 안 묻는 화면').toEqual([])
  })

  it('검사기가 실제로 잡는다', () => {
    // 위 규칙이 훑는 대상이 0개면 통과가 아무 뜻이 없다.
    const bakers = sourceFiles(SRC).filter(
      (path) =>
        path.includes('views') &&
        withoutComments(readFileSync(path, 'utf8')).join('\n').includes('canonicalizeImages('),
    )
    expect(bakers.length).toBeGreaterThanOrEqual(2)
  })
})

/**
 * **판정 함수를 실제로 부른다.**
 *
 * 위의 검사들은 굽는 화면이 `imageRoomShortfall`이라는 **이름**을 부르는지 소스로 훑고,
 * 그 위는 `estimatedImageBytes`라는 **산수**만 본다. 그래서 그 산수를 **어떤 인자로
 * 부르는지**는 저장소 어디도 안 봤다 — `backbone.embeddingDim`을 `backbone.canonicalSize`로
 * 바꾸는 낱말 하나짜리 오타에 장당 추정이 26% 줄어드는데 검사 129개와 `tsc`가 전부
 * 조용했다 (2026-08-30 R12 감사 A-1). 그러면 굽기 전 관문이 통과시키고, 학생은 5,000장을
 * 다 구운 뒤 `saveProject`에서 거절당한다 — 이 결정문이 없애려던 실패 그대로다.
 *
 * 브라우저 둘을 세워 둔다 — 형식 프로브(`OffscreenCanvas`)와 쿼터
 * (`navigator.storage.estimate`). **세우는 것은 그 둘뿐이고 판정은 진짜 함수가 한다.**
 */
describe('굽기 전에 묻는 판정', () => {
  class ProbeCanvas {
    getContext(): { fillStyle: string; fillRect: () => void } {
      return { fillStyle: '', fillRect: (): void => {} }
    }
    convertToBlob({ type }: { type: string }): Promise<{ type: string }> {
      return Promise.resolve({ type })
    }
  }

  function withBrowser(quota: number, usage = 0): () => void {
    const heldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
    Object.defineProperty(globalThis, 'OffscreenCanvas', {
      value: ProbeCanvas,
      configurable: true,
    })
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        storage: { estimate: (): Promise<StorageEstimate> => Promise.resolve({ quota, usage }) },
      },
      configurable: true,
    })
    return () => {
      Reflect.deleteProperty(globalThis, 'OffscreenCanvas')
      if (heldNavigator) Object.defineProperty(globalThis, 'navigator', heldNavigator)
      else Reflect.deleteProperty(globalThis, 'navigator')
    }
  }

  function projectOf(...imageSizes: number[]): ProjectFile {
    const document = newProjectDocument(
      { name: '사진', locale: 'ko', dataType: 'image' },
      {
        projectId: '550e8400-e29b-41d4-a716-446655440000',
        createdAt: '2026-08-30T00:00:00.000Z',
        randomState: 42,
      },
    )
    const images = new Map<string, Uint8Array>()
    imageSizes.forEach((size, index) => images.set(`p${index}.webp`, new Uint8Array(size)))
    return { document, models: new Map(), images, attachments: new Map(), embeddings: new Map() }
  }

  const INCOMING = 1000
  const incomingBytes = estimatedImageBytes(INCOMING, CANONICAL_FORMATS.webp, backbone.embeddingDim)
  const asMb = (bytes: number): number => Math.ceil((bytes * STORAGE_SAFETY_FACTOR) / MB)

  it('프로젝트가 없으면 묻지 않는다 - 담을 곳이 아직 없다', async () => {
    const restore = withBrowser(1)
    await expect(imageRoomShortfall(null, INCOMING, backbone)).resolves.toBeNull()
    restore()
  })

  it('브라우저가 쿼터를 모르면 막지 않는다', async () => {
    const restore = withBrowser(0)
    await expect(imageRoomShortfall(projectOf(), INCOMING, backbone)).resolves.toBeNull()
    restore()
  })

  it('장당 추정에 임베딩이 들어간다', async () => {
    const restore = withBrowser(1)
    const shortfall = await imageRoomShortfall(projectOf(), INCOMING, backbone)
    restore()
    // 차원을 다른 값으로 바꿔 부르면 이 숫자가 어긋난다.
    expect(shortfall?.requiredMb).toBe(asMb(incomingBytes))
  })

  it('이미 든 사진의 바이트를 함께 센다', async () => {
    const held = 40 * MB
    const restore = withBrowser(50 * MB)
    const empty = await imageRoomShortfall(projectOf(), INCOMING, backbone)
    const loaded = await imageRoomShortfall(projectOf(held), INCOMING, backbone)
    restore()
    // 새로 들어올 몫만 세면 든 것이 40MB든 0이든 똑같이 통과한다.
    expect(empty).toBeNull()
    expect(loaded?.requiredMb).toBe(asMb(held + incomingBytes))
  })
})
