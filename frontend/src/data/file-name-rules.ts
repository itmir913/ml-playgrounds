/**
 * 이름이 **운영체제의 파일·폴더 이름**이 될 때의 규칙. 범주 이름(`data/image/canonical.ts`)과
 * 내려받는 `.mlpx`의 이름(`project/format.ts`의 `projectFileName`)이 **이 한 벌을 쓴다**
 * (2026-09-28 감사 A C-2).
 *
 * **둘이 따로 들고 있었다.** 범주는 예약 장치 이름과 DEL을 막는데 파일 이름은 안 막아서,
 * 프로젝트 이름이 `CON`이면 `CON.mlpx`가 나갔다 — 윈도우에서는 만들 수조차 없는 이름이다.
 * 같은 판정을 두 곳에서 계산하면 한쪽만 고쳐진다.
 *
 * **판정은 부르는 쪽마다 다르다.** 범주는 학생이 짓는 이름이라 **거부하고**, 파일 이름은
 * 반출 경로라 **고쳐서 내보낸다** — 저장은 항상 성공해야 한다 (mlpx-spec.md §4.2).
 * 여기 있는 것은 그 둘이 공유하는 사실뿐이다.
 */

/**
 * 이름에 못 쓰는 문자. **세 운영체제가 막는 것의 합집합이다.**
 *
 * - **리눅스** — `/` 하나뿐이다.
 * - **맥** — `/`, 그리고 `:`(파인더가 옛 경로 구분자로 보아 화면에서 바꿔 보여준다).
 * - **윈도우** — 위 목록 전부와 제어문자, 끝의 마침표와 공백, 예약 장치 이름.
 *
 * **공백과 하이픈은 막지 않는다** — `산 사진`·`cat-dog`은 정상적인 이름이다.
 * 가운데 마침표도 괜찮다 — `v1.2`는 세 운영체제 어디서나 이름으로 선다.
 */
export const FORBIDDEN_IN_NAME: readonly string[] = ['/', '\\', ':', '*', '?', '"', '<', '>', '|']

/**
 * 제어문자(C0와 DEL). **윈도우가 이름에 못 쓰게 하고, 셋 어디서도 이름으로 뜻이 없다.**
 * 붙여넣기로 섞여 들어오는 것이라 **학생이 눈으로 못 본다.**
 */
export const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/**
 * 눈에 안 보이는데 이름을 바꾸는 문자 — C1 제어문자와 양방향(bidi) 서식 문자.
 *
 * **파일 이름에서만 걷는다.** 범주 쪽 판정은 이것으로 넓히지 않았다 — 이미 저장된 범주가
 * 다음 배포에서 "못 쓰는 이름"이 되면 학생이 자기 사진을 못 연다. 파일 이름은 매번 새로
 * 만드는 것이라 걷어도 잃는 것이 없다. `U+202E`(오른쪽에서 왼쪽으로)가 든 이름은 탐색기에서
 * 글자 순서가 뒤집혀 보여, 확장자를 속이는 이름이 된다.
 *
 * **소스에는 이스케이프로만 적는다.** 날것으로 적으면 이 줄 자체가 편집기에서 뒤집혀 보이는
 * Trojan Source 모양이 된다 — `source-characters.spec.ts`의 *"소스에 날것 bidi·C1 문자가 없다"*가
 * 문다. **모듈 밖에 안 내보낸다** — `/g` 정규식을 `.test()`로 쓰면 `lastIndex`가 남아 번갈아
 * 틀린다. 밖에서는 아래 `stripInvisibleFormatting`을 부른다.
 */
const INVISIBLE_FORMATTING = /[\u0080-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

/** 위 문자들을 걷는다. `replace`는 `/g` 정규식의 `lastIndex`에 기대지 않는다. */
export function stripInvisibleFormatting(text: string): string {
  return text.replace(INVISIBLE_FORMATTING, '')
}

/** 번호가 붙는 예약 장치 이름의 번호 수. `COM1`…`COM9`, `LPT1`…`LPT9`. */
const NUMBERED_DEVICE_COUNT = 9

/**
 * 윈도우 예약 장치 이름. **파일로도 폴더로도 만들 수조차 없다.**
 *
 * 확장자가 붙어도 예약이다(`CON.txt`도 안 된다). 그래서 첫 마침표 앞을 보고,
 * 대소문자는 안 가린다.
 */
const WINDOWS_RESERVED: ReadonlySet<string> = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: NUMBERED_DEVICE_COUNT }, (_unused, index) => `COM${index + 1}`),
  ...Array.from({ length: NUMBERED_DEVICE_COUNT }, (_unused, index) => `LPT${index + 1}`),
])

/** 첫 마침표 앞. 윈도우가 예약 이름인지 보는 자리다. */
function baseOf(name: string): string {
  const dot = name.indexOf('.')
  return dot < 0 ? name : name.slice(0, dot)
}

/** 윈도우 예약 장치 이름인가. 확장자가 붙어도(`nul.txt`) 예약이다. */
export function isWindowsReservedName(name: string): boolean {
  return WINDOWS_RESERVED.has(baseOf(name).toUpperCase())
}

/** 예약을 피하는 꼬리. 예약된 첫 토막 **바로 뒤에** 붙인다. */
const RESERVED_ESCAPE = '_'

/**
 * 예약 장치 이름이면 **첫 토막 뒤에** `_`를 붙인다 — `CON` → `CON_`, `nul.txt` → `nul_.txt`.
 *
 * **끝에 붙이면 안 풀린다.** `nul.txt_`의 첫 토막은 여전히 `nul`이다.
 */
export function escapeWindowsReserved(name: string): string {
  if (!isWindowsReservedName(name)) return name
  const base = baseOf(name)
  return `${base}${RESERVED_ESCAPE}${name.slice(base.length)}`
}
