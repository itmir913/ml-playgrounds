/**
 * **전처리 미리보기** — 다듬기가 표를 어떻게 바꾸는지 다섯 줄로 보인다
 * (open-decisions.md "전처리 미리보기 — 바뀐 표를 다섯 줄로 보인다").
 *
 * **화면 밖에 있는 이유는 여기가 검사할 수 있는 전부이기 때문이다.** 어느 특성이 어느
 * 원본 열에서 나왔는가를 화면에서 세면, 원-핫이 한 칸 밀려도 아무 검사가 안 본다.
 *
 * **계산을 새로 만들지 않는다.** `planRun`이 이미 지은 전처리기를 받고 `transform`을
 * 그대로 부른다 — **학습이 쓰는 그 함수다.** 미리보기가 학습과 다른 답을 낼 길이 없다.
 */

import { transform, type Dataset, type Preprocessor } from './preprocess'
import { PREP_PREVIEW_ROW_COUNT } from '@/limits'
import type { Preprocessing } from '@/project/schema'

/**
 * 이 칸에 앉은 값이 **무엇인가.** 화면이 자릿수를 어떻게 줄지가 이것으로 갈린다.
 *
 * - `raw` — 학생의 자료가 그대로 지나갔다. **우리가 자를 자리가 아니다.**
 * - `scaled` — `(x-중심)/폭`. 계산해 낸 통계라 유효숫자를 줄인다.
 * - `code` — 원-핫의 0/1이거나 순서 인코딩의 번호. 언제나 정수다.
 *
 * **화면에서 세지 않는 이유는 여기가 검사할 수 있는 전부이기 때문이다** — `scale`이
 * 붙었는지는 전처리기가 알고, 그걸 화면이 다시 알아내면 규칙이 두 벌이 된다.
 */
export type PreviewValueKind = 'raw' | 'scaled' | 'code'

/** 원본 열 하나가 만들어 낸 특성 하나. */
export interface PreviewFeature {
  /** 전처리기가 붙인 이름. 원-핫이면 `지역=서울`이다. */
  readonly name: string
  /** 행마다의 값. `rowNumbers`와 자리가 같다. */
  readonly values: readonly number[]
  /** 그 값이 무엇인가. 한 특성 안에서는 행마다 같다. */
  readonly kind: PreviewValueKind
}

/**
 * 미리보기 표의 한 덩어리. **원본 열 하나가 곧 한 덩어리다.**
 *
 * 학생이 물을 질문이 "이 열이 어떻게 됐나"라서 이렇게 묶는다. 전/후 두 표로 나누면
 * 어느 열이 어느 열이 됐는지가 눈으로 안 붙는다.
 */
export interface PreviewColumn {
  /** 원본 열 이름. */
  readonly name: string
  /** 행마다의 원본 칸. 빈 칸은 빈 문자열이다 — 결측이 어디였는지가 보여야 한다. */
  readonly before: readonly string[]
  /**
   * 이 열에서 나온 특성들. **빠진 열은 비어 있다.**
   *
   * 자리를 지우지 않는 이유는, 인코딩을 끈 학생이 **방금 무엇을 잃었는지** 봐야 하기
   * 때문이다. 표에서 지우면 그 열은 애초에 없었던 것처럼 보인다.
   */
  readonly features: readonly PreviewFeature[]
  /** 학습에서 빠졌는가. `features`가 비는 유일한 이유다. */
  readonly excluded: boolean
}

export interface PreprocessPreview {
  /**
   * 보여주는 행의 **원본 번호**(1부터). 띄엄띄엄한 것이 정상이다 — 분할과 뽑기를 지난
   * 뒤라서이고, **그 띄엄띄엄함 자체가 "무작위로 나눴다"를 눈으로 보여준다.**
   */
  readonly rowNumbers: readonly number[]
  readonly columns: readonly PreviewColumn[]
}

/**
 * 이 열이 몇 개의 특성이 되는가. **`fitPreprocessor`가 이름을 미는 순서와 같아야 한다**
 * (ml/preprocess.ts) — 어긋나면 값이 통째로 옆 열 것이 된다.
 */
function widthOf(
  column: Preprocessor['columns'][number],
  encoding: Preprocessing['categoricalEncoding'],
): number {
  if (column.kind !== 'categorical') return 1
  return encoding === 'onehot' ? (column.categories?.length ?? 0) : 1
}

/**
 * 이 열에서 나온 값이 무엇인가. **`transform`이 실제로 하는 일을 그대로 읽는다**
 * (`ml/preprocess.ts`) — 범주 열은 원-핫이든 순서든 정수를 밀고, 수치 열은 `scale`이
 * 붙었을 때만 나눗셈을 지난다.
 */
function valueKindOf(column: Preprocessor['columns'][number]): PreviewValueKind {
  if (column.kind !== 'numeric') return 'code'
  return column.scale ? 'scaled' : 'raw'
}

/**
 * 훈련 데이터의 앞 몇 줄이 전처리를 지나면 어떻게 되는가.
 *
 * **훈련 자리에서 가져오는 이유는 전처리기가 거기서만 적합되기 때문이다** — 보여주는
 * 행이 다른 좌표계에 있으면 "이 값이 어디서 나왔나"를 설명할 수 없다.
 *
 * @param trainIndices `planRun`이 준 훈련 행. 원본 행 번호이고 오름차순이다.
 */
export function preprocessPreview(
  dataset: Dataset,
  preprocessor: Preprocessor,
  trainIndices: readonly number[],
  encoding: Preprocessing['categoricalEncoding'],
  limit: number = PREP_PREVIEW_ROW_COUNT,
): PreprocessPreview {
  const shown = trainIndices.slice(0, limit)
  const matrix = transform(preprocessor, dataset, shown, encoding)

  const columns: PreviewColumn[] = []
  let at = 0
  for (const fitted of preprocessor.columns) {
    const width = widthOf(fitted, encoding)
    const sourceIndex = dataset.columns.indexOf(fitted.name)
    columns.push({
      name: fitted.name,
      before: shown.map((row) => dataset.rows[row]?.[sourceIndex] ?? ''),
      features: Array.from({ length: width }, (_, offset) => ({
        name: preprocessor.featureNames[at + offset] ?? '',
        values: matrix.map((row) => row[at + offset] ?? 0),
        kind: valueKindOf(fitted),
      })),
      excluded: false,
    })
    at += width
  }

  // **빠진 열도 자리를 지킨다.** 등장 순서는 정본의 열 순서를 따른다 - 학생이 데이터
  // 화면에서 본 순서와 같아야 "그 열"을 찾을 수 있다.
  for (const excluded of preprocessor.excludedColumns) {
    const sourceIndex = dataset.columns.indexOf(excluded.name)
    columns.push({
      name: excluded.name,
      before: shown.map((row) => dataset.rows[row]?.[sourceIndex] ?? ''),
      features: [],
      excluded: true,
    })
  }
  columns.sort(
    (left, right) => dataset.columns.indexOf(left.name) - dataset.columns.indexOf(right.name),
  )

  return { rowNumbers: shown.map((row) => row + 1), columns }
}
