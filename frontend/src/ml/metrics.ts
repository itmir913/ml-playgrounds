/**
 * 지표 계산 - **과제 유형마다 지표 집합이 통째로 다르다.**
 *
 * 그래서 등록부다. `if (taskType === 'regression')` 를 만들지 마라 - 군집이 들어오는
 * 순간 그 분기가 세 갈래가 되고, 이미지가 들어오면 여섯 갈래가 된다
 * (architecture.md 6이 미리 경고해 둔 자리다). 등록부에 항목을 추가하면 화면이 따라온다.
 *
 * **반올림하지 않는다.** 저장은 그대로 하고 자릿수는 화면이 줄인다. 지금 반올림하면
 * 재실행 대조의 허용 오차(open-decisions.md #12)를 여기서 미리 정해 버리는 셈이고,
 * 한 번 잘린 자릿수는 되돌릴 수 없다.
 *
 * 0으로 나누는 자리는 전부 0으로 둔다 - sklearn의 zero_division 기본값과 같다.
 * NaN을 파일에 쓰면 JSON에서 null이 되고, 그 null이 어디서 왔는지 아무도 모른다.
 */

import { ClientError } from '../errors'
import type { ConfusionMatrix, PerClass, TaskType } from '../project/schema'

/**
 * 모델이 내놓은 값. 분류는 라벨(문자열), 회귀는 수치다.
 *
 * 한 타입으로 받는 이유는 부르는 쪽에 분기를 만들지 않기 위해서다.
 * 어떻게 읽을지는 각 지표 계산기가 안다.
 */
export type Prediction = string | number

export interface Evaluation {
  /** 지표 이름 -> 값. .mlpx의 run.metrics가 이것이다. */
  metrics: Record<string, number>
  /** 분류에만 있다. */
  perClass?: PerClass[]
  confusionMatrix?: ConfusionMatrix
}

export type Evaluator = (
  actual: readonly Prediction[],
  predicted: readonly Prediction[],
) => Evaluation

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator
}

/**
 * 분류 지표.
 *
 * 라벨 목록은 **정답과 예측을 합쳐서** 만든다. 예측에만 나온 라벨을 빼면 혼동 행렬에서
 * 그 오분류가 통째로 사라져서, 학생이 "왜 정확도가 낮은데 표는 깨끗하지"를 겪는다.
 */
function evaluateClassification(
  actual: readonly Prediction[],
  predicted: readonly Prediction[],
): Evaluation {
  const actualLabels = actual.map(String)
  const predictedLabels = predicted.map(String)
  const labels = [...new Set([...actualLabels, ...predictedLabels])].sort()
  const position = new Map(labels.map((label, index) => [label, index]))

  const matrix = labels.map(() => labels.map(() => 0))
  actualLabels.forEach((truth, index) => {
    const row = matrix[position.get(truth) ?? -1]
    const column = position.get(predictedLabels[index] ?? '')
    if (row && column !== undefined) row[column] = (row[column] ?? 0) + 1
  })

  const perClass = labels.map((label, index): PerClass => {
    const truePositive = matrix[index]?.[index] ?? 0
    const predictedAsThis = labels.reduce((sum, _, row) => sum + (matrix[row]?.[index] ?? 0), 0)
    const support = labels.reduce((sum, _, column) => sum + (matrix[index]?.[column] ?? 0), 0)
    const precision = ratio(truePositive, predictedAsThis)
    const recall = ratio(truePositive, support)
    return {
      label,
      precision,
      recall,
      f1: ratio(2 * precision * recall, precision + recall),
      support,
    }
  })

  const correct = actualLabels.reduce(
    (sum, truth, index) => sum + (truth === predictedLabels[index] ? 1 : 0),
    0,
  )

  return {
    metrics: {
      accuracy: ratio(correct, actualLabels.length),
      // macro는 클래스마다 같은 무게를 준다. 쏠린 데이터에서 accuracy가 속일 때
      // 이쪽이 진실을 말한다 - 교실 데이터는 대개 쏠려 있다.
      f1Macro: ratio(
        perClass.reduce((sum, entry) => sum + entry.f1, 0),
        perClass.length,
      ),
    },
    perClass,
    confusionMatrix: { labels, matrix },
  }
}

/** 회귀 지표. 혼동 행렬도 클래스별 지표도 없다 - 맞고 틀림이 아니라 얼마나 벗어났느냐다. */
function evaluateRegression(
  actual: readonly Prediction[],
  predicted: readonly Prediction[],
): Evaluation {
  const truth = actual.map(Number)
  const guess = predicted.map(Number)
  const count = truth.length

  const errors = truth.map((value, index) => value - (guess[index] ?? 0))
  const mae = ratio(
    errors.reduce((sum, error) => sum + Math.abs(error), 0),
    count,
  )
  const residual = errors.reduce((sum, error) => sum + error * error, 0)
  const average = ratio(
    truth.reduce((sum, value) => sum + value, 0),
    count,
  )
  const total = truth.reduce((sum, value) => sum + (value - average) ** 2, 0)

  return {
    metrics: {
      mae,
      rmse: Math.sqrt(ratio(residual, count)),
      // 정답이 전부 같은 값이면 분모가 0이다. 완벽히 맞혔으면 1, 아니면 0으로 둔다
      // (sklearn과 같은 규칙). 여기서 NaN을 내보내면 비교표가 통째로 깨진다.
      r2: total === 0 ? (residual === 0 ? 1 : 0) : 1 - residual / total,
    },
  }
}

/**
 * 과제 유형 -> 지표 계산기.
 *
 * 군집은 아직 없다. 군집 알고리즘도 등록부에 없으므로(ml/algorithms.ts) 여기 도달할 수
 * 없고, **tests/metrics.spec.ts가 그 대응을 강제한다** - 알고리즘을 먼저 등록하고
 * 지표를 잊는 일이 생기지 않는다.
 */
export const EVALUATORS: Partial<Record<TaskType, Evaluator>> = {
  classification: evaluateClassification,
  regression: evaluateRegression,
}

/** 과제 유형에 맞는 지표를 계산한다. 부르는 쪽에 분기가 없다. */
export function evaluate(
  taskType: TaskType,
  actual: readonly Prediction[],
  predicted: readonly Prediction[],
): Evaluation {
  const evaluator = EVALUATORS[taskType]
  if (!evaluator) throw new ClientError('JOB_FAILED')
  return evaluator(actual, predicted)
}
