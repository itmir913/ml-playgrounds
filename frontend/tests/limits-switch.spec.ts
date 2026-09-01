/**
 * 상한 off 스위치 (`src/limits-switch.ts`).
 *
 * **여기서 지키는 것은 셋이다** — 껐을 때 상한이 실제로 열리는가, 켜 두면 값이 그대로인가,
 * 그리고 **`Infinity`가 판 크기로 새지 않는가**.
 *
 * 마지막이 이 파일이 있는 진짜 이유다. `Infinity`를 판 크기로 그대로 쓰면 첫 판이
 * `0 * Infinity = NaN`으로 통째로 비는데, **아무 오류도 안 나고 화면만 빈다.**
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import 'fake-indexeddb/auto'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { withoutComments } from './fixtures/source'

import { runtimeContextFor } from '../src/ml/training-source'
import { writeLimitsOff } from '../src/project/storage'

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

/**
 * **선택은 이 기기에 남는다** (`project/storage.ts`의 preferences, 언어 선택 옆).
 *
 * **모듈을 다시 들여와서 잰다.** 스위치는 모듈 하나가 들고 있는 상태라, 같은 인스턴스로
 * 두 번 재면 앞 검사가 남긴 "사람이 골랐다"가 뒤 검사의 답을 바꾼다
 * ([[shared-test-fixtures]]와 같은 종류의 함정이다).
 */
describe('선택은 이 기기에 남는다', () => {
  async function freshModule(): Promise<typeof import('../src/limits-switch')> {
    vi.resetModules()
    return import('../src/limits-switch')
  }

  it('앱이 뜰 때 저장된 값을 반영한다', async () => {
    await writeLimitsOff(true)
    const module = await freshModule()
    expect(module.limitsOff.value).toBe(false)
    await module.initLimitsOff()
    expect(module.limitsOff.value).toBe(true)
    await writeLimitsOff(false)
  })

  it('켠 것이 저장된다', async () => {
    const module = await freshModule()
    await module.setLimitsOff(true)
    const next = await freshModule()
    await next.initLimitsOff()
    expect(next.limitsOff.value).toBe(true)
    await writeLimitsOff(false)
  })

  /**
   * **나중에 온 것이 아니라 사람이 고른 것이 이긴다** (`i18n.ts`의 `chosenByUser`와 같은
   * 자리). 저장된 값을 읽는 것은 비동기라, 느린 기기에서는 그 사이에 학생이 스위치를
   * 만질 수 있다. 뒤늦게 도착한 옛 값이 그 선택을 되돌리면 화면이 혼자 되돌아간다.
   *
   * **저장소를 세워 놓고 잰다.** 진짜 IndexedDB로는 이 순서를 못 만든다 — 먼저 시작한
   * 읽기가 나중에 끝나는 그 창을 우리가 열어야 하고, 안 그러면 **가드를 지워도 초록인**
   * 검사가 된다 (실제로 처음엔 그랬다).
   */
  it('읽는 중에 학생이 고르면 그 선택이 이긴다', async () => {
    let deliver: (value: boolean) => void = () => {}
    vi.resetModules()
    vi.doMock('../src/project/storage', () => ({
      readLimitsOff: () =>
        new Promise<boolean>((resolve) => {
          deliver = resolve
        }),
      writeLimitsOff: () => Promise.resolve(),
    }))
    const module = await import('../src/limits-switch')

    const arriving = module.initLimitsOff()
    await module.setLimitsOff(true)
    // 저장소가 이제야 옛 값을 들고 도착한다.
    deliver(false)
    await arriving

    expect(module.limitsOff.value).toBe(true)
    vi.doUnmock('../src/project/storage')
  })

  /**
   * **모듈을 원래대로 돌려놓고 나간다** (2026-09-01 감사 C-3). 위 검사들이 남긴
   * `resetModules`를 안 치우면 **뒤에 붙는 검사가 동적 `import`로 다른 인스턴스를 받는다**
   * — 감사자가 실제로 그렇게 넘어졌고, 깨끗한 소스에서 난 빨강이라 "코드가 틀렸다"로
   * 읽힌다. 되돌리기는 마지막 검사의 본문이 아니라 여기 있어야 한다(그 검사가 깨져도 돈다).
   */
  afterEach(() => {
    vi.doUnmock('../src/project/storage')
    vi.resetModules()
  })
})

/**
 * **스위치를 화면에서 판정으로 잇는 유일한 자리** (2026-09-01 감사 A-1).
 *
 * `runtimeContextFor`가 `limitsOff`를 싣는 한 줄이 끊기면 **기능이 통째로 죽는다** —
 * 상태 바는 "상한을 해제했습니다"라고 말하는데 카드도 업로드도 그대로 막힌다. 그런데
 * 그 줄을 `false`로 고정해도 저장소 359개가 전부 초록이었다.
 *
 * **같은 함수가 이미 같은 병을 앓았다.** `training-source.ts`의 머리말이 R13-3 A-2를
 * 두고 *"타입이 필수로 만들어 두어 빠뜨릴 수는 없지만 틀린 값을 넣는 것은 아무도 안
 * 봤다"*고 적는다. 나머지 필드 셋에는 그때 검사가 섰고, **넷째만 그 줄에서 빠졌다.**
 *
 * **정적으로 들여온다** — 위 describe가 모듈을 갈아 끼우므로 동적 `import`로 받으면
 * 다른 인스턴스의 `limitsOff`를 보게 된다.
 */
describe('맥락이 스위치를 싣는다', () => {
  it('runtimeContextFor가 지금 선택을 그대로 넘긴다', () => {
    applyLimitsOff(true)
    expect(runtimeContextFor(null, 'tabular').limitsOff).toBe(true)
    applyLimitsOff(false)
    expect(runtimeContextFor(null, 'tabular').limitsOff).toBe(false)
  })
})

/**
 * **목록을 손으로 적지 않는다** (2026-09-01 감사 B-2).
 *
 * 위 `일곱이 전부 열린다`는 이름을 손으로 열거하므로, **여덟째가 `open()`을 안 거치고
 * 들어오면 아무 일도 안 일어난다** — 그 검사의 주석이 막겠다고 적은 바로 그 경우다.
 * 단정이 자기 목록을 근거로 하면 안 된다.
 *
 * 그래서 **소스에서 뽑는다.** 같은 저장소가 이미 옳은 모양을 갖고 있다 —
 * `limits-rules.spec.ts`의 `SWITCHABLE`이 분류 태그를 소스에서 읽는다.
 */
describe('내보내는 읽기 함수가 전부 스위치를 거친다', () => {
  /**
   * **주석을 걷고 본다** (2026-09-01 감사 B-3). 날것으로 읽던 때는 `open(`이 **주석에만**
   * 있어도 통과했다 — `tests/fixtures/source.ts`가 존재하는 이유가 정확히 그 함정이다.
   */
  const SOURCE = withoutComments(
    readFileSync(join(process.cwd(), 'src', 'limits-switch.ts'), 'utf-8'),
  ).join('\n')

  /**
   * **상한을 읽어 내보내는 함수들.** 판별자는 인자 수가 아니라 **본문이 `limits.ts`의
   * 상수를 읽는가**다.
   *
   * **인자 수로 가르던 것을 바꿨다** (2026-09-01 감사 B-3). `\(\)`만 보던 때는
   * `maxDatasetRowsFor(scale: number)` 같은 여덟째가 아예 안 보였다. 그렇다고 인자를
   * 받는 것을 다 넣으면 `pageSizeOf(limit, total)`이 걸리는데, **저건 상한을 받는
   * 함수이지 읽는 함수가 아니다** — 스위치를 거칠 것이 없다.
   */
  const readers = [...SOURCE.matchAll(/export function (\w+)\([^)]*\)\s*:\s*number\s*\{([^}]*)\}/g)]
    .map((match) => ({ name: match[1] ?? '', body: match[2] ?? '' }))
    .filter((one) => /\b[A-Z][A-Z0-9_]{3,}\b/.test(one.body))

  it('뽑을 것을 실제로 찾는다', () => {
    // 0개면 정규식이 썩은 것이지 규칙이 지켜진 게 아니다.
    expect(readers.length).toBeGreaterThanOrEqual(7)
  })

  it('하나도 빠짐없이 `open()`을 거친다', () => {
    const bare = readers.filter((one) => !one.body.includes('open(')).map((one) => one.name)
    expect(bare, 'read it through open() or the switch will not reach it').toEqual([])
  })
})
