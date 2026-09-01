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
import {
  dataSnapshot,
  type Experiment,
  type ModelOmissionReason,
  type ProjectDocument,
  type Run,
} from '../project/schema'
import type { Prediction } from './metrics'
import { interpreterFor, type LoadContext, type Predict, type ProbaModel } from './models'
import { succeeded } from './results'
import {
  parsePreprocessor,
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
 * ① 이 실험의 훈련 행을 만든다. **참조형 모델이 없으면 부를 이유가 없다**
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
  const { trainIndices } = experiment.settings
  // 참조형 모델은 표에만 있다 — 이미지 예측은 임베딩 위에서 돌고 경로가 따로 선다.
  const { target, preprocessing } = dataSnapshot('tabular', experiment.settings)
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
 * 값으로 예측했다고 믿는데 실제로는 훈련 데이터의 평균이 들어간다. 결측 전략 `none`을 거부하는
 * 것과 같은 판단이다 (open-decisions.md "전처리도 분할도 끌 수 있다").
 *
 * **여기서 "열이 없다"를 말하지는 않는다.** 이 함수가 받는 것은 표가 아니라 값 하나짜리
 * 사전이고, **한 줄 입력에서는 아직 안 건드린 칸이 아예 키가 없다**
 * (`views/predict/TabularPredictPanel.vue`의 `values`는 빈 객체에서 시작한다.
 * 판이 갈리면서 `PredictView.vue`에서 옮겨 왔다) - 여기서 `undefined`를 "열이 없다"로 읽으면 학생이
 * 칸 하나를 비워 둔 것을 파일 탓으로 돌린다. 그 판정은 표를 아는 `predictPage`가 한다.
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
    dataSnapshot('tabular', experiment.settings).preprocessing.categoricalEncoding,
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
 * `inputVector`가 그냥 지나친다. 범주 목록도 합친다: 훈련 데이터가 달라 못 본 범주가 있을 수
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
 * 판단이다). 범위 밖 값을 넣어 보는 것은 이 도구에서 **해 볼 만한 일**이다 — 훈련 데이터
 * 밖에서 모델이 어떻게 구는지가 수업에서 가장 좋은 장면 중 하나다.
 *
 * **전체 행을 본다.** 훈련 데이터만 보면 화면이 말하는 범위와 학생이 표에서 본 범위가 달라진다.
 */
/**
 * 수치 칸에 붙는 힌트의 범위. **가진 표를 전부 훑는다.**
 *
 * **한 표만 보면 화면이 자기모순에 빠진다.** [랜덤으로 하나 가져오기]가 주는 행은 그
 * 실험의 테스트 몫이고, 테스트 데이터를 파일로 따로 붙였으면 그 행은 `test.csv`에서 온다
 * (mlpx-spec.md §1.1). `data.csv`만 보고 범위를 적으면 **화면이 스스로 채워 넣은 값이
 * 그 범위 밖에** 있게 된다.
 *
 * **실험과 무관해야 한다.** 칸은 하나인데 실험은 여럿이고 분할도 저마다 다르므로, 어느
 * 실험의 테스트 몫인지를 화면이 정할 수 없다. 그래서 분할 이전의 원본을 본다.
 *
 * 표마다 열 순서가 다를 수 있어 이름으로 다시 찾는다.
 */
export function numericRanges(
  datasets: readonly Dataset[],
  fields: readonly PredictionField[],
): Map<string, { min: number; max: number }> {
  const ranges = new Map<string, { min: number; max: number }>()

  for (const field of fields) {
    if (field.kind !== 'numeric') continue

    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    for (const dataset of datasets) {
      const column = dataset.columns.indexOf(field.name)
      if (column < 0) continue

      for (const row of dataset.rows) {
        const cell = (row[column] ?? '').trim()
        if (cell === '') continue
        const value = Number(cell)
        if (!Number.isFinite(value)) continue
        if (value < min) min = value
        if (value > max) max = value
      }
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
   * **어느 표의 번호인지는 그 실험이 정한다** - 테스트 행을 준 것이면 `provided`에서
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
  /** 훈련 정본 `dataset/data.csv`. `trainIndices`는 언제나 이 표의 행 번호다. */
  readonly dataset: Dataset
  /** 테스트 정본 `dataset/test.csv`. `split.method`가 `provided`인 실험에만 있다. */
  readonly testDataset?: Dataset | null | undefined
}

/**
 * 표에서 한 줄을 가져온다. **테스트에 쓴 행을 먼저 준다.**
 *
 * 학생이 [예측]으로 보게 되는 것이 **자기가 학습에 쓴 행을 다시 맞히는 장면**이면
 * 아무것도 가르치지 않는다 (architecture.md 8.13.1). 테스트 데이터 행은 모델이 학습 때 못 본
 * 행이라 그 장면이 아니다.
 *
 * **어느 표에서 찾는지는 그 실험의 `split.method`가 정한다** (mlpx-spec.md 1.1).
 * `testIndices`는 `holdout`이면 `data.csv`의 행 번호이고 `provided`면 `test.csv`의 행
 * 번호다. 표를 부르는 쪽이 정하게 두면 **조용히 다른 줄을 채운다** - 열 이름과 순서는
 * 양쪽이 같으므로(정본 순서로 재배열해 저장한다) 화면에 틀린 티가 전혀 안 난다.
 *
 * **`provided`인데 테스트 표가 없으면 훈련 표로 떨어지지 않는다.** 그건 참조와 본체가
 * 한쪽만 있는 상태이고(mlpx-spec.md 1) 그때 훈련 행을 주면 이 함수가 막으려던 바로 그
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

  // 테스트 행이 있으면 그쪽이고, 없으면 훈련 행이다. **그 선택이 표까지 함께 고른다** -
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
 * 훈련 행도 거기서 나온다.
 */
export interface PredictableModel {
  readonly experiment: Experiment
  readonly run: Run
  /** 못 쓰면 그 사유. 있으면 화면이 이 줄을 끄고 이유를 함께 보여준다 (§8.2). */
  readonly reason?: ClientErrorCode
  /**
   * 그 사유의 문장에 채울 값. **사유를 만드는 자리가 함께 만든다** — 화면이 사유만 받고
   * 파라미터를 안 받으면 `({format})`이 빈 괄호로 뜬다 (V11 R5 B-6).
   */
  readonly reasonParams?: Readonly<Record<string, unknown>>
  /**
   * 모델이 파일에 안 담긴 run에서, **왜 안 담겼는지** (`mlpx-spec.md` §4.2).
   *
   * **`reason`과 다른 사실이다.** `MODEL_FILE_INVALID`는 "이 줄로는 예측할 수 없다"까지만
   * 말하는데, 그 문구는 "다시 학습하면 쓸 수 있습니다"로 끝난다 — **`tooLarge`에는
   * 정반대의 조언이다**(앱 자신이 `modelOmission.tooLarge`에서 "다시 학습해도 같다"고
   * 적었다). 화면이 이 값을 보면 맞는 말을 고를 수 있다 (V11 R5 B-7).
   */
  readonly omitted?: ModelOmissionReason
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
      if (!succeeded(run)) continue

      const model = run.model
      // 지표만 남은 run이다. 왜 안 담겼는지는 run.modelOmitted가 들고 있다.
      if (!model) {
        // 지표만 남은 run이다. **왜 안 담겼는지는 run.modelOmitted가 들고 있고**,
        // 그 사실을 함께 넘긴다 - 사유마다 학생이 할 일이 다르다.
        list.push({
          experiment,
          run,
          reason: 'MODEL_FILE_INVALID',
          ...(run.modelOmitted === undefined ? {} : { omitted: run.modelOmitted }),
        })
        continue
      }

      const interpreter = interpreterFor(model.format)
      if (!interpreter) {
        // 무엇이 문제인지 괄호에 적는다 (docs/i18n.md 규칙 5). 안 넘기면 빈 괄호가 뜬다.
        list.push({
          experiment,
          run,
          reason: 'MODEL_FORMAT_UNSUPPORTED',
          reasonParams: { format: model.format },
        })
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
/**
 * 칸 하나가 어떤 상태인가. **표가 넷을 같은 빈 칸으로 그리던 자리다** (V11 R2 감사 B-10).
 *
 * 그전에는 `answer.value`만 봤다. 그래서 **사유로 꺼진 모델**·**빈 값이 있어 못 푼 행**·
 * **모델이 보는 열이 파일에 없는 칸**·**모델이 답을 안 낸 칸**이 화면에서 글자 하나 다르지
 * 않았고, 500행 중 세 줄이 왜 비었는지 학생이 알 방법이 없었다.
 *
 * **화면 밖에 두는 이유는 검사 때문이다.** 칸에 무엇이 그려지는지는 눈으로 봐야 하지만,
 * **무엇이 실패이고 무엇이 없음인가**는 순수 함수라 검사가 물 수 있다.
 */
export type AnswerState = 'value' | 'failed' | 'none'

/**
 * **실패와 없음을 가른다.** `value`가 있으면 답이고, 없는데 `failure`가 있으면 실패이며,
 * 둘 다 없으면 아직 아무 일도 안 일어난 칸이다(계산 안 한 쪽·필터 밖).
 *
 * `value`를 먼저 보는 것이 중요하다 — 값이 나왔는데 부수적인 실패가 함께 담긴 칸은
 * **답이 있는 칸**이다.
 */
export function answerState(answer: Answer | undefined): AnswerState {
  if (answer?.value !== undefined) return 'value'
  return answer?.failure === undefined ? 'none' : 'failed'
}

export interface Answer {
  /**
   * 모델이 낸 값. 실패했으면 없다.
   *
   * **분류는 라벨(문자열), 회귀는 수치다.** 수치를 미리 문자열로 굳히지 않는 이유는
   * 어떻게 쓸지가 언어에 달렸기 때문이다 (docs/i18n.md 규칙 6).
   */
  readonly value?: Prediction
  /**
   * 클래스별 확률. **확률을 내는 모델에만 있다** (mlpx-spec.md 5.4 — 지금은 로지스틱
   * 회귀뿐이다). 포화해서 못 낸 행에도 없다.
   *
   * **클래스 이름을 함께 든다.** 값만 있으면 어느 칸이 어느 범주인지 화면이 모델 파일을
   * 다시 뒤져야 하고, 그 순간 화면이 형식을 알게 된다. `classes`와 `values`는 같은
   * 순서·같은 길이다.
   *
   * **`value`를 여기서 다시 구하지 마라.** 포화 구간에서 argmax와 라벨이 갈린다.
   */
  readonly probabilities?: {
    readonly classes: readonly string[]
    readonly values: Float64Array
  }
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

/**
 * 한 번 섞은 새 배열. **제자리에서 안 바꾼다** - 원본을 공유하는 곳이 있으면 그쪽이 놀란다.
 *
 * 색 팔레트를 섞는 데 쓴다 (architecture.md §8.13.1). 등수와 색의 대응을 고정하면
 * 분류가 대개 두세 갈래라 앞의 두 색만 늘 쓰이고 나머지가 안 쓰인 채로 남는다.
 *
 * **두 화면이 글자까지 같은 사본을 들고 있었다** (V11 R4 C-2). 팔레트를 안 나누는
 * 결정은 문서가 있지만 함수까지 복제할 이유는 없다.
 */
export function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(Math.random() * (index + 1))
    const held = copy[index]!
    copy[index] = copy[pick]!
    copy[pick] = held
  }
  return copy
}

/** 필터 한 축의 선택지. **화면 부품이 아니라 여기서 만든다** (아래 두 함수). */
export interface FilterOption {
  readonly id: string
  readonly label: string
}

/**
 * 실험 id -> 전처리기. **파일에서 실제로 읽어 봐야 아는 것이라 순수 판정이 못 한다.**
 *
 * 못 읽는 것은 그냥 빠진다 — 남이 손으로 고친 파일에서 올 수 있고, 그 실험의 모델은
 * 좌표계를 못 세운다. 그 사실을 화면에 말하는 것은 `withPreprocessorReason`이다.
 *
 * **두 예측 판이 이 계산을 각자 들고 있었다** (V11 R4 B-7). 두 벌이면 반드시 어긋나고,
 * 실제로 어긋나 있었다 — 표 판만 아래 사유 층을 갖고 이미지 판은 안 가졌다.
 */
export function readPreprocessors(
  document: ProjectDocument,
  files: ReadonlyMap<string, Uint8Array>,
): Map<string, Preprocessor> {
  const found = new Map<string, Preprocessor>()
  for (const experiment of document.runs.experiments) {
    const path = experiment.preprocessor?.path
    const bytes = path === undefined ? undefined : files.get(path)
    if (bytes === undefined) continue
    try {
      found.set(experiment.id, parsePreprocessor(JSON.parse(new TextDecoder().decode(bytes))))
    } catch {
      // 못 읽은 전처리기다. 사유는 withPreprocessorReason이 붙인다.
    }
  }
  return found
}

/**
 * 전처리기를 못 읽는 모델에 사유를 붙인다. `predictableModels` 위에 한 겹 더 얹는 것이다.
 *
 * **전처리기가 필요한지는 모델이 말한다** (mlpx-spec.md §5). 전처리를 그래프에 담는
 * 형식은 혼자 서므로 이 겹에 안 걸린다 — 형식 이름을 보고 가르면 등록부가 있는 이유가
 * 없어진다.
 *
 * **이 겹이 없으면 카드가 "계산 중"에 영원히 머문다.** 이미지 판이 그랬다 — 답을 못
 * 내는 run을 조용히 건너뛰어서, 학생 눈에는 계산 중인지 고장인지 구별이 안 됐다.
 */
export function withPreprocessorReason(
  models: readonly PredictableModel[],
  preprocessors: ReadonlyMap<string, Preprocessor>,
): PredictableModel[] {
  return models.map((entry) => {
    if (entry.reason) return entry
    const standalone = interpreterFor(entry.run.model?.format ?? '')?.includesPreprocessing === true
    const ready = standalone || preprocessors.has(entry.experiment.id)
    return ready ? entry : { ...entry, reason: 'MODEL_FILE_INVALID' as ClientErrorCode }
  })
}

/**
 * 지금 있는 실험·알고리즘의 지문. **이게 바뀔 때만 필터를 다시 연다.**
 *
 * 없어진 것을 선택한 채로 두면 아무것도 안 보이는 필터가 조용히 생기고, 매번 다시
 * 열면 학생이 고른 것이 계속 풀린다. 그 사이를 이 문자열이 가른다.
 */
export function filterAxisSignature(models: readonly PredictableModel[]): string {
  const experiments = [...new Set(models.map((entry) => entry.experiment.id))].sort()
  const algorithms = [...new Set(models.map((entry) => entry.run.algorithm))].sort()
  return `${experiments.join(',')}|${algorithms.join(',')}`
}

/** 실험 축의 선택지. **모델 목록에 나오는 순서**를 지킨다 - 화면의 세로줄과 같다. */
export function experimentFilterOptions(
  models: readonly PredictableModel[],
  names: ReadonlyMap<string, string>,
): FilterOption[] {
  const seen = new Set<string>()
  const list: FilterOption[] = []
  for (const entry of models) {
    if (seen.has(entry.experiment.id)) continue
    seen.add(entry.experiment.id)
    list.push({
      id: entry.experiment.id,
      label: names.get(entry.experiment.id) ?? entry.experiment.id,
    })
  }
  return list
}

/** 알고리즘 축의 선택지. `label`이 등록부 문구를 번역한다 (docs/i18n.md). */
export function algorithmFilterOptions(
  models: readonly PredictableModel[],
  label: (algorithm: string) => string,
): FilterOption[] {
  const seen = new Set<string>()
  const list: FilterOption[] = []
  for (const entry of models) {
    if (seen.has(entry.run.algorithm)) continue
    seen.add(entry.run.algorithm)
    list.push({ id: entry.run.algorithm, label: label(entry.run.algorithm) })
  }
  return list
}

/** 필터의 기본값 — **지금 있는 모델이 전부 보이는 상태**다 (architecture.md 8.13.1). */
export function defaultFilter(models: readonly PredictableModel[]): PredictFilter {
  return {
    experimentIds: new Set(models.map((model) => model.experiment.id)),
    algorithms: new Set(models.map((model) => model.run.algorithm)),
  }
}

/**
 * 필터의 축. **화면이 이 이름으로 어느 집합을 건드릴지 정한다** — 축이 늘면 여기에
 * 하나를 더하는 것으로 끝나야 하고, 화면이 자기 나름의 문자열을 쓰기 시작하면 그 순간
 * 두 경로가 갈린다.
 */
export type FilterAxisId = 'experiment' | 'algorithm'

/** 그 축이 든 집합. **어느 필드를 건드릴지를 한 자리에서 정한다.** */
function setOf(filter: PredictFilter, axis: FilterAxisId): ReadonlySet<string> {
  return axis === 'experiment' ? filter.experimentIds : filter.algorithms
}

function withSet(
  filter: PredictFilter,
  axis: FilterAxisId,
  next: ReadonlySet<string>,
): PredictFilter {
  return axis === 'experiment'
    ? { ...filter, experimentIds: next }
    : { ...filter, algorithms: next }
}

/** 칩 하나를 켜거나 끈다. */
export function toggleFilter(filter: PredictFilter, axis: FilterAxisId, id: string): PredictFilter {
  const next = new Set(setOf(filter, axis))
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return withSet(filter, axis, next)
}

/**
 * 축 하나를 통째로 켜거나 끈다. **전부 켜져 있으면 끄고, 아니면 전부 켠다** — 버튼
 * 하나가 두 일을 하므로 화면은 지금 어느 쪽인지를 `isAllSelected`로 물어 이름을 정한다.
 *
 * **판정을 화면에 두지 않는 이유**는 이름과 동작이 각자 판정하면 어긋나기 때문이다 —
 * [전체 해제]라고 적힌 버튼이 전부 켜는 일이 생긴다.
 */
export function toggleAllFilter(
  filter: PredictFilter,
  axis: FilterAxisId,
  ids: readonly string[],
): PredictFilter {
  const next = isAllSelected(filter, axis, ids) ? new Set<string>() : new Set(ids)
  return withSet(filter, axis, next)
}

/** 그 축이 전부 켜져 있는가. 켤 것이 없으면 켜진 것도 없다. */
export function isAllSelected(
  filter: PredictFilter,
  axis: FilterAxisId,
  ids: readonly string[],
): boolean {
  const set = setOf(filter, axis)
  return ids.length > 0 && ids.every((id) => set.has(id))
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

/**
 * **답으로 나온 범주**의 확률. 확률이 없으면 `null`이다.
 *
 * **최댓값을 고르지 않는다.** `value`와 이름을 대조해 그 칸을 찾는다 — 포화 구간에서는
 * argmax와 라벨이 갈릴 수 있고(mlpx-spec.md 5.4), 최댓값을 쓰면 표가 "FALSE라고 답해
 * 놓고 TRUE의 확률"을 쓴다. 답 옆에 붙는 숫자는 **그 답의 확신**이어야 한다.
 *
 * 회귀는 애초에 `probabilities`가 없으므로 자연히 `null`이다.
 */
export function chosenProbability(answer: Answer | undefined): number | null {
  const proba = answer?.probabilities
  if (!proba || answer?.value === undefined) return null
  const index = proba.classes.indexOf(String(answer.value))
  return index < 0 ? null : (proba.values[index] ?? null)
}

/**
 * 이 모델의 답이 **군집 번호**인가.
 *
 * **화면이 과제 유형을 보지 않게 한다** (architecture.md §9.1) — `answerRank`가 분류에만
 * 등수를 주는 것과 같은 모양이다. 답 카드는 이것만 보고 `0` 대신 `0번 군집`이라고 쓴다.
 *
 * **군집 번호를 그대로 쓰면 분류의 라벨 `0`이나 회귀의 값 `0`과 글자가 같다.** 화면에서
 * 실제로 그렇게 났다 (2026-08-11).
 */
export function answersInClusters(model: PredictableModel): boolean {
  return model.experiment.settings.taskType === 'clustering'
}

/**
 * 군집 답의 번호. 군집 답이 아니거나 번호로 안 읽히면 `null`이다.
 *
 * **답은 문자열로 온다** — `mlpx-kmeans-v1`이 `"0"`, `"1"`을 돌려준다(`ml/models/kmeans.ts`).
 * 화면이 그것을 잊고 `typeof value === 'number'`로 물으면 **아무 일도 안 일어나면서
 * 아무 데도 안 우는 결함**이 된다 — 실제로 그렇게 나갔다(2026-08-14, 답에 팝오버가
 * 안 붙었다). 그래서 묻는 자리를 여기 하나로 둔다.
 *
 * `Number()`가 아니라 정수인지까지 본다. 분류 라벨이 `"3"`인 데이터가 실제로 있고,
 * 그건 군집 번호가 아니다 — 판정을 유형에서 먼저 거르는 이유도 그것이다.
 */
export function clusterNumberOf(
  model: PredictableModel,
  value: Prediction | undefined,
): number | null {
  if (value === undefined || !answersInClusters(model)) return null
  const cluster = Number(value)
  return Number.isInteger(cluster) ? cluster : null
}

/**
 * 보이는 모델 중에 **군집 번호로 답할 모델**이 있는가. 있으면 화면이 번호의 뜻을 한 줄로
 * 말한다 (open-decisions.md "머리글은 목록 밖에 선다").
 *
 * **답을 보지 않는다.** 전에는 답이 실제로 나온 뒤에만 참이라 안내가 [예측] 뒤에 떴는데,
 * 서로 다른 학습의 `2번 군집`이 같은 것이 아니라는 사실은 **답을 읽기 전에** 알아야
 * 오독을 막는다. 조용한 오독이라 학생이 스스로 알아챌 방법이 없다.
 *
 * **필터를 지난 목록을 그대로 받는다** — 군집 모델을 걸러 낸 학생에게는 이 문장이
 * 할 말이 없다.
 *
 * **그래도 답이 설 자리는 있어야 한다** (`hasAnswerArea`, 2026-08-14 사용자). 사진을
 * 하나도 안 올린 예측 화면은 통째로 빈 상태인데, 그 아래에 주의색 한 줄만 떠 있으면
 * 학생은 **자기가 뭘 잘못한 줄 안다** — 실제로 그렇게 보였다. 이 칸이 필수인 이유는
 * 화면마다 답이 없는 모양이 다르기 때문이다: 표는 값 입력 줄이 언제나 있어서 참이고,
 * 이미지는 사진이 있어야 참이다.
 */
export function showsClusterNames(
  models: readonly PredictableModel[],
  hasAnswerArea: boolean,
): boolean {
  return hasAnswerArea && models.some((model) => answersInClusters(model))
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
 * 답 값별 등수 (architecture.md 8.13.1 "값마다 다른 색"). **개수가 많은 값이
 * 0등이다.** 값마다 다른 색을 매기려면 갈림표 칩과 카드가 같은 등수 하나를 같은
 * 색으로 봐야 한다 - 두 곳이 각자 등수를 매기면 어긋날 자리가 생긴다.
 *
 * **값이 하나뿐이면 없다.** 갈리지 않은 것에 색을 매기면 없는 갈림을 지어내는
 * 것이다. **동점은(1등이 여럿) 등수를 매긴다** - "몇 등인가"가 아니라 "그 값들이
 * 서로 다른 색인가"만 있으면 되므로, 승자를 못 정한다는 사실이 색칠을 막을
 * 이유가 안 된다(과거의 `majorityAnswer`는 "누가 1등인지"를 승패로 읽었기
 * 때문에 동점을 비웠다 - 색이 정체성일 뿐인 지금은 그 이유가 없다).
 */
export function rankAnswers(tally: readonly AnswerCount[]): ReadonlyMap<Prediction, number> | null {
  if (tally.length < 2) return null

  const sorted = [...tally].sort((a, b) => b.count - a.count)
  return new Map(sorted.map((entry, index) => [entry.value, index]))
}

/**
 * **화면 전체의 등수** — 여러 벌의 답을 모아 한 번 매긴다 (architecture.md §8.13.1).
 *
 * **사진 예측은 답이 사진 수만큼 있다.** 벌마다 따로 매기면 `몰루 1개 · 0 1개`처럼
 * 동점일 때 정렬이 뒤집혀 **같은 답이 사진마다 다른 색**을 받는다. 실제로 그렇게 났다.
 *
 * **개수는 여기서 안 쓴다.** 칩이 보여주는 수는 그 사진에 대한 사실이라 벌마다 따로
 * 세고(`tallyClassificationAnswers`), 이 함수가 정하는 것은 **색의 순서뿐**이다.
 *
 * 표 예측은 벌이 하나라 결과가 `rankAnswers(tally)`와 같다.
 */
export function rankAnswersAcross(
  models: readonly PredictableModel[],
  answerSets: Iterable<ReadonlyMap<string, Answer>>,
): ReadonlyMap<Prediction, number> | null {
  const counts = new Map<Prediction, number>()
  for (const answers of answerSets) {
    for (const entry of tallyClassificationAnswers(models, answers)) {
      counts.set(entry.value, (counts.get(entry.value) ?? 0) + entry.count)
    }
  }
  return rankAnswers([...counts].map(([value, count]) => ({ value, count })))
}

/**
 * 이 모델의 답 등수. **분류에만, 등수가 있을 때만 있다** (architecture.md 8.13.1).
 *
 * **화면이 아니라 여기 있다** (§9.1). "다수결은 분류에만 있다"는 위 집계가 이미 아는
 * 사실이고, 같은 사실을 화면이 한 번 더 알면 둘이 갈라질 자리가 생긴다. 예측 화면에는
 * **여러 실험의 모델이 섞여 설 수 있어서** 유형을 모델마다 봐야 한다 - 집계가
 * 걸러 줬으니 괜찮다고 넘길 수 없는 이유다.
 */
export function answerRank(
  model: PredictableModel,
  answers: ReadonlyMap<string, Answer>,
  ranks: ReadonlyMap<Prediction, number> | null,
): number | null {
  if (model.experiment.settings.taskType !== 'classification') return null
  if (ranks === null) return null
  const value = answers.get(model.run.id)?.value
  if (value === undefined) return null
  return ranks.get(value) ?? null
}

/**
 * 값별 색 배정 - **처음 본 순서대로, 한 번 준 색은 안 바꾼다** (architecture.md
 * §8.13.1 "일괄 예측 표의 셀도 값별로 다른 색"). `rankAnswers`처럼 개수 순으로
 * 매기지 않는 이유는 여기가 **페이지로 끊겨 있기 때문**이다 - 파일 전체의 분포를
 * 모르는 채로 한 페이지씩 계산하므로(연산 억제, 위 `predictPage`), "몇 번째로
 * 많이 나왔는가"를 매길 수 없다. 대신 **이미 배정된 값은 그대로 두고, 새 페이지에서
 * 처음 보는 값에만 다음 색을 준다** - 그래야 페이지를 앞뒤로 오가도 같은 값이
 * 같은 색으로 남는다.
 *
 * **`existing`을 그대로 확장한다.** 화면이 페이지를 넘길 때마다 이 함수를 다시
 * 부르며 그 전까지 쌓인 맵을 넘긴다 - 매번 새로 세면 이미 배정된 색이 바뀔 수 있다.
 *
 * **`maxColors`를 넘기면 더 안 준다.** 그 값은 계속 색이 없는 채로 남는다(§8.13.1
 * "값마다 다른 색"의 일곱 개 제한과 같다). 무엇이 일곱 개 안에 드는지는 페이지를
 * 넘긴 순서에 달려 있다 - 파일 전체를 먼저 세어 두면 결정적이 되겠지만 그러려면
 * 페이지네이션의 연산 억제를 우회해야 한다(architecture.md §8.13.1의 열린 여지 참고).
 */
export function assignAnswerColors(
  models: readonly PredictableModel[],
  answers: readonly (readonly Answer[])[],
  existing: ReadonlyMap<Prediction, number>,
  maxColors: number,
): ReadonlyMap<Prediction, number> {
  const next = new Map(existing)
  for (const row of answers) {
    for (const [index, model] of models.entries()) {
      if (model.experiment.settings.taskType !== 'classification') continue
      if (next.size >= maxColors) continue
      const value = row[index]?.value
      if (value === undefined || next.has(value)) continue
      next.set(value, next.size)
    }
  }
  return next.size === existing.size ? existing : next
}

/**
 * 이 셀의 색 인덱스. **분류이고 색이 배정된 값일 때만 있다** (architecture.md
 * §8.13.1). `answerRank`와 같은 이유로 화면이 아니라 여기 있다(§9.1) - 일괄 예측
 * 표는 여러 실험의 모델이 열로 섞여 서므로, 유형은 모델(열)마다 봐야 한다.
 */
export function cellColorIndex(
  model: PredictableModel,
  value: Prediction | undefined,
  colors: ReadonlyMap<Prediction, number>,
): number | null {
  if (model.experiment.settings.taskType !== 'classification') return null
  if (value === undefined) return null
  return colors.get(value) ?? null
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
 * **모델에 넣기 직전에 그 모델이 보는 열이 파일에 다 있는지 다시 본다**
 * (open-decisions.md "붙일 때 본 것을 예측 직전에 다시 본다", 2026-08-07). 파일을 받을 때
 * 이미 검사했지만 **그것은 붙이던 그 순간의 사실이다** - 학생이 그 뒤에 특성을 바꿔
 * 재학습하면 지금 필요한 열이 그 파일에 없을 수 있다. 없는 열을 `inputVector`에 그대로
 * 태우면 빈 칸으로 읽혀 `PREDICTION_INPUT_INCOMPLETE`가 나고, 화면이 **틀린 사유**를 말한다
 * (값이 빈 것이 아니라 열이 없는 것이다 - 학생이 할 일은 파일을 다시 올리는 것이다).
 *
 * **행이 아니라 모델마다 한 번 본다.** 파일의 열 목록은 행마다 같으므로 행 안에서 다시
 * 볼 이유가 없다 - 5천 행 × 모델 5개면 그 차이가 실제로 느껴진다.
 *
 * **반환은 `rows[행][모델]`이다.** `models`와 같은 순서·같은 길이의 배열이 행마다 있다.
 */
export function predictPage(
  models: readonly PredictableModel[],
  rows: readonly Readonly<Record<string, string>>[],
  preprocessors: ReadonlyMap<string, Preprocessor>,
  predictors: ReadonlyMap<string, Predict>,
  /**
   * 확률을 내는 모델만 여기 있다 (mlpx-spec.md 5.4). **빈 Map을 넘기면 확률이 없다.**
   * 선택 인자로 두지 않는 이유는, 안 넘긴 것과 낼 모델이 없는 것이 같아 보이면 배선을
   * 빠뜨려도 화면이 조용히 멀쩡해 보이기 때문이다.
   */
  probaModels: ReadonlyMap<string, ProbaModel>,
  /**
   * 파일에 실제로 있는 열 이름. **행의 키가 아니라 표의 열 목록이다** - 행에서 뽑으면
   * 열이 있는데 값이 다 빈 경우와 열 자체가 없는 경우를 못 가른다.
   */
  columns: readonly string[],
): Answer[][] {
  const available = new Set(columns)

  // 행과 무관한 판정을 먼저 끝낸다. 여기서 답이 정해진 모델은 모든 행에서 같은 칸이다.
  const prepared = models.map(
    (
      model,
    ):
      Answer | { preprocessor: Preprocessor; predict: Predict; proba?: ProbaModel | undefined } => {
      if (model.reason) return {}

      const preprocessor = preprocessors.get(model.experiment.id)
      const predict = predictors.get(model.run.id)
      // 여기까지 왔는데 없으면 화면이 predictableModels()의 판정과 다른 것을 넘긴 것이다.
      if (!preprocessor || !predict) {
        return { failure: { code: 'MODEL_FILE_INVALID', params: { field: 'payload' } } }
      }

      const missing = preprocessor.columns
        .map((column) => column.name)
        .filter((name) => !available.has(name))
      if (missing.length > 0) {
        return { failure: { code: 'PREDICT_DATASET_COLUMN_MISSING', params: { columns: missing } } }
      }

      return { preprocessor, predict, proba: probaModels.get(model.run.id) }
    },
  )

  return rows.map((values) =>
    prepared.map((entry, index): Answer => {
      if (!('predict' in entry)) return entry

      // models와 prepared는 같은 순서·같은 길이다 - 위에서 map으로 만들었다.
      const model = models[index]!
      try {
        const vector = inputVector(model.experiment, entry.preprocessor, values)
        const [value] = entry.predict([vector])
        if (value === undefined) return {}

        // **라벨을 다시 구하지 않는다.** 확률은 위에서 나온 답에 덧붙는 것뿐이다.
        const { proba } = entry
        const row = proba?.predict([vector])[0]
        return proba && row
          ? { value, probabilities: { classes: proba.classes, values: row } }
          : { value }
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
 * **들어가는 것 넷 - 예측 파일의 해시, 보이는 모델 목록, 전처리 설정, 그리고 판 크기.**
 * 하나라도 바뀌면 이전 페이지의 답은 다른 것을 잰 값이므로 화면이 캐시를 통째로 버려야
 * 한다. 순수 문자열 비교면 되므로 해시는 안 쓴다 - 굳이 압축할 만큼 크지 않다.
 *
 * **모델마다 자기 실험의 전처리 설정을 함께 싣는다.** 실험은 지울 수 없고 전처리기는
 * 학습 시점에 확정되어 안 바뀌지만(mlpx-spec.md §4), "보이는 모델 목록"만으로는 같은
 * run id가 가리키는 설정이 달라졌는지까지는 말해 주지 않는다 - 여기서 명시적으로 함께
 * 싣어 둔다.
 *
 * **판 크기가 넷째로 들어온 것은 상한 해제 때문이다** (2026-09-01, `limits-switch.ts`).
 * 캐시의 열쇠가 **쪽 번호**라 판 크기가 바뀌면 같은 번호가 다른 행을 가리킨다 — 학생이
 * 마지막 쪽에서 상한을 풀면 쪽 수가 1로 줄어드는데 쪽 번호는 2에 남아 **표가 통째로
 * 비었다.** 인자로 받는 이유는 여기다 — 빠뜨릴 수 없어야 한다.
 */
export function predictPageSignature(
  predictDatasetHash: string,
  models: readonly PredictableModel[],
  pageSize: number,
): string {
  const parts = models
    .map(
      (model) => `${model.run.id}:${JSON.stringify(model.experiment.settings.data.preprocessing)}`,
    )
    .sort()
  return `${predictDatasetHash}|${parts.join(',')}|${pageSize}`
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
 *
 * **확률은 열을 따로 세운다** (2026-08-07). 화면 셀은 `FALSE (100%)` 한 덩어리지만 그건
 * 사람이 읽는 모양이고, 파일에 그대로 넣으면 엑셀에서 정렬도 계산도 안 되는 문자열이
 * 된다 - 위 문단이 "예측할 수 없음"을 막는 것과 같은 이유다. sklearn의 `predict_proba`를
 * 열로 받는 모양과도 같아진다.
 *
 * **확률 값은 비율 그대로다.** 퍼센트로 바꾸지도 반올림하지도 않는다 - 자릿수를 줄이는
 * 것은 화면의 일이고(ml/metrics.ts와 같은 규칙), 한 번 자른 자릿수는 되돌릴 수 없다.
 */
export function predictDownloadGrid(
  models: readonly PredictableModel[],
  modelNames: readonly string[],
  /**
   * 모델마다의 확률 열 이름. **확률을 내는 모델만 문자열이고 나머지는 `null`이다.**
   * `models`와 같은 순서·같은 길이여야 한다. 번역은 모델 이름과 같은 이유로 호출부가 한다.
   */
  probabilityNames: readonly (string | null)[],
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
  const header = [
    rowNumberName,
    ...featureColumns,
    // 확률 열은 그 모델 바로 뒤에 붙는다 - 모델이 여럿이면 끝에 몰아 두는 것보다
    // 어느 모델의 확률인지가 눈으로 붙는다.
    ...models.flatMap((_model, index) => {
      const label = modelNames[index] ?? ''
      const probability = probabilityNames[index]
      return probability == null ? [label] : [label, probability]
    }),
  ]

  const body = rows.map((values, rowIndex) => {
    const answerRow = answers[rowIndex] ?? []
    return [
      String(rowIndex + 1),
      ...featureColumns.map((name) => values[name] ?? ''),
      ...models.flatMap((_model, modelIndex) => {
        const answer = answerRow[modelIndex]
        const value = answer?.value
        /**
         * **실패한 칸에는 사유 코드를 적는다** (R6 감사 B-3). 화면은 `—`를 두고 문장을
         * 아래에 세우는데, 여기까지 안 오면 학생이 제출하는 **파일에서는** 실패한 칸과
         * 계산 안 한 칸이 다시 같은 빈 칸이 된다.
         *
         * **문장이 아니라 코드다.** 여기는 눈이 아니라 데이터이고, 사람이 읽는 문자열을
         * 파일에 넣지 않는다 (`CLAUDE.md` §1.4 · `architecture.md` §8.13.1). 실험 기록이
         * 실패를 `failure.code`로 담는 것과 같은 규약이다.
         */
        const cell =
          value !== undefined
            ? formatValue(value)
            : answerState(answer) === 'failed'
              ? (answer?.failure?.code ?? '')
              : ''
        if (probabilityNames[modelIndex] == null) return [cell]

        // 열은 있는데 이 행만 확률이 없을 수 있다 - 포화했거나 그 행에서 실패했거나다.
        const ratio = chosenProbability(answer)
        return [cell, ratio === null ? '' : String(ratio)]
      }),
    ]
  })

  return [header, ...body]
}
