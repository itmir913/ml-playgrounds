/**
 * 시각화 도구의 **판정 부분** — 도구가 왜 못 그리는가 (`data/charts.ts`의 등록부가 이 모양을 넓힌다).
 *
 * **따로 선 것은 무게 때문이다.** 잠금 등록부(`@/locks`)가 도구 판정의 타입을 들여야 하는데, 등록부
 * 파일(`data/charts.ts`)은 그림 부품을 지연 로딩으로 가리킨다 — 그 파일을 따라가면 첫 화면의 부품과
 * 모든 검사가 그림 부품까지 닿는다(`ui-rules.spec.ts`의 *"DOM이 필요한 검사는 스스로 밝힌다"*가
 * import를 그렇게 센다). 판정의 모양만 여기 두고 `data/charts.ts`가 다시 내보낸다.
 */

import type { ColumnSummary } from './columns'

/**
 * 그림을 못 그리는 이유. **화면에 그대로 나가는 문구의 키가 된다**
 * (`data.charts.blocked.*`).
 *
 * 배열이 먼저인 이유는 `COLUMN_KINDS`와 같다 — 값 목록이 실행 중에도 있어야 로케일과
 * 짝지어 검사할 수 있다 (`docs/i18n.md`).
 */
export const CHART_BLOCKS = ['needsNumeric', 'needsCategorical', 'needsAnotherColumn'] as const
export type ChartBlock = (typeof CHART_BLOCKS)[number]

/** 잠금을 판정할 때 보는 것. **고른 열 하나가 아니라 표 전체를 본다** — 산점도가 둘째 열을 찾는다. */
export interface GateInput {
  readonly columns: readonly ColumnSummary[]
  readonly column: string
}

/** 도구 가운데 판정에 쓰는 부분. `data/charts.ts`의 `ChartTool`이 이것을 넓힌다. */
export interface ChartToolGate {
  /** 로케일 키와 `v-for`의 key. `data.charts.{id}.name`이 그 이름이다. */
  readonly id: string
  /**
   * 못 그리는 이유. **비어 있으면 그릴 수 있다.**
   *
   * **`false`를 돌려주는 자리가 아니다** (§9.2.1). 학생이 알아야 하는 것은 "안 된다"가
   * 아니라 "왜 안 되는가"이고, 이유 없이 회색인 버튼은 고장으로 읽힌다 (§8.2).
   */
  readonly blockedBy: (input: GateInput) => readonly ChartBlock[]
}
