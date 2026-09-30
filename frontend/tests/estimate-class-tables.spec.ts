/**
 * **실제 클래스 배수표** (`open-decisions.md` "88. 학습 예상 시간이 클래스 수를 보는가").
 *
 * `estimate-classes.spec.ts`는 `limits.ts`를 갈아 끼운 가짜 표로 배수의 **규칙**을 잰다. 이 파일은
 * 갈아 끼우지 않고 **등록부에 실린 진짜 표**를 본다 — 칸이 제 이름의 실측 상수를 가리키는가, 비어
 * 있지 않은가, 모양이 한 방향인가. 가짜 표만 보면 칸을 엇갈려 꽂아도 초록이다.
 */

import { describe, expect, it } from 'vitest'

import * as limits from '../src/limits'
import { CLASS_TABLES, classFactor } from '../src/ml/estimate'

describe('실제 클래스 배수표', () => {
  /**
   * **칸마다 자기 이름의 상수다.** 칸 이름(알고리즘 id)에서 상수 이름을 지어 `toBe`로 견준다 —
   * 옆 칸의 표를 꽂으면 운다. **단조다** — 실측 판에서 표마다 한 방향이었고(`limits.ts`의
   * `MLJS_*_CLASSES_MS` 주석), 한 칸이 뒤집히면 보간이 그 사이에서 오르내린다.
   */
  it('순수 JS 표는 칸마다 자기 이름의 실측 상수이고 비어 있지 않으며 단조다', () => {
    const entries = Object.entries(CLASS_TABLES.mljs)
    expect(entries.length).toBeGreaterThan(0)
    for (const [algorithm, table] of entries) {
      const name = `MLJS_${algorithm.toUpperCase()}_CLASSES_MS`
      expect(name in limits, name).toBe(true)
      expect(table?.ms, algorithm).toBe(limits[name as keyof typeof limits])
      const ms = (table?.ms ?? []).map(([, value]) => value)
      expect(ms.length, algorithm).toBeGreaterThan(0)
      const up = ms.every((value, at) => at === 0 || value > (ms[at - 1] ?? 0))
      const down = ms.every((value, at) => at === 0 || value < (ms[at - 1] ?? 0))
      expect(up || down, `${algorithm} monotone`).toBe(true)
    }
  })

  /**
   * **표 위로는 기울기를 1 아래로 안 내린다** (`ml/estimate.ts`의 `interpolate`). SVM은 클래스가 늘수록
   * 빨라지는 표라, 바닥이 없으면 표 밖(20 초과)을 마지막 점보다 짧게 말한다 — 이 파일이 피하려는
   * 방향이다.
   */
  it('표 위의 클래스 배수는 표의 끝보다 작아지지 않는다 - 줄어드는 SVM 표에서도', () => {
    // 전제: SVM 표는 줄어든다. 늘어나는 표에서는 바닥이 없어도 이 검사가 초록이라 뜻이 없다.
    expect(classFactor('mljs', 'svm', 20)).toBeLessThan(classFactor('mljs', 'svm', 2))
    expect(classFactor('mljs', 'svm', 40)).toBeGreaterThanOrEqual(classFactor('mljs', 'svm', 20))
    // **바닥은 정확히 1이다** — 표의 끝에서 클래스가 두 배면 배수도 두 배다. `>=`만 보면 바닥이 0이어도
    // (표 밖이 평평해도) 초록이다.
    expect(classFactor('mljs', 'svm', 40) / classFactor('mljs', 'svm', 20)).toBeCloseTo(2, 9)
  })

  /** **분모는 칸마다 자기 기준 클래스 수다** — 인공신경망만 이진에서 쟀다(`limits.ts`). */
  it('신경망 칸의 분모는 신경망 기준 클래스 수이고 나머지는 공통 기준이다', () => {
    expect(CLASS_TABLES.mljs.neural_network).toBeDefined()
    for (const [algorithm, table] of Object.entries(CLASS_TABLES.mljs)) {
      const expected =
        algorithm === 'neural_network'
          ? limits.MLJS_NEURAL_NETWORK_BASELINE_CLASSES
          : limits.BASELINE_CLASSES
      expect(table?.measuredAt, algorithm).toBe(expected)
    }
  })
})
