/**
 * 타깃·특성·모델 선택의 판정.
 *
 * **화면 없이 테스트한다.** 조건 하나를 확인하려고 화면 전체를 마운트해야 하면 아무도
 * 그 조건을 확인하지 않는다 (architecture.md §8.3과 같은 이유다).
 *
 * 여기서 지키는 선은 하나다 — **학습이 거부하는 것(issue)과 화면만 하는 말(caution)을
 * 섞지 않는다.** 학습이 안 막는 것을 에러처럼 보여주면 도구가 거짓말을 하고, 학습이
 * 막는 것을 주의로 보여주면 학생이 [학습]에서 처음 알게 된다.
 */

import { describe, expect, it } from 'vitest'

import type { ColumnSummary } from '../src/data/columns'
import { algorithmsLosingMeaning, columnPlan, requiredTargetKind } from '../src/ml/selection'
import type { Preprocessing } from '../src/project/schema'

const ONEHOT: Preprocessing = { missing: 'drop', scaling: 'none', categoricalEncoding: 'onehot' }
const NO_ENCODING: Preprocessing = { ...ONEHOT, categoricalEncoding: 'none' }

function column(overrides: Partial<ColumnSummary> & { name: string }): ColumnSummary {
  return { kind: 'numeric', missing: 0, unique: 5, samples: [], ...overrides }
}

const SCORE = column({ name: '점수' })
const HEIGHT = column({ name: '키' })
const GRADE = column({ name: '등급', kind: 'categorical', unique: 3 })

function planFor(overrides: Partial<Parameters<typeof columnPlan>[0]> = {}) {
  return columnPlan({
    columns: [SCORE, HEIGHT, GRADE],
    rowCount: 10,
    taskType: 'classification',
    target: '등급',
    features: ['점수', '키'],
    preprocessing: ONEHOT,
    ...overrides,
  })
}

describe('열마다 지금 무엇인가', () => {
  it('타깃과 특성과 안 쓰는 열을 가른다', () => {
    const plan = planFor({ features: ['점수'] })
    expect(plan.columns.map((one) => one.role)).toEqual(['feature', 'unused', 'target'])
  })

  it('고른 특성 수와 실제로 들어가는 수가 같다', () => {
    expect(planFor().usableFeatures).toBe(2)
  })
})

describe('학습이 거부하는 것', () => {
  it('회귀는 숫자가 아닌 열을 타깃으로 못 쓴다', () => {
    const plan = planFor({ taskType: 'regression' })
    const grade = plan.columns.find((one) => one.summary.name === '등급')
    expect(grade?.targetIssue).toBe('TARGET_NOT_NUMERIC')
    expect(plan.columns.find((one) => one.summary.name === '점수')?.targetIssue).toBeUndefined()
  })

  it('분류는 타깃 자료형을 가리지 않는다 - 3과 "3"을 나누지 않는다', () => {
    for (const one of planFor().columns) expect(one.targetIssue, one.summary.name).toBeUndefined()
    expect(requiredTargetKind('classification')).toBeUndefined()
  })

  it('값이 통째로 빈 열은 특성이 될 수 없고 학습에도 안 들어간다', () => {
    const empty = column({ name: '비고', missing: 10, unique: 0 })
    const plan = columnPlan({
      columns: [SCORE, empty],
      rowCount: 10,
      taskType: 'classification',
      target: undefined,
      features: ['점수', '비고'],
      preprocessing: ONEHOT,
    })
    expect(plan.columns[1]?.featureIssue).toBe('FEATURE_ALL_MISSING')
    expect(plan.usableFeatures).toBe(1)
  })
})

describe('화면만 하는 말', () => {
  it('인코딩이 꺼져 있으면 문자 열이 학습에서 빠진다', () => {
    const plan = columnPlan({
      columns: [SCORE, GRADE],
      rowCount: 10,
      taskType: 'classification',
      target: undefined,
      features: ['점수', '등급'],
      preprocessing: NO_ENCODING,
    })
    expect(plan.columns[1]?.featureNote).toBe('notEncodable')
    // 고르는 것 자체는 막지 않는다 - 인코딩을 켜면 그대로 살아난다.
    expect(plan.columns[1]?.featureIssue).toBeUndefined()
    expect(plan.usableFeatures).toBe(1)
  })

  it('인코딩을 켜면 문자 열도 학습에 들어간다', () => {
    const plan = columnPlan({
      columns: [SCORE, GRADE],
      rowCount: 10,
      taskType: 'classification',
      target: undefined,
      features: ['점수', '등급'],
      preprocessing: ONEHOT,
    })
    expect(plan.columns[1]?.featureNote).toBeUndefined()
    expect(plan.usableFeatures).toBe(2)
  })

  it('값이 한 종류뿐인 열은 주의이지 거부가 아니다', () => {
    const flat = column({ name: '반', unique: 1 })
    const plan = columnPlan({
      columns: [flat],
      rowCount: 10,
      taskType: 'classification',
      target: '반',
      features: [],
      preprocessing: ONEHOT,
    })
    expect(plan.columns[0]?.targetCaution).toBe('singleValue')
    expect(plan.columns[0]?.targetIssue).toBeUndefined()
  })
})

describe('유형을 바꾸면 뜻을 잃는 모델', () => {
  it('분류로 바꾸면 회귀 전용 모델이 빠진다', () => {
    const selected = [{ algorithm: 'decision_tree' }, { algorithm: 'linear_regression' }]
    expect(algorithmsLosingMeaning(selected, 'classification')).toEqual(['linear_regression'])
    expect(algorithmsLosingMeaning(selected, 'regression')).toEqual(['decision_tree'])
  })

  it('실행 위치는 보지 않는다 - 서버가 꺼져 있다고 선택을 지우지 않는다', () => {
    // svm은 순수 JS에 구현이 없다. 그래도 분류에서는 뜻이 있으므로 남는다.
    expect(algorithmsLosingMeaning([{ algorithm: 'svm' }], 'classification')).toEqual([])
  })

  it('등록부에 없는 알고리즘은 남긴다 - 남의 파일에서 온 것이다', () => {
    expect(algorithmsLosingMeaning([{ algorithm: 'xgboost' }], 'regression')).toEqual([])
  })
})
