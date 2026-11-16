/**
 * **훈련 데이터에서 구하는 값이 하나라도 있는 전처리인가** (`ml/preprocess.ts`의 `fitsAnyBasis`).
 *
 * 프로젝트 흐름도가 "훈련 데이터 기준" 화살표를 그릴지 이것으로 정한다(`architecture.md` §8.22).
 * 거짓이면 상자가 점선이고 화살표가 없다 — **구할 값이 없는 전처리에 기준 화살표를 그으면 "기준을
 * 구했다"고 가르치는 셈이라** 두 방향을 다 문다. 그리고 `fitPreprocessor`가 실제로 값을 구하는
 * 경우와 어긋나지 않는지 마지막에 대조한다.
 */

import { describe, expect, it } from 'vitest'

import { fitPreprocessor, fitsAnyBasis, type ColumnKind, type Dataset } from '../src/ml/preprocess'
import type { Preprocessing } from '../src/project/schema'

const NONE: Preprocessing = { missing: 'drop', scaling: 'none', categoricalEncoding: 'none' }

function kinds(...entries: [string, ColumnKind][]): { name: string; kind: ColumnKind }[] {
  return entries.map(([name, kind]) => ({ name, kind }))
}

const NUMERIC = kinds(['꽃받침 길이', 'numeric'], ['꽃잎 길이', 'numeric'])
const MIXED = kinds(['꽃받침 길이', 'numeric'], ['색', 'categorical'])

describe('기준이 없는 전처리', () => {
  it('붓꽃처럼 수치만 있고 아무것도 구하지 않으면 거짓이다', () => {
    // 새 프로젝트의 기본값(`tabularInitialSettings`)이 이 모양이다 — 결측은 행을 버리고 스케일링은 꺼져 있다.
    const initial: Preprocessing = {
      missing: 'drop',
      scaling: 'none',
      categoricalEncoding: 'onehot',
    }
    expect(fitsAnyBasis(initial, NUMERIC)).toBe(false)
  })

  it('결측을 0으로 채우는 것은 상수라 구하는 값이 아니다', () => {
    expect(fitsAnyBasis({ ...NONE, missing: 'zero' }, NUMERIC)).toBe(false)
    expect(fitsAnyBasis({ ...NONE, missing: 'none' }, NUMERIC)).toBe(false)
  })

  it('스케일링이 켜져 있어도 수치 특성이 하나도 없으면 거짓이다', () => {
    const onlyCategories = kinds(['색', 'categorical'])
    expect(fitsAnyBasis({ ...NONE, scaling: 'standard' }, onlyCategories)).toBe(false)
    expect(fitsAnyBasis({ ...NONE, scaling: 'standard' }, [])).toBe(false)
  })

  it('범주 특성이 있어도 인코딩이 꺼져 있으면 거짓이다', () => {
    expect(fitsAnyBasis(NONE, MIXED)).toBe(false)
  })
})

describe('기준이 있는 전처리', () => {
  it.each(['mean', 'median', 'mostFrequent'] as const)('결측을 %s로 채운다', (missing) => {
    expect(fitsAnyBasis({ ...NONE, missing }, NUMERIC)).toBe(true)
  })

  it.each(['standard', 'minmax', 'robust'] as const)(
    '수치 특성이 있고 %s 스케일링이 켜져 있다',
    (scaling) => {
      expect(fitsAnyBasis({ ...NONE, scaling }, NUMERIC)).toBe(true)
    },
  )

  it.each(['onehot', 'ordinal'] as const)('범주 특성이 있고 %s 인코딩이 켜져 있다', (encoding) => {
    expect(fitsAnyBasis({ ...NONE, categoricalEncoding: encoding }, MIXED)).toBe(true)
  })

  it('결측 전략은 특성이 없어도 읽는다 — 값이 구해질 자리는 전략이 정한다', () => {
    expect(fitsAnyBasis({ ...NONE, missing: 'mean' }, [])).toBe(true)
  })
})

describe('열마다 덮어쓴 인코딩', () => {
  it('공통값이 꺼져 있어도 한 열이 켜져 있으면 참이다', () => {
    const preprocessing: Preprocessing = {
      ...NONE,
      columns: { 색: { categoricalEncoding: 'onehot' } },
    }
    expect(fitsAnyBasis(preprocessing, MIXED)).toBe(true)
  })

  it('공통값이 켜져 있어도 범주 열마다 꺼 두었으면 거짓이다', () => {
    const preprocessing: Preprocessing = {
      ...NONE,
      categoricalEncoding: 'onehot',
      columns: { 색: { categoricalEncoding: 'none' } },
    }
    expect(fitsAnyBasis(preprocessing, MIXED)).toBe(false)
  })

  it('다른 열의 덮어쓰기는 이 열을 켜지 않는다', () => {
    const preprocessing: Preprocessing = {
      ...NONE,
      columns: { 맛: { categoricalEncoding: 'onehot' } },
    }
    expect(fitsAnyBasis(preprocessing, MIXED)).toBe(false)
  })
})

describe('fitPreprocessor와 어긋나지 않는다', () => {
  const dataset: Dataset = {
    columns: ['키', '색', '라벨'],
    rows: [
      ['150', '빨강', 'a'],
      ['160', '파랑', 'b'],
      ['170', '빨강', 'a'],
      ['180', '파랑', 'b'],
    ],
  }
  const train = [0, 1, 2, 3]
  const featureKinds = kinds(['키', 'numeric'], ['색', 'categorical'])

  /** 실제로 훈련 데이터에서 구한 것이 있는가 — 채울 값, 스케일, 범주 목록 중 하나라도. */
  function fittedSomething(preprocessing: Preprocessing): boolean {
    const fitted = fitPreprocessor(dataset, train, ['키', '색'], preprocessing)
    return fitted.columns.some(
      (column) =>
        (column.fill !== undefined && preprocessing.missing !== 'zero') ||
        column.scale !== undefined ||
        column.kind === 'categorical',
    )
  }

  const CASES: [string, Preprocessing][] = [
    ['기본', { missing: 'drop', scaling: 'none', categoricalEncoding: 'onehot' }],
    ['평균', { missing: 'mean', scaling: 'none', categoricalEncoding: 'onehot' }],
    ['표준화', { missing: 'drop', scaling: 'standard', categoricalEncoding: 'onehot' }],
    ['순서 인코딩', { missing: 'drop', scaling: 'none', categoricalEncoding: 'ordinal' }],
  ]

  it.each(CASES)('%s: 구한 것이 있으면 참이다', (_name, preprocessing) => {
    expect(fitsAnyBasis(preprocessing, featureKinds)).toBe(fittedSomething(preprocessing))
    expect(fitsAnyBasis(preprocessing, featureKinds)).toBe(true)
  })

  it('범주 특성이 빠지는 조합은 구한 것이 없다', () => {
    const preprocessing: Preprocessing = {
      missing: 'drop',
      scaling: 'none',
      categoricalEncoding: 'none',
    }
    const fitted = fitPreprocessor(dataset, train, ['키'], preprocessing)
    expect(
      fitted.columns.every((column) => column.scale === undefined && column.fill === undefined),
    ).toBe(true)
    expect(fitsAnyBasis(preprocessing, kinds(['키', 'numeric']))).toBe(false)
  })
})
