/**
 * 정본의 규칙 (mlpx-spec.md §1.2).
 *
 * **여기서 틀리면 화면에서는 안 보인다.** 경로가 어긋나면 `.mlpx`가 파이썬에서 안 열리고,
 * 이름 규칙이 새면 `개/고양이`라는 범주 하나가 폴더 두 겹이 되어 **사진이 조용히 다른
 * 라벨로 담긴다.** 굽는 것 자체(캔버스)는 워커라 여기서 안 덮인다.
 */

import { describe, expect, it } from 'vitest'

import {
  categoryOfEntry,
  fitBox,
  fitLongEdge,
  imageEntryPath,
  isValidCategoryName,
} from '../src/data/image/canonical'
import { CANONICAL_FORMATS, canonicalFormatOfPath } from '../src/data/image/formats'
import { IMAGE_UNLABELED } from '../src/project/format'

const SIZE = 224
const HASH = 'a'.repeat(64)

/** 지금 굽는 형식. **경로 규칙은 형식을 받아서 쓴다** (mlpx-spec.md §1.2). */
const WEBP = CANONICAL_FORMATS.webp
const JPEG = CANONICAL_FORMATS.jpeg

describe('긴 변만 줄이는 자리 - 포트폴리오 첨부', () => {
  const EDGE = 1536

  it('긴 변이 상한이 되고 비율은 그대로다', () => {
    expect(fitLongEdge(4000, 3000, EDGE)).toEqual({ width: EDGE, height: 1152 })
    expect(fitLongEdge(3000, 4000, EDGE)).toEqual({ width: 1152, height: EDGE })
  })

  it('작은 사진은 늘리지 않는다 - 상한이지 목표가 아니다', () => {
    // 정본(`fitBox`)과 갈리는 자리다. 저쪽은 백본이 224를 요구해 채우지 않을 길이 없다.
    expect(fitLongEdge(800, 600, EDGE)).toEqual({ width: 800, height: 600 })
  })

  it('여백이 없다 - 사람이 보는 그림이다', () => {
    const box = fitLongEdge(4000, 3000, EDGE)
    expect(box.width / box.height).toBeCloseTo(4 / 3, 2)
  })

  it('비율이 극단이어도 한 변이 0이 되지 않는다', () => {
    expect(fitLongEdge(4000, 3, EDGE).height).toBe(1)
  })

  it('원본 크기가 이상하면 던진다', () => {
    expect(() => fitLongEdge(0, 100, EDGE)).toThrow()
  })
})

describe('정사각형 안에 넣는 자리', () => {
  it('가로가 긴 사진은 위아래에 여백이 남는다', () => {
    const box = fitBox(500, 400, SIZE)
    expect(box.width).toBe(SIZE)
    expect(box.height).toBe(179)
    expect(box.x).toBe(0)
    // 남는 높이를 반으로 나눠 가운데에 둔다.
    expect(box.y).toBe(Math.round((SIZE - 179) / 2))
  })

  it('세로가 긴 사진은 좌우에 여백이 남는다', () => {
    const box = fitBox(375, 500, SIZE)
    expect(box.height).toBe(SIZE)
    expect(box.width).toBe(168)
    expect(box.y).toBe(0)
    expect(box.x).toBe(Math.round((SIZE - 168) / 2))
  })

  it('정사각형은 꽉 찬다', () => {
    expect(fitBox(360, 360, SIZE)).toEqual({ x: 0, y: 0, width: SIZE, height: SIZE })
  })

  it('작은 사진은 늘린다 - 백본이 224를 요구하므로 채우지 않을 길이 없다', () => {
    const box = fitBox(100, 50, SIZE)
    expect(box.width).toBe(SIZE)
    expect(box.height).toBe(112)
  })

  it('비율이 극단이어도 한 변이 0이 되지 않는다', () => {
    expect(fitBox(4000, 3, SIZE).height).toBe(1)
  })

  it('원본 크기가 이상하면 던진다', () => {
    expect(() => fitBox(0, 100, SIZE)).toThrow()
    expect(() => fitBox(100, -1, SIZE)).toThrow()
  })
})

describe('범주 이름', () => {
  it('보통 이름은 받는다', () => {
    for (const name of ['개', '고양이', 'cat-dog', '산 사진', 'a.b', '1']) {
      expect(isValidCategoryName(name), name).toBe(true)
    }
  })

  it('밑줄로 시작하는 이름은 막는다 - 예약된 자리다', () => {
    expect(isValidCategoryName(IMAGE_UNLABELED)).toBe(false)
    expect(isValidCategoryName('_개')).toBe(false)
  })

  it('경로가 될 수 있는 이름은 막는다', () => {
    for (const name of ['개/고양이', '개\\고양이', '..', '.', 'a:b', 'a*b', 'a?b', 'a|b']) {
      expect(isValidCategoryName(name), name).toBe(false)
    }
  })

  it('빈 이름과 앞뒤 공백은 막는다', () => {
    expect(isValidCategoryName('')).toBe(false)
    expect(isValidCategoryName(' 개')).toBe(false)
    expect(isValidCategoryName('개 ')).toBe(false)
  })
})

describe('정본의 자리', () => {
  it('범주가 폴더가 된다', () => {
    expect(imageEntryPath('data', HASH, '고양이', WEBP)).toBe(`dataset/data/고양이/${HASH}.webp`)
    expect(imageEntryPath('test', HASH, '개', WEBP)).toBe(`dataset/test/개/${HASH}.webp`)
  })

  it('범주가 없으면 예약된 폴더로 간다', () => {
    expect(imageEntryPath('data', HASH, undefined, WEBP)).toBe(
      `dataset/data/${IMAGE_UNLABELED}/${HASH}.webp`,
    )
    expect(imageEntryPath('data', HASH, '', WEBP)).toBe(
      `dataset/data/${IMAGE_UNLABELED}/${HASH}.webp`,
    )
  })

  it('예측 데이터는 라벨이 없어 한 겹이다', () => {
    expect(imageEntryPath('predict', HASH, undefined, WEBP)).toBe(`dataset/predict/${HASH}.webp`)
    // 범주를 줘도 무시한다 - 그 자리에 라벨이라는 것이 없다.
    expect(imageEntryPath('predict', HASH, '개', WEBP)).toBe(`dataset/predict/${HASH}.webp`)
  })

  it('확장자는 형식이 정한다', () => {
    expect(imageEntryPath('data', HASH, '개', WEBP).endsWith(WEBP.extension)).toBe(true)
    // **jpg도 우리 모양이다** — WebP를 인코딩하지 못하는 브라우저에서 구운 정본이다
    // (open-decisions.md "정본은 WebP로 굽는다").
    expect(imageEntryPath('data', HASH, '개', JPEG)).toBe(`dataset/data/개/${HASH}.jpg`)
  })

  /**
   * **한 프로젝트에 두 확장자가 섞인다.** 학교 PC에서 webp로 올리고 집 아이폰에서 jpg로
   * 올린 경우다 — 한쪽만 읽으면 그 학생의 사진 절반이 화면에서 사라진다.
   */
  it('두 형식을 다 되읽는다', () => {
    for (const format of [WEBP, JPEG]) {
      const path = imageEntryPath('data', HASH, '개', format)
      expect(categoryOfEntry('data', path)).toBe('개')
      expect(canonicalFormatOfPath(path)).toBe(format)
    }
  })

  it('우리 확장자가 아니면 형식이 없다', () => {
    expect(canonicalFormatOfPath(`dataset/data/개/${HASH}.png`)).toBeNull()
  })
})

describe('경로에서 범주를 읽는다', () => {
  it('우리가 쓴 것을 그대로 되읽는다', () => {
    for (const category of ['개', '고양이', '산 사진']) {
      expect(categoryOfEntry('data', imageEntryPath('data', HASH, category, WEBP))).toBe(category)
    }
    expect(categoryOfEntry('data', imageEntryPath('data', HASH, undefined, WEBP))).toBe(
      IMAGE_UNLABELED,
    )
    expect(categoryOfEntry('predict', imageEntryPath('predict', HASH, undefined, WEBP))).toBe(
      IMAGE_UNLABELED,
    )
  })

  it('우리 모양이 아니면 null이다 - 조용히 엉뚱한 라벨을 만들지 않는다', () => {
    // 역할이 다르다
    expect(categoryOfEntry('test', imageEntryPath('data', HASH, '개', WEBP))).toBeNull()
    // 겹이 더 깊다 (사람이 zip을 고쳐 넣은 경우)
    expect(categoryOfEntry('data', `dataset/data/개/새끼/${HASH}.webp`)).toBeNull()
    // 범주 겹이 없다
    expect(categoryOfEntry('data', `dataset/data/${HASH}.webp`)).toBeNull()
    // 확장자가 다르다
    expect(categoryOfEntry('data', 'dataset/data/개/photo.png')).toBeNull()
    // 아예 다른 자리
    expect(categoryOfEntry('data', 'dataset/data.csv')).toBeNull()
  })
})
