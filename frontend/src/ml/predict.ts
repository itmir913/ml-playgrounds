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

import { ClientError, isClientError, type ClientErrorCode } from '../errors'
import type { Experiment, ProjectDocument, Run } from '../project/schema'
import type { Prediction } from './metrics'
import { interpreterFor, type LoadContext, type Predict } from './models'
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
  /**
   * 뽑아 온 행의 번호. 화면이 "몇 번째 줄을 가져왔다"를 말할 수 있다.
   *
   * **어느 표의 번호인지는 그 실험이 정한다** - 평가 행을 준 것이면 `provided`에서
   * `test.csv`이고 그 밖에는 `data.csv`다 (`sampleRow`).
   */
  readonly index: number
  /** 칸 이름 -> 값. `inputVector`에 그대로 넣을 수 있는 모양이다. */
  readonly values: Record<string, string>
}

/**
 * `sampleRow`가 뒤질 표들. **둘을 함께 받는 이유는 어느 쪽인지를 실험이 정하기 때문이다.**
 */
export interface SampleTables {
  /** 학습 정본 `dataset/data.csv`. `trainIndices`는 언제나 이 표의 행 번호다. */
  readonly dataset: Dataset
  /** 평가 정본 `dataset/test.csv`. `split.method`가 `provided`인 실험에만 있다. */
  readonly testDataset?: Dataset | null | undefined
}

/**
 * 표에서 한 줄을 가져온다. **평가에 쓴 행을 먼저 준다.**
 *
 * 학생이 [예측]으로 보게 되는 것이 **자기가 학습에 쓴 행을 다시 맞히는 장면**이면
 * 아무것도 가르치지 않는다 (architecture.md 8.13.1). 평가셋 행은 모델이 학습 때 못 본
 * 행이라 그 장면이 아니다.
 *
 * **어느 표에서 찾는지는 그 실험의 `split.method`가 정한다** (mlpx-spec.md 1.1).
 * `testIndices`는 `holdout`이면 `data.csv`의 행 번호이고 `provided`면 `test.csv`의 행
 * 번호다. 표를 부르는 쪽이 정하게 두면 **조용히 다른 줄을 채운다** - 열 이름과 순서는
 * 양쪽이 같으므로(정본 순서로 재배열해 저장한다) 화면에 틀린 티가 전혀 안 난다.
 *
 * **`provided`인데 평가 표가 없으면 학습 표로 떨어지지 않는다.** 그건 참조와 본체가
 * 한쪽만 있는 상태이고(mlpx-spec.md 1) 그때 학습 행을 주면 이 함수가 막으려던 바로 그
 * 장면 - 모델이 외운 답 - 을 준다. 아무것도 안 주는 편이 낫다.
 *
 * **무작위로 뽑는다** (architecture.md 8.13.1, 2026-08-06에 순차에서 뒤집었다).
 * `randomState`가 지키는 것은 파일에 기록되고 재실행 대조가 다시 돌리는 것인데, 이
 * 버튼은 입력 칸을 채울 뿐이고 예측 결과는 파일에 안 남는다 - 재현할 대상이 없다.
 * 순차로 두면 반 전체가 첫 줄로 같은 행을 본다.
 *
 * **`exclude`는 빼고 뽑는다.** 눌렀는데 화면이 그대로면 버튼이 고장 난 것으로 읽힌다.
 * 뽑을 것이 하나뿐이면 그것을 다시 준다.
 *
 * **난수원을 인자로 받는다.** 순수 함수로 남아야 테스트가 어느 줄을 뽑는지 확인할 수 있다.
 */
export function sampleRow(
  experiment: Experiment,
  /** 채울 칸들. **전처리기가 아니라 칸을 받는다** - 화면의 칸은 여러 실험의 합집합이다. */
  fields: readonly PredictionField[],
  tables: SampleTables,
  /** 직전에 준 행 번호. 뽑을 것이 둘 이상이면 이것은 빼고 뽑는다. */
  exclude?: number,
  random: () => number = Math.random,
): SampleRow | null {
  const { testIndices, trainIndices } = experiment.settings

  // 평가 행이 있으면 그쪽이고, 없으면 학습 행이다. **그 선택이 표까지 함께 고른다** -
  // trainIndices는 어느 방식에서든 data.csv이고, testIndices만 방식에 따라 갈린다.
  const useTest = testIndices.length > 0
  const candidates = useTest ? testIndices : trainIndices
  const source =
    useTest && experiment.settings.split.method === 'provided' ? tables.testDataset : tables.dataset
  if (candidates.length === 0 || !source) return null

  const rest = exclude === undefined ? candidates : candidates.filter((one) => one !== exclude)
  // 전부 걸러졌으면 후보가 그 한 줄뿐이었다는 뜻이다. 없는 것을 지어내지 않는다.
  const pool = rest.length > 0 ? rest : candidates

  // random()의 계약이 [0, 1)이지만 1을 주는 구현이 있어도 범위를 안 벗어나게 한다.
  const index = pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]
  const row = index === undefined ? undefined : source.rows[index]
  // 파일이 가리키는 행이 표에 없다. 여기서는 던지지 않는다 - 학생이 누른 것은 편의
  // 기능이고, 진짜 판정은 예측할 때 transform이 시끄럽게 한다.
  if (index === undefined || row === undefined) return null

  const values: Record<string, string> = {}
  for (const field of fields) {
    values[field.name] = row[source.columns.indexOf(field.name)] ?? ''
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
 * 이 모델의 답이 가장 많이 나온 답과 같은가. **분류에만, 가장 많이 나온 답이 있을
 * 때만 있다** (architecture.md 8.13.1).
 *
 * **화면이 아니라 여기 있다** (§9.1). "다수결은 분류에만 있다"는 위 집계가 이미 아는
 * 사실이고, 같은 사실을 화면이 한 번 더 알면 둘이 갈라질 자리가 생긴다. 예측 화면에는
 * **여러 실험의 모델이 섞여 설 수 있어서** 유형을 모델마다 봐야 한다 - 집계가
 * 걸러 줬으니 괜찮다고 넘길 수 없는 이유다.
 */
export function answerTone(
  model: PredictableModel,
  answers: ReadonlyMap<string, Answer>,
  majority: Prediction | null,
): 'majority' | 'minority' | null {
  if (model.experiment.settings.taskType !== 'classification') return null
  if (majority === null) return null
  const value = answers.get(model.run.id)?.value
  if (value === undefined) return null
  return value === majority ? 'majority' : 'minority'
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

/**
 * 일괄 예측 (open-decisions.md "일괄 예측은 `행 × 모델` 매트릭스다", architecture.md
 * §8.13.1). **한 페이지 분량의 행에 대해 (실험, run)마다 예측을 돌려 `행 × 모델`
 * 결과를 만든다.**
 *
 * **미리 로드한 predict 함수를 받는다.** 모델 바이트를 zip에서 꺼내 JSON으로 파싱하고
 * `loadModel`을 부르는 일은 이 계층의 몫이 아니다 - `inputVector`가 전처리기를 인자로
 * 받는 것과 같은 경계다(이 계층은 zip을 모른다). 참조형처럼 `LoadContext`가 필요한
 * 모델도 부르는 쪽이 이미 갖춰 넣은 채로 넘긴다.
 *
 * **빈 칸이 있는 행은 그 행·그 모델 칸만 "예측할 수 없음"이다.** `inputVector`가 던지는
 * `PREDICTION_INPUT_INCOMPLETE`를 (행, 모델) 단위로 잡는다 - 모델마다 보는 열이 다를 수
 * 있어(`mergeFields`) 어느 모델은 그 행을 예측하고 어느 모델은 못할 수 있다. 파일 전체를
 * 거부하면 500행 중 한 칸이 비었다고 멀쩡한 499행을 못 본다.
 *
 * 사유로 이미 꺼진 모델(`model.reason`)은 그 칸이 빈 채로(`{}`) 남는다 - 실패가 아니라
 * "애초에 안 돈다"이므로 실패 문구를 붙이지 않는다. 화면이 그 칸을 grey-out으로 이미
 * 보여주고 있어야 한다.
 *
 * **반환은 `rows[행][모델]`이다.** `models`와 같은 순서·같은 길이의 배열이 행마다 있다.
 */
export function predictPage(
  models: readonly PredictableModel[],
  rows: readonly Readonly<Record<string, string>>[],
  preprocessors: ReadonlyMap<string, Preprocessor>,
  predictors: ReadonlyMap<string, Predict>,
): Answer[][] {
  return rows.map((values) =>
    models.map((model): Answer => {
      if (model.reason) return {}

      const preprocessor = preprocessors.get(model.experiment.id)
      const predictor = predictors.get(model.run.id)
      // 여기까지 왔는데 없으면 화면이 predictableModels()의 판정과 다른 것을 넘긴 것이다.
      if (!preprocessor || !predictor) {
        return { failure: { code: 'MODEL_FILE_INVALID', params: { field: 'payload' } } }
      }

      try {
        const vector = inputVector(model.experiment, preprocessor, values)
        const [value] = predictor([vector])
        return value === undefined ? {} : { value }
      } catch (error) {
        return {
          failure: isClientError(error)
            ? { code: error.code, params: error.params }
            : { code: 'MODEL_FILE_INVALID', params: { field: 'payload' } },
        }
      }
    }),
  )
}

/**
 * 페이지 캐시 무효화용 서명 (architecture.md §8.13.1 "한 번 계산한 페이지는 캐시").
 *
 * **들어가는 것 셋 - 예측 파일의 해시, 보이는 모델 목록, 전처리 설정.** 셋 중 하나라도
 * 바뀌면 이전 페이지의 답은 다른 것을 잰 값이므로 화면이 캐시를 통째로 버려야 한다.
 * 순수 문자열 비교면 되므로 해시는 안 쓴다 - 굳이 압축할 만큼 크지 않다.
 *
 * **모델마다 자기 실험의 전처리 설정을 함께 싣는다.** 실험은 지울 수 없고 전처리기는
 * 학습 시점에 확정되어 안 바뀌지만(mlpx-spec.md §4), "보이는 모델 목록"만으로는 같은
 * run id가 가리키는 설정이 달라졌는지까지는 말해 주지 않는다 - 여기서 명시적으로 함께
 * 싣어 둔다.
 */
export function predictPageSignature(
  predictDatasetHash: string,
  models: readonly PredictableModel[],
): string {
  const parts = models
    .map((model) => `${model.run.id}:${JSON.stringify(model.experiment.settings.preprocessing)}`)
    .sort()
  return `${predictDatasetHash}|${parts.join(',')}`
}

/**
 * 내려받을 CSV 격자를 만든다 (open-decisions.md "일괄 예측은 `행 × 모델` 매트릭스다").
 * **전체 행이다 - 지금 보이는 페이지가 아니다.**
 *
 * **열 이름은 번역된 모델 이름이다.** 이 계층은 `t()`를 모르므로 호출부가 이미 만든
 * 이름을 그대로 받는다 - `predict.modelName`이 이미 그 모양이다(같은 알고리즘이 실행
 * 방법만 다르게 둘 이상 있으면 뒤에 실행 방법을 괄호로 붙인다). `models`와 `modelNames`는
 * 같은 순서·같은 길이여야 한다.
 *
 * **특성 열은 `showFeatures`가 켜졌을 때만 낀다.** 화면의 전역 토글을 그대로 따라간다 -
 * 내려받는 순간의 "펼쳐 보기" 상태와 다른 모양이면 학생이 화면에서 본 것과 받은 파일이
 * 다르게 느껴진다.
 *
 * 답을 못 낸 칸(`answer.value`가 없음 - 사유로 꺼졌거나 그 행에서 실패했거나)은 빈
 * 칸이다. 사람이 읽는 "예측할 수 없음" 같은 문장을 넣지 않는다 - 이 파일은 우리가 다시
 * 읽지 않으므로 데이터로서는 빈 칸이 맞고, 문장을 넣으면 언어마다 값이 달라진다.
 */
export function predictDownloadGrid(
  models: readonly PredictableModel[],
  modelNames: readonly string[],
  /**
   * 행 번호 열의 이름. **모델 이름과 같은 이유로 번역된 것을 받는다** - 화면의 표
   * 머리글과 같은 낱말이어야 학생이 받은 파일을 화면과 같은 것으로 읽는다.
   */
  rowNumberName: string,
  rows: readonly Readonly<Record<string, string>>[],
  /** 특성 열 이름들. `.name`만 쓰이므로 `PredictionField`가 아니라 문자열로 받는다. */
  featureNames: readonly string[],
  answers: readonly (readonly Answer[])[],
  showFeatures: boolean,
  formatValue: (value: Prediction) => string,
): string[][] {
  const featureColumns = showFeatures ? featureNames : []
  const header = [rowNumberName, ...featureColumns, ...modelNames]

  const body = rows.map((values, rowIndex) => {
    const answerRow = answers[rowIndex] ?? []
    return [
      String(rowIndex + 1),
      ...featureColumns.map((name) => values[name] ?? ''),
      ...models.map((_model, modelIndex) => {
        const value = answerRow[modelIndex]?.value
        return value === undefined ? '' : formatValue(value)
      }),
    ]
  })

  return [header, ...body]
}
