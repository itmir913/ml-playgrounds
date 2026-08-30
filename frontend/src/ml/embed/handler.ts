/**
 * 임베딩 워커가 요청 하나를 처리하는 방법. **던지지 않는다.**
 *
 * 워커 안에서 예외가 새면 메인은 `error` 이벤트 하나만 받고 무엇이 왜 실패했는지 알 수
 * 없다. 사유를 코드로 바꿔 보내야 화면이 로케일 문장을 고른다 (CLAUDE.md §1.4).
 *
 * 판단을 워커 파일에서 분리해 둔 이유는 학습 워커와 같다 — 여기는 runner를 주입받아
 * 테스트로 덮이고, 워커 파일은 이 함수를 부르는 몇 줄만 남는다.
 */

import { failureDetail, isClientError } from '../../errors'
import { backboneFor } from '../backbones'
import type { EmbedMessage, EmbedRequest } from './protocol'
import { createTfjsRunner, type BackboneRunner } from './runner'

export async function handleEmbed(
  request: EmbedRequest,
  emit: (message: EmbedMessage) => void,
  createRunner: () => BackboneRunner = createTfjsRunner,
): Promise<void> {
  const spec = backboneFor(request.backboneId)
  if (!spec) {
    // 등록부에 없는 백본이다. 옛 파일이 지금 앱에 없는 백본을 가리킬 때 여기로 온다.
    // **id는 파라미터로 싣는다** (CLAUDE.md 1.4). failureDetail은 남의 라이브러리가 던진
    // 영어를 기술 정보로 붙이는 통로라 번역되지 않는다 - 우리 문장이 거기 가면 안 된다.
    emit({
      type: 'failed',
      code: 'BACKBONE_UNAVAILABLE',
      params: { backboneId: request.backboneId },
    })
    return
  }

  const runner = createRunner()
  const target = { spec, modelUrl: request.modelUrl }
  try {
    await runner.prepare(target, (state, fraction) =>
      emit({ type: 'preparing', state, ...(fraction === undefined ? {} : { fraction }) }),
    )
    const vectors = await runner.embed(target, request.images, (completed) =>
      emit({ type: 'progress', completed, total: request.images.length }),
    )
    emit({ type: 'done', vectors, dim: spec.embeddingDim })
  } catch (error) {
    emit(
      isClientError(error)
        ? { type: 'failed', code: error.code, params: error.params }
        : { type: 'failed', code: 'BACKBONE_UNAVAILABLE', params: failureDetail(error) },
    )
  } finally {
    runner.dispose()
  }
}
