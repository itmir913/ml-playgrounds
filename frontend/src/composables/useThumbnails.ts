/**
 * 사진 썸네일의 객체 URL. **만들고 놓아주는 일은 `useObjectUrls`가 한다** — 여기는
 * 사진의 어휘(해시·형식)를 그 원시 연산의 어휘로 옮기는 한 겹이다.
 *
 * **다섯 화면이 같은 모양을 각자 들고 있었다** (V11 R5 C-2) — 맵을 만들고, 바뀌면 옛
 * URL을 놓아주고, 언마운트에서 전부 놓아준다. **그러고도 여섯째가 남아 있었다**:
 * 포트폴리오 화면의 첨부 지도가 키만 경로인 같은 코드였고, 2026-09-18에 둘을 하나로
 * 접었다 (`useObjectUrls`).
 */

import { computed, type Ref } from 'vue'

import { useObjectUrls } from './useObjectUrls'

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
export function useThumbnails(entries: Ref<readonly Thumbnailable[]>): {
  urls: Ref<Map<string, string>>
} {
  return useObjectUrls(
    computed(() =>
      entries.value.map((entry) => ({
        key: entry.hash,
        bytes: entry.bytes,
        mime: entry.format.mime,
      })),
    ),
  )
}
