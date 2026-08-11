/**
 * 행 표본 뽑기 (`open-decisions.md` #22).
 *
 * **여기가 틀리면 분할과 같은 방식으로 조용히 틀린다** — 지표는 멀쩡해 보이는데 다른
 * 행으로 학습된 것이다. 그래서 확인하는 것 넷.
 *
 *   1. `nSamples`가 없거나 가진 행보다 크면 **아무것도 안 바뀌는가** (옛 파일이 그대로 열린다)
 *   2. 같은 씨앗이면 언제나 같은 표본인가 (재현 가능성)
 *   3. 돌려주는 것이 **원본 행 번호**인가 (참조형 모델이 이 번호로 CSV를 가리킨다)
 *   4. 층화가 라벨 비율을 지키고, **어떤 라벨도 통째로 빠지지 않는가**
 */

import { describe, expect, it } from 'vitest'

import { isClientError } from '../src/errors'
import { MIN_SPLIT_ROWS } from '../src/limits'
import { sampleRows } from '../src/ml/sample'
import type { Split } from '../src/project/schema'

const split = (overrides: Partial<Split> = {}): Split => ({
  method: 'holdout',
  testSize: 0.2,
  stratify: false,
  randomState: 42,
  ...overrides,
})

const rows = (count: number): number[] => [...Array(count).keys()]

/** 한쪽으로 쏠린 교실 데이터. 층화가 없으면 'C'가 통째로 빠질 수 있는 모양이다. */
function skewed(): { rows: number[]; labels: string[] } {
  const labels = [
    ...Array(600).fill('A'),
    ...Array(300).fill('B'),
    ...Array(100).fill('C'),
  ] as string[]
  return { rows: rows(1000), labels }
}

function codeOf(run: () => unknown): string {
  try {
    run()
  } catch (error) {
    return isClientError(error) ? error.code : `던진 것이 ClientError가 아니다: ${String(error)}`
  }
  return '아무것도 던지지 않았다'
}

describe('뽑지 않는 경우', () => {
  it('nSamples가 없으면 그대로 돌려준다', () => {
    expect(sampleRows({ rows: rows(1000) }, split(), undefined)).toEqual(rows(1000))
  })

  it('nSamples가 가진 행보다 크거나 같으면 그대로 돌려준다', () => {
    expect(sampleRows({ rows: rows(50) }, split(), 50)).toEqual(rows(50))
    expect(sampleRows({ rows: rows(50) }, split(), 999)).toEqual(rows(50))
  })

  it('층화를 켰어도 뽑지 않을 때는 라벨을 보지 않는다', () => {
    const { rows: all, labels } = skewed()
    expect(sampleRows({ rows: all, labels }, split({ stratify: true }), undefined)).toEqual(all)
  })
})

describe('뽑는 경우', () => {
  it('정확히 nSamples개다', () => {
    expect(sampleRows({ rows: rows(1000) }, split(), 300)).toHaveLength(300)
  })

  it('같은 씨앗이면 언제나 같은 표본이다', () => {
    const first = sampleRows({ rows: rows(1000) }, split({ randomState: 7 }), 300)
    const second = sampleRows({ rows: rows(1000) }, split({ randomState: 7 }), 300)
    expect(second).toEqual(first)
  })

  it('씨앗이 다르면 다른 표본이다', () => {
    const first = sampleRows({ rows: rows(1000) }, split({ randomState: 7 }), 300)
    const second = sampleRows({ rows: rows(1000) }, split({ randomState: 8 }), 300)
    expect(second).not.toEqual(first)
  })

  it('앞에서부터 자르지 않는다 - 뽑은 것이지 잘라낸 것이 아니다', () => {
    const picked = sampleRows({ rows: rows(1000) }, split(), 300)
    expect(picked).not.toEqual(rows(300))
  })

  it('**원본 행 번호**를 돌려준다 - 0부터 다시 세지 않는다', () => {
    // usableRows가 걸러낸 뒤라 번호가 듬성듬성하다. 참조형 모델이 이 번호로 CSV를
    // 가리키므로 여기서 0부터 다시 세면 조용히 다른 행을 가리킨다.
    const sparse = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const picked = sampleRows({ rows: sparse }, split(), 4)
    expect(picked).toHaveLength(4)
    for (const row of picked) expect(sparse).toContain(row)
  })

  it('오름차순으로 돌려준다', () => {
    const picked = sampleRows({ rows: rows(1000) }, split(), 300)
    expect(picked).toEqual([...picked].sort((a, b) => a - b))
  })

  it('중복이 없다', () => {
    const picked = sampleRows({ rows: rows(1000) }, split(), 300)
    expect(new Set(picked).size).toBe(picked.length)
  })
})

describe('층화', () => {
  it('라벨 비율을 지킨다', () => {
    const { rows: all, labels } = skewed()
    const byRow = new Map(all.map((row, i) => [row, labels[i] as string]))
    const picked = sampleRows({ rows: all, labels }, split({ stratify: true }), 200)

    const counts = new Map<string, number>()
    for (const row of picked) {
      const label = byRow.get(row) as string
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }

    // 600:300:100 → 200줄이면 120:60:20이다. 최대잉여법이라 정확히 떨어진다.
    expect(counts.get('A')).toBe(120)
    expect(counts.get('B')).toBe(60)
    expect(counts.get('C')).toBe(20)
    expect(picked).toHaveLength(200)
  })

  it('나누어떨어지지 않아도 합이 정확히 nSamples다', () => {
    const { rows: all, labels } = skewed()
    for (const n of [7, 33, 101, 457, 999]) {
      expect(sampleRows({ rows: all, labels }, split({ stratify: true }), n)).toHaveLength(n)
    }
  })

  it('희소한 라벨이 통째로 빠지지 않는다 - 층화를 두는 이유가 이것이다', () => {
    // 'C'가 1000줄 중 3줄뿐이다. 층화 없이 30줄을 뽑으면 안 뽑힐 확률이 높고,
    // 그러면 학생이 만지지도 않은 분할 단계에서 SPLIT_STRATIFY_IMPOSSIBLE이 터진다.
    const labels = [...Array(997).fill('A'), ...Array(3).fill('C')] as string[]
    const byRow = new Map(rows(1000).map((row, i) => [row, labels[i] as string]))
    const picked = sampleRows({ rows: rows(1000), labels }, split({ stratify: true }), 30)

    const rare = picked.filter((row) => byRow.get(row) === 'C')
    expect(rare.length).toBeGreaterThanOrEqual(MIN_SPLIT_ROWS)
  })

  it('같은 씨앗이면 층화 표본도 같다', () => {
    const { rows: all, labels } = skewed()
    const first = sampleRows({ rows: all, labels }, split({ stratify: true }), 200)
    const second = sampleRows({ rows: all, labels }, split({ stratify: true }), 200)
    expect(second).toEqual(first)
  })

  it('라벨이 없으면 층화를 켰어도 그냥 뽑는다 - 군집화에는 타깃이 없다', () => {
    expect(sampleRows({ rows: rows(1000) }, split({ stratify: true }), 300)).toHaveLength(300)
  })

  it('뽑을 줄 수가 라벨 종류를 감당 못 하면 조용히 층화를 풀지 않는다', () => {
    // 라벨 10종류인데 5줄만 뽑으라고 하면 어떤 라벨은 0개가 된다. 그건 층화가 아니다.
    const labels = rows(1000).map((i) => `label-${i % 10}`)
    expect(
      codeOf(() => sampleRows({ rows: rows(1000), labels }, split({ stratify: true }), 5)),
    ).toBe('SAMPLE_STRATIFY_IMPOSSIBLE')
  })

  it('원래부터 희귀한 라벨의 사정은 여기서 판정하지 않는다', () => {
    // 'C'가 1줄뿐이다. 그건 분할이 SPLIT_STRATIFY_IMPOSSIBLE로 말할 일이고,
    // 샘플링을 켜든 안 켜든 같은 말이 나와야 한다. 여기서 먼저 던지면 안 된다.
    const labels = [...Array(999).fill('A'), 'C'] as string[]
    const picked = sampleRows({ rows: rows(1000), labels }, split({ stratify: true }), 100)
    expect(picked).toHaveLength(100)
  })
})
