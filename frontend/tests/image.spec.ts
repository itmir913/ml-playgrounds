/**
 * 정본의 규칙 (mlpx-spec.md §1.2).
 *
 * **여기서 틀리면 화면에서는 안 보인다.** 경로가 어긋나면 `.mlpx`가 파이썬에서 안 열리고,
 * 이름 규칙이 새면 `개/고양이`라는 범주 하나가 폴더 두 겹이 되어 **사진이 조용히 다른
 * 라벨로 담긴다.** 굽는 것 자체(캔버스)는 워커라 여기서 안 덮인다.
 */

import { describe, expect, it } from 'vitest'

import {
  CANONICAL_EXTENSION,
  categoryOfEntry,
  fitBox,
  imageEntryPath,
  isValidCategoryName,
} from '../src/data/image/canonical'
import { IMAGE_UNLABELED } from '../src/project/format'

const SIZE = 224
const HASH = 'a'.repeat(64)

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
    expect(imageEntryPath('data', HASH, '고양이')).toBe(`dataset/data/고양이/${HASH}.jpg`)
    expect(imageEntryPath('test', HASH, '개')).toBe(`dataset/test/개/${HASH}.jpg`)
  })

  it('범주가 없으면 예약된 폴더로 간다', () => {
    expect(imageEntryPath('data', HASH)).toBe(`dataset/data/${IMAGE_UNLABELED}/${HASH}.jpg`)
    expect(imageEntryPath('data', HASH, '')).toBe(`dataset/data/${IMAGE_UNLABELED}/${HASH}.jpg`)
  })

  it('예측 데이터는 라벨이 없어 한 겹이다', () => {
    expect(imageEntryPath('predict', HASH)).toBe(`dataset/predict/${HASH}.jpg`)
    // 범주를 줘도 무시한다 - 그 자리에 라벨이라는 것이 없다.
    expect(imageEntryPath('predict', HASH, '개')).toBe(`dataset/predict/${HASH}.jpg`)
  })

  it('확장자는 언제나 같다', () => {
    expect(imageEntryPath('data', HASH, '개').endsWith(CANONICAL_EXTENSION)).toBe(true)
  })
})

describe('경로에서 범주를 읽는다', () => {
  it('우리가 쓴 것을 그대로 되읽는다', () => {
    for (const category of ['개', '고양이', '산 사진']) {
      expect(categoryOfEntry('data', imageEntryPath('data', HASH, category))).toBe(category)
    }
    expect(categoryOfEntry('data', imageEntryPath('data', HASH))).toBe(IMAGE_UNLABELED)
    expect(categoryOfEntry('predict', imageEntryPath('predict', HASH))).toBe(IMAGE_UNLABELED)
  })

  it('우리 모양이 아니면 null이다 - 조용히 엉뚱한 라벨을 만들지 않는다', () => {
    // 역할이 다르다
    expect(categoryOfEntry('test', imageEntryPath('data', HASH, '개'))).toBeNull()
    // 겹이 더 깊다 (사람이 zip을 고쳐 넣은 경우)
    expect(categoryOfEntry('data', `dataset/data/개/새끼/${HASH}.jpg`)).toBeNull()
    // 범주 겹이 없다
    expect(categoryOfEntry('data', `dataset/data/${HASH}.jpg`)).toBeNull()
    // 확장자가 다르다
    expect(categoryOfEntry('data', 'dataset/data/개/photo.png')).toBeNull()
    // 아예 다른 자리
    expect(categoryOfEntry('data', 'dataset/data.csv')).toBeNull()
  })
})
