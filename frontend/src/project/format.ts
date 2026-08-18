/**
 * .mlpx(zip) 읽기/쓰기.
 * 확장자 문자열은 이 파일의 상수 하나로 관리한다. 코드에 흩뿌리지 마라.
 *
 * 이 계층이 지키는 것 셋.
 *
 * 1. **데이터셋 바이트를 건드리지 않는다.** 디코딩했다 다시 인코딩하면 해시
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
  hashes: 'hashes.json',
  // **포트폴리오는 디렉터리 안이다** (mlpx-spec.md 1). 글에 이미지가 붙는 것이
  // 예정되어 있고(open-decisions.md 23) 첨부는 DIR.portfolio 아래로 들어간다.
  // 배포 뒤에는 못 옮긴다 - 마이그레이션이 받는 것은 JSON 넷이지 엔트리 맵이
  // 아니라서 엔트리의 이동을 표현할 자리가 없다 (mlpx-spec.md 9).
  portfolio: 'portfolio/document.json',
  portfolioMarkdown: 'portfolio/document.md',
} as const

/** 내용이 가변인 디렉터리. */
export const DIR = {
  model: 'model/',
  dataset: 'dataset/',
  portfolio: 'portfolio/',
  /**
   * 포트폴리오에 붙인 사진 (mlpx-spec.md §8.5). **`portfolio/` 아래인 것이 핵심이다** -
   * `portfolio/document.md`가 `attachments/3.webp`이라는 상대 경로로 가리키고, 압축을 푼 자리에서
   * 그대로 맞아야 한다.
   */
  attachments: 'portfolio/attachments/',
  /**
   * 백본이 뽑아 둔 임베딩 (mlpx-spec.md §1.3). 아래에 백본 id가 한 겹 더 있다.
   *
   * **`dataset/` 밑이 아니다.** 학생이 올린 것이 아니라 우리가 계산한 것이고, 지우고
   * 다시 뽑아도 프로젝트는 그대로다.
   */
  embeddings: 'embeddings/',
} as const

/**
 * 표 데이터의 정본 경로 (mlpx-spec.md §1.1).
 *
 * **언제나 UTF-8 CSV다.** 업로드가 xlsx였든 CP949 CSV였든 가져오기 시점에 한 번
 * 정규화된다. 이미지·음성이 들어오는 V5에서는 다른 레이아웃이 붙지만, 표는 이 하나다.
 */
export const TABULAR_DATASET_PATH = `${DIR.dataset}data.csv`

/**
 * 평가 데이터의 정본 경로 (mlpx-spec.md §1.1).
 *
 * `split.method`가 `provided`일 때만 있다. `data.csv`와 같은 규칙 - 언제나 UTF-8 CSV고,
 * 가져오기 시점에 한 번 정규화된다.
 */
export const TEST_DATASET_PATH = `${DIR.dataset}test.csv`

/**
 * 예측 데이터의 정본 경로 (mlpx-spec.md §1.1).
 *
 * 예측 화면에서 파일을 올리면 생긴다. 답을 모르는 새 줄들이라 타깃 열이 없다.
 * `data.csv`·`test.csv`와 같은 규칙 - 언제나 UTF-8 CSV고, 가져오기 시점에 한 번
 * 정규화된다.
 */
export const PREDICT_DATASET_PATH = `${DIR.dataset}predict.csv`

/**
 * 이미지 정본이 사는 폴더들 (mlpx-spec.md §1.2).
 *
 * **표의 `data.csv`·`test.csv`·`predict.csv`와 같은 역할 이름이다** — 압축을 푼 교사가
 * 알고 싶은 것은 그 파일이 무엇인지이고, 그 규칙이 종류를 넘어 같다.
 *
 * `data/`와 `test/` 아래는 범주 폴더가 한 겹 더 있고, `predict/`는 라벨이 없어 한 겹이다.
 */
export const IMAGE_DATA_DIR = `${DIR.dataset}data/`
export const IMAGE_TEST_DIR = `${DIR.dataset}test/`
export const IMAGE_PREDICT_DIR = `${DIR.dataset}predict/`

/**
 * 라벨 없는 사진이 사는 범주 폴더 (mlpx-spec.md §1.2).
 *
 * **예약된 이름이고 번역하지 않는다.** 화면에 보이는 말은 로케일에서 오고, 파일 안의
 * 구조는 언어에 딸리지 않는다 — 한국어로 만든 프로젝트를 영어 화면에서 열어도 폴더
 * 이름이 그대로여야 zip이 같은 파일이다.
 *
 * **범주가 아니라 상태다.** 학생이 만든 범주 목록(`settings.data.categories`)에는
 * 안 들어간다.
 */
export const IMAGE_UNLABELED = '_unlabeled'

/*
 * 없으면 파일을 열 수 없는 엔트리는 manifest / settings / runs / portfolio 넷이다.
 * readProject의 required()가 그 자리에서 확인한다.
 *
 * portfolio/document.md는 필수가 아니다 - portfolio/document.json이 원본이고 .md는 파생물이다.
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
   * `document.settings.data.dataset`과 **함께 있고 함께 없다** (mlpx-spec.md §1).
   * 한쪽만 있는 것은 우리 버그이고, referencedFileEntry가 저장 직전에 잡는다.
   */
  dataset?: Dataset | undefined
  /**
   * 평가 데이터. `split.method`가 `provided`일 때만 있다.
   *
   * `document.settings.data.testDataset`과 **함께 있고 함께 없다** - `dataset`과 같은 규칙이다
   * (mlpx-spec.md §1.1).
   */
  testDataset?: Dataset | undefined
  /**
   * 예측 데이터. 예측 화면에서 파일을 올렸을 때만 있다.
   *
   * `document.settings.data.predictDataset`과 **함께 있고 함께 없다** - `dataset`·`testDataset`과
   * 같은 규칙이다 (mlpx-spec.md §1.1).
   */
  predictDataset?: Dataset | undefined
  /** zip 경로 -> 내용. 모델과 전처리기가 들어온다. */
  models: Map<string, Uint8Array>
  /**
   * zip 경로 -> 정본 사진. **표 프로젝트에서는 비어 있다.**
   *
   * `models`와 같은 모양인 것이 핵심이다 (open-decisions.md "파일 계층은 '파일 참조인가'를
   * 묻는다") — 새 개념이 아니라 있는 길을 한 번 더 쓴다. 이미지는 참조 하나에 본체가
   * 수백 개라 위 세 칸(`dataset`·`testDataset`·`predictDataset`)에 못 들어간다.
   */
  images: Map<string, Uint8Array>
  /**
   * zip 경로 -> 포트폴리오에 붙인 사진. **`images`와 같은 모양이다** - 새 개념이 아니라
   * 있는 길을 한 번 더 쓴다.
   *
   * **학습용 정본과 섞이지 않는다.** 저쪽은 백본이 먹는 정사각형이고 이쪽은 사람이 보는
   * 그림이라, 크기 규칙도 사는 자리도 다르다 (mlpx-spec.md §8.6.1).
   */
  attachments: Map<string, Uint8Array>
  /**
   * zip 경로 -> 임베딩 벡터 (mlpx-spec.md §1.3). **파생물이라 비어 있어도 정상이다.**
   *
   * 위 셋과 다른 점은 **가리키는 참조가 없다는 것**이다 — `settings` 어디에도 안 적혀
   * 있고, 경로 자체가 "어느 백본이 어느 사진에서 뽑았는가"를 다 말한다. 그래서
   * "함께 있고 함께 없다"가 여기에는 해당하지 않는다.
   */
  embeddings: Map<string, Uint8Array>
}

/** 이미지 정본이 사는 자리들. 아래 판정들이 이 목록으로 걷는다. */
const IMAGE_DIRS = [IMAGE_DATA_DIR, IMAGE_TEST_DIR, IMAGE_PREDICT_DIR] as const

/** zip 엔트리가 정본 사진인가. */
function isImageEntry(path: string): boolean {
  return IMAGE_DIRS.some((directory) => path.startsWith(directory))
}

/** zip 엔트리가 포트폴리오 첨부인가. */
function isAttachmentEntry(path: string): boolean {
  return path.startsWith(DIR.attachments)
}

/** zip 엔트리가 임베딩인가. */
function isEmbeddingEntry(path: string): boolean {
  return path.startsWith(DIR.embeddings)
}

/**
 * 이 경로가 가리키는 사진의 해시. 정본이든 임베딩이든 **이름이 곧 해시다**
 * (mlpx-spec.md §1.2·§1.3).
 */
function hashOfEntry(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot < 0 ? name : name.slice(0, dot)
}

/**
 * 이 참조가 파일 하나를 가리키는가. **데이터 종류를 묻지 않는다**
 * (open-decisions.md "파일 계층은 '파일 참조인가'를 묻는다").
 *
 * 답은 참조 자신에게 있다 — 폴더 경로는 `/`로 끝나고, 그 모양은 스키마가 강제한다
 * (`imageDatasetRefSchema`). 종류로 갈랐다면 음성·텍스트가 올 때마다 분기가 자란다.
 */
export function pointsToFile(ref: { path: string } | undefined): boolean {
  return ref !== undefined && !ref.path.endsWith('/')
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
  for (const experiment of document.runs.experiments) {
    if (experiment.preprocessor) paths.add(experiment.preprocessor.path)
    for (const run of experiment.runs) {
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
  const experiments = document.runs.experiments.map((experiment) => {
    const hasPreprocessor = experiment.preprocessor
      ? present.has(experiment.preprocessor.path)
      : false
    const runs = experiment.runs.map((run) => {
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
    const next = { ...experiment, runs }
    if (!hasPreprocessor) delete next.preprocessor
    return next
  })
  return { ...document, runs: { ...document.runs, experiments } }
}

/**
 * 본체가 없는 첨부 참조를 문서에서 떼어낸다.
 *
 * **정본 셋과 달리 던지지 않는다** (open-decisions.md "본체 없는 첨부는 저장을 막지 않고
 * 참조를 떼어낸다"). 정본이 없으면 프로젝트가 성립하지 않지만 첨부는 여럿 중 하나이고,
 * 던지면 **이미 사진을 잃은 프로젝트가 저장도 내보내기도 못 하게 된다** - 사진 한 장을
 * 잃은 것보다 나쁘다. detachMissingModels가 담지 못한 모델에 하는 일과 같은 손잡이다.
 *
 * 사유는 안 적는다. modelOmitted가 사유를 갖는 이유는 화면이 "다시 학습하세요"와 "다시
 * 학습해도 소용없습니다"를 갈라 말해야 하기 때문인데 (mlpx-spec.md 4.2), 없어진 사진에
 * 대해 학생이 할 수 있는 일은 없다.
 *
 * **정상 경로로는 아무것도 안 뗀다.** 여기가 무언가를 떼면 그건 우리 버그의 자국이다.
 */
export function detachMissingAttachments(
  document: ProjectDocument,
  present: ReadonlyMap<string, Uint8Array>,
): ProjectDocument {
  const attachments: Record<string, string[]> = {}
  let missing = false
  for (const [sectionId, paths] of Object.entries(document.portfolio.attachments)) {
    const kept = paths.filter((path) => present.has(path))
    if (kept.length !== paths.length) missing = true
    // 마지막 한 장이 없어지면 그 문항의 자리도 없앤다 (withAttachmentRemoved와 같다).
    if (kept.length > 0) attachments[sectionId] = kept
  }
  if (!missing) return document
  return { ...document, portfolio: { ...document.portfolio, attachments } }
}

/**
 * 크기 예산에 맞춰 담을 모델을 고른다 (mlpx-spec.md 5.1).
 *
 * 최신 실험부터 채운다. 계수 몇 개짜리 모델은 여러 회차가 남고, 랜덤 포레스트는
 * 최근 것만 남는다. 그래서 학생은 과거 버전으로도 예측을 시험할 수 있다.
 *
 * 전처리기는 그 실험 모델 전체의 전제다. 전처리기가 예산에 못 들어가면
 * 그 실험의 모델은 담아 봐야 쓸 수 없으므로 통째로 뺀다.
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

  // 최신 실험이 먼저다.
  for (const experiment of [...document.runs.experiments].reverse()) {
    const candidates = experiment.runs
      .map((run) => run.model)
      .filter((model): model is ModelRef => model !== undefined && models.has(model.path))
    if (candidates.length === 0) continue

    const preprocessorPath = experiment.preprocessor?.path
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
  testDatasetPath: string | undefined,
  predictDatasetPath: string | undefined,
): Map<string, string> {
  const known = new Set<string>([
    ENTRY.manifest,
    ENTRY.settings,
    ENTRY.runs,
    ENTRY.portfolio,
    ENTRY.portfolioMarkdown,
  ])
  // 없는 것이 정상이다. 그러면 대조 대상에서 빠질 뿐이다 - 표를 아직 안 올렸거나
  // (datasetPath) holdout이라 평가 데이터가 파일로 없거나(testDatasetPath) 예측 데이터를
  // 아직 안 올렸다(predictDatasetPath).
  if (datasetPath !== undefined) known.add(datasetPath)
  if (testDatasetPath !== undefined) known.add(testDatasetPath)
  if (predictDatasetPath !== undefined) known.add(predictDatasetPath)

  const present = new Map<string, string>()
  for (const [path, content] of entries) {
    if (
      known.has(path) ||
      path.startsWith(DIR.model) ||
      isImageEntry(path) ||
      isAttachmentEntry(path) ||
      isEmbeddingEntry(path)
    ) {
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

/**
 * 참조와 실제 바이트가 **함께 있는지** 확인하고, 있으면 담을 것을 돌려준다.
 *
 * 한쪽만 있는 상태는 우리 버그다 (mlpx-spec.md §1). 그대로 쓰면 참조는 있는데 본체가
 * 없는 .mlpx가 나가고 **그 파일은 다시 열리지 않는다.** 저장이 실패하는 편이 낫다 -
 * 학생이 그 자리에서 알아채는 것과, 다음 차시에 열다가 아는 것은 다른 일이다.
 *
 * `dataset`(data.csv)과 `testDataset`(test.csv) 둘 다 같은 규칙이라 여기서 함께 쓴다.
 */
function referencedFileEntry(
  ref: { path: string } | undefined,
  content: Dataset | undefined,
  field: string,
): { path: string; bytes: Uint8Array; hash: string } | undefined {
  if (ref === undefined && content === undefined) {
    return undefined
  }
  if (ref === undefined || content === undefined) {
    throw new ClientError('PROJECT_FILE_INVALID', { path: field, issues: 1 })
  }
  return { path: ref.path, bytes: content.bytes, hash: content.hash }
}

/**
 * 파일 참조만 돌려준다. 폴더 참조는 `undefined`가 되어 "참조 하나 ↔ 파일 하나" 확인에서
 * 빠진다 — 그 확인이 폴더에는 뜻이 없기 때문이다.
 */
function fileRefOf(ref: { path: string } | undefined): { path: string } | undefined {
  return pointsToFile(ref) ? ref : undefined
}

/**
 * 폴더 참조와 본체가 함께 있는지 확인한다. **파일 참조의 `referencedFileEntry`와 같은 일을
 * 폴더에 대고 한다** — 참조는 있는데 사진이 하나도 없거나, 사진은 있는데 참조가 없으면
 * 저장된 파일이 다시 안 열린다.
 */
function requireFolderBodies(document: ProjectDocument, images: Map<string, Uint8Array>): void {
  const paths = [...images.keys()]
  const slots = [
    ['settings.data.dataset', document.settings.data.dataset, IMAGE_DATA_DIR],
    ['settings.data.testDataset', document.settings.data.testDataset, IMAGE_TEST_DIR],
    ['settings.data.predictDataset', document.settings.data.predictDataset, IMAGE_PREDICT_DIR],
  ] as const

  for (const [field, ref, directory] of slots) {
    const folder = ref !== undefined && !pointsToFile(ref) ? ref.path : undefined
    const has = paths.some((path) => path.startsWith(folder ?? directory))
    if ((folder !== undefined) !== has) {
      throw new ClientError('PROJECT_FILE_INVALID', { path: field, issues: 1 })
    }
  }
}

function requireSanePaths(document: ProjectDocument): void {
  const dataset = document.settings.data.dataset
  if (dataset) {
    requirePathUnder(dataset.path, DIR.dataset, 'settings.data.dataset.path')
  }
  const testDataset = document.settings.data.testDataset
  if (testDataset) {
    requirePathUnder(testDataset.path, DIR.dataset, 'settings.data.testDataset.path')
  }
  const predictDataset = document.settings.data.predictDataset
  if (predictDataset) {
    requirePathUnder(predictDataset.path, DIR.dataset, 'settings.data.predictDataset.path')
  }

  document.runs.experiments.forEach((experiment, experimentIndex) => {
    const at = `runs.experiments.${experimentIndex}`
    if (experiment.preprocessor) {
      requirePathUnder(experiment.preprocessor.path, DIR.model, `${at}.preprocessor.path`)
    }
    experiment.runs.forEach((run, runIndex) => {
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
  const datasetRef = document.settings.data.dataset
  const datasetPath = pointsToFile(datasetRef) ? datasetRef?.path : undefined
  const datasetBytes = datasetPath === undefined ? undefined : entries.get(datasetPath)
  if (datasetPath !== undefined && datasetBytes === undefined) {
    throw new ClientError('PROJECT_FILE_ENTRY_MISSING', { entry: datasetPath })
  }

  // 평가 데이터도 같은 규칙이다 - split.method가 provided인데 test.csv가 없으면
  // 재현도 재학습도 못 한다 (mlpx-spec.md §1.1).
  const testDatasetRef = document.settings.data.testDataset
  const testDatasetPath = pointsToFile(testDatasetRef) ? testDatasetRef?.path : undefined
  const testDatasetBytes = testDatasetPath === undefined ? undefined : entries.get(testDatasetPath)
  if (testDatasetPath !== undefined && testDatasetBytes === undefined) {
    throw new ClientError('PROJECT_FILE_ENTRY_MISSING', { entry: testDatasetPath })
  }

  // 예측 데이터도 같은 규칙이다 - 참조가 있는데 본체가 없으면 우리 버그다 (mlpx-spec.md §1).
  const predictDatasetRef = document.settings.data.predictDataset
  const predictDatasetPath = pointsToFile(predictDatasetRef) ? predictDatasetRef?.path : undefined
  const predictDatasetBytes =
    predictDatasetPath === undefined ? undefined : entries.get(predictDatasetPath)
  if (predictDatasetPath !== undefined && predictDatasetBytes === undefined) {
    throw new ClientError('PROJECT_FILE_ENTRY_MISSING', { entry: predictDatasetPath })
  }

  // 정본 사진을 걷는다. **문서가 한 장씩 가리키지 않는다** - 라벨이 폴더 구조에 있으므로
  // (mlpx-spec.md §1.2) 그 아래 있는 것이 곧 이 프로젝트의 사진이다.
  const images = new Map<string, Uint8Array>()
  // 임베딩은 파생물이라 **아무도 안 가리킨다.** 그래서 참조 대조가 없고, 있으면 있는
  // 대로 들인다 - 없으면 학습할 때 다시 뽑는다 (mlpx-spec.md §1.3).
  const embeddings = new Map<string, Uint8Array>()
  // 포트폴리오 첨부. **문서가 문항마다 가리킨다**(`portfolio.attachments`) - 그래도 여기서는
  // 있는 대로 들이고, 아무도 안 가리키는 것은 저장할 때 빠진다 (`keptAttachments`).
  const attachments = new Map<string, Uint8Array>()
  for (const [path, content] of entries) {
    if (isAttachmentEntry(path)) attachments.set(path, content)
    else if (isImageEntry(path)) images.set(path, content)
    else if (isEmbeddingEntry(path)) embeddings.set(path, content)
  }

  // 폴더 참조는 파일 하나를 안 가리키므로 **그 아래 한 장이라도 있는가**로 같은 것을
  // 확인한다. 참조가 있는데 사진이 하나도 없으면 위 세 자리와 같은 상태다.
  for (const ref of [datasetRef, testDatasetRef, predictDatasetRef]) {
    if (ref === undefined || pointsToFile(ref)) continue
    if (![...images.keys()].some((path) => path.startsWith(ref.path))) {
      throw new ClientError('PROJECT_FILE_ENTRY_MISSING', { entry: ref.path })
    }
  }

  // 대조는 엔트리를 버리기 **전에** 한다. 끼어든 고아 모델도 신호이기 때문이다.
  const present = hashableEntries(entries, datasetPath, testDatasetPath, predictDatasetPath)
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
      document: detachMissingAttachments(
        detachMissingModels(document, new Set(models.keys())),
        attachments,
      ),
      dataset:
        datasetPath === undefined || datasetBytes === undefined
          ? undefined
          : { bytes: datasetBytes, hash: present.get(datasetPath) ?? hashBytes(datasetBytes) },
      testDataset:
        testDatasetPath === undefined || testDatasetBytes === undefined
          ? undefined
          : {
              bytes: testDatasetBytes,
              hash: present.get(testDatasetPath) ?? hashBytes(testDatasetBytes),
            },
      predictDataset:
        predictDatasetPath === undefined || predictDatasetBytes === undefined
          ? undefined
          : {
              bytes: predictDatasetBytes,
              hash: present.get(predictDatasetPath) ?? hashBytes(predictDatasetBytes),
            },
      models,
      images,
      attachments,
      embeddings,
    },
    integrity,
  }
}

/**
 * 프로젝트를 .mlpx 바이트로 만든다.
 *
 * portfolioMarkdown을 **필수 인자로 받는다.** 렌더링에는 t()가 필요한데 포맷 계층에
 * i18n을 끌어들이면 zip 왕복 테스트마다 번역을 부팅해야 한다. 선택 인자로 두면
 * 언젠가 portfolio/document.md 없는 파일이 나가고, 그건 "파일 하나만 열면 다 본다"는
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
  // 가리키는 사진이 없는 첨부 참조도 함께 뗀다. **나가는 .mlpx는 언제나 참조와 본체가
  // 짝이다** - 아래 반복문이 반대 방향(아무도 안 가리키는 본체)만 보기 때문에, 이 줄이
  // 없으면 참조만 남은 파일이 조용히 나간다.
  const document = detachMissingAttachments(
    detachMissingModels(project.document, kept, (path) => reasons.get(path)),
    project.attachments,
  )

  const entries: Record<string, Uint8Array> = {
    [ENTRY.manifest]: encodeJson(document.manifest),
    [ENTRY.settings]: encodeJson(document.settings),
    [ENTRY.runs]: encodeJson(document.runs),
    [ENTRY.portfolio]: encodeJson(document.portfolio),
    [ENTRY.portfolioMarkdown]: new TextEncoder().encode(portfolioMarkdown),
  }
  const dataset = referencedFileEntry(
    fileRefOf(document.settings.data.dataset),
    project.dataset,
    'settings.data.dataset',
  )
  if (dataset !== undefined) {
    entries[dataset.path] = dataset.bytes
  }
  const testDataset = referencedFileEntry(
    fileRefOf(document.settings.data.testDataset),
    project.testDataset,
    'settings.data.testDataset',
  )
  if (testDataset !== undefined) {
    entries[testDataset.path] = testDataset.bytes
  }
  const predictDataset = referencedFileEntry(
    fileRefOf(document.settings.data.predictDataset),
    project.predictDataset,
    'settings.data.predictDataset',
  )
  if (predictDataset !== undefined) {
    entries[predictDataset.path] = predictDataset.bytes
  }
  for (const path of kept) {
    const content = project.models.get(path)
    if (content) entries[path] = content
  }

  // 정본 사진. **여기서는 종류를 안 본다** - 표 프로젝트는 이 맵이 비어 있다
  // (open-decisions.md "파일 계층은 '파일 참조인가'를 묻는다").
  for (const [path, content] of project.images) {
    entries[path] = content
  }
  requireFolderBodies(document, project.images)

  // 포트폴리오 첨부. **아무도 안 가리키는 것은 안 담는다** - 문항을 지우면 그 사진은
  // 아무 문항의 것도 아니고, 들고 다니면 파일이 지운 사진 수만큼 계속 자란다
  // (mlpx-spec.md §8.4). 짝 없는 임베딩을 버리는 것과 같은 자리다.
  const wanted = new Set(Object.values(document.portfolio.attachments).flat())
  for (const [path, content] of project.attachments) {
    if (wanted.has(path)) entries[path] = content
  }

  // **짝 없는 임베딩은 버린다.** 사진을 지우면 그 임베딩은 아무 사진의 것도 아니고,
  // 들고 다니면 파일이 지운 사진 수만큼 계속 자란다 (mlpx-spec.md §1.3).
  const photoHashes = new Set([...project.images.keys()].map(hashOfEntry))
  for (const [path, content] of project.embeddings) {
    if (photoHashes.has(hashOfEntry(path))) entries[path] = content
  }

  // 마지막에 만든다. 자기 자신은 대상이 아니므로 다른 엔트리가 전부 정해진 뒤여야 한다.
  const hashes = buildHashes(
    entries,
    [dataset, testDataset, predictDataset].filter((entry) => entry !== undefined),
  )
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
