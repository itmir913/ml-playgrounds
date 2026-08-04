/**
 * formatVersion 마이그레이션 체인.
 * 지금은 v1뿐이지만 구조를 먼저 잡는다. 스키마를 바꾸면 같은 커밋에 함수를 추가한다.
 *
 * 규칙은 넷이다 (docs/mlpx-spec.md 9).
 *
 * 1. **하위 버전은 조용히 올려서 연다.**
 * 2. **상위 버전은 거부한다.** 학교 PC와 집 PC의 앱 버전이 다를 때 조용히 깨지는 것보다 낫다.
 * 3. 마이그레이션 함수는 **순수 함수**다. 파일 I/O 없이 객체만 변환한다.
 * 4. 버전을 올리는 커밋에 함수와 테스트가 함께 온다.
 *
 * **순서가 핵심이다.** 버전 확인과 마이그레이션이 zod 검증보다 **앞**이다.
 * 구버전 파일은 현재 스키마를 만족하지 않는 것이 당연해서, 순서를 뒤집으면
 * 올려서 열 수 있는 파일이 전부 PROJECT_FILE_INVALID가 된다.
 */

import { ClientError } from '../errors'
import { FORMAT_VERSION, parseProjectDocument, type ProjectDocument } from './schema'

/** 아직 검증되지 않은 문서. 마이그레이션은 이 상태에서 동작한다. */
export type RawDocument = Record<string, unknown>

/** 버전 n 문서를 n+1로 바꾼다. formatVersion 자체는 체인이 올려 주므로 건드리지 않는다. */
export type Migration = (document: RawDocument) => RawDocument

/**
 * 버전 n -> n+1 변환의 등록부.
 *
 * 예: FORMAT_VERSION을 2로 올린다면 { 1: (document) => ... } 를 여기 추가한다.
 * 빠뜨리면 tests/migrate.spec.ts가 잡는다.
 */
export const MIGRATIONS: Record<number, Migration> = {}

function asRecord(value: unknown): RawDocument | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RawDocument)
    : null
}

/**
 * 문서에서 formatVersion을 읽는다.
 *
 * 검증 전에 불리므로 manifest가 없거나 모양이 이상할 수 있다. 그때는 null을 준다.
 */
export function readFormatVersion(document: unknown): number | null {
  const manifest = asRecord(asRecord(document)?.manifest)
  const version = manifest?.formatVersion
  return typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : null
}

/**
 * from에서 to까지 등록된 변환을 차례로 적용한다.
 *
 * migrations를 인자로 받는 이유는 테스트 때문이다. 전역 등록부를 건드리지 않고
 * 가짜 체인으로 순서와 누락 처리를 확인할 수 있어야 한다.
 */
export function applyMigrations(
  document: RawDocument,
  from: number,
  to: number,
  migrations: Record<number, Migration> = MIGRATIONS,
): RawDocument {
  let current = document
  for (let version = from; version < to; version += 1) {
    const migrate = migrations[version]
    if (!migrate) {
      // 이 버전을 올릴 방법이 없다. 추측해서 열지 않는다.
      throw new ClientError('PROJECT_FILE_VERSION_UNSUPPORTED', { fileVersion: version })
    }
    const next = migrate(current)
    const manifest = asRecord(next.manifest) ?? {}
    // formatVersion은 체인이 올린다. 함수마다 잊지 않기를 기대하지 않는다.
    current = { ...next, manifest: { ...manifest, formatVersion: version + 1 } }
  }
  return current
}

/**
 * manifest 하나만 보고 이 앱이 열 수 있는 버전인지 판정한다. 열 수 있으면 그 버전을 준다.
 *
 * **manifest만 받는 이유가 검사 순서다** (mlpx-spec.md 9). 부르는 쪽이 나머지 엔트리를
 * 요구하기 **전에** 이걸 통과시켜야 한다. 순서를 뒤집으면 엔트리 구성이 바뀐 미래의 파일이
 * PROJECT_FILE_VERSION_TOO_NEW가 아니라 PROJECT_FILE_ENTRY_MISSING으로 거부되고,
 * 학생과 교사는 "앱을 업데이트하세요" 대신 "manifest.json이 없습니다"를 보게 된다.
 * 둘은 파일이 손상됐다고 결론 낸다 - 상위 버전을 명확히 거부하기로 한 결정이 거기서 샌다.
 */
export function requireSupportedVersion(manifest: unknown): number {
  const version = readFormatVersion({ manifest })
  if (version === null) {
    // 버전을 못 읽으면 어떤 규칙으로 해석해야 할지 알 수 없다.
    throw new ClientError('PROJECT_FILE_VERSION_UNSUPPORTED', { fileVersion: 0 })
  }

  if (version > FORMAT_VERSION) {
    throw new ClientError('PROJECT_FILE_VERSION_TOO_NEW', {
      fileVersion: version,
      appVersion: FORMAT_VERSION,
    })
  }

  return version
}

/**
 * 파일에서 읽은 문서를 현재 버전으로 올리고 검증해서 돌려준다.
 *
 * 입력을 변형하지 않는다 - 호출자가 넘긴 객체는 그대로 남는다.
 *
 * 버전 확인을 다시 한다. 부르는 쪽이 이미 requireSupportedVersion을 통과시켰더라도
 * 이 함수 하나만 부르는 경로가 안전해야 한다 - 검사를 부르는 쪽의 성실함에 맡기지 않는다.
 */
export function migrateProjectDocument(document: unknown): ProjectDocument {
  const raw = asRecord(document)
  if (!raw) {
    throw new ClientError('PROJECT_FILE_INVALID', { path: '', issues: 1 })
  }

  const version = requireSupportedVersion(raw.manifest)

  return parseProjectDocument(applyMigrations(structuredClone(raw), version, FORMAT_VERSION))
}
