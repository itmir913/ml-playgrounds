/**
 * 데이터 화면의 **시각화 도구 등록부** (`architecture.md` §9,
 * `open-decisions.md` "44. 데이터 화면의 시각화").
 *
 * **"히스토그램은 수치 열에서만 된다"가 있어야 할 자리가 여기다. 화면이 아니다** (§9.1).
 * 화면에 적으면 도구를 더하는 사람이 고쳐야 할 파일이 등록부 하나가 아니라 **그 사실을
 * 아는 화면 전부**가 되고, 그중 하나를 빠뜨린 것은 컴파일도 검사도 못 잡는다.
 *
 * **`dataTypes` 축이 사진을 막는다.** 사진에는 열이라는 것이 없어서 어느 도구도
 * 성립하지 않는다 — 그 사실도 화면이 아니라 여기 있고, 음성이 들어오는 날 칸이 비어
 * **컴파일이 깨지면서** 다음 사람에게 판단을 요구한다 (`ml/axes.ts`).
 *
 * **잠그는 이유는 boolean이 아니라 목록이다** (`CLAUDE.md` §2). 화면은 조건을 조립하지
 * 않고 이 목록을 받아 그대로 읽는다 — 목록이 비면 그릴 수 있다는 뜻이다.
 *
 * **그림을 지연 로딩한다.** Chart.js 등록이 이 아래 컴포넌트들 안에만 있어서,
 * 시각화를 한 번도 안 여는 학생은 차트 라이브러리를 안 받는다 (`ClusterScatter`와 같다).
 */

import { defineAsyncComponent, inject, type Component, type InjectionKey, type Ref } from 'vue'

import type { ColumnSummary } from './columns'
import type { DataType } from '@/project/schema'
import type { Dataset } from '@/ml/preprocess'
import { supports, type Axis } from '@/ml/axes'

/**
 * 그림 하나가 받는 것 전부.
 *
 * **프롭 하나로 묶는다. 개별 프롭으로 흩지 마라** (`architecture.md` §8.13.2). 흩으면
 * 안 쓰는 그림이 그것을 선언하지 않게 되고, **선언하지 않은 객체 프롭은
 * `[object Object]`라는 어트리뷰트로 DOM에 그대로 박힌다.** `tests/ui-rules.spec.ts`가
 * 결과 패널에 하는 것과 같은 검사를 여기에도 건다.
 */
export interface ChartInput {
  /** 확정된 정본. **미리보기가 아니라 전체 행이다** (`architecture.md` §8.9.1). */
  readonly dataset: Dataset
  /** 열마다의 요약. 자료형과 결측 수가 여기서 온다. */
  readonly columns: readonly ColumnSummary[]
  /** 학생이 고른 열의 이름. */
  readonly column: string
  /**
   * 표본을 뽑을 때 쓰는 씨앗. 프로젝트의 `split.randomState`다.
   *
   * **그림마다 새로 뽑지 않는다** — 같은 프로젝트를 다시 열면 같은 그림이라야 학생이
   * 어제 본 것을 오늘도 본다 (`CLAUDE.md` §2의 재현 가능성).
   */
  readonly randomState: number
}

/**
 * 도구가 자기 설정(둘째 열·색 열·구분 기준)을 세울 자리.
 *
 * **무엇을 물을지는 도구가 알고, 어디에 세울지는 창이 안다** (§9.1, §8.9.1). 창이
 * `provide`로 자리를 내주고 도구가 `<Teleport>`로 보낸다 — 창이 도구별로 갈래를 세우면
 * 등록부를 만든 이유가 사라지고, 도구가 자리를 정하면 창의 레이아웃이 도구 수만큼 갈린다.
 *
 * **없으면 제자리에 그린다** (아래 `useChartControls`). 부품 하나만 마운트하는 검사와
 * 하니스에서 터지지 않아야 한다.
 */
/**
 * **`Symbol.for`다. `Symbol()`이 아니다** (2026-09-22, 실물에서 봤다).
 *
 * 개발 서버가 이 모듈을 다시 평가하면 `Symbol()`은 **새 심벌**이 되고, 창은 옛 열쇠로
 * 내주고 도구는 새 열쇠로 찾아 **주입이 조용히 빗나간다** — 설정이 왼쪽 칸 대신 그림
 * 위에 선다. 전역 레지스트리의 심벌은 이름이 같으면 같은 것이라 그 틈이 없다.
 */
export const CHART_CONTROLS: InjectionKey<Ref<HTMLElement | null>> = Symbol.for(
  'mlpx.chart-controls',
) as InjectionKey<Ref<HTMLElement | null>>

/** 설정을 보낼 자리. 창 밖에서 마운트되면 `null`이고, 그때는 제자리에 그린다. */
export function useChartControls(): Ref<HTMLElement | null> | null {
  return inject(CHART_CONTROLS, null)
}

/**
 * 그림을 못 그리는 이유. **화면에 그대로 나가는 문구의 키가 된다**
 * (`data.charts.blocked.*`).
 *
 * 배열이 먼저인 이유는 `COLUMN_KINDS`와 같다 — 값 목록이 실행 중에도 있어야 로케일과
 * 짝지어 검사할 수 있다 (`docs/i18n.md`).
 */
export const CHART_BLOCKS = ['needsNumeric', 'needsCategorical', 'needsAnotherNumeric'] as const
export type ChartBlock = (typeof CHART_BLOCKS)[number]

/** 잠금을 판정할 때 보는 것. **고른 열 하나가 아니라 표 전체를 본다** — 산점도가 둘째 열을 찾는다. */
export interface GateInput {
  readonly columns: readonly ColumnSummary[]
  readonly column: string
}

export interface ChartTool {
  /** 로케일 키와 `v-for`의 key. `data.charts.{id}.name`이 그 이름이다. */
  readonly id: string
  /** 어느 데이터 종류에서 성립하는가. */
  readonly dataTypes: Axis<DataType>
  /**
   * 못 그리는 이유. **비어 있으면 그릴 수 있다.**
   *
   * **`false`를 돌려주는 자리가 아니다** (§9.2.1). 학생이 알아야 하는 것은 "안 된다"가
   * 아니라 "왜 안 되는가"이고, 이유 없이 회색인 버튼은 고장으로 읽힌다 (§8.2).
   */
  readonly blockedBy: (input: GateInput) => readonly ChartBlock[]
  /** 그리는 부품. 지연 로딩이다. */
  readonly panel: Component
}

/** 고른 열의 자료형. 열을 못 찾으면 `undefined`다. */
function kindOf(input: GateInput): ColumnSummary['kind'] | undefined {
  return input.columns.find((column) => column.name === input.column)?.kind
}

/** 수치 열의 이름들. 산점도가 둘째 축을 여기서 찾는다. */
export function numericColumns(columns: readonly ColumnSummary[]): readonly string[] {
  return columns.filter((column) => column.kind === 'numeric').map((column) => column.name)
}

/** 범주 열의 이름들. 박스 플롯을 가르는 열과 산점도의 색이 여기서 나온다. */
export function categoricalColumns(columns: readonly ColumnSummary[]): readonly string[] {
  return columns.filter((column) => column.kind === 'categorical').map((column) => column.name)
}

/** 수치 열이 아니면 못 그린다. 히스토그램과 박스 플롯이 함께 쓴다. */
function requireNumeric(input: GateInput): readonly ChartBlock[] {
  return kindOf(input) === 'numeric' ? [] : ['needsNumeric']
}

/**
 * 도구 목록. **`readonly ChartTool[]` 주석이 강제 장치의 절반이다** (`ml/axes.ts`) —
 * 안 붙이면 TypeScript가 리터럴을 그대로 추론해 축이 늘어도 조용하다.
 */
export const CHART_TOOLS: readonly ChartTool[] = [
  {
    id: 'histogram',
    dataTypes: { tabular: true, image: false },
    blockedBy: requireNumeric,
    panel: defineAsyncComponent(() => import('@/views/data/charts/HistogramChart.vue')),
  },
  {
    id: 'bar',
    dataTypes: { tabular: true, image: false },
    /**
     * **수치 열에는 안 준다.** 수치 열의 분포는 히스토그램이 말하고, 막대로 그리면
     * 값 하나마다 막대가 서서 **분포가 아니라 목록**이 된다. 열 하나에 도구 둘이
     * 겹치는 자리를 만들지 않는다.
     */
    blockedBy: (input) => (kindOf(input) === 'categorical' ? [] : ['needsCategorical']),
    panel: defineAsyncComponent(() => import('@/views/data/charts/BarChart.vue')),
  },
  {
    id: 'box',
    dataTypes: { tabular: true, image: false },
    blockedBy: requireNumeric,
    panel: defineAsyncComponent(() => import('@/views/data/charts/BoxChart.vue')),
  },
  {
    id: 'scatter',
    dataTypes: { tabular: true, image: false },
    /**
     * **이유가 둘일 수 있다.** 범주 열을 고른 채 표에 수치 열이 하나뿐이면 둘 다
     * 참이고, 그때 하나만 말하면 학생이 하나를 고치고 다시 막힌다.
     */
    blockedBy: (input) => {
      const blocks: ChartBlock[] = [...requireNumeric(input)]
      /**
       * **표 전체의 수치 열을 센다. 고른 열을 뺀 나머지가 아니다.**
       *
       * 처음에는 고른 열을 빼고 셌는데, 그러면 **범주 열을 고른 채 표에 수치 열이
       * 하나뿐일 때** 이 줄이 통과한다 — 학생은 *"수치 열에서만 됩니다"*를 읽고
       * 그 하나뿐인 수치 열로 옮긴 다음 **거기서 다시 막힌다.** 잠긴 이유는 한 번에
       * 다 말해야 한다 (2026-09-21, `charts.spec.ts`가 잡았다).
       *
       * 고른 열이 수치일 때는 둘 중 하나가 자기 자신이므로 **짝이 될 열이 하나
       * 남는다는 뜻**이고, 범주일 때는 **고를 축 둘이 있다는 뜻**이다. 세는 규칙 하나가
       * 두 경우를 다 맞힌다.
       */
      if (numericColumns(input.columns).length < 2) blocks.push('needsAnotherNumeric')
      return blocks
    },
    panel: defineAsyncComponent(() => import('@/views/data/charts/ScatterChart.vue')),
  },
]

/** 이 데이터 종류에서 성립하는 도구들. */
export function chartToolsFor(dataType: DataType): readonly ChartTool[] {
  return CHART_TOOLS.filter((tool) => supports(tool.dataTypes, dataType))
}

/**
 * 이 열에서 **바로 그릴 수 있는** 첫 도구. 없으면 `undefined`다.
 *
 * 학생이 열을 누르면 그 열에 맞는 그림이 **이미 떠 있어야 한다** — 창을 열고 도구를
 * 한 번 더 고르게 하면, 자료형에 따라 도구가 갈린다는 사실이 화면에서 안 보인다.
 */
export function defaultChartTool(dataType: DataType, input: GateInput): ChartTool | undefined {
  return chartToolsFor(dataType).find((tool) => tool.blockedBy(input).length === 0)
}
