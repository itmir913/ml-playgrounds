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
import { MAX_DATASET_ROWS, MLJS_DECISION_TREE_ROW_LIMIT } from '../src/limits'
import { NOT_FOR_TABULAR_ALGORITHM, SKLEARN_ONLY_ALGORITHM } from './fixtures/algorithms'
import {
  ALGORITHMS,
  algorithmOptions,
  enabledAlgorithms,
  type Algorithm,
  type Selection,
} from '../src/ml/algorithms'
import {
  BROWSER_RUNTIME_IDS,
  RUNTIME_IDS,
  UNMEASURED,
  type EngineState,
  type RuntimeContext,
} from '../src/ml/backend'
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

  it('아무 데서도 안 서는 줄이 없다', () => {
    // **어휘는 이제 타입이 지킨다** (ml/axes.ts) - 모르는 축 값을 적거나 아는 값을
    // 빠뜨리면 컴파일이 깨진다. 그래서 여기서 어휘를 다시 세지 않는다.
    //
    // 타입이 못 잡는 것은 **칸을 다 채웠는데 전부 false인 줄**이다. 화면 어디에도
    // 안 나오는데 등록부에는 있는 항목이고, 그건 지웠어야 할 줄이다 (§9.2.1).
    for (const algorithm of ALGORITHMS) {
      expect(
        DATA_TYPES.some((dataType) => algorithm.dataTypes[dataType]),
        algorithm.id,
      ).toBe(true)
      expect(
        TASK_TYPES.some((taskType) => algorithm.taskTypes[taskType]),
        algorithm.id,
      ).toBe(true)
      expect(
        RUNTIME_IDS.some((runtimeId) => algorithm.runtimes[runtimeId]),
        algorithm.id,
      ).toBe(true)
    }
  })

  it('순수 JS 칸은 전부 재 본 값이다', () => {
    // **전역 기본값에 얹혀 있는 줄이 없어야 한다.** 일곱 줄 전부 실측이 있고
    // (open-decisions.md #13), 비워 두면 다음에 전역을 올리는 사람이 그 알고리즘까지
    // 대신 허락하게 된다. 값이 안 바뀌는 랜덤포레스트도 그래서 적혀 있다.
    //
    // **다른 칸을 여기서 요구하지 않는다** - `pyodide-sklearn`은 아직 아무것도 안 쟀고,
    // `UNMEASURED`가 그 사실을 적은 것이다. 지어낸 숫자보다 낫다.
    for (const algorithm of ALGORITHMS) {
      expect(algorithm.maxRows.mljs, algorithm.id).toBeTypeOf('number')
    }
  })

  it('행 상한이 데이터셋 상한을 넘지 않는다', () => {
    // 넘는 값은 거짓말이다 - 그만큼의 행은 애초에 앱에 들어오지 못한다.
    for (const algorithm of ALGORITHMS) {
      for (const runtimeId of BROWSER_RUNTIME_IDS) {
        const limit = algorithm.maxRows[runtimeId]
        if (limit === UNMEASURED) continue
        expect(limit, `${algorithm.id}/${runtimeId}`).toBeLessThanOrEqual(MAX_DATASET_ROWS)
      }
    }
  })

  it('순수 JS 구현이 없는 것도 숨기지 않고 등록한다', () => {
    // 목록에서 빼면 학생은 그런 모델이 있다는 사실조차 모른다. **표본은 가짜다** -
    // 등록부에는 지금 sklearn 전용이 하나도 없고, 그건 규칙이 아니라 오늘의 사실이다.
    const options = algorithmOptions(tabularClassification, context(), [SKLEARN_ONLY_ALGORITHM])
    expect(options).toHaveLength(1)
    expect(options[0]?.enabled).toBe(false)
    expect(options[0]?.reason).toBe('ENGINE_NOT_READY')
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
    // **표본은 가짜다.** 어휘에는 지금 되는 종류만 있으므로(open-decisions.md) 안 맞는
    // 종류를 넘겨서 확인할 수 없다. 규칙을 확인하는 것이지 어휘를 확인하는 게 아니다.
    const options = algorithmOptions(tabularClassification, context(), [NOT_FOR_TABULAR_ALGORITHM])
    expect(options.every((option) => option.reason === 'ALGORITHM_NOT_FOR_DATA_TYPE')).toBe(true)
  })

  it('데이터 타입이 과제 유형보다 먼저다 - 더 근본적인 것이 먼저 걸린다', () => {
    // 이 모델은 표에서도 안 서고 회귀도 아니다. 둘 다 안 맞지만 학생이 먼저 알아야
    // 할 것은 데이터다.
    const options = algorithmOptions({ dataType: 'tabular', taskType: 'regression' }, context(), [
      NOT_FOR_TABULAR_ALGORITHM,
    ])
    expect(options[0]?.reason).toBe('ALGORITHM_NOT_FOR_DATA_TYPE')
  })

  it('축이 다 맞으면 실행 방법을 본다', () => {
    const options = algorithmOptions(tabularClassification, context())
    // 순수 JS가 있으므로 서버가 없어도 열린다.
    expect(optionFor(options, 'decision_tree')?.enabled).toBe(true)
    // sklearn에서만 도는 모델은 서버도 없고 엔진도 준비 안 됐으니 잠긴다.
    const sklearnOnly = algorithmOptions(tabularClassification, context(), [SKLEARN_ONLY_ALGORITHM])
    expect(sklearnOnly[0]?.enabled).toBe(false)
  })
})

describe('못 쓰는 이유가 쓸모 있어야 한다', () => {
  it('지원하지도 않는 실행 방법의 이유를 보여주지 않는다', () => {
    // 이 모델은 mljs를 아예 지원하지 않는다. "여기서 실행할 수 없습니다"라고만 하면
    // 학생은 무엇을 해야 하는지 모른다. 엔진을 준비하면 된다고 말해줘야 한다.
    const options = algorithmOptions(tabularClassification, context(), [SKLEARN_ONLY_ALGORITHM])
    expect(options[0]?.reason).toBe('ENGINE_NOT_READY')
  })

  it('엔진을 준비하면 sklearn 전용 모델이 열린다', () => {
    const options = algorithmOptions(tabularClassification, context({ engineStates: skReady }), [
      SKLEARN_ONLY_ALGORITHM,
    ])
    expect(options[0]?.enabled).toBe(true)
  })

  it('데이터가 너무 크면 브라우저 전용 상황에서 잠긴다', () => {
    // **알고리즘의 상한을 쓴다.** 전역 기본값으로 재면 상한이 그보다 높은 알고리즘에서
    // 이 검사가 아무것도 확인하지 않게 된다.
    const options = algorithmOptions(
      tabularClassification,
      context({ rowCount: MLJS_DECISION_TREE_ROW_LIMIT + 1 }),
    )
    expect(optionFor(options, 'decision_tree')?.reason).toBe('DATASET_TOO_LARGE_FOR_BROWSER')
  })

  it('서버가 있으면 큰 데이터도 열린다', () => {
    const options = algorithmOptions(
      tabularClassification,
      context({ serverStatus: 'available', rowCount: MLJS_DECISION_TREE_ROW_LIMIT + 1 }),
    )
    expect(optionFor(options, 'decision_tree')?.enabled).toBe(true)
  })

  it('잠긴 항목에는 언제나 이유가 있고 그 이유가 로케일에 있다', () => {
    const cases = [
      algorithmOptions(tabularClassification, context()),
      algorithmOptions(tabularClassification, context(), [NOT_FOR_TABULAR_ALGORITHM]),
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
    const option = algorithmOptions(tabularClassification, context(), [SKLEARN_ONLY_ALGORITHM])[0]
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
      {
        id: 'kmeans',
        dataTypes: { tabular: true },
        taskTypes: { classification: false, regression: false, clustering: true },
        runtimes: { mljs: true, 'pyodide-sklearn': false, 'server-sklearn': false },
        // 아직 아무도 안 쟀다. 군집을 실제로 넣는 날 이 칸이 숫자를 요구한다.
        maxRows: { mljs: UNMEASURED, 'pyodide-sklearn': UNMEASURED },
      },
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
    // 분류 모델 전부다. **회귀 전용만 빠진다** - 이제 sklearn 전용은 하나도 없다.
    expect(ids).toEqual([
      'decision_tree',
      'knn',
      'logistic_regression',
      'random_forest',
      'naive_bayes',
      'svm',
    ])
  })
})
