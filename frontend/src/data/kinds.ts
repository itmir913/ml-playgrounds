/**
 * 데이터 종류 등록부.
 *
 * **`if (dataType === 'image')`를 만들지 마라** (CLAUDE.md §2, architecture.md §6).
 * V1은 표뿐이지만 최종 목표는 학생이 이미지·음성·텍스트로도 포트폴리오를 만드는
 * 것이고, 그때 데이터 화면을 고치는 것이 아니라 **여기 줄 하나를 더한다.**
 *
 * 판(panel)을 지연 로딩하는 이유는 학생이 쓰지 않는 종류의 화면을 받게 할 이유가
 * 없어서다. 표만 쓰는 수업에서 이미지 판의 코드가 내려오면 안 된다.
 */

import { defineAsyncComponent, type Component } from 'vue'

import { IMAGE_ACCEPT } from '@/data/image/upload'
import { TABULAR_ACCEPT } from '@/data/table'
import type { DataType } from '@/project/schema'
import type { EngineState } from '@/ml/backend'
import { factLabelKey, type FactKey, type StepId, type StepTextSlot } from '@/router/steps'

export interface DataKind {
  readonly dataType: DataType
  /**
   * 새 프로젝트에서 이 종류를 고르는 칸의 이름. **번역 키다** (architecture.md §8.10).
   *
   * 화면이 `dataTypes.tabular`를 직접 쓰지 않는 이유는, 그러면 종류를 더하는 사람이
   * 판만 등록하고 문구를 빠뜨려도 **컴파일이 통과하기** 때문이다. 여기 있으면 칸을
   * 못 채운다.
   */
  readonly labelKey: string
  /** `<input accept>`에 그대로 들어간다. */
  readonly accept: string
  /** 데이터 화면에서 이 종류를 다루는 작업 공간. */
  readonly panel: Component
  /**
   * 전처리 화면에서 이 종류를 다루는 작업 공간.
   *
   * **판이 자기 레이아웃을 갖는다.** 표는 열이 수십 개라 넓은 칸이 필요하고 이미지는
   * 전혀 다른 모양이 된다 (architecture.md §8.9).
   *
   * **테스트 데이터를 어디서 받나도 판의 몫이다** (§9.1.1) — 표는 파일 하나이고 이미지는
   * 폴더나 zip이 된다. 판이 `<slot>`으로 받는 것은 **얼마나 나눌 것인가**(비율·층화·
   * 씨앗)뿐이고, 그것만 `settings.split`이라 모든 종류에 공통이다.
   *
   * **화면 둘을 한 줄에 둔다.** 같은 열쇠(dataType)로 등록부를 둘 만들면 한쪽에만
   * 줄을 넣는 일이 생기고, 그건 타입이 못 잡는다 (§9.2 "등록부의 모양은 하나다").
   */
  readonly prepPanel: Component
  /**
   * 전처리 화면 **머리**의 문맥 (`StepHeader`의 `#context`).
   *
   * 판과 따로인 이유는 자리가 다르기 때문이다 — 머리는 제목·목적과 한 덩어리라
   * 종류마다 다시 그리면 그 셋이 종류 수만큼 복제된다. **그렇다고 화면이 갖고 있을
   * 수도 없다** — 거기 있던 "열 수"는 표에만 있는 말이고, 타입이 못 잡는 자리였다
   * (architecture.md §9.3.2).
   */
  readonly prepContext: Component
  /**
   * 학습 화면 **머리**의 문맥. `prepContext`와 같은 사정이다 — 거기 있던 "타깃"과
   * "특성 n개"는 표에만 있는 말이고, 이미지에는 타깃 열이 없다.
   */
  readonly trainContext: Component
  /**
   * 예측 화면에서 이 종류를 다루는 작업 공간.
   *
   * **표는 입력이 양자택일이고 이미지는 아니다** (open-decisions.md "이미지 예측 화면") —
   * 사진에는 "손으로 채우기"에 해당하는 것이 없어서 고를 갈래가 안 생긴다. 판이
   * 갈리는 이유가 문구가 아니라 **동작의 수**다.
   */
  readonly predictPanel: Component
  /**
   * 단계 문구 중 **이 종류에서 달라지는 것만** (architecture.md §8.10).
   *
   * 없으면 `steps.{단계}.{자리}`가 기본이다. **전부를 다시 쓰게 하지 않는다** — 여섯
   * 단계를 종류마다 적게 하면 공통 문장이 종류 수만큼 복제되고, 그중 하나만 고치는
   * 일이 반드시 생긴다. 체크리스트 문구(`router/steps.ts`의 `TASK_LABELS`)와 같은
   * 모양이다.
   *
   * **다만 종류를 가리는 셋에는 기본값이 없다** (`KIND_SPECIFIC_STEP_TEXT`). 거기는
   * 모든 종류가 자기 문장을 선언해야 하고, 표도 예외가 아니다.
   *
   * **빠뜨리면 `tests/kinds.spec.ts`가 운다.** `Partial`이라 타입으로는 못 잡는다.
   *
   * **키는 `steps.{단계}.{종류}.{자리}`다** (2026-08-14, `docs/i18n.md` 규칙 10).
   * 화면 이름 아래(`data.image.purpose`) 두었더니 갈리는 자리 넷이 네 네임스페이스에
   * 흩어졌고, 종류가 하나 늘 때 그 넷을 찾아다녀야 했다. **이 문장들은 화면의 문장이
   * 아니라 단계 축의 문장이다** — 대시보드 줄·레일의 잠금 사유·화면 머리가 같은 것을
   * 쓴다. 화면 본문의 종류별 문구는 여전히 그 화면 이름 아래다(`data.image.add`).
   */
  readonly stepText: Partial<Record<StepId, Partial<Record<StepTextSlot, string>>>>
  /**
   * 학습 앞에 붙는 **준비 진행 문구의 키.** `{done}`과 `{total}`을 받는다.
   *
   * **없는 것이 정상이다** — 표는 학습 전에 준비할 것이 없어 이 자리가 한 번도 안 뜬다.
   * 이미지는 백본을 받고 사진을 통과시키는 시간이 앞에 붙는다.
   *
   * **학습 화면이 이 문구를 직접 들고 있었다** — 종류를 모르는 화면 안에 이미지의
   * 키가 박혀 있었고, 그건 음성이 들어오는 날 `v-if`가 될 자리다.
   *
   * **문장은 `meta.{종류}.*`에 산다** (docs/i18n.md 규칙 10). 데이터·학습·예측 세
   * 화면이 같은 것을 읽으므로 어느 한 화면의 문장이 아니다.
   */
  readonly preparingKey?: string
  /**
   * 세기 전 단계의 문구 — **무엇을 준비하는 중인가.**
   *
   * `engineState.*`는 상태의 이름일 뿐이라 화면에 혼자 서면 **무엇이 준비되지 않았고
   * 무엇을 내려받는지가 없다.** 학생이 이 화면에서 가장 오래 기다리는 자리가 여기다
   * (백본 12.4MB).
   *
   * **`Record<EngineState, …>`이라 상태를 더하는 사람은 칸을 채워야 한다.**
   * `preparingKey`와 짝이다 — 준비가 있는 종류는 둘 다 갖는다(`tests/kinds.spec.ts`).
   */
  readonly engineStateKeys?: Readonly<Record<EngineState, string>>
  /**
   * 내려받은 비율을 아는 동안 쓸 문구. **`engineStateKeys.downloading`을 대신한다.**
   *
   * 상태만 말하는 문장은 몇십 초를 덮는 동안 아무것도 안 바뀐다 — 학생은 멈춘 줄
   * 안다 (2026-08-29 화면 실측 C-7). 비율은 TF.js가 줄 때만 오므로 **문구도 둘이다.**
   */
  readonly engineDownloadingWithPercent?: string
  /**
   * 프로젝트 요약에서 **이 종류만 답할 수 있는 줄들** (`components/ProjectSummary.vue`).
   *
   * 표는 파일 이름·행·열·타깃·특성이고 이미지는 사진 수·범주 수다. 요약 화면이 그걸
   * 알면 이미지 프로젝트에 `타깃: 없음 · 특성: 0개`가 뜬다 — **없는 것이 아니라 애초에
   * 그 종류에 없는 항목**인데 "아직 안 골랐다"로 읽힌다 (§9.3.2).
   */
  readonly summaryRows: Component
}

/**
 * 이 종류에서 이 단계의 문구 키. **화면은 이것만 부른다** — `steps.*`를 직접 읽으면
 * 종류가 늘 때 고칠 자리가 화면 수만큼이 되고, 그중 하나를 빠뜨린 것은 컴파일도
 * 검사도 못 잡는다 (§9.1).
 */
export function stepTextKey(kind: DataKind | undefined, step: StepId, slot: StepTextSlot): string {
  return kind?.stepText[step]?.[slot] ?? `steps.${step}.${slot}`
}

/**
 * 잠긴 단계에 할 말. **문구 키와 채울 값을 함께 준다** — `t()`는 화면이 부른다.
 *
 * **손으로 쓴 문장이 있으면 그것이 이긴다.** 대부분의 단계는 막는 사실이 하나뿐이라
 * ("학습을 한 번 마치면 열립니다") 사람이 쓴 쪽이 더 잘 읽힌다.
 *
 * **없으면 막고 있는 일의 이름을 댄다.** 학습 단계가 그 자리다 — 막을 수 있는 사실이
 * 셋인데 문장이 하나여서, 새 표 프로젝트에서 *"전처리 단계에서 할 일을 먼저 마쳐
 * 주세요"*라고 말하면서 **전처리도 잠겨 있었다** (V11 R5 B-10). 실제로 막는 것은
 * 데이터였다. 이제 `stepBlockers`가 그 사실을 주므로 화면이 맞는 일을 가리킨다.
 *
 * **밖으로 안 나간다** (2026-09-03 R24 재검토 B-N1). 이 값의 `params.task`는 문장이 아니라
 * **로케일 키**라 한 번 더 번역해야 하는데, 이것을 받아 `t()`에 바로 넣은 화면이 세 번째로
 * 생겼다 — 학생이 카드에서 `tasks.image.targetChosen`을 읽었다. 화면이 부를 수 있는 것은
 * 아래 `lockedSentenceFor` 하나다: 키를 얻는 길이 없으면 잘못 넣을 길도 없다.
 */
function lockedTextFor(
  kind: DataKind | undefined,
  step: StepId,
  blockers: readonly FactKey[],
  dataType?: DataType | undefined,
): { key: string; params?: Record<string, string> } {
  const own = kind?.stepText[step]?.locked
  if (own !== undefined) return { key: own }
  // **손으로 쓴 문장이 없으면 막는 일의 이름을 댄다.** 여기서 `steps.{step}.locked`로
  // 물러서지 않는다 - 그 키는 없고, 조립한 단계 문구는 `ui-rules`가 막는다.
  return {
    key: 'tasks.lockedBy',
    params: { task: factLabelKey(blockers[0] ?? 'datasetReady', dataType) },
  }
}

/** 잠금 문장에 든 것들. 값은 **또 다른 로케일 키**라 부르는 쪽이 한 번 더 번역한다. */
export interface LockedText {
  readonly key: string
  readonly params?: Record<string, string>
}

/** 키 하나를 문장으로 바꾸는 것. 이 층은 `t()`를 모른다 (`CLAUDE.md` §1.4·§3). */
export type Translate = (key: string, params?: Record<string, string>) => string

/**
 * 잠긴 줄에 세울 문장.
 *
 * **자리표시자를 채우는 것이 판정의 일부다.** 화면 둘이 이 두 줄을 똑같이 복사해
 * 갖고 있었고, 어느 스펙도 그 자리를 안 지나갔다 — 안 넘기면 `vue-i18n`이 **빈
 * 문자열로 그려서** 예외도 안 나고 키도 안 뜨고 **막는 일의 이름만 조용히 사라진다**
 * (2026-08-31 검증 감사 C-3, `ml/selection.ts`의 `columnNote`와 같은 병이다).
 *
 * `task`는 값이 아니라 **로케일 키**라 한 번 더 번역해서 넣는다.
 */
export function lockedSentence(text: LockedText, translate: Translate): string {
  const task = text.params?.task
  return task === undefined ? translate(text.key) : translate(text.key, { task: translate(task) })
}

/**
 * **잠긴 자리에 세울 문장을 만드는 유일한 입구.** 레일·홈·학습 화면의 유형 카드가 전부
 * 이것을 부른다 (architecture.md §10.5) — 같은 사실을 세 자리가 다른 글자로 말하면 학생은
 * 셋을 다른 일로 읽는다.
 *
 * 판정(`lockedTextFor`)과 번역(`lockedSentence`)을 한 함수로 묶는 이유는, 둘을 따로
 * 내주면 **키를 문장인 줄 알고 넣는 화면이 다시 생기기 때문이다.** 2026-08-31에 둘,
 * 2026-09-02에 하나였다. `task-type-trap.spec.ts`가 학습 화면을 띄워 그 글자를 잰다.
 */
export function lockedSentenceFor(
  kind: DataKind | undefined,
  step: StepId,
  blockers: readonly FactKey[],
  dataType: DataType | undefined,
  translate: Translate,
): string {
  return lockedSentence(lockedTextFor(kind, step, blockers, dataType), translate)
}

/**
 * 등록된 판들. **새 프로젝트 화면이 고를 것을 여기서 만든다** — 종류 목록과 그 이름이
 * 같은 줄에서 나와야 한 쪽만 늘어나는 일이 없다.
 */
export const DATA_KINDS: readonly DataKind[] = [
  {
    dataType: 'tabular',
    labelKey: 'dataTypes.tabular',
    accept: TABULAR_ACCEPT,
    panel: defineAsyncComponent(() => import('@/views/data/TabularPanel.vue')),
    prepPanel: defineAsyncComponent(() => import('@/views/preprocess/TabularPrepPanel.vue')),
    prepContext: defineAsyncComponent(() => import('@/views/preprocess/TabularPrepContext.vue')),
    trainContext: defineAsyncComponent(() => import('@/views/train/TabularTrainContext.vue')),
    predictPanel: defineAsyncComponent(() => import('@/views/predict/TabularPredictPanel.vue')),
    // **표도 자기 문장을 선언한다.** 이걸 비워 두고 `steps.*`에 표의 문장을 두었더니
    // 그것이 기본값이 되었고, 그러면 다음에 들어오는 종류가 아무것도 안 써도 화면이
    // 멀쩡해 보인다 — 조용히 표의 말을 하면서 (docs/i18n.md 규칙 10).
    stepText: {
      data: { purpose: 'steps.data.tabular.purpose' },
      preprocess: {
        purpose: 'steps.preprocess.tabular.purpose',
        locked: 'steps.preprocess.tabular.locked',
        emptyReason: 'steps.preprocess.tabular.emptyReason',
        emptyNext: 'steps.preprocess.tabular.emptyNext',
      },
      predict: { purpose: 'steps.predict.tabular.purpose' },
    },
    summaryRows: defineAsyncComponent(() => import('@/components/summary/TabularSummaryRows.vue')),
  },
  {
    dataType: 'image',
    labelKey: 'dataTypes.image',
    accept: IMAGE_ACCEPT,
    panel: defineAsyncComponent(() => import('@/views/data/ImagePanel.vue')),
    prepPanel: defineAsyncComponent(() => import('@/views/preprocess/ImagePrepPanel.vue')),
    prepContext: defineAsyncComponent(() => import('@/views/preprocess/ImagePrepContext.vue')),
    trainContext: defineAsyncComponent(() => import('@/views/train/ImageTrainContext.vue')),
    predictPanel: defineAsyncComponent(() => import('@/views/predict/ImagePredictPanel.vue')),
    stepText: {
      // "어떤 열이 있는지"는 이미지에 없는 말이다.
      data: { purpose: 'steps.data.image.purpose' },
      // 다듬을 것이 없다 - 결측치도 인코딩도 스케일링도 이미지에는 없고, 여기서 하는
      // 일은 테스트 데이터를 정하는 것뿐이다. 잠금 이유의 "불러오기"도 같다.
      preprocess: {
        purpose: 'steps.preprocess.image.purpose',
        locked: 'steps.preprocess.image.locked',
        emptyReason: 'steps.preprocess.image.emptyReason',
        emptyNext: 'steps.preprocess.image.emptyNext',
      },
      // "표에 새 줄을 하나 넣으면"도 마찬가지다.
      predict: { purpose: 'steps.predict.image.purpose' },
      // 잠금 이유가 "타깃과 특성을 정해 주세요"인데 이미지에는 둘 다 없다.
    },
    preparingKey: 'meta.image.preparing',
    engineStateKeys: {
      absent: 'meta.image.engineAbsent',
      downloading: 'meta.image.engineDownloading',
      downloaded: 'meta.image.engineDownloaded',
      // 받아 놓은 뒤 사진을 통과시키기 시작하는 순간이다. 곧 세는 문구로 바뀐다.
      ready: 'meta.image.engineReady',
    },
    engineDownloadingWithPercent: 'meta.image.engineDownloadingPercent',
    summaryRows: defineAsyncComponent(() => import('@/components/summary/ImageSummaryRows.vue')),
  },
]

/** 이 종류를 다룰 수 있는가. 없으면 화면이 "아직 못 다룬다"고 말한다. */
export function dataKindFor(dataType: string): DataKind | undefined {
  return DATA_KINDS.find((kind) => kind.dataType === dataType)
}

/**
 * 다룰 수 있는 종류들. **새 프로젝트 화면이 고르게 할 때 쓴다** — 업로드한 파일로
 * 추론하지 않는다 (open-decisions.md "데이터 종류는 프로젝트를 만들 때 고르고, 그 뒤로
 * 안 바뀐다").
 *
 * **어휘(`DATA_TYPES`)가 아니라 이 목록으로 묻는다.** 둘은 일부러 어긋날 수 있고
 * (architecture.md §9.2.3), 어휘로 물으면 판이 없는 종류를 고를 수 있게 되어 **학생이
 * 고른 뒤에 갈 화면이 없다.**
 *
 * **하나뿐이면 묻지 않는다.** 그 판정은 이 목록의 길이가 하고, 화면에 숫자를 적지 않는다.
 */
export const SUPPORTED_DATA_TYPES: readonly DataType[] = DATA_KINDS.map((kind) => kind.dataType)

/**
 * 목록의 처음. 안 물었을 때 만들어지는 종류이고, 물었을 때 처음 골라져 있는 칸이다.
 *
 * **이름을 적어 두지 않는다.** `'tabular'`를 기본값으로 쓰면 표 판을 지우거나 순서를
 * 바꿨을 때 이 상수만 옛 답을 계속 준다. 등록부가 비면 만들 수 있는 프로젝트가 없다는
 * 뜻이므로 시끄럽게 죽는 것이 맞다.
 */
const [FIRST_KIND] = DATA_KINDS
if (FIRST_KIND === undefined) throw new Error('data kind registry is empty')
export const DEFAULT_DATA_TYPE: DataType = FIRST_KIND.dataType
