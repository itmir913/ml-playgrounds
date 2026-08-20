/**
 * **이 사진들이 이 기기에 들어가는가.** 굽기 전에 묻는다
 * (open-decisions.md "이미지가 들어갈 자리는 굽기 전에 묻는다").
 *
 * **새 상한이 아니다.** 판정하는 문턱은 우리 상수가 아니라 브라우저가 보고하는
 * 쿼터이고, 여태 `saveProject`가 쓰기 직전에 묻던 바로 그 값이다. 갈리는 것은
 * **시점**뿐이다 — 정본을 다 굽고 백본을 다 돌린 뒤가 아니라, 학생이 아직
 * 아무것도 안 기다렸을 때 묻는다.
 *
 * **화면 둘이 나눠 쓴다** (`views/data/ImagePanel.vue`·`views/predict/ImagePredictPanel.vue`).
 * 컴포넌트 안에 두면 한쪽만 고쳐진다.
 */

import { detectCanonicalFormat } from './bake'

import type { BackboneSpec } from '@/ml/backbones'
import { estimatedImageBytes } from '@/project/images'
import { roomShortfall, totalBytes, type RoomShortfall } from '@/project/storage'
import type { ProjectFile } from '@/project/format'

/**
 * 사진 `incoming`장을 더 담을 자리가 있는가. 있으면 `null`.
 *
 * **형식을 여기서 고른다.** 화면은 형식을 모르고(굽는 것은 워커다) 요청마다 한 번
 * 물으면 되는 값이라, 1×1 프로브 한 번이 이 판정의 유일한 비용이다.
 *
 * **프로젝트가 없으면 묻지 않는다** — 담을 곳이 아직 없으므로 셀 것도 없다.
 */
export async function imageRoomShortfall(
  file: ProjectFile | null,
  incoming: number,
  backbone: BackboneSpec,
): Promise<RoomShortfall | null> {
  if (!file) return null
  const format = await detectCanonicalFormat()
  const extra = estimatedImageBytes(incoming, format, backbone.embeddingDim)
  return roomShortfall(totalBytes(file) + extra)
}
