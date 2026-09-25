/**
 * 화면들이 나눠 쓰는 **표 프로젝트의 계획** (`ml/plan.ts`의 `planRun`).
 *
 * 전처리 판 · 학습 화면 · 학습 머리가 같은 계획으로 열 종류를 말한다(`plannedColumns`). 계획은
 * 입력이 같으면 다시 짓지 않는다. 스토어가 프로젝트를 열고 닫을 때 이 캐시를
 * 비우므로(`forgetTabularPlan`) 스토어가 이 모듈을 부른다. **이 파일은 Vue도 스토어도 직접
 * 들이지 않는다** — `tabular-plan-cache.spec.ts`의 *"이 모듈은 Vue와 스토어를 들이지 않는다"*가
 * 이 파일의 임포트를 문다(이 파일이 들이는 모듈의 속까지는 안 본다).
 */

import { summarizeColumns, type ColumnSummary } from '@/data/columns'
import { plannedColumns, planRun, type RunPlan } from '@/ml/plan'
import type { Dataset } from '@/ml/preprocess'
import { readDataset, readTestDataset } from '@/project/dataset'
import type { ProjectFile } from '@/project/format'
import { tabularDataOf, type Settings, type TaskType } from '@/project/schema'

/**
 * `planRun`이 읽는 것 전부 — **이것이 같으면 계획도 같다.** 값이 아니라 **객체의 동일성**으로
 * 견준다: 설정 문(`project/settings.ts`)은 바꾸는 칸만 새로 짓고 나머지는 그대로 물려준다.
 * `planRun`이 읽는 칸이 늘면 여기에도 는다.
 *
 * `tabular-plan-cache.spec.ts`의 무작위 편집 걸음이 무는 칸은 **`data`·`split`·`nSamples`·
 * `taskType`** 넷이다. **`dataset`·`testDataset`은 예비 칸이다** — 정본이나 테스트 표를 갈아
 * 끼우는 쪽(`applyDataset`·`applyTestDataset`·`removeTestDataset`)이 늘 `settings.data`도 새로
 * 지으므로 오늘은 `data`가 먼저 갈린다. 둘을 빼도 걸음은 초록이다(잰 값). 표만 바꾸고
 * `data`를 물려주는 쓰기가 생기는 날을 위해 남긴다.
 */
interface PlanInputs {
  readonly dataset: Dataset
  readonly testDataset: Dataset | null
  readonly data: Settings['data']
  readonly split: Settings['split']
  readonly nSamples: Settings['nSamples']
  readonly taskType: TaskType | undefined
}

function sameInputs(a: PlanInputs, b: PlanInputs): boolean {
  return (
    a.dataset === b.dataset &&
    a.testDataset === b.testDataset &&
    a.data === b.data &&
    a.split === b.split &&
    a.nSamples === b.nSamples &&
    a.taskType === b.taskType
  )
}

/** 마지막으로 지은 계획. **한 칸이다** — 한 탭에 열린 프로젝트는 하나다. */
let lastPlan: { readonly inputs: PlanInputs; readonly plan: RunPlan } | null = null

/**
 * 한 칸 캐시를 비운다. **다른 프로젝트를 열거나 닫을 때 스토어가 부른다**(`stores/project.ts`의
 * `open`·`close`) — 안 비우면 떠난 프로젝트의 표와 계획을 다음 계획이 설 때까지 쥐고 있다.
 * `tabular-plan-cache.spec.ts`의 *"프로젝트를 닫거나 바꾸면 캐시가 빈다"*가 문다.
 */
export function forgetTabularPlan(): void {
  lastPlan = null
}

/** 지금 한 칸에 계획이 있는가. **검사용이다** — 화면은 읽지 않는다. */
export function holdsTabularPlan(): boolean {
  return lastPlan !== null
}

/**
 * 표 프로젝트의 **지금 설정으로 세운 계획**. 표가 없으면(이미지 · 정본 없음) `null`이다.
 *
 * **계획의 입력이 같으면 다시 짓지 않는다** (`PlanInputs`). 계획에 안 들어가는 편집
 * (하이퍼파라미터 · 모델 추가 · 이름)에는 `fitPreprocessor`가 돌지 않는다.
 * `tabular-plan-cache.spec.ts`가 안 짓는 편집과 다시 짓는 편집을 둘 다 문다.
 *
 * **유형은 파일의 것이다** — 스토어의 `taskType`도 같은 칸을 읽는다.
 */
export function tabularPlanOf(project: ProjectFile | null): RunPlan | null {
  const dataset = readDataset(project)
  if (!project || !dataset) return null
  const { settings } = project.document
  const inputs: PlanInputs = {
    dataset,
    testDataset: readTestDataset(project),
    data: settings.data,
    split: settings.split,
    nSamples: settings.nSamples,
    taskType: project.document.manifest.taskType,
  }
  if (lastPlan !== null && sameInputs(lastPlan.inputs, inputs)) return lastPlan.plan
  const plan = planRun({
    dataset,
    testDataset: inputs.testDataset,
    settings,
    taskType: inputs.taskType,
  })
  lastPlan = { inputs, plan }
  return plan
}

const summaries = new WeakMap<Dataset, ColumnSummary[]>()

/** 열 요약. **표 하나에 한 번 센다** — 표 객체는 정본이 바뀔 때만 새로 선다(`readDataset`). */
function summariesOf(dataset: Dataset): ColumnSummary[] {
  let found = summaries.get(dataset)
  if (found === undefined) {
    found = summarizeColumns(dataset)
    summaries.set(dataset, found)
  }
  return found
}

/**
 * 표 프로젝트의 열 요약 — **종류는 계획이 본 것이다** (`plannedColumns`). 표가 없으면 빈 목록.
 *
 * 학습 화면과 학습 머리가 이것을 쓴다. 전처리 판은 계획을 따로 들고 있어야 해서(미리보기 ·
 * 요약 카드) 같은 두 함수를 직접 부른다.
 */
export function plannedColumnsOf(project: ProjectFile | null): ColumnSummary[] {
  const dataset = readDataset(project)
  if (!project || !dataset) return []
  return plannedColumns(
    summariesOf(dataset),
    tabularPlanOf(project),
    tabularDataOf(project.document)?.target,
  )
}
