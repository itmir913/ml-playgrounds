/**
 * 명렬을 들고, **한 번에 하나씩** 읽어 요약만 남긴다 (architecture.md §8.21).
 *
 * **읽기 소비자가 하나다.** 뒤에서 도는 훑기와 교사가 고른 항목이 같은 줄에 서고, 고른
 * 것이 **맨 앞으로** 간다 — 그래서 같은 파일을 두 번 풀지 않고, 메모리에 사는 파싱 결과가
 * 언제나 하나다 (open-decisions.md "명렬은 메타만 읽는다").
 *
 * **명렬의 동일성을 쥔다.** 교사가 다른 폴더를 고르면 옛 훑기가 아직 돌고 있고, 그 결과가
 * 새 명렬에 앉으면 **다른 반의 요약이 이 반에 붙는다.** `alive`/`retire`로는 못 막는다 —
 * 그쪽은 화면을 떠날 때의 이야기이고 파일 읽기 루프에는 맡길 손잡이가 없다
 * (`useWork.ts`의 같은 문단). 그래서 앉히기 전에 **내가 든 명렬이 지금 명렬인지** 본다.
 */

import { ref, shallowRef, type Ref } from 'vue'

import { isClientError, type ClientErrorCode } from '@/errors'
import { readFileBytes } from '@/project/download'
import { readProjectMeta } from '@/project/format'
import { summaryOf, type RosterItem, type RosterSummary } from '@/project/roster'

export interface Roster {
  /** 지금 명렬. **새 폴더를 고르면 통째로 갈린다** — 그 동일성이 훑기의 표다. */
  readonly items: Ref<readonly RosterItem[]>
  /** 이름표 → 요약. 아직 안 읽은 줄은 없다. */
  readonly summaries: Ref<ReadonlyMap<string, RosterSummary>>
  /** 지금 읽고 있는 줄. 없으면 훑기가 쉬는 중이다. */
  readonly reading: Ref<string | null>
  /** 명렬을 갈아 끼우고 훑기를 시작한다. 옛 훑기의 결과는 버려진다. */
  show: (items: readonly RosterItem[]) => void
  /**
   * 이 줄을 먼저 읽는다. **교사가 고른 것이 큐의 맨 앞이다.**
   *
   * 이미 읽었으면 그 요약을 그대로 돌려주고, 줄 서 있으면 그 기다림에 얹는다 —
   * 어느 쪽이든 **두 번 풀지 않는다.**
   */
  readNow: (item: RosterItem) => Promise<RosterSummary>
}

export function useRoster(): Roster {
  const items = shallowRef<readonly RosterItem[]>([])
  const summaries = ref<ReadonlyMap<string, RosterSummary>>(new Map())
  const reading = ref<string | null>(null)

  /** 지금 명렬. **읽은 것을 앉히기 전에 이것과 견준다.** */
  let held: readonly RosterItem[] = items.value
  /** 아직 안 읽은 줄들. 앞에서 꺼내 읽는다. */
  let pending: RosterItem[] = []
  /** 이름표 → 그 줄의 기다림. **소비자가 하나라는 것이 여기서 지켜진다.** */
  let waiting = new Map<
    string,
    { promise: Promise<RosterSummary>; settle: (one: RosterSummary) => void }
  >()
  let pump: Promise<void> | null = null

  function put(label: string, summary: RosterSummary): void {
    const next = new Map(summaries.value)
    next.set(label, summary)
    summaries.value = next
  }

  function waiterFor(label: string): {
    promise: Promise<RosterSummary>
    settle: (one: RosterSummary) => void
  } {
    const known = waiting.get(label)
    if (known) return known
    let settle!: (one: RosterSummary) => void
    const promise = new Promise<RosterSummary>((resolve) => {
      settle = resolve
    })
    const made = { promise, settle }
    waiting.set(label, made)
    return made
  }

  async function readOne(item: RosterItem): Promise<void> {
    const mine = held
    const waiter = waiterFor(item.label)
    reading.value = item.label
    const summary = await summaryFor(item)
    reading.value = null
    // **내가 든 명렬이 아직 지금 명렬일 때만 앉힌다.**
    if (mine === held) {
      put(item.label, summary)
      waiting.delete(item.label)
    }
    waiter.settle(summary)
  }

  /** 하나씩, 앞에서부터. **동시에 푸는 파일은 언제나 하나다.** */
  function pumpQueue(): void {
    pump ??= (async () => {
      while (pending.length > 0) {
        const item = pending.shift()
        if (item) await readOne(item)
      }
    })().finally(() => {
      pump = null
    })
  }

  function show(next: readonly RosterItem[]): void {
    items.value = next
    held = next
    summaries.value = new Map()
    waiting = new Map()
    pending = [...next]
    pumpQueue()
  }

  function readNow(item: RosterItem): Promise<RosterSummary> {
    const known = summaries.value.get(item.label)
    if (known) return Promise.resolve(known)

    const waiter = waiterFor(item.label)
    // 줄 서 있으면 맨 앞으로 옮긴다. 없으면(새 줄이면) 앞에 세운다.
    pending = pending.filter((one) => one.label !== item.label)
    pending.unshift(item)
    pumpQueue()
    return waiter.promise
  }

  return { items, summaries, reading, show, readNow }
}

/** 못 읽은 사유. **우리 어휘가 아니면 "이 파일이 아니다"로 접는다.** */
async function summaryFor(item: RosterItem): Promise<RosterSummary> {
  try {
    return summaryOf(await readProjectMeta(await readFileBytes(item.file)))
  } catch (error) {
    return {
      state: 'unreadable',
      code: isClientError(error) ? error.code : ('PROJECT_FILE_INVALID' as ClientErrorCode),
    }
  }
}
