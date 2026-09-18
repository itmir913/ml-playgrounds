/**
 * **명렬** — 교사가 고른 제출물들의 목록 (architecture.md §8.21).
 *
 * 여기 있는 것은 전부 순수 함수다. 파일을 읽는 일과 그 순서를 쥐는 일은
 * `composables/useRoster.ts`가 하고, **무엇을 목록에 세우고 무엇을 요약으로 남기는가**는
 * 여기서 정한다 — 화면 없이 확인할 수 있어야 하는 판정이다.
 *
 * **명렬은 메타만 읽는다** (open-decisions.md "명렬은 메타만 읽는다 — 입구는 둘, 경로는
 * 하나"). 요약에 무결성이 없는 이유가 그것이다: 해시는 사진 바이트를 전부 읽어야 나오고,
 * 서른 개를 미리 돌면 훑어보는 한 바퀴가 성립하지 않는다.
 */

import type { ClientErrorCode } from '../errors'
import { MLPX_EXTENSION } from './format'
import type { DataType, ProjectDocument } from './schema'

/** 명렬의 한 줄. **파일 하나가 한 줄이다** — 같은 학생의 파일이 여럿이면 여럿이다. */
export interface RosterItem {
  /**
   * 이 줄의 이름. **폴더째 골랐으면 상대 경로다.**
   *
   * 재귀 폴더에서 파일 이름은 겹친다 — `1반/kim.mlpx`와 `2반/kim.mlpx`가 한 줄로 보이면
   * 교사가 둘을 구분할 방법이 없다.
   */
  readonly label: string
  /** 손잡이. **여는 것은 고른 뒤다** — 명렬은 이것만 들고 있는다. */
  readonly file: File
}

/** 요약 하나. 읽었거나, 못 읽었거나. */
export type RosterSummary =
  | {
      readonly state: 'read'
      readonly name: string
      /**
       * 학생. **manifest 안에 있다** — 읽기 전에는 파일 이름뿐이고, 학생이 안 적었으면
       * 파일에도 없다.
       *
       * **학번과 이름이 따로다** (2026-09-18, 사용자). 교사가 명렬을 세우는 기준이 둘이고
       * (반 번호순 · 이름순), 하나로 붙여 두면 어느 쪽으로도 못 센다.
       */
      readonly studentId?: string
      readonly studentName?: string
      /**
       * 이 파일이 나온 프로젝트 (architecture.md §8.21).
       *
       * **파일을 열어 다시 저장해도 따라간다.** 그래서 두 줄의 값이 같다는 것은 한쪽이
       * 다른 쪽에서 나왔다는 뜻이고, 이름과 내용으로는 안 보이는 그것을 명렬이 묶는다
       * (`sameProjectGroups`).
       */
      readonly projectId: string
      readonly dataType: DataType
      readonly experiments: number
      readonly runs: number
    }
  | {
      readonly state: 'unreadable'
      /**
       * 왜 못 열었는가. **명렬에서 빼지 않는다** — 조용히 빠지면 교사는 그 제출물이
       * 없는 것으로 읽고, 그것이 이 화면이 가장 하면 안 되는 일이다.
       */
      readonly code: ClientErrorCode | 'PROJECT_FILE_INVALID'
    }

/**
 * 고른 파일들에서 명렬을 만든다.
 *
 * **입구가 둘이어도 여기서 하나가 된다** (open-decisions.md의 같은 제목) — 폴더째든,
 * 여러 개든, 하나든 이 함수를 지난다. 단일 파일용 갈래를 만들지 않는다.
 *
 * - `.mlpx`가 아닌 것은 조용히 지나친다. 폴더에는 별게 다 들어 있다.
 * - 정렬은 이름순이고, **폴더째면 상대 경로순**이라 반이 묶여 선다.
 */
export function rosterOf(files: readonly File[]): RosterItem[] {
  return files
    .filter((file) => labelOf(file).toLowerCase().endsWith(MLPX_EXTENSION))
    .map((file) => ({ label: labelOf(file), file }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

/**
 * 이 파일을 명렬에서 뭐라고 부를까.
 *
 * `webkitdirectory`로 고른 파일에는 폴더 안 경로가 붙어 온다 — 표준 밖의 필드라
 * 타입에 없고, 없으면 그냥 이름이다.
 */
function labelOf(file: File): string {
  const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath
  return relative !== undefined && relative !== '' ? relative : file.name
}

/**
 * 읽어 낸 문서에서 명렬이 보일 것만 남긴다. **그러고 문서는 버린다.**
 *
 * 남는 것이 이만큼인 이유는 이것이 **결과를 파일에 안 적는다**와 양립하는 유일한 기억
 * 자리이기 때문이다 (open-decisions.md "점검은 읽기 전용 열람기다").
 */
export function summaryOf(document: ProjectDocument): RosterSummary {
  const experiments = document.runs.experiments
  const student = document.manifest.student
  return {
    state: 'read',
    name: document.manifest.name,
    ...filled('studentId', student?.studentId),
    ...filled('studentName', student?.name),
    projectId: document.manifest.projectId,
    dataType: document.manifest.dataType,
    experiments: experiments.length,
    runs: experiments.reduce((count, experiment) => count + experiment.runs.length, 0),
  }
}

/** 빈 문자열은 **없는 것**이다. 학생이 칸을 비워 둔 것과 안 적은 것은 같은 상태다. */
function filled<Key extends string>(
  key: Key,
  value: string | undefined,
): Partial<Record<Key, string>> {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? {} : ({ [key]: trimmed } as Record<Key, string>)
}

/**
 * **교사가 고쳐 둔 학번·이름** (2026-09-18, 사용자).
 *
 * 학생이 이름을 잘못 적어 내면 명렬이 그 이름으로 서고, 교사는 **정렬을 하기 전에**
 * 그것을 고쳐야 한다. 그 고침은 **화면에만 산다** — 원본 `.mlpx`는 안 건드리는 것이
 * 이 화면의 첫 규칙이고(open-decisions.md "점검은 읽기 전용 열람기다"), 그래서
 * **새로 고치면 사라진다.** 화면이 그 사실을 말해야 한다.
 */
export interface StudentEdit {
  readonly studentId?: string
  readonly studentName?: string
}

/**
 * 고침을 얹은 요약. **못 읽은 줄에는 얹지 않는다** — 고칠 대상이 없다.
 *
 * **칸을 비우는 것도 고침이다.** 그래서 두 칸을 얹는 것이 아니라 다시 짓는다 — 얹기만
 * 하면 교사가 지운 이름이 파일의 이름으로 되살아난다.
 */
export function withEdit(summary: RosterSummary, edit: StudentEdit | undefined): RosterSummary {
  if (!edit || summary.state !== 'read') return summary
  return {
    state: 'read',
    name: summary.name,
    ...filled('studentId', edit.studentId ?? summary.studentId),
    ...filled('studentName', edit.studentName ?? summary.studentName),
    projectId: summary.projectId,
    dataType: summary.dataType,
    experiments: summary.experiments,
    runs: summary.runs,
  }
}

/**
 * **같은 프로젝트에서 나온 줄들** — 이름표 → 묶음 번호 (architecture.md §8.21).
 *
 * `manifest.projectId`는 프로젝트를 만들 때 한 번 생기고 **파일을 열어 다시 저장해도
 * 그대로 따라간다.** 두 파일의 값이 같다는 것은 한쪽이 다른 쪽에서 나왔다는 뜻이다.
 *
 * **판정하지 않는다.** 교사가 나눠 준 시작 파일이면 반 전체가 같은 값을 갖는다 — 화면은
 * "같은 프로젝트에서 나왔다"까지만 말하고, 왜 그런지는 교사가 안다.
 *
 * - **혼자인 값은 안 담는다.** 묶을 짝이 없으면 말할 것도 없다.
 * - **번호는 명렬의 순서가 정한다**(먼저 나온 묶음이 1번). 정렬을 바꿔도 안 흔들리려면
 *   기준이 화면의 순서가 아니라 명렬의 순서여야 한다.
 * - 못 읽은 줄과 아직 안 읽은 줄은 값이 없어 어느 묶음에도 안 든다.
 */
export function sameProjectGroups(
  items: readonly RosterItem[],
  summaries: ReadonlyMap<string, RosterSummary>,
): ReadonlyMap<string, number> {
  const byProject = new Map<string, string[]>()
  for (const item of items) {
    const summary = summaries.get(item.label)
    if (summary?.state !== 'read') continue
    const labels = byProject.get(summary.projectId)
    if (labels) labels.push(item.label)
    else byProject.set(summary.projectId, [item.label])
  }

  const groups = new Map<string, number>()
  let number = 0
  for (const labels of byProject.values()) {
    if (labels.length < 2) continue
    number += 1
    for (const label of labels) groups.set(label, number)
  }
  return groups
}

/**
 * 명렬을 무엇으로 정렬할 수 있는가. **열 머리가 곧 기준이다** — 정렬 기준을 드롭다운에
 * 숨기면 지금 무엇으로 서 있는지가 화면 밖으로 나간다 (architecture.md §8.21).
 */
export const ROSTER_SORTS = ['label', 'studentId', 'studentName', 'experiments', 'runs'] as const

export type RosterSort = (typeof ROSTER_SORTS)[number]

/**
 * 정렬한 명렬.
 *
 * **아직 안 읽은 줄과 못 읽은 줄은 뒤로 간다.** 훑는 동안 요약이 하나씩 도착하는데 그때마다
 * 줄이 위아래로 튀면 교사가 읽던 자리를 잃는다 — 값이 없는 줄을 끝에 모아 두면 움직이는
 * 것은 그 경계 하나뿐이다.
 *
 * **동점은 이름표로 가른다.** `sort`가 안정적이어도 기준 값이 같은 줄들의 순서는 원래
 * 배열에 달려 있고, 그 배열은 읽은 순서에 따라 흔들린다.
 */
export function sortRoster(
  items: readonly RosterItem[],
  summaries: ReadonlyMap<string, RosterSummary>,
  sort: RosterSort,
  descending = false,
): RosterItem[] {
  const direction = descending ? -1 : 1
  return [...items].sort((left, right) => {
    const a = summaries.get(left.label)
    const b = summaries.get(right.label)
    const ranked = rank(a) - rank(b)
    if (ranked !== 0) return ranked
    const compared = compare(sort, left, right, a, b) * direction
    return compared !== 0 ? compared : left.label.localeCompare(right.label)
  })
}

/** 읽은 줄이 먼저, 그다음이 못 읽은 줄, 아직 안 읽은 줄이 맨 뒤다. */
function rank(summary: RosterSummary | undefined): number {
  if (!summary) return 2
  return summary.state === 'read' ? 0 : 1
}

function compare(
  sort: RosterSort,
  left: RosterItem,
  right: RosterItem,
  a: RosterSummary | undefined,
  b: RosterSummary | undefined,
): number {
  if (sort === 'label') return left.label.localeCompare(right.label)
  if (a?.state !== 'read' || b?.state !== 'read') return 0
  // **안 적은 칸은 빈 글자로 센다** — 이름 없는 줄끼리 모이고, 적은 줄이 그 뒤에 선다.
  if (sort === 'studentId') return (a.studentId ?? '').localeCompare(b.studentId ?? '')
  if (sort === 'studentName') return (a.studentName ?? '').localeCompare(b.studentName ?? '')
  return a[sort] - b[sort]
}
