/**
 * .mlpx 무결성 - 해시 층 (docs/mlpx-spec.md 7).
 *
 * **이건 위조 방지가 아니라 방지턱이다.** 계산 코드가 오픈소스이고 비밀이 없으므로
 * 파일을 가진 사람은 고친 뒤 다시 계산할 수 있다. 그럼에도 값이 있다 - 압축을 풀어
 * 숫자를 고치고 다시 압축하는 시도는 걸리고, **어디가** 바뀌었는지를 짚어준다.
 *
 * 그러므로 이 모듈이 지키는 것 둘.
 *
 * 1. **여기서 나온 결과로 파일 열기를 실패시키지 않는다.** hashes.json이 없거나 깨져 있어도
 *    프로젝트는 열려야 한다. 옛 파일에는 아예 없고, 무결성 정보 때문에 학생의 작업물이
 *    안 열리는 것은 이 도구가 낼 수 있는 최악의 결과 중 하나다.
 * 2. **보증으로 읽히는 낱말을 만들지 않는다.** 상태 어휘의 단일 출처는 errors.ts다
 *    (mlpx-spec.md 7.3).
 *
 * contentHash는 zip 바이트가 아니라 **엔트리 해시들에서** 나온다. 그래서 다시 압축해도
 * 안 변한다. 덕분에 두 제출물의 contentHash가 같으면 내용이 같다는 뜻이 되어
 * 표절 신호로도 쓸 수 있다 (mlpx-spec.md 6.3). 반대로 "수거 시점에 기록하는 해시"는
 * .mlpx 바이트 자체를 해싱하면 되므로 파일 안에 아무것도 넣을 필요가 없다.
 */

import { HASH_ALGORITHM, hashBytes, hashText } from '../hash'
import type { EntryHashStatus, FileHashStatus } from '../errors'

/** hashes.json 의 내용. */
export interface ProjectHashes {
  algorithm: string
  /** zip 경로 -> 그 엔트리 바이트의 해시. hashes.json 자신은 여기 없다. */
  entries: Record<string, string>
  /** entries 전체를 덮는 해시. */
  contentHash: string
}

export interface EntryHashResult {
  path: string
  state: EntryHashStatus
}

export interface HashCheck {
  status: FileHashStatus
  /** 파일에 적혀 있던 값. hashes.json이 없거나 깨졌으면 null. */
  contentHash: string | null
  /** 지금 실제로 계산한 값. 항상 있다. */
  computedContentHash: string
  /**
   * 대조한 엔트리 전부. UNCHANGED도 들어간다 - 화면이 "그대로"를 보여줘야 한다.
   *
   * **status가 UNKNOWN이면 비어 있다.** 대조한 적이 없으므로 할 말이 없다.
   */
  entries: EntryHashResult[]
}

/**
 * 엔트리 해시들을 하나의 문자열로 덮는다.
 *
 * JSON.stringify를 쓰지 않는다. 키 순서와 들여쓰기가 값을 바꾸기 때문에, 우리가 쓴 파일과
 * 남이 다시 쓴 파일이 내용은 같은데 해시가 달라진다. 경로로 정렬해 직접 조립한다.
 */
function contentHashOf(entries: Record<string, string>): string {
  const canonical = Object.keys(entries)
    .sort()
    .map((path) => `${path}\n${entries[path] ?? ''}\n`)
    .join('')
  return hashText(canonical)
}

/**
 * 담을 엔트리들의 해시를 만든다.
 *
 * 정본들의 해시를 **인자로 받는다** (`data.csv`, 있으면 `test.csv`). 정본은 가져오기
 * 시점에 한 번만 해싱하고 그 뒤로 불변이다 (open-decisions.md "정본 데이터셋은 언제나
 * UTF-8 CSV다"). 여기서 다시 계산하면 자동 저장이 돌 때마다 수십 MB를 해싱하게 된다.
 *
 * 표를 아직 올리지 않았거나 평가 데이터가 파일로 없는 프로젝트에는 그만큼 없다.
 * 그러면 대조 대상에서 빠질 뿐이다.
 */
export function buildHashes(
  entries: Record<string, Uint8Array>,
  precomputed: readonly { readonly path: string; readonly hash: string }[] = [],
): ProjectHashes {
  const known = new Map(precomputed.map((entry) => [entry.path, entry.hash]))
  const hashes: Record<string, string> = {}
  for (const [path, bytes] of Object.entries(entries)) {
    hashes[path] = known.get(path) ?? hashBytes(bytes)
  }
  return { algorithm: HASH_ALGORITHM, entries: hashes, contentHash: contentHashOf(hashes) }
}

/**
 * hashes.json을 읽는다. 모양이 아니면 null - 던지지 않는다.
 *
 * 깨진 무결성 정보는 "확인할 수 없음"이지 "파일이 잘못됐다"가 아니다.
 */
export function parseHashes(value: unknown): ProjectHashes | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.algorithm !== 'string' || record.algorithm !== HASH_ALGORITHM) return null
  if (typeof record.contentHash !== 'string') return null
  if (typeof record.entries !== 'object' || record.entries === null) return null

  const entries: Record<string, string> = {}
  for (const [path, hash] of Object.entries(record.entries as Record<string, unknown>)) {
    if (typeof hash !== 'string') return null
    entries[path] = hash
  }
  return { algorithm: record.algorithm, entries, contentHash: record.contentHash }
}

/**
 * 파일에 적힌 해시와 실제 바이트를 대조한다.
 *
 * present에는 **아는 엔트리만** 넣는다. __MACOSX/ 같은 쓰레기까지 세면 맥에서 압축을 푼
 * 파일이 전부 "고쳐졌음"이 된다. 고르는 일은 부르는 쪽(format.ts)이 한다.
 *
 * recorded가 null이면(옛 파일, 깨진 hashes.json) UNKNOWN이다. 이때도 계산은 해서
 * computedContentHash를 준다 - 교사가 지금 이 파일의 내용 해시를 적어둘 수 있어야 한다.
 */
export function checkHashes(
  present: Map<string, string>,
  recorded: ProjectHashes | null,
): HashCheck {
  const computed = Object.fromEntries(present)
  const computedContentHash = contentHashOf(computed)

  if (!recorded) {
    // **엔트리 목록을 주지 않는다.** 대조 기준이 없는데 'UNCHANGED'로 채우면 화면이
    // "그대로"를 줄줄이 그리게 되고, hashes.json을 통째로 지운 파일 - 변조를 감추는
    // 가장 쉬운 수법이다 - 이 온통 초록으로 보인다. 상단의 "확인할 수 없음"보다 목록의
    // 초록색이 눈에 먼저 들어온다. 비교한 적 없는 것을 "그대로"라고 말하는 것은
    // 7.3이 금지한 과신 어휘의 축소판이다.
    return { status: 'UNKNOWN', contentHash: null, computedContentHash, entries: [] }
  }

  const paths = [...new Set([...present.keys(), ...Object.keys(recorded.entries)])].sort()
  const entries = paths.map((path): EntryHashResult => {
    const actual = present.get(path)
    const expected = recorded.entries[path]
    if (actual === undefined) return { path, state: 'REMOVED' }
    if (expected === undefined) return { path, state: 'ADDED' }
    return { path, state: actual === expected ? 'UNCHANGED' : 'MODIFIED' }
  })

  const unchanged = entries.every((entry) => entry.state === 'UNCHANGED')
  // contentHash까지 본다. 엔트리가 전부 맞는데 적힌 총합이 다르면 hashes.json이 손을 탄 것이다.
  const intact = unchanged && recorded.contentHash === computedContentHash
  return {
    status: intact ? 'UNCHANGED' : 'MODIFIED',
    contentHash: recorded.contentHash,
    computedContentHash,
    entries,
  }
}
