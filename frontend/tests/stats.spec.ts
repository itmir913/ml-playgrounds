/**
 * 데이터 화면 그림의 계산 (`data/stats.ts`).
 *
 * **그림은 그럴듯하게 그려지면서 틀린다.** 구간이 하나 밀려도, 마지막 값이 어느 구간에도
 * 안 들어가도, 표본이 새로고침마다 달라져도 **막대는 나온다.** 그래서 이 계층이 화면
 * 밖에 있고(`architecture.md` §8.9.1) 여기가 그것을 무는 자리다.
 *
 * **바깥의 규약을 따르는 자리는 그 규약으로 검사한다** — numpy의 `'auto'` 구간 폭과
 * 튜키의 1.5배 수염이다. 우리가 고른 값이 아니므로 "지금 코드가 내는 값"으로 못 박으면
 * 규약을 벗어난 것을 못 잡는다.
 */

import { describe, expect, it } from 'vitest'

import {
  boxSummary,
  categoriesOf,
  frequencies,
  histogram,
  isBinCount,
  numericValues,
  scatterSample,
} from '../src/data/stats'

/** 0부터 n-1까지. 규약 검사의 입력으로 쓴다. */
function series(n: number): number[] {
  return Array.from({ length: n }, (_value, index) => index)
}

describe('열에서 수를 골라낸다', () => {
  it('빈 칸과 못 읽는 칸을 갈라 센다', () => {
    const read = numericValues(['1', '', '2', '  ', 'abc', '3.5'])
    expect(read.values).toEqual([1, 2, 3.5])
    expect(read.missing).toBe(2)
    expect(read.unreadable).toBe(1)
  })

  it('음수와 지수 표기도 수다 — `toNumber` 한 벌을 쓴다', () => {
    expect(numericValues(['-1', '1e3', '0.5']).values).toEqual([-1, 1000, 0.5])
  })

  /**
   * **무한대는 수가 아니다.** `Number('Infinity')`는 유한하지 않아 `toNumber`가 거른다 —
   * 안 거르면 축의 범위가 무한이 되어 **그림 전체가 빈 판**이 된다.
   */
  it('무한대를 값으로 받지 않는다', () => {
    const read = numericValues(['1', 'Infinity', '2'])
    expect(read.values).toEqual([1, 2])
    expect(read.unreadable).toBe(1)
  })
})

describe('히스토그램', () => {
  it('값이 없으면 구간도 없다', () => {
    expect(histogram([], 200)).toEqual({ edges: [], counts: [], capped: false })
  })

  /**
   * **값이 하나뿐인 열과 값이 없는 열은 화면에서 달라야 한다.** numpy가 폭 0에서
   * `[x - 0.5, x + 0.5]`를 주는 것과 같은 규칙이다.
   */
  it('값이 전부 같으면 그 값을 가운데 둔 구간 하나다', () => {
    const one = histogram([7, 7, 7], 200)
    expect(one.edges).toEqual([6.5, 7.5])
    expect(one.counts).toEqual([3])
  })

  it('모든 값이 어느 한 구간에 들어간다 — 합이 값의 수다', () => {
    const values = [1, 2, 2, 3, 5, 8, 13, 21, 34, 55]
    const made = histogram(values, 200)
    expect(made.counts.reduce((sum, count) => sum + count, 0)).toBe(values.length)
  })

  /**
   * **최댓값이 어디에도 안 들어가는 것이 이 계산의 고전적인 실패다.** 마지막 구간만
   * 오른쪽 끝을 포함하므로 마지막 칸에 반드시 들어가야 한다.
   */
  it('최댓값이 마지막 구간에 들어간다', () => {
    const made = histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 200)
    expect(made.counts[made.counts.length - 1]).toBeGreaterThan(0)
    expect(made.edges[made.edges.length - 1]).toBe(10)
  })

  /**
   * **마지막 경계를 계산하지 않고 박는 줄을 무는 검사다** (`edges[bins] = high`).
   *
   * 경계를 `low + range * i / bins`로 쌓으면 마지막 값이 부동소수 오차로 최댓값보다
   * **아주 조금 작아질 수 있고**, 그러면 그 값 하나가 어느 구간에도 안 들어간다.
   * **그 줄을 지워도 저장소가 조용했다** (2026-09-22 감사).
   *
   * **처음 쓴 검사도 안 물었다** — 오차가 안 나는 값을 골랐기 때문이고, 그것을 모른 채
   * 두면 *"이 줄을 지키는 검사가 있다"*는 거짓말이 남는다. 아래 일곱 점은 **실제로
   * 어긋나는 조합을 찾아서** 넣은 것이다(그 자리에서 마지막 경계가 최댓값보다
   * `3.6e-15` 작다). 값을 다듬지 마라 — 다듬으면 오차가 사라져 검사가 죽는다.
   */
  it('부동소수 오차가 나는 값에서도 최댓값이 마지막 구간에 들어간다', () => {
    const values = [
      19.31430861041101, -14.498383194530557, 6.034281220615256, -3.933415944305079,
      1.247941398846002, -3.066489446177659, -9.958511965746473,
    ]
    const made = histogram(values, 200)
    expect(made.edges[made.edges.length - 1]).toBe(19.31430861041101)
    expect(made.counts.reduce((sum, count) => sum + count, 0)).toBe(values.length)
  })

  it('경계의 처음과 끝이 최솟값과 최댓값이다', () => {
    const made = histogram([-3, 0, 4.5, 9], 200)
    expect(made.edges[0]).toBe(-3)
    expect(made.edges[made.edges.length - 1]).toBe(9)
    expect(made.edges.length).toBe(made.counts.length + 1)
  })

  /**
   * **numpy `histogram_bin_edges`의 `'auto'`가 내는 수를 그대로 못 박는다.**
   *
   * ```python
   * fd_bw_corrected = max(fd_bw, sqrt_bw / 2)
   * return min(fd_bw_corrected, sturges_bw)
   * ```
   *
   * **한때 이 검사가 코드와 같은 식을 다시 계산해 견줬다** (2026-09-22 감사가 잡았다).
   * 그러면 식이 틀려도 양쪽이 같이 틀려서 **항진명제가 된다** — 실제로 코드가
   * `max(sturges, fd)`(방향이 반대)였는데 이 검사는 초록이었다. 아래 수들은
   * `numpy.histogram_bin_edges(..., bins='auto')`를 **직접 돌려서** 받은 값이다
   * (`uv run python`, 2026-09-22).
   */
  it.each([
    ['사인 1000점', Array.from({ length: 1000 }, (_v, i) => Math.sin(i) * 50), 11],
    ['피보나치 10점', [1, 2, 2, 3, 5, 8, 13, 21, 34, 55], 5],
    ['한 점에 몰린 102점', [...new Array<number>(100).fill(5), 0, 10], 21],
    ['0..10', series(11), 5],
    ['키 7점', [150, 160, 165, 170, 175, 180, 190], 4],
    ['3점', [1, 2, 3], 3],
  ])('구간 수가 numpy의 `auto`와 같다 — %s', (_name, values, bins) => {
    expect(histogram(values, 100_000).counts.length).toBe(bins)
  })

  /**
   * **사분위 범위가 0이면 프리드먼–다이아코니스를 안 쓴다.** 값의 절반 이상이 한 점에
   * 몰린 열이고, 폭 0을 쓰면 구간이 무한히 나온다.
   */
  it('값이 한 점에 몰려도 구간 수가 터지지 않는다', () => {
    const values = [...new Array<number>(100).fill(5), 0, 10]
    const made = histogram(values, 200)
    expect(made.counts.length).toBeGreaterThan(0)
    expect(made.counts.length).toBeLessThanOrEqual(200)
    expect(made.counts.reduce((sum, count) => sum + count, 0)).toBe(values.length)
  })

  /** **줄였으면 줄였다고 말한다.** 화면이 그 사실을 학생에게 전한다. */
  it('상한에 걸리면 `capped`가 참이다', () => {
    const values = series(10_000).map((index) => (index % 7) * 0.001 + index * 0.00001)
    const capped = histogram(values, 5)
    expect(capped.counts.length).toBe(5)
    expect(capped.capped).toBe(true)
    expect(histogram([0, 1, 2, 3], 200).capped).toBe(false)
  })
})

/**
 * 구간 수를 학생이 직접 주는 길 (`open-decisions.md` "45. 히스토그램의 구간 수를 학생이
 * 정한다").
 *
 * **여기가 무는 것은 "정확히 그 수"다.** 셋째 인자를 상한(`maxBins`)에 합쳤다면 자동이
 * 적은 수를 원하는 열에서 **학생이 고른 수가 조용히 무시된다** — 오류도 안 나고 손잡이가
 * 아무 일도 안 한 것처럼 보이는 모양이라, 그 침묵을 여기서 막는다.
 */
describe('히스토그램 — 구간 수를 직접 준다', () => {
  /**
   * **자동이 5를 원하는 열에 20을 준다.** 상한 자리에 넣었다면 `min(5, 20) = 5`가 되어
   * 이 검사가 운다. 자동 쪽 수는 위 numpy 대조표가 못 박은 값이다.
   */
  it('자동이 더 적게 원해도 준 수만큼 나눈다', () => {
    const values = [1, 2, 2, 3, 5, 8, 13, 21, 34, 55]
    expect(histogram(values, 200).counts.length).toBe(5)
    expect(histogram(values, 200, 20).counts.length).toBe(20)
  })

  it('자동이 더 많이 원해도 준 수만큼 나눈다', () => {
    const values = Array.from({ length: 1000 }, (_v, i) => Math.sin(i) * 50)
    expect(histogram(values, 200).counts.length).toBe(11)
    expect(histogram(values, 200, 4).counts.length).toBe(4)
  })

  it("`'auto'`를 명시한 것과 생략한 것이 같다", () => {
    const values = [150, 160, 165, 170, 175, 180, 190]
    expect(histogram(values, 200, 'auto')).toEqual(histogram(values, 200))
  })

  /** 구간이 달라져도 값은 하나도 안 잃는다 — 위 자동 쪽과 같은 계약이다. */
  it.each([1, 2, 7, 20, 200])('준 수가 %i이어도 합이 값의 수다', (bins) => {
    const values = [1, 2, 2, 3, 5, 8, 13, 21, 34, 55]
    const made = histogram(values, 200, bins)
    expect(made.counts.length).toBe(bins)
    expect(made.edges.length).toBe(bins + 1)
    expect(made.counts.reduce((sum, count) => sum + count, 0)).toBe(values.length)
    expect(made.edges[0]).toBe(1)
    expect(made.edges[bins]).toBe(55)
  })

  /**
   * **폭이 0인 열은 몇으로 나누자고 해도 구간 하나다.** 자동과 같은 답이어야 한다 —
   * 여기서 20칸을 만들면 경계가 전부 같은 값이 되어 그림이 무너진다.
   */
  it('값이 전부 같으면 준 수와 무관하게 구간 하나다', () => {
    const one = histogram([7, 7, 7], 200, 20)
    expect(one.edges).toEqual([6.5, 7.5])
    expect(one.counts).toEqual([3])
    expect(one.capped).toBe(false)
  })

  it('값이 없으면 준 수와 무관하게 구간도 없다', () => {
    expect(histogram([], 200, 20)).toEqual({ edges: [], counts: [], capped: false })
  })

  /**
   * **상한이 이기고, 이겼다고 말한다.** 화면은 여기 닿기 전에 막지만
   * (`architecture.md` §8.9.1.1), 그 방어선이 뚫려도 조용히 다른 수를 그리지는 않는다.
   */
  it('준 수가 상한을 넘으면 상한이 이기고 `capped`가 참이다', () => {
    const made = histogram([0, 1, 2, 3], 5, 20)
    expect(made.counts.length).toBe(5)
    expect(made.capped).toBe(true)
  })

  /** 1보다 작은 수와 소수는 numpy처럼 정수 한 칸으로 떨어진다. */
  it.each([
    [0, 1],
    [-3, 1],
    [1, 1],
    [3.7, 3],
  ])('준 수 %s는 구간 %i개가 된다', (given, bins) => {
    expect(histogram([0, 1, 2, 3], 200, given).counts.length).toBe(bins)
  })

  /** 직접 준 수는 줄인 것이 아니다 — 상한에 안 걸리면 `capped`는 거짓이다. */
  it('상한에 안 걸리면 `capped`가 거짓이다', () => {
    expect(histogram([0, 1, 2, 3], 200, 20).capped).toBe(false)
  })
})

/**
 * 화면이 [적용]을 잠그는 판정 (`architecture.md` §8.9.1.1).
 *
 * **경계가 양쪽 다 포함이다.** 1과 상한이 막히면 학생은 그릴 수 있는 그림을 못 그리고,
 * 0이나 상한+1이 통과하면 위 `histogram`이 조용히 당기는 자리로 굴러간다.
 */
describe('구간 수로 받을 수 있는 값인가', () => {
  it.each([
    [1, true],
    [20, true],
    [200, true],
    [0, false],
    [-1, false],
    [201, false],
    [3.5, false],
    [Number.NaN, false],
    [Number.POSITIVE_INFINITY, false],
  ])('%s → %s', (value, ok) => {
    expect(isBinCount(value, 200)).toBe(ok)
  })

  /**
   * **숫자 칸이 늘 숫자를 주지는 않는다.** 빈 칸은 `''`이고, 타입으로는 못 막는 자리라
   * 여기서 받아서 거짓으로 돌려준다 — 안 그러면 `''`이 `NaN` 경계를 만들어 그림이
   * 통째로 빈다.
   */
  it.each([[''], [null], [undefined], ['20']])('숫자가 아닌 %s는 거짓이다', (value) => {
    expect(isBinCount(value, 200)).toBe(false)
  })
})

describe('박스 플롯 요약', () => {
  it('값이 없으면 `null`이다 — 0으로 채운 상자를 그리지 않는다', () => {
    expect(boxSummary([])).toBeNull()
  })

  /**
   * 손으로 셀 수 있는 표본으로 다섯 수를 못 박는다. 선형 보간은 numpy·pandas의
   * 기본과 같은 규칙이고(`quantile`), 1..9에서 Q1은 3, 중앙값은 5, Q3은 7이다.
   */
  it('다섯 수가 numpy의 선형 보간과 같다', () => {
    const summary = boxSummary([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(summary).not.toBeNull()
    expect(summary?.min).toBe(1)
    expect(summary?.q1).toBe(3)
    expect(summary?.median).toBe(5)
    expect(summary?.q3).toBe(7)
    expect(summary?.max).toBe(9)
  })

  it('이상치가 없으면 수염이 최솟값·최댓값까지 간다', () => {
    const summary = boxSummary([1, 2, 3, 4, 5])
    expect(summary?.lowerWhisker).toBe(1)
    expect(summary?.upperWhisker).toBe(5)
    expect(summary?.outliers).toEqual([])
  })

  /**
   * **수염은 울타리가 아니라 울타리 안의 실제 값까지다** (튜키·matplotlib의 규칙).
   * 울타리까지 그리면 데이터가 없는 자리로 수염이 뻗고, 학생이 그 끝을 최댓값으로 읽는다.
   */
  it('수염이 울타리가 아니라 그 안의 마지막 값에서 멈춘다', () => {
    const summary = boxSummary([1, 2, 3, 4, 5, 6, 7, 8, 9, 100])
    expect(summary?.outliers).toEqual([100])
    expect(summary?.upperWhisker).toBe(9)
    // 울타리(Q3 + 1.5 × IQR)는 9보다 크다 — 거기까지 뻗으면 안 된다.
    const fence = (summary?.q3 ?? 0) + 1.5 * ((summary?.q3 ?? 0) - (summary?.q1 ?? 0))
    expect(fence).toBeGreaterThan(9)
  })

  it('아래쪽 이상치도 같은 규칙으로 잡는다', () => {
    const summary = boxSummary([-100, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(summary?.outliers).toEqual([-100])
    expect(summary?.lowerWhisker).toBe(1)
  })

  it('이상치는 오름차순이고 개수는 전체를 센다', () => {
    const summary = boxSummary([50, 1, 2, 3, 4, 5, -40])
    expect(summary?.count).toBe(7)
    expect([...(summary?.outliers ?? [])]).toEqual(
      [...(summary?.outliers ?? [])].sort((a, b) => a - b),
    )
  })
})

describe('도수 분포', () => {
  it('빈 칸은 막대가 아니라 결측으로 센다', () => {
    const tally = frequencies(['가', '', '나', '가', '  '], 30)
    expect(tally.missing).toBe(2)
    expect(tally.distinct).toBe(2)
    expect(tally.bars).toEqual([
      { value: '가', count: 2 },
      { value: '나', count: 1 },
    ])
  })

  /**
   * **순서는 첫 등장 순서다.** 전처리의 원-핫 인코딩이 같은 순서를 쓰기 때문이고
   * (`fitPreprocessor`의 `[...new Set(present)]`), 두 화면이 같은 열을 다른 순서로
   * 늘어놓으면 학생이 읽은 순서와 특성 이름의 순서가 어긋난다.
   */
  it('도수가 큰 값이 뒤에 나와도 순서를 안 바꾼다', () => {
    const tally = frequencies(['나', '가', '가', '가'], 30)
    expect(tally.bars.map((bar) => bar.value)).toEqual(['나', '가'])
  })

  /**
   * **무엇을 남길지는 도수가 정하고, 어떻게 늘어놓을지는 등장 순서가 정한다.**
   * 앞에서부터 자르면 그림이 "가장 흔한 값들"이 아니라 "파일 맨 위의 값들"이 된다.
   */
  it('남기는 것은 도수가 큰 쪽이고, 늘어놓는 것은 등장 순서다', () => {
    const cells = ['희귀1', '희귀2', ...new Array<string>(5).fill('흔함'), '희귀3']
    const tally = frequencies(cells, 2)
    // 흔함(5)과 그다음으로 큰 값 하나만 남는다.
    expect(tally.bars.length).toBe(2)
    expect(tally.bars.some((bar) => bar.value === '흔함')).toBe(true)
    // 남은 둘은 여전히 등장 순서로 선다.
    const positions = tally.bars.map((bar) => cells.indexOf(bar.value))
    expect([...positions]).toEqual([...positions].sort((a, b) => a - b))
  })

  it('밀려난 값이 몇 행인지 말한다', () => {
    const tally = frequencies(['가', '가', '나', '다', '라'], 1)
    expect(tally.bars).toEqual([{ value: '가', count: 2 }])
    expect(tally.distinct).toBe(4)
    expect(tally.omitted).toBe(3)
  })

  it('전부 그렸으면 밀려난 것이 0이다', () => {
    expect(frequencies(['가', '나'], 30).omitted).toBe(0)
  })
})

describe('산점도 표본', () => {
  const xs = series(20).map(String)
  const ys = series(20).map((index) => String(index * 2))

  it('행 번호가 정본 표의 번호 그대로다', () => {
    const drawn = scatterSample(xs, ys, 100, 42)
    expect(drawn.points[3]).toEqual({ row: 3, x: 3, y: 6 })
    expect(drawn.total).toBe(20)
    expect(drawn.skipped).toBe(0)
  })

  /** 한쪽이라도 수가 아니면 점을 못 찍는다. **조용히 0으로 만들지 않는다.** */
  it('한쪽이 비거나 수가 아닌 행은 빼고 그 수를 말한다', () => {
    const drawn = scatterSample(['1', '', '3', 'abc'], ['1', '2', '', '4'], 100, 42)
    expect(drawn.points.map((point) => point.row)).toEqual([0])
    expect(drawn.total).toBe(1)
    expect(drawn.skipped).toBe(3)
  })

  it('색 열의 값을 그대로 싣고, 빈 칸이면 안 싣는다', () => {
    const drawn = scatterSample(['1', '2'], ['1', '2'], 100, 42, ['남', ''])
    expect(drawn.points[0]?.group).toBe('남')
    expect(drawn.points[1]?.group).toBeUndefined()
  })

  /**
   * **같은 씨앗이면 같은 그림이다.** 새로고침마다 표본이 달라지면 학생은 자기가 뭘
   * 바꿔서 그림이 바뀐 줄 안다.
   */
  it('같은 씨앗이면 같은 표본이다', () => {
    const first = scatterSample(xs, ys, 5, 7)
    const second = scatterSample(xs, ys, 5, 7)
    expect(first.points.map((point) => point.row)).toEqual(second.points.map((point) => point.row))
    expect(first.drawn).toBe(5)
    expect(first.total).toBe(20)
  })

  it('씨앗이 다르면 표본도 달라진다', () => {
    const a = scatterSample(xs, ys, 5, 1).points.map((point) => point.row)
    const b = scatterSample(xs, ys, 5, 2).points.map((point) => point.row)
    expect(a).not.toEqual(b)
  })

  /** **뽑은 뒤 원래 순서로 되돌린다** — 그리는 순서가 겹침의 위아래를 정한다. */
  it('표본이 행 번호 오름차순이다', () => {
    const rows = scatterSample(xs, ys, 5, 7).points.map((point) => point.row)
    expect([...rows]).toEqual([...rows].sort((a, b) => a - b))
  })

  /**
   * **못 찍는 행은 표본을 뽑기 전에 뺀다.** 뽑고 나서 버리면 상한이 5인데 실제로 그려지는
   * 것은 그보다 적어지고, 결측이 많은 열일수록 더 적어진다.
   */
  it('상한만큼 실제로 그린다 — 결측이 섞여도', () => {
    const holes = series(20).map((index) => (index % 2 === 0 ? String(index) : ''))
    const drawn = scatterSample(holes, holes, 5, 7)
    expect(drawn.drawn).toBe(5)
    expect(drawn.total).toBe(10)
    expect(drawn.skipped).toBe(10)
  })
})

/**
 * 범주 축 (`open-decisions.md` "군집 산점도의 축"의 2026-09-22 문단).
 *
 * **결과 화면과 같은 규칙이라야 한다** — 차례가 갈리면 같은 열이 두 화면에서 다른
 * 자리에 선다. 그래서 여기가 무는 것은 *"첫 등장 순서"* 하나다.
 */
describe('산점도의 범주 축', () => {
  /**
   * **`ml/preprocess.ts`의 `[...new Set(present)]`와 같은 규칙이다.** 가나다순으로
   * 바꾸면 학습 쪽 인코딩과 어긋나고, 그 어긋남은 두 화면을 나란히 놓기 전에는 안 보인다.
   */
  it('범주는 첫 등장 순서다 — 가나다순이 아니다', () => {
    expect(categoriesOf(['여', '남', '여', '기타'])).toEqual(['여', '남', '기타'])
  })

  it('빈 칸은 범주가 아니다', () => {
    expect(categoriesOf(['남', '', '  ', '여'])).toEqual(['남', '여'])
  })

  /** 축의 값은 **목록에서의 자리**다. 그 자리를 흩뿌리는 것은 그리는 쪽의 일이다. */
  it('범주 축의 값이 목록에서의 자리다', () => {
    const categories = categoriesOf(['남', '여'])
    const drawn = scatterSample(['남', '여', '남'], ['1', '2', '3'], 100, 7, undefined, {
      x: categories,
    })
    expect(drawn.points.map((point) => point.x)).toEqual([0, 1, 0])
    expect(drawn.points.map((point) => point.y)).toEqual([1, 2, 3])
  })

  /** 두 축이 다 범주여도 된다 — 결과 화면이 그렇게 그린다. */
  it('두 축이 모두 범주일 수 있다', () => {
    const drawn = scatterSample(['남', '여'], ['A', 'B'], 100, 7, undefined, {
      x: ['남', '여'],
      y: ['A', 'B'],
    })
    expect(drawn.points).toEqual([
      { row: 0, x: 0, y: 0 },
      { row: 1, x: 1, y: 1 },
    ])
  })

  /**
   * **목록에 없는 값은 점을 못 찍는다.** 빈 칸과 같은 자리이고, 조용히 첫 범주로
   * 떨어뜨리면 **없는 데이터가 생긴다.**
   */
  it('목록에 없는 값은 빠지고 그 수를 센다', () => {
    const drawn = scatterSample(['남', '', '모름'], ['1', '2', '3'], 100, 7, undefined, {
      x: ['남', '여'],
    })
    expect(drawn.drawn).toBe(1)
    expect(drawn.skipped).toBe(2)
  })

  /** 축 목록을 안 주면 지금까지처럼 수로 읽는다. */
  it('목록이 없으면 수로 읽는다', () => {
    const drawn = scatterSample(['남', '1'], ['1', '2'], 100, 7)
    expect(drawn.drawn).toBe(1)
  })
})
