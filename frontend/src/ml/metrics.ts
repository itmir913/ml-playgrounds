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

/**
 * 지표 하나를 화면에 어떻게 보일 것인가.
 *
 * **계산과 표시는 다른 앎이다.** 위의 계산기들은 값만 내고, 무엇을 먼저 보일지·높을수록
 * 좋은지·백분율인지는 아무도 몰랐다. 결과 화면이 **지표별 최고값을 굵게** 하려면
 * 방향이 있어야 한다 (architecture.md 8.13).
 */
export interface MetricDisplay {
  /** run.metrics의 키. 로케일 키도 `metrics.{name}`으로 여기서 나온다. */
  readonly name: string
  /** 높을수록 좋은가 낮을수록 좋은가. 최고값 표시가 이것을 본다. */
  readonly better: 'higher' | 'lower'
  /** 백분율로 쓸 수 있는 값인가. */
  readonly format: 'percent' | 'number'
}

/**
 * 과제 유형 -> 지표 표시 순서.
 *
 * **`EVALUATORS`와 같은 파일에 같은 모양으로 둔다.** 지표를 늘리면 화면이 따라오고,
 * 빠뜨리면 tests/metrics.spec.ts가 잡는다 - 두 표의 과제 유형 집합이 어긋나거나,
 * 실제 계산 결과에 없는 지표를 여기 적으면 빨개진다.
 *
 * **`r2`는 백분율이 아니다.** 비율처럼 보이지만 **음수가 될 수 있어서**, 백분율로 쓰면
 * 못 맞힌 모델 옆에 `-234%`가 뜬다.
 */
export const METRIC_DISPLAY: Partial<Record<TaskType, readonly MetricDisplay[]>> = {
  classification: [
    { name: 'accuracy', better: 'higher', format: 'percent' },
    { name: 'f1Macro', better: 'higher', format: 'percent' },
  ],
  regression: [
    { name: 'r2', better: 'higher', format: 'number' },
    { name: 'rmse', better: 'lower', format: 'number' },
    { name: 'mae', better: 'lower', format: 'number' },
  ],
}

/** 이 과제 유형에서 보일 지표들. 모르는 유형이면 빈 목록이다 - 화면이 던지지 않는다. */
export function metricsOf(taskType: TaskType): readonly MetricDisplay[] {
  return METRIC_DISPLAY[taskType] ?? []
}

/**
 * 값들 중 가장 좋은 것. **없으면 undefined다** - 견줄 것이 하나도 없는데 그 하나를
 * "최고"라고 굵게 하면 비교가 아니라 장식이 된다. 하나뿐일 때도 굵게 할지는 부르는
 * 쪽이 정한다.
 */
export function bestOf(
  values: readonly number[],
  better: MetricDisplay['better'],
): number | undefined {
  const usable = values.filter((value) => Number.isFinite(value))
  if (usable.length === 0) return undefined
  return better === 'higher' ? Math.max(...usable) : Math.min(...usable)
}

/**
 * 과제 유형에 맞는 지표를 계산한다. 부르는 쪽에 분기가 없다.
 *
 * **양쪽 끝에서 막는다.** 들어오는 것의 길이가 다르면 던지고, 나가는 값이 수치가 아니면
 * 던진다. 둘 다 "조용히 그럴듯한 숫자"로 끝나는 경로라 여기서 끊지 않으면 아무 데서도
 * 안 끊긴다.
 *
 * 던지는 코드는 `JOB_FAILED`다. 둘 다 **학생이 할 수 있는 일이 없는 도구의 고장**이고,
 * 새 코드를 만들면 로케일에 "내부 오류입니다"가 하나 더 생기는데 이미 그 문장이다.
 * 무엇이 어긋났는지는 params로 run.failure에 남아 개발자가 읽는다
 * (open-decisions.md "범위 밖 클래스 번호는 던진다").
 */
export function evaluate(
  taskType: TaskType,
  actual: readonly Prediction[],
  predicted: readonly Prediction[],
): Evaluation {
  const evaluator = EVALUATORS[taskType]
  if (!evaluator) throw new ClientError('JOB_FAILED', { taskType })

  // 지금 등록된 엔진은 전부 입력 행 수만큼 예측을 돌려주므로 도달하지 않는다. 그러나 이
  // 함수는 곧 서버 학습과 pyodide의 결과도 받는다 - 비동기 경계를 넘어온 잘린 응답이
  // 들어오면 분류는 그 행을 혼동 행렬에서 빠뜨린 채 정확도 분모에는 넣고, 회귀는 없는
  // 예측을 0으로 간주해 오차를 잰다. 에러 없이 그럴듯한 지표가 나온다.
  if (actual.length !== predicted.length) {
    throw new ClientError('JOB_FAILED', {
      actualCount: actual.length,
      predictedCount: predicted.length,
    })
  }

  const evaluation = evaluator(actual, predicted)

  // **NaN을 run에 싣지 않는다.** 위 머리말이 경고한 경로가 실제로 열려 있었다 - 회귀에
  // 범주형 타깃을 고르면 Number('상')이 NaN이 되어 지표 전부가 NaN인 채 status가 done이
  // 되고, 저장할 때 JSON이 그것을 null로 바꿔 **다시 열리지 않는 .mlpx**가 나왔다.
  // ml/experiment.ts가 그 조합을 앞에서 거부하지만 여기가 마지막 방어선이다 - 지표가 수치로
  // 안 나오는 이유는 앞으로도 더 생긴다.
  for (const [metric, value] of Object.entries(evaluation.metrics)) {
    if (!Number.isFinite(value)) throw new ClientError('JOB_FAILED', { metric })
  }

  return evaluation
}
