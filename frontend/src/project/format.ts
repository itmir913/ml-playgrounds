/**
 * .mlpx(zip) 읽기/쓰기.
 * 확장자 문자열은 이 파일의 상수 하나로 관리한다. 코드에 흩뿌리지 마라.
 *
 * 이 계층이 지키는 것 셋.
 *
 * 1. **데이터셋 바이트를 건드리지 않는다.** 디코딩했다 다시 인코딩하면 datasetHash
 *    재계산이 깨지고, 그러면 무결성 검증 자체가 무의미해진다 (docs/mlpx-spec.md 7).
 * 2. **모델 안을 들여다보지 않는다.** 어떻게 해석할지는 등록부의 일이다.
 * 3. **저장은 항상 성공한다.** 크기 예산을 넘으면 모델을 빼지, 저장을 실패시키지 않는다.
 *
 * 모르는 엔트리는 버린다. 상위 버전 파일은 formatVersion에서 이미 거부되므로
 * 여기 남는 모르는 엔트리는 미래의 파일이 아니라 __MACOSX/ 같은 쓰레기이거나,
 * 아무도 가리키지 않는 고아 모델이다. 실어 나를 이유가 없다.
 */

import { unzip, zip, type Unzipped } from 'fflate'

import { ClientError } from '../errors'
import { hashBytes } from '../hash'
import { MAX_FILE_NAME_LENGTH, MAX_MODEL_BYTES, MODEL_BUDGET_BYTES } from '../limits'
import {
  buildHashes,
  checkHashes,
  parseHashes,
  type HashCheck,
  type ProjectHashes,
} from './integrity'
import { migrateProjectDocument, requireSupportedVersion } from './migrate'
import type { Manifest, ModelOmissionReason, ModelRef, ProjectDocument } from './schema'

/** 프로젝트 파일의 확장자. 코드 안에서 '.mlpx'를 직접 쓰지 마라. */
export const MLPX_EXTENSION = '.mlpx'

/** zip 안에서 이름이 고정된 엔트리. */
export const ENTRY = {
  manifest: 'manifest.json',
  settings: 'settings.json',
  runs: 'runs.json',
  portfolio: 'portfolio.json',
  portfolioMarkdown: 'portfolio.md',
  hashes: 'hashes.json',
} as const

/** 내용이 가변인 디렉터리. */
export const DIR = {
  model: 'model/',
  dataset: 'dataset/',
} as const

/*
 * 없으면 파일을 열 수 없는 엔트리는 manifest / settings / runs / portfolio 넷이다.
 * readProject의 required()가 그 자리에서 확인한다.
 *
 * portfolio.md는 필수가 아니다 - portfolio.json이 원본이고 .md는 파생물이다.
 * model/ 아래도 아니다 - 모델이 빠진 파일은 지표만 남은 정상적인 파일이다.
 * hashes.json도 아니다 - 옛 파일에는 아예 없고, 없으면 "확인할 수 없음"일 뿐이다.
 */

/**
 * 파일명에 쓸 수 없는 문자.
 *
 * 한글은 건드리지 않는다. 하이픈도 남긴다 - 1-2-03 같은 학번 체계가 실재한다.
 */
const FORBIDDEN_IN_FILE_NAME = /[\\/:*?"<>|]/g

/**
 * 정본 데이터셋. **바이트와 해시를 쪼갤 수 없게 한 객체로 묶는다.**
 *
 * 둘이 갈라지면 무결성 대조가 조용히 무의미해진다 - 남의 해시로 내 바이트를 검사하는
 * 코드는 언제나 "그대로"라고 답한다.
 */
export interface Dataset {
  /** 업로드된 원본 그대로. 절대 가공하지 않는다. */
  readonly bytes: Uint8Array
  /**
   * **가져오기 시점에 한 번 계산한 값을 계속 들고 다닌다**
   * (data/table.ts의 ImportedTable.hash).
   *
   * 저장할 때마다 다시 계산하지 않기 위해 타입에 박아 둔다. 50MB 데이터셋이면
   * 자동 저장 한 번에 265ms이고, 정본은 확정된 뒤로 바뀌지 않으므로 다시 계산할
   * 이유가 없다 (mlpx-spec.md 7.2).
   */
  readonly hash: string
}

export interface ProjectFile {
  document: ProjectDocument
  /**
   * 아직 표를 올리지 않은 프로젝트에는 **없다.** 정상 상태다.
   *
   * `document.settings.dataset`과 **함께 있고 함께 없다** (mlpx-spec.md §1).
   * 한쪽만 있는 것은 우리 버그이고, datasetEntry가 저장 직전에 잡는다.
   */
  dataset?: Dataset | undefined
  /** zip 경로 -> 내용. 모델과 전처리기가 들어온다. */
  models: Map<string, Uint8Array>
}

export type DropReason = 'tooLarge' | 'overBudget' | 'preprocessorMissing'

export interface DroppedModel {
  path: string
  sizeBytes: number
  reason: DropReason
}

export interface WriteResult {
  bytes: Uint8Array
  /** 예산 때문에 담지 못한 모델. 화면은 이걸 경고로 보여준다. */
  dropped: DroppedModel[]
  /** 방금 쓴 파일의 내용 해시. 저장 화면이 학생에게 보여주고 교사가 수거 시점에 적어둔다. */
  contentHash: string
}

export interface ReadResult {
  project: ProjectFile
  /**
   * 여는 김에 함께 한 해시 대조.
   *
   * ProjectFile 안에 두지 않는다 - 새로 만드는 프로젝트에는 대조할 대상이 없다.
   * 필드를 선택 항목으로 두면 "없음"과 "확인할 수 없음"이 섞인다.
   */
  integrity: HashCheck
}

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function decodeJson(bytes: Uint8Array, entry: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    throw new ClientError('PROJECT_FILE_INVALID', { path: entry, issues: 1 })
  }
}

function encodeJson(value: unknown): Uint8Array {
  // 들여쓰기를 넣는다. 학생이 압축을 풀어 들여다보는 것은 교육적으로 좋은 일이다.
  return new TextEncoder().encode(JSON.stringify(value, null, 2))
}

async function unzipAsync(bytes: Uint8Array): Promise<Unzipped> {
  return new Promise((resolve, reject) => {
    unzip(bytes, (error, unzipped) => {
      // zip이 아니거나 깨졌다. 어느 쪽이든 프로젝트 파일이 아니다.
      if (error) reject(new ClientError('PROJECT_FILE_NOT_ZIP'))
      else resolve(unzipped)
    })
  })
}

async function zipAsync(entries: Record<string, Uint8Array>): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    // 비동기 API를 쓴다. 동기 API는 큰 CSV에서 저사양 PC의 화면을 몇 초씩 얼린다.
    zip(entries, { level: 6 }, (error, bytes) => {
      if (error) reject(error)
      else resolve(bytes)
    })
  })
}

/**
 * 문서가 가리키는 모델 경로를 전부 모은다.
 *
 * 여기 없는 model/ 엔트리는 고아다 - 아무도 가리키지 않으므로 영원히 열리지 않는다.
 */
function referencedModelPaths(document: ProjectDocument): Set<string> {
  const paths = new Set<string>()
  for (const batch of document.runs.batches) {
    if (batch.preprocessor) paths.add(batch.preprocessor.path)
    for (const run of batch.runs) {
      if (run.model) paths.add(run.model.path)
    }
  }
  return paths
}

/**
 * 드롭 사유를 파일에 남길 어휘로 바꾼다. 남길 말이 없으면 undefined다.
 *
 * `preprocessorMissing`은 어휘에 없다. 그건 "모델을 왜 안 담았나"가 아니라 "이 파일이
 * 어긋나 있다"는 다른 축이고, 정상 경로로는 나오지 않는다 - selectModels가 모델을 담을
 * 때 전처리기를 항상 함께 담기 때문이다. 손으로 고친 파일에서만 나오고, 그때 할 말은
 * 무결성 층이 한다 (mlpx-spec.md 4.2).
 */
function omissionReason(reason: DropReason): ModelOmissionReason | undefined {
  if (reason === 'overBudget') return 'overBudget'
  if (reason === 'tooLarge') return 'tooLarge'
  return undefined
}

/**
 * 파일에 없는 모델 참조를 문서에서 떼어내고, **왜 없는지를 적는다.**
 *
 * 예산에서 밀려 빠진 모델과 같은 상태로 만든다 - 지표는 남고 예측만 못 한다.
 * 참조를 그대로 두면 메모리의 문서와 파일 내용이 어긋난 채로 돌아다닌다.
 *
 * `reasonFor`가 없으면 사유를 적지 않는다. **읽을 때가 그 경우다** - 파일에 모델이 없는
 * 것을 발견했을 뿐 왜 없는지는 모르고, 파일에 이미 적혀 있던 modelOmitted가 그 답이다.
 * 추측해서 덮어쓰면 "예산에서 밀렸다"가 "파일이 깨졌다"를 가린다.
 */
function detachMissingModels(
  document: ProjectDocument,
  present: Set<string>,
  reasonFor?: (path: string) => ModelOmissionReason | undefined,
): ProjectDocument {
  const batches = document.runs.batches.map((batch) => {
    const hasPreprocessor = batch.preprocessor ? present.has(batch.preprocessor.path) : false
    const runs = batch.runs.map((run) => {
      // **전처리기가 필요한지는 모델이 말한다** (mlpx-spec.md 5). 자체 JSON은 전처리가
      // 밖에 있어서 전처리기 없이는 예측할 수 없지만, 전처리를 그래프에 담는 형식은
      // 혼자 선다. 형식 이름을 보고 가르면 표 윗줄이 금지한 분기를 여기로 옮기는 것이다.
      const needsPreprocessor = run.model ? !run.model.includesPreprocessing : false
      if (run.model && (hasPreprocessor || !needsPreprocessor) && present.has(run.model.path)) {
        if (run.modelOmitted === undefined) return run
        // 모델이 돌아왔다. 옛 사유를 남겨 두면 담긴 모델 옆에 "담지 못했습니다"가 뜬다.
        const restored = { ...run }
        delete restored.modelOmitted
        return restored
      }
      const detached = { ...run }
      const reason = run.model ? reasonFor?.(run.model.path) : undefined
      delete detached.model
      if (reason) detached.modelOmitted = reason
      return detached
    })
    const next = { ...batch, runs }
    if (!hasPreprocessor) delete next.preprocessor
    return next
  })
  return { ...document, runs: { ...document.runs, batches } }
}

/**
 * 크기 예산에 맞춰 담을 모델을 고른다 (mlpx-spec.md 5.1).
 *
 * 최신 묶음부터 채운다. 계수 몇 개짜리 모델은 여러 회차가 남고, 랜덤 포레스트는
 * 최근 것만 남는다. 그래서 학생은 과거 버전으로도 예측을 시험할 수 있다.
 *
 * 전처리기는 그 묶음 모델 전체의 전제다. 전처리기가 예산에 못 들어가면
 * 그 묶음의 모델은 담아 봐야 쓸 수 없으므로 통째로 뺀다.
 *
 * 상한을 인자로 받는 이유는 테스트다. 실제 예산은 수십 MB라서 그걸 그대로 채우는
 * 테스트는 느리고, 상한이 바뀌면 테스트 의도까지 흔들린다.
 */
export function selectModels(
  document: ProjectDocument,
  models: Map<string, Uint8Array>,
  budgetBytes: number = MODEL_BUDGET_BYTES,
  maxModelBytes: number = MAX_MODEL_BYTES,
): { kept: Set<string>; dropped: DroppedModel[] } {
  const kept = new Set<string>()
  const dropped: DroppedModel[] = []
  let remaining = budgetBytes

  const sizeOf = (path: string): number => models.get(path)?.length ?? 0

  const drop = (path: string, reason: DropReason): void => {
    dropped.push({ path, sizeBytes: sizeOf(path), reason })
  }

  // 최신 묶음이 먼저다.
  for (const batch of [...document.runs.batches].reverse()) {
    const candidates = batch.runs
      .map((run) => run.model)
      .filter((model): model is ModelRef => model !== undefined && models.has(model.path))
    if (candidates.length === 0) continue

    const preprocessorPath = batch.preprocessor?.path
    const preprocessorFound = preprocessorPath !== undefined && models.has(preprocessorPath)
    const preprocessorSize = preprocessorFound ? sizeOf(preprocessorPath) : 0
    const preprocessorUsable = preprocessorFound && preprocessorSize <= remaining

    // **전처리기가 필요한지는 모델이 말한다** (mlpx-spec.md 5). 쓸 수 없는데 그것을
    // 전제로 하는 모델은 담아 봐야 예측에 못 쓴다. 전처리를 자기 안에 담은 형식은
    // 혼자 서므로 남긴다 - 형식 이름으로 가르지 않고 모델이 든 불리언만 본다.
    const runnable = candidates.filter((model) => {
      if (model.includesPreprocessing || preprocessorUsable) return true
      drop(model.path, preprocessorFound ? 'overBudget' : 'preprocessorMissing')
      return false
    })
    if (runnable.length === 0) continue

    // 전처리기가 필요한 모델이 하나라도 있으면 자리를 먼저 잡는다. 그 모델이 크기 때문에
    // 나중에 다 빠질 수도 있는데, 그때는 아래에서 자리를 돌려준다.
    const reserved = preprocessorUsable && runnable.some((model) => !model.includesPreprocessing)

    const accepted: ModelRef[] = []
    let used = reserved ? preprocessorSize : 0
    for (const model of runnable) {
      const size = sizeOf(model.path)
      if (size > maxModelBytes) {
        drop(model.path, 'tooLarge')
      } else if (used + size > remaining) {
        drop(model.path, 'overBudget')
      } else {
        accepted.push(model)
        used += size
      }
    }

    if (accepted.length === 0) {
      // 전처리기만 남으면 아무도 쓰지 않는 짐이다.
      continue
    }

    // **담긴 모델이 아무도 안 쓰면 전처리기도 짐이다.** 필요로 하던 모델이 크기에서
    // 전부 빠졌을 때가 그렇다 - 자리를 잡아 뒀으므로 예산도 함께 돌려준다.
    // (그 자리 때문에 다른 모델이 밀렸을 수는 있다. 한 번 더 돌면 되찾지만, 형식이 섞이는
    //  것은 V5부터라 지금은 그 복잡도를 지지 않는다.)
    const keepPreprocessor = reserved && accepted.some((model) => !model.includesPreprocessing)
    if (keepPreprocessor && preprocessorPath !== undefined) kept.add(preprocessorPath)
    for (const model of accepted) kept.add(model.path)
    remaining -= keepPreprocessor ? used : used - (reserved ? preprocessorSize : 0)
  }

  return { kept, dropped }
}

/**
 * 무결성 대조에 넣을 엔트리를 고른다.
 *
 * **아는 것만 넣는다.** zip에 있는 모든 엔트리를 세면 맥에서 압축을 풀었다 다시 압축한
 * 파일이 __MACOSX/ 때문에 전부 "고쳐졌음"이 된다. 반대로 model/ 아래를 통째로 넣는
 * 이유는, 아무도 가리키지 않는 모델이 끼어든 것도 드러나야 하기 때문이다.
 *
 * hashes.json 자신은 대상이 아니다 - 자기 해시를 자기 안에 담을 수 없다.
 */
function hashableEntries(
  entries: Map<string, Uint8Array>,
  datasetPath: string | undefined,
): Map<string, string> {
  const known = new Set<string>([
    ENTRY.manifest,
    ENTRY.settings,
    ENTRY.runs,
    ENTRY.portfolio,
    ENTRY.portfolioMarkdown,
  ])
  // 없는 프로젝트가 정상이다. 그러면 대조 대상에서 빠질 뿐이다.
  if (datasetPath !== undefined) known.add(datasetPath)

  const present = new Map<string, string>()
  for (const [path, content] of entries) {
    if (known.has(path) || path.startsWith(DIR.model)) {
      present.set(path, hashBytes(content))
    }
  }
  return present
}

/**
 * 문서가 적어 둔 zip 경로가 제 디렉터리 안에 있는지 확인한다.
 *
 * **스키마는 이 경로들을 z.string()으로 둔다.** 컬럼명처럼 사용자 데이터가 아니라 우리가
 * 쓴 값인데도 그런 이유는, 검증할 것이 문자열 모양이 아니라 **다른 엔트리와의 관계**여서
 * zod가 볼 수 없는 자리이기 때문이다.
 *
 * 확인하지 않으면 고정 엔트리를 덮어쓴다. writeProject는 manifest/settings/runs/portfolio를
 * 먼저 넣고 그 뒤에 데이터셋과 모델을 넣으므로, dataset.path가 'manifest.json'이면
 * **저장한 파일이 다시 안 열리고** preprocessor.path가 'settings.json'이면 방금 만든 설정이
 * 파일에서 읽어 온 옛 바이트로 덮인다 - 뒤엣것은 터지지도 않아서 더 나쁘다.
 *
 * **읽을 때만 확인한다.** 우리 코드는 경로를 상수에서 만들므로 여기만 막으면 되고,
 * 쓸 때 던지면 "저장은 항상 성공한다"(mlpx-spec.md 4.2)와 부딪힌다.
 *
 * '..'을 막는 것은 우리를 위해서가 아니다 - 우리는 경로를 Map 키로만 쓴다. 학생이 압축을
 * 풀 때 바깥으로 새는 것을 막는다.
 */
function requirePathUnder(path: string, directory: string, field: string): void {
  const inside = path.startsWith(directory) && path.length > directory.length
  const escapes = path.split('/').includes('..') || path.includes('\\')
  if (!inside || escapes) {
    throw new ClientError('PROJECT_FILE_INVALID', { path: field, issues: 1 })
  }
}

/** 문서가 가리키는 모든 zip 경로를 검사한다. 하나라도 어긋나면 파일을 열지 않는다. */
/**
 * 데이터셋 참조와 실제 바이트가 **함께 있는지** 확인하고, 있으면 담을 것을 돌려준다.
 *
 * 한쪽만 있는 상태는 우리 버그다 (mlpx-spec.md §1). 그대로 쓰면 참조는 있는데 본체가
 * 없는 .mlpx가 나가고 **그 파일은 다시 열리지 않는다.** 저장이 실패하는 편이 낫다 -
 * 학생이 그 자리에서 알아채는 것과, 다음 차시에 열다가 아는 것은 다른 일이다.
 */
function datasetEntry(
  document: ProjectDocument,
  dataset: Dataset | undefined,
): { path: string; bytes: Uint8Array; hash: string } | undefined {
  const ref = document.settings.dataset
  if (ref === undefined && dataset === undefined) {
    return undefined
  }
  if (ref === undefined || dataset === undefined) {
    throw new ClientError('PROJECT_FILE_INVALID', { path: 'settings.dataset', issues: 1 })
  }
  return { path: ref.path, bytes: dataset.bytes, hash: dataset.hash }
}

function requireSanePaths(document: ProjectDocument): void {
  const dataset = document.settings.dataset
  if (dataset) {
    requirePathUnder(dataset.path, DIR.dataset, 'settings.dataset.path')
  }

  document.runs.batches.forEach((batch, batchIndex) => {
    const at = `runs.batches.${batchIndex}`
    if (batch.preprocessor) {
      requirePathUnder(batch.preprocessor.path, DIR.model, `${at}.preprocessor.path`)
    }
    batch.runs.forEach((run, runIndex) => {
      if (run.model) {
        requirePathUnder(run.model.path, DIR.model, `${at}.runs.${runIndex}.model.path`)
      }
    })
  })
}

/**
 * hashes.json을 읽는다. 없거나 깨졌으면 null.
 *
 * **여기서 던지지 않는다.** 다른 엔트리의 JSON이 깨지면 PROJECT_FILE_INVALID지만
 * 이건 다르다 - 무결성 정보가 망가진 것은 "확인할 수 없음"이지 파일이 잘못된 것이 아니고,
 * 그것 때문에 학생의 작업물이 안 열려서는 안 된다.
 */
function recordedHashes(bytes: Uint8Array | undefined): ProjectHashes | null {
  if (!bytes) return null
  try {
    return parseHashes(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

/**
 * .mlpx 바이트를 읽어 프로젝트로 만든다.
 *
 * 순서를 지켜야 한다 - 압축 해제 -> JSON 파싱 -> **버전 확인과 마이그레이션** -> 검증.
 */
export async function readProject(bytes: Uint8Array): Promise<ReadResult> {
  const unzipped = await unzipAsync(bytes)
  const entries = new Map<string, Uint8Array>(Object.entries(unzipped))

  const required = (entry: string): Uint8Array => {
    const content = entries.get(entry)
    if (!content) throw new ClientError('PROJECT_FILE_ENTRY_MISSING', { entry })
    return content
  }

  // **manifest가 먼저다.** 나머지 엔트리를 요구하기 전에 버전을 확정한다 - 엔트리 구성이
  // 바뀐 미래의 파일에 "파일이 깨졌습니다"가 아니라 "앱을 업데이트하세요"를 주기 위해서다
  // (mlpx-spec.md 9).
  const manifest = decodeJson(required(ENTRY.manifest), ENTRY.manifest)
  requireSupportedVersion(manifest)

  const raw = {
    manifest,
    settings: decodeJson(required(ENTRY.settings), ENTRY.settings),
    runs: decodeJson(required(ENTRY.runs), ENTRY.runs),
    portfolio: decodeJson(required(ENTRY.portfolio), ENTRY.portfolio),
  }
  const document = migrateProjectDocument(raw)
  requireSanePaths(document)

  // settings가 데이터셋을 가리키는데 본체가 없으면 재학습도, 참조형 모델의 예측도,
  // 해시 재계산도 전부 불가능하다. 아예 안 가리키는 것은 다르다 - 표를 아직 안 올린
  // 정상적인 파일이다 (mlpx-spec.md §1).
  const datasetPath = document.settings.dataset?.path
  const datasetBytes = datasetPath === undefined ? undefined : entries.get(datasetPath)
  if (datasetPath !== undefined && datasetBytes === undefined) {
    throw new ClientError('PROJECT_FILE_ENTRY_MISSING', { entry: datasetPath })
  }

  // 대조는 엔트리를 버리기 **전에** 한다. 끼어든 고아 모델도 신호이기 때문이다.
  const present = hashableEntries(entries, datasetPath)
  const integrity = checkHashes(present, recordedHashes(entries.get(ENTRY.hashes)))

  // 문서가 가리키는 것만 가져온다. 고아와 쓰레기는 여기서 사라진다.
  const referenced = referencedModelPaths(document)
  const models = new Map<string, Uint8Array>()
  for (const path of referenced) {
    const content = entries.get(path)
    if (content) models.set(path, content)
  }

  return {
    project: {
      document: detachMissingModels(document, new Set(models.keys())),
      dataset:
        datasetPath === undefined || datasetBytes === undefined
          ? undefined
          : { bytes: datasetBytes, hash: present.get(datasetPath) ?? hashBytes(datasetBytes) },
      models,
    },
    integrity,
  }
}

/**
 * 프로젝트를 .mlpx 바이트로 만든다.
 *
 * portfolioMarkdown을 **필수 인자로 받는다.** 렌더링에는 t()가 필요한데 포맷 계층에
 * i18n을 끌어들이면 zip 왕복 테스트마다 번역을 부팅해야 한다. 선택 인자로 두면
 * 언젠가 portfolio.md 없는 파일이 나가고, 그건 "파일 하나만 열면 다 본다"는
 * 약속을 깨면서도 아무도 모른다 (CLAUDE.md 1.3).
 */
export async function writeProject(
  project: ProjectFile,
  portfolioMarkdown: string,
): Promise<WriteResult> {
  const { kept, dropped } = selectModels(project.document, project.models)
  // 담지 못한 모델의 참조는 문서에서도 뗀다. 파일과 문서가 어긋나면 안 된다.
  // **여기서는 왜 뺐는지를 안다.** 그 사유가 파일에 남아야 화면이 학생에게 무엇을 할 수
  // 있는지 말한다 - "다시 학습하세요"와 "다시 학습해도 소용없습니다"는 다른 답이다.
  const reasons = new Map(dropped.map((model) => [model.path, omissionReason(model.reason)]))
  const document = detachMissingModels(project.document, kept, (path) => reasons.get(path))

  const entries: Record<string, Uint8Array> = {
    [ENTRY.manifest]: encodeJson(document.manifest),
    [ENTRY.settings]: encodeJson(document.settings),
    [ENTRY.runs]: encodeJson(document.runs),
    [ENTRY.portfolio]: encodeJson(document.portfolio),
    [ENTRY.portfolioMarkdown]: new TextEncoder().encode(portfolioMarkdown),
  }
  const dataset = datasetEntry(document, project.dataset)
  if (dataset !== undefined) {
    entries[dataset.path] = dataset.bytes
  }
  for (const path of kept) {
    const content = project.models.get(path)
    if (content) entries[path] = content
  }

  // 마지막에 만든다. 자기 자신은 대상이 아니므로 다른 엔트리가 전부 정해진 뒤여야 한다.
  const hashes = buildHashes(entries, dataset)
  entries[ENTRY.hashes] = encodeJson(hashes)

  return { bytes: await zipAsync(entries), dropped, contentHash: hashes.contentHash }
}

function sanitizeSegment(value: string): string {
  return (
    [...value]
      // 제어문자는 파일명에 들어갈 수 없다. 정규식에 넣으면 소스에 안 보이는 바이트가 남는다.
      .filter((character) => character.charCodeAt(0) > 31)
      .join('')
      .replace(FORBIDDEN_IN_FILE_NAME, '')
      .replace(/\s+/g, '')
      // 윈도우는 점으로 끝나는 이름을 거부한다.
      .replace(/^\.+|\.+$/g, '')
  )
}

/**
 * 저장할 파일명을 만든다.
 *
 * 학번과 이름이 있으면 앞에 붙는다. 이것이 인적사항을 required로 만드는 대신 쓰는
 * 검사 수단이다 - 학생이 저장할 때 스스로 알아채고, 교사는 수거 폴더만 봐도 찾아낸다.
 *
 *   있음 -> 10203_홍길동_붓꽃품종분류.mlpx
 *   없음 -> 붓꽃품종분류.mlpx
 */
export function projectFileName(manifest: Manifest): string {
  const student = toRecord(manifest.student)
  const segments = [student.studentId, student.name, manifest.name]
    .map((value) => (typeof value === 'string' ? sanitizeSegment(value) : ''))
    .filter((value) => value.length > 0)

  // 전부 비면 projectId 앞자리를 쓴다. 언어에 기대지 않는 이름이 필요하다.
  const joined = segments.length > 0 ? segments.join('_') : manifest.projectId.slice(0, 8)
  return `${[...joined].slice(0, MAX_FILE_NAME_LENGTH).join('')}${MLPX_EXTENSION}`
}
