/**
 * 정본의 규칙. **순수 함수만 있다** — 실제로 굽는 것은 워커다(`canonicalize.worker.ts`).
 *
 * 여기 있는 것이 파일에 남는 모양을 정한다 (mlpx-spec.md §1.2). 이름·경로·자리 계산이
 * 틀리면 `.mlpx`가 파이썬에서 안 열리거나(`ImageFolder` 구조가 깨진다) 같은 사진이 두
 * 장으로 남는다. 셋 다 화면에서는 안 보이는 종류의 고장이라 검사가 본다.
 */

import { canonicalFormatOfPath, type CanonicalFormat } from '@/data/image/formats'
import { MAX_CATEGORY_NAME_LENGTH } from '@/limits'
import {
  IMAGE_DATA_DIR,
  IMAGE_PREDICT_DIR,
  IMAGE_TEST_DIR,
  IMAGE_UNLABELED,
} from '@/project/format'

/** 정본을 굽는 세 자리. 표의 `data.csv`·`test.csv`·`predict.csv`와 같은 역할 이름이다. */
export const IMAGE_ROLES = ['data', 'test', 'predict'] as const

export type ImageRole = (typeof IMAGE_ROLES)[number]

const ROLE_DIR: Readonly<Record<ImageRole, string>> = {
  data: IMAGE_DATA_DIR,
  test: IMAGE_TEST_DIR,
  predict: IMAGE_PREDICT_DIR,
}

/**
 * 원본을 정본 정사각형 안에 넣을 때의 자리. `drawImage`에 그대로 넘긴다.
 *
 * **`fit`(레터박스) 하나뿐이다.** crop은 학생 사진의 주제를 잘라먹고 stretch는 비율을
 * 왜곡한다 (open-decisions.md #4). 옵션으로 만들지 않는다 — 손잡이가 하나 늘면 재현
 * 필드와 화면이 같이 는다.
 */
export interface FitBox {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/**
 * 비율을 지키며 정사각형 안에 넣고, 남는 자리는 가운데 정렬한다.
 *
 * **작은 사진은 늘린다.** 백본이 224를 요구하므로 채우지 않을 길이 없고, 여백으로
 * 채우면 주제만 작아져 더 나빠진다. 파이썬 쪽 관행도 같다(`transforms.Resize`).
 * "없는 화소를 만들어 늘리지 않는다"는 **정본과 백본의 크기가 어긋날 때**의 이야기이고
 * (open-decisions.md #4) 그건 카드를 잠가서 막는다 — 여기와 다른 자리다.
 */
export function fitBox(sourceWidth: number, sourceHeight: number, size: number): FitBox {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error(`원본 크기가 이상하다: ${sourceWidth}x${sourceHeight}`)
  }
  const scale = Math.min(size / sourceWidth, size / sourceHeight)
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  return {
    x: Math.round((size - width) / 2),
    y: Math.round((size - height) / 2),
    width,
    height,
  }
}

/**
 * 긴 변을 상한에 맞춘 크기. **여백이 없다** - 비율을 지키고 남는 자리를 만들지 않는다.
 *
 * 포트폴리오 첨부가 쓰는 규칙이다 (mlpx-spec.md §8.6.1). 정본(`fitBox`)과 갈리는 이유는
 * 저쪽이 백본이 요구하는 정사각형이기 때문이고, **여기는 사람이 보는 그림이다.**
 *
 * **작은 사진은 늘리지 않는다.** 상한이지 목표가 아니다 - 늘려 봐야 없는 화소를 지어낼
 * 뿐이고, 파일만 커진다.
 */
export function fitLongEdge(
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number,
): { width: number; height: number } {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    throw new Error(`원본 크기가 이상하다: ${sourceWidth}x${sourceHeight}`)
  }
  const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight))
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  }
}

/**
 * 범주 이름에 못 쓰는 문자. **세 운영체제가 막는 것의 합집합이다.**
 *
 * 범주 이름이 그대로 zip 엔트리 경로가 되므로, `개/고양이`라는 이름 하나가 폴더 두 겹이
 * 되어 **파일이 조용히 다른 라벨로 담긴다.** 나머지를 함께 막는 이유는 학생과 교사가
 * `.mlpx`를 **풀어 보기 때문이다** — 앱은 zip 엔트리를 직접 읽어서 무엇이든 견디지만,
 * 압축을 푼 자리에서 이름이 바뀌면 그때부터 `hashes.json`이 디스크와 안 맞는다.
 *
 * - **리눅스** — `/` 하나뿐이다.
 * - **맥** — `/`, 그리고 `:`(파인더가 옛 경로 구분자로 보아 화면에서 바꿔 보여준다).
 * - **윈도우** — 위 목록 전부와 제어문자, 끝의 마침표와 공백, 예약 장치 이름.
 *
 * **공백과 하이픈은 막지 않는다** — `산 사진`·`cat-dog`은 정상적인 이름이다.
 * 가운데 마침표도 괜찮다 — `v1.2`는 세 운영체제 어디서나 폴더 이름으로 선다.
 */
const FORBIDDEN_IN_NAME = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']

/**
 * 제어문자. **윈도우가 이름에 못 쓰게 하고, 셋 어디서도 폴더 이름으로 뜻이 없다.**
 * 붙여넣기로 섞여 들어오는 것이라 **학생이 눈으로 못 본다.**
 */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/**
 * 윈도우 예약 장치 이름. **폴더로 만들 수조차 없다.**
 *
 * 확장자가 붙어도 예약이다(`CON.txt`도 안 된다). 그래서 첫 마침표 앞을 보고,
 * 대소문자는 안 가린다.
 */
const WINDOWS_RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_unused, index) => `COM${index + 1}`),
  ...Array.from({ length: 9 }, (_unused, index) => `LPT${index + 1}`),
])

/**
 * 학생이 지을 수 있는 범주 이름인가.
 *
 * **`_`로 시작할 수 없다** — `_unlabeled`가 예약돼 있고, 예약어를 하나만 막으면 다음에
 * 예약어가 늘 때 옛 파일과 부딪힌다 (mlpx-spec.md §1.2).
 *
 * **길이도 여기서 본다.** 이름이 곧 폴더 이름이라 긴 이름은 학생이 `.mlpx`를 풀 때
 * 윈도우 경로 길이에 걸린다 (`limits.ts`의 `MAX_CATEGORY_NAME_LENGTH`).
 */
export function isValidCategoryName(name: string): boolean {
  if (name !== name.trim() || name === '') return false
  if (name.length > MAX_CATEGORY_NAME_LENGTH) return false
  if (name.startsWith('_')) return false
  if (name === '.' || name === '..') return false
  /**
   * **끝의 마침표는 윈도우가 조용히 떼어 낸다.** 실물 `.mlpx`가 그렇게 걸렸다
   * (2026-08-15) — `PC에서 또 추가함.`에 담긴 사진 48장이 압축을 푼 자리에서는
   * 마침표 없는 폴더에 앉아 **`hashes.json`의 경로와 어긋났다.** 파일도 앱도 멀쩡했다.
   * 무너진 것은 **도구 없이 대조하는 길**이다 (mlpx-spec.md §7.2).
   *
   * 끝의 공백은 위 `trim` 비교가 이미 막는다.
   */
  if (name.endsWith('.')) return false
  if (CONTROL_CHARACTERS.test(name)) return false
  if (WINDOWS_RESERVED.has(name.split('.')[0]!.toUpperCase())) return false
  return !FORBIDDEN_IN_NAME.some((character) => name.includes(character))
}

/**
 * 정본 하나의 zip 안 경로.
 *
 * **이름은 정본 바이트의 SHA-256이다** (mlpx-spec.md §1.2). 연번이 아닌 이유는 학생이
 * 사진을 지우거나 범주를 옮기는 순간 연번이 무너지기 때문이다 — 해시면 범주를 옮겨도
 * 이름이 그대로고 폴더만 바뀐다.
 *
 * `predict`에는 라벨이 없어 범주 겹이 없다.
 */
export function imageEntryPath(
  role: ImageRole,
  hash: string,
  category: string | undefined,
  format: CanonicalFormat,
): string {
  const directory = ROLE_DIR[role]
  if (role === 'predict') return `${directory}${hash}${format.extension}`
  const folder = category === undefined || category === '' ? IMAGE_UNLABELED : category
  return `${directory}${folder}/${hash}${format.extension}`
}

/**
 * 엔트리 경로에서 범주를 읽는다. **파일을 열 때 라벨이 여기서 나온다** — 매핑 테이블이
 * 없으므로 구조가 유일한 출처다.
 *
 * 우리가 쓴 모양이 아니면 `null`이다. 학생이 zip을 직접 고쳐 넣는 일은 실제로 일어나고,
 * 그때 조용히 엉뚱한 라벨을 만드는 것보다 못 읽었다고 하는 편이 낫다.
 */
export function categoryOfEntry(role: ImageRole, path: string): string | null {
  const directory = ROLE_DIR[role]
  if (!path.startsWith(directory) || canonicalFormatOfPath(path) === null) return null
  const rest = path.slice(directory.length)
  const parts = rest.split('/')
  if (role === 'predict') return parts.length === 1 ? IMAGE_UNLABELED : null
  if (parts.length !== 2) return null
  const [folder] = parts
  return folder === undefined || folder === '' ? null : folder
}
