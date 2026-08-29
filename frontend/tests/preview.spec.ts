/**
 * 전처리 미리보기 (`ml/preview.ts`).
 *
 * **여기가 틀리면 화면은 멀쩡하고 값만 옆 열 것이 된다.** 원-핫이 한 칸 밀려도 예외가
 * 안 나고, 학생은 "지역=서울이 1이네"를 그대로 믿는다 — 그래서 화면 밖으로 뺐다.
 *
 * **미리보기가 학습과 다른 답을 낼 수 없다는 것이 이 파일의 전제다.** `transform`을
 * 학습이 쓰는 그대로 부르므로, 여기서 확인할 것은 **묶는 자리**다.
 */

import { describe, expect, it } from 'vitest'

import { fitPreprocessor, type Dataset } from '../src/ml/preprocess'
import { PREVIEW_ROWS, preprocessPreview } from '../src/ml/preview'
import type { Preprocessing } from '../src/project/schema'

const ONEHOT: Preprocessing = { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' }

/** 수치 하나, 범주 하나(세 값), 그리고 결측이 든 열 하나. */
const dataset: Dataset = {
  columns: ['키', '지역', '몸무게', '이름'],
  rows: [
    ['170', '서울', '60', '가'],
    ['180', '부산', '70', '나'],
    ['160', '대구', '', '다'],
    ['175', '서울', '65', '라'],
    ['165', '부산', '55', '마'],
    ['185', '대구', '80', '바'],
    ['155', '서울', '50', '사'],
  ],
}

const FEATURES = ['키', '지역', '몸무게']
const TRAIN = [0, 1, 2, 3, 4, 5, 6]

function previewOf(preprocessing: Preprocessing, train: readonly number[] = TRAIN, limit?: number) {
  const preprocessor = fitPreprocessor(dataset, train, FEATURES, preprocessing)
  return preprocessPreview(
    dataset,
    preprocessor,
    train,
    preprocessing.categoricalEncoding,
    limit ?? PREVIEW_ROWS,
  )
}

describe('바뀐 표를 다섯 줄로 보인다', () => {
  it('다섯 줄만 준다 - 표를 훑는 자리는 데이터 화면이다', () => {
    const preview = previewOf(ONEHOT)
    expect(preview.rowNumbers).toHaveLength(PREVIEW_ROWS)
    for (const column of preview.columns) {
      expect(column.before).toHaveLength(PREVIEW_ROWS)
      for (const feature of column.features) expect(feature.values).toHaveLength(PREVIEW_ROWS)
    }
  })

  /**
   * **훈련 자리에서 가져온다.** 전처리기가 거기서만 적합되므로 다른 좌표계의 행을
   * 보여주면 "이 값이 어디서 나왔나"를 설명할 수 없다.
   */
  it('훈련 행을 원본 번호로 준다 - 띄엄띄엄한 것이 정상이다', () => {
    const preview = previewOf(ONEHOT, [1, 3, 6], 5)
    expect(preview.rowNumbers).toEqual([2, 4, 7])
  })

  /**
   * **이 검사가 이 파일의 이유다.** 특성을 원본 열에 붙이는 자리가 어긋나면 값이 통째로
   * 옆 열 것이 되는데, 화면에서는 아무 일도 안 일어난 것처럼 보인다.
   */
  it('원-핫으로 늘어난 특성이 자기 원본 열 아래에 묶인다', () => {
    const preview = previewOf(ONEHOT)
    const region = preview.columns.find((column) => column.name === '지역')

    expect(region?.features.map((feature) => feature.name)).toEqual([
      '지역=서울',
      '지역=부산',
      '지역=대구',
    ])
    // 첫 줄이 서울이므로 첫 특성만 1이다.
    expect(region?.features.map((feature) => feature.values[0])).toEqual([1, 0, 0])
    // 둘째 줄은 부산.
    expect(region?.features.map((feature) => feature.values[1])).toEqual([0, 1, 0])
  })

  it('수치 열은 특성 하나다', () => {
    const height = previewOf(ONEHOT).columns.find((column) => column.name === '키')
    expect(height?.features).toHaveLength(1)
    expect(height?.features[0]?.name).toBe('키')
    expect(height?.features[0]?.values[0]).toBe(170)
  })

  /** 순서 인코딩이면 범주 열도 특성 하나다. 폭 계산이 인코딩을 따라야 한다. */
  it('순서 인코딩에서는 범주 열도 한 칸이다', () => {
    const preview = previewOf({ ...ONEHOT, categoricalEncoding: 'ordinal' })
    const region = preview.columns.find((column) => column.name === '지역')
    expect(region?.features.map((feature) => feature.name)).toEqual(['지역'])
    // 뒤에 오는 열의 값이 밀리지 않았는지가 진짜로 보는 것이다.
    const weight = preview.columns.find((column) => column.name === '몸무게')
    expect(weight?.features[0]?.values[0]).toBe(60)
  })

  /**
   * **빠진 열도 자리를 지킨다.** 인코딩을 끈 학생이 방금 무엇을 잃었는지 봐야 한다 —
   * 표에서 지우면 그 열은 애초에 없었던 것처럼 보인다.
   */
  it('학습에서 빠진 열은 원본만 남기고 자리를 지킨다', () => {
    const preview = previewOf({ ...ONEHOT, categoricalEncoding: 'none' })
    const region = preview.columns.find((column) => column.name === '지역')

    expect(region?.excluded).toBe(true)
    expect(region?.features).toEqual([])
    expect(region?.before[0]).toBe('서울')
  })

  it('열 순서가 정본과 같다 - 학생이 데이터 화면에서 본 순서다', () => {
    const preview = previewOf({ ...ONEHOT, categoricalEncoding: 'none' })
    expect(preview.columns.map((column) => column.name)).toEqual(['키', '지역', '몸무게'])
  })

  /** 결측이 어디였는지가 보여야 대체값이 무엇을 채웠는지 읽힌다. */
  it('원본의 빈 칸은 빈 칸으로 두고, 채운 값은 특성 쪽에 있다', () => {
    const preview = previewOf(ONEHOT)
    const weight = preview.columns.find((column) => column.name === '몸무게')

    expect(weight?.before[2]).toBe('')
    // mean 대체라 평균이 들어간다. 빈 칸이 0으로 조용히 바뀌면 이 값이 0이 된다.
    expect(weight?.features[0]?.values[2]).toBeCloseTo(63.33, 1)
  })

  it('타깃과 안 고른 열은 아예 안 나온다', () => {
    expect(previewOf(ONEHOT).columns.map((column) => column.name)).not.toContain('이름')
  })
})

/**
 * **칸마다 값이 무엇인지 함께 내려준다** (2026-08-29 화면 실측 B-2·C-1).
 *
 * 화면이 자릿수를 어떻게 줄지가 이것으로 갈린다. 화면에서 다시 알아내면 규칙이 두 벌이
 * 되고, `scale`이 붙었는지는 전처리기만 안다.
 */
describe('그 칸의 값이 무엇인가', () => {
  it('스케일링을 안 걸면 수치는 그대로 지나간다', () => {
    const preview = previewOf(ONEHOT)
    const height = preview.columns.find((column) => column.name === '키')

    expect(height?.features[0]?.kind).toBe('raw')
    // 지나간 값이므로 원본과 같은 수다 - 화면은 이 칸을 원문과 같은 글자로 그린다.
    expect(height?.features[0]?.values[0]).toBe(170)
  })

  it('스케일링을 걸면 계산해 낸 값이 된다', () => {
    const preview = previewOf({ ...ONEHOT, scaling: 'standard' })
    const height = preview.columns.find((column) => column.name === '키')

    expect(height?.features[0]?.kind).toBe('scaled')
  })

  it('원-핫은 정수다', () => {
    const preview = previewOf(ONEHOT)
    const region = preview.columns.find((column) => column.name === '지역')

    expect(region?.features.length).toBeGreaterThan(1)
    for (const feature of region?.features ?? []) expect(feature.kind).toBe('code')
  })

  it('순서 인코딩도 정수다', () => {
    const preview = previewOf({ ...ONEHOT, categoricalEncoding: 'ordinal' })
    const region = preview.columns.find((column) => column.name === '지역')

    expect(region?.features[0]?.kind).toBe('code')
  })

  /**
   * **스케일링은 범주 열을 안 지난다** (`ml/preprocess.ts`의 `transform`). 여기가
   * 뒤집히면 원-핫의 0/1이 소수로 그려진다.
   */
  it('스케일링을 걸어도 범주 열은 정수 그대로다', () => {
    const preview = previewOf({ ...ONEHOT, scaling: 'standard' })
    const region = preview.columns.find((column) => column.name === '지역')

    for (const feature of region?.features ?? []) expect(feature.kind).toBe('code')
  })
})
