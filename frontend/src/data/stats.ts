/**
 * 데이터 화면의 그림이 쓰는 **계산 전부** (`architecture.md` §8.9.1,
 * `open-decisions.md` "44. 데이터 화면의 시각화").
 *
 * **여기 있는 것은 전부 순수 함수다.** DOM도 `t()`도 Chart.js도 모른다. 그림을 만드는
 * 계산이 컴포넌트의 `computed`에 있으면 **캔버스 없이는 검사가 못 붙고**, 이 저장소는
 * 같은 자리에서 이미 두 번 조용히 깨졌다 (`ml/cluster-chart.ts`의 머리말).
 *
 * **잣대는 빌려 쓴다. 새로 만들지 않는다.** 수로 읽는 규칙(`toNumber`)도 사분위수를
 * 구하는 규칙(`quantile`)도 표본을 뽑는 규칙(`sampleIndices`)도 이미 이 저장소에 하나씩
 * 있고, 그것을 그대로 부른다 — 두 벌이 되면 **같은 열이 전처리 화면과 그림에서 다른
 * 말을 하게 되고**, 그 어긋남은 둘을 나란히 놓기 전에는 안 보인다.
 */

import { quantile, toNumber, type Dataset } from '../ml/preprocess'
import { sampleIndices } from '../ml/shuffle'

/**
 * 열 하나의 칸들을 행 순서대로 꺼낸다. 없는 열이면 빈 배열이다.
 *
 * **빈 배열을 돌려주는 것이 계약이다.** 열 이름은 학생이 고른 것이고 표는 그 사이에
 * 바뀔 수 있다 — 던지면 그림 하나가 화면 전체를 데리고 넘어진다.
 */
export function columnCells(dataset: Dataset, name: string): readonly string[] {
  const index = dataset.columns.indexOf(name)
  if (index < 0) return []
  return dataset.rows.map((row) => row[index] ?? '')
}

/**
 * 열 하나에서 그림이 쓸 수 있는 값만 골라낸 것.
 *
 * **버린 개수를 함께 준다.** 100행 중 40행이 빈 칸인 열의 히스토그램은 60행의 그림인데,
 * 그 사실을 여기서 안 세면 화면이 말할 방법이 없다 — 그리고 안 말하면 학생은 자기
 * 데이터 전부를 보고 있다고 믿는다.
 */
export interface NumericValues {
  /** 수로 읽힌 값. **정렬돼 있지 않다** — 원본 행 순서 그대로다. */
  readonly values: readonly number[]
  /** 빈 칸이었던 행 수. */
  readonly missing: number
  /**
   * 빈 칸은 아닌데 수로 안 읽힌 행 수.
   *
   * **수치 열에서는 언제나 0이다** (`detectKind`가 그렇게 판정했으므로). 0이 아닌 값이
   * 나오는 것은 **범주 열을 수치로 그리려 한 경우**뿐이고, 그때는 부르는 쪽이 틀린
   * 것이다 — 조용히 버리지 않고 세어서 돌려준다.
   */
  readonly unreadable: number
}

/** 빈 칸인가. `ml/preprocess.ts`의 `isMissing`과 같은 규칙이다. */
function isBlank(cell: string | undefined): boolean {
  return cell === undefined || cell.trim() === ''
}

/** 열의 칸들에서 수를 골라낸다. */
export function numericValues(cells: readonly string[]): NumericValues {
  const values: number[] = []
  let missing = 0
  let unreadable = 0

  for (const cell of cells) {
    if (isBlank(cell)) {
      missing += 1
      continue
    }
    const value = toNumber(cell)
    if (value === null) unreadable += 1
    else values.push(value)
  }

  return { values, missing, unreadable }
}

/**
 * 히스토그램 하나.
 *
 * **경계는 구간 수보다 하나 많다.** `edges[i]`와 `edges[i + 1]` 사이에 `counts[i]`개가
 * 들어 있다.
 */
export interface Histogram {
  readonly edges: readonly number[]
  readonly counts: readonly number[]
  /**
   * 구간 수가 상한에 걸려 줄었는가. **화면이 이 사실을 말할 수 있어야 한다** — 조용히
   * 뭉뚱그리면 학생은 자기가 보는 것이 자동으로 정해진 구간이라고 믿는다.
   */
  readonly capped: boolean
}

/**
 * 구간 폭을 정하는 규칙 — **numpy `histogram_bin_edges`의 `'auto'`를 그대로 따른다.**
 *
 * ```python
 * fd_bw_corrected = max(fd_bw, sqrt_bw / 2)
 * return min(fd_bw_corrected, sturges_bw)
 * ```
 *
 * 우리가 안 고르는 이유는 둘이다.
 *
 * 1. **구간 수를 상수로 박으면 근거 없는 임계값이 된다.** 20이든 30이든 왜 그 수인지
 *    답할 말이 없고, 이 저장소는 그런 상수를 안 만든다.
 * 2. **학생이 나중에 `numpy.histogram`을 부를 때 같은 그림이 나온다.** 이 도구는
 *    종착지가 아니라 파이썬으로 가는 발판이다 (`CLAUDE.md` §2).
 *
 * **한때 이 함수가 `max(sturges, fd)`였다** (2026-09-22 감사가 잡았다). 방향이 반대라
 * 구간이 **더 적게** 나왔다 — 같은 1,000점에서 numpy가 11을 줄 때 8을 줬다. 주석도
 * 스펙도 결정문도 *"넓은 쪽"*이라 적혀 있었고, **스펙은 코드와 같은 식을 다시 계산해
 * 견주는 항진명제라 아무것도 안 물었다.** 지금은 numpy가 실제로 내는 수를 못 박는다.
 *
 * **`sqrt/2`가 바닥인 이유도 numpy의 것이다** — 프리드먼–다이아코니스는 사분위 범위가
 * 아주 작은 열에서 폭을 0에 가깝게 만들어 구간이 터진다. 그 바닥이 있으므로 여기서
 * `iqr === 0`을 따로 막을 필요가 없다.
 */
function autoBinWidth(sorted: readonly number[], range: number): number {
  const n = sorted.length
  const sturges = range / (Math.log2(n) + 1)
  const sqrt = range / Math.sqrt(n)

  const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25)
  const fd = (2 * iqr) / Math.cbrt(n)

  return Math.min(Math.max(fd, sqrt / 2), sturges)
}

/**
 * 수치 열의 히스토그램을 만든다.
 *
 * **`maxBins`는 부르는 쪽이 준다** (`limits.ts`). 구간 수의 상한은 계산이 아니라 **그릴
 * 수 있는가**의 문제이고, 그래서 이 파일이 갖지 않는다 — 숫자를 코드에 박지 않는다
 * (`CLAUDE.md` §1.5).
 *
 * **막다른 경우 둘을 조용히 넘기지 않는다.**
 *
 * - 값이 없으면 구간도 없다. `edges`와 `counts`가 둘 다 비고, 화면은 그릴 것이 없다는
 *   것을 길이로 안다.
 * - 값이 전부 같으면 폭이 0이다. 그때는 **그 값을 가운데 둔 구간 하나**를 만든다 —
 *   numpy가 `[x - 0.5, x + 0.5]`로 하는 것과 같다. 구간을 안 만들면 "값이 하나뿐인 열"이
 *   "값이 없는 열"과 화면에서 구별되지 않는다.
 */
export function histogram(values: readonly number[], maxBins: number): Histogram {
  if (values.length === 0) return { edges: [], counts: [], capped: false }

  const sorted = [...values].sort((a, b) => a - b)
  const low = sorted[0] as number
  const high = sorted[sorted.length - 1] as number
  const range = high - low

  if (range === 0) {
    return { edges: [low - 0.5, low + 0.5], counts: [values.length], capped: false }
  }

  const width = autoBinWidth(sorted, range)
  const wanted = width > 0 ? Math.ceil(range / width) : 1
  const bins = Math.max(1, Math.min(wanted, maxBins))

  const edges: number[] = []
  for (let i = 0; i <= bins; i += 1) edges.push(low + (range * i) / bins)
  // **마지막 경계는 계산하지 않고 박는다.** 부동소수 누적으로 최댓값보다 아주 조금
  // 작아지면 그 값 하나가 어느 구간에도 안 들어간다.
  edges[bins] = high

  const counts = new Array<number>(bins).fill(0)
  for (const value of values) {
    // 마지막 구간만 오른쪽 끝을 포함한다. numpy·matplotlib의 규칙과 같다.
    const position = Math.floor(((value - low) / range) * bins)
    const index = Math.min(position, bins - 1)
    counts[index] = (counts[index] as number) + 1
  }

  return { edges, counts, capped: wanted > bins }
}

/**
 * 박스 플롯 하나가 필요한 것 전부.
 *
 * **수염은 사분위수가 아니라 실제 값이다** — 상자에서 사분위 범위의 1.5배 안에 있는
 * 가장 바깥 값까지 뻗는다. 그 밖은 이상치로 따로 찍는다.
 */
export interface BoxSummary {
  readonly min: number
  readonly q1: number
  readonly median: number
  readonly q3: number
  readonly max: number
  /** 아래 수염 끝. 이상치가 없으면 `min`과 같다. */
  readonly lowerWhisker: number
  /** 위 수염 끝. 이상치가 없으면 `max`와 같다. */
  readonly upperWhisker: number
  /** 수염 밖의 값. **오름차순이다.** */
  readonly outliers: readonly number[]
  /** 요약이 본 값의 수. */
  readonly count: number
}

/**
 * 수염이 뻗는 거리 — 사분위 범위의 **1.5배**.
 *
 * **우리가 고른 수가 아니다.** 튜키가 박스 플롯을 만들면서 정한 값이고, matplotlib의
 * `whis`도 Orange3의 Box Plot도 기본이 1.5다. 학생이 교과서와 파이썬에서 보는 그림과
 * 같은 그림이어야 하므로 여기서 다른 수를 쓸 이유가 없다.
 *
 * **그래서 `limits.ts`에 안 둔다.** 이 파일의 다른 상수들과 성질이 다르다 — 우리 기기도
 * 교실도 아닌 **바깥의 규약**이고, 바꾸면 그림의 뜻이 달라진다.
 */
const WHISKER_IQR_MULTIPLIER = 1.5

/**
 * 다섯 수 요약과 이상치를 구한다. 값이 없으면 `null`이다.
 *
 * **`null`을 돌려주는 것이 계약이다.** 빈 요약(0으로 채운 것)을 주면 화면이 **모든 값이
 * 0인 열**과 구별하지 못하고, 실제로 그런 상자를 그려 버린다.
 */
export function boxSummary(values: readonly number[]): BoxSummary | null {
  if (values.length === 0) return null

  const sorted = [...values].sort((a, b) => a - b)
  const q1 = quantile(sorted, 0.25)
  const median = quantile(sorted, 0.5)
  const q3 = quantile(sorted, 0.75)
  const reach = (q3 - q1) * WHISKER_IQR_MULTIPLIER

  const lowerFence = q1 - reach
  const upperFence = q3 + reach

  const outliers = sorted.filter((value) => value < lowerFence || value > upperFence)
  const inside = sorted.filter((value) => value >= lowerFence && value <= upperFence)

  return {
    min: sorted[0] as number,
    q1,
    median,
    q3,
    max: sorted[sorted.length - 1] as number,
    // **울타리가 아니라 울타리 안의 실제 값까지다.** 울타리를 그리면 데이터가 없는
    // 자리까지 수염이 뻗어서, 학생이 그 끝을 최댓값으로 읽는다.
    lowerWhisker: (inside[0] ?? sorted[0]) as number,
    upperWhisker: (inside[inside.length - 1] ?? sorted[sorted.length - 1]) as number,
    outliers,
    count: values.length,
  }
}

/** 값 하나와 그 도수. */
export interface Frequency {
  readonly value: string
  readonly count: number
}

/** 범주 열의 도수 분포. */
export interface Frequencies {
  /**
   * 그릴 막대. **첫 등장 순서다** (아래 `frequencies`의 머리말).
   */
  readonly bars: readonly Frequency[]
  /** 빈 칸이었던 행 수. 막대에 안 들어간다. */
  readonly missing: number
  /** 서로 다른 값의 수(결측 제외). `bars.length`보다 클 수 있다. */
  readonly distinct: number
  /** 상한에 밀려 안 그린 값들의 행 수 합계. 0이면 전부 그렸다. */
  readonly omitted: number
}

/**
 * 범주 열의 도수를 센다.
 *
 * **순서는 첫 등장 순서다. 도수 내림차순이 아니다.** 전처리의 원-핫 인코딩이 같은
 * 순서를 쓰기 때문이다(`fitPreprocessor`의 `[...new Set(present)]`) — 두 화면이 같은 열을
 * 다른 순서로 늘어놓으면, 학생이 그림에서 읽은 순서와 인코딩된 특성 이름의 순서가
 * 어긋난다. 읽기 쉬움보다 **두 화면이 같은 말을 하는 것**을 고른다.
 *
 * **무엇을 남길지는 도수가 정하고, 어떻게 늘어놓을지는 등장 순서가 정한다.** 둘은 다른
 * 질문이다 — 학번처럼 값이 행 수만큼 많은 열에서 앞 20개만 남기면 그건 "가장 흔한
 * 값들"이 아니라 "파일 맨 위의 값들"이라, 그림이 아무것도 안 말한다.
 *
 * **밀려난 값이 몇 행인지 함께 준다.** 화면이 그 사실을 말해야 한다.
 */
export function frequencies(cells: readonly string[], maxBars: number): Frequencies {
  const counts = new Map<string, number>()
  let missing = 0

  for (const cell of cells) {
    if (isBlank(cell)) {
      missing += 1
      continue
    }
    counts.set(cell, (counts.get(cell) ?? 0) + 1)
  }

  const distinct = counts.size
  const entries = [...counts.entries()]

  // **동점이면 먼저 나온 값이 이긴다.** Map이 삽입 순서를 지키므로 결정적이다 —
  // `mostFrequent`(ml/preprocess.ts)가 쓰는 규칙과 같다.
  const kept = new Set(
    [...entries]
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(0, maxBars))
      .map(([value]) => value),
  )

  const bars = entries
    .filter(([value]) => kept.has(value))
    .map(([value, count]) => ({ value, count }))

  const omitted = entries
    .filter(([value]) => !kept.has(value))
    .reduce((sum, [, count]) => sum + count, 0)

  return { bars, missing, distinct, omitted }
}

/** 산점도에 찍는 점 하나. */
export interface DataPoint {
  /** 정본 표의 행 번호. 툴팁이 이것으로 그 줄을 가리킨다. */
  readonly row: number
  readonly x: number
  readonly y: number
  /**
   * 색을 가르는 값. 색 열을 안 골랐으면 `undefined`다.
   *
   * **번호가 아니라 값 그대로다** — 색을 배정하는 것은 그리는 쪽의 일이고, 여기서
   * 번호를 매기면 그 번호가 무엇이었는지를 화면이 다시 물어야 한다.
   */
  readonly group?: string
}

export interface ScatterSample {
  readonly points: readonly DataPoint[]
  /** 실제로 찍는 점 수. */
  readonly drawn: number
  /**
   * 두 열이 **모두** 수로 읽힌 행 수. 한쪽이라도 비면 점을 못 찍으므로 여기서 빠진다.
   *
   * **`drawn`과 다르면 화면이 그 사실을 말한다.** 조용히 일부만 그리면 학생은 자기
   * 데이터가 다 거기 있다고 믿는다 (`open-decisions.md` #28-5와 같은 규칙이다).
   */
  readonly total: number
  /** 두 열 중 한쪽이라도 비거나 수로 안 읽혀서 못 찍은 행 수. */
  readonly skipped: number
}

/**
 * 산점도에 찍을 점을 고른다. **상한을 넘으면 씨앗으로 표본을 뽑는다.**
 *
 * **씨앗은 부르는 쪽이 준다** — 프로젝트의 `split.randomState`다. 같은 프로젝트를 다시
 * 열면 같은 그림이라야 학생이 어제 본 것을 오늘도 본다. `Math.random`으로 뽑으면
 * 새로고침할 때마다 그림이 달라지고, 학생은 자기가 뭘 바꿔서 달라진 줄 안다.
 *
 * **점을 못 찍는 행은 표본을 뽑기 전에 뺀다.** 뽑고 나서 버리면 `limit`이 1만인데
 * 실제로 그려지는 것은 그보다 적어지고, 결측이 많은 열일수록 더 적어진다.
 */
export function scatterSample(
  xCells: readonly string[],
  yCells: readonly string[],
  limit: number,
  randomState: number,
  groupCells?: readonly string[],
): ScatterSample {
  const usable: DataPoint[] = []
  const rowCount = Math.max(xCells.length, yCells.length)

  for (let row = 0; row < rowCount; row += 1) {
    const x = toNumber(xCells[row] ?? '')
    const y = toNumber(yCells[row] ?? '')
    if (x === null || y === null) continue
    const group = groupCells?.[row]
    usable.push(group === undefined || group.trim() === '' ? { row, x, y } : { row, x, y, group })
  }

  const total = usable.length
  const picked =
    total <= limit
      ? usable
      : sampleIndices(total, limit, randomState).map((index) => usable[index] as DataPoint)

  return { points: picked, drawn: picked.length, total, skipped: rowCount - total }
}
