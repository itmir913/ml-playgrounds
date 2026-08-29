/**
 * **테스트용 사진을 받는 규칙** (`data/image/test-set.ts`, `project/images.ts`).
 *
 * 규칙은 `open-decisions.md` "테스트용 zip (`split.method = 'provided'`)"이 갖는다.
 * 여기서 보는 것은 **관용적으로 받지 않는다**는 태도가 실제로 서 있는가다 — 모르는
 * 범주는 채점할 수 없고, 빠진 범주는 재현율이 정의되지 않는다.
 */

import { describe, expect, it } from 'vitest'

import { testSetBlockFor, testZipBlockFor } from '../src/data/image/test-set'
import { IMAGE_UNLABELED } from '../src/project/format'

const CATEGORIES = ['개', '고양이']

describe('자리 자체의 잠금', () => {
  it('범주가 서기 전에는 잠긴다 - 대조할 목록이 없다', () => {
    expect(testSetBlockFor([])).toEqual({ code: 'TEST_IMAGES_NEED_CATEGORIES' })
  })

  it('범주가 서면 열린다', () => {
    expect(testSetBlockFor(CATEGORIES)).toBeNull()
  })

  it('올린 사진 판정도 그 잠금을 먼저 지난다 - 열어 두면 올린 뒤에야 거절당한다', () => {
    expect(testZipBlockFor([], ['개'])).toEqual({ code: 'TEST_IMAGES_NEED_CATEGORIES' })
  })
})

describe('올린 사진 대조', () => {
  it('집합이 정확히 같으면 받는다', () => {
    expect(testZipBlockFor(CATEGORIES, ['고양이', '개', '개'])).toBeNull()
  })

  it('빠진 범주는 이름과 함께 거절한다 - 개수만 말하면 어느 폴더를 고칠지 모른다', () => {
    expect(testZipBlockFor(CATEGORIES, ['개'])).toEqual({
      code: 'TEST_IMAGES_CATEGORY_MISSING',
      params: { categories: '고양이' },
    })
  })

  it('모르는 범주는 다른 코드다 - 학생이 할 일이 "그 폴더를 빼라"로 다르다', () => {
    expect(testZipBlockFor(CATEGORIES, ['개', '고양이', '토끼'])).toEqual({
      code: 'TEST_IMAGES_CATEGORY_UNKNOWN',
      params: { categories: '토끼' },
    })
  })

  it('폴더 없는 사진은 범주 대조보다 먼저 잡는다 - 정답이 없으면 채점이 성립하지 않는다', () => {
    // 범주까지 함께 어긋나 있어도 이쪽을 말한다. 할 일이 "폴더로 묶어라"이기 때문이다.
    expect(testZipBlockFor(CATEGORIES, [IMAGE_UNLABELED, '토끼'])).toEqual({
      code: 'TEST_IMAGES_UNLABELED',
    })
  })

  it('빠진 것과 모르는 것이 함께면 빠진 쪽을 먼저 말한다', () => {
    expect(testZipBlockFor(CATEGORIES, ['개', '토끼'])).toEqual({
      code: 'TEST_IMAGES_CATEGORY_MISSING',
      params: { categories: '고양이' },
    })
  })
})
