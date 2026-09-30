/**
 * **클래스 수 배수** (`open-decisions.md` "88. 학습 예상 시간이 클래스 수를 보는가").
 *
 * **배수의 규칙을 가짜 표로 잰다.** 진짜 표에 기대면 표를 다시 잴 때마다 기대값이 흔들리고, 빈
 * 칸이 있는지도 그때그때 다르다. 그래서 `limits.ts`를 갈아 끼워
 * **로지스틱 표만 채우고 SVM 표는 비운** 판을 만든다 — 빈 표는 예상을 안 바꾸고, 찬 표는 기준
 * 클래스 수 대비 배수를 건다. 진짜 표는 `estimate-class-tables.spec.ts`가 본다.
 */

import { describe, expect, it, vi } from 'vitest'

import { BASELINE_CLASSES } from '../src/limits'
import { CALIBRATION_JOBS, SYNTHETIC_CLASSES, syntheticData } from '../src/ml/calibration'
import { baselineMs, CLASS_TABLES, classFactor } from '../src/ml/estimate'

// `vi.mock`은 위 import보다 먼저 선다. 기준 클래스 수(3)에서 100, 10에서 300 — 배수 3이다.
vi.mock('../src/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/limits')>()),
  MLJS_LOGISTIC_REGRESSION_CLASSES_MS: [
    [2, 50],
    [3, 100],
    [10, 300],
    [20, 600],
  ],
  MLJS_SVM_CLASSES_MS: [],
}))

type Input = Parameters<typeof baselineMs>[0]

function input(algorithm: string, overrides: Partial<Input> = {}): Input {
  return {
    algorithm,
    dataType: 'tabular',
    rows: 1000,
    columns: 8,
    hyperparameters: {},
    runtime: 'mljs',
    ...overrides,
  }
}

describe('클래스 수 배수', () => {
  it('기준 클래스 수에서는 배수가 1이다', () => {
    expect(classFactor('mljs', 'logistic_regression', BASELINE_CLASSES)).toBeCloseTo(1)
  })

  it('표가 찬 칸은 기준 대비 배수를 건다', () => {
    const at3 = baselineMs(input('logistic_regression', { classes: BASELINE_CLASSES }))
    const at10 = baselineMs(input('logistic_regression', { classes: 10 }))
    expect(at3).not.toBeNull()
    expect((at10 ?? 0) / (at3 ?? 1)).toBeCloseTo(3)
  })

  it('빈 표는 예상을 안 바꾼다', () => {
    expect(baselineMs(input('svm', { classes: 20 }))).toBe(baselineMs(input('svm')))
  })

  it('클래스 수를 모르면 배수를 안 건다', () => {
    expect(baselineMs(input('logistic_regression', { classes: undefined }))).toBe(
      baselineMs(input('logistic_regression', { classes: BASELINE_CLASSES })),
    )
  })

  it('표가 없는 실행 방법은 순수 JS 표를 빌리지 않는다', () => {
    expect(classFactor('pyodide-sklearn', 'logistic_regression', 20)).toBe(1)
  })

  it('표가 없는 알고리즘은 배수가 없다', () => {
    expect(classFactor('mljs', 'knn', 20)).toBe(1)
  })

  /**
   * **교정 일감이 기준과 같은 클래스 수의 데이터로 돈다** (G 검토 B1). 합성 데이터의 기본 클래스 수가
   * 기준에서 벗어나면 기기 배수가 조용히 어긋나고 클래스 배수의 분모도 틀린다.
   */
  it('교정 데이터는 기준 클래스 수로 난다', () => {
    expect(SYNTHETIC_CLASSES).toBe(BASELINE_CLASSES)
    expect(new Set(syntheticData(60, 2).target).size).toBe(BASELINE_CLASSES)
    expect(CALIBRATION_JOBS.every((job) => !('classes' in job))).toBe(true)
  })

  it('분모는 칸마다 자기 기준 클래스 수다', () => {
    const tables = {
      ...CLASS_TABLES,
      mljs: {
        neural_network: {
          ms: [
            [2, 100],
            [4, 200],
          ] as const,
          measuredAt: 2,
        },
      },
    }
    expect(classFactor('mljs', 'neural_network', 4, tables)).toBeCloseTo(2)
  })
})
