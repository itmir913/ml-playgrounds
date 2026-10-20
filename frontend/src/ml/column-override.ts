/**
 * 열 하나의 전처리 덮어쓰기를 고치는 순수 함수들 (open-decisions.md 116).
 *
 * **화면(`views/preprocess/ColumnEncodingDialog.vue`)은 이것을 부르기만 한다** — 무엇을
 * 저장하고 무엇을 지우는지가 부품 안에 있으면 vitest가 못 덮는다(`docs/workflow.md` §2).
 */

import type { Preprocessing } from '../project/schema'
import { listBottomBlockers, listTopBlockers } from '../list-order'
import { categoryOrder } from './preprocess'

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
  const rest = Object.fromEntries(
    Object.entries(preprocessing.columns ?? {}).filter(([name]) => name !== column),
  )
  const columns = Object.keys(next).length === 0 ? rest : { ...rest, [column]: next }
  const shared: Preprocessing = { ...preprocessing }
  delete shared.columns
  return Object.keys(columns).length === 0 ? shared : { ...shared, columns }
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
