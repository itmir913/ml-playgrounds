/**
 * **잠금은 등록부 하나가 허락한다** (`open-decisions.md` 65, `architecture.md` §10.7).
 *
 * 버튼·체크박스·입력 칸을 잠그는 것은 이 파일 하나를 거친다. 셋이 맞물려 있다.
 *
 * 1. **잠금 낱말은 기본 부품에만 있다** (`LOCK_WORDS`·`LOCK_PRIMITIVES`). 그 밖의 `src/` 파일에
 *    낱말이 보이기만 하면 `tests/ui-rules.spec.ts`의 *"잠금 낱말은 기본 부품에만 있다"*가 운다 —
 *    표기(바인딩·정적·객체·수식어·스크립트 대입·대소문자)를 가리지 않는다. **모르는 표기가 곧
 *    실패다.** 찾아내는 그물이 아니라 기본 거부다 — 먼저 만든 그물은 표기 하나를 놓치면 조용히
 *    통과했다(`backup/lock-census-2026-09-27`).
 * 2. **기본 부품이 받는 잠금 값(`Lock`)은 이 파일만 만든다.** 만드는 길은 `lockFor`·`useGate`
 *    (등록된 판정 함수를 **이 파일이 스스로 불러** 이유를 얻는다)와 진행 중(`issueBusyLock`,
 *    `useWork` 하나만 부른다)뿐이다. 잠금 값은 이 파일 안의 표(`ISSUED`)에 적힌 객체라서
 *    **`as`로 모양을 흉내 낸 값은 부품이 받는 순간 던진다**(`lockReasons`). 타입의 표지는 편의이고
 *    막는 것은 실행 중의 표다.
 * 3. **동작의 거절도 같은 칸을 부른다**(`refusalFor`·`useGate().refuse`) — 잠금과 거절이 같은
 *    함수의 같은 결과라 갈릴 수 없다(결정문 60 *"두 벌로 적는 순간 반드시 어긋난다"*).
 *
 * 그리고 **앱이 설정을 스스로 쓰는 것**은 `stores/project.ts`가 막는다 — 감시자(`watch`·
 * `watchEffect`)의 콜백 안에서 프로젝트를 쓰면 던지고, 예외는 `WATCH_WRITES`에 적힌 자리뿐이다.
 *
 * **이 파일이 안 보는 것** (`docs/rule-coverage.md`의 그 줄).
 * - 판정 함수가 **옳은가**는 각 함수의 스펙이 본다. 등록부가 막는 것은 몰래 들어오는 잠금이다.
 * - **재료는 믿는다.** 화면이 넘기는 재료를 지어내면(`page: cond ? 0 : 1`) 그 조건이 잠금이
 *   된다 — 식을 읽는 그물을 버린 대가다. 대신 잠긴 부품에는 언제나 **등록된 이유 코드**가 선다.
 * - 조건 하나로 **잠금을 빼는 것**(`:lock="ready ? lock : undefined"`)은 막지 않는다 — 덜 잠그는
 *   쪽은 결정문 60의 방향이다. 잠금을 **만드는** 길만 막는다.
 * - 잠긴 **모양만** 흉내 내는 것(흐린 글자에 핸들러 없는 `<span>`)은 잠금 낱말이 없어 못 본다.
 * - 이름을 실행 중에 조립하는 것(`'dis' + 'abled'`)은 글자 검사가 못 본다 — 검사가 띄운 화면에서는
 *   `tests/setup/lock-net.ts`가 실제 DOM의 잠금 속성을 부품 밖에서 잡는다.
 * - 감시자 안의 쓰기는 **`await` 앞까지만** 잡는다(`stores/project.ts`의 머리말, 재서 적었다).
 *
 * **`why`는 영어다.** `src/`의 `.ts` 따옴표 리터럴에는 한글을 안 쓴다
 * (`i18n-usage.spec.ts`의 *"src의 .ts 따옴표 리터럴에 한글이 없다"*).
 */

import { computed, toRaw, type ComputedRef } from 'vue'

import type { ChartToolGate, GateInput as ChartGateInput } from '@/data/chart-gates'
import { isValidCategoryName } from '@/data/image/canonical'
import { isBinCount } from '@/data/stats'
import { reproduceBlockers, type ReproduceSubject } from '@/ml/reproduce-gate'
import {
  chosenModelBlocks,
  featureLocked,
  modelAxes,
  stratifyBlock,
  stratifyBlockFor,
  stratifyLocked,
  trainGate,
  usesTarget,
  type ColumnChoice,
  type ModelAxesInput,
  type StratifyBlock,
  type StratifyInput,
  type StratifySplit,
} from '@/ml/selection'
import type { TaskType } from '@/project/schema'
import { stepBlockers, type ProjectFacts, type StepId } from '@/router/steps'
import type { DataType } from '@/project/schema'

/* ------------------------------------------------------------------ 낱말과 기본 부품 */

/**
 * **잠금 낱말.** 기본 부품과 이 파일 밖의 `src/`에서는 주석을 뺀 글자에 보이기만 해도 운다.
 * 대소문자를 가리지 않고, 낱말 사이의 `-`·`_`·공백도 가리지 않는다(`readOnly`·`read-only`).
 *
 * **예외를 무늬로 두지 않는다** (결정문 65). 같은 낱말이 잠금이 아닌 뜻으로 필요하면 이름을
 * 바꾸거나(`stratifyDisabled` → `stratifyLock`) 기본 부품으로 옮긴다(`<Teleport :disabled>` →
 * `AppTeleport`). TypeScript의 `readonly` 수식어와 `Readonly<T>` 계열 타입은 **글자가 아니라
 * 문법 트리로** 걷어낸 뒤에 센다 — 타입은 화면을 잠글 수 없다(`tests/ui-rules.spec.ts`의 `lockText`).
 */
export const LOCK_WORDS: readonly { readonly word: string; readonly why: string }[] = [
  {
    word: 'disabl',
    why: 'disabled, aria-disabled, ariaDisabled, el.disabled = and the Tailwind disabled: variant are the native lock and its look',
  },
  {
    word: 'read[\\s_-]*only',
    why: 'readonly, readOnly and aria-readonly keep the box but drop what the student types',
  },
  {
    word: 'inert(?!ia)',
    why: 'inert freezes a whole subtree. inertia, the k-means score, is its own word and does not match',
  },
  {
    word: 'pointer[\\s_-]*events',
    why: 'pointer-events: none swallows a click without a word, whether as a class, a style or a stylesheet',
  },
  {
    word: 'not-allowed',
    why: 'cursor: not-allowed (Tailwind cursor-not-allowed) is the look of a lock; a control that looks locked must be locked by a primitive. Only the hyphenated CSS token: the backend error code METHOD_NOT_ALLOWED is not a look',
  },
  {
    word: 'tab[\\s_-]*index',
    why: 'tabindex -1 takes a control out of the keyboard; no screen needs tabindex outside the primitives',
  },
  {
    word: '(?:set|toggle)[\\s_-]*attribute',
    why: 'an attribute set from script can carry any of the words above under a name built at run time',
  },
]

/**
 * 템플릿에서만 보는 표기. **속성 이름을 실행 중에 정하는 길**이라 위 낱말이 글자에 안 남는다.
 * `v-bind:[name]`과 그 줄임 `:[name]`이다.
 */
export const TEMPLATE_LOCK_WORDS: readonly { readonly word: string; readonly why: string }[] = [
  {
    word: '(?:v-bind)?:\\[',
    why: 'a dynamic attribute name hides which attribute is bound, so it could be a lock',
  },
]

/**
 * **기본 부품.** 잠금 낱말이 여기서만 나올 수 있고, 잠금은 `Lock`으로만 받는다. `src/` 아래
 * 경로이고 구분자는 `/`다. **새 부품은 이 목록을 고치는 길로만 들어오고 그 diff를 코드 소유자가
 * 본다** (결정문 65 ⑤).
 */
export const LOCK_PRIMITIVES: readonly { readonly file: string; readonly why: string }[] = [
  {
    file: 'components/AppButton.vue',
    why: 'The button. Locks by the lock it is given, and by itself while its action runs (a second press would run the work twice).',
  },
  {
    file: 'components/AppChoices.vue',
    why: 'Cards on an axis. A locked card stays pressable (aria-disabled) and pressing shows its reason under the axis.',
  },
  {
    file: 'components/AppPlainButton.vue',
    why: 'A bare button for places that are not AppButton (tool grids, page arrows, move arrows, rail cells). In announce mode it stays pressable and reports the press instead.',
  },
  {
    file: 'components/AppInput.vue',
    why: 'A bare input (checkbox, radio, number, text). Locks as disabled, or as readonly when the value must stay readable (architecture.md 8.9.1.1).',
  },
  {
    file: 'components/AppSelect.vue',
    why: 'A bare select. Its placeholder option is disabled so the prompt cannot be picked back; that lock belongs to the primitive, not to a screen.',
  },
  {
    file: 'components/AppLockZone.vue',
    why: 'A region made inert while its lock holds: the model axes while training runs, so the list and the task type cannot move under it.',
  },
  {
    file: 'components/AppTeleport.vue',
    why: 'Teleport has its own disabled, which means render in place. It is not a lock, but the word is, so it lives here.',
  },
  {
    file: 'components/AppToast.vue',
    why: 'The toast stack spans the screen width; pointer-events lets clicks pass through its empty part. It locks nothing.',
  },
]

/**
 * **이 파일의 이름 중 부르는 자리가 정해진 것.** 다른 파일에 이 이름이 보이면 운다.
 * `issueBusyLock`은 조건을 받으면 무엇이든 "진행 중"으로 만들 수 있어서, 작업 상태를 세는
 * `useWork` 하나에만 준다.
 */
export const RESTRICTED_NAMES: Readonly<Record<string, readonly string[]>> = {
  issueBusyLock: ['composables/useWork.ts'],
}

/**
 * **감시자 안에서 앱이 스스로 해도 되는 자리** (결정문 65 ④). 이름 → 왜.
 *
 * 두 문이 이 이름을 받는다 — `stores/project.ts`의 `save`·`update`(프로젝트 쓰기)와 `useWork`의
 * `start`(잠그는 일을 시작하기, 결정문 65 ③). 이름 없이 감시자 안에서 부르면 둘 다 던진다.
 */
export const WATCH_WRITES = {
  batchPage:
    'The batch prediction table recomputes its page when the file, the filter or the page size changes (BatchPredict signature watcher). It starts the page job, which locks the page arrows and the bar buttons while it runs; it writes nothing to the project.',
  predictPage:
    'Turning the photo page continues a prediction the student already started (ImagePredictPanel page watcher). It starts the prediction job, which locks the photo buttons while it runs; the embeddings it stores come after an await.',
} as const satisfies Readonly<Record<string, string>>

export type WatchWriteId = keyof typeof WATCH_WRITES

/* ------------------------------------------------------------------ 잠금 값 */

/**
 * 타입의 표지. **내보내지 않는 기호**라 밖에서는 이 속성을 적을 수 없다 — 다만 `as`는 무엇이든
 * 통과시키므로 **막는 것은 아래 `ISSUED`다.**
 */
declare const LOCK_BRAND: unique symbol

/** 잠금 값. `Reason`은 그 칸의 이유 코드다. **이 파일만 만든다.** */
export interface Lock<Reason extends string = string> {
  readonly [LOCK_BRAND]: Reason
}

/**
 * 이 파일이 만든 잠금과 그 이유. **모듈 밖에서 닿을 수 없다** — 흉내 낸 객체는 여기 없으므로
 * 부품이 읽는 순간(`lockReasons`) 던진다.
 */
const ISSUED = new WeakMap<object, readonly string[]>()

/**
 * 잠금을 하나 낸다. **얼린 빈 객체다** — 얼린 객체는 Vue가 프록시로 감싸지 않아(`reactive`가
 * 확장 불가 객체를 그대로 돌려준다) 부품에 건너가도 같은 객체다.
 */
function issue<Reason extends string>(reasons: readonly Reason[]): Lock<Reason> {
  const token: object = Object.freeze(Object.create(null) as object)
  ISSUED.set(token, Object.freeze([...reasons]))
  return token as Lock<Reason>
}

/**
 * 잠금의 이유. **비어 있으면 잠기지 않은 것이다.** 없는 잠금(`undefined`)도 잠기지 않은 것이다.
 *
 * **이 파일이 내지 않은 값이면 던진다** — `{} as Lock`, `x as never` 같은 흉내가 여기서 선다.
 * 부품은 잠금을 그릴 때 언제나 이 함수를 거친다.
 */
export function lockReasons<Reason extends string>(
  lock: Lock<Reason> | undefined,
): readonly Reason[] {
  if (lock === undefined) return []
  const found = ISSUED.get(toRaw(lock as object))
  if (found === undefined) throw new Error('LOCK_NOT_ISSUED: a lock must come from locks.ts')
  return found as readonly Reason[]
}

/** 잠겼는가. 이유가 하나라도 있으면 잠긴 것이다. */
export function isLocked(lock: Lock | undefined): boolean {
  return lockReasons(lock).length > 0
}

/**
 * 잠금 여럿을 하나로. **이유를 이어 붙인다** — 하나라도 잠겼으면 잠긴다. 넘어온 것마다 이
 * 파일이 낸 것인지 본다.
 */
export function anyLock<Reason extends string>(
  ...locks: readonly (Lock<Reason> | undefined)[]
): Lock<Reason> {
  return issue(locks.flatMap((one) => [...lockReasons(one)]))
}

/**
 * **진행 중의 잠금.** 두 번 누름과 겹치는 쓰기를 막는다 — 파일의 조건이 아니라 화면이 지금
 * 하는 일이라 실패 조건과 갈릴 일이 없다(결정문 65 ③).
 *
 * **`useWork` 하나만 부른다** (`RESTRICTED_NAMES`). 조건을 받으면 무엇이든 "진행 중"으로 만들 수
 * 있기 때문이다 — 그 쪽의 `start()`는 감시자 안에서 던지므로 조건을 작업으로 바꿔 넣는 길도 막힌다.
 */
export function issueBusyLock(busy: boolean): Lock<'BUSY'> {
  return issue(busy ? (['BUSY'] as const) : [])
}

/* ------------------------------------------------------------------ 등록부 */

/** 대화상자의 이름 칸. 만들기와 이름 바꾸기가 같은 창이다. */
export interface CategoryNameInput {
  readonly from: string
  readonly value: string
  readonly categories: readonly string[]
}

/** 사진 예측의 재료. **세는 것만 넘긴다.** */
export interface ImagePredictInput {
  readonly photos: number
  readonly models: number
  readonly visible: number
  readonly usable: number
}

/** 단계 레일의 칸 하나. 프로젝트가 없으면 그것이 이유다. */
export interface StepInput {
  readonly step: StepId
  readonly projectOpen: boolean
  readonly facts: ProjectFacts
  readonly taskType: TaskType | undefined
  readonly dataType: DataType | undefined
}

/**
 * **등록부.** 칸 이름 → 판정 함수(재료 → 이유 코드 목록). 비어 있으면 잠기지 않는다.
 *
 * 판정은 원래 있던 자리의 함수를 그대로 부른다 — `trainGate`·`modelAxes`·`chosenModelBlocks`·
 * `reproduceBlockers`·`stratifyBlock(For)`·`featureLocked`·`usesTarget`·차트 도구의 `blockedBy`·
 * `stepBlockers`·`isBinCount`·`isValidCategoryName`. **여기서 조건을 새로 적지 않는다** — 새로 적는
 * 순간 그 조건이 두 벌이 된다. 잠금을 더하려면 여기 줄을 더하고, **코드 소유자에게 먼저 묻는다**
 * (결정문 60).
 */
const GATES = {
  /** [학습하기] (결정문 60의 둘). 거절도 같은 칸이다. */
  train: (input: Parameters<typeof trainGate>[0]) => trainGate(input),
  /** [담기]. 담을 수 없는 조합과 이미 담은 쌍. 거절도 같은 칸이다. */
  addModel: (input: ModelAxesInput) => {
    const blocked = modelAxes(input).blocked
    return blocked === null ? [] : [blocked]
  },
  /**
   * 모델·실행 방법 카드 하나. **축 전체를 다시 판정해 그 카드를 찾는다** — 카드마다 따로 적으면
   * 축이 서로를 좁히는 규칙이 두 벌이 된다. 사유가 없는 꺼진 칸은 잠그지 않는다(결정문 60 —
   * 이유 없이 잠그지 않는다. `runtime-options.spec.ts`가 사유가 늘 있음을 문다).
   */
  modelCard: (input: {
    readonly axes: ModelAxesInput
    readonly axis: 'algorithms' | 'runtimes'
    readonly id: string
  }) => {
    const card = modelAxes(input.axes)[input.axis].find((one) => one.id === input.id)
    return card === undefined || card.enabled || card.reason === undefined ? [] : [card.reason]
  },
  /** 담긴 줄 하나 (결정문 55의 첫 줄). 학습은 그 줄을 건너뛴다. */
  chosenModel: (input: {
    readonly row: { readonly algorithm: string }
    readonly taskType: TaskType | undefined
  }) => chosenModelBlocks(input.row, input.taskType),
  /** [대조 시작]. 다른 실험이 도는 동안(자원이 바쁨)과 파일의 사정. 거절도 같은 칸이다. */
  reproduce: (input: ReproduceSubject) => reproduceBlockers(input),
  /** 표의 층화 (결정문 55의 셋째 줄). 학습이 같은 판정으로 층화를 무시한다. */
  stratifyTabular: (input: StratifyInput) => stratifyReasons(stratifyBlock(input)),
  /** 사진의 층화. 판정 함수가 같고 재료만 다르다. */
  stratifyImage: (input: {
    readonly taskType: TaskType | undefined
    readonly labels: readonly string[]
    readonly nSamples: number | undefined
    readonly split: StratifySplit
  }) =>
    stratifyReasons(stratifyBlockFor(input.taskType, input.labels, input.nSamples, input.split)),
  /** 특성 칸. **타깃 역할뿐이다** (결정문 55의 둘째 줄, 결정문 65 ④ — 결측으로는 잠그지 않는다). */
  featureRole: (input: { readonly column: ColumnChoice }) =>
    featureLocked(input.column) ? (['TARGET_ROLE'] as const) : [],
  /**
   * [일부 추출]. **타깃을 쓰는 유형에서 타깃을 고르기 전뿐이다** — 군집은 타깃을 안 써서 영영 안
   * 풀리는 덫이었다(결정문 65). 유형을 고르기 전에는 타깃을 쓰는 쪽으로 본다(`usesTarget`).
   */
  sampling: (input: {
    readonly taskType: TaskType | undefined
    readonly target: string | undefined
  }) =>
    usesTarget(input.taskType) && input.target === undefined
      ? (['TARGET_NOT_SELECTED'] as const)
      : [],
  /**
   * 차트 도구 하나. 누르면 이유가 선다(`AppPlainButton`의 `announce`). 판정은 도구가 등록부에
   * 들고 있는 `blockedBy`다(`data/charts.ts`). **도구 목록을 여기서 들이지 않는다** — 그 파일은 그림
   * 부품을 지연 로딩으로 가리키고, 이 파일은 첫 화면의 부품이 들이므로 그 길을 타면 모든 검사가
   * 그림 부품까지 닿는다(`ui-rules.spec.ts`의 *"DOM이 필요한 검사는 스스로 밝힌다"*).
   */
  chartTool: (input: { readonly tool: ChartToolGate; readonly gate: ChartGateInput }) =>
    input.tool.blockedBy(input.gate),
  /** 히스토그램 구간 수의 [적용]. 받을 수 없는 수면 반올림하지 않고 멈춘다(§8.9.1.1). */
  histogramBins: (input: { readonly draft: unknown; readonly max: number }) =>
    isBinCount(input.draft, input.max) ? [] : (['BIN_INVALID'] as const),
  /** 히스토그램 구간 칸. [자동]인 동안 읽기 전용이다(§8.9.1.1 — 값은 읽혀야 한다). */
  histogramAuto: (input: { readonly auto: boolean }) =>
    input.auto ? (['AUTO_BINS'] as const) : [],
  /** 새 프로젝트의 [만들기]. 거절도 같은 칸이다(Enter로 잠금을 건너는 길). */
  projectName: (input: { readonly name: string }) =>
    input.name.trim() === '' ? (['NAME_MISSING'] as const) : [],
  /** 범주 이름 창의 [확정]. 거절도 같은 칸이다(Enter로 잠금을 건너는 길). */
  categoryName: (input: CategoryNameInput) => categoryNameReasons(input),
  /** 사진 [예측하기]. 거절도 같은 칸이고 **백본을 받기 전에** 선다. */
  imagePredict: (input: ImagePredictInput) => imagePredictReasons(input),
  /** 단계 레일의 대시보드 칸. 열린 프로젝트가 없으면 갈 곳이 없다. */
  projectHome: (input: { readonly projectOpen: boolean }) =>
    input.projectOpen ? [] : (['NO_PROJECT'] as const),
  /** 단계 레일의 칸. 라우터 가드가 같은 `stepBlockers`로 연다. */
  step: (input: StepInput) =>
    input.projectOpen
      ? stepBlockers(input.step, input.facts, input.taskType, input.dataType)
      : (['NO_PROJECT'] as const),
  /** 쪽 넘기기의 처음 (끝에 닿음). */
  pageFirst: (input: { readonly page: number }) =>
    input.page <= 0 ? (['FIRST_PAGE'] as const) : [],
  /** 쪽 넘기기의 끝 (끝에 닿음). */
  pageLast: (input: { readonly page: number; readonly pages: number }) =>
    input.page >= input.pages - 1 ? (['LAST_PAGE'] as const) : [],
  /** 순서 옮기기의 맨 위 (끝에 닿음). */
  sectionTop: (input: { readonly index: number }) => (input.index <= 0 ? (['TOP'] as const) : []),
  /** 순서 옮기기의 맨 아래 (끝에 닿음). */
  sectionBottom: (input: { readonly index: number; readonly count: number }) =>
    input.index >= input.count - 1 ? (['BOTTOM'] as const) : [],
} as const satisfies Readonly<Record<string, (input: never) => readonly string[]>>

/** 층화 판정을 이유 목록으로. **뽑기만 층화하는 경우는 잠그지 않는다** (`stratifyLocked`). */
function stratifyReasons(block: StratifyBlock | null): readonly StratifyBlock['code'][] {
  return block !== null && stratifyLocked(block) ? [block.code] : []
}

/** 이름 창의 이유. 빈 이름 → 쓸 수 없는 이름 → 이미 있는 이름 순이다. */
function categoryNameReasons(
  input: CategoryNameInput,
): readonly ('nameRequired' | 'nameInvalid' | 'nameTaken')[] {
  const trimmed = input.value.trim()
  if (trimmed === '') return ['nameRequired']
  if (!isValidCategoryName(trimmed)) return ['nameInvalid']
  return trimmed !== input.from && input.categories.includes(trimmed) ? ['nameTaken'] : []
}

/**
 * 사진 예측의 이유. **모델이 아예 없는 것과 필터가 전부 걸러 낸 것은 다른 사유다** — 할 일이
 * 다르다(필터를 켜라 / 학습하라).
 */
function imagePredictReasons(
  input: ImagePredictInput,
): readonly ('noPhoto' | 'noModel' | 'noVisibleModel' | 'noUsableModel')[] {
  if (input.photos === 0) return ['noPhoto']
  if (input.models === 0) return ['noModel']
  if (input.visible === 0) return ['noVisibleModel']
  return input.usable === 0 ? ['noUsableModel'] : []
}

export type LockId = keyof typeof GATES

/** 그 칸의 판정 함수가 받는 재료. */
export type GateInput<Id extends LockId> = Parameters<(typeof GATES)[Id]>[0]

/** 그 칸의 판정 함수가 돌려줄 수 있는 이유 코드. */
export type LockReason<Id extends LockId> = ReturnType<(typeof GATES)[Id]>[number]

/** 등록된 칸 이름들. 검사가 칸마다 판정을 태워 본다. */
export const LOCK_IDS = Object.keys(GATES) as readonly LockId[]

/**
 * **거절.** 그 칸의 판정 함수를 부르고 이유를 돌려준다. 비어 있으면 해도 된다.
 * 동작(`startTraining`·`reproduce`·`create`…)이 잠금을 건너 불렸을 때 이것으로 선다.
 */
export function refusalFor<Id extends LockId>(
  id: Id,
  input: GateInput<Id>,
): readonly LockReason<Id>[] {
  const gate = GATES[id] as unknown as (input: GateInput<Id>) => readonly LockReason<Id>[]
  return gate(input)
}

/** **잠금.** 그 칸의 판정 함수를 이 파일이 불러 잠금 값을 낸다. */
export function lockFor<Id extends LockId>(id: Id, input: GateInput<Id>): Lock<LockReason<Id>> {
  return issue(refusalFor(id, input))
}

/** 한 손잡이의 잠금과 거절. **같은 재료 함수 하나로 둘을 만든다** — 재료가 갈릴 자리가 없다. */
export interface Gate<Id extends LockId> {
  /** 부품에 넘길 잠금. */
  readonly lock: ComputedRef<Lock<LockReason<Id>>>
  /** 지금의 이유. 화면이 문장으로 옮긴다. */
  readonly reasons: ComputedRef<readonly LockReason<Id>[]>
  /** 동작이 부르는 거절. **그 순간의 재료로** 다시 판정한다. */
  readonly refuse: () => readonly LockReason<Id>[]
}

export function useGate<Id extends LockId>(id: Id, input: () => GateInput<Id>): Gate<Id> {
  const reasons = computed(() => refusalFor(id, input()))
  const lock = computed(() => issue(reasons.value))
  return { lock, reasons, refuse: () => refusalFor(id, input()) }
}
