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
import {
  BYTES_PER_MB,
  IMAGE_JPEG_ESTIMATED_BYTES,
  IMAGE_WEBP_ESTIMATED_BYTES,
  MAX_IMAGE_COUNT,
} from '../src/limits'
import { backboneFor, DEFAULT_BACKBONE_ID } from '../src/ml/backbones'
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
