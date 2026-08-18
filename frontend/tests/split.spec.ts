/**
 * 학습셋/평가셋 분할.
 *
 * 여기가 틀리면 **그 위의 전부가 조용히 틀린다.** 지표는 멀쩡해 보이는데 다른 행으로
 * 학습된 것이고, 아무도 눈치채지 못한다. 그래서 확인하는 것 셋.
 *
 *   1. 같은 randomState면 언제나 같은 분할이 나오는가 (재현 가능성)
 *   2. 인덱스가 **원본 행 번호**인가 (참조형 모델이 이 번호로 CSV를 가리킨다)
 *   3. 층화가 정말 비율을 지키는가
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { MIN_SPLIT_ROWS } from '../src/limits'
import { holdoutSplit, splitRows } from '../src/ml/split'
import type { Split } from '../src/project/schema'

const split = (overrides: Partial<Split> = {}): Split => ({
  method: 'holdout',
  testSize: 0.2,
  stratify: false,
  randomState: 42,
  ...overrides,
})

const rows = (count: number): number[] => [...Array(count).keys()]

/** 붓꽃 모양 - 세 품종이 50개씩. 교실에서 제일 자주 쓰는 데이터다. */
function iris(): { rows: number[]; labels: string[] } {
  const labels = [...Array(150)].map(
    (_, i) => ['setosa', 'versicolor', 'virginica'][i % 3] as string,
  )
  return { rows: rows(150), labels }
}

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    if (isClientError(error)) return error.code
    throw error
  }
  throw new Error('던지지 않았다')
}

describe('재현 가능성', () => {
  it('같은 randomState면 같은 분할이 나온다', () => {
    const first = holdoutSplit({ rows: rows(100) }, split())
    const second = holdoutSplit({ rows: rows(100) }, split())
    expect(second).toEqual(first)
  })

  it('randomState가 다르면 분할도 다르다', () => {
    const first = holdoutSplit({ rows: rows(100) }, split())
    const second = holdoutSplit({ rows: rows(100) }, split({ randomState: 43 }))
    expect(second.testIndices).not.toEqual(first.testIndices)
  })

  it('층화도 재현된다', () => {
    const data = iris()
    const options = split({ stratify: true })
    expect(holdoutSplit(data, options)).toEqual(holdoutSplit(data, options))
  })

  it('라벨마다 다른 순열을 쓴다 - 크기가 같은 두 라벨이 같은 자리를 고르지 않는다', () => {
    // cat과 dog는 길이가 같다. 시드를 라벨 길이로만 흔들면 여기서 겹친다.
    const labels = [...Array(40)].map((_, i) => (i % 2 === 0 ? 'cat' : 'dog'))
    const { testIndices } = holdoutSplit(
      { rows: rows(40), labels },
      split({ stratify: true, testSize: 0.25 }),
    )
    const cats = testIndices.filter((index) => index % 2 === 0).map((index) => index / 2)
    const dogs = testIndices.filter((index) => index % 2 === 1).map((index) => (index - 1) / 2)
    expect(cats).not.toEqual(dogs)
  })
})

describe('인덱스가 원본 행 번호다', () => {
  it('빠진 행이 있어도 번호를 다시 세지 않는다', () => {
    // 결측 때문에 1, 3, 5번 행이 빠졌다. 남은 행의 번호는 그대로여야 한다.
    const usable = [0, 2, 4, 6, 7, 8, 9, 10]
    const { trainIndices, testIndices } = holdoutSplit({ rows: usable }, split())

    expect([...trainIndices, ...testIndices].sort((a, b) => a - b)).toEqual(usable)
  })

  it('학습셋과 평가셋이 겹치지 않고 합치면 전체가 된다', () => {
    const { trainIndices, testIndices } = holdoutSplit({ rows: rows(100) }, split())

    expect(new Set([...trainIndices, ...testIndices]).size).toBe(100)
    expect(trainIndices.filter((index) => testIndices.includes(index))).toEqual([])
  })

  it('오름차순으로 나온다 - 학생이 runs.json을 열어볼 수 있어야 한다', () => {
    const { trainIndices, testIndices } = holdoutSplit(iris(), split({ stratify: true }))

    expect(trainIndices).toEqual([...trainIndices].sort((a, b) => a - b))
    expect(testIndices).toEqual([...testIndices].sort((a, b) => a - b))
  })
})

describe('testSize', () => {
  it('비율만큼 평가셋으로 간다', () => {
    const { testIndices } = holdoutSplit({ rows: rows(100) }, split({ testSize: 0.3 }))
    expect(testIndices).toHaveLength(30)
  })

  it('반올림해서 0이 나와도 평가셋에 하나는 남는다', () => {
    // 4행 x 0.01 = 0.04 -> 반올림하면 0이다. 평가할 것이 없으면 지표가 의미를 잃는다.
    const { trainIndices, testIndices } = holdoutSplit({ rows: rows(4) }, split({ testSize: 0.01 }))
    expect(testIndices).toHaveLength(1)
    expect(trainIndices).toHaveLength(3)
  })

  it('거의 전부를 평가셋으로 보내도 학습셋에 하나는 남는다', () => {
    const { trainIndices, testIndices } = holdoutSplit({ rows: rows(4) }, split({ testSize: 0.99 }))
    expect(trainIndices).toHaveLength(1)
    expect(testIndices).toHaveLength(3)
  })
})

describe('층화', () => {
  it('라벨 비율이 양쪽에서 유지된다', () => {
    const { rows: all, labels } = iris()
    const { trainIndices, testIndices } = holdoutSplit(
      { rows: all, labels },
      split({ stratify: true }),
    )
    const countByLabel = (indices: number[]): Record<string, number> => {
      const counts: Record<string, number> = {}
      for (const index of indices) {
        const label = labels[index] as string
        counts[label] = (counts[label] ?? 0) + 1
      }
      return counts
    }

    expect(countByLabel(testIndices)).toEqual({ setosa: 10, versicolor: 10, virginica: 10 })
    expect(countByLabel(trainIndices)).toEqual({ setosa: 40, versicolor: 40, virginica: 40 })
  })

  it('쏠린 데이터에서도 드문 라벨이 평가셋에서 통째로 빠지지 않는다', () => {
    // 90 대 10. 층화가 없으면 평가셋 20개에 rare가 하나도 안 들어가는 일이 실제로 생긴다.
    const labels = [...Array(100)].map((_, i) => (i < 90 ? 'common' : 'rare'))
    const { testIndices } = holdoutSplit({ rows: rows(100), labels }, split({ stratify: true }))

    expect(testIndices.filter((index) => labels[index] === 'rare')).toHaveLength(2)
  })

  it('숫자처럼 생긴 라벨도 문자열로만 본다', () => {
    const labels = [...Array(20)].map((_, i) => String(i % 2))
    const { testIndices } = holdoutSplit({ rows: rows(20), labels }, split({ stratify: true }))
    expect(testIndices).toHaveLength(4)
  })

  it('stratify가 켜져 있어도 라벨이 없으면 그냥 나눈다 - 군집화에는 타깃이 없다', () => {
    const { trainIndices, testIndices } = holdoutSplit(
      { rows: rows(100) },
      split({ stratify: true }),
    )
    expect(trainIndices).toHaveLength(80)
    expect(testIndices).toHaveLength(20)
  })
})

describe('나눌 수 없는 데이터', () => {
  it('행이 너무 적으면 SPLIT_TOO_FEW_ROWS', () => {
    expect(codeOf(() => holdoutSplit({ rows: [7] }, split()))).toBe('SPLIT_TOO_FEW_ROWS')
  })

  it('한 줄뿐인 라벨이 있으면 SPLIT_STRATIFY_IMPOSSIBLE - 조용히 층화를 끄지 않는다', () => {
    const labels = [...Array(20)].map((_, i) => (i === 0 ? '희귀품종' : 'common'))
    const code = codeOf(() => holdoutSplit({ rows: rows(20), labels }, split({ stratify: true })))
    expect(code).toBe('SPLIT_STRATIFY_IMPOSSIBLE')
  })

  it('1개뿐인 라벨이 여럿이면 SPLIT_STRATIFY_TARGET_CONTINUOUS - 끄는 것이 답이다', () => {
    // **마지막 방어선이다.** 정상 경로에서는 전처리 화면이 먼저 말하지만, 남의 .mlpx를
    // 열어 다시 돌리는 경로에는 우리 화면이 없다. 연속값 타깃이 이 모양으로 온다.
    const labels = rows(20).map((row) => `${row}.5`)
    const code = codeOf(() => holdoutSplit({ rows: rows(20), labels }, split({ stratify: true })))
    expect(code).toBe('SPLIT_STRATIFY_TARGET_CONTINUOUS')
  })

  it('무엇이 몇 개였는지 알려준다 - 학생이 다음에 뭘 할지 고를 수 있어야 한다', () => {
    const labels = [...Array(20)].map((_, i) => (i === 0 ? '희귀품종' : 'common'))
    try {
      holdoutSplit({ rows: rows(20), labels }, split({ stratify: true }))
      expect.unreachable()
    } catch (error) {
      expect(isClientError(error)).toBe(true)
      if (isClientError(error)) {
        expect(error.params.label).toBe('희귀품종')
        expect(error.params.count).toBe(1)
        expect(error.params.minRows).toBe(MIN_SPLIT_ROWS)
      }
    }
  })

  it('층화를 끄면 같은 데이터가 나뉜다', () => {
    const labels = [...Array(20)].map((_, i) => (i === 0 ? '희귀품종' : 'common'))
    expect(() => holdoutSplit({ rows: rows(20), labels }, split())).not.toThrow()
  })
})

describe('평가 데이터가 파일로 온 분할', () => {
  /**
   * **나누지 않는다.** 학습 데이터는 전부 학습에 쓰고, 평가 데이터셋의 usableRows
   * 전부가 testIndices다 (mlpx-spec.md §1.1). `testIndices`는 `input.rows`와 다른
   * 정본(test.csv)의 행 번호이므로 `trainIndices`와 겹칠 수 있다 - 서로 다른 표라
   * 겹치는 것이 이상하지 않다.
   */
  const provided = { method: 'provided', testSize: 0.2, stratify: true, randomState: 42 } as const

  it('trainIndices는 학습 데이터 전부, testIndices는 평가 데이터 전부다', () => {
    const { trainIndices, testIndices } = splitRows({ rows: [0, 1, 2, 3] }, provided, {
      rows: [0, 1, 2],
    })
    expect(trainIndices).toEqual([0, 1, 2, 3])
    expect(testIndices).toEqual([0, 1, 2])
  })

  it('원본 행 번호를 그대로 쓴다 - 걸러낸 뒤 다시 세지 않는다', () => {
    // 참조형 모델이 trainIndices로 dataset/data.csv를 가리킨다 (mlpx-spec.md 5.1).
    expect(splitRows({ rows: [2, 5, 9] }, provided, { rows: [1, 4] }).trainIndices).toEqual([
      2, 5, 9,
    ])
  })

  it('층화도 비율도 보지 않는다 - 나눌 것이 없다', () => {
    const strict = { ...provided, stratify: false, testSize: 0.5 } as const
    expect(splitRows({ rows: [0, 1, 2] }, strict, { rows: [5] })).toEqual(
      splitRows({ rows: [0, 1, 2] }, provided, { rows: [5] }),
    )
  })

  it('학습 데이터가 하나도 없으면 시끄럽게 실패한다', () => {
    expect(() => splitRows({ rows: [] }, provided, { rows: [0] })).toThrow()
  })

  it('평가 데이터가 하나도 없으면 평가 데이터를 가리켜 실패한다', () => {
    // 학습 데이터를 탓하는 SPLIT_TOO_FEW_ROWS가 아니어야 한다 - 같은 코드로 뭉치면
    // 평가 파일이 문제인데 학생이 멀쩡한 학습 데이터를 들여다본다.
    expect(codeOf(() => splitRows({ rows: [0, 1] }, provided, { rows: [] }))).toBe(
      'TEST_DATASET_NO_USABLE_ROWS',
    )
  })

  it('평가 데이터셋 자체가 없어도 같은 코드다 - 부르는 쪽 버그다', () => {
    expect(codeOf(() => splitRows({ rows: [0, 1] }, provided))).toBe('TEST_DATASET_NO_USABLE_ROWS')
  })

  it('학습 데이터가 비면 그때는 학습 데이터를 가리킨다', () => {
    expect(codeOf(() => splitRows({ rows: [] }, provided, { rows: [0] }))).toBe(
      'SPLIT_TOO_FEW_ROWS',
    )
  })

  it('holdout은 그대로 나눈다 - 표가 방식을 고른다', () => {
    const holdout = { method: 'holdout', testSize: 0.5, stratify: false, randomState: 1 } as const
    const { trainIndices, testIndices } = splitRows({ rows: [0, 1, 2, 3] }, holdout)
    expect(trainIndices.filter((index) => testIndices.includes(index))).toEqual([])
  })
})

/**
 * **반올림이 실제로 갈리는 자리를 준다.**
 *
 * `testCountFor`의 `Math.round`를 `Math.floor`로 바꿔도 저장소 전체 1,820개 검사가
 * 통과했다 (V11 R2 감사 B-5). 이 파일의 층화 픽스처가 전부 몫이 정확히 떨어져서다 —
 * 150×0.2=30.0 · 100×0.3=30.0 · 90:10×0.2=18.0/2.0 · 20×0.2=4.0. 경계 검사 둘
 * (`4행 × 0.01`·`4행 × 0.99`)은 클램프가 답을 정하므로 `floor`·`ceil`·`round`가 셋 다 같다.
 *
 * **같은 병을 뽑기 쪽은 2026-08-12에 고쳤는데 분할 쪽은 그대로였다.**
 * `sample.spec.ts`가 그때 `['A',7]·['B',11]·['C',13]` 같은 날카로운 픽스처를 얻었다.
 *
 * **`round`가 맞는지는 여기서 다투지 않는다** — sklearn은 `ceil`이고 그 차이는
 * `open-decisions.md`가 다룰 결정이다. 이 검사가 지키는 것은 **지금 규칙이 무엇인지가
 * 코드 밖에 적혀 있다**는 것뿐이다.
 */
describe('평가셋 개수의 반올림', () => {
  const countOf = (total: number, testSize: number): number =>
    holdoutSplit({ rows: rows(total) }, split({ testSize })).testIndices.length

  it('소수부가 절반을 넘으면 올린다 - 7행의 25%는 2행이다', () => {
    // 1.75 → round 2 / floor 1. 두 함수가 갈리는 자리다.
    expect(countOf(7, 0.25)).toBe(2)
  })

  it('소수부가 정확히 절반이면 올린다 - 10행의 25%는 3행이다', () => {
    // 2.5 → round 3 / floor 2 / trunc 2.
    expect(countOf(10, 0.25)).toBe(3)
  })

  it('소수부가 절반에 못 미치면 내린다 - 9행의 25%는 2행이다', () => {
    // 2.25 → round 2. 위 둘과 함께 봐야 "언제나 올린다"가 아님이 드러난다.
    expect(countOf(9, 0.25)).toBe(2)
  })

  it('층화에서도 같은 규칙이다 - 라벨마다 따로 센다', () => {
    // A가 7개(1.75→2), B가 9개(2.25→2). 둘을 합쳐 세면 16×0.25=4.0이라
    // 소수부가 사라져 아무것도 안 갈린다 - 라벨마다 세는지가 여기서 드러난다.
    const labels = [...Array<string>(7).fill('A'), ...Array<string>(9).fill('B')]
    const { testIndices } = holdoutSplit(
      { rows: rows(16), labels },
      split({ testSize: 0.25, stratify: true }),
    )
    expect(testIndices.filter((index) => index < 7)).toHaveLength(2)
    expect(testIndices.filter((index) => index >= 7)).toHaveLength(2)
  })
})
