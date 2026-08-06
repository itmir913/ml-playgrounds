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

import { ClientError } from '../errors'
import type { Experiment } from '../project/schema'
import type { LoadContext } from './models'
import { targetValues, transform, type Dataset, type Preprocessor } from './preprocess'

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
