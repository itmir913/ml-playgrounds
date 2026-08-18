/**
 * formatVersion 마이그레이션 체인.
 * 스키마를 바꾸면 같은 커밋에 함수를 추가한다.
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
 * 예: FORMAT_VERSION을 3으로 올린다면 { 2: (document) => ... } 를 여기 추가한다.
 * 빠뜨리면 tests/migrate.spec.ts가 잡는다.
 */
export const MIGRATIONS: Record<number, Migration> = { 1: migrateV1ToV2 }

function asRecord(value: unknown): RawDocument | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as RawDocument)
    : null
}

/**
 * v1이 쓰던 백본 id와 그 자리를 이어받은 id (mlpx-spec.md §9.1).
 *
 * **등록부를 안 읽고 글자를 박는다.** 마이그레이션은 역사이지 지금의 설정이 아니다 —
 * `DEFAULT_BACKBONE_ID`를 읽으면 셋째 백본이 등록되는 날 **옛 파일이 그 백본의 것으로
 * 둔갑한다.** 벡터는 한 번도 그 백본에서 나온 적이 없는데도 그렇다.
 */
const V1_BACKBONE_ID = 'mobilenet-v2'
const V2_BACKBONE_ID = 'mobilenet-v2-r2'

/**
 * `settings.data`의 백본 id를 개정판으로 옮긴다.
 *
 * **옛 id일 때만 바꾼다.** 표 프로젝트에는 이 필드가 아예 없고, 모르는 id는 우리가
 * 만들지 않은 값이라 그대로 지나간다 — 우리 이름으로 덮으면 그 파일은 자기가 어디서
 * 왔는지 말할 수 없게 된다.
 */
function renameBackbone(data: unknown): unknown {
  const record = asRecord(data)
  if (!record || record.backboneId !== V1_BACKBONE_ID) return data
  return { ...record, backboneId: V2_BACKBONE_ID }
}

/**
 * v1 -> v2. **백본 id 개정** (mlpx-spec.md §9.1).
 *
 * 바꾸는 자리는 둘이다 — 지금 설정과 **모든 실험 스냅샷.** 스냅샷을 빼먹으면 결과
 * 화면이 옛 id로 임베딩을 찾다가 못 찾고, 학생이 이미 본 실험이 빈손이 된다.
 *
 * **임베딩은 안 만진다.** 마이그레이션이 받는 것은 JSON 넷뿐이라 엔트리를 만질 자리가
 * 없고(§9), 만질 필요도 없다 — 문서가 새 id를 가리키는 순간 옛 디렉터리는 아무도 안
 * 보는 것이 되고 다음 저장에서 `writeProject`가 떨어뜨린다 (format.ts).
 */
function migrateV1ToV2(document: RawDocument): RawDocument {
  const next: RawDocument = { ...document }

  const settings = asRecord(document.settings)
  if (settings) next.settings = { ...settings, data: renameBackbone(settings.data) }

  const runs = asRecord(document.runs)
  const experiments = runs?.experiments
  if (runs && Array.isArray(experiments)) {
    next.runs = {
      ...runs,
      experiments: experiments.map((experiment) => {
        const record = asRecord(experiment)
        const experimentSettings = asRecord(record?.settings)
        if (!record || !experimentSettings) return experiment
        return {
          ...record,
          settings: { ...experimentSettings, data: renameBackbone(experimentSettings.data) },
        }
      }),
    }
  }

  return next
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
 *
 * **입력을 먼저 복제한다.** 변환 함수는 새 객체를 만들어 돌려주는 것이 규칙이지만
 * 중첩된 자리를 제자리에서 고치는 실수는 `{ ...raw }`로 얕게 복사하는 순간 생기고,
 * 그러면 부르는 쪽이 들고 있던 원본이 함께 바뀐다 - readProject는 파싱한 JSON을,
 * loadProject는 IndexedDB 레코드를 넘긴다. **복제를 여기서 하는 이유**는 남의 함수에
 * 원본을 넘기는 자리가 여기이기 때문이다. 올릴 것이 없으면 복제도 안 한다.
 */
export function applyMigrations(
  document: RawDocument,
  from: number,
  to: number,
  migrations: Record<number, Migration> = MIGRATIONS,
): RawDocument {
  let current = from < to ? structuredClone(document) : document
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

  return parseProjectDocument(applyMigrations(raw, version, FORMAT_VERSION))
}
