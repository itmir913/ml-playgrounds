/**
 * 바이트 묶음의 객체 URL을 들고 있다가 **제때 놓아준다.**
 *
 * **`useThumbnails`가 이 파일에서 나왔다** (2026-09-18). 그 머리말이 *"다섯 화면이 같은
 * 모양을 각자 들고 있었다"*라고 적어 두었는데, **여섯째가 이미 있었다** — 포트폴리오
 * 화면의 첨부 사진 지도가 줄 단위로 같은 코드였고 키만 해시 대신 경로였다. 점검 화면이
 * 일곱째가 될 뻔했고, 그때 이것이 **빠진 원시 연산**임이 드러났다.
 *
 * **놓아주는 시점이 이 파일의 전부다.** 만드는 것은 한 줄이고, 언제 놓느냐가 어렵다 —
 * 빠뜨리면 그 바이트가 탭이 닫힐 때까지 남고, 저사양 교실 PC가 기준 기기다.
 */

import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** URL 하나를 만들 수 있는 최소한. `key`가 그 URL의 이름이 된다. */
export interface ObjectUrlSource {
  readonly key: string
  readonly bytes: Uint8Array
  /** 모르면 안 준다 — 첨부는 무엇이든 올 수 있고, 브라우저가 알아서 읽는다. */
  readonly mime?: string
}

/**
 * `key -> 객체 URL`. 목록이 바뀌면 **없어진 것만** 놓아주고 새것만 만든다.
 *
 * @param entries 지금 보여줄 것들. 반응형이어야 한다 — 바뀔 때 이 맵이 따라간다.
 */
export function useObjectUrls(entries: Ref<readonly ObjectUrlSource[]>): {
  urls: Ref<Map<string, string>>
} {
  const urls = ref(new Map<string, string>())

  watch(
    entries,
    (current) => {
      const alive = new Set(current.map((entry) => entry.key))
      const next = new Map<string, string>()
      for (const [key, url] of urls.value) {
        // 살아 있으면 그대로 쓴다 — 다시 만들면 `<img>`가 깜빡인다.
        if (alive.has(key)) next.set(key, url)
        else URL.revokeObjectURL(url)
      }
      for (const entry of current) {
        if (next.has(entry.key)) continue
        // `Uint8Array`의 버퍼가 `SharedArrayBuffer`일 수도 있다고 보는 자리라 단언한다
        // (`project/download.ts`가 같은 이유로 같은 모양이다).
        const blob = new Blob(
          [entry.bytes as unknown as BlobPart],
          entry.mime === undefined ? undefined : { type: entry.mime },
        )
        next.set(entry.key, URL.createObjectURL(blob))
      }
      urls.value = next
    },
    { immediate: true },
  )

  onBeforeUnmount(() => {
    for (const url of urls.value.values()) URL.revokeObjectURL(url)
    urls.value = new Map()
  })

  return { urls }
}
