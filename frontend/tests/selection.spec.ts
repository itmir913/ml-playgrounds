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
import { ALGORITHMS, algorithmOptions } from '../src/ml/algorithms'
import type { RuntimeContext } from '../src/ml/backend'
import type { Dataset } from '../src/ml/preprocess'
import {
  algorithmsLosingMeaning,
  columnPlan,
  modelAxes,
  requiredTargetKind,
  rowUsage,
  stratifyBlock,
  stratifyLocked,
  type AxisChoice,
} from '../src/ml/selection'
import type { Preprocessing } from '../src/project/schema'
import { SKLEARN_ONLY_ALGORITHM, withSklearnOnly } from './fixtures/algorithms'

const ONEHOT: Preprocessing = { missing: 'drop', scaling: 'none', categoricalEncoding: 'onehot' }
const NO_ENCODING: Preprocessing = { ...ONEHOT, categoricalEncoding: 'none' }
const KEEP_BLANKS: Preprocessing = { ...ONEHOT, missing: 'none' }

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

  it('"그대로 두기"에서는 빈 칸이 하나만 있어도 특성이 될 수 없다', () => {
    // 빈 칸을 그대로 모델에 넣을 방법이 없다. 조용히 0으로 채우느니 거부한다
    // (open-decisions.md "전처리도 분할도 끌 수 있다").
    const holed = column({ name: '점수', missing: 2 })
    const plan = columnPlan({
      columns: [holed],
      rowCount: 10,
      taskType: 'classification',
      target: undefined,
      features: ['점수'],
      preprocessing: KEEP_BLANKS,
    })
    expect(plan.columns[0]?.featureIssue).toBe('FEATURE_HAS_MISSING')
    expect(plan.usableFeatures).toBe(0)
  })

  it('전략을 바꾸면 같은 열이 풀린다 - 열이 아니라 설정의 문제다', () => {
    const holed = column({ name: '점수', missing: 2 })
    const plan = columnPlan({
      columns: [holed],
      rowCount: 10,
      taskType: 'classification',
      target: undefined,
      features: ['점수'],
      preprocessing: { ...ONEHOT, missing: 'mean' },
    })
    expect(plan.columns[0]?.featureIssue).toBeUndefined()
    expect(plan.usableFeatures).toBe(1)
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
    // 이 모델은 서버나 준비된 엔진이 있어야 돈다. 그래도 분류에서는 뜻이 있으므로 남는다.
    expect(
      algorithmsLosingMeaning([{ algorithm: 'sklearn_only' }], 'classification', [
        SKLEARN_ONLY_ALGORITHM,
      ]),
    ).toEqual([])
  })

  it('등록부에 없는 알고리즘은 남긴다 - 남의 파일에서 온 것이다', () => {
    expect(algorithmsLosingMeaning([{ algorithm: 'xgboost' }], 'regression')).toEqual([])
  })
})

describe('세 축이 서로를 좁힌다', () => {
  const OFFLINE: RuntimeContext = { serverStatus: 'unavailable', rowCount: 50 }
  const ONLINE: RuntimeContext = { serverStatus: 'available', rowCount: 50 }

  function axes(
    overrides: Partial<Parameters<typeof modelAxes>[0]> = {},
  ): ReturnType<typeof modelAxes> {
    return modelAxes({
      // 등록부에 sklearn 전용을 하나 얹어 둔다. 지금 실제 등록부에는 하나도 없는데,
      // 그 사실이 이 규칙의 테스트를 지우면 안 된다 (fixtures/algorithms.ts).
      options: algorithmOptions(
        { dataType: 'tabular', taskType: 'classification' },
        OFFLINE,
        withSklearnOnly(ALGORITHMS),
      ),
      algorithm: 'decision_tree',
      runtime: 'mljs',
      chosen: [],
      ...overrides,
    })
  }

  function choice(list: readonly AxisChoice[], id: string): AxisChoice | undefined {
    return list.find((one) => one.id === id)
  }

  it('실행 방법이 모델을 좁힌다 - 순수 JS에 없는 모델은 순수 JS 축에서 꺼진다', () => {
    const options = algorithmOptions(
      { dataType: 'tabular', taskType: 'classification' },
      ONLINE,
      withSklearnOnly(ALGORITHMS),
    )
    const { algorithms } = axes({ options })
    expect(choice(algorithms, 'decision_tree')?.enabled).toBe(true)
    expect(choice(algorithms, 'sklearn_only')).toEqual({
      id: 'sklearn_only',
      enabled: false,
      reason: 'ALGORITHM_NOT_AVAILABLE_HERE',
    })
  })

  /**
   * **어디서도 못 도는 것이 먼저다** (mlpx-spec.md 0.1). 서버가 없으면 서포트 벡터 머신은
   * 순수 JS에 없어서가 아니라 **엔진이 준비되지 않아서** 못 쓴다 - 그쪽이 학생이 할 수
   * 있는 일을 알려주는 사유다.
   */
  it('축이 좁히기 전에 더 근본적인 사유가 있으면 그것이 이긴다', () => {
    const options = algorithmOptions(
      { dataType: 'tabular', taskType: 'classification' },
      OFFLINE,
      withSklearnOnly(ALGORITHMS),
    )
    expect(choice(axes({ options }).algorithms, 'sklearn_only')?.reason).toBe('ENGINE_NOT_READY')
  })

  it('과제 유형이 먼저다 - 회귀에서는 분류 모델이 유형 사유로 꺼진다', () => {
    const { algorithms } = axes({
      options: algorithmOptions({ dataType: 'tabular', taskType: 'regression' }, OFFLINE),
      algorithm: 'linear_regression',
    })
    expect(choice(algorithms, 'decision_tree')?.reason).toBe('ALGORITHM_NOT_FOR_TASK_TYPE')
    expect(choice(algorithms, 'linear_regression')?.enabled).toBe(true)
  })

  it('모델이 실행 방법을 좁힌다 - 축은 걸린 모델 기준으로 판정된다', () => {
    const options = algorithmOptions(
      { dataType: 'tabular', taskType: 'classification' },
      OFFLINE,
      withSklearnOnly(ALGORITHMS),
    )
    expect(choice(axes().runtimes, 'mljs')?.enabled).toBe(true)
    expect(choice(axes({ options, algorithm: 'sklearn_only' }).runtimes, 'mljs')?.reason).toBe(
      'ALGORITHM_NOT_AVAILABLE_HERE',
    )
  })

  it('서버가 없는 것은 정상 상태다 - 지우지 않고 사유와 함께 꺼 둔다', () => {
    const { runtimes } = axes()
    expect(runtimes.map((one) => one.id)).toEqual(['mljs', 'pyodide-sklearn', 'server-sklearn'])
    expect(choice(runtimes, 'server-sklearn')?.reason).toBe('SERVER_UNAVAILABLE')
    expect(choice(runtimes, 'pyodide-sklearn')?.reason).toBe('ENGINE_NOT_READY')
  })

  it('같은 쌍은 두 번 못 담고, 실행 방법이 다르면 담을 수 있다', () => {
    const options = algorithmOptions({ dataType: 'tabular', taskType: 'classification' }, ONLINE)
    const chosen = [{ algorithm: 'decision_tree', runtime: 'mljs' }]
    expect(axes({ options, chosen }).blocked).toBe('alreadyAdded')
    expect(axes({ options, chosen, runtime: 'server-sklearn' }).blocked).toBeNull()
  })

  /**
   * **불변식이다** (architecture.md 8.12). 이게 깨지면 "카드는 멀쩡한데 [추가]가 꺼져
   * 있다"가 생기고, 학생은 무엇을 고쳐야 하는지 알 수 없다.
   */
  it('담을 수 없으면 그 카드가 꺼져 있다', () => {
    for (const algorithm of ['svm', 'linear_regression', 'decision_tree', 'sklearn_only']) {
      const result = axes({ algorithm })
      const card = result.algorithms.find((one) => one.id === algorithm)
      expect(card?.enabled).toBe(result.blocked === null)
      if (!card?.enabled) expect(result.blocked).toBe(card?.reason)
    }
  })
})

describe('층화를 걸 수 있는가', () => {
  const dataset = (targets: string[]): Dataset => ({
    columns: ['키', '반'],
    rows: targets.map((target, index) => [String(170 + index), target]),
  })

  function blockFor(overrides: Partial<Parameters<typeof stratifyBlock>[0]> = {}) {
    return stratifyBlock({
      dataset: dataset(['A', 'A', 'B', 'B']),
      taskType: 'classification',
      target: '반',
      features: ['키'],
      preprocessing: ONEHOT,
      ...overrides,
    })
  }

  it('값마다 두 줄 이상이면 걸 수 있다', () => {
    expect(blockFor()).toBeNull()
  })

  it('회귀에서는 유형이 먼저 걸린다 - 값을 세기 전에 답이 나온다', () => {
    // **데이터를 보지 않고도 답한다.** 값이 고르게 갈리는 데이터를 넣어도 마찬가지다 -
    // 회귀에는 맞출 "종류"가 없다.
    expect(blockFor({ taskType: 'regression' })?.code).toBe('STRATIFY_NOT_FOR_TASK_TYPE')
  })

  it('1개뿐인 값이 하나면 그 값을 알려준다 - 더 모으면 풀린다', () => {
    const only = blockFor({ dataset: dataset(['A', 'A', 'B', 'B', '희귀품종']) })
    expect(only?.code).toBe('SPLIT_STRATIFY_IMPOSSIBLE')
    expect(only?.params).toMatchObject({ label: '희귀품종', count: 1 })
  })

  it('1개뿐인 값이 여럿이면 다른 사유다 - "더 모아라"가 불가능한 조언이 된다', () => {
    // 연속값 타깃이 실제로 이 모양이다. 소수가 두 번 나오는 일은 없다.
    const continuous = blockFor({ dataset: dataset(['1.13', '2.71', '3.14', '4.20']) })
    expect(continuous?.code).toBe('SPLIT_STRATIFY_TARGET_CONTINUOUS')
    expect(continuous?.params).toMatchObject({ kinds: 4, lonely: 4 })
  })

  it('학습이 버릴 행은 세지 않는다 - 화면과 학습이 같은 행을 봐야 한다', () => {
    // 두 번째 'B'의 특성이 비었다. drop 전략이면 그 행이 빠지므로 'B'가 한 줄이 되고,
    // 층화는 실제로 성립하지 않는다. 전체 행을 세면 이걸 못 잡는다.
    const holed: Dataset = {
      columns: ['키', '반'],
      rows: [
        ['170', 'A'],
        ['171', 'A'],
        ['172', 'B'],
        ['', 'B'],
      ],
    }
    expect(blockFor({ dataset: holed })?.code).toBe('SPLIT_STRATIFY_IMPOSSIBLE')
    // 채워 쓰는 전략이면 네 줄이 다 남아 성립한다.
    expect(blockFor({ dataset: holed, preprocessing: { ...ONEHOT, missing: 'mean' } })).toBeNull()
  })

  it('유형을 안 골랐으면 유형으로 좁히지 않는다', () => {
    expect(blockFor({ taskType: undefined })).toBeNull()
  })

  it('데이터나 타깃이 없으면 할 말이 없다', () => {
    expect(blockFor({ dataset: null })).toBeNull()
    expect(blockFor({ target: undefined })).toBeNull()
  })
})

describe('층화 체크박스를 잠그는 조건', () => {
  const block = { code: 'STRATIFY_NOT_FOR_TASK_TYPE' } as const

  it('켜진 채로는 절대 잠기지 않는다 - 영구 차단을 막는 조건이다', () => {
    // **이 한 줄이 이 describe의 이유다.** 파일에 true로 적힌 채 뜻을 잃은 상태는
    // 기본값이 켜짐이라 실재한다. 여기서 잠그면 학생은 이유를 읽고도 끌 수 없고,
    // 학습은 계속 거부한다 - 화면에서 빠져나갈 문이 없다.
    expect(stratifyLocked(block, true)).toBe(false)
  })

  it('꺼져 있고 뜻이 없으면 잠근다 - 켤 수 없는 것을 켜게 두지 않는다', () => {
    expect(stratifyLocked(block, false)).toBe(true)
  })

  it('걸리는 것이 없으면 꺼져 있어도 잠기지 않는다', () => {
    expect(stratifyLocked(null, false)).toBe(false)
    expect(stratifyLocked(null, true)).toBe(false)
  })
})

describe('올린 행 중 몇 행을 쓰는지', () => {
  const dataset = (rows: string[][]): Dataset => ({ columns: ['키', '반'], rows })

  it('빠진 행이 없으면 null이다 - 할 말이 없을 때 굳이 하지 않는다', () => {
    const clean = dataset([
      ['170', 'A'],
      ['180', 'B'],
    ])
    expect(rowUsage(clean, ['키'], '반', 'mean')).toBeNull()
  })

  it('타깃이 빈 행은 결측 전략과 무관하게 빠진다', () => {
    const holed = dataset([
      ['170', 'A'],
      ['180', ''],
    ])
    expect(rowUsage(holed, ['키'], '반', 'mean')).toEqual({ total: 2, usable: 1, dropped: 1 })
  })

  it('drop 전략이면 특성이 빈 행도 빠진다', () => {
    const holed = dataset([
      ['170', 'A'],
      ['', 'B'],
    ])
    expect(rowUsage(holed, ['키'], '반', 'drop')).toEqual({ total: 2, usable: 1, dropped: 1 })
    // mean이면 채워서 쓰므로 안 빠진다 - usableRows가 특성 결측을 drop에서만 본다.
    expect(rowUsage(holed, ['키'], '반', 'mean')).toBeNull()
  })

  it('데이터가 없거나 타깃이 안 정해졌으면 null이다', () => {
    const clean = dataset([['170', 'A']])
    expect(rowUsage(null, ['키'], '반', 'mean')).toBeNull()
    expect(rowUsage(clean, ['키'], undefined, 'mean')).toBeNull()
  })
})
