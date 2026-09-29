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

import { unzipSync, Zip, ZipPassThrough, type Unzipped, type UnzipFileFilter } from 'fflate'

import {
  CONTROL_CHARACTERS,
  escapeWindowsReserved,
  FORBIDDEN_IN_NAME,
  stripInvisibleFormatting,
} from '../data/file-name-rules'
import { isNoiseName, normalizeEntryName } from '../data/archive-entries'
import { decodeZipNames } from '../data/zip-names'
import { ClientError } from '../errors'
import { hashBytes } from '../hash'
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_FILE_NAME_BYTES,
  MAX_FILE_NAME_LENGTH,
  MAX_MODEL_BYTES,
  MODEL_BUDGET_BYTES,
} from '../limits'
import { BACKBONES, backboneFor } from '../ml/backbones'
import { escapesArchive, standsAsFolder } from './entry-path'
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

/**
 * 내보내는 `Blob`에 적는 종류.
 *
 * **`application/zip`이 아니다.** 실체는 zip이라 그쪽이 더 정확한데, **iOS 사파리는
 * 종류가 말하는 확장자를 이름에 덧붙인다** — `비올까.mlpx`가 `비올까.mlpx.zip`으로
 * 저장됐다(아이패드 iOS 18.7·아이폰, 2026-09-23 실측). 그 이름이 다시 파일 앱의
 * 압축 해제를 부르면 **제출물이 폴더로 흩어진다.**
 *
 * **바꾼 뒤 아이패드에서 재니 `.zip`이 안 붙고 `비올까.mlpx`로 저장된다**
 * (iOS 18.7, 2026-09-23). **사람 확인이다** — 검사는 브라우저의 저장 동작을 못 본다.
 * 그래도 **붙은 이름은 계속 받는다**(`isProjectFileName`) — 이미 기기에 저장된 파일은
 * 이름이 안 바뀐다. 결정문은 `open-decisions.md` 48.
 */
export const MLPX_MIME = 'application/octet-stream'

/**
 * 사파리가 덧붙이는 꼬리. `비올까.mlpx` → `비올까.mlpx.zip` (결정문 48).
 *
 * **관용의 범위는 이것 하나다.** 맨 `.zip`을 받으면 아무 압축 파일이나 들어오고,
 * 교사가 폴더째 놓을 때 학생이 올린 사진 묶음까지 프로젝트 목록에 뜬다.
 */
const SAFARI_SUFFIX = `${MLPX_EXTENSION}.zip`

/**
 * 파일 고르기 대화상자에 주는 목록.
 *
 * **판정과 같은 자리에서 나와야 한다.** 갈리면 **열 수는 있는데 고를 수 없는 파일**이
 * 생긴다 — 교사의 데스크톱에서는 대화상자가 정말로 걸러 낸다. 거울상(고를 수는 있는데
 * 안 열리는 파일)은 `rule-coverage.md`에 이미 적혀 있다. `tests/mlpx-name.spec.ts`가
 * 이 둘이 갈리는 것을 막는다.
 */
export const MLPX_ACCEPT = `${MLPX_EXTENSION},${SAFARI_SUFFIX}`

/** 이 이름이 프로젝트 파일인가. 대소문자는 안 본다 — 리눅스에서 `.MLPX`가 만들어진다. */
export function isProjectFileName(name: string): boolean {
  const lowered = name.toLowerCase()
  return lowered.endsWith(MLPX_EXTENSION) || lowered.endsWith(SAFARI_SUFFIX)
}

/**
 * 확장자를 제거한 이름. `비올까.mlpx`와 `비올까.mlpx.zip`이 **같은 것을 준다.**
 *
 * 프로젝트 파일이 아닌 이름은 그대로 돌려준다 — 여기서 거르지 않는다.
 */
export function withoutProjectExtension(name: string): string {
  if (!isProjectFileName(name)) return name
  const tail = name.toLowerCase().endsWith(SAFARI_SUFFIX) ? SAFARI_SUFFIX : MLPX_EXTENSION
  return name.slice(0, -tail.length)
}

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
 * 테스트 데이터의 정본 경로 (mlpx-spec.md §1.1).
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
   * 테스트 데이터. `split.method`가 `provided`일 때만 있다.
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
   * **훈련용 정본과 섞이지 않는다.** 저쪽은 백본이 먹는 정사각형이고 이쪽은 사람이 보는
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
 * 이 임베딩이 어느 백본의 것인가. **경로 한 겹이 답이다** (mlpx-spec.md §1.3 규칙 2).
 *
 * `embeddings/{백본id}/{해시}.bin`에서 가운데 한 겹만 떼어 온다. 겹이 모자란 경로는
 * 우리가 만든 것이 아니므로 `null`이고, 부르는 쪽에서 보면 "모르는 백본"과 같다.
 */
function backboneOfEmbedding(path: string): string | null {
  const rest = path.slice(DIR.embeddings.length)
  const slash = rest.indexOf('/')
  return slash <= 0 ? null : rest.slice(0, slash)
}

/**
 * 등록부에 없는 백본의 임베딩을 떨어뜨린다 (mlpx-spec.md §1.3 규칙 2).
 *
 * **백본을 개정하면(`-rN`) 옛 좌표계의 벡터는 다시 뽑힐 것들이다.** 아무도 안 읽는데
 * (`readEmbeddings`가 새 경로만 본다) 자리는 그대로 차지한다 — 장당 5KB이고 사진 상한을
 * 채운 프로젝트면 25MB다.
 *
 * **파일과 브라우저 저장소 양쪽에서 부른다.** 파일에서만 떨어뜨리면 IndexedDB에는 새
 * 벡터와 옛 벡터가 나란히 남아 저장마다 그것까지 다시 쓰고(쿼터를 먹는다), 사진 굽기 전 여유
 * 검사(`totalBytes`)가 그것까지 세어서 **학생이 사진을 더 못 올리게 된다.**
 */
export function dropUnknownBackbones(
  embeddings: ReadonlyMap<string, Uint8Array>,
): Map<string, Uint8Array> {
  const kept = new Map<string, Uint8Array>()
  for (const [path, content] of embeddings) {
    const backboneId = backboneOfEmbedding(path)
    if (backboneId !== null && backboneFor(backboneId) !== undefined) kept.set(path, content)
  }
  return kept
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

/**
 * 폴더 참조 아래에 **사진이 한 장이라도 있는가.** 파일 참조의 "본체가 있는가"와 같은 질문이다.
 *
 * **어느 맵을 넘기느냐가 판정이다.** 거른 뒤의 맵(`insideArchive`)이면 사진이 전부
 * `dataset/data/../…`인 폴더는 0장이고, 거르기 전의 맵이면 본체 있는 것이다. `readProject`의 거절과
 * `storage.ts`의 떼기 판정은 거른 뒤로, `loadProject`의 짝 확인은 거르기 전으로 부른다(검토 B-3 —
 * 실험이 기대는 옛 레코드를 전처럼 연다).
 */
export function hasFolderBody(
  ref: { path: string },
  images: ReadonlyMap<string, Uint8Array>,
): boolean {
  for (const path of images.keys()) {
    if (path.startsWith(ref.path)) return true
  }
  return false
}

export type DropReason = 'tooLarge' | 'overBudget' | 'preprocessorMissing'

export interface DroppedModel {
  path: string
  sizeBytes: number
  reason: DropReason
}

export interface WriteResult {
  /**
   * 나갈 파일. **`Uint8Array`가 아니다** — 완성된 배열을 만들면 그 크기만큼이 자바스크립트
   * 힙에 그대로 앉고, `Blob`이 그것을 또 붙든다. `Blob`은 브라우저가 관리해서 디스크로
   * 내려갈 수 있다 (open-decisions.md "상한은 누가 정했느냐로 갈리고, 우리 기기가 정한
   * 것은 끌 수 있다" §4).
   *
   * 바이트가 필요한 검사는 `blob.arrayBuffer()`로 편다 — 그 자리에서만 전체가 메모리에
   * 올라오고, 나가는 경로는 안 그런다.
   */
  blob: Blob
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

/**
 * zip을 푼다. **`filter`를 주면 그 엔트리만 푼다.**
 *
 * zip은 엔트리마다 따로 압축되므로 고른 것만 푸는 것이 가능하고, 명렬이 그것으로 산다
 * (open-decisions.md "명렬은 메타만 읽는다"). 사진 200장이 든 제출물에서도 JSON 넷만
 * 풀면 비용이 그 넷 크기다.
 *
 * **무압축 엔트리는 그대로 읽힌다** (2026-09-18에 재서 확인했다, `tests/format.spec.ts`).
 * fflate 문서는 *"필터가 통과시킨 엔트리가 deflate가 아니면 던진다"*라고 적었는데
 * 무압축(method 0)은 예외로 복사한다 - 학생이 풀었다 탐색기로 다시 압축한 파일이 여기
 * 걸릴까 봐 확인한 것이고, 안 걸린다. 던지는 것은 LZMA 같은 다른 방식뿐이다.
 *
 * **워커를 띄우지 않는다** (open-decisions.md 68의 판례, 2026-09-28). fflate의 비동기
 * `unzip`은 비압축 512KB 이상이고 압축률이 0.8 미만인 deflate 엔트리를 `inflate()`로 넘겨
 * `blob:` 워커를 띄운다 — 0.30.4까지 내보낸 파일의 큰 `data.csv`·모델·`runs.json`이 그
 * 모양이다. 워커 생성이 막히면 날것의 오류가 새고, 워커가 답하지 않으면 **열기가 끝나지
 * 않는다.** 이 파일이 학생의 유일한 재입구라 내보내기와 같은 판단을 댄다 — 대가는 큰 옛
 * 파일에서 메인 스레드가 inflate하는 시간이다. 무는 검사: `tests/format.spec.ts`
 * "여는 길은 워커를 띄우지 않는다".
 */
function unzipEntries(bytes: Uint8Array, filter?: UnzipFileFilter): Unzipped {
  try {
    return unzipSync(bytes, filter ? { filter } : {})
  } catch {
    // zip이 아니거나 깨졌다. 어느 쪽이든 프로젝트 파일이 아니다.
    throw new ClientError('PROJECT_FILE_NOT_ZIP')
  }
}

/**
 * zip 엔트리 시각(DOS 날짜)이 담을 수 있는 해의 처음과 끝. **zip 명세가 정한 칸의 크기다** —
 * 1980년부터 7비트(0~119)라 2099년까지다.
 */
const ZIP_FIRST_YEAR = 1980
const ZIP_LAST_YEAR = 2099

/**
 * zip 엔트리에 적을 시각. **기기 시계가 담을 수 있는 해 밖이면 가장 가까운 끝으로 당긴다**
 * (2026-09-28 감사 A C-1).
 *
 * fflate는 그 밖의 시각을 받으면 **던진다** — `node_modules/fflate/esm/browser.js`의 `wzh`가
 * `if (y < 0 || y > 119) err(10)`("date not in range 1980-2099"). 배터리가 다 된 기기는 시계가
 * 1970년으로 돌아가는 일이 실재하고, 그러면 **학생의 유일한 반출 경로가 시계 하나로 막힌다.**
 * 이 시각은 아무도 안 읽는다(우리 읽기도 무결성도 보지 않는다). 무는 검사: `format.spec.ts`의
 * *"기기 시계가 zip이 담을 수 없는 해여도 내보낸다"*.
 */
export function zipModifiedTime(now: Date = new Date()): Date {
  const year = now.getFullYear()
  if (year < ZIP_FIRST_YEAR) return new Date(ZIP_FIRST_YEAR, 0, 1)
  if (year > ZIP_LAST_YEAR) return new Date(ZIP_LAST_YEAR, 0, 1)
  return now
}

/**
 * 엔트리를 zip으로 **흘려 담는다.** 완성된 `Uint8Array`를 만들지 않는다.
 *
 * **모든 엔트리를 무압축(STORE, method 0)으로 담는다** (open-decisions.md 68, 2026-09-28
 * 코드 소유자). deflate는 화면이 안 얼려면 워커에서 돌아야 하는데, fflate의 비동기
 * `deflate`는 부를 때마다 워커를 새로 띄우고 — 많이 뜨면 탭이 죽었다(#34) — `blob:`
 * 워커를 막는 환경에서는 스폰이 던지고, 워커가 죽으면 `onerror`를 안 걸어 콜백이 영영
 * 안 온다. **학생의 유일한 반출 경로가 워커에 기대면 안 된다.** 무압축이면 하는 일이
 * 메인 스레드의 CRC뿐이다. 잃는 것은 표 프로젝트의 파일 크기뿐이다. 읽는 쪽은 그대로라
 * 옛 파일의 deflate 엔트리도 열린다 (`unzipEntries`). 무는 검사: `tests/format.spec.ts`
 * "내보내기는 워커를 띄우지 않고 모든 엔트리를 무압축으로 담는다".
 *
 * **내보내기의 OOM만이 우리 몫이다** (open-decisions.md "상한은 누가 정했느냐로 갈리고,
 * 우리 기기가 정한 것은 끌 수 있다" §4). 탭이 죽으면 회복이 없고, 서버가 없어 이 파일이
 * 학생의 유일한 반출 경로다.
 *
 * 예전에는 `zip()`이 전체를 담은 배열 하나를 만들어 주고 `Blob`이 그것을 또 붙들었다.
 * 지금은 청크가 나오는 대로 모아 `new Blob(parts)`로 넘긴다 — **`Blob`은 브라우저가
 * 관리해서 디스크로 내려갈 수 있고, `Uint8Array`는 자바스크립트 힙에 그대로 남는다.**
 *
 * **입력 스트리밍은 여기서 안 한다.** 그건 `ProjectFile` 모양 자체의 재설계라 같은
 * 결정문이 범위 밖으로 두었다. `showSaveFilePicker`도 마찬가지로 점진적 향상이다 —
 * 파이어폭스·사파리·iOS에 없고, `http://192.168.x.x`로 띄운 자가호스팅 학교에서는
 * 보안 컨텍스트가 아니라 아예 없다.
 */
async function zipToBlob(entries: Record<string, Uint8Array>): Promise<Blob> {
  const mtime = zipModifiedTime()
  return new Promise((resolve, reject) => {
    const parts: Uint8Array[] = []
    let settled = false

    const stream = new Zip((error, chunk, final) => {
      if (settled) return
      if (error) {
        settled = true
        reject(error)
        return
      }
      // **사본을 뜨지 않는다.** 무압축 엔트리의 본문은 우리가 넘긴 배열 그대로다 — 열린
      // 프로젝트가 지금 쓰는 사진·데이터셋이다. 그래도 안전한 것은 아래 반복문의 `push`부터
      // `end()`·`new Blob`까지가 **한 동기 구간**이라 그 사이에 원본이 바뀔 틈이 없고
      // (`ZipPassThrough.process`가 `ondata`를 바로 부른다, `node_modules/fflate/esm/browser.js`),
      // `Blob`이 만들어질 때 바이트를 복사하기 때문이다. 여기서 또 뜨면 최고 메모리가
      // 프로젝트 한 벌만큼 는다. 무는 검사: `tests/format.spec.ts` "내보낸 뒤 원본을
      // 고쳐도 나간 파일은 그대로다".
      parts.push(chunk)
      if (final) {
        // **`Blob`을 먼저 만들고 나서 끝났다고 적는다** (2026-09-29 감사 H A-3). 순서가 반대면
        // `new Blob`이 던질 때(메모리) 그 예외가 `stream.end()`를 거쳐 아래 `catch`에 닿아도
        // `settled`가 이미 참이라 삼켜지고, **약속이 영영 안 풀려 [내보내기]가 끝없이 돈다.**
        // 이 순서면 아래 `catch`가 거절로 끝내고 `ExportButton`이 알린다. 무는 검사:
        // `export-button.spec.ts`의 *"파일을 담다 던지면 알리고 끝난다"*.
        const blob = new Blob(parts as unknown as BlobPart[], { type: MLPX_MIME })
        settled = true
        resolve(blob)
      }
    })

    try {
      for (const [path, bytes] of Object.entries(entries)) {
        const file = new ZipPassThrough(path)
        file.mtime = mtime
        stream.add(file)
        file.push(bytes, true)
      }
      stream.end()
    } catch (error) {
      if (!settled) {
        settled = true
        reject(error)
      }
    }
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
  /**
   * **쌓아서 한 번에 만든다** (2026-09-23 R37-V, A-2의 이웃). `attachments[sectionId] = kept`는
   * id가 `__proto__`일 때 **own 속성을 안 만들고 프로토타입을 바꾼다** — 그러면 그 문항의
   * 사진이 **나가는 `.mlpx`에서 조용히 사라진다.** `Object.fromEntries`는 언제나 own이다.
   */
  const entries: [string, string[]][] = []
  let missing = false
  for (const [sectionId, paths] of Object.entries(document.portfolio.attachments)) {
    const kept = paths.filter((path) => present.has(path))
    if (kept.length !== paths.length) missing = true
    // 마지막 한 장이 없어지면 그 문항의 자리도 없앤다 (withAttachmentRemoved와 같다).
    if (kept.length > 0) entries.push([sectionId, kept])
  }
  const attachments = Object.fromEntries(entries)
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
  // (datasetPath) holdout이라 테스트 데이터가 파일로 없거나(testDatasetPath) 예측 데이터를
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
  if (!inside || escapesArchive(path)) {
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
 * **압축 프로그램이 인코딩을 안 적었으면 엔트리 이름을 되살린다** (`data/zip-names.ts`).
 *
 * 근거는 `open-decisions.md` "압축 파일의 폴더 이름은 UTF-8이 아닐 수 있다"이고, 여기는
 * 그 결정문이 "그때 부르는 자리만 늘면 된다"고 적어 둔 그 자리다.
 *
 * **우리가 쓴 `.mlpx`는 멀쩡하다** — `fflate`가 UTF-8 플래그를 세운다. 깨지는 것은
 * **교사가 압축을 풀어 들여다보고 탐색기로 다시 압축한 파일**이고, 그건 `mlpx-spec.md`
 * §7.2가 약속한 "도구 없이 여는 길"을 실제로 걸어 본 사람에게 일어난다.
 *
 * **정답표를 파일이 들고 있다.** `hashes.json`에 적힌 경로가 원래 이름이고, 그 이름은
 * ASCII 경로에 담겨 있어 인코딩과 무관하게 읽힌다. 그래서 **추측이 0이다** — 언어도
 * 데이터 종류도 안 묻는다.
 *
 * **무결성이 무뎌지지 않는다.** 되살리는 것은 **이름뿐**이고 내용 해시는 그대로 대조된다.
 * 이름이 기록과 맞아떨어지지 않으면 아무 후보도 안 뽑히므로, 진짜로 손을 탄 파일은
 * 지금처럼 `MODIFIED`로 나온다. 오히려 지금은 **이름만 깨진 멀쩡한 파일이 사진 수만큼
 * `REMOVED`+`ADDED`로 떠서** 변조로 보인다.
 *
 * **이름의 모양도 여기서 맞춘다** (mlpx-spec.md §10). 구분자 `\`는 `/`로 읽고(Windows
 * PowerShell 5.1의 `Compress-Archive`가 그렇게 적는다), 글자는 NFC로 모은다(맥이 NFD로
 * 넣는다) — 사진 업로드와 한 벌인 `normalizeEntryName`(`data/archive-entries.ts`)이다. 기록된
 * 표기로 되돌리는 것은 `respellAsRecorded`의 일이다. 무는 검사: `tests/format.spec.ts`
 * "다시 압축한 파일".
 *
 * **증거에 조각도 넣는다.** 한 겹 감싼 압축 파일(`비올까/dataset/data/개/…`)에서는 온전한
 * 경로가 기록과 안 맞는다 — 범주 이름 `개`는 조각으로만 맞는다. 무는 검사:
 * `tests/image-format.spec.ts` "폴더째 다시 압축해도 범주가 돌아온다".
 */
function rekeyByRecordedPaths(
  raw: readonly (readonly [string, Uint8Array])[],
  recorded: ProjectHashes | null,
): readonly (readonly [string, Uint8Array])[] {
  const paths = recorded ? Object.keys(recorded.entries) : []
  /**
   * **기록된 경로와 이미 같은 이름은 되살리지 않는다** (mlpx-spec.md §10). 같다는 것이 곧 증거다.
   *
   * 되살리기는 **한 글자도 0xFF를 넘지 않는 이름**을 옛 인코딩의 바이트로 보고 다시 읽는다. 그런
   * 이름(`Größe`)을 넘기면 한글 범주가 증거로 맞은 CP949 후보가 그 이름까지 바꾼다. 한 겹 감싼
   * 파일은 첫 조각을 떼고 맞댄다. 무는 검사: `image-format.spec.ts`의 *"라틴 글자 범주가 한글
   * 범주와 함께 있어도 그대로 돌아온다"*, `mlpx-roundtrip-property.spec.ts`.
   */
  const recordedNames = new Set(paths.map((path) => path.normalize('NFC')))
  const proven = (name: string): boolean => {
    const path = normalizeEntryName(name)
    return recordedNames.has(path) || recordedNames.has(path.slice(path.indexOf('/') + 1))
  }
  const pending = raw.filter(([path]) => !proven(path))
  const decoded = decodeZipNames(
    pending.map(([path]) => path),
    { expect: paths.flatMap((path) => [path, ...path.split('/')]) },
  )
  let next = 0
  return raw.map(
    ([path, content]) =>
      [normalizeEntryName(proven(path) ? path : decoded[next++]!), content] as const,
  )
}

/**
 * 이 엔트리가 `hashes.json`인가. **루트이거나 한 겹 감싼 폴더 바로 아래다** — 되살리기와
 * 벗기기가 그것을 봐야 하는데, 벗기기는 이름을 되살린 **뒤**에 돈다.
 */
function isHashesEntry(name: string): boolean {
  const path = name.replaceAll('\\', '/')
  return (
    path === ENTRY.hashes || (path.endsWith(`/${ENTRY.hashes}`) && path.split('/').length === 2)
  )
}

/**
 * 압축 도구가 넣는 잡음인가 (mlpx-spec.md §7.2.1). **신호가 아니라서 대조 전에 버린다.**
 *
 * 탐색기·bsdtar·`Compress-Archive`·파이썬은 디렉터리 엔트리를 넣고, 맥은 `__MACOSX/`와
 * `._*`를, 폴더를 들여다본 OS는 `.DS_Store`·`Thumbs.db`·`desktop.ini`를 남긴다. 안 버리면
 * 다시 압축한 멀쩡한 파일이 "고쳐졌음"이 되고, 범주 폴더 안의 부스러기가 사진 맵에 앉아
 * 다음 내보내기까지 따라간다. 무는 검사: `tests/format.spec.ts` "다시 압축한 파일".
 *
 * **날것의 이름과 크기만 본다.** 판정이 ASCII 글자(`/`·`__MACOSX`·부스러기 이름)뿐이라
 * 이름을 되살리기 전후로 답이 같고, 그래서 메타 읽기가 엔트리를 **풀기 전에**(`filter`의
 * `originalSize`) 같은 판정을 할 수 있다. 이름의 판정은 사진 업로드와 한 벌이다
 * (`data/archive-entries.ts`의 `isNoiseName`).
 *
 * **디렉터리 엔트리는 내용이 없을 때만 잡음이다.** 사진 업로드는 길이 0인 것을 전부 버리지만
 * 여기는 그러면 안 된다 — `.mlpx`의 내용 엔트리가 0바이트로 잘린 것은 **변조의 흔적**이고,
 * 버리면 "없어짐"으로 세어져 어느 엔트리가 어떻게 바뀌었는지가 흐려진다.
 */
function isArchiveNoise(name: string, size: number): boolean {
  if (normalizeEntryName(name).endsWith('/') && size === 0) return true
  return isNoiseName(name)
}

/** 압축 파일이 적어 둔 엔트리 하나 — 날것의 이름과 풀었을 때의 크기. */
interface ListedEntry {
  readonly name: string
  readonly size: number
}

/**
 * 한 겹 감싼 압축 파일인가 (mlpx-spec.md §10). 탐색기에서 풀린 폴더를 우클릭해 압축하면
 * 이 모양이 나온다.
 *
 * **전체 읽기와 메타 읽기가 이 한 판정을 쓴다.** 둘이 따로 판정하면 루트에 `readme.txt`가
 * 섞인 zip에서 명렬은 "정상"인데 교사가 열면 거부되는 식으로 갈렸다. 날것의 목록만 보므로
 * 메타 읽기는 엔트리를 고르기 **전에**, 전체 읽기는 푼 **뒤에** 같은 답을 받는다. 무는 검사:
 * `tests/format.spec.ts` "루트에 파일이 함께 있으면 벗기지 않는다 — 두 읽기가 같은 답을 낸다".
 *
 * **판정의 중심은 하나다** — 잡음을 뺀 엔트리가 전부 한 폴더 아래에 있다. "루트에
 * `manifest.json`이 없다"는 이것이 함의하고, "그 폴더에 `manifest.json`이 있다"는 명시용이다
 * (빼도 결과가 같다 — 벗겨도 `manifest.json`이 없으니 같은 사유로 거부된다).
 */
function isWrapped(listing: readonly ListedEntry[]): boolean {
  const paths = listing
    .filter((entry) => !isArchiveNoise(entry.name, entry.size))
    .map((entry) => entry.name.replaceAll('\\', '/'))
  const roots = new Set(
    paths.map((path) => {
      const slash = path.indexOf('/')
      return slash <= 0 ? null : path.slice(0, slash + 1)
    }),
  )
  const [only] = roots
  return roots.size === 1 && !!only && paths.includes(`${only}${ENTRY.manifest}`)
}

/** 푼 엔트리의 목록. `isWrapped`가 받는 모양이다. */
function listingOf(unzipped: Unzipped): ListedEntry[] {
  return Object.entries(unzipped).map(([name, content]) => ({ name, size: content.length }))
}

/**
 * NFC로 모은 이름을 **기록된 표기**로 되돌린다.
 *
 * NFC만 하면 NFD 범주로 저장된 옛 파일(사진 업로드가 NFC로 모으기 전에 맥 zip으로 만든 것)이
 * 거꾸로 갈린다 — `settings`와 `hashes.json`은 NFD인데 경로만 NFC가 된다. 같은 글자로 적힌
 * 기록이 있으면 그 표기가 이긴다.
 */
function respellAsRecorded(
  entries: readonly (readonly [string, Uint8Array])[],
  recorded: ProjectHashes | null,
): readonly (readonly [string, Uint8Array])[] {
  if (!recorded) return entries
  const spelling = new Map(
    Object.keys(recorded.entries).map((path) => [path.normalize('NFC'), path]),
  )
  return entries.map(([path, content]) => [spelling.get(path) ?? path, content] as const)
}

/**
 * 푼 엔트리를 **우리 규칙의 이름**으로 맞춘다. 전체 읽기와 메타 읽기가 같은 이 함수를 지난다.
 *
 * 순서가 뜻을 갖는다 — 잡음 버리기 → 이름 되살리기(구분자·NFC 포함) → 한 겹 벗기기 →
 * 기록된 표기로 되돌리기. 대조(`hashableEntries`)와 사진 수집은 이 **뒤**에 돈다.
 *
 * **벗길지는 부르는 쪽이 `isWrapped`로 정해 넘긴다** — 메타 읽기는 푸는 엔트리를 고르기
 * 전에 그 답이 필요하다. 벗기는 것은 첫 조각 하나다(되살린 이름에서도 그 조각에 `/`는 없다).
 */
function entriesOf(unzipped: Unzipped, wrapped: boolean): Map<string, Uint8Array> {
  const raw = Object.entries(unzipped).filter(
    ([name, content]) => !isArchiveNoise(name, content.length),
  )
  const recorded = recordedHashes(raw.find(([path]) => isHashesEntry(path))?.[1])
  const named = rekeyByRecordedPaths(raw, recorded)
  const unwrapped = wrapped
    ? named.map(([path, content]) => [path.slice(path.indexOf('/') + 1), content] as const)
    : named
  return new Map(respellAsRecorded(unwrapped, recorded))
}

/**
 * 메타 읽기가 풀 엔트리인가. **벗길 파일이면 한 겹 아래, 아니면 루트의 문서 엔트리다** —
 * 이름을 되살리기 전의 날것을 보므로 구분자도 여기서 맞춘다(문서 엔트리 이름은 ASCII다).
 */
function isDocumentEntry(name: string, wrapped: boolean): boolean {
  const path = name.replaceAll('\\', '/')
  return DOCUMENT_ENTRIES.some((entry) =>
    wrapped
      ? path.endsWith(`/${entry}`) && path.split('/').length === entry.split('/').length + 1
      : path === entry,
  )
}

/**
 * .mlpx 바이트를 읽어 프로젝트로 만든다.
 *
 * 순서를 지켜야 한다 - 압축 해제 -> JSON 파싱 -> **버전 확인과 마이그레이션** -> 검증.
 */
/** 문서 넷이 사는 엔트리. **명렬이 푸는 것이 정확히 이것뿐이다.** */
const DOCUMENT_ENTRIES: readonly string[] = [
  ENTRY.manifest,
  ENTRY.settings,
  ENTRY.runs,
  ENTRY.portfolio,
  // 이름 되살리기가 기록된 경로를 본다 (`rekeyByRecordedPaths`).
  ENTRY.hashes,
]

/**
 * 엔트리 맵에서 **문서**를 세운다. 버전 확인과 마이그레이션이 여기서 끝난다.
 *
 * **전체 읽기와 메타 읽기가 같은 이 함수를 지난다** (open-decisions.md "명렬은 메타만
 * 읽는다"). 가벼운 판독기를 따로 두면 파서·스키마·마이그레이션이 갈린다.
 */
function documentOf(entries: ReadonlyMap<string, Uint8Array>): ProjectDocument {
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

  const document = migrateProjectDocument({
    manifest,
    settings: decodeJson(required(ENTRY.settings), ENTRY.settings),
    runs: decodeJson(required(ENTRY.runs), ENTRY.runs),
    portfolio: decodeJson(required(ENTRY.portfolio), ENTRY.portfolio),
  })
  requireSanePaths(document)
  return withFolderCategories(document)
}

/**
 * 범주 목록(`settings.data.categories`)에서 **폴더 한 겹으로 못 서는 이름을 뺀다**
 * (mlpx-spec.md §10, `entry-path.ts`의 `standsAsFolder`).
 *
 * 목록은 사진이 없는 범주도 화면에 세우므로(`images.ts`의 `imageCategories`) 여기 `..`이
 * 있으면 빈 범주 칸이 서고, 학생이 사진을 그리로 옮기는 순간 `dataset/data/../…`라는 **새는
 * 경로를 우리 손으로 만든다.** 던지지 않는다 — 이름 하나 때문에 파일이 안 열릴 까닭이 없다.
 *
 * `.mlpx`를 읽을 때(`documentOf`)와 브라우저 저장소에서 열 때(`storage.ts`의 `loadProject`)
 * 둘 다 지난다. 무는 검사: `image-format.spec.ts`의 *"푸는 자리 밖으로 새는 엔트리"* 묶음.
 */
export function withFolderCategories(document: ProjectDocument): ProjectDocument {
  const { data } = document.settings
  const categories: unknown = data.categories
  if (!Array.isArray(categories)) return document
  // 스키마가 문자열 배열로 세웠다(`imageSettingsSchema`) — 문자열만 남긴다.
  const kept = categories.filter(
    (name: unknown): name is string => typeof name === 'string' && standsAsFolder(name),
  )
  if (kept.length === categories.length) return document
  return {
    ...document,
    settings: { ...document.settings, data: { ...data, categories: kept } },
  }
}

/**
 * **문서 넷만 읽는다.** 정본 표도 사진도 임베딩도 안 푼다.
 *
 * 명렬이 서른 개를 훑는 자리다 (architecture.md §8.21) — 거기서 필요한 것은 이름·학생·
 * 실험 수이고, 무결성과 재실행 대조는 교사가 고른 파일에서 한다. **해시는 사진 바이트를
 * 전부 읽어야 나오므로 여기서 하지 않는다.**
 *
 * **못 읽는 파일은 명렬에서 빼지 않는다.** 여기서 던진 사유가 그 줄의 상태가 된다 —
 * 조용히 빠지면 교사는 그 제출물이 없는 것으로 읽는다 (architecture.md §8.21).
 */
export async function readProjectMeta(bytes: Uint8Array): Promise<ProjectDocument> {
  // 먼저 목록만 훑는다 — 아무것도 안 풀므로 중앙 디렉터리를 읽는 값뿐이다. 벗길지를 전체
  // 읽기와 **같은 판정**(`isWrapped`)으로 정한 뒤에 문서 엔트리를 고른다.
  const listing: ListedEntry[] = []
  unzipEntries(bytes, (file) => {
    listing.push({ name: file.name, size: file.originalSize })
    return false
  })
  const wrapped = isWrapped(listing)
  const unzipped = unzipEntries(bytes, (file) => isDocumentEntry(file.name, wrapped))
  return documentOf(entriesOf(unzipped, wrapped))
}

export async function readProject(bytes: Uint8Array): Promise<ReadResult> {
  const unzipped = unzipEntries(bytes)
  const entries = entriesOf(unzipped, isWrapped(listingOf(unzipped)))
  const document = documentOf(entries)

  // settings가 데이터셋을 가리키는데 본체가 없으면 재학습도, 참조형 모델의 예측도,
  // 해시 재계산도 전부 불가능하다. 아예 안 가리키는 것은 다르다 - 표를 아직 안 올린
  // 정상적인 파일이다 (mlpx-spec.md §1).
  const datasetRef = document.settings.data.dataset
  const datasetPath = pointsToFile(datasetRef) ? datasetRef?.path : undefined
  const datasetBytes = datasetPath === undefined ? undefined : entries.get(datasetPath)
  if (datasetPath !== undefined && datasetBytes === undefined) {
    throw new ClientError('PROJECT_FILE_ENTRY_MISSING', { entry: datasetPath })
  }

  // 테스트 데이터도 같은 규칙이다 - split.method가 provided인데 test.csv가 없으면
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
  // 있는 대로 들이고, 아무도 안 가리키는 것은 `.mlpx`로 쓸 때 빠진다 (`writeProject`).
  const attachments = new Map<string, Uint8Array>()
  for (const [path, content] of entries) {
    if (isAttachmentEntry(path)) attachments.set(path, content)
    else if (isImageEntry(path)) images.set(path, content)
    else if (isEmbeddingEntry(path)) embeddings.set(path, content)
  }

  // 대조는 잡음(mlpx-spec.md §7.2.1)을 뺀 뒤, **우리가 버릴 것을 버리기 전에** 한다. 끼어든
  // 고아 모델도 신호이기 때문이다.
  const present = hashableEntries(entries, datasetPath, testDatasetPath, predictDatasetPath)
  const integrity = checkHashes(present, recordedHashes(entries.get(ENTRY.hashes)))

  // **푸는 자리 밖으로 새는 이름은 여기서 버린다 — 대조 뒤다** (mlpx-spec.md §7.2.1). 대조에는
  // 남아 "더해짐"으로 신호가 되고, 사진·첨부·임베딩으로는 안 들어간다. 문서가 가리키던 첨부는
  // 아래 `detachMissingAttachments`가 뗀다.
  const keptImages = insideArchive(images)
  const keptAttachments = insideArchive(attachments)
  const keptEmbeddings = insideArchive(embeddings)

  // 폴더 참조는 파일 하나를 안 가리키므로 **그 아래 한 장이라도 있는가**로 같은 것을
  // 확인한다. 참조가 있는데 사진이 하나도 없으면 위 세 자리와 같은 상태다.
  //
  // **거른 뒤의 사진으로 본다** (open-decisions.md "본체 없는 폴더 참조는 기대는 실험이 없을 때만
  // 떼고 연다"). 거르기 전의 맵으로 보던 때는 사진이 전부 `dataset/data/../…`인 파일이 확인을
  // 지나고, 거른 뒤에는 0장이라 **열리는데 내보내기가 거부됐다**(감사 G 처방 5). `.mlpx`에는
  // 떼는 예외가 없다 — 떼는 곳은 브라우저 저장소에서 여는 자리(`storage.ts`의 `loadProject`)다.
  // 무는 검사: `image-format.spec.ts`의 *"사진이 전부 새는 이름뿐이면 본체 없는 참조로 거절한다"*.
  for (const ref of [datasetRef, testDatasetRef, predictDatasetRef]) {
    if (ref === undefined || pointsToFile(ref)) continue
    if (!hasFolderBody(ref, keptImages)) {
      throw new ClientError('PROJECT_FILE_ENTRY_MISSING', { entry: ref.path })
    }
  }

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
        keptAttachments,
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
      images: keptImages,
      attachments: keptAttachments,
      /**
       * **여는 자리에서도 떨어뜨린다** (R6 감사 B-2). 여기를 안 걸러 두면 `openFile`이
       * 곧장 `saveProject`로 넘겨 **옛 좌표계의 벡터가 브라우저 저장소에 눌러앉는다** —
       * 아무도 안 읽는데 `totalBytes`는 세므로, 사진 상한을 채운 프로젝트면 25MB가
       * 쿼터를 먹고 **다른 프로젝트의 저장까지 막는다**(쿼터는 오리진 공용이다).
       *
       * **무결성 대조 뒤다.** 위 `checkHashes`는 zip에 있던 그대로를 봐야 한다 —
       * 우리가 버릴 것을 먼저 버리면 파일이 변조됐는지 판정할 근거가 사라진다.
       */
      embeddings: dropUnknownBackbones(keptEmbeddings),
    },
    integrity,
  }
}

/**
 * **푸는 자리 밖으로 새는 이름을 뺀 맵** (`entry-path.ts`의 `escapesArchive`, mlpx-spec.md
 * §7.2.1). 던지지 않는다 — 학생의 작업물이 이름 하나 때문에 안 열리거나 안 나가면 안 된다.
 *
 * 부르는 자리가 셋이다 — `.mlpx`를 읽을 때(대조 **뒤**), 브라우저 저장소에서 열 때
 * (`storage.ts`의 `loadProject` — 이 거르기가 생기기 전에 저장된 것), `.mlpx`로 쓸 때
 * (`writeProject` — 위 둘을 지나지 않은 맵이 와도 새는 이름이 나가지 않는다).
 * 무는 검사: `image-format.spec.ts`의 *"푸는 자리 밖으로 새는 엔트리"* 묶음.
 */
export function insideArchive<V>(entries: ReadonlyMap<string, V>): Map<string, V> {
  return new Map([...entries].filter(([path]) => !escapesArchive(path)))
}

/**
 * `.mlpx`에 싣기로 고른 것. **쓰는 쪽(`writeProject`)과 세는 쪽(`archiveEntryCount`)이 이 한
 * 벌을 지난다** — 둘이 따로 고르면 세는 수가 실제로 쓰이는 수와 갈려, 입구가 될 것을 막거나
 * 넘을 것을 들인다. 무는 검사: `archive-entry-limit.spec.ts`의 *"세는 함수가 쓰는 쪽과 같은
 * 수를 센다"* 묶음.
 */
interface Packing {
  readonly kept: Set<string>
  readonly dropped: DroppedModel[]
  readonly document: ProjectDocument
  /** 새는 이름을 뺀 정본 사진. */
  readonly images: Map<string, Uint8Array>
  /** 문서가 가리키는 첨부만. */
  readonly attachments: readonly (readonly [string, Uint8Array])[]
  /** 사진과 짝이 맞고 등록부에 있는 백본의 임베딩만. */
  readonly embeddings: readonly (readonly [string, Uint8Array])[]
}

function packingOf(project: ProjectFile): Packing {
  const { kept, dropped } = selectModels(project.document, project.models)
  // 담지 못한 모델의 참조는 문서에서도 뗀다. 파일과 문서가 어긋나면 안 된다.
  // **여기서는 왜 뺐는지를 안다.** 그 사유가 파일에 남아야 화면이 학생에게 무엇을 할 수
  // 있는지 말한다 - "다시 학습하세요"와 "다시 학습해도 소용없습니다"는 다른 답이다.
  const reasons = new Map(dropped.map((model) => [model.path, omissionReason(model.reason)]))
  // **푸는 자리 밖으로 새는 이름은 안 싣는다** (`insideArchive`). 읽기와 저장소가 이미
  // 거르지만, 그 둘을 안 지난 맵이 와도 여기서 나가지 않는다. 던지지 않는다 — 저장은
  // 항상 성공해야 한다(mlpx-spec.md 4.2).
  const images = insideArchive(project.images)
  const attachments = insideArchive(project.attachments)
  // 가리키는 사진이 없는 첨부 참조도 함께 뗀다. **나가는 .mlpx는 언제나 참조와 본체가
  // 짝이다** - 아래 거르기가 반대 방향(아무도 안 가리키는 본체)만 보기 때문에, 이 줄이
  // 없으면 참조만 남은 파일이 조용히 나간다.
  const document = detachMissingAttachments(
    detachMissingModels(project.document, kept, (path) => reasons.get(path)),
    attachments,
  )

  // 포트폴리오 첨부. **아무도 안 가리키는 것은 안 담는다** - 문항을 지우면 그 사진은
  // 아무 문항의 것도 아니고, 들고 다니면 파일이 지운 사진 수만큼 계속 자란다
  // (mlpx-spec.md §8.4). 짝 없는 임베딩을 버리는 것과 같은 자리다.
  const wanted = new Set(Object.values(document.portfolio.attachments).flat())

  // **짝 없는 임베딩은 버린다.** 사진을 지우면 그 임베딩은 아무 사진의 것도 아니고,
  // 들고 다니면 파일이 지운 사진 수만큼 계속 자란다 (mlpx-spec.md §1.3).
  //
  // **등록부에 없는 백본의 것도 같이 버린다.** 사진이 살아 있는 한 짝은 맞으므로 위
  // 규칙만으로는 안 걸린다 (`dropUnknownBackbones`).
  const photoHashes = new Set([...images.keys()].map(hashOfEntry))

  return {
    kept,
    dropped,
    document,
    images,
    attachments: [...attachments].filter(([path]) => wanted.has(path)),
    embeddings: [...dropUnknownBackbones(insideArchive(project.embeddings))].filter(([path]) =>
      photoHashes.has(hashOfEntry(path)),
    ),
  }
}

/**
 * 프로젝트가 무엇이든 늘 실리는 엔트리 — 문서 넷, 사람이 읽는 포트폴리오, `hashes.json`.
 * `writeProject`의 `entries` 머리와 마지막 줄이다.
 */
const ALWAYS_WRITTEN = [
  ENTRY.manifest,
  ENTRY.settings,
  ENTRY.runs,
  ENTRY.portfolio,
  ENTRY.portfolioMarkdown,
  ENTRY.hashes,
] as const

/**
 * 이 프로젝트를 **지금** `.mlpx`로 쓰면 담기는 엔트리 수. 열린 프로젝트가 없으면 0이다.
 *
 * **쓰는 쪽과 같은 고르기를 지난다**(`packingOf`) — 쓸 때 버려지는 것(짝 없는 임베딩, 아무도
 * 안 가리키는 첨부, 새는 이름, 예산에서 밀린 모델)은 세지 않는다. 세면 될 것을 막는다.
 * 표 파일은 파일 참조마다 하나다 — 본체가 없으면 쓰는 쪽이 어차피 거부한다.
 *
 * 엔트리 수 한계(`MAX_ARCHIVE_ENTRIES`)를 입구가 **받기 전에** 묻는 데 쓴다 (open-decisions.md
 * ".mlpx 한 파일의 엔트리 수는 ZIP64 없이 쓸 수 있는 만큼이다"). 바이트를 만들지 않는다 —
 * 잰 값(사진 5,000장에 11ms 안팎, 개발 PC node)은 그 결정문의 경위에 있고, 지키는 검사는 없다(사람 확인).
 */
export function archiveEntryCount(project: ProjectFile | null): number {
  return archiveEntryParts(project).total
}

/** 지금 쓰면 담기는 엔트리 수와, 그중 정본 사진·임베딩의 몫. */
export interface ArchiveEntryParts {
  readonly total: number
  readonly images: number
  readonly embeddings: number
}

/**
 * `archiveEntryCount`의 항을 나눠 준다. **사진·학습 입구가 쓴다**(아래 `archiveEntriesOnceEmbedded`) —
 * 임베딩은 사진을 넣을 때가 아니라 학습·예측 때 붙으므로, 입구는 **지금 붙은 임베딩 대신 사진마다
 * 붙을 몫**으로 다시 센다(검토 B-1). 같은 고르기(`packingOf`)를 한 번만 지난다.
 */
export function archiveEntryParts(project: ProjectFile | null): ArchiveEntryParts {
  if (project === null) return { total: 0, images: 0, embeddings: 0 }
  const packed = packingOf(project)
  const data = packed.document.settings.data
  const files = [data.dataset, data.testDataset, data.predictDataset].filter(
    (ref) => fileRefOf(ref) !== undefined,
  ).length
  const models = [...packed.kept].filter((path) => project.models.get(path) !== undefined).length
  return {
    total:
      ALWAYS_WRITTEN.length +
      files +
      models +
      packed.images.size +
      packed.attachments.length +
      packed.embeddings.length,
    images: packed.images.size,
    embeddings: packed.embeddings.length,
  }
}

/** 이만큼의 엔트리가 한 `.mlpx`에 들어가는가. */
export function fitsInArchive(count: number): boolean {
  return count <= MAX_ARCHIVE_ENTRIES
}

/**
 * 사진에 **임베딩이 다 붙은 뒤**의 엔트리 수 — `incomingPhotos`장을 더 받으면. 사진 입구
 * (`images.ts`의 `requireRoomForPhotos`)와 학습 입구(`requireRoomForTraining`)가 이 한 셈을 쓴다.
 *
 * 임베딩은 사진을 넣을 때가 아니라 학습·예측 때 붙고 그 자리에는 입구가 없다. 그래서 지금 수에서
 * 사진과 붙은 임베딩을 빼고, 있는 사진과 들어올 사진을 **정본 하나와 백본마다 임베딩 하나**로 다시
 * 더한다(검토 B-1). 백본 수는 등록부가 답한다. 두 자리에 같은 사진이면 임베딩은 하나지만 둘로 센다 —
 * 보수 쪽으로 틀린다. 무는 검사: `archive-entry-limit.spec.ts`의 *"임베딩이 아직 없는 사진도 임베딩
 * 몫까지 센다"* 둘.
 */
export function archiveEntriesOnceEmbedded(
  project: ProjectFile | null,
  incomingPhotos = 0,
): number {
  const perPhoto = 1 + BACKBONES.length
  const { total, images, embeddings } = archiveEntryParts(project)
  return total - images - embeddings + (images + incomingPhotos) * perPhoto
}

/**
 * 모델 `models`개를 학습하면 이 프로젝트를 쓸 때 담기는 엔트리 수의 **위쪽 끝**. 실험 하나는 모델
 * 마다 하나와 전처리기 하나를 더한다(`attach.ts`의 `attachExperimentFiles`). 학습은 지난 실험을
 * 지우지 않는다 — 덧붙이기만 한다(`applyExperiment`).
 *
 * **덜 세지 않고 더 센다.** 쓸 때 모델 예산(`selectModels`)에서 밀리는 모델은 크기를 알아야 해서
 * 학습 전에는 모른다 — 실패한 run, 예산에서 밀리는 새 모델이나 옛 모델, 안 쓰이는 전처리기만큼
 * 실제가 작다. 사진은 임베딩이 다 붙은 뒤로 센다(`archiveEntriesOnceEmbedded`). 무는 검사:
 * `archive-entry-limit.spec.ts`의 *"실제 학습이 더한 엔트리보다 적게 세지 않는다"*.
 */
export function entriesAfterTraining(project: ProjectFile, models: number): number {
  return archiveEntriesOnceEmbedded(project) + models + 1
}

/**
 * 이대로 학습하면 `.mlpx` 한 파일에 안 들어가는가. 넘으면 **던진다** — 학습 입구가 백본을 받기
 * **전에** 부른다(`TrainView.vue`의 `startTraining`, open-decisions.md ".mlpx 한 파일의 엔트리 수는
 * ZIP64 없이 쓸 수 있는 만큼이다"의 코드 소유자 후속). 상한을 켠 채로는 닿지 않는다.
 *
 * **잠금(gate)이 아니다.** 셈이 사진 수에 비례해(개발 PC node, 사진 15,000장에 26ms 안팎 — 그 결정문의
 * 경위, 지키는 검사는 없다) 화면이 바뀔 때마다 다시 세면 안 되고, 결정문 60("잠그지 않는다, 누르면 실패를 알린다")을 따른다.
 * 무는 검사: `archive-entry-limit.spec.ts`의 *"학습은 시작하기 전에 막는다"*, `train-entry-limit.spec.ts`.
 */
export function requireRoomForTraining(project: ProjectFile, models: number): void {
  if (!fitsInArchive(entriesAfterTraining(project, models))) {
    throw new ClientError('PROJECT_FILE_TOO_MANY_ENTRIES_TO_TRAIN')
  }
}

/**
 * 이 편집을 엔트리 수 한계로 거절하는가. **넘으면서 늘리는 편집만** 거절한다 — 이미 넘은
 * 프로젝트에서 줄이는 편집까지 막으면 학생은 빠져나갈 길이 없다(포트폴리오 상한과 같은 규칙,
 * `PortfolioView.vue`의 `apply`).
 */
export function archiveGrowthRefused(before: ProjectFile, after: ProjectFile): boolean {
  const next = archiveEntryCount(after)
  return !fitsInArchive(next) && next > archiveEntryCount(before)
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
  const { kept, dropped, document, images, attachments, embeddings } = packingOf(project)

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
  for (const [path, content] of images) {
    entries[path] = content
  }
  requireFolderBodies(document, images)

  // 첨부와 임베딩은 **싣기로 고른 것만** 온다(`packingOf`) — 아무도 안 가리키는 첨부와 짝 없는
  // 임베딩은 거기서 빠졌다.
  for (const [path, content] of attachments) entries[path] = content
  for (const [path, content] of embeddings) entries[path] = content

  // **엔트리 수 한계의 마지막 그물이다** (open-decisions.md ".mlpx 한 파일의 엔트리 수는 ZIP64
  // 없이 쓸 수 있는 만큼이다"). 넘은 채로 쓰면 fflate가 엔트리 수 칸에 아래 16비트만 적어
  // **다시 열 때 사진이 말없이 사라진다.** 사진과 그 임베딩, 첨부, 학습이 더하는 모델 파일은 입구가
  // 받기 전에 막는다(`requireRoomForPhotos`·`archiveGrowthRefused`·`requireRoomForTraining`). 여기 닿는
  // 것은 입구가 생기기 전에 이미 넘은 프로젝트다. 오면 조용히 쓰지 않고 던진다. "저장은 항상 성공해야 한다"(mlpx-spec.md
  // 4.2)의 유일한 예외이고, 해시를 만들기 전이라 헛일이 없다. `+ 1`은 아래 `hashes.json`이다.
  // 무는 검사: `archive-entry-limit.spec.ts`의 *"한계를 넘는 프로젝트는 조용히 쓰지 않고 던진다"*.
  if (!fitsInArchive(Object.keys(entries).length + 1)) {
    throw new ClientError('PROJECT_FILE_TOO_MANY_ENTRIES')
  }

  // 마지막에 만든다. 자기 자신은 대상이 아니므로 다른 엔트리가 전부 정해진 뒤여야 한다.
  const hashes = buildHashes(
    entries,
    [dataset, testDataset, predictDataset].filter((entry) => entry !== undefined),
  )
  entries[ENTRY.hashes] = encodeJson(hashes)

  return { blob: await zipToBlob(entries), dropped, contentHash: hashes.contentHash }
}

/**
 * 이름 한 토막을 파일 이름에 쓸 수 있게 고친다. **거부하지 않고 걷는다** — 반출 경로라
 * 저장은 항상 성공해야 한다. 무엇을 못 쓰는지는 범주 이름과 한 벌이다
 * (`data/file-name-rules.ts`). 한글과 하이픈은 남긴다 - 1-2-03 같은 학번 체계가 실재한다.
 * 무는 검사: `format.spec.ts`의 *"projectFileName"* 묶음.
 */
function sanitizeSegment(value: string): string {
  return (
    // C1 제어문자와 양방향 서식 문자. 범주 판정에는 없는 몫이라 따로 걷는다.
    [...stripInvisibleFormatting(value)]
      .filter(
        (character) =>
          !CONTROL_CHARACTERS.test(character) && !FORBIDDEN_IN_NAME.includes(character),
      )
      .join('')
      .replace(/\s+/g, '')
      // 윈도우는 점으로 끝나는 이름을 거부한다.
      .replace(/^\.+|\.+$/g, '')
  )
}

/**
 * 사람이 한 글자로 보는 단위(자소 묶음)로 쪼갠다. **이모지 가족(ZWJ 연결)과 서로게이트 쌍을
 * 가운데서 끊지 않기 위해서다.** `Intl.Segmenter`가 없는 브라우저에서는 코드 포인트로
 * 쪼갠다 — 서로게이트 쌍은 그래도 안 깨진다.
 */
function graphemesOf(text: string): readonly string[] {
  if (typeof Intl.Segmenter !== 'function') return [...text]
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map(
    (part) => part.segment,
  )
}

/**
 * 확장자 앞 토막을 한계 안으로 자른다 — **글자 수는 `MAX_FILE_NAME_LENGTH`, 확장자까지 합친
 * UTF-8 바이트는 `MAX_FILE_NAME_BYTES`** (둘의 관계는 `limits.ts`). 자소 하나가 통째로 안
 * 들어가면 그 앞에서 멈춘다.
 */
function fitStem(stem: string): string {
  const encoder = new TextEncoder()
  const budget = MAX_FILE_NAME_BYTES - encoder.encode(MLPX_EXTENSION).length
  let kept = ''
  let bytes = 0
  let codePoints = 0
  for (const grapheme of graphemesOf(stem)) {
    const size = encoder.encode(grapheme).length
    const count = [...grapheme].length
    if (bytes + size > budget || codePoints + count > MAX_FILE_NAME_LENGTH) break
    kept += grapheme
    bytes += size
    codePoints += count
  }
  return kept
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
  const fallback = manifest.projectId.slice(0, 8)
  const joined = segments.length > 0 ? segments.join('_') : fallback
  // **예약 장치 이름을 피하고 자른 뒤, 한 번 더 피하고 자른다.** `CON`·`nul.txt`는 윈도우가
  // 파일로 만들지 못한다(`data/file-name-rules.ts`). **자른 결과가 새로 예약 이름이 될 수 있다** —
  // `CON` 뒤의 자소 하나가 결합 문자를 수십 개 달고 한계를 넘으면 그 자소째 빠져 `CON`만 남는다.
  // 둘째 피하기가 더한 `_` 한 바이트로 한계를 넘으면 둘째 자르기가 꼬리를 덜어 낸다 — 첫 토막은
  // 이미 `_`가 붙어 예약이 아니므로 꼬리를 덜어도 다시 예약이 되지 않는다. 무는 검사:
  // `format.spec.ts`의 *"자른 결과가 예약 이름이 되면 다시 피한다"*.
  const once = fitStem(escapeWindowsReserved(joined))
  const fitted = fitStem(escapeWindowsReserved(once))
  return `${fitted === '' ? fallback : fitted}${MLPX_EXTENSION}`
}
