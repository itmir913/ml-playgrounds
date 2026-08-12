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
import type { StepId } from '@/router/steps'

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
   * **평가 데이터를 어디서 받나도 판의 몫이다** (§9.1.1) — 표는 파일 하나이고 이미지는
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
   * **키는 `steps.*` 아래가 아니라 그 화면의 이름 아래다** (`data.image.purpose`).
   * `steps.*`에는 단계 id만 온다는 것을 `tests/locales.spec.ts`가 지키고 있고, 그
   * 규칙이 맞다 — 여기 있는 것은 단계의 문구가 아니라 **그 화면이 이 종류에서 하는
   * 말**이다.
   */
  readonly stepText: Partial<Record<StepId, { purpose?: string; locked?: string }>>
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
export function stepTextKey(
  kind: DataKind | undefined,
  step: StepId,
  slot: 'purpose' | 'locked',
): string {
  return kind?.stepText[step]?.[slot] ?? `steps.${step}.${slot}`
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
      data: { purpose: 'data.tabular.purpose' },
      predict: { purpose: 'predict.tabular.purpose' },
      train: { locked: 'train.tabular.locked' },
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
      data: { purpose: 'data.image.purpose' },
      // "표에 새 줄을 하나 넣으면"도 마찬가지다.
      predict: { purpose: 'predict.image.purpose' },
      // 잠금 이유가 "타깃과 특성을 정해 주세요"인데 이미지에는 둘 다 없다.
      train: { locked: 'train.image.locked' },
    },
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
