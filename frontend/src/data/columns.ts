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
