/**
 * 학습 예상 시간 (`ml/estimate.ts`).
 *
 * **여기서 지키는 것은 방향이다.** 값이 몇 초로 나오는지가 아니라, **틀릴 때 길게
 * 틀리는가**를 본다 (open-decisions.md "학습 예상 시간은 실측표에 기기 배수를 곱해
 * 낸다"). 1분이라 해 놓고 3분을 끌면 학생이 화면을 못 믿게 되고, 못 믿는 화면은
 * 다음부터 안 읽힌다.
 *
 * **곱하는 축마다 트립와이어가 하나씩 있다.** 특성·그루 수·`maxIter` 셋은 전부
 * "이론상 이럴 것"과 "재 보니 이랬다"가 갈렸던 자리라, 누가 이론 쪽으로 되돌리면
 * 검사가 울어야 한다.
 */

import { describe as group, expect, it } from 'vitest'

import { BASELINE_COLUMNS, MLJS_DECISION_TREE_BASELINE_MS } from '../src/limits'
import { ALGORITHMS } from '../src/ml/algorithms'
import { baselineMs, describe, estimateMs, interpolate } from '../src/ml/estimate'

/** 손잡이를 안 건드린 기본 상태. 기준표를 잰 모양 그대로다. */
function input(algorithm: string, rows: number, columns = BASELINE_COLUMNS) {
  return { algorithm, rows, columns, hyperparameters: {} }
}

group('보간', () => {
  it('표에 있는 점은 그 값 그대로다', () => {
    for (const [rows, ms] of MLJS_DECISION_TREE_BASELINE_MS) {
      expect(interpolate(MLJS_DECISION_TREE_BASELINE_MS, rows), String(rows)).toBeCloseTo(ms, 6)
    }
  })

  it('두 점 사이는 그 사이 값이다', () => {
    const between = interpolate(MLJS_DECISION_TREE_BASELINE_MS, 1500)
    expect(between).toBeGreaterThan(330)
    expect(between).toBeLessThan(1222)
  })

  it('표 아래로는 첫 점의 값을 쓴다 - 아래로 외삽하면 값이 되레 커지는 표가 있다', () => {
    // 나이브 베이즈는 1,000행 6ms · 5,000행 5ms라 기울기가 음수다.
    const naive = ALGORITHMS.find((entry) => entry.id === 'naive_bayes')?.baseline.ms ?? []
    expect(interpolate(naive, 10)).toBe(naive[0]?.[1])
    expect(interpolate(MLJS_DECISION_TREE_BASELINE_MS, 10)).toBe(32)
  })

  it('표 위로는 가장 가파른 구간으로 늘린다 - 마지막 구간만 보면 짧게 틀린다', () => {
    const last = MLJS_DECISION_TREE_BASELINE_MS[MLJS_DECISION_TREE_BASELINE_MS.length - 1]
    const [lastRows, lastMs] = last as readonly [number, number]
    const lastSlope = Math.log(31_896 / 7842) / Math.log(10_000 / 5000) // 마지막 구간의 기울기
    const doubled = interpolate(MLJS_DECISION_TREE_BASELINE_MS, lastRows * 2)
    expect(doubled).toBeGreaterThan(lastMs * Math.pow(2, lastSlope))
  })

  it('빈 표는 0이다 - 없는 것을 지어내지 않는다', () => {
    expect(interpolate([], 1000)).toBe(0)
  })
})

group('곱하는 축', () => {
  it('특성 수는 트리 계열에만 선형으로 곱한다', () => {
    const eight = baselineMs(input('decision_tree', 2000))
    const thirtyTwo = baselineMs(input('decision_tree', 2000, 32))
    expect(thirtyTwo).toBeCloseTo((eight ?? 0) * 4, 6)
  })

  it('KNN과 로지스틱은 특성 수를 안 곱한다 - 재 보니 선형이 아니었다', () => {
    // KNN은 특성 4에서 32로 1.5배뿐이고, 로지스틱은 오히려 빨라졌다 (2026-08-31).
    for (const algorithm of ['knn', 'logistic_regression']) {
      const eight = baselineMs(input(algorithm, 5000))
      const thirtyTwo = baselineMs(input(algorithm, 5000, 32))
      expect(thirtyTwo, algorithm).toBeCloseTo(eight ?? 0, 6)
    }
  })

  it('랜덤포레스트는 그루 수에 선형이다', () => {
    const ten = baselineMs(input('random_forest', 1000))
    const hundred = baselineMs({
      ...input('random_forest', 1000),
      hyperparameters: { nEstimators: 100 },
    })
    expect(hundred).toBeCloseTo((ten ?? 0) * 10, 6)
  })

  it('로지스틱의 maxIter는 선형이 아니다 - 100회에서 1000회가 10배가 아니라 19배다', () => {
    const hundred = baselineMs(input('logistic_regression', 5000)) ?? 0
    const thousand =
      baselineMs({
        ...input('logistic_regression', 5000),
        hyperparameters: { maxIter: 1000 },
      }) ?? 0
    const factor = thousand / hundred
    expect(factor).toBeGreaterThan(15)
    expect(factor).toBeLessThan(25)
  })

  it('maxIter를 100 아래로 내려도 예상은 안 줄어든다 - 초반 구간이 유난히 싸다', () => {
    const hundred = baselineMs(input('logistic_regression', 5000))
    const few = baselineMs({
      ...input('logistic_regression', 5000),
      hyperparameters: { maxIter: 25 },
    })
    expect(few).toBeCloseTo(hundred ?? 0, 6)
  })

  it('등록부에 없는 알고리즘은 모른다고 한다', () => {
    expect(baselineMs(input('gradient_boosting', 1000))).toBeNull()
  })
})

group('기기 배수', () => {
  it('배수를 그대로 곱한다', () => {
    const one = estimateMs(input('decision_tree', 2000), 1) ?? 0
    expect(estimateMs(input('decision_tree', 2000), 3)).toBeCloseTo(one * 3, 6)
  })
})

group('화면이 적을 것', () => {
  it('짧으면 아무것도 안 적는다', () => {
    expect(describe(0).kind).toBe('none')
    expect(describe(4999).kind).toBe('none')
    expect(describe(null).kind).toBe('none')
  })

  it('올림한다 - 길게 틀리기로 했다', () => {
    expect(describe(5000)).toEqual({ kind: 'seconds', value: 5 })
    expect(describe(6001)).toEqual({ kind: 'seconds', value: 10 })
    expect(describe(61_000)).toEqual({ kind: 'minutes', value: 2 })
  })

  it('1분부터는 분으로 적는다', () => {
    expect(describe(59_000).kind).toBe('seconds')
    expect(describe(60_000)).toEqual({ kind: 'minutes', value: 1 })
  })
})

group('등록부', () => {
  it('모든 알고리즘이 기준표를 든다 - 새 알고리즘이 빈칸으로 들어오지 않는다', () => {
    for (const algorithm of ALGORITHMS) {
      expect(algorithm.baseline.ms.length, algorithm.id).toBeGreaterThan(1)
      expect(['linear', 'flat'], algorithm.id).toContain(algorithm.baseline.columns)
    }
  })

  it('기준표의 행 수가 오름차순이다 - 보간이 그것을 전제한다', () => {
    for (const algorithm of ALGORITHMS) {
      const rows = algorithm.baseline.ms.map(([value]) => value)
      expect(rows, algorithm.id).toEqual([...rows].sort((a, b) => a - b))
    }
  })
})
