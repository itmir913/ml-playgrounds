/**
 * 명렬 (`project/roster.ts`, `composables/useRoster.ts`).
 *
 * **여기서 지키는 것 셋.**
 *
 *   1. **입구가 둘이어도 명렬은 하나다** — 폴더째든 파일 하나든 같은 함수를 지난다
 *   2. **같은 파일을 두 번 풀지 않고, 한 번에 하나만 푼다** — 서른 개짜리 폴더에서
 *      메모리가 서지 않는 이유가 그것이다
 *   3. **폴더를 바꾸면 옛 훑기의 결과가 새 명렬에 안 앉는다** — 다른 반의 요약이 이 반에
 *      붙는 것이 이 화면에서 가장 나쁜 결함이다
 */

import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import {
  rosterOf,
  sortRoster,
  summaryOf,
  withEdit,
  type RosterItem,
  type RosterSummary,
} from '../src/project/roster'
import { newProjectDocument } from '../src/project/create'
import type { ProjectDocument } from '../src/project/schema'

/** 고른 파일 하나. `webkitRelativePath`는 표준 밖이라 손으로 붙인다. */
function picked(name: string, relative?: string): File {
  const file = new File([new Uint8Array([1, 2, 3])], name)
  if (relative !== undefined) {
    Object.defineProperty(file, 'webkitRelativePath', { value: relative })
  }
  return file
}

function document(overrides: Partial<ProjectDocument['manifest']> = {}): ProjectDocument {
  const base = newProjectDocument(
    { name: '붓꽃 분류', locale: 'ko', dataType: 'tabular' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-09-18T00:00:00.000Z',
      randomState: 42,
    },
  )
  return { ...base, manifest: { ...base.manifest, ...overrides } }
}

describe('명렬을 만든다', () => {
  it('.mlpx가 아닌 것은 지나친다 - 폴더에는 별게 다 들어 있다', () => {
    const items = rosterOf([picked('kim.mlpx'), picked('메모.txt'), picked('사진.png')])
    expect(items.map((one) => one.label)).toEqual(['kim.mlpx'])
  })

  it('폴더째 고르면 상대 경로가 이름표다 - 반이 다르면 같은 이름도 갈린다', () => {
    const items = rosterOf([picked('kim.mlpx', '2반/kim.mlpx'), picked('kim.mlpx', '1반/kim.mlpx')])
    // 정렬도 그 이름표로 한다 — 반이 묶여 선다.
    expect(items.map((one) => one.label)).toEqual(['1반/kim.mlpx', '2반/kim.mlpx'])
  })

  it('파일 하나를 골라도 같은 명렬을 지난다 - 단일 파일용 갈래가 없다', () => {
    const items = rosterOf([picked('kim.mlpx')])
    expect(items).toHaveLength(1)
    expect(items[0]?.label).toBe('kim.mlpx')
  })

  it('확장자는 대소문자를 안 가린다 - 학생 파일 이름은 무엇이든 온다', () => {
    expect(rosterOf([picked('KIM.MLPX')])).toHaveLength(1)
  })
})

describe('요약은 메타에서 나온다', () => {
  it('이름과 학번과 실험 수를 남긴다', () => {
    const summary = summaryOf(
      document({ student: { name: '김하나', studentId: '10101' } } as Partial<
        ProjectDocument['manifest']
      >),
    )
    expect(summary).toEqual({
      state: 'read',
      name: '붓꽃 분류',
      studentId: '10101',
      studentName: '김하나',
      dataType: 'tabular',
      experiments: 0,
      runs: 0,
    })
  })

  it('학생이 안 적은 칸은 안 만든다 - 없는 것을 빈 문자열로 말하지 않는다', () => {
    const blank = summaryOf(
      document({ student: { name: '  ', studentId: '' } } as Partial<ProjectDocument['manifest']>),
    )
    expect(blank).not.toHaveProperty('studentName')
    expect(blank).not.toHaveProperty('studentId')
    expect(summaryOf(document())).not.toHaveProperty('studentName')
  })
})

/** 읽기를 손으로 쥔 명렬. 언제 끝날지는 검사가 정한다. */
function harness() {
  const reads: { label: string; settle: (bytes: Uint8Array) => void }[] = []
  vi.doMock('../src/project/download', () => ({
    readFileBytes: (file: File) =>
      new Promise<Uint8Array>((resolve) => {
        reads.push({ label: file.name, settle: resolve })
      }),
  }))
  return reads
}

describe('읽기는 한 줄로 흐른다', () => {
  it('동시에 푸는 파일이 하나다', async () => {
    vi.resetModules()
    const reads = harness()
    const { useRoster: fresh } = await import('../src/composables/useRoster')

    const roster = fresh()
    roster.show(rosterOf([picked('a.mlpx'), picked('b.mlpx'), picked('c.mlpx')]))
    await flushPromises()

    // **셋을 한꺼번에 열지 않는다.** 사진이 든 제출물 서른 개를 동시에 풀면 거기서 선다.
    expect(reads).toHaveLength(1)
    expect(reads[0]?.label).toBe('a.mlpx')

    reads[0]?.settle(new Uint8Array([1]))
    await flushPromises()
    expect(reads).toHaveLength(2)
    expect(reads[1]?.label).toBe('b.mlpx')
    vi.doUnmock('../src/project/download')
  })

  it('고른 줄이 맨 앞으로 간다', async () => {
    vi.resetModules()
    const reads = harness()
    const { useRoster: fresh } = await import('../src/composables/useRoster')

    const roster = fresh()
    const items = rosterOf([picked('a.mlpx'), picked('b.mlpx'), picked('c.mlpx')])
    roster.show(items)
    await flushPromises()

    void roster.open(items[2] as RosterItem)
    reads[0]?.settle(new Uint8Array([1]))
    await flushPromises()

    // 훑기 순서대로면 b가 왔을 자리다. 교사가 고른 것이 먼저다.
    expect(reads[1]?.label).toBe('c.mlpx')
    vi.doUnmock('../src/project/download')
  })

  it('줄 서 있던 파일을 고르면 두 번 읽지 않는다', async () => {
    // 훑기가 아직 안 지난 줄을 교사가 고르면 그 줄은 **앞으로 옮겨질 뿐** 큐에 하나 더
    // 생기지 않는다. 안 그러면 사진이 든 제출물을 두 번 푼다.
    vi.resetModules()
    const reads = harness()
    const { useRoster: fresh } = await import('../src/composables/useRoster')

    const roster = fresh()
    const items = rosterOf([picked('a.mlpx'), picked('b.mlpx'), picked('c.mlpx')])
    roster.show(items)
    await flushPromises()

    void roster.open(items[2] as RosterItem)
    for (let index = 0; index < 4; index += 1) {
      reads[index]?.settle(new Uint8Array([1]))
      await flushPromises()
    }

    expect(reads.map((one) => one.label)).toEqual(['a.mlpx', 'c.mlpx', 'b.mlpx'])
    vi.doUnmock('../src/project/download')
  })
})

describe('명렬을 바꾸면 옛 결과는 버린다', () => {
  it('다른 폴더를 고르면 앞의 요약이 안 앉는다', async () => {
    vi.resetModules()
    const reads = harness()
    const { useRoster: fresh } = await import('../src/composables/useRoster')

    const roster = fresh()
    roster.show(rosterOf([picked('1반-kim.mlpx')]))
    await flushPromises()

    // 읽는 도중에 교사가 다른 폴더를 골랐다.
    roster.show(rosterOf([picked('2반-lee.mlpx')]))
    await flushPromises()

    // 옛 읽기가 이제야 끝난다. **그 결과는 새 명렬에 앉으면 안 된다.**
    reads[0]?.settle(new Uint8Array([1]))
    await flushPromises()

    expect([...roster.summaries.value.keys()]).not.toContain('1반-kim.mlpx')
    vi.doUnmock('../src/project/download')
  })
})

/**
 * **열이 곧 정렬 기준이다** (architecture.md §8.21).
 *
 * 여기서 지키는 것 둘.
 *
 *   1. **값이 없는 줄은 뒤로 간다** — 훑는 동안 요약이 하나씩 도착하는데, 그때마다 줄이
 *      위아래로 튀면 교사가 읽던 자리를 잃는다
 *   2. **동점은 이름표로 가른다** — 안 그러면 순서가 "읽은 순서"에 달리고, 그건 매번 다르다
 */
describe('명렬을 정렬한다', () => {
  const items = rosterOf([picked('c.mlpx'), picked('a.mlpx'), picked('b.mlpx')])

  function read(name: string, experiments: number, studentName?: string): RosterSummary {
    return {
      state: 'read',
      name,
      ...(studentName === undefined ? {} : { studentName }),
      dataType: 'tabular',
      experiments,
      runs: experiments * 2,
    }
  }

  const summaries = new Map<string, RosterSummary>([
    ['a.mlpx', read('가', 3, '김하나')],
    ['b.mlpx', read('나', 1, '박두리')],
    ['c.mlpx', read('다', 3, '이세찌')],
  ])

  it('기본은 이름표순이다 - 폴더째 고르면 반이 묶여 선다', () => {
    expect(sortRoster(items, summaries, 'label').map((one) => one.label)).toEqual([
      'a.mlpx',
      'b.mlpx',
      'c.mlpx',
    ])
  })

  it('방향을 뒤집는다', () => {
    expect(sortRoster(items, summaries, 'label', true).map((one) => one.label)).toEqual([
      'c.mlpx',
      'b.mlpx',
      'a.mlpx',
    ])
  })

  it('실험 수로 세우고, 동점은 이름표로 가른다', () => {
    expect(sortRoster(items, summaries, 'experiments').map((one) => one.label)).toEqual([
      'b.mlpx',
      'a.mlpx',
      'c.mlpx',
    ])
  })

  it('아직 안 읽은 줄과 못 읽은 줄은 뒤로 간다', () => {
    const partial = new Map<string, RosterSummary>([
      ['c.mlpx', read('다', 3)],
      ['b.mlpx', { state: 'unreadable', code: 'PROJECT_FILE_VERSION_TOO_NEW' }],
    ])
    // 읽은 줄 → 못 읽은 줄 → 아직 안 읽은 줄. 방향을 뒤집어도 그 차례는 그대로다.
    expect(sortRoster(items, partial, 'label').map((one) => one.label)).toEqual([
      'c.mlpx',
      'b.mlpx',
      'a.mlpx',
    ])
    expect(sortRoster(items, partial, 'label', true).map((one) => one.label)).toEqual([
      'c.mlpx',
      'b.mlpx',
      'a.mlpx',
    ])
  })

  it('이름 없는 학생은 이름 있는 학생보다 앞이다 - 빈 값은 빈 값끼리 모인다', () => {
    const mixed = new Map<string, RosterSummary>([
      ['a.mlpx', read('가', 1)],
      ['b.mlpx', read('나', 1, '박두리')],
      ['c.mlpx', read('다', 1, '김하나')],
    ])
    expect(sortRoster(items, mixed, 'studentName').map((one) => one.label)).toEqual([
      'a.mlpx',
      'c.mlpx',
      'b.mlpx',
    ])
  })

  it('원래 배열을 안 건드린다 - 화면이 든 목록이 정렬로 흔들리면 안 된다', () => {
    const before = items.map((one) => one.label)
    sortRoster(items, summaries, 'runs', true)
    expect(items.map((one) => one.label)).toEqual(before)
  })
})

/**
 * **교사가 고친 학번·이름** (2026-09-18, 사용자).
 *
 * 학생이 잘못 적어 내면 명렬이 그 값으로 서고, 교사는 **정렬하기 전에** 고쳐야 한다.
 * 고침은 **화면에만 산다** — 파일은 안 건드린다.
 */
describe('학번과 이름을 고쳐 둔다', () => {
  const summary: RosterSummary = {
    state: 'read',
    name: '붓꽃 분류',
    studentId: '10101',
    studentName: '김하나',
    dataType: 'tabular',
    experiments: 1,
    runs: 2,
  }

  it('고친 값이 요약을 덮는다', () => {
    const fixed = withEdit(summary, { studentName: '김하나라' })
    expect(fixed).toMatchObject({ studentId: '10101', studentName: '김하나라' })
  })

  it('안 고친 칸은 파일의 값이 그대로다', () => {
    expect(withEdit(summary, { studentId: '10102' })).toMatchObject({ studentName: '김하나' })
  })

  it('빈 칸으로 고치면 없는 것이 된다 - 빈 글자로 세우지 않는다', () => {
    expect(withEdit(summary, { studentName: '   ' })).not.toHaveProperty('studentName')
  })

  it('못 읽은 줄에는 안 얹는다 - 고칠 대상이 없다', () => {
    const unreadable: RosterSummary = { state: 'unreadable', code: 'PROJECT_FILE_NOT_ZIP' }
    expect(withEdit(unreadable, { studentName: '김하나' })).toBe(unreadable)
  })

  it('고친 값으로 정렬한다 - 고치고 다시 세우는 것이 이 기능의 이유다', () => {
    const items = rosterOf([picked('a.mlpx'), picked('b.mlpx')])
    const before = new Map<string, RosterSummary>([
      ['a.mlpx', { ...summary, studentName: '하윤' }],
      ['b.mlpx', { ...summary, studentName: '가온' }],
    ])
    expect(sortRoster(items, before, 'studentName').map((one) => one.label)).toEqual([
      'b.mlpx',
      'a.mlpx',
    ])

    const after = new Map(before)
    after.set('a.mlpx', withEdit(before.get('a.mlpx')!, { studentName: '가람' }))
    expect(sortRoster(items, after, 'studentName').map((one) => one.label)).toEqual([
      'a.mlpx',
      'b.mlpx',
    ])
  })
})
