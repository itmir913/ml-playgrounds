/**
 * **붙여넣은 사진을 받는다** (`open-decisions.md` "이미지 붙여넣기 — 놓는 것과 같은 일이다").
 *
 * **놓는 것과 같은 일이다.** 받은 파일을 화면의 **드롭이 쓰는 바로 그 함수**에 넘긴다 —
 * 여기서 새로 판정하는 것은 없다. 그래야 §8.10.4가 드롭에 대해 정한 규칙(굽는 중에
 * 데이터 화면은 받아 두고 예측 화면은 거절하며 말한다, 떠나면 안 앉는다)이 새 입구에도
 * 그대로 걸린다.
 *
 * **`navigator.clipboard.read()`가 아니라 `paste` 이벤트다.** 그쪽은 권한 창을 띄우는데,
 * 학생이 사진 한 장 붙여넣으려고 권한을 허락할 이유가 없다.
 *
 * ```ts
 * usePasteImages((files) => void readPicked(files, IMAGE_UNLABELED))
 * ```
 */

import { onBeforeUnmount, onMounted } from 'vue'

/** 클립보드에서 사진만 고른다. 글자를 붙여넣은 것은 우리에게 온 것이 아니다. */
function imagesIn(data: DataTransfer | null): readonly File[] {
  return [...(data?.files ?? [])].filter((file) => file.type.startsWith('image/'))
}

/**
 * 글자를 쓰는 자리인가. **거기서 누른 Ctrl+V는 글자 붙여넣기다.**
 *
 * 범주 이름을 바꾸는 칸과 프로젝트 이름 칸이 이 화면들 안에 있다. 거기서 사진을 받으면
 * 학생이 글자를 붙여넣으려던 것이 사진 업로드가 된다.
 */
function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * 붙여넣은 파일에 붙일 이름. **클립보드의 사진은 이름이 전부 `image.png`다.**
 *
 * 이름이 겹치면 확인 판 요약이 같은 줄만 되풀이하고, 굽기 결과를 범주로 되돌리는 맵이
 * (`views/data/ImagePanel.vue`의 `byPath`) 한 칸으로 접힌다.
 *
 * **파일에 앉는 이름은 이 값이 아니다** — 그건 정본 바이트의 해시이고
 * (`project/images.ts`의 `imageEntryPath`) 중복 판정도 거기서 한다. 그러니 이 이름이
 * 사는 곳은 **굽기 전의 확인 판 한 줄**뿐이고, 유일하기만 하면 된다.
 *
 * **해시를 여기에 쓸 수는 없다** — 해시는 워커가 구운 뒤에 나오는데 이름은 그 전에 필요하다.
 */
function named(file: File, index: number): File {
  const dot = file.name.lastIndexOf('.')
  const extension = dot > 0 ? file.name.slice(dot) : `.${file.type.slice('image/'.length)}`
  return new File([file], `pasted-${index}${extension}`, { type: file.type })
}

/**
 * 이 화면이 붙여넣기를 받게 한다. **떠나면 리스너를 뗀다.**
 *
 * @param take 받은 사진들. 화면의 드롭이 쓰는 함수를 그대로 넘긴다.
 */
export function usePasteImages(take: (files: readonly File[]) => void): void {
  /** 붙여넣은 순서. **화면이 사는 동안 안 되돌아간다** — 이름이 겹치지 않게 한다. */
  let count = 0

  function onPaste(event: ClipboardEvent): void {
    if (editable(event.target)) return

    const images = imagesIn(event.clipboardData)
    // **사진이 없으면 아무 일도 안 한다.** 글자를 붙여넣은 것을 거절이라고 말하면,
    // 학생은 하지도 않은 일을 실패로 읽는다 (§8.10.4의 "거절할 때는 말한다"는 **받을
    // 수 있는 것을 안 받을 때**의 규칙이다).
    if (images.length === 0) return

    // 우리가 처리했으므로 브라우저의 기본 동작을 막는다.
    event.preventDefault()
    take(
      images.map((file) => {
        count += 1
        return named(file, count)
      }),
    )
  }

  // **`window`에 건다.** 판 안에 걸면 학생이 판을 눌러 초점을 준 뒤에야 붙여넣기가 오고,
  // 그건 사진을 붙여넣으려는 사람이 배워야 할 이유가 없는 규칙이다.
  onMounted(() => window.addEventListener('paste', onPaste))
  onBeforeUnmount(() => window.removeEventListener('paste', onPaste))
}
