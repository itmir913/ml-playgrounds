/**
 * 상한 off 스위치 (`src/limits-switch.ts`).
 *
 * **여기서 지키는 것은 셋이다** — 껐을 때 상한이 실제로 열리는가, 켜 두면 값이 그대로인가,
 * 그리고 **`Infinity`가 판 크기로 새지 않는가**.
 *
 * 마지막이 이 파일이 있는 진짜 이유다. `Infinity`를 판 크기로 그대로 쓰면 첫 판이
 * `0 * Infinity = NaN`으로 통째로 비는데, **아무 오류도 안 나고 화면만 빈다.**
 */

import { afterEach, describe, expect, it } from 'vitest'

import {
  MAX_DATASET_COLUMNS,
  MAX_DATASET_ROWS,
  MAX_IMAGE_COUNT,
  MAX_PORTFOLIO_BYTES,
  PREDICT_PAGE_SIZE,
} from '../src/limits'
import {
  applyLimitsOff,
  clusterScatterPointLimit,
  imagePredictPageSize,
  limitsOff,
  maxDatasetColumns,
  maxDatasetRows,
  maxImageCount,
  maxPortfolioBytes,
  pageSizeOf,
  predictPageSize,
} from '../src/limits-switch'

// **스위치는 모듈 하나가 들고 있는 상태다.** 끄고 나가지 않으면 다음 스펙이 켜진 채로 돈다.
afterEach(() => applyLimitsOff(false))

describe('스위치를 안 켜면 아무것도 안 바뀐다', () => {
  it('기본값이 꺼짐이다', () => {
    expect(limitsOff.value).toBe(false)
  })

  it('상한이 `limits.ts`의 값 그대로다', () => {
    expect(maxDatasetRows()).toBe(MAX_DATASET_ROWS)
    expect(maxDatasetColumns()).toBe(MAX_DATASET_COLUMNS)
    expect(maxImageCount()).toBe(MAX_IMAGE_COUNT)
    expect(predictPageSize()).toBe(PREDICT_PAGE_SIZE)
    expect(maxPortfolioBytes()).toBe(MAX_PORTFOLIO_BYTES)
  })
})

describe('켜면 일곱이 함께 열린다', () => {
  /**
   * **부분만 열리면 설명할 말이 없다** (`open-decisions.md` "상한은 누가 정했느냐" §2).
   * 하나씩 확인하는 이유는 새 상한이 이 모듈에 들어오면서 `open()`을 안 거치는 일이
   * 실제로 일어나기 때문이다 — 그때 그 하나만 조용히 옛 값을 낸다.
   */
  it('일곱이 전부 열린다', () => {
    applyLimitsOff(true)
    for (const read of [
      maxDatasetRows,
      maxDatasetColumns,
      maxImageCount,
      predictPageSize,
      imagePredictPageSize,
      clusterScatterPointLimit,
      maxPortfolioBytes,
    ]) {
      expect(read()).toBe(Number.POSITIVE_INFINITY)
    }
  })

  it('업로드 판정이 그대로 통한다 - 껐을 때 비교가 안 깨진다', () => {
    applyLimitsOff(true)
    // `data/table.ts`가 하는 비교 그대로. 켜면 어떤 크기도 안 걸린다.
    expect(1_000_000 > maxDatasetRows()).toBe(false)
    // 파서가 하는 비교 그대로 (`data/csv.ts` · `data/xlsx.ts`).
    expect(1_000_000 >= maxDatasetRows() + 1).toBe(false)
  })
})

describe('판 크기는 `Infinity`가 아니라 전체 개수가 된다', () => {
  it('상한이 있으면 그 값이다', () => {
    expect(pageSizeOf(20, 137)).toBe(20)
  })

  it('상한이 없으면 한 판에 전부다', () => {
    expect(pageSizeOf(Number.POSITIVE_INFINITY, 137)).toBe(137)
  })

  it('세울 것이 없어도 판은 하나다 - 0으로 나누지 않는다', () => {
    expect(pageSizeOf(Number.POSITIVE_INFINITY, 0)).toBe(1)
    expect(Math.max(1, Math.ceil(0 / pageSizeOf(Number.POSITIVE_INFINITY, 0)))).toBe(1)
  })

  /**
   * **이것을 안 하면 화면이 빈다.** 부르는 쪽이 `page * 크기`로 시작 위치를 내므로
   * 첫 판에서 `0 * Infinity`가 `NaN`이 되고, `slice(NaN, NaN)`은 빈 배열이다.
   */
  it('첫 판의 시작 위치가 NaN이 아니다', () => {
    const size = pageSizeOf(Number.POSITIVE_INFINITY, 3)
    const start = 0 * size
    expect(Number.isNaN(start)).toBe(false)
    expect([1, 2, 3].slice(start, start + size)).toEqual([1, 2, 3])
  })

  it('`Infinity`를 그대로 쓰면 실제로 빈다 - 위 검사가 무엇을 막는지', () => {
    const start = 0 * Number.POSITIVE_INFINITY
    expect([1, 2, 3].slice(start, start + Number.POSITIVE_INFINITY)).toEqual([])
  })
})
