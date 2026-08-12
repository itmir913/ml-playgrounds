/**
 * 결과 화면의 상세 패널 등록부 (architecture.md §9).
 *
 * **"혼동 행렬은 분류 전용"이라는 사실이 있어야 할 자리가 여기다.** 결과 화면이 아니다
 * (§9.1). 화면에 적으면 이미지가 들어오는 날 고쳐야 할 파일이 등록부 하나가 아니라
 * 그 사실을 아는 화면 전부가 되고, 그중 하나를 빠뜨린 것은 **컴파일도 검사도 못 잡고
 * 학생이 화면에서 알게 된다.**
 *
 * **패널이 0개인 조합이 정상이다.** 회귀가 그렇다 - 맞고 틀림이 아니라 얼마나
 * 벗어났느냐이고, 그건 위의 지표(ml/metrics.ts)가 이미 전부 말했다.
 *
 * **그때 화면은 아무 말도 안 한다** (§9.2 "없는 것을 이름으로 말하지 않는다").
 * `회귀에는 혼동 행렬이 없습니다`라고 적으려면 결과 화면이 혼동 행렬을 알아야 하고,
 * 그 순간 §9.1이 막으려던 분기가 화면에 생긴다 - 이미지가 들어오면 그 문장이 한 줄 더
 * 는다. 여기서 안 고른 것은 화면에서 **자리 자체가 없다.**
 *
 * 지표 자체(무엇을 몇 개 보이는가)는 `ml/metrics.ts`의 `METRIC_DISPLAY`가 갖는다.
 * 여기 있는 것은 그 아래 붙는 **상세**다.
 */

import { defineAsyncComponent, type Component } from 'vue'

import type { DataType, Experiment, Run, TaskType } from '../project/schema'
import { supports, type Axis } from './axes'
import type { Dataset, Preprocessor } from './preprocess'

/**
 * 패널이 받는 것 전부. **모든 패널이 같은 것을 받고, 안 쓰는 패널은 안 쓴다.**
 *
 * `run` 하나였던 것이 여기까지 넓어진 이유는 군집 패널이다 — 배정을 되계산하려면
 * 전처리기와 모델과 데이터셋이 필요하고, **그 값을 `run`에 담을 수는 없다**(행마다
 * 하나라 데이터가 클수록 커진다, `open-decisions.md` #28-4).
 *
 * **프롭 하나로 묶는다. 개별 프롭으로 흩지 마라** (architecture.md §8.13.2). 흩으면
 * 안 쓰는 패널이 그것을 선언하지 않게 되고, **선언하지 않은 객체 프롭은
 * `[object Object]`라는 어트리뷰트로 DOM에 그대로 박힌다.** 그러면 이 계약이 넓어질
 * 때마다 패널 전부를 고쳐야 하고, 하나를 빠뜨린 것은 컴파일도 검사도 못 잡는다 —
 * 등록부를 만든 이유(§9.1)와 같은 실패 모양이다.
 *
 * 호출부가 `<component :is>` 하나뿐이라 타입이 이 계약을 못 지킨다.
 * **`tests/ui-rules.spec.ts`가 "패널은 프롭을 하나만 선언한다"를 강제한다.**
 */
export interface PanelInput {
  readonly run: Run
  /** 이 run이 속한 실험. 전처리 설정(인코딩)과 학습 행 번호가 여기서 나온다. */
  readonly experiment: Experiment
  /** 정본 데이터. **없을 수 있다** — 데이터를 뺀 채로 받은 파일이 그렇다. */
  readonly dataset: Dataset | null
  /** 그 실험의 전처리기. 파일에서 읽어 검증한 것이고, 못 읽었으면 `null`이다. */
  readonly preprocessor: Preprocessor | null
  /** 이 run의 모델 바이트. 파일에 안 담겼으면 `undefined`다 (`run.modelOmitted`). */
  readonly modelBytes: Uint8Array | undefined
}

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
    dataTypes: { tabular: true, image: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    hasData: (run) => run.confusionMatrix !== undefined,
    panel: defineAsyncComponent(() => import('@/views/results/panels/ConfusionMatrixPanel.vue')),
  },
  {
    id: 'per-class',
    dataTypes: { tabular: true, image: true },
    taskTypes: { classification: true, regression: false, clustering: false },
    hasData: (run) => run.perClass !== undefined,
    panel: defineAsyncComponent(() => import('@/views/results/panels/PerClassPanel.vue')),
  },
  {
    id: 'cluster-result',
    // **이미지 군집은 산점도를 안 그린다** (open-decisions.md #28-8). 묶인 사진을 그대로
    // 보여주는 쪽이 비교도 안 되게 많은 것을 말한다. 그 판은 따로 등록된다.
    dataTypes: { tabular: true, image: false },
    taskTypes: { classification: false, regression: false, clustering: true },
    /**
     * **모델이 있어야 그릴 수 있다** (§9.5, `open-decisions.md` #28-4). 군집 배정은
     * 파일에 안 담기고 모델로 되계산하므로, 모델이 없으면 재료가 없다 — 그때 화면은
     * 아무 말도 안 한다(사유는 `run.modelOmitted`가 다른 자리에서 말한다).
     *
     * 데이터셋과 전처리기도 필요하지만 **그건 run이 아니라 파일에 달린 사실**이라
     * 여기서 답할 수 없다. 그 둘이 없을 때는 패널이 자기 자리에서 아무것도 안 그린다.
     */
    hasData: (run) => run.model !== undefined,
    panel: defineAsyncComponent(() => import('@/views/results/panels/ClusterResultPanel.vue')),
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
