// @vitest-environment jsdom

/**
 * 기기 배수 재기 (`ml/calibration.ts`).
 *
 * **가장 중요한 검사는 마지막 것이다** — 하니스가 앱과 같은 일감을 쓰는가. 기준값
 * (`CALIBRATION_BASELINE_MS`)을 잰 일감과 앱이 도는 일감이 갈리면 배수가 통째로
 * 어긋나는데, **그 어긋남은 화면 어디에도 안 나타난다.** 예상 시간만 조용히 틀린다.
 */

import { beforeEach, describe, expect, it } from 'vitest'

import { CALIBRATION } from '../tools/workloads'
import { CALIBRATION_BASELINE_MS } from '../src/limits'
import {
  CALIBRATION_JOBS,
  factorFrom,
  factorFromRun,
  readModelFactors,
  writeModelFactors,
  readFactor,
  runCalibration,
  syntheticData,
  writeFactor,
} from '../src/ml/calibration'

describe('기기 배수', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('잰 시간을 기준값으로 나눈 것이 배수다', () => {
    expect(factorFrom(CALIBRATION_BASELINE_MS)).toBeCloseTo(1, 12)
    expect(factorFrom(CALIBRATION_BASELINE_MS * 10)).toBeCloseTo(10, 12)
    // **1보다 작을 수 있다.** 개발 PC보다 빠른 기기가 실재한다.
    expect(factorFrom(CALIBRATION_BASELINE_MS / 2)).toBeCloseTo(0.5, 12)
  })

  it('0과 음수와 NaN은 배수가 아니다 - 그것을 쓰면 모든 예상이 0초가 된다', () => {
    expect(factorFrom(0)).toBeNull()
    expect(factorFrom(-1)).toBeNull()
    expect(factorFrom(Number.NaN)).toBeNull()
    expect(factorFrom(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('저장했다 읽으면 같은 값이다', () => {
    writeFactor(2.5)
    expect(readFactor()).toBeCloseTo(2.5, 12)
  })

  it('없거나 이상한 값은 없는 것으로 본다', () => {
    expect(readFactor()).toBeNull()
    for (const junk of ['', 'fast', '0', '-3', 'Infinity']) {
      window.localStorage.setItem('ml-playgrounds:device-factor', junk)
      expect(readFactor(), junk).toBeNull()
    }
  })

  it('데이터는 결정적이다 - 기기마다 같은 것을 봐야 배수가 데이터 차이를 안 담는다', () => {
    const first = syntheticData(50, 4)
    const second = syntheticData(50, 4)
    expect(first).toEqual(second)
    expect(first.features[0]).toHaveLength(4)
    expect(first.target).toHaveLength(50)
  })

  it('회귀는 타깃이 수치다', () => {
    const { target } = syntheticData(20, 3, true)
    expect(target.every((value) => Number.isFinite(Number(value)))).toBe(true)
  })

  it('실제로 시간을 낸다', () => {
    expect(runCalibration()).toBeGreaterThan(0)
  })

  it('하니스가 앱과 같은 일감을 쓴다 - 갈리면 배수가 통째로 어긋난다', () => {
    expect(CALIBRATION).toBe(CALIBRATION_JOBS)
  })

  it('두 종류를 섞는다 - 한쪽만 재면 다른 쪽이 다른 배수인 기기에서 어긋난다', () => {
    const algorithms = CALIBRATION_JOBS.map((job) => job.algorithm)
    expect(algorithms).toContain('decision_tree')
    expect(algorithms).toContain('logistic_regression')
  })
})

/**
 * **학습이 끝날 때마다 배수를 다듬는다** (`open-decisions.md`의 "그다음 학습이 배수를
 * 다듬는다"). 교정 일감이 낸 값은 **첫 학습 전까지의 어림**이고, 진짜 값은 학생의
 * 데이터로 실제로 돌아 본 시간이다.
 */
describe('학습 뒤 배수 보정', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('실제를 예상으로 나눈 것이 새 배수다', () => {
    expect(factorFromRun(300, 100)).toBeCloseTo(3, 12)
    // 예상보다 빨랐으면 1보다 작다. 그것도 사실이다.
    expect(factorFromRun(50, 100)).toBeCloseTo(0.5, 12)
  })

  it('0과 음수와 NaN은 배수가 아니다', () => {
    expect(factorFromRun(0, 100)).toBeNull()
    expect(factorFromRun(100, 0)).toBeNull()
    expect(factorFromRun(Number.NaN, 100)).toBeNull()
    expect(factorFromRun(100, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it('저장했다 읽으면 같은 값이다', () => {
    writeModelFactors({ decision_tree: 2.5, k_means: 0.5 })
    expect(readModelFactors()).toEqual({ decision_tree: 2.5, k_means: 0.5 })
  })

  it('없거나 깨졌으면 빈 것이다 - 지어내지 않는다', () => {
    expect(readModelFactors()).toEqual({})
    for (const junk of ['', '{', 'null', '[]', '"fast"', '3']) {
      window.localStorage.setItem('ml-playgrounds:model-factors', junk)
      expect(readModelFactors(), junk).toEqual({})
    }
  })

  /**
   * **깨진 항목만 버린다.** 하나가 이상하다고 전부 버리면, 손으로 한 줄을 망가뜨린
   * 학생이 그 기기에서 잰 나머지를 통째로 잃는다.
   */
  it('이상한 항목만 걷어낸다', () => {
    window.localStorage.setItem(
      'ml-playgrounds:model-factors',
      JSON.stringify({ decision_tree: 2, knn: 0, svm: -1, k_means: 'fast', naive_bayes: 1.5 }),
    )
    expect(readModelFactors()).toEqual({ decision_tree: 2, naive_bayes: 1.5 })
  })

  /**
   * **알고리즘마다 따로 두는 것이 요점이다.** 하나로 두면 기준표가 크게 틀린
   * 알고리즘의 오차가 다른 알고리즘의 예상으로 옮는다 — K-평균이 실제로 그랬다.
   */
  it('한 알고리즘의 보정이 다른 알고리즘을 안 건드린다', () => {
    writeModelFactors({ ...readModelFactors(), k_means: 70 })
    expect(readModelFactors().decision_tree).toBeUndefined()
    writeModelFactors({ ...readModelFactors(), decision_tree: 1.2 })
    expect(readModelFactors()).toEqual({ k_means: 70, decision_tree: 1.2 })
  })
})
