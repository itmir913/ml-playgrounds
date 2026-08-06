/**
 * 예측 화면이 서는 **이음매 둘** (architecture.md 8.13.1).
 *
 * 화면보다 먼저 만들고 테스트로 덮는 이유는 **여기가 틀려도 에러가 안 나는 자리**이기
 * 때문이다. 행 하나만 밀려 잡아도 그럴듯한 예측이 나오고 아무도 못 알아챈다 -
 * 이 저장소가 규정한 최악이 정확히 그것이다. 화면 코드 안에 넣으면 그걸 확인할 방법이
 * 없어진다.
 *
 * **두 함수 모두 첫 인자가 실험이다.** 모델을 고를 때 실험도 함께 고르는 셈이고
 * (화면은 "모델 목록"을 보여주지만 각 줄이 매달려 있는 것은 (실험, run) 쌍이다),
 * 전처리기·인코딩·타깃·행 번호가 전부 **그 실험 하나**에서 나와야 한다. 다른 실험 것을
 * 섞으면 좌표계가 어긋난 채로 답이 나온다. 그래서 인자 모양으로 그 자리를 닫는다.
 *
 * **전처리기를 인자로 받는 것은 이 계층이 zip을 모르기 때문이다.** 경로에서 바이트를
 * 꺼내는 것은 파일 계층의 일이고(project/format.ts), 여기는 그것을 읽은 결과만 받는다
 * (ml/preprocess.ts의 parsePreprocessor).
 */

import { ClientError, type ClientErrorCode } from '../errors'
import type { Experiment, ProjectDocument, Run } from '../project/schema'
import type { Prediction } from './metrics'
import { interpreterFor, type LoadContext } from './models'
import {
  targetValues,
  transform,
  type ColumnKind,
  type Dataset,
  type Preprocessor,
} from './preprocess'

/** `LoadContext.trainingRows`의 실체. 참조형 해석기가 이것을 받는다 (mlpx-spec.md 5.0). */
export type TrainingRows = NonNullable<LoadContext['trainingRows']>

/**
 * 만들어진 행의 폭이 전처리기가 약속한 폭과 같은가.
 *
 * **어긋나는 유일한 경로가 인코딩이다.** `featureNames`는 fit 시점의 인코딩으로 늘어난
 * 이름이고 `transform`은 인자로 받은 인코딩으로 늘어난 값이라, 다른 실험의 전처리기를
 * 끼워 넣으면(한쪽은 onehot, 한쪽은 ordinal) **길이가 다른 벡터가 조용히 나온다.**
 * 모델은 featureCount로 그걸 잡지만 우연히 같아지는 조합이 있고, 그때는 아무도 못 잡는다.
 */
function assertWidth(preprocessor: Preprocessor, row: readonly number[]): void {
  if (row.length !== preprocessor.featureNames.length) {
    throw new ClientError('MODEL_FILE_INVALID', { field: 'featureNames' })
  }
}

/**
 * ① 이 실험의 학습 행을 만든다. **참조형 모델이 없으면 부를 이유가 없다**
 * (`needsTrainingRows`, mlpx-spec.md 5.0).
 *
 * `trainIndices`는 `dataset/data.csv`의 행 번호이고 **헤더를 뺀 데이터 행 기준으로 0부터**
 * 센다 (mlpx-spec.md 5.1). 그 번호를 그대로 `indices`로 넘기는 것이 이 함수의 계약이다 -
 * 참조형 모델은 자기 `trainIndices`로 그중 필요한 것만 골라 쓰므로, 여기서 번호를 다시
 * 매기면 **한 줄씩 밀린 이웃**을 보고도 예측은 멀쩡히 나온다.
 *
 * 데이터가 바뀌어 번호가 범위를 벗어나면 `transform`이 시끄럽게 던진다. 정상 경로에서는
 * 데이터를 바꾸는 순간 실험이 전부 지워지므로(mlpx-spec.md 4.3) 여기 오는 것은 남이
 * 편집한 파일뿐이다.
 */
export function trainingRowsFor(
  experiment: Experiment,
  preprocessor: Preprocessor,
  dataset: Dataset,
): TrainingRows {
  const { target, trainIndices, preprocessing } = experiment.settings
  // 군집화에는 타깃이 없지만 군집 알고리즘도 참조형 모델도 아직 없다. 여기 오는 것은
  // 정답 열이 있어야 이웃의 답을 셀 수 있는 모델뿐이다.
  if (target === undefined || target === '') throw new ClientError('TARGET_NOT_SELECTED')

  const features = transform(preprocessor, dataset, trainIndices, preprocessing.categoricalEncoding)
  const first = features[0]
  if (first) assertWidth(preprocessor, first)

  return {
    indices: trainIndices,
    features,
    target: targetValues(dataset, trainIndices, target),
  }
}

/**
 * ② 학생이 채운 한 줄을 특성 벡터로 바꾼다. **칸은 `preprocessor.columns` 순서다.**
 *
 * **`transform`에 그대로 태운다.** 원-핫으로 늘어난 열의 순서를 여기서 다시 구현하면
 * 규칙이 두 벌이 되고, 두 벌은 반드시 어긋난다 - 학습 때 쓴 바로 그 코드를 지나가야
 * 벡터가 같은 좌표계에 선다.
 *
 * **빈 칸은 시끄럽게 거부한다.** 전처리기의 대체값으로 조용히 채우면 학생은 자기가 넣은
 * 값으로 예측했다고 믿는데 실제로는 학습셋의 평균이 들어간다. 결측 전략 `none`을 거부하는
 * 것과 같은 판단이다 (open-decisions.md "전처리도 분할도 끌 수 있다").
 *
 * 학습 때 못 본 범주가 오면 `transform`의 규칙을 그대로 따른다(onehot은 전부 0, ordinal은
 * -1). 화면이 본 값 중에서 고르게 하므로 정상 경로에서는 나오지 않는다.
 */
export function inputVector(
  experiment: Experiment,
  preprocessor: Preprocessor,
  values: Readonly<Record<string, string>>,
): number[] {
  const blank = preprocessor.columns
    .map((column) => column.name)
    .filter((name) => (values[name] ?? '').trim() === '')

  const first = blank[0]
  if (first !== undefined) {
    throw new ClientError('PREDICTION_INPUT_INCOMPLETE', { feature: first, count: blank.length })
  }

  // 한 줄짜리 표를 만들어 학습과 같은 길로 보낸다. 열 이름을 전처리기에서 뽑으므로
  // 학습에 안 쓰인 열(excludedColumns)은 여기 자리도 없다 - 화면도 그 칸을 만들지 않는다.
  const table: Dataset = {
    columns: preprocessor.columns.map((column) => column.name),
    rows: [preprocessor.columns.map((column) => values[column.name] ?? '')],
  }

  const row = transform(
    preprocessor,
    table,
    [0],
    experiment.settings.preprocessing.categoricalEncoding,
  )[0]
  // transform은 준 인덱스마다 한 줄을 돌려준다. 없을 수 없지만 타입이 그걸 모른다.
  if (row === undefined) throw new ClientError('MODEL_FILE_INVALID', { field: 'columns' })

  assertWidth(preprocessor, row)
  return row
}

/**
 * 칸 하나의 서술. **데이터가 칸의 모양을 정한다** (architecture.md 8.13.1).
 *
 * 범주형은 **학습 때 본 값 중에서 고르는 칸**이다. 자유 입력으로 두면 학생이 오타를 내고
 * 그 값은 전처리에서 조용히 미지의 범주가 된다 - 화면이 답을 내주는데 그 답이 무의미해진다.
 */
export interface PredictionField {
  readonly name: string
  readonly kind: ColumnKind
  /** 범주형에만 있다. **순서는 학습 때 본 순서** - 원-핫 열의 순서와 같다. */
  readonly options?: readonly string[]
}

/**
 * 채워야 하는 칸들. **`preprocessor.columns` 순서 그대로다.**
 *
 * **학습에 안 쓰인 열은 여기 없다.** 인코딩을 껐을 때 빠진 범주 열(`excludedColumns`)에
 * 칸을 만들면 학생은 값을 넣는데 예측은 그 값을 안 본다 - 화면이 거짓말을 하는 셈이다.
 */
export function inputFields(preprocessor: Preprocessor): PredictionField[] {
  return preprocessor.columns.map((column) => ({
    name: column.name,
    kind: column.kind,
    ...(column.categories ? { options: column.categories } : {}),
  }))
}

/**
 * 여러 실험의 칸을 하나로 합친다. **입력은 한 줄이고 모델은 여러 실험에서 온다.**
 *
 * 실험마다 특성 목록이 다를 수 있는데(학생이 열을 바꿔가며 학습한다) 화면의 칸은 하나다.
 * **합집합을 쓴다** - 교집합으로 하면 열을 하나 더 쓴 실험의 모델이 통째로 못 쓰게 되고,
 * 그러면 "같은 값인데 모델마다 답이 다르다"를 보여줄 수가 없다 (architecture.md 8.13.1).
 *
 * 어느 실험이 그 칸을 실제로 보는지는 **각자의 전처리기가 정한다** - 안 쓰는 칸은
 * `inputVector`가 그냥 지나친다. 범주 목록도 합친다: 학습셋이 달라 못 본 범주가 있을 수
 * 있고, 그 값을 고른 학생에게 그 모델은 미지의 범주로 답한다(그게 `transform`의 규칙이다).
 *
 * **순서는 먼저 나온 것이 앞이다.** 최신 실험이 앞에 오도록 넘기면 화면의 칸 순서가
 * 지금 설정과 같아진다.
 */
export function mergeFields(groups: readonly (readonly PredictionField[])[]): PredictionField[] {
  const merged = new Map<string, { kind: ColumnKind; options: string[] | null }>()

  for (const group of groups) {
    for (const field of group) {
      const seen = merged.get(field.name)
      if (!seen) {
        merged.set(field.name, {
          kind: field.kind,
          options: field.options ? [...field.options] : null,
        })
        continue
      }
      if (!seen.options || !field.options) continue
      for (const option of field.options) {
        if (!seen.options.includes(option)) seen.options.push(option)
      }
    }
  }

  return [...merged].map(([name, { kind, options }]) => ({
    name,
    kind,
    ...(options ? { options } : {}),
  }))
}

/**
 * 수치 칸마다 표에 실제로 있는 값의 범위. **눈금이 아니라 힌트다.**
 *
 * 빈 숫자 칸 앞에서 학생은 "여기 뭘 넣지"에서 멈춘다. 데이터에 150~190이 들어 있다는
 * 사실이 그 자리에서 가장 쓸모 있는 정보이고, 그건 표를 보면 알 수 있는 것을 옮겨 놓는
 * 것뿐이다.
 *
 * **막지 않는다** (open-decisions.md "하이퍼파라미터는 눈금을 주되 막지 않는다"와 같은
 * 판단이다). 범위 밖 값을 넣어 보는 것은 이 도구에서 **해 볼 만한 일**이다 — 학습 데이터
 * 밖에서 모델이 어떻게 구는지가 수업에서 가장 좋은 장면 중 하나다.
 *
 * **전체 행을 본다.** 학습셋만 보면 화면이 말하는 범위와 학생이 표에서 본 범위가 달라진다.
 */
export function numericRanges(
  dataset: Dataset,
  fields: readonly PredictionField[],
): Map<string, { min: number; max: number }> {
  const ranges = new Map<string, { min: number; max: number }>()

  for (const field of fields) {
    if (field.kind !== 'numeric') continue
    const column = dataset.columns.indexOf(field.name)
    if (column < 0) continue

    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const row of dataset.rows) {
      const cell = (row[column] ?? '').trim()
      if (cell === '') continue
      const value = Number(cell)
      if (!Number.isFinite(value)) continue
      if (value < min) min = value
      if (value > max) max = value
    }
    // 숫자가 하나도 없는 열은 범위가 없다. 빈 힌트를 보이느니 아무 말도 안 한다.
    if (min <= max) ranges.set(field.name, { min, max })
  }

  return ranges
}

export interface SampleRow {
  /** `dataset/data.csv`의 행 번호. 화면이 "몇 번째 줄을 가져왔다"를 말할 수 있다. */
  readonly index: number
  /** 칸 이름 -> 값. `inputVector`에 그대로 넣을 수 있는 모양이다. */
  readonly values: Record<string, string>
}

/**
 * 표에서 한 줄을 가져온다. **평가에 쓴 행을 먼저 준다.**
 *
 * 학생이 [예측]으로 보게 되는 것이 **자기가 학습에 쓴 행을 다시 맞히는 장면**이면
 * 아무것도 가르치지 않는다 (architecture.md 8.13.1). 평가셋 행은 모델이 학습 때 못 본
 * 행이라 그 장면이 아니다. 분할을 껐으면 둘이 같은 집합이고, 그때는 애초에 학습에 안 쓴
 * 행이 없다 - 없는 것을 지어내지 않는다.
 *
 * **난수를 쓰지 않는다.** `after` 다음 것을 돌아가며 준다 - 같은 프로젝트를 다시 열어도
 * 같은 순서이고, 학생이 여러 번 누르면 여러 줄을 본다. 여기에 난수를 넣으면 재현
 * 가능성에 우리가 관리하지 않는 구멍이 하나 더 생긴다.
 */
export function nextSampleRow(
  experiment: Experiment,
  /** 채울 칸들. **전처리기가 아니라 칸을 받는다** - 화면의 칸은 여러 실험의 합집합이다. */
  fields: readonly PredictionField[],
  dataset: Dataset,
  after?: number,
): SampleRow | null {
  const { testIndices, trainIndices } = experiment.settings
  const candidates = testIndices.length > 0 ? testIndices : trainIndices
  if (candidates.length === 0) return null

  const seen = after === undefined ? -1 : candidates.indexOf(after)
  const index = candidates[(seen + 1) % candidates.length]
  const row = index === undefined ? undefined : dataset.rows[index]
  // 파일이 가리키는 행이 표에 없다. 여기서는 던지지 않는다 - 학생이 누른 것은 편의
  // 기능이고, 진짜 판정은 예측할 때 transform이 시끄럽게 한다.
  if (index === undefined || row === undefined) return null

  const values: Record<string, string> = {}
  for (const field of fields) {
    values[field.name] = row[dataset.columns.indexOf(field.name)] ?? ''
  }
  return { index, values }
}

/**
 * 예측 화면의 한 줄. **모델이 아니라 (실험, run) 쌍이다** (architecture.md 8.13.1).
 *
 * 화면은 "모델 목록"으로 보이지만 각 줄이 매달려 있는 것은 그 실험이다 - 전처리기도
 * 학습 행도 거기서 나온다.
 */
export interface PredictableModel {
  readonly experiment: Experiment
  readonly run: Run
  /** 못 쓰면 그 사유. 있으면 화면이 이 줄을 끄고 이유를 함께 보여준다 (§8.2). */
  readonly reason?: ClientErrorCode
}

/**
 * 예측에 쓸 수 있는 것과 없는 것. **지우지 않고 사유와 함께 끈다** (architecture.md 8.2).
 *
 * 사유는 셋이고 전부 다른 말이다 - 학생이 할 수 있는 일이 다르기 때문이다.
 *
 * - `MODEL_FORMAT_UNSUPPORTED` — 이 빌드가 모르는 형식이다. 앱을 최신으로 바꾼다.
 * - `MODEL_NEEDS_DATASET` — 원본 데이터가 있어야 하는데 파일에 없다. 데이터를 가진
 *   파일로 다시 연다 (mlpx-spec.md 5.0).
 * - `MODEL_FILE_INVALID` — 모델이 파일에 안 담겼다(`modelOmitted`). 그 사유는 §4.2가
 *   따로 들고 있고, 여기서는 "이 줄로는 예측할 수 없다"까지만 말한다.
 *
 * **형식 이름을 보고 가르지 않는다** (mlpx-spec.md 5.0). 판정에 쓰는 것은 등록부의
 * 불리언 둘뿐이라, 형식이 늘어도 이 함수는 안 바뀐다.
 */
export function predictableModels(
  document: ProjectDocument,
  hasDataset: boolean,
): PredictableModel[] {
  const list: PredictableModel[] = []

  // 최신 실험이 위다. 결과 화면의 세로줄과 같은 순서여야 학생이 같은 것을 같은 자리에서
  // 찾는다 (architecture.md 8.13).
  for (const experiment of [...document.runs.experiments].reverse()) {
    for (const run of experiment.runs) {
      if (run.status !== 'done') continue

      const model = run.model
      // 지표만 남은 run이다. 왜 안 담겼는지는 run.modelOmitted가 들고 있다.
      if (!model) {
        list.push({ experiment, run, reason: 'MODEL_FILE_INVALID' })
        continue
      }

      const interpreter = interpreterFor(model.format)
      if (!interpreter) {
        list.push({ experiment, run, reason: 'MODEL_FORMAT_UNSUPPORTED' })
        continue
      }
      if (interpreter.needsTrainingRows && !hasDataset) {
        list.push({ experiment, run, reason: 'MODEL_NEEDS_DATASET' })
        continue
      }
      // 전처리기가 없으면 자체 JSON 모델은 좌표계를 못 세운다 (mlpx-spec.md 5).
      // 정상 경로에서는 함께 담기지만, 남이 편집한 파일에서는 갈릴 수 있다.
      if (!interpreter.includesPreprocessing && !experiment.preprocessor) {
        list.push({ experiment, run, reason: 'MODEL_FILE_INVALID' })
        continue
      }

      list.push({ experiment, run })
    }
  }

  return list
}

/**
 * 모델 하나의 답 (architecture.md 8.13.1).
 *
 * **컴포넌트가 아니라 여기서 정의한다.** 필터·집계·강조가 전부 이 모양을 놓고 판정하는
 * 순수 함수이고, 화면 파일에 두면 화면이 아닌 코드가 화면 파일에 기대게 된다.
 */
export interface Answer {
  /**
   * 모델이 낸 값. 실패했으면 없다.
   *
   * **분류는 라벨(문자열), 회귀는 수치다.** 수치를 미리 문자열로 굳히지 않는 이유는
   * 어떻게 쓸지가 언어에 달렸기 때문이다 (docs/i18n.md 규칙 6).
   */
  readonly value?: Prediction
  /** 이 모델에서만 난 실패. 코드는 `client.*`이거나 `errors.*`다. */
  readonly failure?: { code: ClientErrorCode; params: Record<string, unknown> }
}

/**
 * 예측 화면의 필터. **실험 × 알고리즘의 다중 선택이다** (architecture.md 8.13.1).
 *
 * **무엇을 뺐는지가 아니라 무엇이 보이는지를 든다.** "빈 필터"가 "전부 안 보임"인지
 * "전부 보임"인지 헷갈릴 자리를 아예 없앤다.
 */
export interface PredictFilter {
  readonly experimentIds: ReadonlySet<string>
  readonly algorithms: ReadonlySet<string>
}

/** 필터의 기본값 — **지금 있는 모델이 전부 보이는 상태**다 (architecture.md 8.13.1). */
export function defaultFilter(models: readonly PredictableModel[]): PredictFilter {
  return {
    experimentIds: new Set(models.map((model) => model.experiment.id)),
    algorithms: new Set(models.map((model) => model.run.algorithm)),
  }
}

/** 필터를 지나는 모델만 남긴다. 실험과 알고리즘 둘 다 걸려야 보인다. */
export function applyPredictFilter(
  models: readonly PredictableModel[],
  filter: PredictFilter,
): PredictableModel[] {
  return models.filter(
    (model) =>
      filter.experimentIds.has(model.experiment.id) && filter.algorithms.has(model.run.algorithm),
  )
}

/** 값 하나와 그 값을 낸 모델 수. */
export interface AnswerCount {
  readonly value: Prediction
  readonly count: number
}

/**
 * 분류 답의 값별 집계 (architecture.md 8.13.1 "답을 거르고 세어 본다").
 *
 * **회귀는 뺀다.** 답이 연속값이라 부동소수 두 개가 정확히 같을 일이 실질적으로 없고,
 * 그러면 집계표가 거의 항상 "1"만 늘어선 장식이 된다.
 *
 * **답을 낸 모델만 센다.** 사유로 꺼진 모델과 예측이 실패한 모델은 목록에는 남지만
 * 표에는 안 들어간다 — 표가 세는 것은 "답"이지 "카드"가 아니다.
 */
export function tallyClassificationAnswers(
  models: readonly PredictableModel[],
  answers: ReadonlyMap<string, Answer>,
): AnswerCount[] {
  const counts = new Map<Prediction, number>()

  for (const model of models) {
    if (model.experiment.settings.taskType !== 'classification') continue
    const value = answers.get(model.run.id)?.value
    if (value === undefined) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }

  return [...counts].map(([value, count]) => ({ value, count }))
}

/**
 * 가장 많이 나온 답 (architecture.md 8.13.1 "부르는 이름은 `가장 많이 나온 답`이다").
 * **`과반수`가 아니다** — 세 값으로 갈리면 최다가 절반이 안 될 수 있다.
 *
 * **동점이거나 값 종류가 하나뿐이면 없다.** 값이 하나뿐이면 보여줄 갈림이 없고,
 * 동점에 색을 얹으면 없는 승자를 지어내는 것이다 — `bestByMetric`이 모델 하나짜리
 * 실험에서 빈 값을 내는 것과 같은 규칙이다.
 */
export function majorityAnswer(tally: readonly AnswerCount[]): Prediction | null {
  if (tally.length < 2) return null

  const max = Math.max(...tally.map((entry) => entry.count))
  const leaders = tally.filter((entry) => entry.count === max)
  return leaders.length === 1 ? (leaders[0]?.value ?? null) : null
}
