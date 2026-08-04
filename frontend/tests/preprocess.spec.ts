/**
 * 전처리.
 *
 * 제일 중요한 것은 **파라미터가 학습셋에서만 나오는가**다. 평가셋이 섞이면 지표가
 * 조용히 부풀고, 학생은 그 숫자로 "이 모델이 제일 좋다"고 포트폴리오를 쓴다.
 * 화면에는 아무 이상도 안 보인다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import {
  PREPROCESSOR_FORMAT,
  fitPreprocessor,
  targetValues,
  transform,
  usableRows,
  type Dataset,
} from '../src/ml/preprocess'
import type { Preprocessing } from '../src/project/schema'

const preprocessing = (overrides: Partial<Preprocessing> = {}): Preprocessing => ({
  missing: 'mean',
  scaling: 'none',
  categoricalEncoding: 'onehot',
  ...overrides,
})

/** 한글 컬럼명과 결측이 든 표. 교실에서 실제로 들어오는 모양이다. */
const dataset: Dataset = {
  columns: ['키', '몸무게', '지역', '품종'],
  rows: [
    ['150', '40', '서울', 'a'],
    ['160', '50', '부산', 'b'],
    ['170', '', '서울', 'a'],
    ['180', '70', '', 'b'],
    ['1000', '80', '대구', ''],
  ],
}

const features = ['키', '몸무게', '지역']

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (isClientError(error)) return error.code
    throw error
  }
  throw new Error('던지지 않았다')
}

describe('usableRows', () => {
  it('타깃이 빈 행은 어떤 전략이든 버린다 - 정답을 모르면 채점도 못 한다', () => {
    expect(usableRows(dataset, features, '품종', 'mean')).toEqual([0, 1, 2, 3])
  })

  it("'drop'이면 특성이 빈 행도 버린다", () => {
    expect(usableRows(dataset, features, '품종', 'drop')).toEqual([0, 1])
  })

  it('타깃이 없으면 특성만 본다 - 군집화에는 타깃이 없다', () => {
    expect(usableRows(dataset, features, undefined, 'drop')).toEqual([0, 1, 4])
  })
})

describe('학습셋에서만 파라미터를 구한다', () => {
  it('평가셋의 값이 평균에 섞이지 않는다', () => {
    // 4번 행의 키는 1000이다. 전체 평균은 332지만 학습셋(0~2) 평균은 160이어야 한다.
    const fitted = fitPreprocessor(dataset, [0, 1, 2], features, preprocessing())
    const height = fitted.columns.find((column) => column.name === '키')
    expect(height?.fill).toBe(160)
  })

  it('평가셋의 값이 스케일에 섞이지 않는다', () => {
    const fitted = fitPreprocessor(
      dataset,
      [0, 1, 2],
      features,
      preprocessing({ scaling: 'minmax' }),
    )
    const height = fitted.columns.find((column) => column.name === '키')
    // 학습셋의 최소 150, 최대 170.
    expect(height?.scale).toEqual({ center: 150, spread: 20 })
  })

  it('평가셋에만 있는 범주는 학습 범주에 들어가지 않는다', () => {
    const fitted = fitPreprocessor(dataset, [0, 1, 2], features, preprocessing())
    const region = fitted.columns.find((column) => column.name === '지역')
    expect(region?.categories).toEqual(['서울', '부산'])
  })
})

describe('자료형 판정', () => {
  it('숫자로 읽히면 수치, 아니면 범주다', () => {
    const fitted = fitPreprocessor(dataset, [0, 1, 2, 3], features, preprocessing())
    expect(fitted.columns.map((column) => [column.name, column.kind])).toEqual([
      ['키', 'numeric'],
      ['몸무게', 'numeric'],
      ['지역', 'categorical'],
    ])
  })
})

describe('결측 대체', () => {
  // 학습셋을 0·1·3행으로 잡으면 몸무게는 40·50·70이다.
  const strategies: [Preprocessing['missing'], number][] = [
    ['mean', 160 / 3],
    ['median', 50],
    ['zero', 0],
  ]

  for (const [missing, expected] of strategies) {
    it(`${missing} - 몸무게 40·50·70에서 ${expected.toFixed(2)}`, () => {
      const fitted = fitPreprocessor(dataset, [0, 1, 3], features, preprocessing({ missing }))
      expect(fitted.columns.find((column) => column.name === '몸무게')?.fill).toBeCloseTo(
        expected,
        10,
      )
    })
  }

  it("'drop'이면 대체값을 두지 않는다 - 그 행은 이미 빠졌다", () => {
    const fitted = fitPreprocessor(dataset, [0, 1], features, preprocessing({ missing: 'drop' }))
    expect(fitted.columns.every((column) => column.fill === undefined)).toBe(true)
  })

  it('범주 열에는 수치 전략이 와도 최빈값을 쓴다', () => {
    const fitted = fitPreprocessor(dataset, [0, 1, 2], features, preprocessing({ missing: 'mean' }))
    expect(fitted.columns.find((column) => column.name === '지역')?.fill).toBe('서울')
  })

  it('빈 칸만 결측이다 - N/A 같은 문자열은 값으로 둔다', () => {
    const withNa: Dataset = { columns: ['지역'], rows: [['N/A'], ['서울'], ['N/A']] }
    const fitted = fitPreprocessor(withNa, [0, 1, 2], ['지역'], preprocessing())
    expect(fitted.columns[0]?.categories).toEqual(['N/A', '서울'])
  })
})

describe('스케일링', () => {
  const numbers: Dataset = {
    columns: ['x'],
    rows: [['0'], ['2'], ['4'], ['6'], ['8']],
  }
  const all = [0, 1, 2, 3, 4]

  it('standard는 평균을 빼고 표준편차로 나눈다', () => {
    const fitted = fitPreprocessor(numbers, all, ['x'], preprocessing({ scaling: 'standard' }))
    expect(fitted.columns[0]?.scale?.center).toBe(4)
    expect(fitted.columns[0]?.scale?.spread).toBeCloseTo(2.8284, 4)
  })

  it('minmax는 0과 1 사이로 보낸다', () => {
    const fitted = fitPreprocessor(numbers, all, ['x'], preprocessing({ scaling: 'minmax' }))
    const matrix = transform(fitted, numbers, all, 'onehot')
    expect(matrix.map((row) => row[0])).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('값이 하나뿐인 열에서 0으로 나누지 않는다 - 행렬 전체가 NaN이 된다', () => {
    const flat: Dataset = { columns: ['x'], rows: [['5'], ['5'], ['5']] }
    const fitted = fitPreprocessor(flat, [0, 1, 2], ['x'], preprocessing({ scaling: 'standard' }))
    const matrix = transform(fitted, flat, [0, 1, 2], 'onehot')
    expect(matrix.flat().every((value) => Number.isFinite(value))).toBe(true)
  })

  it("scaling이 'none'이면 값을 그대로 둔다", () => {
    const fitted = fitPreprocessor(numbers, all, ['x'], preprocessing({ scaling: 'none' }))
    expect(transform(fitted, numbers, all, 'onehot').map((row) => row[0])).toEqual([0, 2, 4, 6, 8])
  })
})

describe('범주 인코딩', () => {
  it('onehot은 범주마다 열을 만들고 이름에 범주를 붙인다', () => {
    const fitted = fitPreprocessor(dataset, [0, 1, 2, 3], features, preprocessing())
    expect(fitted.featureNames).toEqual(['키', '몸무게', '지역=서울', '지역=부산'])

    const matrix = transform(fitted, dataset, [0, 1], 'onehot')
    expect(matrix[0]?.slice(2)).toEqual([1, 0])
    expect(matrix[1]?.slice(2)).toEqual([0, 1])
  })

  it('ordinal은 열 하나로 두고 순서를 번호로 쓴다', () => {
    const options = preprocessing({ categoricalEncoding: 'ordinal' })
    const fitted = fitPreprocessor(dataset, [0, 1, 2, 3], features, options)
    expect(fitted.featureNames).toEqual(['키', '몸무게', '지역'])
    expect(transform(fitted, dataset, [0, 1], 'ordinal').map((row) => row[2])).toEqual([0, 1])
  })

  it('학습셋에 없던 범주는 onehot에서 전부 0이다', () => {
    const fitted = fitPreprocessor(dataset, [0, 1, 2], features, preprocessing())
    // 4번 행의 지역은 '대구'로 학습셋에 없다.
    expect(transform(fitted, dataset, [4], 'onehot')[0]?.slice(2)).toEqual([0, 0])
  })

  it('학습셋에 없던 범주는 ordinal에서 -1이다', () => {
    const options = preprocessing({ categoricalEncoding: 'ordinal' })
    const fitted = fitPreprocessor(dataset, [0, 1, 2], features, options)
    expect(transform(fitted, dataset, [4], 'ordinal')[0]?.[2]).toBe(-1)
  })

  it("'none'이면 범주 열을 빼되 뺐다고 남긴다 - 조용히 버리지 않는다", () => {
    const options = preprocessing({ categoricalEncoding: 'none' })
    const fitted = fitPreprocessor(dataset, [0, 1, 2, 3], features, options)

    expect(fitted.featureNames).toEqual(['키', '몸무게'])
    expect(fitted.excludedColumns).toEqual([{ name: '지역', reason: 'notEncodable' }])
  })
})

describe('전처리기는 데이터다', () => {
  it('JSON으로 나갔다 돌아와도 같은 행렬을 만든다 - .mlpx에 이대로 담긴다', () => {
    const fitted = fitPreprocessor(dataset, [0, 1, 2, 3], features, preprocessing())
    const revived = JSON.parse(JSON.stringify(fitted)) as typeof fitted

    expect(revived.format).toBe(PREPROCESSOR_FORMAT)
    expect(transform(revived, dataset, [0, 1, 2, 3], 'onehot')).toEqual(
      transform(fitted, dataset, [0, 1, 2, 3], 'onehot'),
    )
  })
})

describe('쓸 수 없는 열', () => {
  it('없는 열을 고르면 COLUMN_NOT_FOUND', () => {
    const code = codeOf(() => fitPreprocessor(dataset, [0, 1], ['없는열'], preprocessing()))
    expect(code).toBe('COLUMN_NOT_FOUND')
  })

  it('학습셋에서 통째로 빈 열은 FEATURE_ALL_MISSING', () => {
    const code = codeOf(() => fitPreprocessor(dataset, [2], ['몸무게'], preprocessing()))
    expect(code).toBe('FEATURE_ALL_MISSING')
  })

  it('남는 특성이 하나도 없으면 FEATURE_NOT_SELECTED', () => {
    const options = preprocessing({ categoricalEncoding: 'none' })
    const code = codeOf(() => fitPreprocessor(dataset, [0, 1], ['지역'], options))
    expect(code).toBe('FEATURE_NOT_SELECTED')
  })
})

describe('targetValues', () => {
  it('타깃 값을 문자열 그대로 뽑는다', () => {
    expect(targetValues(dataset, [0, 1, 2, 3], '품종')).toEqual(['a', 'b', 'a', 'b'])
  })

  it('없는 열이면 COLUMN_NOT_FOUND', () => {
    expect(codeOf(() => targetValues(dataset, [0], '없는열'))).toBe('COLUMN_NOT_FOUND')
  })
})
