/**
 * 브라우저에 파일을 내려보내고 받아 오는 자리. **여기만 DOM을 만진다.**
 *
 * 나머지 포맷 계층은 전부 순수 함수라 테스트가 쉬운데, 다운로드만은 그럴 수 없다 —
 * `<a download>`를 만들어 누르는 것 말고 방법이 없다. 그 지저분함을 한 파일에 가둔다.
 *
 * 서버가 없으므로 **이것이 학생의 유일한 반출 경로다** (CLAUDE.md §1.1). 컴퓨터실 PC는
 * 전원을 끄면 디스크가 되돌아가므로, 차시를 넘기는 것은 여기서 나가는 파일뿐이다.
 */

import { ClientError, failureDetail } from '@/errors'

/**
 * 만들어진 파일을 내려보낸다.
 *
 * **`Uint8Array`를 안 받는다.** 예전에는 완성된 배열을 받아 여기서 `Blob`으로 다시
 * 쌌고, 그래서 peak가 프로젝트 크기의 2~3배였다 — 원본 + zip 결과 + 사본.
 * **지금은 `format.ts`가 청크를 흘려 `Blob`으로 담아 준다**(`zipToBlob`) —
 * `Blob`은 브라우저가 관리해서 디스크로 내려갈 수 있고, `Uint8Array`는 자바스크립트
 * 힙에 그대로 앉는다.
 *
 * **내보내기 실패는 회복 가능한 실패가 아니라 프로젝트의 죽음이다** — 서버가 없어
 * 브라우저 밖으로 못 나간 것은 제출을 못 한다 (CLAUDE.md §1.1·§1.3).
 * 근거와 남은 것(`showSaveFilePicker`는 점진적 향상으로만)은 open-decisions.md
 * "상한은 누가 정했느냐로 갈리고, 우리 기기가 정한 것은 끌 수 있다"의 4절에 있다.
 *
 * **여기 있던 "복사하지 않으므로 50MB에도 싸다"는 검증된 적 없는 낙관이었다**
 * (2026-08-19에 지웠다). 그 50MB도 §1.1이 없앤 서버 업로드 상한의 잔재다.
 */
export function downloadBlob(blob: Blob, fileName: string): void {
  releaseLastUrl()
  // 첫 내려받기에서 건다 — 모듈을 읽을 때 걸면 DOM 없는 곳에서 읽힐 때 가드가 필요하다.
  if (!listening) {
    window.addEventListener('pagehide', releaseLastUrl)
    listening = true
  }
  const url = URL.createObjectURL(blob)
  lastUrl = url
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  // 문서에 붙인 채 누른다 — 떨어진 앵커의 `click()`을 무시하던 브라우저가 있었다.
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
}

/**
 * 마지막으로 내려보낸 파일의 URL. **누른 직후에 놓지 않는다** (open-decisions.md 68).
 *
 * 사파리(WebKit)는 내려받기를 `click()` 뒤에 비동기로 시작해서, 그 자리에서
 * `revokeObjectURL`하면 받을 것이 사라져 내려받기가 실패한다. 끝났다는 사건은 없고,
 * "몇 초 뒤에 놓는다"는 근거 없는 숫자다. 그래서 **다음 내려받기가 시작될 때나 페이지를
 * 떠날 때** 놓는다. 값은 파일 하나를 더 쥐는 것이다 — `Blob`이라 브라우저가 디스크로
 * 내릴 수 있다. 무는 검사: `tests/download.spec.ts`.
 */
let lastUrl: string | null = null
let listening = false

function releaseLastUrl(): void {
  if (lastUrl === null) return
  URL.revokeObjectURL(lastUrl)
  lastUrl = null
}

/**
 * 작은 것을 바로 내려보낸다. **`.mlpx`에는 쓰지 마라** — 여기서 `Blob`을 만들면
 * 그 크기만큼 사본이 하나 더 생긴다. 프로젝트 파일은 `writeProject`가 청크로 담아
 * 준 `Blob`을 위 함수에 그대로 넘긴다.
 *
 * 남아 있는 쓰임은 일괄 예측 결과 CSV 하나다. 표 하나를 글자로 편 것이라 크기가
 * 프로젝트와 자릿수가 다르고, 그 자리에서 바이트를 만드는 것이 자연스럽다.
 */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  downloadBlob(new Blob([bytes as unknown as BlobPart], { type: 'text/csv' }), fileName)
}

/**
 * 고른 파일의 바이트. **학생이 고른 파일을 읽는 문은 여기와 아래 `readFileText` 둘이다**
 * (open-decisions.md 77).
 *
 * **읽기의 거절은 `FILE_UNREADABLE`이다.** 고른 뒤 원본이 옮겨졌거나 USB가 빠지면 브라우저가
 * `NotReadableError`·`NotFoundError` 따위로 거절하는데, 전에는 그것이 `UNEXPECTED_ERROR`와 영어
 * 원문으로 떴다(2026-09-29 감사 H #13). 학생이 할 일은 "다시 시도"가 아니라 "다시 골라라"다.
 * 원문은 버리지 않고 `detail`로 싣는다. 무는 검사: `file-unreadable.spec.ts`.
 */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await readOrExplain(() => file.arrayBuffer()))
}

/** 고른 파일의 글자(UTF-8). 거절은 위 `readFileBytes`와 같은 코드다. */
export async function readFileText(file: File): Promise<string> {
  return readOrExplain(() => file.text())
}

async function readOrExplain<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read()
  } catch (error) {
    throw new ClientError('FILE_UNREADABLE', failureDetail(error))
  }
}
