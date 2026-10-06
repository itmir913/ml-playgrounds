<script setup lang="ts">
/**
 * 그리기 창 (open-decisions.md 67, 판례 67의 10 — 안 A3). [사진 추가] 메뉴의 [그리기]가 연다.
 *
 * **출구는 `done` 하나다** — [추가]면 그린 장들의 `File[]`, 닫으면 `null`이다. 입력 방식의 출구가
 * `File[]`이라서(`data/image/sources.ts`) 그린 장을 이 창 안에 모았다가 [추가]로 한꺼번에 넘긴다.
 * 받은 파일은 파일로 고른 사진과 **같은 길**(`readPicked`)로 들어간다 — 여기서는 크기를 맞추지도,
 * 굽지도 않는다.
 *
 * **그림판 상태는 `sketch.ts`의 불변 값이다.** 이 창은 그 값을 갈아끼우고 캔버스에 다시 그릴 뿐이다.
 * 열고 닫는 것은 부모의 `open`이 쥔다(`AppDialog`와 같다). 띄우는 것은 데이터·예측 판의 손
 * (`composables/useImageSources.ts`)이고, 판은 이 창이 떠 있는 동안 붙여넣기를 받지 않는다.
 */

import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  type ComponentPublicInstance,
} from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppChoices from '@/components/AppChoices.vue'
import AppDialog from '@/components/AppDialog.vue'
import AppPlainButton from '@/components/AppPlainButton.vue'
import {
  addStroke,
  clear,
  drawSketch,
  EMPTY_SKETCH,
  isBlank,
  setWidth,
  type Point,
  type Sketch,
  STROKE_WIDTH_IDS,
  type StrokeWidthId,
  sketchToFile,
  toCanvasPoint,
  undo,
} from '@/data/image/sketch'
import { toMessage } from '@/errors'
import { ACTION_ICONS } from '@/icons'
import { SKETCH_CANVAS_SIZE, SKETCH_STROKE_WIDTHS } from '@/limits'
import { useGate, type LockReason } from '@/locks'

import { contextOf, createSketchCanvas, onNextFrame, snapshotOf } from './sketch-canvas'

/**
 * 뿌리가 둘이다 — 그리기 창과 버릴지 묻는 창. 둘 다 `<dialog>`라 화면의 흐름에 자리를 안 잡는다.
 * 넘겨받을 속성이 없으므로 어느 뿌리에도 흘리지 않는다.
 */
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  open: boolean
  /**
   * 그림 파일 이름 발급기 (`createSketchNamer`). **화면(판)이 쥐고 넘긴다** — 창이 쥐면 다시 열
   * 때마다 `drawn-1.png`가 또 나와 확인 판에서 다른 범주의 두 장이 한 칸으로 합쳐진다(`sketch.ts`).
   */
  nameSketch: () => string
}>()

const emit = defineEmits<{ done: [files: File[] | null] }>()

const { t } = useI18n()

/** 모은 장 하나. 미리보기는 모을 때 화면 캔버스를 담아 둔 것이다. */
interface Sheet {
  readonly key: number
  readonly sketch: Sketch
  readonly thumbnail: string
}

/** 지금 그리는 장. */
const sketch = shallowRef<Sketch>(EMPTY_SKETCH)
/** [다음 장 추가]로 모은 장들. 차례가 곧 파일 이름의 차례다. */
const sheets = shallowRef<readonly Sheet[]>([])
let sheetKey = 0
/** 오른쪽 "지금" 칸의 미리보기. 지금 장이 비었으면 없다. 획이 끝날 때마다 새로 담는다. */
const liveThumbnail = ref<string | null>(null)
/** 버릴지 묻는 중인가. 확인 창은 그리기 창 **위에 쌓인다** — 그리기 창은 내려가지 않는다. */
const confirming = ref(false)
/** [추가]가 파일을 만드는 중인가. 그동안의 닫기 요청은 받지 않는다(아래 `requestClose`). */
const adding = ref(false)
/** [추가]가 파일을 못 만든 이유. **창 안에서 말한다** — 알림은 모달의 뒤에 덮인다(`LeaveGuard.vue`와 같다). */
const failure = ref<{ key: string; params: Record<string, unknown> } | null>(null)

/* ------------------------------------------------------------------ 긋는 동안 */

/**
 * **긋는 중인 획의 점은 불변 상태 밖의 가변 배열에 쌓는다.** `addPoint`는 점마다 획의 배열을 새로
 * 복사하므로 긴 획(포인터는 초당 수십~수백 점을 보낸다)에서 복사가 점 수의 제곱으로 는다. 그래서
 * 긋는 동안은 여기 `push`만 하고, 다시 그리기는 화면 갱신 한 번에 하나로 묶고(`schedulePaint`), 획이
 * 끝날 때 `addStroke`로 한 번에 넣는다. 반응형이 아닌 것도 같은 이유다 — 점마다 화면을 다시 계산하지
 * 않는다. 긋는 중인지는 `stroking`이 화면에 알린다.
 */
let live: Point[] | null = null
/** 지금 획을 긋고 있는 포인터. 두 번째 손가락은 무시한다. */
let livePointer: number | null = null
const stroking = ref(false)

const canvas = ref<HTMLCanvasElement | null>(null)
const tiles = ref<HTMLElement | null>(null)
let cancelPaint: (() => void) | null = null

/** 획 목록을 화면 캔버스에 지금 다시 그린다. 미뤄 둔 다시 그리기는 거둔다. */
function paintNow(): void {
  cancelPaint?.()
  cancelPaint = null
  const element = canvas.value
  const context = element === null ? null : contextOf(element)
  if (context === null) return
  const now = sketch.value
  drawSketch(
    context,
    live === null ? now.strokes : [...now.strokes, { points: live, width: now.width }],
  )
}

/** 다음 화면 갱신에 한 번만 다시 그린다. 그사이 온 점은 그때 함께 그려진다. */
function schedulePaint(): void {
  if (cancelPaint !== null) return
  cancelPaint = onNextFrame(() => {
    cancelPaint = null
    paintNow()
  })
}

onBeforeUnmount(() => cancelPaint?.())

/**
 * 보이는 좌표 → 캔버스 픽셀 좌표 (`toCanvasPoint`). 캔버스가 안 보이면(크기 0) 점이 아니다.
 * 잰 것은 **캔버스**다 — 포인터를 받는 것은 그 바깥 상자라도(아래 템플릿) 좌표는 캔버스 기준이다.
 */
function pointOf(event: PointerEvent): Point | null {
  const rect = canvas.value?.getBoundingClientRect()
  if (rect === undefined || rect.width <= 0 || rect.height <= 0) return null
  return toCanvasPoint(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height)
}

function onPointerDown(event: PointerEvent): void {
  // 주 단추만 긋는다(오른쪽 단추는 아니다). 이미 긋는 중이면 다른 손가락이다.
  if (event.button !== 0 || live !== null) return
  freshInput()
  const point = pointOf(event)
  if (point === null) return
  /**
   * **포인터를 붙잡는다** — 캔버스 밖으로 나가도 점이 오고, 손을 뗄 때 `pointerup`이 이 상자로 온다.
   * 안 붙잡으면 밖에서 뗀 획이 끝나지 않는다. `<dialog>` 위에서 아이폰 사파리가 이것을 듣는지는
   * 사람 확인이다(계획 6절).
   *
   * **붙잡기는 덤이다 — 못 해도 긋는다.** 포인터가 이미 사라졌으면 브라우저가 던진다
   * (`NotFoundError`). 그때 던짐이 새면 획이 안 열린다. 무는 검사: `sketch-dialog.spec.ts`의
   * "포인터 캡처가 안 돼도 / 획은 그어진다".
   */
  try {
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  } catch {
    // 붙잡지 못한 획은 캔버스 안에서 뗄 때 끝난다.
  }
  live = [point]
  livePointer = event.pointerId
  stroking.value = true
  refused.value = null
  schedulePaint()
}

function onPointerMove(event: PointerEvent): void {
  if (live === null || event.pointerId !== livePointer) return
  const point = pointOf(event)
  if (point === null) return
  live.push(point)
  schedulePaint()
}

/** 손을 뗐거나 브라우저가 포인터를 거뒀다. 어느 쪽이든 그은 데까지가 획이다. */
function onPointerEnd(event: PointerEvent): void {
  if (live === null || event.pointerId !== livePointer) return
  closeLiveStroke()
  paintNow()
  refreshLive()
}

/**
 * 열린 획을 그은 데까지로 닫아 그림판에 넣는다. **단추 넷([다음 장 추가]·[추가]·[되돌리기]·[초기화])이
 * 첫머리에서 부른다** — 한 손가락이 캔버스에 있는 동안 다른 손가락으로 단추를 누를 수 있고, 열린 획은
 * 그림판 밖의 배열이라 그대로 두면 [다음 장 추가]가 빈 그림으로 거절하거나 [추가]가 그 획을 빼고 낸다.
 * 닫은 뒤 그 포인터의 `pointerup`은 받을 획이 없어 아무것도 안 한다. 무는 검사: `sketch-dialog.spec.ts`의
 * "긋는 중에 누른 단추".
 */
function closeLiveStroke(): void {
  if (live === null) return
  const points = live
  live = null
  livePointer = null
  stroking.value = false
  sketch.value = addStroke(sketch.value, points)
}

/** "지금" 칸의 미리보기를 새로 담는다. 화면 캔버스가 이미 지금 장을 그리고 있어야 한다. */
function refreshLive(): void {
  const element = canvas.value
  liveThumbnail.value = element === null || isBlank(sketch.value) ? null : snapshotOf(element)
}

/* ------------------------------------------------------------------ 도구 */

/** 굵기 단계 → 이름 키. **키를 조립하지 않는다.** */
const WIDTH_KEYS = {
  thin: 'data.image.sketch.widthThin',
  medium: 'data.image.sketch.widthMedium',
  thick: 'data.image.sketch.widthThick',
} as const satisfies Record<StrokeWidthId, string>

const widthItems = computed(() => STROKE_WIDTH_IDS.map((id) => ({ id, label: t(WIDTH_KEYS[id]) })))

/**
 * 가장 굵은 단계. 붓 점은 이 단계의 점 크기를 모든 칸이 자리로 잡는다. 단계는 셋뿐이지만 인자로
 * 펼치지 않고 접는다 — 그 표기는 저장소 전체에서 막는다(`spread-rules.spec.ts`).
 */
const THICKEST = STROKE_WIDTH_IDS.reduce(
  (widest, id) => Math.max(widest, SKETCH_STROKE_WIDTHS[id]),
  0,
)

/** 붓 점의 크기. 자리(가장 굵은 점) 안의 비율이라 단계 사이의 차이가 실제 굵기와 같다. */
function dotSize(id: string): string {
  const width = STROKE_WIDTH_IDS.find((one) => one === id)
  return width === undefined ? '0%' : `${(SKETCH_STROKE_WIDTHS[width] / THICKEST) * 100}%`
}

function pickWidth(id: string): void {
  freshInput()
  const width = STROKE_WIDTH_IDS.find((one) => one === id)
  if (width !== undefined) sketch.value = setWidth(sketch.value, width)
}

function undoStroke(): void {
  freshInput()
  closeLiveStroke()
  sketch.value = undo(sketch.value)
  refused.value = null
  paintNow()
  refreshLive()
}

function clearSketch(): void {
  freshInput()
  closeLiveStroke()
  sketch.value = clear(sketch.value)
  refused.value = null
  paintNow()
  refreshLive()
}

/* ------------------------------------------------------------------ 거절 */

/**
 * 빈 그림의 [다음 장 추가]·[추가]. **잠그지 않고 거절한다** — 등록된 칸(`@/locks`의 `sketchEmpty`)이
 * 판정한다(§10.7). [다음 장 추가]는 지금 장만, [추가]는 모은 장과 지금 장을 함께 넘긴다.
 */
const { refuse: refuseNext } = useGate('sketchEmpty', () => ({ sketches: [sketch.value] }))
const { refuse: refuseAdd } = useGate('sketchEmpty', () => ({
  sketches: [...sheets.value.map((sheet) => sheet.sketch), sketch.value],
}))

/** 거절 이유 → 문장 키. */
const REFUSAL_KEYS = {
  SKETCH_EMPTY: 'data.image.sketch.refuseEmpty',
} as const satisfies Record<LockReason<'sketchEmpty'>, string>

/**
 * 지금 서 있는 거절. **새 줄을 세우지 않고 캔버스 안의 안내 문장이 이 문장으로 바뀐다** (판례 67의 10).
 * 획을 긋기 시작하거나 되돌리기·초기화를 누르면 걷힌다.
 */
const refused = ref<LockReason<'sketchEmpty'> | null>(null)

/** 캔버스 안의 문장. 지금 장이 비었고 긋는 중이 아닐 때만 선다. */
const canvasNote = computed(() => {
  if (!isBlank(sketch.value) || stroking.value) return null
  return refused.value === null ? 'data.image.sketch.hint' : REFUSAL_KEYS[refused.value]
})

/* ------------------------------------------------------------------ 모으기와 내보내기 */

/** [추가]가 넘길 장 수 — 모은 장과, 그렸으면 지금 장. */
const total = computed(() => sheets.value.length + (isBlank(sketch.value) ? 0 : 1))

/**
 * [다음 장 추가]. 지금 장을 오른쪽 칸에 넣고 캔버스를 비운다. **붓 굵기는 그대로다**(`clear`).
 *
 * 새 칸이 생기면 **그 칸 안에서만** 끝으로 굴린다. `scrollIntoView`를 쓰지 않는다 — 창 본문까지
 * 굴려 왼쪽 캔버스가 밀려난다(목업에서 밟았다, `docs/cases/open-decisions.md` 67).
 */
function nextSheet(): void {
  freshInput()
  closeLiveStroke()
  const code = refuseNext()[0]
  if (code !== undefined) {
    refused.value = code
    return
  }
  const element = canvas.value
  if (element === null) return
  paintNow()
  sheetKey += 1
  sheets.value = [
    ...sheets.value,
    { key: sheetKey, sketch: sketch.value, thumbnail: snapshotOf(element) },
  ]
  sketch.value = clear(sketch.value)
  refused.value = null
  paintNow()
  refreshLive()
  void nextTick(scrollTilesToEnd)
}

function scrollTilesToEnd(): void {
  const element = tiles.value
  if (element === null) return
  element.scrollTop = element.scrollHeight
  element.scrollLeft = element.scrollWidth
}

function removeSheet(key: number): void {
  freshInput()
  sheets.value = sheets.value.filter((sheet) => sheet.key !== key)
}

/**
 * [추가]. 모은 장과 지금 장을 차례대로 PNG 파일로 만들어 넘긴다. **이름은 판이 준 발급기에서
 * 차례대로 받는다** — 장마다 한 번. 장수 상한은 받는 쪽(`readPicked`의 `imageOverflow`)이 센다.
 */
async function addAll(): Promise<void> {
  freshInput()
  closeLiveStroke()
  const code = refuseAdd()[0]
  if (code !== undefined) {
    refused.value = code
    return
  }
  failure.value = null
  const sketches = [
    ...sheets.value.map((sheet) => sheet.sketch),
    ...(isBlank(sketch.value) ? [] : [sketch.value]),
  ]
  adding.value = true
  try {
    const files: File[] = []
    for (const one of sketches) {
      files.push(await sketchToFile(one.strokes, props.nameSketch(), createSketchCanvas))
    }
    emit('done', files)
  } catch (error) {
    failure.value = toMessage(error)
  } finally {
    adding.value = false
  }
}

/* ------------------------------------------------------------------ 닫기 */

/**
 * 추가하지 않은 그림이 있는가 — 닫으려 하면 붙잡을 것이 있는가. 모은 장뿐 아니라 지금 장도 센다(지금
 * 장도 [추가]하면 들어갈 그림이다). **[추가]가 도는 동안도 붙잡는다** — 그사이 `null`이 먼저 나가면
 * 뒤이은 `File[]`은 부모가 이미 닫은 뒤라 버려진다. [추가]가 이긴다(끝나면 스스로 닫힌다).
 */
function holdsWork(): boolean {
  closeLiveStroke()
  return adding.value || total.value > 0
}

/**
 * 닫기를 청했다([취소]). **추가하지 않은 그림이 있으면 버릴지 묻는다** (계획 2.4). [추가]가 도는
 * 동안에는 묻지도 닫지도 않는다(`holdsWork`). 무는 검사: `sketch-dialog.spec.ts`의 "[추가]가 도는 동안".
 */
function requestClose(): void {
  freshInput()
  if (adding.value) return
  if (!holdsWork()) {
    emit('done', null)
    return
  }
  confirming.value = true
}

/**
 * 학생의 `Esc` — `<dialog>`가 닫히기 전에 온다(`AppDialog`의 `cancel`). **붙잡을 그림이 있으면 닫힘을
 * 막고** 확인 창을 그 위에 쌓는다(코드 소유자: 확인 창은 그리기 창 위에 쌓인다). 없으면 막지 않고,
 * 닫힌 뒤 `onDialogClose`가 `null`을 낸다. 무는 검사: `sketch-dialog.spec.ts`의 "`Esc`는 그리기 창의
 * 닫힘을 막고 확인 창을 쌓는다".
 */
function onDialogCancel(event: Event): void {
  // 그리기 창이 `cancel`을 받았으면 학생이 이 창에 `Esc`를 누른 것이다 — 앞의 확인 창 닫기는 지났다.
  confirmDismissed = false
  if (!holdsWork()) return
  event.preventDefault()
  if (!adding.value) confirming.value = true
}

/**
 * 막지 못하고 닫힌 그리기 창을 다시 띄우는 동안 참이다. `AppDialog`는 `open`이 **바뀔 때만** 연다 —
 * 브라우저가 스스로 닫은 창은 `open`이 참인 채로 닫혀 있으므로, 한 번 거짓으로 내렸다가 다음 틱에
 * 되올린다.
 */
const bounced = ref(false)

/**
 * `<dialog>`가 닫혔다. **부모가 닫은 것이면 아무것도 안 한다** — 그것도 `close`를 올린다(`AppDialog`가
 * `open`을 따라 닫을 때). 그 밖의 닫힘은 브라우저가 한 것이다: 그린 것이 없으면 `Esc`였고(`null`),
 * 있으면 **막지 못한 닫힘**이다 — 크롬은 사용자 활성 없이 거듭 누른 `Esc`의 `cancel`을 막지 못하게
 * 하고 창을 닫는다(close watcher). 그때 그림을 잃지 않도록 창을 다시 띄우고, 그 위에 확인 창을
 * 쌓는다(되올리기와 같은 틱이라 그리기 창이 먼저 열려 아래에 선다). 무는 검사: `sketch-dialog.spec.ts`의
 * "막지 못하고 닫혀도 그린 것은 남고".
 */
function onDialogClose(): void {
  if (!props.open || bounced.value) return
  if (!holdsWork()) {
    emit('done', null)
    return
  }
  const ask = !adding.value && !confirmDismissed
  confirmDismissed = false
  // **확인 창이 떠 있는 동안 그리기 창을 그 위로 다시 띄우지 않는다** (코드 소유자: 확인 창은 언제나
  // 맨 위). 떠 있었다면 먼저 내렸다가, 그리기 창을 띄운 다음에 다시 쌓는다.
  confirming.value = false
  bounced.value = true
  void nextTick(() => {
    bounced.value = false
    if (ask) confirming.value = true
  })
}

/**
 * 확인 창이 닫자고 올렸다. **바깥 클릭과 `Esc`는 [취소]와 같다** — 확인 창만 닫히고 그리기로 돌아간다.
 *
 * **바깥 클릭은 `AppDialog`가 `'backdrop'`으로 알린다.** 그때 `<dialog>`는 아직 열려 있다 — 부품은 스스로
 * 닫지 않고 부모가 `open`을 내리기를 기다린다. 열린 창의 `close`만 보고 "늦게 온 것"으로 버리면 바깥
 * 클릭이 늘 삼켜진다(감사 2차). 바깥 클릭은 학생이 확인 창을 고른 것이 아니라 비켜선 것이라
 * `confirmDismissed`를 세우지 않는다. 무는 검사: `sketch-dialog.spec.ts`의 "확인 창의 바깥을 누르면".
 *
 * 그 밖의 `close`는 브라우저가 닫은 것이다(그 창의 `Esc`).
 *
 * **크롬은 `Esc`를 연타하면 두 창을 함께 닫는다.** 사용자 활성 없이 연 창의 close watcher는 앞 창과 한
 * 묶음이 되고, 묶음은 `Esc` 한 번에 위에서부터 다 닫힌다 — 확인 창의 `close`가 먼저, 그리기 창의
 * `close`가 뒤에 온다. 그 그리기 창은 위 `onDialogClose`가 다시 띄우는데, **확인 창을 또 쌓지 않는다**
 * (`confirmDismissed`) — 학생은 확인 창에 `Esc`를 누른 것이다. 묶음이 어떻게 갈리는지는 사람 확인이다.
 *
 * 우리가 내린 닫힘([취소]·되올리기)은 `confirming`을 먼저 거짓으로 두므로 여기서 아무것도 안 한다.
 * 늦게 온 `close`가 다시 띄운 창을 닫지 않게, 창이 열려 있으면 그 `close`는 지난 것이다.
 */
function onConfirmClose(reason?: 'backdrop'): void {
  if (reason === 'backdrop') {
    confirming.value = false
    return
  }
  const element = (confirmDialog.value?.$el ?? null) as HTMLDialogElement | null
  if (!confirming.value || element?.open === true) return
  confirming.value = false
  confirmDismissed = true
}

/**
 * 확인 창을 `Esc`로 닫은 직후인가 — 같은 `Esc`가 닫은 그리기 창을 되올릴 때 확인 창을 또 안 쌓는다.
 * **그리기 창에 새 입력이 들어오면 걷힌다**(`freshInput`) — 남아 있으면 한참 뒤 막지 못한 닫힘이 왔을
 * 때 확인 창을 안 쌓아 그린 것을 붙잡을 길이 없어진다. 무는 검사: `sketch-dialog.spec.ts`의 "확인 창을
 * `Esc`로 닫고 다시 그린 뒤 막지 못한 닫힘이 오면 확인 창이 다시 쌓인다".
 */
let confirmDismissed = false

/** 그리기 창에 학생의 새 입력이 왔다(캔버스·단추·굵기·[×]). 앞의 확인 창 닫기는 지났다. */
function freshInput(): void {
  confirmDismissed = false
}

const confirmDialog = ref<ComponentPublicInstance | null>(null)

function discard(): void {
  emit('done', null)
  confirming.value = false
}

/* ------------------------------------------------------------------ 열기 */

/** 열 때마다 새 판이다. 붓 굵기도 처음 값이다(`EMPTY_SKETCH`). */
function reset(): void {
  cancelPaint?.()
  cancelPaint = null
  live = null
  livePointer = null
  stroking.value = false
  sketch.value = EMPTY_SKETCH
  sheets.value = []
  liveThumbnail.value = null
  refused.value = null
  failure.value = null
  confirming.value = false
  bounced.value = false
  confirmDismissed = false
  void nextTick(paintNow)
}

watch(
  () => props.open,
  (open) => {
    if (open) reset()
  },
  { immediate: true },
)
</script>

<template>
  <AppDialog
    wide
    persistent
    focus-panel
    :open="props.open && !bounced"
    :title="t('data.image.sketch.title')"
    :description="t('data.image.sketch.description')"
    @cancel="onDialogCancel"
    @close="onDialogClose"
  >
    <!--
      **넓은 화면에서는 두 열이고 본문은 안 구른다** (판례 67의 10). 왼쪽 덩어리가 창 높이를 정하고,
      오른쪽 칸은 크기를 내세우지 않고(`contain-size`) 그 높이 안에서 제 칸만 구른다. 높이가 모자라면
      왼쪽 칸도 제 안에서 구른다. **휴대폰 폭에서는 한 열로 쌓이고 본문이 구른다.**
    -->
    <div class="grid gap-6 md:sketch-columns md:min-h-0 md:flex-1 md:grid-rows-1">
      <!--
        왼쪽 덩어리 — 위에서부터 붓 굵기, 캔버스, 단추 줄. 넓은 화면에서 제 안에서 구를 때 단추의
        초점 링이 잘리지 않게 좌우로만 한 칸 반 새어 나간다(`AppDialog`의 본문 칸과 같은 수법).
        위아래로 내면 본문이 넘친다(목업에서 밟았다).
      -->
      <div
        class="flex w-full max-w-md flex-col gap-3 max-md:mx-auto md:-mx-1.5 md:max-w-none md:min-h-0 md:overflow-y-auto md:px-1.5"
      >
        <!--
          축 이름 줄은 화면에서만 숨긴다(`hideLabel`) — 승인된 목업에 없고, 그 줄만큼 캔버스가 준다
          (`utilities.css`의 `sketch-columns`). 이름은 묶음의 `aria-label`로 그대로 읽힌다.
        -->
        <AppChoices
          row
          hide-label
          :label="t('data.image.sketch.width')"
          :items="widthItems"
          :selected="sketch.width"
          @pick="pickWidth"
        >
          <!--
            붓 점. **가장 굵은 점의 자리를 모든 칸이 같이 잡는다** — 칸마다 점 크기대로 자리를 잡으면
            고를 때마다 이름이 옆으로 밀린다. 좁은 화면에서는 이름 위에 서서 이름이 줄을 안 바꾼다.
          -->
          <template #mark="{ id }">
            <span
              aria-hidden="true"
              class="mx-auto mb-1 grid size-3.5 place-items-center md:mx-0 md:mr-2 md:mb-0 md:inline-grid md:align-middle"
            >
              <span
                class="block rounded-full bg-current"
                :style="{ width: dotSize(id), height: dotSize(id) }"
              />
            </span>
          </template>
        </AppChoices>

        <!--
          **포인터는 캔버스가 아니라 이 상자가 받는다.** 캔버스 위에 안내 문장이 겹쳐 있는데, 문장이
          누름을 삼키지 않게 하는 CSS 낱말은 잠금 낱말이다(`@/locks`). 문장 위에서 누른 것도 이 상자로
          올라오고, 좌표는 캔버스를 잰다(`pointOf`). 손가락이 화면을 굴리지 않게 `touch-none`이다.
        -->
        <div
          class="relative mx-auto w-full cursor-crosshair touch-none select-none md:sketch-canvas-fit"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerEnd"
          @pointercancel="onPointerEnd"
        >
          <!--
            픽셀은 `SKETCH_CANVAS_SIZE`로 고정이고 보이는 크기는 CSS가 맞춘다. **바탕은 테마와 무관하게
            흰색이다** — 다크 모드에서도 그렇다(`SKETCH_BACKGROUND`, 실제 바탕은 `drawSketch`가 칠한다).
          -->
          <canvas
            ref="canvas"
            :width="SKETCH_CANVAS_SIZE"
            :height="SKETCH_CANVAS_SIZE"
            class="block aspect-square w-full rounded-field border border-line-strong bg-white"
            :aria-label="t('data.image.sketch.canvas')"
          ></canvas>
          <!--
            안내와 거절이 **같은 자리**다 — 거절해도 새 줄이 안 생긴다(판례 67의 10). 캔버스가 흰색 고정이라
            글자색도 테마와 무관한 고정색이다.
          -->
          <p
            v-if="canvasNote"
            role="status"
            class="absolute inset-0 grid place-items-center px-4 text-center text-lg font-bold"
            :class="refused === null ? 'text-slate-400' : 'text-amber-700'"
          >
            {{ t(canvasNote) }}
          </p>
        </div>

        <!--
          넓은 화면: [되돌리기] [초기화] … [다음 장 추가] 한 줄, 줄바꿈 금지(판례 67의 10).
          휴대폰 폭: 1행 [되돌리기]·[초기화] 반반, 2행 [다음 장 추가] 꽉 차게.
        -->
        <div class="grid grid-cols-2 gap-2 md:flex md:items-center md:whitespace-nowrap">
          <AppButton variant="secondary" @click="undoStroke">
            <component :is="ACTION_ICONS.undoStroke" :size="18" aria-hidden="true" />
            {{ t('data.image.sketch.undo') }}
          </AppButton>
          <AppButton variant="secondary" @click="clearSketch">
            <component :is="ACTION_ICONS.clearSketch" :size="18" aria-hidden="true" />
            {{ t('data.image.sketch.clear') }}
          </AppButton>
          <AppButton variant="secondary" class="col-span-2 md:ml-auto" @click="nextSheet">
            {{ t('data.image.sketch.next') }}
          </AppButton>
        </div>

        <p v-if="failure" role="alert" class="text-danger">{{ t(failure.key, failure.params) }}</p>
      </div>

      <section
        class="flex min-w-0 flex-col gap-3 rounded-panel border border-line bg-surface-sunken p-4 md:min-h-0 md:contain-size"
        :aria-label="t('data.image.sketch.tray')"
      >
        <div class="flex items-baseline justify-between gap-2">
          <h3 class="font-bold">{{ t('data.image.sketch.tray') }}</h3>
          <span class="text-ink-soft tabular-nums">{{
            t('data.image.sketch.trayCount', total)
          }}</span>
        </div>
        <!--
          모은 장, 그리고 마지막에 **"지금" 칸**. 지금 칸은 비어 있어도 선다 — 다음 장이 들어갈 곳이
          여기라는 것을 보인다. 휴대폰 폭에서는 가로 한 줄로 구른다.
        -->
        <ul
          ref="tiles"
          class="flex gap-2 overflow-x-auto p-0.5 md:grid md:sketch-tiles md:min-h-0 md:flex-1 md:overflow-x-hidden md:overflow-y-auto"
        >
          <li
            v-for="(sheet, index) in sheets"
            :key="sheet.key"
            class="relative aspect-square w-18 shrink-0 md:w-auto"
          >
            <img
              :src="sheet.thumbnail"
              :alt="t('data.image.sketch.sheet', { index: index + 1 })"
              class="block size-full rounded-lg border border-line bg-white"
            />
            <AppPlainButton
              class="absolute top-1 right-1 flex size-7 items-center justify-center rounded-full border border-line bg-surface text-ink"
              :aria-label="t('data.image.sketch.removeSheet', { index: index + 1 })"
              @click="removeSheet(sheet.key)"
            >
              <component :is="ACTION_ICONS.dismiss" :size="16" aria-hidden="true" />
            </AppPlainButton>
          </li>
          <li
            class="relative aspect-square w-18 shrink-0 overflow-hidden rounded-lg border-2 border-brand bg-white md:w-auto"
          >
            <img
              v-if="liveThumbnail"
              :src="liveThumbnail"
              :alt="t('data.image.sketch.liveAlt')"
              class="block size-full"
            />
            <span
              class="absolute bottom-1 left-1 rounded-full bg-brand px-1.5 font-bold text-ink-invert"
            >
              {{ t('data.image.sketch.live') }}
            </span>
          </li>
        </ul>
        <p v-if="sheets.length === 0" class="leading-relaxed text-ink-soft">
          {{ t('data.image.sketch.trayNote') }}
        </p>
      </section>
    </div>

    <template #actions>
      <AppButton variant="secondary" @click="requestClose">{{ t('common.cancel') }}</AppButton>
      <AppButton :action="addAll">
        {{ total === 0 ? t('data.image.sketch.add') : t('data.image.sketch.addCount', total) }}
      </AppButton>
    </template>
  </AppDialog>

  <!--
    **추가하지 않은 그림을 버릴지 묻는다** (계획 2.4). 선례는 화면마다 따로 두는 확인 창이다
    (`TabularPanel.vue`의 갈아끼우기 확인). **그리기 창 위에 쌓인다**(코드 소유자) — 둘 다 모달
    `<dialog>`이고 최상위 레이어는 `showModal`을 부른 차례로 쌓는다. 그리기 창은 그대로 떠 있어
    학생이 무엇을 버리는지 본다. `Esc`·바깥·[취소]는 이 창만 닫는다 — 그리기로 돌아간다.
  -->
  <AppDialog
    ref="confirmDialog"
    :open="props.open && confirming"
    :title="t('data.image.sketch.discardTitle')"
    :description="t('data.image.sketch.discardDescription', total)"
    @close="onConfirmClose"
  >
    <template #actions>
      <AppButton variant="secondary" @click="confirming = false">{{
        t('common.cancel')
      }}</AppButton>
      <AppButton variant="danger" @click="discard">
        {{ t('data.image.sketch.discardConfirm') }}
      </AppButton>
    </template>
  </AppDialog>
</template>
