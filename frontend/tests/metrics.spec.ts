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
import { EVALUATORS, evaluate } from '../src/ml/metrics'

describe('등록부끼리 어긋나지 않는다', () => {
  it('등록된 알고리즘의 과제 유형에는 전부 지표 계산기가 있다', () => {
    for (const algorithm of ALGORITHMS) {
      for (const taskType of algorithm.taskTypes) {
        expect(EVALUATORS[taskType], `${algorithm.id} -> ${taskType}`).toBeDefined()
      }
    }
  })

  it('계산기가 없는 과제 유형은 조용히 넘어가지 않는다', () => {
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
