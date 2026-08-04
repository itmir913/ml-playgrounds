/**
 * 알고리즘 등록부와 선택 가능 판정.
 *
 * 여기서 지켜야 하는 것 둘.
 *
 *   1. **분기가 없다.** 등록부에 항목을 추가하면 화면이 따라온다. 회귀·군집이 들어와도
 *      `if (taskType === ...)` 가 생기면 안 된다 (mlpx-spec.md 0.1)
 *   2. **못 쓰는 것에도 이유가 있다.** 그리고 그 이유가 학생에게 쓸모 있어야 한다 -
 *      이미지 데이터에 회귀를 고른 학생에게 "서버가 없습니다"는 도움이 안 된다
 */

import { describe, expect, it } from 'vitest'

import { CLIENT_ERROR_CODES } from '../src/errors'
import { BROWSER_ROW_LIMIT } from '../src/limits'
import {
  ALGORITHMS,
  algorithmOptions,
  enabledAlgorithms,
  type Algorithm,
  type Selection,
} from '../src/ml/algorithms'
import type { EngineState, RuntimeContext } from '../src/ml/backend'
import { DATA_TYPES, TASK_TYPES } from '../src/project/schema'

const tabularClassification: Selection = { dataType: 'tabular', taskType: 'classification' }

function context(overrides: Partial<RuntimeContext> = {}): RuntimeContext {
  return { serverStatus: 'unavailable', rowCount: 100, ...overrides }
}

const skReady: Record<string, EngineState> = { 'pyodide-sklearn': 'ready' }

function optionFor(options: ReturnType<typeof algorithmOptions>, id: string) {
  return options.find((option) => option.algorithm.id === id)
}

describe('등록부', () => {
  it('id가 겹치지 않는다', () => {
    expect(new Set(ALGORITHMS.map((a) => a.id)).size).toBe(ALGORITHMS.length)
  })

  it('모든 항목이 아는 어휘만 쓴다', () => {
    for (const algorithm of ALGORITHMS) {
      for (const dataType of algorithm.dataTypes) {
        expect(DATA_TYPES, algorithm.id).toContain(dataType)
      }
      for (const taskType of algorithm.taskTypes) {
        expect(TASK_TYPES, algorithm.id).toContain(taskType)
      }
      expect(algorithm.runtimes.length, algorithm.id).toBeGreaterThan(0)
    }
  })

  it('순수 JS 구현이 없는 것도 숨기지 않고 등록한다', () => {
    // 목록에서 빼면 학생은 SVM이라는 것이 있다는 사실조차 모른다.
    expect(ALGORITHMS.find((a) => a.id === 'svm')?.runtimes).not.toContain('mljs')
  })
})

describe('세 축으로 고른다', () => {
  it('과제 유형이 다르면 잠긴다 - 분류를 골랐는데 회귀 모델이 열리면 안 된다', () => {
    const options = algorithmOptions(tabularClassification, context())
    expect(optionFor(options, 'linear_regression')?.reason).toBe('ALGORITHM_NOT_FOR_TASK_TYPE')
  })

  it('회귀를 고르면 회귀 모델이 열리고 분류 모델이 잠긴다', () => {
    const options = algorithmOptions({ dataType: 'tabular', taskType: 'regression' }, context())
    expect(optionFor(options, 'linear_regression')?.enabled).toBe(true)
    expect(optionFor(options, 'decision_tree')?.reason).toBe('ALGORITHM_NOT_FOR_TASK_TYPE')
  })

  it('데이터 타입이 다르면 잠긴다', () => {
    const options = algorithmOptions({ dataType: 'image', taskType: 'classification' }, context())
    expect(options.every((option) => option.reason === 'ALGORITHM_NOT_FOR_DATA_TYPE')).toBe(true)
  })

  it('데이터 타입이 과제 유형보다 먼저다 - 더 근본적인 것이 먼저 걸린다', () => {
    // 이미지 + 회귀. 둘 다 안 맞지만 학생이 먼저 알아야 할 것은 데이터다.
    const options = algorithmOptions({ dataType: 'image', taskType: 'regression' }, context())
    expect(optionFor(options, 'decision_tree')?.reason).toBe('ALGORITHM_NOT_FOR_DATA_TYPE')
  })

  it('축이 다 맞으면 실행 방법을 본다', () => {
    const options = algorithmOptions(tabularClassification, context())
    // 순수 JS가 있으므로 서버가 없어도 열린다.
    expect(optionFor(options, 'decision_tree')?.enabled).toBe(true)
    // svm은 sklearn에서만 도는데 서버도 없고 엔진도 준비 안 됐다.
    expect(optionFor(options, 'svm')?.enabled).toBe(false)
  })
})

describe('못 쓰는 이유가 쓸모 있어야 한다', () => {
  it('지원하지도 않는 실행 방법의 이유를 보여주지 않는다', () => {
    // svm은 mljs를 아예 지원하지 않는다. "여기서 실행할 수 없습니다"라고만 하면
    // 학생은 무엇을 해야 하는지 모른다. 엔진을 준비하면 된다고 말해줘야 한다.
    const options = algorithmOptions(tabularClassification, context())
    expect(optionFor(options, 'svm')?.reason).toBe('ENGINE_NOT_READY')
  })

  it('엔진을 준비하면 sklearn 전용 모델이 열린다', () => {
    const options = algorithmOptions(tabularClassification, context({ engineStates: skReady }))
    expect(optionFor(options, 'svm')?.enabled).toBe(true)
  })

  it('데이터가 너무 크면 브라우저 전용 상황에서 잠긴다', () => {
    const options = algorithmOptions(
      tabularClassification,
      context({ rowCount: BROWSER_ROW_LIMIT + 1 }),
    )
    expect(optionFor(options, 'decision_tree')?.reason).toBe('DATASET_TOO_LARGE_FOR_BROWSER')
  })

  it('서버가 있으면 큰 데이터도 열린다', () => {
    const options = algorithmOptions(
      tabularClassification,
      context({ serverStatus: 'available', rowCount: BROWSER_ROW_LIMIT + 1 }),
    )
    expect(optionFor(options, 'decision_tree')?.enabled).toBe(true)
  })

  it('잠긴 항목에는 언제나 이유가 있고 그 이유가 로케일에 있다', () => {
    const cases = [
      algorithmOptions(tabularClassification, context()),
      algorithmOptions({ dataType: 'audio', taskType: 'clustering' }, context()),
      algorithmOptions(tabularClassification, context({ rowCount: 999999 })),
      algorithmOptions({ dataType: 'tabular', taskType: 'regression' }, context()),
    ]
    const declared = new Set<string>(CLIENT_ERROR_CODES)
    for (const options of cases) {
      for (const option of options) {
        if (option.enabled) continue
        expect(option.reason, option.algorithm.id).toBeDefined()
        expect(declared.has(option.reason as string), option.reason).toBe(true)
      }
    }
  })

  it('잠겨 있어도 실행 방법별 판정을 함께 준다 - 무엇을 하면 되는지 알아야 한다', () => {
    const option = optionFor(algorithmOptions(tabularClassification, context()), 'svm')
    expect(option?.runtimes).toHaveLength(3)
    expect(option?.runtimes.find((r) => r.runtime.id === 'mljs')?.reason).toBe(
      'ALGORITHM_NOT_AVAILABLE_HERE',
    )
    expect(option?.runtimes.find((r) => r.runtime.id === 'server-sklearn')?.reason).toBe(
      'SERVER_UNAVAILABLE',
    )
  })
})

describe('분기 없이 늘어난다', () => {
  it('등록부에 없는 과제 유형을 골라도 터지지 않고 전부 잠긴다', () => {
    // 군집 모델은 아직 하나도 등록하지 않았다. 화면은 빈 목록이 아니라
    // "왜 못 쓰는지"가 달린 목록을 받아야 한다.
    const options = algorithmOptions({ dataType: 'tabular', taskType: 'clustering' }, context())
    expect(options).toHaveLength(ALGORITHMS.length)
    expect(enabledAlgorithms(options)).toEqual([])
    expect(options.every((o) => o.reason === 'ALGORITHM_NOT_FOR_TASK_TYPE')).toBe(true)
  })

  it('등록부를 넘기면 그것만 본다 - 새 항목이 코드 변경 없이 들어온다', () => {
    const future: Algorithm[] = [
      { id: 'kmeans', dataTypes: ['tabular'], taskTypes: ['clustering'], runtimes: ['mljs'] },
    ]
    const options = algorithmOptions(
      { dataType: 'tabular', taskType: 'clustering' },
      context(),
      future,
    )
    expect(options[0]?.enabled).toBe(true)
  })
})

describe('enabledAlgorithms', () => {
  it('고를 수 있는 것만 남긴다', () => {
    const options = algorithmOptions(tabularClassification, context())
    const ids = enabledAlgorithms(options).map((a) => a.id)
    // svm만 sklearn 전용이라 엔진을 준비하기 전에는 안 열린다.
    expect(ids).toEqual([
      'decision_tree',
      'knn',
      'logistic_regression',
      'random_forest',
      'naive_bayes',
    ])
  })
})
