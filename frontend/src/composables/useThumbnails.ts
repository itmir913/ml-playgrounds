/**
 * 사진 썸네일의 객체 URL을 들고 있다가 **제때 놓아준다.**
 *
 * **다섯 화면이 같은 모양을 각자 들고 있었다** (V11 R5 C-2) — 맵을 만들고, 바뀌면 옛
 * URL을 놓아주고, 언마운트에서 전부 놓아준다. 여섯 번째가 생길 때 놓아주기를 빠뜨리면
 * 그 사진의 바이트가 탭이 닫힐 때까지 남는다 — 저사양 교실 PC가 기준 기기다.
 *
 * **놓아주는 시점이 이 파일의 전부다.** 만드는 것은 한 줄이고, 언제 놓느냐가 어렵다.
 */

import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** 썸네일을 만들 수 있는 최소한. `project/images.ts`의 `ImageEntry`가 이 모양이다. */
export interface Thumbnailable {
  readonly hash: string
  readonly bytes: Uint8Array
  readonly format: { readonly mime: string }
}

/**
 * `해시 -> 객체 URL`. 목록이 바뀌면 없어진 것만 놓아주고 새것만 만든다.
 *
 * @param entries 지금 보여줄 사진들. 반응형이어야 한다 — 바뀔 때 이 맵이 따라간다.
 */
export function useThumbnails(entries: Ref<readonly Thumbnailable[]>) {
  const urls = ref(new Map<string, string>())

  watch(
    entries,
    (current) => {
      const alive = new Set(current.map((entry) => entry.hash))
      const next = new Map<string, string>()
      for (const [hash, url] of urls.value) {
        // 살아 있으면 그대로 쓴다 — 다시 만들면 `<img>`가 깜빡인다.
        if (alive.has(hash)) next.set(hash, url)
        else URL.revokeObjectURL(url)
      }
      for (const entry of current) {
        if (next.has(entry.hash)) continue
        // `Uint8Array`의 버퍼가 `SharedArrayBuffer`일 수도 있다고 보는 자리라 단언한다
        // (`project/download.ts`가 같은 이유로 같은 모양이다).
        const blob = new Blob([entry.bytes as unknown as BlobPart], { type: entry.format.mime })
        next.set(entry.hash, URL.createObjectURL(blob))
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
