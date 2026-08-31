/**
 * 모델이 배운 값의 표 (`ml/parameters.ts`).
 *
 * **진짜 입구로 재현한다** — 전처리기를 손으로 조립하지 않고 `fitPreprocessor` →
 * `transform` → `fit` → 직렬화까지 실제로 지나간 뒤, 파일 바이트에서 표를 세운다.
 * 이 파일이 지키려는 것이 **이름과 숫자의 자리가 맞물리는가**라서, 중간을 건너뛰면
 * 그 맞물림을 안 지나간다.
 *
 * **값 자체가 맞는지는 여기서 안 본다.** 그건 `sklearn-parity.spec.ts`의 몫이고,
 * 여기 있는 것은 "파일의 숫자를 그대로, 어긋나지 않게 세우는가"다.
 */

import { describe, expect, it } from 'vitest'

import en from '../src/locales/en.json'
import ko from '../src/locales/ko.json'
import { fit } from '../src/ml/engines/mljs'
import { KMEANS_FORMAT, REFERENCE_FORMAT, SVM_FORMAT, TREE_FORMAT } from '../src/ml/models'
import {
  PARAMETER_TITLE_KEYS,
  parameterTableFor,
  showsParameters,
  type ParameterKind,
} from '../src/ml/parameters'
import { fitPreprocessor, transform, type Dataset } from '../src/ml/preprocess'
import type { Experiment, Preprocessing } from '../src/project/schema'

const DATASET: Dataset = {
  columns: ['키', '몸무게', '지역', '결과'],
  rows: [
    ['150', '40', '서울', '가'],
    ['151', '41', '부산', '가'],
    ['152', '42', '서울', '가'],
    ['153', '43', '부산', '가'],
    ['180', '80', '서울', '나'],
    ['181', '81', '부산', '나'],
    ['182', '82', '서울', '나'],
    ['183', '83', '부산', '나'],
  ],
}

const NUMERIC_FEATURES = ['키', '몸무게']
const ROWS = DATASET.rows.map((_, index) => index)

function options(scaling: Preprocessing['scaling']): Preprocessing {
  return { missing: 'drop', scaling, categoricalEncoding: 'onehot' }
}

/** `settings`에서 이 모듈이 보는 것은 스케일링 하나다. */
function settingsWith(scaling: Preprocessing['scaling']): Experiment['settings'] {
  return { data: { preprocessing: options(scaling) } } as unknown as Experiment['settings']
}

/** 학습부터 직렬화까지 실제로 지나간다. 돌려주는 것은 `.mlpx`에 담기는 바이트다. */
function trained(
  algorithm: string,
  features: readonly string[],
  target: string,
  scaling: Preprocessing['scaling'] = 'none',
) {
  const preprocessing = options(scaling)
  const preprocessor = fitPreprocessor(DATASET, ROWS, features, preprocessing)
  const matrix = transform(preprocessor, DATASET, ROWS, preprocessing.categoricalEncoding)
  const targetIndex = DATASET.columns.indexOf(target)
  const values = ROWS.map((row) => (DATASET.rows[row] as string[])[targetIndex] as string)
  const { model } = fit(algorithm, {
    features: matrix,
    rowIndices: ROWS,
    target: values,
    hyperparameters: {},
    randomState: 42,
  })
  return {
    preprocessor,
    bytes: new TextEncoder().encode(JSON.stringify(model)),
    format: (model as { format: string }).format,
  }
}

describe('모델이 배운 값의 표', () => {
  it('로지스틱 — 범주마다 한 줄이고 절편이 함께 온다', () => {
    const { format, bytes, preprocessor } = trained('logistic_regression', NUMERIC_FEATURES, '결과')
    const table = parameterTableFor(format, bytes, preprocessor, settingsWith('none'))

    expect(table?.featureNames).toEqual(['키', '몸무게'])
    expect(table?.sections.map((section) => section.kind)).toEqual(['coefficients'])
    const rows = table?.sections[0]?.rows ?? []
    // **이진도 두 줄이다.** sklearn처럼 한 줄로 접지 않는다 — 접으려면 두 배 하는 계산이
    // 화면에 생기고, 그 계산은 대조 밖에 있다 (결정문 "화면이 정하는 것 셋").
    expect(rows.map((row) => row.label)).toEqual(['가', '나'])
    expect(rows.every((row) => row.values.length === 2)).toBe(true)
    expect(rows.every((row) => row.intercept !== null)).toBe(true)
    // ±절반이라 두 줄의 부호가 대칭이다. 그 성질이 깨지면 어느 줄이 어느 범주인지 흐려진다.
    const first = rows[0]
    const second = rows[1]
    for (const [index, value] of (first?.values ?? []).entries()) {
      expect(value).toBeCloseTo(-(second?.values[index] ?? 0), 12)
    }
  })

  it('선형 회귀 — 줄이 하나이고 범주 이름이 없다', () => {
    const { format, bytes, preprocessor } = trained('linear_regression', ['키'], '몸무게')
    const table = parameterTableFor(format, bytes, preprocessor, settingsWith('none'))

    const rows = table?.sections[0]?.rows ?? []
    expect(rows).toHaveLength(1)
    expect(rows[0]?.label).toBeNull()
    expect(rows[0]?.values).toHaveLength(1)
    expect(rows[0]?.intercept).not.toBeNull()
  })

  it('나이브 베이즈 — 평균과 분산이 각각 한 표이고 절편이 없다', () => {
    const { format, bytes, preprocessor } = trained('naive_bayes', NUMERIC_FEATURES, '결과')
    const table = parameterTableFor(format, bytes, preprocessor, settingsWith('none'))

    expect(table?.sections.map((section) => section.kind)).toEqual(['means', 'variances'])
    for (const section of table?.sections ?? []) {
      expect(section.rows.map((row) => row.label)).toEqual(['가', '나'])
      expect(section.rows.every((row) => row.intercept === null)).toBe(true)
    }
    // 평균은 그 범주 행들의 평균이다. 키가 작은 쪽이 `가`라는 것이 데이터의 사실이다.
    const means = table?.sections[0]?.rows ?? []
    expect(means[0]?.values[0]).toBeLessThan(means[1]?.values[0] ?? 0)
  })

  it('원핫으로 늘어난 열도 이름 그대로 한 줄씩이다', () => {
    const { format, bytes, preprocessor } = trained('logistic_regression', ['키', '지역'], '결과')
    const table = parameterTableFor(format, bytes, preprocessor, settingsWith('none'))

    // 되묶지 않는다 — 되묶는 것도 우리가 짜는 계산이다 (결정문).
    expect(table?.featureNames).toEqual(preprocessor.featureNames)
    expect(table?.featureNames.length).toBeGreaterThan(2)
    expect(table?.sections[0]?.rows[0]?.values).toHaveLength(preprocessor.featureNames.length)
  })

  it('스케일링을 켰는지가 표에 실린다', () => {
    const off = trained('logistic_regression', NUMERIC_FEATURES, '결과', 'none')
    const on = trained('logistic_regression', NUMERIC_FEATURES, '결과', 'standard')

    expect(
      parameterTableFor(off.format, off.bytes, off.preprocessor, settingsWith('none'))?.scaled,
    ).toBe(false)
    expect(
      parameterTableFor(on.format, on.bytes, on.preprocessor, settingsWith('standard'))?.scaled,
    ).toBe(true)
  })

  it('읽을 수 없으면 아무것도 세우지 않는다', () => {
    const { format, bytes, preprocessor } = trained('logistic_regression', NUMERIC_FEATURES, '결과')

    // 전처리기가 안 담긴 파일 — 이름 없이 숫자만 늘어놓지 않는다.
    expect(parameterTableFor(format, bytes, null, settingsWith('none'))).toBeNull()
    // 모델을 뺀 채로 받은 파일.
    expect(parameterTableFor(format, undefined, preprocessor, settingsWith('none'))).toBeNull()
    // **다른 전처리기로 배운 모델** — 자리가 어긋나면 엉뚱한 열에 계수가 붙는다.
    const narrow = fitPreprocessor(DATASET, ROWS, ['키'], options('none'))
    expect(parameterTableFor(format, bytes, narrow, settingsWith('none'))).toBeNull()
    // 남이 편집해 깨진 파일.
    expect(
      parameterTableFor(format, new TextEncoder().encode('{'), preprocessor, settingsWith('none')),
    ).toBeNull()
  })

  it('보여줄 것이 없는 형식은 등록부가 먼저 끈다', () => {
    for (const format of [TREE_FORMAT, SVM_FORMAT, REFERENCE_FORMAT, KMEANS_FORMAT]) {
      expect(showsParameters(format), format).toBe(false)
    }
    expect(showsParameters(undefined)).toBe(false)
  })

  it('종류마다의 제목이 두 언어에 다 있다', () => {
    const flat = (tree: Record<string, unknown>, prefix = ''): Map<string, string> => {
      const out = new Map<string, string>()
      for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (typeof value === 'string') out.set(path, value)
        else if (value && typeof value === 'object') {
          for (const [inner, text] of flat(value as Record<string, unknown>, path)) {
            out.set(inner, text)
          }
        }
      }
      return out
    }
    const korean = flat(ko as unknown as Record<string, unknown>)
    const english = flat(en as unknown as Record<string, unknown>)
    const kinds: ParameterKind[] = ['coefficients', 'means', 'variances']
    for (const kind of kinds) {
      const key = PARAMETER_TITLE_KEYS[kind]
      expect(korean.has(key), `${key} (ko)`).toBe(true)
      expect(english.has(key), `${key} (en)`).toBe(true)
    }
  })
})
