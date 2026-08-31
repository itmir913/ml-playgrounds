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
import { summarizeColumns } from '../src/data/columns'
import { baselineMs, describe, estimateMs, interpolate } from '../src/ml/estimate'
import { estimatedFeatureWidth, fitPreprocessor } from '../src/ml/preprocess'

/** 손잡이를 안 건드린 기본 상태. 기준표를 잰 모양 그대로다. */
function input(algorithm: string, rows: number, columns = BASELINE_COLUMNS) {
  return { algorithm, dataType: 'tabular' as const, rows, columns, hyperparameters: {} }
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
    const naive = ALGORITHMS.find((entry) => entry.id === 'naive_bayes')?.baseline.tabular.ms ?? []
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
  /**
   * **빈칸을 안 남긴다** (2026-08-31, 사용자). 5초 미만을 안 적기로 했었는데, 그러면
   * 화면에서 **빠른 것과 못 재는 것이 같은 모양**이 됐다.
   */
  it('짧아도 적는다 - 빈칸은 빠른 것과 못 재는 것을 못 가린다', () => {
    expect(describe(0)).toEqual({ kind: 'seconds', value: 1 })
    expect(describe(200)).toEqual({ kind: 'seconds', value: 1 })
    expect(describe(4999)).toEqual({ kind: 'seconds', value: 5 })
  })

  it('못 재는 것만 모른다고 한다', () => {
    expect(describe(null).kind).toBe('unknown')
    expect(describe(Number.NaN).kind).toBe('unknown')
  })

  it('올림한다 - 길게 틀리기로 했다', () => {
    expect(describe(3200)).toEqual({ kind: 'seconds', value: 4 })
    expect(describe(61_000)).toEqual({ kind: 'minutes', value: 2 })
  })

  it('짧은 쪽은 1초 단위, 긴 쪽은 5초 단위다 - 같은 단위가 짧은 쪽에서 크게 틀린다', () => {
    expect(describe(9400)).toEqual({ kind: 'seconds', value: 10 })
    expect(describe(10_100)).toEqual({ kind: 'seconds', value: 15 })
    expect(describe(27_000)).toEqual({ kind: 'seconds', value: 30 })
  })

  it('1분부터는 분으로 적는다', () => {
    expect(describe(59_000).kind).toBe('seconds')
    expect(describe(60_000)).toEqual({ kind: 'minutes', value: 1 })
  })
})

group('등록부', () => {
  it('모든 알고리즘이 기준표를 든다 - 새 알고리즘이 빈칸으로 들어오지 않는다', () => {
    for (const algorithm of ALGORITHMS) {
      expect(algorithm.baseline.tabular.ms.length, algorithm.id).toBeGreaterThan(1)
      expect(['linear', 'flat'], algorithm.id).toContain(algorithm.baseline.tabular.columns)
      // **이미지는 아직 안 쟀다.** 안 잰 칸이 조용히 숫자를 갖지 않는다.
      expect(algorithm.baseline.image.ms, algorithm.id).toEqual([])
    }
  })

  it('기준표의 행 수가 오름차순이다 - 보간이 그것을 전제한다', () => {
    for (const algorithm of ALGORITHMS) {
      const rows = algorithm.baseline.tabular.ms.map(([value]) => value)
      expect(rows, algorithm.id).toEqual([...rows].sort((a, b) => a - b))
    }
  })
})

group('전처리 뒤의 특성 수', () => {
  /**
   * **`fitPreprocessor`와 같은 수를 내야 한다.** 예상은 열 요약의 `unique`로 세고 학습은
   * 데이터를 훑는데, 원핫 규칙이 한쪽만 바뀌면 **예상 시간이 조용히 몇 배 틀린다** —
   * 트리 계열은 특성 수에 선형이라 그대로 배수가 된다.
   */
  const DATASET = {
    columns: ['키', '지역', '결과'],
    rows: [
      ['150', '서울', '가'],
      ['160', '부산', '가'],
      ['170', '대구', '나'],
      ['180', '서울', '나'],
    ],
  }
  const FEATURES = ['키', '지역']
  const ROWS = DATASET.rows.map((_, index) => index)

  for (const encoding of ['onehot', 'ordinal'] as const) {
    it(`${encoding} — 학습이 세는 수와 같다`, () => {
      const preprocessing = {
        missing: 'drop',
        scaling: 'none',
        categoricalEncoding: encoding,
      } as const
      const fitted = fitPreprocessor(DATASET, ROWS, FEATURES, preprocessing)
      const guessed = estimatedFeatureWidth(summarizeColumns(DATASET), FEATURES, encoding)
      expect(guessed).toBe(fitted.featureNames.length)
    })
  }

  it('부호화를 안 하면 범주 열은 통째로 빠진다', () => {
    expect(estimatedFeatureWidth(summarizeColumns(DATASET), FEATURES, 'none')).toBe(1)
  })
})

/**
 * **K-평균의 군집 수는 지배적인 손잡이다** (2026-09-01 재실측).
 *
 * 처음에는 `C`·최대 깊이와 함께 *"시간을 크게 안 바꾸는 나머지"*로 묶여 있었다.
 * **재 보니 2에서 20 사이가 8배가 넘는다** — 비용이 `행 × k × 특성 × 반복`이라 `k`가
 * 곧바로 붙는다. 누가 그 줄로 되돌리면 이 검사가 운다.
 */
group('K-평균의 군집 수', () => {
  function withClusters(clusters: number): number {
    return (
      baselineMs({ ...input('k_means', 20_000), hyperparameters: { nClusters: clusters } }) ?? 0
    )
  }

  it('군집 수를 올리면 예상이 그만큼 는다 - 무시하면 여덟 배 짧게 말한다', () => {
    const factor = withClusters(20) / withClusters(2)
    expect(factor).toBeGreaterThan(5)
  })

  it('기본값에서는 배수가 1이다 - 기준표를 그 값으로 쟀다', () => {
    expect(withClusters(3)).toBeCloseTo(baselineMs(input('k_means', 20_000)) ?? 0, 6)
  })

  it('특성 수에도 붙는다 - 거리 계산이 특성마다 돈다', () => {
    const wide = baselineMs(input('k_means', 20_000, 32)) ?? 0
    expect(wide).toBeCloseTo(withClusters(3) * 4, 6)
  })
})
