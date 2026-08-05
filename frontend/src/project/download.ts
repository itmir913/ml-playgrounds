/**
 * 브라우저에 파일을 내려보내고 받아 오는 자리. **여기만 DOM을 만진다.**
 *
 * 나머지 포맷 계층은 전부 순수 함수라 테스트가 쉬운데, 다운로드만은 그럴 수 없다 —
 * `<a download>`를 만들어 누르는 것 말고 방법이 없다. 그 지저분함을 한 파일에 가둔다.
 *
 * 서버가 없으므로 **이것이 학생의 유일한 반출 경로다** (CLAUDE.md §1.1). 컴퓨터실 PC는
 * 전원을 끄면 디스크가 되돌아가므로, 차시를 넘기는 것은 여기서 나가는 파일뿐이다.
 */

/** 바이트를 파일로 내려보낸다. */
export function downloadBytes(bytes: Uint8Array, fileName: string): void {
  // Blob은 ArrayBuffer 조각을 그대로 받는다. 복사하지 않으므로 50MB에도 싸다.
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  // 놓아주지 않으면 파일 크기만큼 메모리가 탭이 닫힐 때까지 남는다.
  URL.revokeObjectURL(url)
}

/** 고른 파일의 바이트. */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer())
}
