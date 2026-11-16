/**
 * 프로젝트 흐름도의 모델 — 파일과 사실들에서 노드·간선·카드를 돌려주는 **순수 함수 하나**
 * (`architecture.md` §8.22, `open-decisions.md` 120).
 *
 * **읽기만 한다.** 이 모양은 그림이 아니라 "무엇이 있고 무엇이 이어지는가"다. 좌표는
 * `ml/flow-layout.ts`, 수는 계획을 거치는 쪽이, 강조는 `ml/flow-highlight.ts`가 맡는다.
 *
 * **Vue·스토어·계획·실험·학습 입력 모듈을 들이지 않는다.** 모델이 가볍게 서야 첫 화면이 계획
 * 코드를 안 싣는다. `tests/flow-model.spec.ts`의 *"이 모듈은 … 들이지 않는다"*가 이 파일의
 * 임포트를 문다.
 *
 * **종류마다 다른 것은 `FLOW_KINDS`에 적는다.** 표와 이미지는 전처리 자리의 이름과 종류, 파일
 * 이름이 사는 곳이 다르다. `if (dataType === …)`로 가르지 않는다(`CLAUDE.md` §2).
 *
 * **지금 설정에서 나오지 않는 노드와 간선은 모델에 없다.** 렌더러가 숨기지 않는다 — 군집화에는
 * 테스트 줄이 없고, 별도 테스트 데이터가 아니면 테스트 카드가 없다.
 *
 * **진한가 윤곽인가는 사실에만 묶는다** (`ProjectFacts`와 파일의 실행 기록). 방문 기록을 읽지
 * 않는다.
 */

import { splitsData, usesTarget } from '@/ml/selection'
import type { ProjectFile } from '@/project/format'
import { dataSettings, SPLIT_METHODS, type DataType, type TaskType } from '@/project/schema'
import type { ProjectFacts } from '@/router/steps'

/** 분할 방식. 스키마의 어휘를 그대로 따른다. */
type SplitMethod = (typeof SPLIT_METHODS)[number]

/** 노드. **차례가 곧 그리는 차례와 모델의 노드 차례다.** */
export const FLOW_NODE_IDS = [
  'file',
  'train',
  'test',
  'new',
  'p1',
  'p2',
  'p3',
  'learn',
  'exp',
  'eval',
  'pred',
] as const
export type FlowNodeId = (typeof FLOW_NODE_IDS)[number]

/**
 * 노드의 종류. `data`는 파일과 그 몫(막대와 카드)이고 `result`는 그 밖의 칸(상자·원)이다.
 * 경로 강조가 이 둘을 다르게 걷는다(`ml/flow-highlight.ts`).
 */
export const FLOW_NODE_KINDS = ['data', 'result'] as const
export type FlowNodeKind = (typeof FLOW_NODE_KINDS)[number]

/**
 * 흐르는 것. **선과 화살촉의 색이 이것으로 정해진다** — 흐르는 것마다 색이 하나다. `file`은
 * 전체 데이터의 색이고 선은 그것을 안 탄다(파일에서 나오는 선은 훈련·테스트의 색이다).
 */
export const FLOW_FLOWS = ['file', 'train', 'test', 'new', 'model', 'basis'] as const
export type FlowFlow = (typeof FLOW_FLOWS)[number]

/** 진한가(한 일) 윤곽인가(아직 안 한 일). */
export const FLOW_STATES = ['done', 'pending'] as const
export type FlowState = (typeof FLOW_STATES)[number]

/**
 * 전처리 자리의 모양.
 *
 * - `preprocess` — 훈련 데이터에서 구할 값이 있다. 기준 간선이 선다.
 * - `preprocessOff` — 구할 값이 하나도 없다. 점선 상자이고 기준 간선이 없다.
 * - `backbone` — 이미지. 백본 상자이고 기준 간선이 없다.
 * - `unknown` — 표인데 아직 계획에서 알 수 없다(창이 막 열렸거나 그림이 축약이다). 실선 상자이고
 *   기준 간선이 없다 — 알 수 없는 것을 그렸다 지우지 않는다.
 */
export const FLOW_PREPS = ['preprocess', 'preprocessOff', 'backbone', 'unknown'] as const
export type FlowPrep = (typeof FLOW_PREPS)[number]

/**
 * 그림 안의 낱말이 가리키는 로케일 키 — **리터럴 표다.** 키를 조립하면 `locales.spec.ts`가 사용된 키로
 * 세지 못한다. 흐름도만의 이름은 `flow.*`이고, 화면에 이미 있는 이름(데이터 전처리·학습 따위)은 그 키를 그대로 쓴다.
 */
export const FLOW_LABEL_KEYS = {
  file: 'flow.whole',
  train: 'flow.train',
  // 군집화에는 훈련 몫이 따로 없다. 전부가 학습에 들어가고 이름이 그것을 말한다.
  trainAll: 'flow.usable',
  test: 'flow.test',
  new: 'flow.newData',
  preprocess: 'preprocess.tabular.cleaningTitle',
  backbone: 'meta.image.backbone',
  learn: 'steps.train.label',
  experiment: 'flow.experiment',
  eval: 'steps.results.label',
  pred: 'steps.predict.label',
} as const
export type FlowLabelKey = (typeof FLOW_LABEL_KEYS)[keyof typeof FLOW_LABEL_KEYS]

/** 학습 상자 위 이름표의 키. 유형을 아직 안 골랐으면 `unset`이다. */
export const FLOW_TASK_LABEL_KEYS = {
  classification: 'flow.task.classification',
  regression: 'flow.task.regression',
  clustering: 'flow.task.clustering',
  unset: 'flow.task.unset',
} as const satisfies Record<TaskType | 'unset', string>
export type FlowTaskLabelKey = (typeof FLOW_TASK_LABEL_KEYS)[keyof typeof FLOW_TASK_LABEL_KEYS]

/** 모델이 로케일에 요구하는 키 전부. `tests/flow-model.spec.ts`가 세 로케일과 맞춘다. */
export const FLOW_ALL_LABEL_KEYS: readonly string[] = [
  ...Object.values(FLOW_LABEL_KEYS),
  ...Object.values(FLOW_TASK_LABEL_KEYS),
]

export interface FlowNode {
  readonly id: FlowNodeId
  readonly kind: FlowNodeKind
  readonly state: FlowState
  /** 이 노드가 담는 것의 색. 상자·원의 표지와 테두리가 이것을 따른다. */
  readonly flow: FlowFlow
  readonly labelKey: FlowLabelKey
  /** 전처리 자리(`p1`~`p3`)에만 있다. */
  readonly prep?: FlowPrep
}

export interface FlowEdge {
  readonly from: FlowNodeId
  readonly to: FlowNodeId
  readonly flow: FlowFlow
  /** 양 끝이 다 진할 때만 진하다. */
  readonly state: FlowState
}

/** 타깃 칩의 모양. `none`은 유형이 타깃을 안 사용하는 것(군집화)이라 칩 자리가 없다. */
export type FlowTargetChip = 'chosen' | 'empty' | 'none'

/** 데이터 카드. **파일 이름은 사용자 데이터라 모델이 글자로 들고 있고, 이미지는 없다.** */
export interface FlowCard {
  readonly id: 'whole' | 'testFile' | 'new'
  /** 이 카드의 막대와 이름표가 가리키는 노드. */
  readonly node: 'file' | 'test' | 'new'
  readonly fileName?: string | undefined
  readonly target: FlowTargetChip
}

export interface FlowModel {
  readonly dataType: DataType
  readonly cards: readonly FlowCard[]
  readonly nodes: readonly FlowNode[]
  readonly edges: readonly FlowEdge[]
  /** 노드 → 들어오는 노드들. 간선에서 만든다. 없는 노드는 칸이 없다. */
  readonly parents: Readonly<Partial<Record<FlowNodeId, readonly FlowNodeId[]>>>
  /** 이 유형이 데이터를 나누는가(분류·회귀, 그리고 아직 안 고른 유형). */
  readonly splitsData: boolean
  /** 테스트 데이터가 따로 온 파일에서 오는가. 군집화는 항상 거짓이다. */
  readonly provided: boolean
  /** 분할 막대를 훈련·테스트 두 조각으로 그리는가 — 나누는 유형이고 방식이 holdout이다. */
  readonly splits: boolean
  readonly prep: FlowPrep
  readonly experimentCount: number
  readonly taskLabelKey: FlowTaskLabelKey
}

/** 파일 이름이 사는 자리. 설정의 이름과 같다. */
type FileSlot = 'dataset' | 'testDataset' | 'predictDataset'

/** 종류마다 다른 것. */
interface FlowKind {
  /**
   * 전처리 자리의 모양. **표는 계획에서 알아야 하므로** 모델은 알려진 것만 받고, 모르면
   * `unknown`이다. 이미지는 늘 백본이다.
   */
  readonly prepOf: (known: FlowPrep | undefined) => FlowPrep
  readonly prepLabelKey: FlowLabelKey
  /** 사용자가 올린 파일의 이름. 이름이 없는 종류(사진 묶음)는 `undefined`다. */
  readonly fileNameOf: (file: ProjectFile, slot: FileSlot) => string | undefined
}

/**
 * **`Record<DataType, …>`이라 종류를 더하는 사람은 칸을 채워야 한다** — 빠뜨리면 컴파일이 깨진다
 * (`architecture.md` §9.3).
 */
export const FLOW_KINDS: Readonly<Record<DataType, FlowKind>> = {
  tabular: {
    // 알아낸 것이 `preprocess`나 `preprocessOff`일 때만 받는다. `backbone`은 표의 말이 아니다.
    prepOf: (known) => (known === 'preprocess' || known === 'preprocessOff' ? known : 'unknown'),
    prepLabelKey: FLOW_LABEL_KEYS.preprocess,
    fileNameOf: (file, slot) =>
      dataSettings('tabular', file.document.settings)[slot]?.originalFileName,
  },
  image: {
    prepOf: () => 'backbone',
    prepLabelKey: FLOW_LABEL_KEYS.backbone,
    // 사진은 폴더 참조라 파일 이름이 없다.
    fileNameOf: () => undefined,
  },
}

/** 기준 간선(훈련 데이터에서 구한 값)이 서는 전처리 모양인가. */
export function hasBasis(prep: FlowPrep): boolean {
  return prep === 'preprocess'
}

/**
 * 분할 방식마다 다른 것. **`Record<SplitMethod, …>`이라 방식이 늘면 칸을 채워야 한다.**
 * `testFromFile`은 테스트 데이터가 따로 올린 파일에서 오는가다.
 */
const SPLIT_FLOW: Readonly<Record<SplitMethod, { readonly testFromFile: boolean }>> = {
  holdout: { testFromFile: false },
  provided: { testFromFile: true },
}

/** 이 분할 방식은 테스트 데이터를 따로 올린 파일에서 가져오는가. 수를 세는 쪽(`ml/flow-counts.ts`)도 같은 표를 묻는다. */
export function splitTestFromFile(method: SplitMethod): boolean {
  return SPLIT_FLOW[method].testFromFile
}

/** 간선을 만들 때 묻는 사정. */
interface EdgeContext {
  readonly splitsData: boolean
  readonly provided: boolean
  readonly basis: boolean
}

interface EdgeRule {
  readonly from: FlowNodeId
  readonly to: FlowNodeId
  readonly flow: FlowFlow
  readonly present: (context: EdgeContext) => boolean
}

const ALWAYS = (): boolean => true

/**
 * 간선 표. **차례는 그리는 차례가 아니다** — 겹침의 위아래는 `ml/flow-layout.ts`가 정한다.
 * 존재 여부는 이 표가 정하고, 양 끝 노드가 모델에 없으면 거른다.
 */
const ALL_EDGES: readonly EdgeRule[] = [
  { from: 'file', to: 'train', flow: 'train', present: ALWAYS },
  { from: 'file', to: 'test', flow: 'test', present: (c) => c.splitsData && !c.provided },
  { from: 'train', to: 'p1', flow: 'train', present: ALWAYS },
  { from: 'test', to: 'p2', flow: 'test', present: (c) => c.splitsData },
  { from: 'new', to: 'p3', flow: 'new', present: ALWAYS },
  { from: 'p1', to: 'p2', flow: 'basis', present: (c) => c.splitsData && c.basis },
  { from: 'p1', to: 'p3', flow: 'basis', present: (c) => c.basis },
  { from: 'p1', to: 'learn', flow: 'train', present: ALWAYS },
  { from: 'learn', to: 'exp', flow: 'model', present: ALWAYS },
  { from: 'p2', to: 'eval', flow: 'test', present: (c) => c.splitsData },
  // 군집화는 테스트 줄이 없어 결과가 훈련 쪽 전처리를 곧장 받는다.
  { from: 'p1', to: 'eval', flow: 'train', present: (c) => !c.splitsData },
  { from: 'exp', to: 'eval', flow: 'model', present: ALWAYS },
  { from: 'exp', to: 'pred', flow: 'model', present: ALWAYS },
  { from: 'p3', to: 'pred', flow: 'new', present: ALWAYS },
]

/** 노드의 모양. `label`이 `prep`이면 종류의 전처리 자리 이름(`FlowKind.prepLabelKey`)이다. */
interface NodeShape {
  readonly kind: FlowNodeKind
  readonly flow: FlowFlow
  readonly label: FlowLabelKey | 'prep'
  /** 데이터를 안 나누는 유형(군집화)에서 달라지는 것. */
  readonly unsplit?: { readonly flow?: FlowFlow; readonly label?: FlowLabelKey }
}

/** 노드마다 정해진 것. **`Record<FlowNodeId, …>`이라 노드를 더하면 칸을 채워야 한다.** */
const NODE_SHAPE: Readonly<Record<FlowNodeId, NodeShape>> = {
  file: { kind: 'data', flow: 'file', label: FLOW_LABEL_KEYS.file },
  // 군집화에는 훈련 몫이 따로 없다. 전부가 학습에 들어가고 이름이 그것을 말한다.
  train: {
    kind: 'data',
    flow: 'train',
    label: FLOW_LABEL_KEYS.train,
    unsplit: { label: FLOW_LABEL_KEYS.trainAll },
  },
  test: { kind: 'data', flow: 'test', label: FLOW_LABEL_KEYS.test },
  new: { kind: 'data', flow: 'new', label: FLOW_LABEL_KEYS.new },
  p1: { kind: 'result', flow: 'train', label: 'prep' },
  p2: { kind: 'result', flow: 'test', label: 'prep' },
  p3: { kind: 'result', flow: 'new', label: 'prep' },
  learn: { kind: 'result', flow: 'train', label: FLOW_LABEL_KEYS.learn },
  exp: { kind: 'result', flow: 'model', label: FLOW_LABEL_KEYS.experiment },
  // 테스트 줄이 없으면 결과가 훈련 쪽 전처리를 받는다 — 색도 훈련이다.
  eval: {
    kind: 'result',
    flow: 'test',
    label: FLOW_LABEL_KEYS.eval,
    unsplit: { flow: 'train' },
  },
  pred: { kind: 'result', flow: 'new', label: FLOW_LABEL_KEYS.pred },
}

/** 전처리 자리인 노드. */
const PREP_NODES: ReadonlySet<FlowNodeId> = new Set<FlowNodeId>(['p1', 'p2', 'p3'])

const state = (done: boolean): FlowState => (done ? 'done' : 'pending')

/**
 * 프로젝트 파일과 사실들에서 흐름도의 모델을 짓는다. **데이터가 없으면 `null`이다** — 그림 자리가
 * 없다(그 자리는 화면이 정한다).
 *
 * `prep`은 **계획에서 알아낸 전처리 모양**이다(`flowCountsOf`가 `prep`으로 낸다). 모르면 빼라 — 표는
 * `unknown`이고 이미지는 늘 백본이다. 이 함수가 계획을 부르지 않는 것이 이 모듈의 존재 이유다.
 */
export function flowModelOf(
  file: ProjectFile | null,
  facts: ProjectFacts,
  prep?: FlowPrep,
): FlowModel | null {
  if (file === null || !facts.datasetReady) return null

  const { manifest, settings, runs } = file.document
  const { dataType, taskType } = manifest
  const kind = FLOW_KINDS[dataType]

  const splits = splitsData(taskType)
  const targeted = usesTarget(taskType)
  const provided = splits && splitTestFromFile(settings.split.method)
  const prepKind = kind.prepOf(prep)
  const basis = hasBasis(prepKind)

  // --- 상태. 판정은 사실에만 묶는다.
  const experiments = runs.experiments
  // 점수를 볼 수 있는 실행이 있는가. 모델 없이 지표만 남은 것(예산 초과)도 센다.
  const scored = experiments.some((experiment) =>
    experiment.runs.some((run) => run.status === 'done'),
  )
  const prepared = facts.featuresChosen && (targeted ? facts.targetChosen : true)
  const states: Readonly<Record<FlowNodeId, FlowState>> = {
    file: state(facts.datasetReady),
    train: state(facts.datasetReady),
    test: state(facts.datasetReady),
    new: state(facts.modelReady),
    p1: state(prepared),
    p2: state(prepared),
    p3: state(facts.modelReady),
    learn: state(facts.taskTypeChosen && facts.algorithmsChosen),
    exp: state(experiments.length > 0),
    eval: state(scored),
    pred: state(facts.modelReady),
  }

  // --- 노드. 지금 설정에서 나오지 않는 것은 뺀다.
  const present = new Set<FlowNodeId>(FLOW_NODE_IDS)
  if (!splits) {
    present.delete('test')
    present.delete('p2')
  }
  const nodes: FlowNode[] = FLOW_NODE_IDS.filter((id) => present.has(id)).map((id) => {
    const shape = NODE_SHAPE[id]
    const variant = splits ? undefined : shape.unsplit
    const label = variant?.label ?? shape.label
    return {
      id,
      kind: shape.kind,
      flow: variant?.flow ?? shape.flow,
      state: states[id],
      labelKey: label === 'prep' ? kind.prepLabelKey : label,
      ...(PREP_NODES.has(id) ? { prep: prepKind } : {}),
    }
  })

  // --- 간선과 부모.
  const context: EdgeContext = { splitsData: splits, provided, basis }
  const edges: FlowEdge[] = ALL_EDGES.filter(
    (rule) => rule.present(context) && present.has(rule.from) && present.has(rule.to),
  ).map((rule) => ({
    from: rule.from,
    to: rule.to,
    flow: rule.flow,
    state: state(states[rule.from] === 'done' && states[rule.to] === 'done'),
  }))
  const parents: Partial<Record<FlowNodeId, FlowNodeId[]>> = {}
  for (const id of present) parents[id] = []
  for (const edge of edges) parents[edge.to]?.push(edge.from)

  // --- 카드.
  const target: FlowTargetChip = targeted ? (facts.targetChosen ? 'chosen' : 'empty') : 'none'
  const cards: FlowCard[] = [
    { id: 'whole', node: 'file', fileName: kind.fileNameOf(file, 'dataset'), target },
  ]
  if (provided) {
    cards.push({
      id: 'testFile',
      node: 'test',
      fileName: kind.fileNameOf(file, 'testDataset'),
      target,
    })
  }
  cards.push({
    id: 'new',
    node: 'new',
    fileName: kind.fileNameOf(file, 'predictDataset'),
    target: 'none',
  })

  return {
    dataType,
    cards,
    nodes,
    edges,
    parents,
    splitsData: splits,
    provided,
    splits: splits && !splitTestFromFile(settings.split.method),
    prep: prepKind,
    experimentCount: experiments.length,
    taskLabelKey: FLOW_TASK_LABEL_KEYS[taskType ?? 'unset'],
  }
}
