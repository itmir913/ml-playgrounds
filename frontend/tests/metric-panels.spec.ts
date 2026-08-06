/**
 * 결과 화면의 상세 패널 등록부.
 *
 * **여기서 지키는 것은 "화면에 조건이 안 생기는가"다.** 축 어휘는 타입이 지키므로
 * (ml/axes.ts) 다시 세지 않는다. 타입이 못 잡는 셋을 본다 - 아무 데서도 안 서는 줄,
 * 학습이 되는데 볼 것이 없는 조합, 그리고 담기지 않은 실행을 걸러내는가.
 */

import { describe, expect, it } from 'vitest'

import { ALGORITHMS } from '../src/ml/algorithms'
import { METRIC_PANELS, metricPanelsFor } from '../src/ml/metric-panels'
import { metricsOf } from '../src/ml/metrics'
import { DATA_TYPES, TASK_TYPES, type Run } from '../src/project/schema'

/** 분류 실행 하나. 담긴 것을 골라 가며 쓴다. */
function run(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    algorithm: 'decision_tree',
    hyperparameters: {},
    trainedAt: '2026-08-06T00:00:00.000Z',
    status: 'done',
    computedBy: 'browser',
    ...overrides,
  }
}

const classified = run({
  confusionMatrix: {
    labels: ['a', 'b'],
    matrix: [
      [1, 0],
      [0, 1],
    ],
  },
  perClass: [{ label: 'a', precision: 1, recall: 1, f1: 1, support: 1 }],
})

describe('상세 패널 등록부', () => {
  it('id가 겹치지 않는다', () => {
    expect(new Set(METRIC_PANELS.map((panel) => panel.id)).size).toBe(METRIC_PANELS.length)
  })

  it('아무 데서도 안 서는 줄이 없다', () => {
    // 칸을 다 채웠는데 전부 false인 줄은 화면 어디에도 안 나온다. 지웠어야 할 줄이다.
    for (const panel of METRIC_PANELS) {
      expect(
        DATA_TYPES.some((dataType) => panel.dataTypes[dataType]),
        panel.id,
      ).toBe(true)
      expect(
        TASK_TYPES.some((taskType) => panel.taskTypes[taskType]),
        panel.id,
      ).toBe(true)
    }
  })

  it('학습이 되는 조합에는 볼 지표가 있다', () => {
    // **패널이 아니라 지표를 센다** (architecture.md §9.3). 패널이 0개인 것은 정상인
    // 조합이 있다 - 회귀가 그렇다. 지표까지 0개면 학습은 됐는데 볼 것이 없다.
    for (const dataType of DATA_TYPES) {
      for (const taskType of TASK_TYPES) {
        const trainable = ALGORITHMS.some(
          (algorithm) => algorithm.dataTypes[dataType] && algorithm.taskTypes[taskType],
        )
        if (!trainable) continue
        expect(metricsOf(taskType).length, `${dataType} x ${taskType}`).toBeGreaterThan(0)
      }
    }
  })

  it('분류에는 혼동 행렬과 값 종류별 점수가 선다', () => {
    const ids = metricPanelsFor('tabular', 'classification', classified).map((panel) => panel.id)
    expect(ids).toEqual(['confusion-matrix', 'per-class'])
  })

  it('회귀에는 아무것도 안 선다 - 그것이 정상이다', () => {
    expect(metricPanelsFor('tabular', 'regression', classified)).toEqual([])
  })

  it('축이 맞아도 담기지 않았으면 안 선다', () => {
    // 옛 파일과 예산에서 밀린 실행이 그렇다 (mlpx-spec.md §4.2). 축과 별개의 판정이다.
    const ids = metricPanelsFor('tabular', 'classification', run({ perClass: [] })).map(
      (panel) => panel.id,
    )
    expect(ids).toEqual(['per-class'])
  })

  it('표에 없는 데이터 종류에서는 아무것도 안 선다', () => {
    expect(metricPanelsFor('image', 'classification', classified)).toEqual([])
  })
})
