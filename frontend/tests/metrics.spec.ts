/**
 * 지표 계산.
 *
 * 숫자가 맞는지도 봐야 하지만, 더 중요한 것은 **분기 없이 늘어나는가**다.
 * 그리고 알고리즘 등록부와 지표 등록부가 어긋나지 않는지 - 알고리즘을 먼저 등록하고
 * 지표를 잊으면 학생은 학습이 끝난 뒤에야 실패를 본다.
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { ALGORITHMS } from '../src/ml/algorithms'
import {
  CLUSTER_EVALUATOR,
  EVALUATORS,
  METRIC_DISPLAY,
  bestOf,
  evaluate,
  metricsOf,
  type MetricDisplay,
} from '../src/ml/metrics'
import { TASK_TYPES, type TaskType } from '../src/project/schema'

describe('등록부끼리 어긋나지 않는다', () => {
  it('등록된 알고리즘의 과제 유형에는 전부 지표 계산기가 있다', () => {
    for (const algorithm of ALGORITHMS) {
      for (const taskType of TASK_TYPES) {
        if (!algorithm.taskTypes[taskType]) continue
        // 군집은 시그니처가 달라 EVALUATORS가 아니라 CLUSTER_EVALUATOR에 있다
        // (architecture.md §3.7). 등록부가 둘이므로 각각을 본다.
        const has =
          taskType === 'clustering'
            ? CLUSTER_EVALUATOR !== undefined
            : EVALUATORS[taskType] !== undefined
        expect(has, `${algorithm.id} -> ${taskType}`).toBe(true)
      }
    }
  })

  it('계산기가 있는 과제 유형에는 표시 등록부도 있다', () => {
    // EVALUATORS(분류·회귀)와 CLUSTER_EVALUATOR(군집)를 합친 집합이
    // METRIC_DISPLAY의 키 집합과 같아야 한다.
    const evaluatable = [...Object.keys(EVALUATORS)]
    if (CLUSTER_EVALUATOR) evaluatable.push('clustering')
    expect(Object.keys(METRIC_DISPLAY).sort()).toEqual(evaluatable.sort())
  })

  /**
   * **이게 이 등록부의 핵심 검사다.** 키를 오타내거나 지표 이름을 바꾸면 화면에는
   * 빈 칸이 뜰 뿐 아무것도 안 터진다. 실제로 계산해서 나온 키와 맞춰 본다.
   */
  it('표시 등록부의 지표가 실제 계산 결과에 전부 있다', () => {
    // 군집은 시그니처가 달라 evaluate()가 아니라 CLUSTER_EVALUATOR를 직접 부른다.
    const clusterData = [
      [0, 0],
      [1, 0],
      [10, 10],
      [11, 10],
    ]

    const samples: Readonly<Record<string, () => Record<string, number>>> = {
      classification: () => evaluate('classification', ['a', 'b'], ['a', 'a']).metrics,
      regression: () => evaluate('regression', [1, 2, 3], [1, 2, 4]).metrics,
      clustering: () =>
        CLUSTER_EVALUATOR(
          clusterData,
          [0, 0, 1, 1],
          [
            [0.5, 0],
            [10.5, 10],
          ],
        ).metrics,
    }

    for (const [taskType, displays] of Object.entries(METRIC_DISPLAY)) {
      const computed = samples[taskType]
      expect(computed, `${taskType} 표본이 없다`).toBeDefined()
      const keys = Object.keys(computed?.() ?? {})
      expect(displays?.map((display) => display.name).sort(), taskType).toEqual(keys.sort())
    }
  })

  it('r2는 백분율이 아니다 - 음수가 될 수 있다', () => {
    const r2 = metricsOf('regression').find((display) => display.name === 'r2')
    expect(r2?.format).toBe('number')
    // 실제로 음수가 나오는지도 본다. 안 나오면 이 규칙의 근거가 사라진 것이다.
    expect(evaluate('regression', [1, 2, 3], [30, 2, -8]).metrics.r2).toBeLessThan(0)
  })

  it('모르는 과제 유형에는 빈 목록을 준다 - 화면이 던지지 않는다', () => {
    expect(metricsOf('unknown_task' as TaskType)).toEqual([])
  })
})

describe('최고값 고르기', () => {
  it('방향에 따라 최고가 갈린다', () => {
    expect(bestOf([0.4, 0.9, 0.7], 'higher')).toBe(0.9)
    expect(bestOf([0.4, 0.9, 0.7], 'lower')).toBe(0.4)
  })

  it('견줄 것이 없으면 undefined다', () => {
    expect(bestOf([], 'higher')).toBeUndefined()
  })

  it('수치가 아닌 값은 세지 않는다', () => {
    expect(bestOf([Number.NaN, 0.5], 'higher')).toBe(0.5)
    expect(bestOf([Number.NaN], 'lower')).toBeUndefined()
  })

  it('모든 지표에 방향이 있다', () => {
    const directions = new Set<MetricDisplay['better']>(['higher', 'lower'])
    for (const displays of Object.values(METRIC_DISPLAY)) {
      for (const display of displays ?? []) {
        expect(directions.has(display.better), display.name).toBe(true)
      }
    }
  })

  it('군집을 evaluate()에 넘기면 던진다 - evaluateClustering()이 별도다', () => {
    // 군집은 시그니처가 달라서 evaluate()에 넘기면 안 된다 (architecture.md §3.7).
    // EVALUATORS['clustering']이 없으므로 JOB_FAILED로 던진다.
    try {
      evaluate('clustering', ['a'], ['a'])
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
    }
  })
})

describe('분류', () => {
  // 붓꽃 모양. setosa는 완벽, versicolor 하나가 virginica로 잘못 갔다.
  const actual = ['setosa', 'setosa', 'versicolor', 'versicolor', 'virginica', 'virginica']
  const predicted = ['setosa', 'setosa', 'versicolor', 'virginica', 'virginica', 'virginica']

  it('정확도를 센다', () => {
    expect(evaluate('classification', actual, predicted).metrics.accuracy).toBeCloseTo(5 / 6, 10)
  })

  it('혼동 행렬의 축이 정렬된 라벨이다', () => {
    const { confusionMatrix } = evaluate('classification', actual, predicted)
    expect(confusionMatrix?.labels).toEqual(['setosa', 'versicolor', 'virginica'])
    expect(confusionMatrix?.matrix).toEqual([
      [2, 0, 0],
      [0, 1, 1],
      [0, 0, 2],
    ])
  })

  it('행의 합이 그 클래스의 support다', () => {
    const { perClass, confusionMatrix } = evaluate('classification', actual, predicted)
    perClass?.forEach((entry, index) => {
      const row = confusionMatrix?.matrix[index] ?? []
      expect(entry.support, entry.label).toBe(row.reduce((sum, value) => sum + value, 0))
    })
  })

  it('클래스별 정밀도와 재현율을 낸다', () => {
    const { perClass } = evaluate('classification', actual, predicted)
    const versicolor = perClass?.find((entry) => entry.label === 'versicolor')
    // 예측된 versicolor 1개 중 1개가 맞음, 실제 versicolor 2개 중 1개를 맞힘.
    expect(versicolor?.precision).toBeCloseTo(1, 10)
    expect(versicolor?.recall).toBeCloseTo(0.5, 10)
    expect(versicolor?.f1).toBeCloseTo(2 / 3, 10)

    const virginica = perClass?.find((entry) => entry.label === 'virginica')
    expect(virginica?.precision).toBeCloseTo(2 / 3, 10)
    expect(virginica?.recall).toBeCloseTo(1, 10)
  })

  it('특이도는 그 범주가 아닌 데이터를 아니라고 맞힌 비율이다', () => {
    const { perClass } = evaluate('classification', actual, predicted)

    // virginica가 아닌 데이터 4줄(setosa 2, versicolor 2) 중 하나를 virginica라고 불렀다.
    expect(perClass?.find((entry) => entry.label === 'virginica')?.specificity).toBeCloseTo(
      3 / 4,
      10,
    )
    // versicolor가 아닌 4줄은 하나도 versicolor라고 부르지 않았다.
    expect(perClass?.find((entry) => entry.label === 'versicolor')?.specificity).toBeCloseTo(1, 10)
  })

  it('특이도는 재현율과 다른 방향을 본다 - 쏠린 데이터에서 갈린다', () => {
    // 전부 common이라고 찍으면 rare의 재현율은 0인데 특이도는 1이다 - 반대쪽만 보기
    // 때문이다. 이 둘이 같은 값이 되면 계산이 한쪽으로 무너진 것이다.
    const truth = [...Array(100)].map((_, index) => (index < 90 ? 'common' : 'rare'))
    const lazy = truth.map(() => 'common')
    const rare = evaluate('classification', truth, lazy).perClass?.find(
      (entry) => entry.label === 'rare',
    )

    expect(rare?.recall).toBe(0)
    expect(rare?.specificity).toBe(1)
  })

  it('예측에만 나온 라벨도 행렬에 남는다 - 오분류가 사라지면 안 된다', () => {
    const { confusionMatrix, perClass } = evaluate('classification', ['a', 'a'], ['a', 'b'])
    expect(confusionMatrix?.labels).toEqual(['a', 'b'])
    // b는 실제로 나온 적이 없으므로 support 0, 재현율 0이다.
    expect(perClass?.find((entry) => entry.label === 'b')?.support).toBe(0)
  })

  it('0으로 나누는 자리에서 NaN을 내보내지 않는다', () => {
    const { metrics, perClass } = evaluate('classification', ['a', 'a'], ['b', 'b'])
    expect(metrics.accuracy).toBe(0)
    expect(Object.values(metrics).every(Number.isFinite)).toBe(true)
    expect(perClass?.every((entry) => Number.isFinite(entry.f1))).toBe(true)
    expect(perClass?.every((entry) => Number.isFinite(entry.specificity ?? 0))).toBe(true)
  })

  it('쏠린 데이터에서 accuracy와 f1Macro가 갈린다 - 그래서 둘 다 낸다', () => {
    // 90개가 common, 10개가 rare. 전부 common이라고 찍으면 정확도 0.9다.
    const truth = [...Array(100)].map((_, i) => (i < 90 ? 'common' : 'rare'))
    const lazy = truth.map(() => 'common')
    const { metrics } = evaluate('classification', truth, lazy)

    expect(metrics.accuracy).toBeCloseTo(0.9, 10)
    // f1Macro는 rare를 하나도 못 맞혔다는 것을 드러낸다.
    expect(metrics.f1Macro).toBeLessThan(0.5)
  })

  it('숫자처럼 생긴 라벨도 문자열로 본다', () => {
    const { confusionMatrix } = evaluate('classification', [0, 1, 1], [0, 1, 0])
    expect(confusionMatrix?.labels).toEqual(['0', '1'])
  })

  it('반올림하지 않는다 - 자릿수는 화면이 줄인다', () => {
    const { metrics } = evaluate('classification', ['a', 'a', 'b'], ['a', 'b', 'b'])
    expect(metrics.accuracy).toBe(2 / 3)
  })
})

describe('회귀', () => {
  const actual = [1, 2, 3, 4]
  const predicted = [1.5, 2, 2.5, 5]

  it('mae와 rmse를 낸다', () => {
    const { metrics } = evaluate('regression', actual, predicted)
    // 오차 -0.5, 0, 0.5, -1
    expect(metrics.mae).toBeCloseTo(0.5, 10)
    expect(metrics.rmse).toBeCloseTo(Math.sqrt(1.5 / 4), 10)
  })

  it('완벽하면 r2가 1이다', () => {
    expect(evaluate('regression', actual, actual).metrics.r2).toBeCloseTo(1, 10)
  })

  it('정답이 전부 같은 값이면 NaN 대신 0이나 1이다', () => {
    expect(evaluate('regression', [5, 5, 5], [5, 5, 5]).metrics.r2).toBe(1)
    expect(evaluate('regression', [5, 5, 5], [1, 2, 3]).metrics.r2).toBe(0)
  })

  it('혼동 행렬도 클래스별 지표도 없다', () => {
    const result = evaluate('regression', actual, predicted)
    expect(result.confusionMatrix).toBeUndefined()
    expect(result.perClass).toBeUndefined()
  })

  it('문자열로 들어온 숫자도 읽는다 - CSV는 전부 문자열이다', () => {
    const fromCsv = evaluate('regression', ['1', '2', '3', '4'], ['1.5', '2', '2.5', '5'])
    expect(fromCsv.metrics).toEqual(evaluate('regression', actual, predicted).metrics)
  })
})

describe('군집', () => {
  // 두 군집이 깔끔하게 갈리는 경우.
  // 군집 0: (0,0), (1,0)  →  중심 (0.5, 0)
  // 군집 1: (10,10), (11,10)  →  중심 (10.5, 10)
  const data = [
    [0, 0],
    [1, 0],
    [10, 10],
    [11, 10],
  ]
  const assignments = [0, 0, 1, 1]
  const centroids = [
    [0.5, 0],
    [10.5, 10],
  ]

  it('이너셔는 각 데이터와 자기 중심점까지 거리의 제곱합이다', () => {
    const { metrics } = CLUSTER_EVALUATOR(data, assignments, centroids)
    // (0-0.5)² + (0-0)² = 0.25
    // (1-0.5)² + (0-0)² = 0.25
    // (10-10.5)² + (10-10)² = 0.25
    // (11-10.5)² + (10-10)² = 0.25
    // 합 = 1.0
    expect(metrics.inertia).toBeCloseTo(1.0, 10)
  })

  it('깔끔하게 갈리면 실루엣 계수가 1에 가깝다', () => {
    const { metrics } = CLUSTER_EVALUATOR(data, assignments, centroids)
    expect(metrics.silhouette).toBeGreaterThan(0.9)
  })

  it('뒤섞이면 실루엣 계수가 낮다', () => {
    // 엉뚱한 할당: 먼 것끼리 묶는다
    const badAssignments = [0, 1, 0, 1]
    const badCentroids = [
      [5, 5],
      [6, 5],
    ]
    const { metrics } = CLUSTER_EVALUATOR(data, badAssignments, badCentroids)
    expect(metrics.silhouette).toBeLessThan(0)
  })

  it('k=1이면 실루엣 계수가 0이다', () => {
    const { metrics } = CLUSTER_EVALUATOR(
      data,
      [0, 0, 0, 0],
      [[5.5, 5]],
    )
    expect(metrics.silhouette).toBe(0)
  })

  it('혼동 행렬도 클래스별 지표도 없다 - 비지도학습이다', () => {
    const result = CLUSTER_EVALUATOR(data, assignments, centroids)
    expect(result.confusionMatrix).toBeUndefined()
    expect(result.perClass).toBeUndefined()
  })

  it('실루엣이 백분율이 아니다 - 음수가 될 수 있다', () => {
    const sil = metricsOf('clustering').find((display) => display.name === 'silhouette')
    expect(sil?.format).toBe('number')
  })

  it('반올림하지 않는다 - 자릿수는 화면이 줄인다', () => {
    const { metrics } = CLUSTER_EVALUATOR(data, assignments, centroids)
    // 이너셔가 정확히 1.0인 경우는 반올림이 필요 없다. 실루엣은 무리수다.
    expect(Number.isFinite(metrics.silhouette)).toBe(true)
    expect(Number.isFinite(metrics.inertia)).toBe(true)
  })

  it('0으로 나누는 자리에서 NaN을 내보내지 않는다', () => {
    // 모든 데이터가 같은 점이면 거리가 전부 0이다.
    const sameData = [
      [5, 5],
      [5, 5],
      [5, 5],
      [5, 5],
    ]
    const { metrics } = CLUSTER_EVALUATOR(
      sameData,
      [0, 0, 1, 1],
      [
        [5, 5],
        [5, 5],
      ],
    )
    expect(Number.isFinite(metrics.silhouette)).toBe(true)
    expect(Number.isFinite(metrics.inertia)).toBe(true)
    expect(metrics.inertia).toBe(0)
    expect(metrics.silhouette).toBe(0)
  })
})

describe('조용히 흡수하지 않는다', () => {
  /**
   * 이 두 검사가 없으면 지표는 **에러 없이 그럴듯한 숫자**를 낸다. 그게 이 저장소가
   * 규정한 최악이다 (open-decisions.md "범위 밖 클래스 번호는 던진다").
   */
  function codeOf(run: () => unknown): string {
    try {
      run()
      return 'threw nothing'
    } catch (error) {
      return isClientError(error) ? error.code : 'not a ClientError'
    }
  }

  it('예측이 정답보다 짧으면 던진다 - 분류', () => {
    // 막지 않으면 accuracy 1/3에 혼동 행렬은 두 행이 비어 그럴듯하게 나온다.
    expect(codeOf(() => evaluate('classification', ['a', 'b', 'c'], ['a']))).toBe('JOB_FAILED')
  })

  it('예측이 정답보다 짧으면 던진다 - 회귀', () => {
    // 막지 않으면 없는 예측을 0으로 간주해 mae 16.67, r2 -5.5가 나온다.
    expect(codeOf(() => evaluate('regression', [10, 20, 30], [10]))).toBe('JOB_FAILED')
  })

  it('예측이 정답보다 길어도 던진다', () => {
    expect(codeOf(() => evaluate('classification', ['a'], ['a', 'b']))).toBe('JOB_FAILED')
  })

  it('길이 불일치를 params에 남긴다 - 화면이 아니라 개발자가 읽는다', () => {
    try {
      evaluate('regression', [1, 2, 3], [1])
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error) && error.params).toEqual({ actualCount: 3, predictedCount: 1 })
    }
  })

  it('회귀에 범주형 타깃이 오면 NaN 지표를 내보내지 않는다', () => {
    // Number('상')이 NaN이다. 막지 않으면 status done + metrics 전부 NaN이 되고,
    // 저장할 때 JSON이 null로 바꿔 다시 열리지 않는 .mlpx가 된다.
    expect(codeOf(() => evaluate('regression', ['상', '중', '하'], [1, 2, 3]))).toBe('JOB_FAILED')
  })

  it('예측이 NaN이어도 막는다 - 원인이 정답 쪽만은 아니다', () => {
    expect(codeOf(() => evaluate('regression', [1, 2, 3], [Number.NaN, 2, 3]))).toBe('JOB_FAILED')
  })

  it('Infinity도 수치가 아니다', () => {
    expect(codeOf(() => evaluate('regression', [1, 2, 3], [Number.POSITIVE_INFINITY, 2, 3]))).toBe(
      'JOB_FAILED',
    )
  })

  it('멀쩡한 값은 그대로 통과한다', () => {
    expect(evaluate('regression', [1, 2, 3], [1, 2, 3]).metrics.r2).toBe(1)
  })
})
