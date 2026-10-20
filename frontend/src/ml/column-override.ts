/**
 * 열 하나의 전처리 덮어쓰기를 고치는 순수 함수들 (open-decisions.md 116).
 *
 * **화면(`views/preprocess/ColumnEncodingDialog.vue`)은 이것을 부르기만 한다** — 무엇을
 * 저장하고 무엇을 지우는지가 부품 안에 있으면 vitest가 못 덮는다(`docs/workflow.md` §2).
 */

import type { Preprocessing } from '../project/schema'
import { listBottomBlockers, listTopBlockers } from '../list-order'
import {
  categoryOrder,
  compareCodePoints,
  resolveColumnPreprocessing,
  type Preprocessor,
} from './preprocess'

/** 열 하나의 덮어쓰기. 스키마의 `columns[열]`과 같은 모양이다. */
export type ColumnOverride = NonNullable<Preprocessing['columns']>[string]

/** 대화상자의 인코딩 선택. `inherit`는 덮어쓰지 않고 공통값을 따른다는 뜻이다. */
export type EncodingChoice = 'inherit' | Preprocessing['categoricalEncoding']

/** 지금 저장된 그 열의 덮어쓰기. 없으면 `undefined`다. */
export function overrideOf(
  preprocessing: Preprocessing,
  column: string,
): ColumnOverride | undefined {
  const columns = preprocessing.columns ?? {}
  return Object.hasOwn(columns, column) ? columns[column] : undefined
}

/**
 * 그 열의 덮어쓰기를 바꾼 새 `preprocessing`. **빈 덮어쓰기는 키째 지우고, 남은 열이 없으면
 * `columns`도 지운다** — 아무것도 안 덮어쓴 파일이 v4 파일과 같은 모양이어야 "바뀜" 기록이
 * 헛돌지 않는다.
 *
 * **`categories`는 인코딩이 `ordinal`이 아니어도 지우지 않는다** (116 규칙 9). 학생이 원-핫으로
 * 바꿨다가 되돌리면 순서가 돌아온다. 지우는 것은 [순서 지정 해제]뿐이다(`categories: undefined`).
 */
export function withColumnOverride(
  preprocessing: Preprocessing,
  column: string,
  encoding: EncodingChoice,
  categories: readonly string[] | undefined,
): Preprocessing {
  const next: ColumnOverride = {
    ...(encoding === 'inherit' ? {} : { categoricalEncoding: encoding }),
    ...(categories === undefined ? {} : { categories: [...categories] }),
  }
  const rest = Object.entries(preprocessing.columns ?? {}).filter(([name]) => name !== column)
  // **키는 이름순이다.** 고친 열을 뒤에 붙이면 같은 값을 다시 저장해도 키 순서만 바뀌고,
  // 변경 기록(`changedPaths`)이 바뀐 열 없는 "바뀜"을 남긴다. `withColumnOverride`의 스펙이 문다.
  const entries = Object.keys(next).length === 0 ? rest : [...rest, [column, next] as const]
  const columns = Object.fromEntries(entries.sort(([a], [b]) => compareCodePoints(a, b))) as Record<
    string,
    ColumnOverride
  >
  const shared: Preprocessing = { ...preprocessing }
  delete shared.columns
  return Object.keys(columns).length === 0 ? shared : { ...shared, columns }
}

/**
 * **학습에 실제로 걸리는 덮어쓰기의 수** (요약 카드). 저장된 키를 세지 않는다 — 공통값과 같은
 * 인코딩, 서수가 아니라 무시되는 순서, 학습에 안 쓰이는 열의 덮어쓰기는 남아 있어도 결과를
 * 안 바꾼다. `columns`는 학습이 범주로 다루는 열의 이름이다(계획의 전처리기가 안다).
 */
export function effectiveOverrideCount(
  preprocessing: Preprocessing,
  columns: readonly string[],
): number {
  return [...new Set(columns)].filter((column) => {
    if (overrideOf(preprocessing, column) === undefined) return false
    const resolved = resolveColumnPreprocessing(preprocessing, column)
    return (
      resolved.categoricalEncoding !== preprocessing.categoricalEncoding ||
      resolved.categories !== undefined
    )
  }).length
}

/**
 * 요약이 셀 열. **계획이 섰으면 그 전처리기가 범주로 다룬 열**(뺀 열 포함), **막혔으면 고른 특성
 * 전부**다 — 막힌 원인이 덮어쓰기일 수 있으므로(`FEATURE_CATEGORY_NOT_IN_ORDER`) 그때도 줄이
 * 사라지면 안 된다. 특성 중 수치 열에 남은 덮어쓰기는 이때만 셀 수 있다.
 */
export function overrideSummaryColumns(
  preprocessor: Preprocessor | null,
  features: readonly string[],
): string[] {
  if (preprocessor === null) return [...features]
  return [
    ...preprocessor.columns.filter((column) => column.kind === 'categorical'),
    ...preprocessor.excludedColumns,
  ].map((column) => column.name)
}

/**
 * 데이터에 있는데 지정한 순서에 없는 값. 있으면 학습이 거절한다(`FEATURE_CATEGORY_NOT_IN_ORDER`).
 * 화면은 앞의 `limit`개만 늘어놓고 나머지는 개수로 말한다(`STRAY_VALUE_PREVIEW_COUNT`).
 */
export function straysOf(
  order: readonly string[] | undefined,
  values: readonly string[],
  limit: number,
): { readonly count: number; readonly shown: readonly string[] } {
  if (order === undefined) return { count: 0, shown: [] }
  const known = new Set(order)
  const strays = categoryOrder(values).filter((value) => !known.has(value))
  return { count: strays.length, shown: strays.slice(0, limit) }
}

/** 순서에서 한 칸 옮긴다. 끝을 넘으면 그대로다 — 버튼이 잠겨 있어 정상 경로에서는 안 온다. */
export function moveCategory(order: readonly string[], index: number, delta: -1 | 1): string[] {
  // 잠금과 같은 판정으로 멈춘다(`list-order.ts`) — 화면의 ↑↓가 잠긴 자리에서 옮기기도 멈춘다.
  const blocked =
    index < 0 ||
    index >= order.length ||
    (delta < 0 ? listTopBlockers({ index }) : listBottomBlockers({ index, count: order.length }))
      .length > 0
  if (blocked) return [...order]
  const to = index + delta
  const next = [...order]
  const [moved] = next.splice(index, 1)
  if (moved !== undefined) next.splice(to, 0, moved)
  return next
}

/**
 * 값들을 사전순·사전 역순으로 늘어놓은 순서. **사전순은 지정하지 않았을 때의 정렬과 같은
 * 함수다**(`categoryOrder`, 코드 포인트 순) — 두 화면이 다른 "사전순"을 갖지 않는다.
 *
 * **값 종류 수에 상한을 두지 않는다** (open-decisions.md 116, 코드 소유자). sklearn
 * `OrdinalEncoder(categories=...)`에도 없다. ↑↓로 못 옮길 만큼 많으면 이것으로 한 번에 채운다.
 */
export function dictionaryOrder(
  values: readonly string[],
  direction: 'ascending' | 'descending',
): string[] {
  const ascending = categoryOrder(values)
  return direction === 'ascending' ? ascending : ascending.reverse()
}
