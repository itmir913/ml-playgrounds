/**
 * 모델 해석기 등록부.
 *
 * **`if (format === 'mlpx-tree-v1')` 를 만들지 마라.** 형식이 늘어날 때 바뀌는 것은 아래
 * 배열 하나여야 한다 (ml/engines/index.ts, ml/algorithms.ts와 같은 방식).
 *
 * 등록부의 키는 **형식**이지 알고리즘이 아니다. 같은 알고리즘이라도 엔진이 다르면 담기는
 * 모양이 달라질 수 있고(mlpx-spec.md 5.3), 반대로 결정트리와 랜덤포레스트처럼 알고리즘이
 * 둘이어도 payload가 하나면 해석기도 하나다.
 */

import { z } from 'zod'

import { ClientError } from '../../errors'
import { TREE_FORMAT, loadTreeModel } from './tree'
import type { ModelInterpreter, Predict } from './types'

export { TREE_FORMAT } from './tree'
export type { TreeModel, TreeNode } from './tree'
export type { ModelFile, ModelInterpreter, Predict } from './types'

const INTERPRETERS: readonly ModelInterpreter[] = [{ format: TREE_FORMAT, load: loadTreeModel }]

/** 이 빌드가 읽을 수 있는 형식. 화면이 "예측 가능"을 판정할 때 쓴다. */
export const SUPPORTED_MODEL_FORMATS: readonly string[] = INTERPRETERS.map(
  (interpreter) => interpreter.format,
)

const formatSchema = z.looseObject({ format: z.string() })

/**
 * 모델 파일 내용을 예측 함수로 바꾼다.
 *
 * 모르는 형식은 실패지만 **파일 열기 실패와 성격이 다르다** - 파일은 멀쩡히 열리고 그
 * 모델로 예측만 못 한다 (mlpx-spec.md 5.2).
 *
 * **format이 없는 것은 모르는 형식이 아니라 깨진 파일이다.** 둘을 같이 다루면 화면이
 * "이 버전에서는 실행할 수 없습니다"라고 말하게 되고, 학생은 앱을 업데이트하러 간다.
 */
export function loadModel(file: unknown): Predict {
  const parsed = formatSchema.safeParse(file)
  if (!parsed.success) throw new ClientError('MODEL_FILE_INVALID', { field: 'format' })

  const { format } = parsed.data
  const interpreter = INTERPRETERS.find((entry) => entry.format === format)
  if (!interpreter) throw new ClientError('MODEL_FORMAT_UNSUPPORTED', { format })
  return interpreter.load(file)
}
