/**
 * 열마다의 전처리 (open-decisions.md 116, #45).
 *
 * 공통값을 두고 필요한 열만 덮어쓴다 — 범주형 인코딩과 순서 인코딩의 범주 순서. 여기서 지키는 것:
 * 해석 함수 하나, 섞인 인코딩의 특성 이름·변환·예측, 지정 순서의 번호(sklearn과 같음), 지정 순서에
 * 없는 값의 거절, 옛 `mlpx-preprocess-v1` 읽기, 덮어쓰기를 고치는 순수 함수, 가상 목록의 창.
 */

import { describe, expect, it } from 'vitest'

import { summarizeColumns } from '../src/data/columns'
import { isClientError } from '../src/errors'
import {
  dictionaryOrder,
  moveCategory,
  overrideOf,
  withColumnOverride,
} from '../src/ml/column-override'
import { inputVector } from '../src/ml/predict'
import {
  encodingFromFitted,
  encodingFromSettings,
  estimatedFeatureWidth,
  experimentPreprocessor,
  fitPreprocessor,
  parsePreprocessor,
  PREPROCESSOR_FORMAT,
  resolveColumnPreprocessing,
  transform,
  type Dataset,
} from '../src/ml/preprocess'
import { columnPlan } from '../src/ml/selection'
import type { Preprocessing } from '../src/project/schema'
import { virtualWindow } from '../src/virtual-window'

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return isClientError(error) ? error.code : `unexpected: ${String(error)}`
  }
  return 'no error'
}

const DATASET: Dataset = {
  columns: ['grade', 'region', 'score'],
  rows: [
    ['상', '서울', '90'],
    ['중', '부산', '70'],
    ['하', '서울', '50'],
    ['중', '부산', '72'],
    ['상', '서울', '88'],
  ],
}
const ROWS = [0, 1, 2, 3, 4]
const FEATURES = ['grade', 'region', 'score']

const shared = (patch: Partial<Preprocessing> = {}): Preprocessing => ({
  missing: 'drop',
  scaling: 'none',
  categoricalEncoding: 'onehot',
  ...patch,
})

/** 등급은 순서 인코딩(하 < 중 < 상), 지역은 공통값(원-핫). */
const MIXED = shared({
  columns: { grade: { categoricalEncoding: 'ordinal', categories: ['하', '중', '상'] } },
})

describe('해석 함수 하나', () => {
  it('덮어쓰지 않은 열은 공통값이다', () => {
    expect(resolveColumnPreprocessing(MIXED, 'region')).toEqual({ categoricalEncoding: 'onehot' })
  })

  it('덮어쓴 열은 그 값이고, 순서는 순서 인코딩일 때만 있다', () => {
    expect(resolveColumnPreprocessing(MIXED, 'grade')).toEqual({
      categoricalEncoding: 'ordinal',
      categories: ['하', '중', '상'],
    })
    const onehot = shared({
      columns: { grade: { categoricalEncoding: 'onehot', categories: ['하'] } },
    })
    // 저장은 남고 해석에서만 무시한다(규칙 9).
    expect(resolveColumnPreprocessing(onehot, 'grade')).toEqual({ categoricalEncoding: 'onehot' })
  })

  it('공통값이 순서 인코딩이면 인코딩을 안 덮어도 순서가 쓰인다', () => {
    const p = shared({
      categoricalEncoding: 'ordinal',
      columns: { grade: { categories: ['하', '중', '상'] } },
    })
    expect(resolveColumnPreprocessing(p, 'grade').categories).toEqual(['하', '중', '상'])
  })

  it('열 이름이 __proto__여도 덮어쓰기로 읽지 않는다', () => {
    expect(resolveColumnPreprocessing(shared(), '__proto__')).toEqual({
      categoricalEncoding: 'onehot',
    })
  })
})

describe('섞인 인코딩', () => {
  const fitted = fitPreprocessor(DATASET, ROWS, FEATURES, MIXED)

  it('열마다 인코딩과 순서 지정 여부를 전처리기가 든다', () => {
    expect(fitted.format).toBe(PREPROCESSOR_FORMAT)
    expect(fitted.columns).toEqual([
      {
        name: 'grade',
        kind: 'categorical',
        categories: ['하', '중', '상'],
        encoding: 'ordinal',
        orderSpecified: true,
      },
      {
        name: 'region',
        kind: 'categorical',
        categories: ['부산', '서울'],
        encoding: 'onehot',
        orderSpecified: false,
      },
      { name: 'score', kind: 'numeric' },
    ])
    expect(fitted.featureNames).toEqual(['grade', 'region=부산', 'region=서울', 'score'])
  })

  /**
   * sklearn `OrdinalEncoder(categories=[['하', '중', '상']])`은 값의 **목록 안 자리**를 번호로 준다 —
   * `fit_transform([['상'], ['중'], ['하']])`가 `[[2], [1], [0]]`이다. 원-핫은 정렬한 범주의 차례다.
   */
  it('지정 순서의 번호가 sklearn OrdinalEncoder(categories=...)와 같다', () => {
    expect(transform(fitted, DATASET, [0, 1, 2])).toEqual([
      [2, 0, 1, 90],
      [1, 1, 0, 70],
      [0, 0, 1, 50],
    ])
  })

  it('예측 입력 한 줄이 학습 행과 같은 벡터다', () => {
    expect(inputVector(fitted, { grade: '중', region: '부산', score: '70' })).toEqual(
      transform(fitted, DATASET, [1])[0],
    )
  })

  it('미리 센 특성 수가 전처리기의 특성 수와 같다', () => {
    const summaries = summarizeColumns(DATASET)
    expect(estimatedFeatureWidth(summaries, FEATURES, encodingFromSettings(MIXED))).toBe(
      fitted.featureNames.length,
    )
    // 전처리기가 있으면 거기서 읽는다(규칙 10) — 같은 답이다.
    expect(estimatedFeatureWidth(summaries, FEATURES, encodingFromFitted(fitted, shared()))).toBe(
      fitted.featureNames.length,
    )
  })

  it('공통이 하지 않음이어도 순서 인코딩으로 덮은 열은 들어간다', () => {
    const p = shared({
      categoricalEncoding: 'none',
      columns: { grade: { categoricalEncoding: 'ordinal' } },
    })
    const only = fitPreprocessor(DATASET, ROWS, FEATURES, p)
    expect(only.featureNames).toEqual(['grade', 'score'])
    expect(only.excludedColumns).toEqual([{ name: 'region', reason: 'notEncodable' }])

    const plan = columnPlan({
      columns: summarizeColumns(DATASET),
      rowCount: DATASET.rows.length,
      taskType: 'clustering',
      target: undefined,
      features: FEATURES,
      preprocessing: p,
    })
    const notes = Object.fromEntries(
      plan.columns.map((c) => [c.summary.name, c.featureNote ?? null]),
    )
    expect(notes).toEqual({ grade: null, region: 'notEncodable', score: null })
  })
})

describe('지정 순서에 없는 값', () => {
  it('훈련 데이터의 값이 지정 순서에 없으면 학습 전에 거절한다', () => {
    const p = shared({
      columns: { grade: { categoricalEncoding: 'ordinal', categories: ['하', '중'] } },
    })
    try {
      fitPreprocessor(DATASET, ROWS, FEATURES, p)
      expect.unreachable('던졌어야 한다')
    } catch (error) {
      expect(isClientError(error) && error.code).toBe('FEATURE_CATEGORY_NOT_IN_ORDER')
      expect(isClientError(error) && error.params).toEqual({ feature: 'grade', value: '상' })
    }
  })

  it('지정 순서에만 있는 값은 받는다 - sklearn과 같다', () => {
    const p = shared({
      columns: {
        grade: { categoricalEncoding: 'ordinal', categories: ['최하', '하', '중', '상'] },
      },
    })
    const fitted = fitPreprocessor(DATASET, ROWS, FEATURES, p)
    expect(transform(fitted, DATASET, [2])[0]?.[0]).toBe(1)
  })

  it('원-핫이면 저장된 순서를 안 보므로 거절하지 않는다', () => {
    const p = shared({ columns: { grade: { categoricalEncoding: 'onehot', categories: ['하'] } } })
    expect(codeOf(() => fitPreprocessor(DATASET, ROWS, FEATURES, p))).toBe('no error')
  })
})

describe('옛 mlpx-preprocess-v1 읽기', () => {
  const v1 = {
    format: 'mlpx-preprocess-v1',
    columns: [
      { name: 'grade', kind: 'categorical', categories: ['상', '중', '하'] },
      { name: 'score', kind: 'numeric' },
    ],
    featureNames: ['grade', 'score'],
    excludedColumns: [],
  }

  it('실험의 공통 인코딩으로 열을 채워 v2로 본다 - 순서는 지정한 적이 없다', () => {
    const read = parsePreprocessor(v1, 'ordinal')
    expect(read.format).toBe(PREPROCESSOR_FORMAT)
    expect(read.columns[0]).toEqual({
      name: 'grade',
      kind: 'categorical',
      categories: ['상', '중', '하'],
      encoding: 'ordinal',
      orderSpecified: false,
    })
    // 적힌 순서 그대로 번호를 준다 — v1 때와 같은 값이다.
    expect(transform(read, DATASET, [2])).toEqual([[2, 50]])
  })

  it('범주 열이 있는데 채울 공통 인코딩이 없으면 깨진 파일이다', () => {
    expect(codeOf(() => parsePreprocessor(v1))).toBe('MODEL_FILE_INVALID')
    expect(codeOf(() => parsePreprocessor(v1, 'none'))).toBe('MODEL_FILE_INVALID')
  })

  it('범주 열이 없으면 재료 없이도 읽는다 - 사진 실험이 그렇다', () => {
    const numeric = {
      ...v1,
      columns: [{ name: 'score', kind: 'numeric' }],
      featureNames: ['score'],
    }
    expect(parsePreprocessor(numeric).columns).toEqual([{ name: 'score', kind: 'numeric' }])
  })

  it('v2인데 범주 열에 인코딩이 없으면 깨진 파일이다', () => {
    const broken = { ...v1, format: PREPROCESSOR_FORMAT }
    expect(codeOf(() => parsePreprocessor(broken, 'onehot'))).toBe('MODEL_FILE_INVALID')
  })

  it('실험 읽기가 그 실험 스냅샷의 공통 인코딩으로 채운다 - 사진 실험에서도 던지지 않는다', () => {
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
    const path = 'model/preprocessor-experiment-1.json'
    const tabular = experimentPreprocessor(
      {
        preprocessor: { path },
        settings: { data: { preprocessing: shared({ categoricalEncoding: 'ordinal' }) } },
      },
      new Map([[path, bytes(v1)]]),
    )
    expect(tabular?.columns[0]).toMatchObject({ encoding: 'ordinal', orderSpecified: false })

    const numeric = {
      ...v1,
      columns: [{ name: 'score', kind: 'numeric' }],
      featureNames: ['score'],
    }
    const image = experimentPreprocessor(
      { preprocessor: { path }, settings: { data: { backboneId: 'mobilenet-v2-r2' } } },
      new Map([[path, bytes(numeric)]]),
    )
    expect(image?.format).toBe(PREPROCESSOR_FORMAT)
  })
})

describe('덮어쓰기를 고치는 함수', () => {
  it('공통값을 따르고 순서도 없으면 열을 지우고, 남은 열이 없으면 columns도 지운다', () => {
    const cleared = withColumnOverride(MIXED, 'grade', 'inherit', undefined)
    expect(cleared).toEqual(shared())
    expect('columns' in cleared).toBe(false)
  })

  it('인코딩을 바꿔도 순서는 지우지 않는다 - 되돌리면 돌아온다', () => {
    const onehot = withColumnOverride(MIXED, 'grade', 'onehot', ['하', '중', '상'])
    expect(overrideOf(onehot, 'grade')).toEqual({
      categoricalEncoding: 'onehot',
      categories: ['하', '중', '상'],
    })
  })

  it('다른 열의 덮어쓰기는 그대로 둔다', () => {
    const both = withColumnOverride(MIXED, 'region', 'ordinal', undefined)
    expect(both.columns).toEqual({
      grade: { categoricalEncoding: 'ordinal', categories: ['하', '중', '상'] },
      region: { categoricalEncoding: 'ordinal' },
    })
  })

  it('한 칸 옮기고, 끝을 넘으면 그대로다', () => {
    expect(moveCategory(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moveCategory(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c'])
    expect(moveCategory(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c'])
  })

  it('사전순은 지정하지 않았을 때의 정렬과 같고, 역순은 그 뒤집기다', () => {
    expect(dictionaryOrder(['중', '상', '하'], 'ascending')).toEqual(['상', '중', '하'])
    expect(dictionaryOrder(['중', '상', '하'], 'descending')).toEqual(['하', '중', '상'])
  })
})

describe('가상 목록의 창', () => {
  const base = { count: 10_000, rowHeight: 48, viewportHeight: 480, overscan: 10 }

  it('맨 위에서는 보이는 줄과 아래 여분만 그린다', () => {
    expect(virtualWindow({ ...base, scrollTop: 0 })).toEqual({
      start: 0,
      end: 20,
      before: 0,
      after: (10_000 - 20) * 48,
    })
  })

  it('굴리면 그 자리 위아래 여분까지 그리고, 빈자리가 전체 높이를 지킨다', () => {
    const w = virtualWindow({ ...base, scrollTop: 48 * 500 })
    expect([w.start, w.end]).toEqual([490, 520])
    expect(w.before + (w.end - w.start) * 48 + w.after).toBe(10_000 * 48)
  })

  it('끝을 넘지 않고, 줄 높이를 아직 못 쟀어도 던지지 않는다', () => {
    expect(virtualWindow({ ...base, scrollTop: 48 * 20_000 }).end).toBe(10_000)
    expect(virtualWindow({ ...base, rowHeight: 0, scrollTop: 0 }).start).toBe(0)
    expect(virtualWindow({ ...base, count: 0, scrollTop: 0 })).toEqual({
      start: 0,
      end: 0,
      before: 0,
      after: 0,
    })
  })
})
