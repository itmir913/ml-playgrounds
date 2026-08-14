/**
 * 답 하나에 붙는 **증거** 등록부 (architecture.md §9).
 *
 * **`3번 군집`은 그 자체로 아무 말도 안 한다.** 표에는 산점도와 이웃이 그 자리를 답하는데
 * (§8.13.1) 이미지에는 번호뿐이었다 — 학생이 확인할 방법이 없다. 그래서 답 옆에 "이
 * 군집이 무엇인지"를 보여줄 것을 하나 붙인다.
 *
 * **무엇을 붙일지는 답 목록이 모른다.** `AnswerList`에 `if (dataType === 'image')`가
 * 생기는 순간, 음성이 오는 날 고쳐야 할 파일이 등록부 하나가 아니라 그 사실을 아는 화면
 * 전부가 된다 (§9.1, `ml/metric-panels.ts`와 같은 이유·같은 짜임).
 *
 * **없는 조합이 정상이다.** 분류 답에는 증거가 안 붙고(답이 곧 범주 이름이라 더 할 말이
 * 없다), 표 군집에도 안 붙는다 — 거기는 산점도와 이웃이 이미 목록 밖에 서 있다.
 * 그때 화면은 **아무 말도 안 한다** (§9.2 "없는 것을 이름으로 말하지 않는다").
 */

import { defineAsyncComponent, type Component } from 'vue'

import type { DataType, Experiment, Run, TaskType } from '../project/schema'
import { supports, type Axis } from './axes'

/**
 * 증거가 받는 것 전부. **하나로 묶어 넘긴다** (`PanelInput`과 같은 규칙) — 개별 프롭으로
 * 흩으면 계약이 넓어질 때마다 증거 전부를 고쳐야 하고, 하나를 빠뜨린 것은 컴파일도
 * 검사도 못 잡는다.
 *
 * **모델 바이트도 전처리기도 안 들어 있다.** 증거는 화면 컴포넌트라 프로젝트 저장소를
 * 직접 읽을 수 있고, 그 둘은 파일에서 꺼내는 것이지 답에 딸린 사실이 아니다.
 */
export interface AnswerEvidenceInput {
  /** 이 답을 낸 모델의 실험. 백본과 전처리기가 여기서 나온다. */
  readonly experiment: Experiment
  readonly run: Run
  /** 답 그 자체. 군집 증거는 이 번호의 묶음을 연다. */
  readonly value: number
}

export interface AnswerEvidence {
  /** 화면에 안 나온다. 검사와 `v-for`의 key에만 쓴다. */
  readonly id: string
  readonly dataTypes: Axis<DataType>
  readonly taskTypes: Axis<TaskType>
  /**
   * 이 실행에 실제로 보여줄 재료가 있는가. **축과 별개다** (§9.5, `MetricPanel.hasData`).
   *
   * 군집 배정은 파일에 안 담기고 모델로 되계산하므로(#28-4), 모델이 안 담긴 실행에는
   * 열어도 보여줄 것이 없다 — 그때는 여는 단추 자체를 안 단다.
   */
  readonly hasData: (run: Run) => boolean
  /** 지연 로딩한다. 표만 쓰는 학생이 사진 격자 코드를 받을 이유가 없다. */
  readonly panel: Component
}

const EVIDENCE: readonly AnswerEvidence[] = [
  {
    id: 'image-cluster-members',
    // 표 군집에는 안 붙는다 — 산점도와 이웃이 그 자리를 이미 답한다 (§8.13.1).
    dataTypes: { tabular: false, image: true },
    taskTypes: { classification: false, regression: false, clustering: true },
    hasData: (run) => run.model !== undefined,
    panel: defineAsyncComponent(() => import('@/views/predict/ImageClusterEvidence.vue')),
  },
]

/**
 * 이 답에 붙일 증거. **없으면 `null`이고, 그것이 정상인 조합이 있다.**
 *
 * 순수 함수다. 화면은 결과를 그대로 그리기만 한다 (§8.3).
 */
export function answerEvidenceFor(
  dataType: DataType,
  taskType: TaskType,
  run: Run,
  evidence: readonly AnswerEvidence[] = EVIDENCE,
): AnswerEvidence | null {
  return (
    evidence.find(
      (entry) =>
        supports(entry.dataTypes, dataType) &&
        supports(entry.taskTypes, taskType) &&
        entry.hasData(run),
    ) ?? null
  )
}

/** 등록부 전체. 검사가 표를 훑는 데 쓴다. */
export const ANSWER_EVIDENCE = EVIDENCE
