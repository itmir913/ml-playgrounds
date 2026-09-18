/**
 * **묶는 동안 교사가 명렬을 만진다** (architecture.md §8.21, 2026-09-18 R28 A-1).
 *
 * 서른 개를 읽는 시간이 교사가 아무것도 못 하는 시간이면 이 기능은 안 쓰인다. 그래서
 * 굽는 동안에도 줄을 누를 수 있고 폴더도 바꿀 수 있는데, **그러면 읽기 큐가 굽기와
 * 겹친다.** 겹치는 자리에서 큐가 일감을 버리면 그 일감을 기다리던 약속이 영영 안 풀리고,
 * 화면은 `읽는 중 (3/30)`에 잠긴 채 새로고침 전까지 안 돌아온다.
 *
 * **읽기를 가짜로 세운다.** 여기서 보는 것은 파일 내용이 아니라 **큐가 약속을 푸는가**라,
 * 언제 읽기가 끝나는지를 검사가 쥐어야 "굽는 도중"이라는 순간이 생긴다.
 */

import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { rosterOf, type RosterItem } from '../src/project/roster'

/** 아직 안 끝난 읽기들. 검사가 하나씩 풀어 준다. */
const reads: { label: string; settle: (bytes: Uint8Array) => void }[] = []

vi.mock('../src/project/download', () => ({
  readFileBytes: (file: File) =>
    new Promise<Uint8Array>((resolve) => {
      reads.push({ label: file.name, settle: resolve })
    }),
}))

/**
 * 파는 자리도 가짜다. **바이트는 안 보고 약속만 본다.**
 *
 * **한동안 둘 다 실패였다** (2026-09-18 R28-V). 못 읽는 줄도 큐에서는 다 읽은 줄과
 * 똑같이 끝나므로 이 파일이 보려던 것에는 충분했는데, **읽기가 성공해야만 지나가는
 * 자리가 하나 있었다** — 굽기로 읽은 것이 화면에 안 앉는다는 규칙이다. `read`가 없으면
 * 그 줄을 지나가지도 않아서, 가드를 지워도 조용했다.
 */
vi.mock('../src/project/format', async (real) => {
  const actual = await real<Record<string, unknown>>()
  const { emptyProjectFile } = await import('./fixtures/project')
  const integrity = { status: 'UNKNOWN', contentHash: null, computedContentHash: 'x', entries: [] }
  return {
    ...actual,
    readProject: () => Promise.resolve({ project: emptyProjectFile(), integrity }),
    readProjectMeta: () => Promise.resolve(emptyProjectFile().document),
  }
})

const { useRoster } = await import('../src/composables/useRoster')

function picked(name: string): File {
  return new File([new Uint8Array([1, 2, 3]) as BlobPart], name)
}

/** 아직 안 끝난 읽기를 전부 풀어 준다. 새로 시작되는 것까지 따라간다. */
async function drain(): Promise<void> {
  for (let guard = 0; guard < 40 && reads.length > 0; guard += 1) {
    reads.shift()?.settle(new Uint8Array([1]))
    await flushPromises()
  }
}

/**
 * 이 약속이 풀렸는가. **`await`로 물으면 안 풀린 약속에서 검사가 통째로 선다** — 그래서
 * 풀림을 옆에서 지켜보고 마이크로태스크를 넉넉히 돌린다.
 */
async function settled<T>(promise: Promise<T>): Promise<boolean> {
  let done = false
  void promise.then(() => {
    done = true
  })
  for (let index = 0; index < 20; index += 1) await flushPromises()
  return done
}

describe('묶는 동안 명렬을 만져도 큐가 안 잠긴다', () => {
  beforeEach(() => {
    reads.length = 0
  })

  /** 훑기까지 끝난 명렬. 큐가 비어 있는 자리에서 시작한다. */
  async function ready(names: string[]) {
    const roster = useRoster()
    const items = rosterOf(names.map(picked))
    roster.show(items)
    await flushPromises()
    await drain()
    return { roster, items }
  }

  /**
   * **교사가 굽는 도중에 줄을 누른다.** 그 줄은 굽기가 이미 줄 세워 둔 파일이라, 큐가
   * 중복을 없애며 **기다리던 손을 함께 버리던** 자리다.
   */
  it('굽는 도중에 줄을 눌러도 묶기가 끝나고 그 줄이 묶음에서 안 빠진다', async () => {
    const { roster, items } = await ready(['a.mlpx', 'b.mlpx', 'c.mlpx'])
    const taken: string[] = []
    const bundle = roster.collect((item) => taken.push(item.label))
    await flushPromises()

    void roster.open(items[2] as RosterItem)
    await drain()

    expect(await settled(bundle), 'collect() resolved').toBe(true)
    expect(taken.sort()).toEqual(['a.mlpx', 'b.mlpx', 'c.mlpx'])
  })

  it('굽는 도중에 다른 폴더를 골라도 묶기가 끝난다', async () => {
    const { roster } = await ready(['a.mlpx', 'b.mlpx'])
    const bundle = roster.collect(() => {})
    await flushPromises()

    roster.show(rosterOf([picked('x.mlpx')]))
    await drain()

    expect(await settled(bundle), 'collect() resolved').toBe(true)
  })

  /**
   * **갈린 명렬의 묶음은 남의 것이다.** 끝났다는 것만 말하면 화면은 앞 반의 절반짜리
   * zip을 내려받는다 — 그래서 묶기는 **다 읽었는가**를 함께 돌려준다.
   */
  it('명렬이 갈리면 묶기가 다 읽었다고 말하지 않는다', async () => {
    const { roster } = await ready(['a.mlpx', 'b.mlpx'])
    const taken: string[] = []
    const bundle = roster.collect((item) => taken.push(item.label))
    await flushPromises()

    roster.show(rosterOf([picked('x.mlpx')]))
    await drain()

    // **먼저 풀렸는지를 묻는다.** 안 풀린 약속을 바로 `await`하면 검사가 5초를 서 있다가
    // 시간 초과로 죽는데, 그 실패 문구는 원인을 안 말한다.
    expect(await settled(bundle), 'collect() resolved').toBe(true)
    expect(await bundle, 'a swapped roster is not a whole bundle').toBe(false)
    expect(taken, 'nothing from the old roster is handed over').toEqual([])
  })

  /**
   * **새 명렬은 백지에서 시작한다** (2026-09-18 R28 C-9). 요약을 안 비우면 머리의
   * `파일 n/m`이 **앞 반의 수를 더해** 서고, 열어 둔 제출물도 앞 반의 것이 남는다.
   */
  it('다른 폴더를 고르면 앞 반의 요약과 열어 둔 것이 안 남는다', async () => {
    const { roster, items } = await ready(['a.mlpx', 'b.mlpx', 'c.mlpx'])
    void roster.open(items[0] as RosterItem)
    await drain()
    expect(roster.summaries.value.size).toBe(3)

    roster.show(rosterOf([picked('x.mlpx')]))
    expect(roster.opened.value, 'the previous class must not stay open').toBeNull()
    await drain()
    expect(roster.summaries.value.size, 'summaries do not add up across classes').toBe(1)
  })

  it('아무도 안 건드리면 다 읽었다고 말한다', async () => {
    const { roster } = await ready(['a.mlpx', 'b.mlpx'])
    const bundle = roster.collect(() => {})
    await drain()
    expect(await bundle).toBe(true)
  })

  /**
   * **절반을 읽은 뒤에 갈려도 남의 것이다** (2026-09-18 R28-V). 앞선 검사는 **하나도 안
   * 읽은 채** 갈리는 경우만 봤고, 그래서 `every`를 `some`으로 바꿔도 조용했다 — 그때는
   * 절반이 참이라 화면이 **앞 반의 절반짜리 zip을 내려받는다.**
   */
  it('절반을 읽은 뒤에 폴더를 바꿔도 다 읽었다고 말하지 않는다', async () => {
    const { roster } = await ready(['a.mlpx', 'b.mlpx', 'c.mlpx'])
    const taken: string[] = []
    const bundle = roster.collect((item) => taken.push(item.label))
    await flushPromises()

    // 첫 줄만 읽히게 둔다 — 그 하나는 이 반의 것으로 넘어간다.
    reads.shift()?.settle(new Uint8Array([1]))
    await flushPromises()
    expect(taken).toEqual(['a.mlpx'])

    roster.show(rosterOf([picked('x.mlpx')]))
    await drain()

    expect(await settled(bundle), 'collect() resolved').toBe(true)
    expect(await bundle, 'a half-read bundle is not a whole bundle').toBe(false)
  })

  /**
   * **굽기가 읽은 것은 화면에 안 앉는다** (§8.21의 *"묶는 동안 열어 보던 제출물도 안
   * 바뀐다"*). 교사가 A를 열어 두고 묶음을 구우면, 굽기가 B·C를 읽는 동안에도 화면은
   * **A를 보고 있어야 한다.**
   */
  it('굽기가 읽은 것이 열어 둔 제출물을 밀어내지 않는다', async () => {
    const { roster, items } = await ready(['a.mlpx', 'b.mlpx', 'c.mlpx'])
    void roster.open(items[0] as RosterItem)
    await drain()
    const held = roster.opened.value
    expect(held?.item.label, 'the chosen row must be open to begin with').toBe('a.mlpx')

    const bundle = roster.collect(() => {})
    await drain()

    expect(await bundle).toBe(true)
    expect(roster.opened.value, 'baking must not change what is open').toBe(held)
  })

  /**
   * **한 파일을 둘이 기다려도 손을 다 데려간다.** 굽기가 둘 줄 서 있는데 교사가 그 줄을
   * 누르면 기다리는 손이 **둘**이다 — 하나만 데려가면 나머지 묶음이 안 끝난다.
   */
  it('한 파일을 기다리는 손이 여럿이어도 전부 데려간다', async () => {
    const { roster, items } = await ready(['a.mlpx', 'b.mlpx'])
    const first: string[] = []
    const second: string[] = []
    const one = roster.collect((item) => first.push(item.label))
    const two = roster.collect((item) => second.push(item.label))
    await flushPromises()

    void roster.open(items[1] as RosterItem)
    await drain()

    expect(await settled(one), 'first collect resolved').toBe(true)
    expect(await settled(two), 'second collect resolved').toBe(true)
    expect(first.sort()).toEqual(['a.mlpx', 'b.mlpx'])
    expect(second.sort()).toEqual(['a.mlpx', 'b.mlpx'])
  })

  /**
   * **떠나면 큐도 멈춘다** (2026-09-18 R28-V §5). 화면은 `retire`로 도는 일을 끊는데
   * 명렬은 그 밖이라, 서른 개를 훑다 나가도 **읽기가 끝까지 돌았다.**
   */
  it('멈추면 안 읽은 줄이 안 읽히고 기다리던 손이 풀린다', async () => {
    const { roster } = await ready(['a.mlpx', 'b.mlpx', 'c.mlpx'])
    const taken: string[] = []
    const bundle = roster.collect((item) => taken.push(item.label))
    await flushPromises()

    roster.stop()
    await drain()

    expect(await settled(bundle), 'collect() resolved').toBe(true)
    expect(await bundle, 'a stopped bundle is not a whole bundle').toBe(false)
    // 돌던 하나는 끝나지만 뒤엣것은 아예 안 읽힌다.
    expect(taken.length).toBeLessThan(3)
  })

  /**
   * **데려온다고 두 번 풀지는 않는다.** 기다리던 손을 옮기는 것이지 일감을 하나 더
   * 세우는 것이 아니다 — 사진이 든 제출물에서 그 차이가 곧 교사 기기의 메모리다.
   *
   * **누른 줄이 화면에 앉는지는 여기서 안 본다** — 이 스펙은 읽기를 가짜로 세워 파일이
   * 안 열린다. 그 자리는 화면을 띄우는 `inspect-modes.spec.ts`가 본다.
   */
  it('굽는 도중에 누른 줄도 같은 파일을 두 번 풀지 않는다', async () => {
    const { roster, items } = await ready(['a.mlpx', 'b.mlpx'])
    const bundle = roster.collect(() => {})
    await flushPromises()

    const chosen = items[1] as RosterItem
    void roster.open(chosen)
    const labels: string[] = []
    for (let guard = 0; guard < 40 && reads.length > 0; guard += 1) {
      const next = reads.shift()
      if (next) labels.push(next.label)
      next?.settle(new Uint8Array([1]))
      await flushPromises()
    }

    expect(await settled(bundle)).toBe(true)
    // 굽기가 둘, 거기에 누른 줄이 겹쳤을 뿐이다 — 같은 파일을 두 번 풀지 않는다.
    expect(labels).toHaveLength(2)
  })
})
