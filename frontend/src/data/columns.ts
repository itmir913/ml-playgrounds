/**
 * 격자를 **열 이름 + 데이터 행**으로 가른다.
 *
 * `ml/preprocess.ts`의 `Dataset`은 "헤더가 없으면 부르는 쪽이 만들어 넣는다"고 적어
 * 두었다. 그 부르는 쪽이 여기다. 이름을 만드는 규칙이 화면마다 다르면 같은 파일이
 * 화면마다 다른 열 이름을 갖는다.
 *
 * **여기서 만든 이름은 UI 문자열이 아니라 데이터다.** `settings.features`에 들어가고
 * `.mlpx`에 저장되며 전처리기 JSON에도 남는다. 그래서 `t()`를 거치지 않고, 거쳐서도
 * 안 된다 — 한국어로 만든 파일을 영어로 열었을 때 열 이름이 달라지면 그 파일은
 * 다른 파일이 된다.
 */

import { ClientError } from '@/errors'
import { detectKind, type ColumnKind } from '@/ml/preprocess'
import type { Dataset } from '@/ml/preprocess'
import type { TableGrid } from './grid'

/**
 * 엑셀식 열 이름 — A, B, …, Z, AA, AB, ….
 *
 * 헤더가 없을 때 쓰는 이름이다. 숫자(`1`, `2`)나 번역된 이름(`1열`, `Column 1`)이
 * 아닌 이유는 셋이다 — 학생이 엑셀에서 이미 이 이름을 보고 있고, 어떤 언어로 열어도
 * 같으며, 실제 데이터 값과 헷갈릴 일이 적다.
 */
export function spreadsheetName(index: number): string {
  let name = ''
  for (let n = index; n >= 0; n = Math.floor(n / 26) - 1) {
    name = String.fromCharCode(65 + (n % 26)) + name
  }
  return name
}

/**
 * 열 이름을 정한다. **반드시 서로 달라야 한다.**
 *
 * `usableRows`를 비롯한 아래 계층이 `columns.indexOf(name)`으로 열을 찾는다.
 * 이름이 겹치면 두 번째 열은 영영 닿지 않고, 학생이 그 열을 골라도 **말없이 첫 번째
 * 열로 학습한다.** 엑셀이 내보낸 CSV에 같은 머리글이 두 번 있는 일은 실제로 있다.
 *
 * 겹치거나 비어 있으면 엑셀식 이름을 괄호로 붙인다 — `점수 (D)`. 어느 열인지
 * 학생이 화면에서 바로 짚을 수 있는 표시여야 한다.
 */
export function columnNames(grid: TableGrid, hasHeader: boolean): string[] {
  const width = grid.reduce((widest, row) => Math.max(widest, row.length), 0)
  const header = hasHeader ? (grid[0] ?? []) : []

  const names: string[] = []
  const taken = new Set<string>()
  for (let index = 0; index < width; index += 1) {
    const letter = spreadsheetName(index)
    const raw = (header[index] ?? '').trim()
    const name = raw === '' || taken.has(raw) ? `${raw === '' ? '' : `${raw} `}(${letter})` : raw
    names.push(name)
    taken.add(name)
  }
  return names
}

/**
 * 격자를 학습 계층이 쓰는 모양으로 바꾼다.
 *
 * **행 번호가 곧 `trainIndices`의 번호다.** 헤더가 있으면 여기서 빠지므로, 파일의
 * 두 번째 줄이 0번 행이 된다. 이 규칙이 흔들리면 참조형 모델이 엉뚱한 행을 가리킨다.
 */
export function toDataset(grid: TableGrid, hasHeader: boolean): Dataset {
  return {
    columns: columnNames(grid, hasHeader),
    rows: hasHeader ? grid.slice(1) : grid,
  }
}

/** 화면이 열 하나를 설명할 때 필요한 것들. */
export interface ColumnSummary {
  readonly name: string
  readonly kind: ColumnKind
  /** 값이 비어 있는 행의 수. */
  readonly missing: number
  /** 서로 다른 값의 수(결측 제외). 분류의 대상 열을 고를 때 이게 판단 재료다. */
  readonly unique: number
  /** 화면에 보여줄 표본. 앞에서부터 몇 개, 중복 없이. */
  readonly samples: readonly string[]
}

/** 표본으로 보여줄 서로 다른 값의 최대 개수. 상한이 아니라 표시 개수다. */
const SAMPLE_COUNT = 3

/**
 * 열마다 요약을 만든다. **화면에 분기를 남기지 않으려고 순수 함수로 둔다.**
 *
 * 학생이 대상 열을 고르기 전에 알아야 하는 것은 셋이다 — 숫자인가, 빈 칸이 얼마나
 * 있는가, 값이 몇 종류인가. 세 번째가 특히 그렇다: 종류가 하나면 분류가 안 되고
 * (`TARGET_SINGLE_CLASS`), 행 수만큼 많으면 그건 학번 같은 식별자다.
 */
export function summarizeColumns(dataset: Dataset): ColumnSummary[] {
  return dataset.columns.map((name, index) => {
    const values = dataset.rows.map((row) => row[index] ?? '')
    const present = values.filter((value) => value.trim() !== '')
    const distinct = new Set(present)
    return {
      name,
      kind: detectKind(values),
      missing: values.length - present.length,
      unique: distinct.size,
      samples: [...distinct].slice(0, SAMPLE_COUNT),
    }
  })
}

/**
 * `alignTestDataset`과 `alignPredictDataset`이 공유하는 속. **요구하는 열 목록과
 * 에러 코드만 다르다** - 그 둘을 뺀 나머지(이름으로 재배열, 정본에 없는 열은 버림,
 * 하나라도 없으면 전부 말하며 거부)는 완전히 같은 규칙이라 여기 한 번만 둔다.
 *
 * **열 순서가 달라도 이름으로 다시 세운다.** 매핑이 아니라 모호함이 없는 재배열이다 -
 * 이름이 다른 열을 우리가 짝지어 주지는 않는다(그건 학생의 데이터 품질 문제다). 돌려주는
 * `Dataset`은 `requiredColumns`와 같은 열 순서를 갖는다. 거기 없는 열은 조용히 버린다.
 */
function alignDataset(
  grid: TableGrid,
  hasHeader: boolean,
  requiredColumns: readonly string[],
  errorCode: 'TEST_DATASET_COLUMN_MISSING' | 'PREDICT_DATASET_COLUMN_MISSING',
): Dataset {
  const dataset = toDataset(grid, hasHeader)
  const positions = requiredColumns.map((name) => dataset.columns.indexOf(name))

  const missing = requiredColumns.filter((_name, index) => positions[index] === -1)
  if (missing.length > 0) {
    throw new ClientError(errorCode, { columns: missing })
  }

  return {
    columns: requiredColumns,
    rows: dataset.rows.map((row) => positions.map((index) => row[index] ?? '')),
  }
}

/**
 * 평가 데이터(`test.csv`)를 받을 때 한 번 하는 검사 (mlpx-spec.md §1.1,
 * open-decisions.md "학습용과 평가용 파일이 따로일 수 있다").
 *
 * **정본(`data.csv`)의 열 전체와 대조한다.** 학습에 쓴 특성 열과만 대조하면, 특성이
 * `{A,B}`일 때 받아 둔 파일이 나중에 `C`를 추가하는 순간 무효가 된다 - 그 실패가
 * [학습]을 누른 뒤에야 터진다. 정본 열 전체와 대조하면 `특성 ⊆ 정본 열 ⊆ 평가 데이터 열`이
 * **항상** 참이라 늦은 실패가 구조적으로 불가능해진다. `data.csv`는 언제나 타깃 열을
 * 포함하므로 이 대조가 타깃 열도 함께 요구한다 - 정답이 없으면 채점을 못 한다.
 *
 * **하나라도 없으면 거부하고 어느 열이 없는지 말한다.** `TEST_DATASET_COLUMN_MISSING`.
 */
export function alignTestDataset(
  grid: TableGrid,
  hasHeader: boolean,
  canonicalColumns: readonly string[],
): Dataset {
  return alignDataset(grid, hasHeader, canonicalColumns, 'TEST_DATASET_COLUMN_MISSING')
}

/**
 * 예측 데이터(`predict.csv`)를 받을 때 하는 검사
 * (open-decisions.md "일괄 예측은 `행 × 모델` 매트릭스다").
 *
 * **`requiredColumns`는 정본 열 전체가 아니라 특성 열의 합집합이다.** 타깃 열은 요구하지
 * 않는다 - 예측 데이터는 답을 모르는 새 줄이라 정답 열이 없는 것이 정상이다
 * (mlpx-spec.md §1.1). 부르는 쪽(`ml/predict.ts`의 `mergeFields`)이 여러 실험의 특성을
 * 합쳐 이 목록을 만든다.
 *
 * **하나라도 없으면 거부하고 어느 열이 없는지 말한다.** `PREDICT_DATASET_COLUMN_MISSING` -
 * `TEST_DATASET_COLUMN_MISSING`과 다른 코드다. 학생이 할 일이 같지 않다(평가 데이터는
 * 정본과 짝을 맞춰야 하고, 예측 데이터는 지금 보이는 모델들이 보는 열만 맞으면 된다).
 */
export function alignPredictDataset(
  grid: TableGrid,
  hasHeader: boolean,
  requiredColumns: readonly string[],
): Dataset {
  return alignDataset(grid, hasHeader, requiredColumns, 'PREDICT_DATASET_COLUMN_MISSING')
}
