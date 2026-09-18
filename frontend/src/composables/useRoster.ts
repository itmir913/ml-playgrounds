/**
 * 명렬을 들고, **한 번에 하나씩** 읽는다 (architecture.md §8.21).
 *
 * **읽기 소비자가 하나다.** 뒤에서 도는 훑기와 교사가 고른 항목이 같은 줄에 서고, 고른
 * 것이 **맨 앞으로** 간다 — 그래서 같은 파일을 두 번 풀지 않고, 메모리에 사는 파싱 결과가
 * 언제나 하나다 (open-decisions.md "명렬은 메타만 읽는다").
 *
 * **읽기가 둘이다.** 훑기는 문서 넷만 풀어 요약을 남기고(`readProjectMeta`), 교사가 고른
 * 하나는 사진까지 통째로 푼다(`readProject`) — 열람과 무결성이 그것을 요구한다.
 * **둘 다 같은 줄에 선다.**
 *
 * **명렬의 동일성을 쥔다.** 교사가 다른 폴더를 고르면 옛 훑기가 아직 돌고 있고, 그 결과가
 * 새 명렬에 앉으면 **다른 반의 요약이 이 반에 붙는다.** `alive`/`retire`로는 못 막는다 —
 * 그쪽은 화면을 떠날 때의 이야기이고 파일 읽기 루프에는 맡길 손잡이가 없다
 * (`useWork.ts`의 같은 문단). 그래서 앉히기 전에 **내가 든 명렬이 지금 명렬인지** 본다.
 */

import { ref, shallowRef, type Ref } from 'vue'

import { isClientError, type ClientErrorCode } from '@/errors'
import { readFileBytes } from '@/project/download'
import { readProject, readProjectMeta, type ReadResult } from '@/project/format'
import { summaryOf, type RosterItem, type RosterSummary } from '@/project/roster'

/** 교사가 지금 열어 본 제출물. **한 번에 하나다** — 다음 줄을 고르면 앞엣것을 버린다. */
export interface OpenedSubmission {
  readonly item: RosterItem
  readonly read: ReadResult
}

export interface Roster {
  /** 지금 명렬. **새 폴더를 고르면 통째로 갈린다** — 그 동일성이 훑기의 표다. */
  readonly items: Ref<readonly RosterItem[]>
  /** 이름표 → 요약. 아직 안 읽은 줄은 없다. */
  readonly summaries: Ref<ReadonlyMap<string, RosterSummary>>
  /** 지금 읽고 있는 줄. 없으면 훑기가 쉬는 중이다. */
  readonly reading: Ref<string | null>
  /**
   * 통째로 읽어 연 제출물. **명렬이 메타만 읽는 것과 갈리는 자리다** — 열람과 무결성은
   * 사진까지 있어야 한다.
   */
  readonly opened: Ref<OpenedSubmission | null>
  /** 명렬을 갈아 끼우고 훑기를 시작한다. 옛 훑기의 결과는 버려진다. */
  show: (items: readonly RosterItem[]) => void
  /**
   * 이 줄을 통째로 읽어 연다. **교사가 고른 것이 큐의 맨 앞이다.**
   *
   * 앞서 열어 둔 것은 버린다 — 메모리에 사는 프로젝트가 하나여야 사진이 든 제출물이
   * 서른인 폴더에서 교사 기기가 선다.
   */
  open: (item: RosterItem) => Promise<void>
}

/** 큐에 선 일감. 훑기는 메타만, 고른 것은 통째로. */
interface Job {
  readonly item: RosterItem
  readonly full: boolean
}

export function useRoster(): Roster {
  const items = shallowRef<readonly RosterItem[]>([])
  const summaries = ref<ReadonlyMap<string, RosterSummary>>(new Map())
  const reading = ref<string | null>(null)
  const opened = shallowRef<OpenedSubmission | null>(null)

  /** 지금 명렬. **읽은 것을 앉히기 전에 이것과 견준다.** */
  let held: readonly RosterItem[] = items.value
  /** 아직 안 읽은 줄들. 앞에서 꺼내 읽는다. */
  let pending: Job[] = []
  let pump: Promise<void> | null = null

  function put(label: string, summary: RosterSummary): void {
    const next = new Map(summaries.value)
    next.set(label, summary)
    summaries.value = next
  }

  async function run(job: Job): Promise<void> {
    const mine = held
    reading.value = job.item.label
    const done = await readOne(job)
    reading.value = null
    // **내가 든 명렬이 아직 지금 명렬일 때만 앉힌다.**
    if (mine !== held) return

    put(job.item.label, done.summary)
    if (done.read) opened.value = { item: job.item, read: done.read }
  }

  /** 하나씩, 앞에서부터. **동시에 푸는 파일은 언제나 하나다.** */
  function pumpQueue(): void {
    pump ??= (async () => {
      while (pending.length > 0) {
        const job = pending.shift()
        if (job) await run(job)
      }
    })().finally(() => {
      pump = null
    })
  }

  function show(next: readonly RosterItem[]): void {
    items.value = next
    held = next
    opened.value = null
    summaries.value = new Map()
    pending = next.map((item) => ({ item, full: false }))
    pumpQueue()
  }

  function open(item: RosterItem): Promise<void> {
    opened.value = null
    // 줄 서 있던 같은 파일은 빼고 맨 앞에 세운다. **두 번 풀지 않는다.**
    pending = pending.filter((job) => job.item.label !== item.label)
    pending.unshift({ item, full: true })
    pumpQueue()
    return pump ?? Promise.resolve()
  }

  return { items, summaries, reading, opened, show, open }
}

/** 한 줄을 읽는다. **못 읽는 것은 사유가 된다** — 명렬에서 빼지 않는다. */
async function readOne(job: Job): Promise<{ summary: RosterSummary; read?: ReadResult }> {
  try {
    const bytes = await readFileBytes(job.item.file)
    if (!job.full) return { summary: summaryOf(await readProjectMeta(bytes)) }
    const read = await readProject(bytes)
    return { summary: summaryOf(read.project.document), read }
  } catch (error) {
    return {
      summary: {
        state: 'unreadable',
        code: isClientError(error) ? error.code : ('PROJECT_FILE_INVALID' as ClientErrorCode),
      },
    }
  }
}
