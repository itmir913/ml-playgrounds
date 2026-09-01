/**
 * 훈련 데이터/테스트 데이터 분할.
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
import { appendAll, holdoutSplit, splitRows, type SplitIndices } from '../src/ml/split'
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
  throw new Error('it did not throw')
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

  /**
   * **라벨은 `rows`의 위치로 읽는다. 행 번호로 읽지 않는다.**
   *
   * `plan.ts`가 `targetValues(dataset, sampled, target)`로 만들어 넘기므로 `labels`는
   * **남은 행의 순서대로** 채워진 배열이고, `rows[i]`의 라벨은 `labels[i]`다.
   * 그런데 이 파일의 층화 검사가 전부 `rows[i] === i`인 표를 써서
   * `labels[position]`을 `labels[row]`로 바꿔도 안 울었다 (2026-08-30, R12 감사 C-3).
   * **실물에서는 결측·뽑기로 걸러진 뒤라 절대 그렇지 않다.**
   */
  it('행 번호가 0부터가 아니어도 라벨을 제자리에서 읽는다', () => {
    // 앞쪽 100행이 결측으로 빠진 모양. 라벨 열 종류 x 두 줄이고 라벨은 rows 순서다.
    const usable = [...Array(20).keys()].map((index) => index + 100)
    const labels = [...Array(20).keys()].map((index) => `L${index % 10}`)
    const labelOf = (index: number): string => labels[usable.indexOf(index)] as string

    /**
     * **`testSize`가 0.5인 이유는 층화가 성립해야 하기 때문이다** (2026-09-01 R18 감사 B-4).
     * 기본값 0.2면 시험이 4장인데 범주가 열이라 **sklearn 1.9도 이 입력을 거부한다**
     * (`test_size = 4 should be greater or equal to the number of classes = 10`).
     * 이 검사가 보려는 것은 **라벨을 자리로 읽는가**이지 그 경계가 아니다.
     */
    const { testIndices } = holdoutSplit(
      { rows: usable, labels },
      split({ stratify: true, testSize: 0.5 }),
    )

    // **산출을 그대로 못 박는다.** 층화는 라벨마다 다른 씨앗을 쓰므로(`labelSeed`),
    // 라벨을 행 번호로 읽으면 열 종류가 빈 문자열 하나로 뭉개지고 **씨앗이 통째로
    // 달라져 다른 행이 뽑힌다.** 라벨 구성만 보면 씨앗 운으로 우연히 맞을 수 있어
    // 축이 안 갈린다 - 이 파일이 재현 가능성을 보는 자리이므로 값을 적는다.
    expect(testIndices).toEqual([100, 101, 102, 103, 104, 106, 109, 115, 117, 118])
    // 범주 열이 시험에 하나씩. **라벨을 행 번호로 읽으면 이 수가 무너진다.**
    expect(new Set(testIndices.map(labelOf)).size).toBe(10)
  })

  it('훈련 데이터와 테스트 데이터가 겹치지 않고 합치면 전체가 된다', () => {
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
  it('비율만큼 테스트 데이터로 간다', () => {
    const { testIndices } = holdoutSplit({ rows: rows(100) }, split({ testSize: 0.3 }))
    expect(testIndices).toHaveLength(30)
  })

  /**
   * **`ceil`이라 0이 나올 수 없다.** 전에는 이 자리가 *"반올림해서 0이 나와도 하나는
   * 남는다"*였고 `Math.max(…, 1)` 클램프를 겨눴는데, `round`에서 `ceil`로 옮긴 뒤로
   * 그 클램프가 **도달 불가능해졌다** — 스키마가 `testSize`를 `gt(0)`으로 막으므로
   * 양수 × 양수의 올림은 언제나 1 이상이다. 그래서 클램프를 지웠다 (R7 감사 B-1).
   */
  it('아주 작은 비율에서도 테스트 데이터에 하나는 남는다 - 올림이 그것을 준다', () => {
    const { trainIndices, testIndices } = holdoutSplit({ rows: rows(4) }, split({ testSize: 0.01 }))
    expect(testIndices).toHaveLength(1)
    expect(trainIndices).toHaveLength(3)
  })

  it('거의 전부를 테스트 데이터로 보내도 훈련 데이터에 하나는 남는다', () => {
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

  it('쏠린 데이터에서도 드문 라벨이 테스트 데이터에서 통째로 빠지지 않는다', () => {
    // 90 대 10. 층화가 없으면 테스트 데이터 20개에 rare가 하나도 안 들어가는 일이 실제로 생긴다.
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

describe('테스트 데이터가 파일로 온 분할', () => {
  /**
   * **나누지 않는다.** 훈련 데이터는 전부 학습에 쓰고, 테스트 데이터셋의 usableRows
   * 전부가 testIndices다 (mlpx-spec.md §1.1). `testIndices`는 `input.rows`와 다른
   * 정본(test.csv)의 행 번호이므로 `trainIndices`와 겹칠 수 있다 - 서로 다른 표라
   * 겹치는 것이 이상하지 않다.
   */
  const provided = { method: 'provided', testSize: 0.2, stratify: true, randomState: 42 } as const

  it('trainIndices는 훈련 데이터 전부, testIndices는 테스트 데이터 전부다', () => {
    const { trainIndices, testIndices } = splitRows({ rows: [0, 1, 2, 3] }, provided, {
      rows: [0, 1, 2],
    })
    expect(trainIndices).toEqual([0, 1, 2, 3])
    expect(testIndices).toEqual([0, 1, 2])
  })

  /**
   * **오름차순은 여기서도 지켜야 한다** (R7 감사 B-3). holdout 쪽에만 검사가 있었고,
   * 이 묶음이 넘기던 행이 전부 이미 오름차순이라 `.sort()` 둘을 지워도 침묵했다.
   *
   * 학생이 압축을 풀어 `runs.json`을 들여다보는 것은 교육적으로 좋은 일이고, 그때
   * 뒤죽박죽인 번호는 읽을 것이 못 된다.
   */
  it('오름차순으로 나온다 - 넘어온 순서가 뒤죽박죽이어도', () => {
    const { trainIndices, testIndices } = splitRows({ rows: [9, 2, 5] }, provided, {
      rows: [4, 1],
    })
    expect(trainIndices).toEqual([2, 5, 9])
    expect(testIndices).toEqual([1, 4])
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

  it('훈련 데이터가 하나도 없으면 시끄럽게 실패한다', () => {
    expect(() => splitRows({ rows: [] }, provided, { rows: [0] })).toThrow()
  })

  it('테스트 데이터가 하나도 없으면 테스트 데이터를 가리켜 실패한다', () => {
    // 훈련 데이터를 탓하는 SPLIT_TOO_FEW_ROWS가 아니어야 한다 - 같은 코드로 뭉치면
    // 테스트 파일이 문제인데 학생이 멀쩡한 훈련 데이터를 들여다본다.
    expect(codeOf(() => splitRows({ rows: [0, 1] }, provided, { rows: [] }))).toBe(
      'TEST_DATASET_NO_USABLE_ROWS',
    )
  })

  it('테스트 데이터셋 자체가 없어도 같은 코드다 - 부르는 쪽 버그다', () => {
    expect(codeOf(() => splitRows({ rows: [0, 1] }, provided))).toBe('TEST_DATASET_NO_USABLE_ROWS')
  })

  it('훈련 데이터가 비면 그때는 훈련 데이터를 가리킨다', () => {
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
 * **sklearn `train_test_split`과 같은 함수여야 한다** — `n_test = ceil(n * test_size)`
 * (`CLAUDE.md` §2 · open-decisions.md #31, 2026-08-19에 `round`에서 옮겼다).
 *
 * 여기서 익힌 20%가 scikit-learn에서 다른 20%면 이 도구는 발판이 아니다.
 *
 * **픽스처가 몫이 떨어지면 이 축을 못 가른다.** `round`이던 시절 `floor`로 바꿔도 저장소
 * 전체가 통과한 적이 있다(V11 R2 B-5) — 층화 픽스처가 전부 `150×0.2=30.0`처럼 정확히
 * 떨어졌기 때문이다. **소수부가 남는 표본을 골라라.**
 */
describe('테스트 데이터 개수는 sklearn과 같은 함수로 센다', () => {
  const countOf = (total: number, testSize: number): number =>
    holdoutSplit({ rows: rows(total) }, split({ testSize })).testIndices.length

  it('소수부가 있으면 올린다 - 7행의 25%는 2행이다', () => {
    // 1.75 → ceil 2 / round 2 / floor 1.
    expect(countOf(7, 0.25)).toBe(2)
  })

  it('소수부가 절반에 못 미쳐도 올린다 - 9행의 25%는 3행이다', () => {
    // 2.25 → **ceil 3 / round 2.** round와 갈리는 자리가 정확히 여기다.
    expect(countOf(9, 0.25)).toBe(3)
  })

  it('나누어떨어지면 그대로다 - 8행의 25%는 2행이다', () => {
    // 2.0. 올림이 "언제나 하나 더"가 아님이 여기서 드러난다.
    expect(countOf(8, 0.25)).toBe(2)
  })

  /**
   * **층화도 sklearn과 같은 순서로 센다** (2026-08-19, R6 감사 B-1).
   *
   * 전에는 라벨마다 따로 `ceil`을 해서 **총 개수가 갈렸다** — 아래 표본에서 저쪽은 4행,
   * 여기는 5행이었다. sklearn은 전체에서 `n_test`를 먼저 세고 그 몫을 반별로 나눈다
   * (`_approximate_mode`).
   *
   * **아래 기대값은 저장소의 `backend/.venv`(sklearn 1.9.0)로 실제로 재서 넣었다.**
   * 옮겨 적은 것이 아니다.
   */
  describe('층화는 sklearn과 같은 개수를 준다', () => {
    function countsOf(labels: readonly string[], testSize: number): Record<string, number> {
      const { testIndices } = holdoutSplit(
        { rows: rows(labels.length), labels },
        split({ testSize, stratify: true }),
      )
      const tally: Record<string, number> = {}
      for (const index of testIndices) tally[labels[index]!] = (tally[labels[index]!] ?? 0) + 1
      return tally
    }

    /** 옛 규칙(라벨마다 ceil)이면 A 2 · B 3으로 다섯이 된다. */
    it('A 7개 · B 9개에서 25%는 넷이다 - 라벨마다 세면 다섯이 된다', () => {
      const labels = [...Array<string>(7).fill('A'), ...Array<string>(9).fill('B')]
      expect(countsOf(labels, 0.25)).toEqual({ A: 2, B: 2 })
    })

    it('쏠린 데이터에서도 비율을 지킨다', () => {
      const labels = [...Array<string>(10).fill('A'), ...Array<string>(90).fill('B')]
      expect(countsOf(labels, 0.3)).toEqual({ A: 3, B: 27 })
    })

    it('반이 셋이어도 총합이 맞는다', () => {
      const labels = [
        ...Array<string>(3).fill('A'),
        ...Array<string>(4).fill('B'),
        ...Array<string>(5).fill('C'),
      ]
      expect(countsOf(labels, 0.34)).toEqual({ A: 1, B: 2, C: 2 })
    })

    /**
     * **동점에서는 sklearn과 갈린다.** 열 반의 소수부가 전부 같으면 누구에게 한 장을 더
     * 줄지가 난수로 정해지는데, 우리 난수는 numpy의 것이 아니다. **총 개수와 "여덟 반이
     * 한 장, 두 반이 두 장"이라는 모양까지는 같고 어느 두 반인지만 갈린다.**
     */
    it('동점이면 총 개수와 모양은 같고 어느 반인지만 갈린다', () => {
      const labels = Array.from({ length: 120 }, (_, index) => `C${index % 10}`)
      const tally = countsOf(labels, 0.1)
      expect(Object.values(tally).reduce((sum, count) => sum + count, 0)).toBe(12)
      expect(Object.values(tally).filter((count) => count === 2)).toHaveLength(2)
      expect(Object.values(tally).filter((count) => count === 1)).toHaveLength(8)
    })

    /**
     * **동점을 씨앗으로 가르는지** (R7 감사 B-4). 위 검사는 *어느* 반인지를 일부러 안
     * 보므로, 섞는 것을 벗겨 등장 순서 그대로 나눠 줘도 초록이었다.
     *
     * 소스가 그 이유를 적어 두었다 — *"늘 앞자리부터 주면 데이터에 먼저 나온 라벨이
     * 언제나 한 장을 더 받는다."* **어느 반인지를 고정하지 않으면서** 씨앗 의존성만
     * 잡으려면 씨앗 둘을 견주면 된다.
     */
    it('씨앗이 다르면 한 장을 더 받는 반이 갈린다 - 앞자리 편향이 아니다', () => {
      const labels = Array.from({ length: 120 }, (_, index) => `C${index % 10}`)
      const twoFor = (randomState: number): string[] =>
        Object.entries(
          holdoutSplit(
            { rows: rows(labels.length), labels },
            { method: 'holdout', testSize: 0.1, stratify: true, randomState },
          ).testIndices.reduce<Record<string, number>>((tally, index) => {
            const label = labels[index]!
            return { ...tally, [label]: (tally[label] ?? 0) + 1 }
          }, {}),
        )
          .filter(([, count]) => count === 2)
          .map(([label]) => label)
          .sort()

      expect(twoFor(42)).toHaveLength(2)
      expect(twoFor(7)).not.toEqual(twoFor(42))
    })

    /** 씨앗이 같으면 우리끼리는 언제나 같은 답이다 - 재현 가능성이 먼저다. */
    it('같은 씨앗이면 같은 답이다', () => {
      const labels = Array.from({ length: 120 }, (_, index) => `C${index % 10}`)
      expect(countsOf(labels, 0.1)).toEqual(countsOf(labels, 0.1))
    })
  })

  /**
   * **위쪽 클램프만 살아 있다.** sklearn은 여기서 던지고 우리는 하나를 남긴다 —
   * 교실에서 멈추는 것보다 낫다. 아래쪽(`Math.max(…, 1)`)은 `ceil`이 대신하므로 없다.
   */
  it('전부 가져가지 않는다 - 학습할 것이 남는다', () => {
    expect(countOf(2, 1)).toBe(1)
  })

  it('아주 작은 비율도 올림이라 1이다 - 클램프가 아니라', () => {
    expect(countOf(100, 0.001)).toBe(1)
  })
})

/**
 * **`push(...배열)`을 대신하는 헬퍼** (2026-09-01 R17 감사 C-6).
 *
 * 스프레드는 행 규모 배열에서 스택을 넘기므로 이 저장소가 다섯 자리를 이것으로 바꿨다.
 * **그런데 대신하는 것과 경계에서 달랐고, 그것을 `as T` 캐스트가 가리고 있었다** —
 * `noUncheckedIndexedAccess`가 딱 이 경우를 잡으라고 켜 둔 것인데 껐던 셈이다.
 *
 * **지금 부르는 다섯 자리는 전부 범위 안이라 값은 안 갈렸다.** 여기서 막는 것은
 * **다음에 이 헬퍼를 범위 밖으로 부르는 사람**이다 — 내보낸 범용 함수다.
 */
describe('appendAll이 `push(...slice)`와 같은 것을 한다', () => {
  /** 대신하는 그 표현. **기대값을 손으로 적지 않는다** — 같아야 할 상대가 이것이다. */
  function spread<T>(source: readonly T[], from: number, to: number): T[] {
    const target: T[] = []
    target.push(...source.slice(from, to))
    return target
  }

  function appended<T>(source: readonly T[], from: number, to: number): T[] {
    const target: T[] = []
    appendAll(target, source, from, to)
    return target
  }

  const source = [1, 2, 3]

  it.each([
    ['범위 안', 0, 3],
    ['앞부분', 0, 2],
    ['뒷부분', 1, 3],
    ['빈 범위', 2, 2],
    ['거꾸로 된 범위', 3, 1],
    ['끝을 넘긴다', 0, 5],
    ['시작도 끝도 넘긴다', 5, 9],
  ])('%s (%i, %i)', (_label, from, to) => {
    expect(appended(source, from, to)).toEqual(spread(source, from, to))
  })

  /**
   * **음수만 갈린다. 일부러 그렇다.** `slice`는 음수를 뒤에서부터로 읽어
   * `[1,2,3].slice(-1, 3)`이 `[3]`인데, 인덱스 범위를 받는 함수에 그 뜻은 안 맞는다.
   * 0으로 자르면 조용히 다른 것을 잇게 되므로 **던진다.**
   */
  it.each([
    ['시작이 음수', -1, 3],
    ['끝이 음수', 0, -1],
    ['둘 다 음수', -2, -1],
  ])('%s (%i, %i)는 던진다', (_label, from, to) => {
    expect(() => appended(source, from, to)).toThrow()
  })

  it('이미 든 것 뒤에 잇는다 - 덮어쓰지 않는다', () => {
    const target = [9]
    appendAll(target, source, 0, 2)
    expect(target).toEqual([9, 1, 2])
  })

  /** **구멍을 만들지 않는다.** 인덱스 배열에 `undefined`가 섞이면 그 뒤가 전부 조용히 틀린다. */
  it('어떤 범위로 불러도 `undefined`가 안 섞인다', () => {
    for (let from = 0; from <= 5; from += 1) {
      for (let to = 0; to <= 6; to += 1) {
        expect(appended(source, from, to), `[${from}, ${to})`).not.toContain(undefined)
      }
    }
  })
})

/**
 * **층화의 몫이 범주 수보다 적으면 던진다** (2026-09-01 R18 감사 B-4).
 *
 * sklearn `StratifiedShuffleSplit`이 던지는 그 자리다. 우리는 조용히 지나가고 있었고,
 * **10범주 × 12장을 5%로 나누면 시험 6장**이라 최소 네 범주가 시험에서 통째로 빠졌다.
 *
 * **경계를 sklearn 1.9로 대조했다** — 아래 넷 중 둘은 저쪽도 던지고, 둘은 저쪽도 통과한다.
 * 통과하는 쪽에서 우리만 던지면 **§2("구조는 표준 라이브러리를 따른다")를 우리가 어긴다.**
 */
describe('층화의 몫이 범주 수보다 적으면', () => {
  function labelled(counts: readonly number[]): { rows: number[]; labels: string[] } {
    const rows: number[] = []
    const labels: string[] = []
    counts.forEach((count, group) => {
      for (let taken = 0; taken < count; taken += 1) {
        rows.push(rows.length)
        labels.push(String.fromCharCode(65 + group))
      }
    })
    return { rows, labels }
  }

  function split(counts: readonly number[], testSize: number): SplitIndices {
    return holdoutSplit(labelled(counts), {
      method: 'holdout',
      testSize,
      stratify: true,
      randomState: 42,
    })
  }

  function codeOf(counts: readonly number[], testSize: number): string | null {
    try {
      split(counts, testSize)
      return null
    } catch (error) {
      return isClientError(error) ? error.code : 'NOT_A_CLIENT_ERROR'
    }
  }

  /** 시험 6장에 범주 열. **sklearn 1.9도 여기서 던진다.** */
  it('시험 몫이 모자라면 던진다', () => {
    expect(
      codeOf(
        Array.from({ length: 10 }, () => 12),
        0.05,
      ),
    ).toBe('SPLIT_STRATIFY_SHARE_TOO_SMALL')
  })

  /** 시험 1장에 범주 둘. **sklearn 1.9도 여기서 던진다.** */
  it('시험이 한 장이면 던진다', () => {
    expect(codeOf([2, 98], 0.01)).toBe('SPLIT_STRATIFY_SHARE_TOO_SMALL')
  })

  /**
   * **훈련 쪽도 본다.** `testSize`가 크면 모자라는 것은 훈련이다 — 저쪽도 두 가드를 갖는다.
   * 스키마가 0.9까지 열어 두므로 화면에서 닿지 않아도 남의 `.mlpx`로는 온다.
   */
  it('훈련 몫이 모자라면 던진다', () => {
    expect(
      codeOf(
        Array.from({ length: 10 }, () => 12),
        0.95,
      ),
    ).toBe('SPLIT_STRATIFY_SHARE_TOO_SMALL')
  })

  /**
   * **여기서는 안 던진다. 이것이 이 검사의 절반이다.**
   *
   * 시험 5장에 범주 둘이라 몫은 넉넉한데 **소수 라벨이 시험에서 빠진다.** 그래도 통과가
   * 맞다 — **sklearn 1.9가 같은 입력에서 같은 답을 낸다**(통과, 시험에서 A 빠짐).
   * 여기서 던지면 우리가 저쪽과 갈린다.
   */
  it('몫이 넉넉하면 범주가 빠져도 안 던진다 - sklearn과 같은 자리', () => {
    expect(codeOf([2, 98], 0.05)).toBeNull()
    const out = split([2, 98], 0.05)
    const { labels } = labelled([2, 98])
    const inTest = new Set(out.testIndices.map((row) => labels[row]))
    // 실제로 빠진다는 것까지 못 박는다 - 이 검사가 무엇을 봐주는지가 분명해야 한다.
    expect(inTest.size).toBe(1)
  })

  it('층화를 끄면 이 가드가 안 걸린다', () => {
    const { rows, labels } = labelled(Array.from({ length: 10 }, () => 12))
    expect(() =>
      holdoutSplit(
        { rows, labels },
        { method: 'holdout', testSize: 0.05, stratify: false, randomState: 42 },
      ),
    ).not.toThrow()
  })
})
