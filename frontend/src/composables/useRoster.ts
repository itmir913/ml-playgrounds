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
import {
  summaryOf,
  withEdit,
  type RosterItem,
  type RosterSummary,
  type StudentEdit,
} from '@/project/roster'

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
  /** 이름표 → 교사가 고친 학번·이름. **파일에는 안 적힌다** (`StudentEdit`). */
  readonly edits: Ref<ReadonlyMap<string, StudentEdit>>
  /** 명렬을 갈아 끼우고 훑기를 시작한다. 옛 훑기의 결과는 버려진다. */
  show: (items: readonly RosterItem[]) => void
  /**
   * 이 줄의 학번·이름을 고쳐 둔다. **화면에만 산다** — 정렬도 표시도 고친 값으로 하고,
   * 원본은 안 건드린다. 새로 고치면 사라진다.
   */
  correct: (item: RosterItem, edit: StudentEdit) => void
  /**
   * 이 줄을 통째로 읽어 연다. **교사가 고른 것이 큐의 맨 앞이다.**
   *
   * 앞서 열어 둔 것은 버린다 — 메모리에 사는 프로젝트가 하나여야 사진이 든 제출물이
   * 서른인 폴더에서 교사 기기가 선다.
   */
  open: (item: RosterItem) => Promise<void>
  /**
   * 명렬을 **처음부터 끝까지 한 줄씩** 통째로 읽어 손에 넘긴다. 묶음을 굽는 자리가 쓴다.
   *
   * **같은 줄에 선다** — 훑기와 열람이 쓰는 그 큐다. 그래서 묶는 동안에도 동시에 풀리는
   * 파일은 하나뿐이고, **열어 보던 제출물도 안 바뀐다**(읽은 것은 화면에 안 앉는다).
   *
   * 못 읽은 줄은 `null`로 온다. 묶음에서 빠질 뿐 명렬에서는 사유와 함께 남는다.
   *
   * **다 읽었으면 참, 명렬이 갈렸으면 거짓이다** (§8.21). 굽는 동안 교사가 다른 폴더를
   * 고르면 그 묶음은 이미 남의 것이라 **절반짜리 zip이 내려가면 안 된다** — 부르는 쪽이
   * 그 사실을 알 길이 없으면 알 수가 없다.
   */
  collect: (take: (item: RosterItem, read: ReadResult | null) => void) => Promise<boolean>
}

/** 큐에 선 일감. 훑기는 메타만, 고른 것은 통째로. */
interface Job {
  readonly item: RosterItem
  readonly full: boolean
  /**
   * 읽고 나서 이 읽기를 기다리던 손들. **묶음 굽기가 넣는다** — 그 손에 넘기고 말지
   * 화면에 앉히지 않는다(묶는 동안 열어 보던 제출물이 바뀌면 안 된다).
   *
   * **한 파일을 둘이 기다릴 수 있다** (2026-09-18 R28 B-1). 굽기가 줄 세워 둔 파일을
   * 교사가 누르면 그 줄이 맨 앞으로 오는데, **그때 기다리던 손을 버리면 그 약속이 영영
   * 안 풀린다** — 묶기가 안 끝나 단추가 잠긴 채 남고 그 학생의 글은 zip에서 빠진다.
   */
  readonly hands: readonly ((read: ReadResult | null) => void)[]
  /** 읽은 것을 화면에 앉히는가. **교사가 고른 줄만 참이다.** */
  readonly seat: boolean
}

export function useRoster(): Roster {
  const items = shallowRef<readonly RosterItem[]>([])
  const summaries = ref<ReadonlyMap<string, RosterSummary>>(new Map())
  const reading = ref<string | null>(null)
  const opened = shallowRef<OpenedSubmission | null>(null)
  const edits = ref<ReadonlyMap<string, StudentEdit>>(new Map())

  /** 지금 명렬. **읽은 것을 앉히기 전에 이것과 견준다.** */
  let held: readonly RosterItem[] = items.value
  /** 아직 안 읽은 줄들. 앞에서 꺼내 읽는다. */
  let pending: Job[] = []
  let pump: Promise<void> | null = null

  function put(label: string, summary: RosterSummary): void {
    const next = new Map(summaries.value)
    next.set(label, withEdit(summary, edits.value.get(label)))
    summaries.value = next
  }

  /**
   * 고친 값을 명렬에 앉힌다. **요약이 이미 있어야 한다** — 아직 안 읽은 줄에는 고칠
   * 대상이 없고, 읽고 나면 `put`이 그 고침을 다시 얹는다.
   */
  function correct(item: RosterItem, edit: StudentEdit): void {
    const next = new Map(edits.value)
    next.set(item.label, { ...next.get(item.label), ...edit })
    edits.value = next

    const known = summaries.value.get(item.label)
    if (known) {
      const seated = new Map(summaries.value)
      seated.set(item.label, withEdit(known, next.get(item.label)))
      summaries.value = seated
    }
  }

  /**
   * **기다리는 손을 놓아 준다.** 큐에서 버려졌거나, 읽고 보니 명렬이 갈려 앉힐 데가
   * 없는 자리다.
   *
   * **모든 읽기는 정확히 한 번 끝난다** (§8.21). 약속을 푸는 자리가 읽기 경로 하나뿐이면
   * **큐에서 빠지는 경로마다 화면이 잠긴다** — 옛 명렬을 통째로 버릴 때가 그랬다.
   */
  function release(job: Job): void {
    for (const hand of job.hands) hand(null)
  }

  async function run(job: Job): Promise<void> {
    const mine = held
    reading.value = job.item.label
    const done = await readOne(job)
    reading.value = null
    // **내가 든 명렬이 아직 지금 명렬일 때만 앉힌다.**
    if (mine !== held) {
      release(job)
      return
    }

    put(job.item.label, done.summary)
    for (const hand of job.hands) hand(done.read ?? null)
    if (job.seat && done.read) opened.value = { item: job.item, read: done.read }
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
    // **버린 일감의 손을 놓아 준다.** 큐를 통째로 갈아 끼우므로 굽던 묶음이 여기서 끝난다 —
    // `held`를 먼저 옮겨야 그 손이 "남의 명렬이다"를 보고 절반짜리 zip을 안 만든다.
    const dropped = pending
    items.value = next
    held = next
    opened.value = null
    // **고침도 함께 버린다.** 다른 폴더의 줄에 앞 반의 이름이 얹히면 안 된다.
    edits.value = new Map()
    summaries.value = new Map()
    pending = next.map((item) => ({ item, full: false, hands: [], seat: false }))
    for (const job of dropped) release(job)
    pumpQueue()
  }

  function open(item: RosterItem): Promise<void> {
    opened.value = null
    // 줄 서 있던 같은 파일을 맨 앞으로 데려온다. **두 번 풀지 않는다** — 그리고 그 줄을
    // 기다리던 손도 **함께 데려간다**(묶음 굽기). 버리면 그 약속이 영영 안 풀린다.
    const waiting = pending.filter((job) => job.item.label === item.label)
    pending = pending.filter((job) => job.item.label !== item.label)
    pending.unshift({
      item,
      full: true,
      hands: waiting.flatMap((job) => job.hands),
      seat: true,
    })
    pumpQueue()
    return pump ?? Promise.resolve()
  }

  /** 명렬을 한 줄씩 통째로 읽는다. **큐 뒤에 붙는다** — 교사가 고른 줄이 먼저다. */
  function collect(take: (item: RosterItem, read: ReadResult | null) => void): Promise<boolean> {
    const mine = held
    const waits = items.value.map(
      (item) =>
        new Promise<boolean>((resolve) => {
          pending.push({
            item,
            full: true,
            seat: false,
            hands: [
              (read) => {
                // 명렬이 갈렸으면 그 묶음은 이미 남의 것이다.
                const ours = mine === held
                if (ours) take(item, read)
                resolve(ours)
              },
            ],
          })
        }),
    )
    pumpQueue()
    return Promise.all(waits).then((all) => all.every((one) => one))
  }

  return { items, summaries, reading, opened, edits, show, open, correct, collect }
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
