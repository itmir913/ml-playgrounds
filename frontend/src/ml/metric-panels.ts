/**
 * 결과 화면의 상세 패널 등록부 (architecture.md §9).
 *
 * **"혼동 행렬은 분류 전용"이라는 사실이 있어야 할 자리가 여기다.** 결과 화면이 아니다
 * (§9.1). 화면에 적으면 이미지가 들어오는 날 고쳐야 할 파일이 등록부 하나가 아니라
 * 그 사실을 아는 화면 전부가 되고, 그중 하나를 빠뜨린 것은 **컴파일도 검사도 못 잡고
 * 학생이 화면에서 알게 된다.**
 *
 * **패널이 0개인 조합이 정상이다.** 회귀가 그렇다 - 맞고 틀림이 아니라 얼마나
 * 벗어났느냐이고, 그건 위의 지표(ml/metrics.ts)가 이미 전부 말했다. 그때 화면은 빈 칸을
 * 두지 않고 그 사실을 적는다 (§8.9).
 *
 * 지표 자체(무엇을 몇 개 보이는가)는 `ml/metrics.ts`의 `METRIC_DISPLAY`가 갖는다.
 * 여기 있는 것은 그 아래 붙는 **상세**다.
 */

import { defineAsyncComponent, type Component } from 'vue'

import type { DataType, Run, TaskType } from '../project/schema'
import { supports, type Axis } from './axes'

export interface MetricPanel {
  /** 로케일 키도 아니고 화면에 안 나온다. 검사와 v-for의 key에만 쓴다. */
  readonly id: string
  readonly dataTypes: Axis<DataType>
  readonly taskTypes: Axis<TaskType>
  /**
   * 이 실행에 그릴 것이 실제로 담겨 있는가. **축과 별개다** (§9.5).
   *
   * 축은 "이 조합에서 성립하는가"라는 등록부의 정적 사실이고, 이것은 파일마다 다르다 -
   * 분류로 돌렸는데 혼동 행렬이 안 담긴 `.mlpx`가 있다(옛 파일, 예산에서 밀린 것.
   * mlpx-spec.md §4.2). 화면이 `run.confusionMatrix`를 직접 보면 안 되는 이유가
   * 이것이다. **어느 필드에 담기는지는 이 패널의 앎이다.**
   */
  readonly hasData: (run: Run) => boolean
  /** 지연 로딩한다. 회귀만 쓰는 학생이 혼동 행렬 코드를 받을 이유가 없다. */
  readonly panel: Component
}

const PANELS: readonly MetricPanel[] = [
  {
    id: 'confusion-matrix',
    dataTypes: { tabular: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    hasData: (run) => run.confusionMatrix !== undefined,
    panel: defineAsyncComponent(() => import('@/views/results/panels/ConfusionMatrixPanel.vue')),
  },
  {
    id: 'per-class',
    dataTypes: { tabular: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    hasData: (run) => run.perClass !== undefined,
    panel: defineAsyncComponent(() => import('@/views/results/panels/PerClassPanel.vue')),
  },
]

/**
 * 이 실행에서 그릴 상세 패널들. **비어 있을 수 있고, 그것이 정상인 조합이 있다.**
 *
 * 순수 함수다. 화면은 결과를 그대로 그리기만 한다 (§8.3).
 */
export function metricPanelsFor(
  dataType: DataType,
  taskType: TaskType,
  run: Run,
  panels: readonly MetricPanel[] = PANELS,
): readonly MetricPanel[] {
  return panels.filter(
    (entry) =>
      supports(entry.dataTypes, dataType) &&
      supports(entry.taskTypes, taskType) &&
      entry.hasData(run),
  )
}

/** 등록부 전체. 검사가 표를 훑는 데 쓴다. */
export const METRIC_PANELS = PANELS
