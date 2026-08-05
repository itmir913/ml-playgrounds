/**
 * 붓꽃 축소판. 품종마다 10개씩, 실제 붓꽃 값에서 고르게 뽑았다.
 * 전체 150개를 테스트에 박으면 읽을 수 없는 파일이 된다.
 *
 * **두 가지 모양으로 낸다.** 엔진은 숫자 행렬을 바로 받고(engines/mljs.ts), 실험 실행은
 * 표에서 시작한다(ml/experiment.ts). 같은 데이터의 두 모양이므로 한 곳에 두어야 한다 -
 * 각자 베껴 두면 한쪽만 고쳐져서 두 테스트가 다른 데이터를 보게 된다.
 */

import type { Dataset } from '../../src/ml/preprocess'

export const IRIS_FEATURE_COLUMNS = [
  'sepal_length',
  'sepal_width',
  'petal_length',
  'petal_width',
] as const

export const IRIS_TARGET_COLUMN = 'species'

export const IRIS_FEATURES: number[][] = [
  [5.1, 3.5, 1.4, 0.2],
  [4.9, 3.0, 1.4, 0.2],
  [4.7, 3.2, 1.3, 0.2],
  [4.6, 3.1, 1.5, 0.2],
  [5.0, 3.6, 1.4, 0.2],
  [5.4, 3.9, 1.7, 0.4],
  [4.6, 3.4, 1.4, 0.3],
  [5.0, 3.4, 1.5, 0.2],
  [4.4, 2.9, 1.4, 0.2],
  [4.9, 3.1, 1.5, 0.1],
  [7.0, 3.2, 4.7, 1.4],
  [6.4, 3.2, 4.5, 1.5],
  [6.9, 3.1, 4.9, 1.5],
  [5.5, 2.3, 4.0, 1.3],
  [6.5, 2.8, 4.6, 1.5],
  [5.7, 2.8, 4.5, 1.3],
  [6.3, 3.3, 4.7, 1.6],
  [4.9, 2.4, 3.3, 1.0],
  [6.6, 2.9, 4.6, 1.3],
  [5.2, 2.7, 3.9, 1.4],
  [6.3, 3.3, 6.0, 2.5],
  [5.8, 2.7, 5.1, 1.9],
  [7.1, 3.0, 5.9, 2.1],
  [6.3, 2.9, 5.6, 1.8],
  [6.5, 3.0, 5.8, 2.2],
  [7.6, 3.0, 6.6, 2.1],
  [4.9, 2.5, 4.5, 1.7],
  [7.3, 2.9, 6.3, 1.8],
  [6.7, 2.5, 5.8, 1.8],
  [7.2, 3.6, 6.1, 2.5],
]

export const IRIS_LABELS: string[] = [
  ...Array<string>(10).fill('setosa'),
  ...Array<string>(10).fill('versicolor'),
  ...Array<string>(10).fill('virginica'),
]

/**
 * 표 모양. 정본 CSV를 읽었을 때 나오는 것과 같은 형태다 - 셀은 전부 문자열이고
 * 헤더는 rows에 없다. 행 번호가 곧 분할 인덱스의 번호다 (ml/split.ts).
 */
export function irisDataset(): Dataset {
  return {
    columns: [...IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN],
    rows: IRIS_FEATURES.map((values, row) => [...values.map(String), IRIS_LABELS[row] ?? '']),
  }
}
