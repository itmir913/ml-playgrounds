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
import { LINEAR_FORMAT, loadLinearModel, loadLinearProba } from './linear'
import { LINEAR_REGRESSION_FORMAT, loadLinearRegressionModel } from './linear-regression'
import { NAIVE_BAYES_FORMAT, loadNaiveBayesModel } from './naive-bayes'
import { REFERENCE_FORMAT, loadReferenceModel } from './reference'
import { SVM_FORMAT, loadSvmModel } from './svm'
import { TREE_FORMAT, loadTreeModel } from './tree'
import type { LoadContext, ModelInterpreter, Predict, ProbaModel } from './types'

export { LINEAR_FORMAT } from './linear'
export type { LinearModel } from './linear'
export { LINEAR_REGRESSION_FORMAT } from './linear-regression'
export type { LinearRegressionModel } from './linear-regression'
export { NAIVE_BAYES_FORMAT } from './naive-bayes'
export type { NaiveBayesModel } from './naive-bayes'
export { REFERENCE_FORMAT, knnPredict } from './reference'
export type { NeighborhoodInput, ReferenceModel } from './reference'
export { SVM_FORMAT, svmPredict } from './svm'
export type { PairwiseClassifier, SvmModel, VotingInput } from './svm'
export { TREE_FORMAT } from './tree'
export type { TreeModel, TreeNode } from './tree'
export type {
  LoadContext,
  ModelFile,
  ModelInterpreter,
  Predict,
  PredictProba,
  ProbaModel,
} from './types'

const INTERPRETERS: readonly ModelInterpreter[] = [
  {
    format: TREE_FORMAT,
    includesPreprocessing: false,
    needsTrainingRows: false,
    load: loadTreeModel,
  },
  {
    format: LINEAR_FORMAT,
    includesPreprocessing: false,
    needsTrainingRows: false,
    load: loadLinearModel,
    // **지금 확률을 내는 유일한 형식이다** (mlpx-spec.md 5.4). 결정 트리와 나이브
    // 베이즈도 sklearn에서는 predict_proba를 가지므로 여기 항목이 늘어날 자리다.
    loadProba: loadLinearProba,
  },
  {
    format: NAIVE_BAYES_FORMAT,
    includesPreprocessing: false,
    needsTrainingRows: false,
    load: loadNaiveBayesModel,
  },
  {
    format: LINEAR_REGRESSION_FORMAT,
    includesPreprocessing: false,
    needsTrainingRows: false,
    load: loadLinearRegressionModel,
  },
  {
    format: SVM_FORMAT,
    includesPreprocessing: false,
    // **선형 SVM은 가중치뿐이라 자체 완결이다** (mlpx-spec.md 5.8). 참조형과 갈리는 자리다.
    needsTrainingRows: false,
    load: loadSvmModel,
  },
  {
    format: REFERENCE_FORMAT,
    includesPreprocessing: false,
    // **첫 true다.** 모델이 사실상 학습 데이터라 행 번호만 담는다 (mlpx-spec.md 5.1).
    needsTrainingRows: true,
    load: loadReferenceModel,
  },
]

/** 이 빌드가 읽을 수 있는 형식. 화면이 "예측 가능"을 판정할 때 쓴다. */
export const SUPPORTED_MODEL_FORMATS: readonly string[] = INTERPRETERS.map(
  (interpreter) => interpreter.format,
)

/** 형식에 붙은 해석기. 이 빌드가 모르는 형식이면 없다. */
export function interpreterFor(format: string): ModelInterpreter | undefined {
  return INTERPRETERS.find((entry) => entry.format === format)
}

const formatSchema = z.looseObject({ format: z.string() })

/**
 * 이 해석기가 요구하는 것이 갖춰졌는가.
 *
 * **화면이 먼저 판정해 그 모델을 꺼 두지만**(mlpx-spec.md 5.0) 남의 파일이나 직접 부르는
 * 경로가 이 아래로 들어올 수 있다. 그냥 흘려보내면 해석기가 **빈 학습셋으로 그럴듯한
 * 답**을 내놓는다 - 이 저장소가 규정한 최악이 정확히 그것이다.
 *
 * 등록부에 없는 형식으로는 여기 도달할 수 없어서, 검사가 **해석기를 직접 받는다.**
 */
export function assertContext(interpreter: ModelInterpreter, context: LoadContext): void {
  if (interpreter.needsTrainingRows && !context.trainingRows) {
    throw new ClientError('MODEL_NEEDS_DATASET', { format: interpreter.format })
  }
}

/**
 * 모델 파일 내용을 예측 함수로 바꾼다.
 *
 * 모르는 형식은 실패지만 **파일 열기 실패와 성격이 다르다** - 파일은 멀쩡히 열리고 그
 * 모델로 예측만 못 한다 (mlpx-spec.md 5.2).
 *
 * **format이 없는 것은 모르는 형식이 아니라 깨진 파일이다.** 둘을 같이 다루면 화면이
 * "이 버전에서는 실행할 수 없습니다"라고 말하게 되고, 학생은 앱을 업데이트하러 간다.
 */
export function loadModel(file: unknown, context: LoadContext = {}): Predict {
  const parsed = formatSchema.safeParse(file)
  if (!parsed.success) throw new ClientError('MODEL_FILE_INVALID', { field: 'format' })

  const { format } = parsed.data
  const interpreter = interpreterFor(format)
  if (!interpreter) throw new ClientError('MODEL_FORMAT_UNSUPPORTED', { format })

  assertContext(interpreter, context)
  return interpreter.load(file, context)
}

/**
 * 확률을 낼 수 있으면 그 함수를, 아니면 `null` (mlpx-spec.md 5.4).
 *
 * **`loadModel`과 나란히 둔다.** 부르는 쪽이 등록부를 직접 뒤지면 "형식 이름을 보고
 * 가르지 않는다"가 화면 코드에서 깨진다 - 화면이 보는 것은 여기서 null이 왔는지뿐이다.
 *
 * **모르는 형식도 null이다.** 그 판정은 `loadModel`이 먼저 던져 끝내므로 여기 도달하지
 * 않고, 여기서 굳이 한 번 더 던지면 "확률이 없다"와 "이 파일을 못 읽는다"가 같은 자리에서
 * 섞인다.
 */
export function loadModelProba(file: unknown, context: LoadContext = {}): ProbaModel | null {
  const parsed = formatSchema.safeParse(file)
  if (!parsed.success) return null

  const interpreter = interpreterFor(parsed.data.format)
  if (!interpreter?.loadProba) return null

  assertContext(interpreter, context)
  return interpreter.loadProba(file, context)
}
