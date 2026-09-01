/**
 * 전처리.
 *
 * 제일 중요한 것은 **파라미터가 훈련 데이터에서만 나오는가**다. 테스트 데이터가 섞이면 지표가
 * 조용히 부풀고, 학생은 그 숫자로 "이 모델이 제일 좋다"고 포트폴리오를 쓴다.
 * 화면에는 아무 이상도 안 보인다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import {
  PREPROCESSOR_FORMAT,
  detectKind,
  fitPreprocessor,
  missingColumns,
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
  throw new Error('it did not throw')
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

describe('훈련 데이터에서만 파라미터를 구한다', () => {
  it('테스트 데이터의 값이 평균에 섞이지 않는다', () => {
    // 4번 행의 키는 1000이다. 전체 평균은 332지만 훈련 데이터(0~2) 평균은 160이어야 한다.
    const fitted = fitPreprocessor(dataset, [0, 1, 2], features, preprocessing())
    const height = fitted.columns.find((column) => column.name === '키')
    expect(height?.fill).toBe(160)
  })

  it('테스트 데이터의 값이 스케일에 섞이지 않는다', () => {
    const fitted = fitPreprocessor(
      dataset,
      [0, 1, 2],
      features,
      preprocessing({ scaling: 'minmax' }),
    )
    const height = fitted.columns.find((column) => column.name === '키')
    // 훈련 데이터의 최소 150, 최대 170.
    expect(height?.scale).toEqual({ center: 150, spread: 20 })
  })

  it('테스트 데이터에만 있는 범주는 학습 범주에 들어가지 않는다', () => {
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
  // 훈련 데이터를 0·1·3행으로 잡으면 몸무게는 40·50·70이다.
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

  /**
   * **동점이면 먼저 나온 값이 이긴다** (R7 감사 B-7). 소스가 그 규약을 적어 두었는데
   * (*"Map이 삽입 순서를 지키므로 결정적이다"*) `>`를 `>=`로 바꿔 뒤엣것이 이기게 해도
   * 저장소 전체가 침묵했다.
   *
   * **결측 대체값이 조용히 다른 범주로 바뀌는 자리다.** 어느 쪽이 이기든 상관없는 것이
   * 아니라, **정해져 있어야** 같은 파일이 같은 답을 낸다.
   */
  it('최빈값이 동점이면 먼저 나온 값이 이긴다', () => {
    const tied: Dataset = {
      columns: ['지역'],
      rows: [['서울'], ['부산'], ['서울'], ['부산'], ['']],
    }
    const fitted = fitPreprocessor(tied, [0, 1, 2, 3, 4], ['지역'], preprocessing())
    expect(fitted.columns[0]?.fill).toBe('서울')
  })

  it('빈 칸만 결측이다 - N/A 같은 문자열은 값으로 둔다', () => {
    const withNa: Dataset = { columns: ['지역'], rows: [['N/A'], ['서울'], ['N/A']] }
    const fitted = fitPreprocessor(withNa, [0, 1, 2], ['지역'], preprocessing())
    expect(fitted.columns[0]?.categories).toEqual(['N/A', '서울'])
  })

  /**
   * **공백만 든 칸도 빈 칸이다** (`isMissing`의 `trim()`).
   *
   * 위의 검사는 **반대 방향만** 못 박는다 - 값이 값으로 남는지는 보고, 공백이 결측으로
   * 가는지는 안 봤다. 그래서 `trim()` 한 낱말을 떼도 저장소 2,254개가 전부 초록이었다
   * (2026-08-30 R12 감사 A-2). **엑셀·한셀이 만든 표에서 공백 칸은 드물지 않다.**
   *
   * 그 한 낱말에 갈래 넷이 달려 있어서 넷을 다 본다. 떼면 공백이 값이 되어 ①수치 열이
   * 범주로 뒤집히고(회귀 타깃이면 `TARGET_NOT_NUMERIC`) ②대체값이 오염되고
   * ③`missing: 'none'`이 더는 안 막고 ④그 행이 안 버려진다.
   */
  describe('공백만 든 칸도 결측이다', () => {
    const spaced: Dataset = { columns: ['점수'], rows: [['10'], ['  '], ['20'], ['30']] }

    it('수치 열이 공백 하나 때문에 범주로 뒤집히지 않는다', () => {
      expect(detectKind(['10', '  ', '20'])).toBe('numeric')
    })

    it('대체값이 공백을 뺀 나머지의 평균이다', () => {
      const fitted = fitPreprocessor(spaced, [0, 1, 2, 3], ['점수'], preprocessing())
      expect(fitted.columns[0]?.kind).toBe('numeric')
      expect(fitted.columns[0]?.fill).toBeCloseTo(20, 10)
    })

    it('missingColumns가 공백 칸을 센다 - none 전략이 여기 달려 있다', () => {
      expect(missingColumns(spaced, ['점수'])).toEqual([{ name: '점수', count: 1 }])
    })

    it("'drop'이 공백만 든 행을 버린다", () => {
      expect(usableRows(spaced, ['점수'], undefined, 'drop')).toEqual([0, 2, 3])
    })

    it('타깃이 공백이면 어떤 전략이든 그 행을 못 쓴다', () => {
      expect(usableRows(spaced, [], '점수', 'mean')).toEqual([0, 2, 3])
    })
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

  /**
   * **셋 다 본다** (R7 감사 B-6). 제목이 일반 명제인데 `standard` 하나만 돌리고 있었고,
   * `minmax`·`robust`의 `|| 1`을 지워도 저장소 전체가 침묵했다. 소스의 머리말도
   * `SCALE_BY_METHOD` 전체에 대해 말한다.
   */
  for (const scaling of ['standard', 'minmax', 'robust'] as const) {
    it(`값이 하나뿐인 열에서 0으로 나누지 않는다 - ${scaling}`, () => {
      const flat: Dataset = { columns: ['x'], rows: [['5'], ['5'], ['5']] }
      const fitted = fitPreprocessor(flat, [0, 1, 2], ['x'], preprocessing({ scaling }))
      const matrix = transform(fitted, flat, [0, 1, 2], 'onehot')
      expect(matrix.flat().every((value) => Number.isFinite(value))).toBe(true)
    })
  }

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

  it('훈련 데이터에 없던 범주는 onehot에서 전부 0이다', () => {
    const fitted = fitPreprocessor(dataset, [0, 1, 2], features, preprocessing())
    // 4번 행의 지역은 '대구'로 훈련 데이터에 없다.
    expect(transform(fitted, dataset, [4], 'onehot')[0]?.slice(2)).toEqual([0, 0])
  })

  it('훈련 데이터에 없던 범주는 ordinal에서 -1이다', () => {
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

describe('범위 밖 행 번호', () => {
  it('없는 행을 가리키면 시끄럽게 실패한다', () => {
    // 조용히 빈 행으로 채우면 결측 대체값이 들어가 **그럴듯한 가짜 행**이 되고,
    // 학습도 예측도 에러 없이 진행된다. 학생은 그 숫자로 포트폴리오를 쓴다.
    // 참조형 모델의 예측과 재실행 대조가 파일에 적힌 번호로 이 함수를 부른다.
    const fitted = fitPreprocessor(dataset, [0, 1, 2, 3], features, preprocessing())
    const code = codeOf(() => transform(fitted, dataset, [0, 999], 'onehot'))
    expect(code).toBe('SPLIT_INDEX_OUT_OF_RANGE')
  })

  it('경계값은 통과한다 - 마지막 행은 정상이다', () => {
    const fitted = fitPreprocessor(dataset, [0, 1, 2, 3], features, preprocessing())
    const last = dataset.rows.length - 1
    expect(transform(fitted, dataset, [last], 'onehot')).toHaveLength(1)
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

  it('훈련 데이터에서 통째로 빈 열은 FEATURE_ALL_MISSING', () => {
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

/**
 * **사분위의 선형 보간을 무는 검사.**
 *
 * `quantile`의 보간을 지우고 `lower`만 돌려줘도 저장소 전체 1,820개 검사가 통과했다
 * (V11 R2 감사 B-6). 원인 둘 다 픽스처가 무뎌서다 — 위 `median` 검사는 값이 셋(40·50·70)이라
 * 중앙값이 정확히 가운뎃값에 떨어져 보간이 안 돌고, `robust`는 **수치를 못 박은 검사가 아예
 * 없었다.** `lifecycle.spec.ts`가 `robust`로 왕복을 돌지만 그건 같은 함수로 fit하고 같은
 * 함수로 transform하므로 사분위 정의가 무엇이든 자기 자신과는 언제나 맞는다.
 *
 * **기대값은 numpy·pandas의 기본(`linear`)에서 나왔다** — 그 주장이 `quantile`의 주석에 있고
 * `CLAUDE.md` §2("파이썬 관행을 따른다")가 걸리는 자리다.
 * `np.percentile([1,2,3,4], [25,50,75]) == [1.75, 2.5, 3.25]`.
 */
describe('사분위 - 짝수 개에서 보간이 돈다', () => {
  const four: Dataset = {
    columns: ['값'],
    rows: [['1'], ['2'], ['3'], ['4']],
  }
  const all = [0, 1, 2, 3]

  it('median 대체값이 두 값 사이로 간다 - 2.5이지 2가 아니다', () => {
    const fitted = fitPreprocessor(four, all, ['값'], preprocessing({ missing: 'median' }))
    expect(fitted.columns[0]?.fill).toBeCloseTo(2.5, 10)
  })

  it('robust의 중심은 중앙값, 폭은 사분위 범위다 - numpy와 같은 값이다', () => {
    const fitted = fitPreprocessor(
      four,
      all,
      ['값'],
      preprocessing({ missing: 'mean', scaling: 'robust' }),
    )
    // center = q50 = 2.5, spread = q75 - q25 = 3.25 - 1.75 = 1.5
    expect(fitted.columns[0]?.scale?.center).toBeCloseTo(2.5, 10)
    expect(fitted.columns[0]?.scale?.spread).toBeCloseTo(1.5, 10)
  })

  it('그 값으로 실제 행이 옮겨진다', () => {
    const fitted = fitPreprocessor(
      four,
      all,
      ['값'],
      preprocessing({ missing: 'mean', scaling: 'robust' }),
    )
    const moved = transform(fitted, four, all, 'onehot')
    // (1-2.5)/1.5 = -1, (4-2.5)/1.5 = 1. 보간이 죽으면 둘 다 다른 값이 된다.
    expect(moved[0]?.[0]).toBeCloseTo(-1, 10)
    expect(moved[3]?.[0]).toBeCloseTo(1, 10)
  })
})
