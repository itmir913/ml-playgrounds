/**
 * 전처리 - 표를 숫자 행렬로 바꾼다. **엔진보다 앞에 있고 엔진과 무관하다.**
 *
 * 이 계층이 지키는 것 셋.
 *
 * 1. **파라미터는 학습셋에서만 구한다.** 평균·최솟값·범주 목록을 전체 데이터에서 구하면
 *    평가셋 정보가 학습으로 새어 지표가 부풀고, 학생은 자기 모델이 실제보다 좋다고 믿는다.
 *    fit은 trainIndices만 보고, transform은 양쪽에 같은 파라미터를 쓴다.
 * 2. **결과는 JSON으로 남는다.** .mlpx의 model/preprocessor-batch-N.json이 이것이고,
 *    예측할 때 다시 읽어 같은 변환을 한다 (mlpx-spec.md 5). 그래서 함수나 클래스가 아니라
 *    데이터여야 한다.
 * 3. **조용히 버리지 않는다.** 학습에서 빠진 열은 excludedColumns에 남는다. 화면이
 *    "이 열은 쓰이지 않았습니다"를 보여줄 수 있어야 한다.
 *
 * 전략 분기는 표로 한다. if/elif를 늘어놓으면 이미지·음성이 들어올 때(architecture.md 6)
 * 그 표가 갈라져야 할 자리를 못 찾는다.
 */

import { ClientError } from '../errors'
import type { Preprocessing } from '../project/schema'

/** 전처리기 형식. .mlpx의 batch.preprocessor.format에 그대로 들어간다. */
export const PREPROCESSOR_FORMAT = 'mlpx-preprocess-v1'

/**
 * 열의 자료형. **데이터에서 판정한다.**
 *
 * 과제 유형(분류/회귀)은 학생이 고르지만(mlpx-spec.md 0.1) 열이 수치인지 범주인지는
 * 값을 보면 알 수 있고, 물어봐야 할 이유가 없다.
 */
export type ColumnKind = 'numeric' | 'categorical'

export interface FittedColumn {
  name: string
  kind: ColumnKind
  /** 결측 대체값. 'drop'이면 없다. */
  fill?: number | string
  /** center를 빼고 spread로 나눈다. 스케일링이 'none'이거나 범주 열이면 없다. */
  scale?: { center: number; spread: number }
  /** 학습셋에서 본 범주. **순서가 곧 인코딩 순서다.** 범주 열에만 있다. */
  categories?: string[]
}

export interface Preprocessor {
  format: typeof PREPROCESSOR_FORMAT
  columns: FittedColumn[]
  /**
   * 변환 후 특성 이름. onehot이면 열 하나가 여럿으로 늘어난다.
   * featureImportance가 이 이름을 쓰므로 순서가 행렬의 열 순서와 같아야 한다.
   */
  featureNames: string[]
  /** 학습에 쓰이지 않은 열과 그 이유. 화면이 학생에게 보여준다. */
  excludedColumns: { name: string; reason: 'notEncodable' }[]
}

/** 빈 칸을 결측으로 본다. 'N/A' 같은 문자열은 손대지 않는다 - 그건 값이지 결측이 아니다. */
function isMissing(cell: string | undefined): boolean {
  return cell === undefined || cell.trim() === ''
}

function toNumber(cell: string): number | null {
  const trimmed = cell.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/** 결측이 아닌 값이 전부 숫자로 읽히면 수치 열이다. */
function detectKind(values: readonly string[]): ColumnKind {
  let seen = 0
  for (const value of values) {
    if (isMissing(value)) continue
    if (toNumber(value) === null) return 'categorical'
    seen += 1
  }
  return seen > 0 ? 'numeric' : 'categorical'
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/** 선형 보간 없이 아래쪽 값을 쓴다. numpy의 기본과 다르지만 여기서는 대체값일 뿐이다. */
function quantile(sorted: readonly number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction
  const lower = sorted[Math.floor(position)] as number
  const upper = sorted[Math.ceil(position)] as number
  return lower + (upper - lower) * (position - Math.floor(position))
}

function mostFrequent(values: readonly string[]): string {
  const counts = new Map<string, number>()
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1)
  let best = ''
  let bestCount = -1
  // 동점이면 먼저 나온 값이 이긴다. Map이 삽입 순서를 지키므로 결정적이다.
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

/**
 * 결측 대체값을 구한다. **학습셋의 값만 본다.**
 *
 * 범주 열에는 평균도 중앙값도 없다. 그래서 수치 전용 전략이 오면 최빈값으로 간다 -
 * 학생이 고른 전략을 무시하는 것이 아니라, 그 전략이 이 열에서 뜻하는 바가 최빈값이다.
 */
const FILL_BY_STRATEGY: Record<
  Preprocessing['missing'],
  (numbers: readonly number[], strings: readonly string[], kind: ColumnKind) => number | string
> = {
  drop: () => '',
  zero: (_numbers, strings, kind) => (kind === 'numeric' ? 0 : mostFrequent(strings)),
  mean: (numbers, strings, kind) => (kind === 'numeric' ? mean(numbers) : mostFrequent(strings)),
  median: (numbers, strings, kind) =>
    kind === 'numeric'
      ? quantile(
          [...numbers].sort((a, b) => a - b),
          0.5,
        )
      : mostFrequent(strings),
  mostFrequent: (numbers, strings, kind) =>
    kind === 'numeric'
      ? Number(mostFrequent(numbers.map((value) => String(value))))
      : mostFrequent(strings),
}

/**
 * 스케일링 파라미터. **spread가 0이면 1로 둔다** - 값이 하나뿐인 열을 0으로 나누면
 * 행렬 전체가 NaN이 되고, 그 뒤로는 무엇이 잘못됐는지 알 수 없다.
 */
const SCALE_BY_METHOD: Record<
  Preprocessing['scaling'],
  ((values: readonly number[]) => { center: number; spread: number }) | null
> = {
  none: null,
  standard: (values) => {
    const center = mean(values)
    const variance = mean(values.map((value) => (value - center) ** 2))
    return { center, spread: Math.sqrt(variance) || 1 }
  },
  minmax: (values) => {
    const low = Math.min(...values)
    return { center: low, spread: Math.max(...values) - low || 1 }
  },
  robust: (values) => {
    const sorted = [...values].sort((a, b) => a - b)
    return {
      center: quantile(sorted, 0.5),
      spread: quantile(sorted, 0.75) - quantile(sorted, 0.25) || 1,
    }
  },
}

export interface Dataset {
  /** 열 이름. 헤더가 없으면 부르는 쪽이 만들어 넣는다. */
  columns: readonly string[]
  /** 데이터 행만. **헤더는 여기 없다** - 행 번호가 곧 trainIndices의 번호다. */
  rows: readonly (readonly string[])[]
}

/**
 * 학습에 쓸 수 있는 행의 번호를 고른다. **분할보다 먼저 부른다** (ml/split.ts).
 *
 * 타깃이 빈 행은 어떤 결측 전략이든 쓸 수 없다 - 정답을 모르는 행으로는 학습도
 * 채점도 못 한다. 특성의 결측은 전략이 'drop'일 때만 행을 버린다.
 */
export function usableRows(
  dataset: Dataset,
  features: readonly string[],
  target: string | undefined,
  missing: Preprocessing['missing'],
): number[] {
  const indexOf = (name: string): number => dataset.columns.indexOf(name)
  const targetColumn = target === undefined ? -1 : indexOf(target)
  const featureColumns = features.map(indexOf)

  const usable: number[] = []
  dataset.rows.forEach((row, index) => {
    if (targetColumn >= 0 && isMissing(row[targetColumn])) return
    if (missing === 'drop' && featureColumns.some((column) => isMissing(row[column]))) return
    usable.push(index)
  })
  return usable
}

/**
 * 학습셋에서 전처리 파라미터를 구한다.
 *
 * **trainIndices만 본다.** 여기에 평가셋이 섞이면 지표가 조용히 부풀고, 그 지표로
 * 학생이 "이 모델이 제일 좋다"고 쓴다.
 */
export function fitPreprocessor(
  dataset: Dataset,
  trainIndices: readonly number[],
  features: readonly string[],
  preprocessing: Preprocessing,
): Preprocessor {
  const columns: FittedColumn[] = []
  const featureNames: string[] = []
  const excludedColumns: Preprocessor['excludedColumns'] = []

  for (const name of features) {
    const columnIndex = dataset.columns.indexOf(name)
    if (columnIndex < 0) throw new ClientError('COLUMN_NOT_FOUND', { column: name })

    const cells = trainIndices.map((row) => dataset.rows[row]?.[columnIndex] ?? '')
    const present = cells.filter((cell) => !isMissing(cell))
    if (present.length === 0) throw new ClientError('FEATURE_ALL_MISSING', { feature: name })

    const kind = detectKind(present)

    if (kind === 'categorical' && preprocessing.categoricalEncoding === 'none') {
      // 문자열을 그대로 모델에 넣을 수는 없다. 조용히 0으로 바꾸느니 빼고 말한다.
      excludedColumns.push({ name, reason: 'notEncodable' })
      continue
    }

    const numbers = present
      .map((cell) => toNumber(cell))
      .filter((value): value is number => value !== null)
    const fitted: FittedColumn = { name, kind }

    if (preprocessing.missing !== 'drop') {
      fitted.fill = FILL_BY_STRATEGY[preprocessing.missing](numbers, present, kind)
    }

    if (kind === 'numeric') {
      const scaler = SCALE_BY_METHOD[preprocessing.scaling]
      // 결측을 채우기 **전의** 값으로 구한다. 대체값을 섞으면 결측이 많은 열일수록
      // 같은 값이 여러 번 들어가 분산이 줄고, 스케일이 데이터가 아니라 결측률을 반영한다.
      if (scaler) fitted.scale = scaler(numbers)
      featureNames.push(name)
    } else {
      const categories = [...new Set(present)]
      fitted.categories = categories
      if (preprocessing.categoricalEncoding === 'onehot') {
        // 열 하나가 범주 수만큼 늘어난다. 이름에 범주를 붙여야 featureImportance를 읽을 수 있다.
        featureNames.push(...categories.map((category) => `${name}=${category}`))
      } else {
        featureNames.push(name)
      }
    }

    columns.push(fitted)
  }

  if (columns.length === 0) throw new ClientError('FEATURE_NOT_SELECTED')

  return { format: PREPROCESSOR_FORMAT, columns, featureNames, excludedColumns }
}

/**
 * 고른 행을 숫자 행렬로 바꾼다. 학습셋에도 평가셋에도 **같은 전처리기**를 쓴다.
 *
 * 학습셋에 없던 범주를 만나면 onehot은 전부 0, ordinal은 -1이다. 예측 한 번을
 * 통째로 실패시키는 것보다 낫다 - 교실에서 새 값은 흔하고, 학생이 할 수 있는 일이 없다.
 */
export function transform(
  preprocessor: Preprocessor,
  dataset: Dataset,
  indices: readonly number[],
  encoding: Preprocessing['categoricalEncoding'],
): number[][] {
  const columnIndexOf = new Map(
    preprocessor.columns.map((c) => [c.name, dataset.columns.indexOf(c.name)]),
  )

  return indices.map((rowIndex) => {
    const row = dataset.rows[rowIndex] ?? []
    const values: number[] = []

    for (const column of preprocessor.columns) {
      const cell = row[columnIndexOf.get(column.name) ?? -1] ?? ''
      const filled = isMissing(cell) ? (column.fill ?? '') : cell

      if (column.kind === 'numeric') {
        // 대체값이 없는데(drop 전략) 결측이면 0으로 둔다. usableRows가 이미
        // 그런 행을 버렸으므로 여기 오는 것은 예측 입력뿐이다.
        const raw = typeof filled === 'number' ? filled : (toNumber(String(filled)) ?? 0)
        values.push(column.scale ? (raw - column.scale.center) / column.scale.spread : raw)
        continue
      }

      const categories = column.categories ?? []
      const position = categories.indexOf(String(filled))
      if (encoding === 'onehot') {
        for (let i = 0; i < categories.length; i += 1) values.push(i === position ? 1 : 0)
      } else {
        values.push(position)
      }
    }

    return values
  })
}

/** 타깃 열의 값을 그대로 뽑는다. 라벨은 문자열로 다룬다 - 3과 "3"을 가르지 않는다. */
export function targetValues(
  dataset: Dataset,
  indices: readonly number[],
  target: string,
): string[] {
  const columnIndex = dataset.columns.indexOf(target)
  if (columnIndex < 0) throw new ClientError('COLUMN_NOT_FOUND', { column: target })
  return indices.map((row) => (dataset.rows[row]?.[columnIndex] ?? '').trim())
}
