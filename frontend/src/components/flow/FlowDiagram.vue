<script setup lang="ts">
/**
 * **프로젝트 흐름도의 그림 하나** (`architecture.md` §8.22). 대시보드 카드와 창이 같은 이 부품을 쓴다 —
 * 배율은 받은 쪽이 정한다(카드는 1, 창은 변환 판 위).
 *
 * **파일만 받는다. 스토어를 읽지 않는다** — 점검 화면에서도 그려져야 한다. 수는 `counts`와 `bars`로 받는다
 * (그것을 구하는 `ml/flow-counts`는 지연해서 싣는다, `composables/useFlowCounts.ts`).
 *
 * **도형은 SVG, 글자와 눌러서 닿는 것은 HTML이다.** SVG 층은 보조 기술에서 뺀다(`aria-hidden`) — 노드와 막대
 * 조각마다 `AppPlainButton`을 겹쳐 키보드로 닿게 한다. 잠금 낱말(`LOCK_WORDS`)이 SVG 노드에 `tabindex`를 못 주게
 * 막으므로 단추가 아니면 초점이 못 간다. 좌표는 `layoutOf`가 낸다 — 이 파일이 숫자를 정하지 않는다.
 *
 * **마우스를 올리면 강조만 하고, 누르면 고정한다.** 같은 대상을 다시 누르거나 빈 곳을 누르면 풀린다(`Esc`는 이
 * 부품을 담은 쪽이 받는다). 올림과 내림은 **노드 단위로만** 단다 — 자식 경계에서 풀렸다 켜지지 않게, 풀림은
 * `ml/flow-hover.ts`가 늦춘다. 전환은 불투명도뿐이다.
 *
 * **색은 `styles/utilities.css`의 `flow-*`만 쓴다.** 흐르는 것마다 `flow-tint-*`가 `--flow`를 정한다.
 * 클래스는 글자 그대로 적어야 Tailwind가 만든다 — 조립하지 않는다(아래 표).
 */

import { computed, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppPlainButton from '@/components/AppPlainButton.vue'
import FlowOutline from '@/components/flow/FlowOutline.vue'
import { useElementSize } from '@/composables/useElementSize'
import {
  FLOW_FLOWS,
  FLOW_TASK_LABEL_KEYS,
  flowModelOf,
  type FlowFlow,
  type FlowNodeId,
} from '@/ml/flow'
import type { FlowCounts } from '@/ml/flow-counts'
import { highlightOf } from '@/ml/flow-highlight'
import { HOVER_IDLE, hoverStep, type HoverEvent, type HoverState } from '@/ml/flow-hover'
import {
  FLOW_GEOMETRY,
  layoutOf,
  type FlowBarValues,
  type FlowCardLayout,
  type FlowPiece,
  type Rect,
} from '@/ml/flow-layout'
import {
  FLOW_TEXT,
  basisKeyOf,
  lineEmphasis,
  nodeEmphasis,
  pieceEmphasis,
  pieceNameKey,
  pieceTargetKey,
  splitPercents,
  targetOf,
  trunkEmphasis,
  type Emphasis,
} from '@/ml/flow-view'
import { factsOf } from '@/project/facts'
import type { ProjectFile } from '@/project/format'

const props = defineProps<{
  file: ProjectFile
  /** 열 때 구한 수. 모르면 `null`이고 막대는 설정 비율의 윤곽이다. */
  counts: FlowCounts | null
  bars: FlowBarValues | null
}>()

/** 눌러서 고정한 대상. 담은 쪽이 `Esc`로 풀 수 있게 모델로 연다. */
const pinned = defineModel<string | null>('pinned', { default: null })

const { t } = useI18n()
const uid = useId()
const G = FLOW_GEOMETRY
/** 아직 안 한 일의 점선. 윤곽과 점선 간선이 같은 박자다. */
const PENDING_DASH = `${G.pendingDashOn} ${G.pendingDashOff}`

const model = computed(() =>
  flowModelOf(props.file, factsOf(props.file), props.counts?.prep ?? undefined),
)

// ------------------------------------------------------------------ 칩이 꺾이는가

/** 전체 데이터 카드의 칩 줄. 꺾이면 높이가 한 줄을 넘는다 — 글자 폭을 재지 않고 줄이 낸 높이를 본다. */
const chipRow = ref<HTMLElement | null>(null)
const chipSize = useElementSize(chipRow)
const chipWrap = computed(() => chipSize.value.height > G.newChipH)

const layout = computed(() => {
  const current = model.value
  if (current === null) return null
  return layoutOf(current, {
    bars: props.bars,
    testSize: props.file.document.settings.split.testSize,
    chipWrap: chipWrap.value,
  })
})

// ------------------------------------------------------------------ 강조

const hover = ref<HoverState>(HOVER_IDLE)
let timer: ReturnType<typeof setTimeout> | undefined

function dispatch(event: HoverEvent): void {
  const step = hoverStep(hover.value, event)
  hover.value = step.state
  if (step.timer === 'cancel') clearTimeout(timer)
  else if (step.timer !== null) {
    clearTimeout(timer)
    timer = setTimeout(() => dispatch({ kind: 'release' }), step.timer.start)
  }
  if (pinned.value !== step.state.pinned) pinned.value = step.state.pinned
}

// 담은 쪽이 고정을 풀었을 때(`Esc`) 안의 상태도 푼다.
watch(pinned, (next) => {
  if (next === hover.value.pinned) return
  dispatch(next === null ? { kind: 'unpin' } : { kind: 'pin', target: next })
})

onBeforeUnmount(() => clearTimeout(timer))

const highlight = computed(() => {
  const current = model.value
  const shown = hover.value.shown
  return current === null || shown === null ? null : highlightOf(current, targetOf(shown))
})

const enter = (key: string): void => dispatch({ kind: 'enter', target: key })
const leaveNode = (): void => dispatch({ kind: 'leaveNode' })
const leave = (): void => dispatch({ kind: 'leave' })

/** 누르면 고정하고, 같은 것을 다시 누르면 푼다. */
function press(key: string): void {
  dispatch(hover.value.pinned === key ? { kind: 'unpin' } : { kind: 'pin', target: key })
}

/** 빈 곳을 누르면 고정이 풀린다. 단추를 누른 것은 `press`가 이미 다뤘다. */
function onBackground(event: MouseEvent): void {
  if (hover.value.pinned === null) return
  const target = event.target
  if (target instanceof Element && target.closest('button') !== null) return
  dispatch({ kind: 'unpin' })
}

// ------------------------------------------------------------------ 그리는 것들

const px = (value: number): string => `${value}px`

function rectStyle(rect: Rect): Record<string, string> {
  return { left: px(rect.x), top: px(rect.y), width: px(rect.w), height: px(rect.h) }
}

/** 흐르는 것의 색. **글자 그대로 적는다** — 조립한 클래스는 Tailwind가 만들지 못한다. */
const TINT: Readonly<Record<FlowFlow, string>> = {
  file: 'flow-tint-file',
  train: 'flow-tint-train',
  test: 'flow-tint-test',
  new: 'flow-tint-new',
  model: 'flow-tint-model',
  basis: 'flow-tint-basis',
}

const nodeById = computed(
  () => new Map((model.value?.nodes ?? []).map((node) => [node.id, node] as const)),
)

function flowOf(id: FlowNodeId): FlowFlow {
  return nodeById.value.get(id)?.flow ?? 'file'
}
const pendingOf = (id: FlowNodeId): boolean => nodeById.value.get(id)?.state === 'pending'
const labelOf = (id: FlowNodeId): string => {
  const node = nodeById.value.get(id)
  return node === undefined ? '' : t(node.labelKey)
}

const fade = (emphasis: Emphasis): Record<string, boolean> => ({
  'flow-dim': emphasis === 'dim',
})
const glow = (emphasis: Emphasis): Record<string, boolean> => ({
  'flow-glow': emphasis === 'lit',
})

const text = computed(() => FLOW_TEXT[model.value?.dataType ?? 'tabular'])
/** 기준 선의 이름. 나누지 않는 유형은 훈련 데이터라는 몫이 없다 — 학습에 쓰는 데이터가 기준이다. */
const basisKey = computed(() => basisKeyOf(model.value?.splitsData ?? true))

// --- 막대 조각

/** 탭 순서. **파랑 다음 그 막대의 회색이다.** */
const PIECE_ORDER = ['file:bar', 'file:gray', 'train', 'test', 'test:bar', 'test:gray'] as const

function pieceKey(piece: FlowPiece): string {
  return piece.segment ?? piece.node
}

const pieces = computed(() =>
  [...(layout.value?.pieces ?? [])].sort(
    (a, b) =>
      PIECE_ORDER.indexOf(pieceKey(a) as (typeof PIECE_ORDER)[number]) -
      PIECE_ORDER.indexOf(pieceKey(b) as (typeof PIECE_ORDER)[number]),
  ),
)

const piecesIn = (layer: FlowPiece['layer']): FlowPiece[] =>
  (layout.value?.pieces ?? []).filter((piece) => piece.layer === layer)

function pieceName(piece: FlowPiece): string {
  const key = pieceNameKey(piece)
  return key === null ? labelOf(piece.node) : t(key)
}

/** 막대 조각 하나의 모양. 윤곽이거나 회색이거나 바깥 테를 두른 평평한 색이다. */
function barRect(piece: FlowPiece, grow: number): Record<string, number> {
  const { x, y, w, h } = piece.rect
  return {
    x: x - grow,
    y: y - grow,
    width: w + grow * 2,
    height: h + grow * 2,
    rx: G.barRadius + grow,
  }
}

// --- 선

const linesIn = (layer: 'trainLine' | 'lines') =>
  (layout.value?.lines ?? []).filter((line) => line.layer === layer)

const markerOf = (flow: FlowFlow): string => `url(#${uid}-m-${flow})`

// --- 카드의 글자

interface Chip {
  readonly empty: boolean
  readonly text: string
  readonly pending: boolean
}

function featuresText(): string {
  const count = props.counts?.featureCount
  return count === null || count === undefined
    ? t(text.value.featuresUnknownKey)
    : t(text.value.featuresKey, { count })
}

function chipsOf(card: FlowCardLayout): Chip[] {
  const current = model.value
  if (current === null) return []
  if (card.id === 'new') {
    return [
      {
        empty: props.counts?.featureCount === 0,
        text: featuresText(),
        pending: pendingOf('new'),
      },
    ]
  }
  const target = current.cards.find((entry) => entry.id === card.id)?.target ?? 'none'
  const chips: Chip[] = [
    { empty: props.counts?.featureCount === 0, text: featuresText(), pending: false },
  ]
  if (target !== 'none') {
    chips.push({ empty: target === 'empty', text: t(text.value.targetKey), pending: false })
  }
  return chips
}

function fileNameOf(card: FlowCardLayout): string | undefined {
  return model.value?.cards.find((entry) => entry.id === card.id)?.fileName
}

/** 카드의 행(사진) 수. 모르면 `null`이다. 새 데이터 카드는 수를 말하지 않는다. */
function countOf(card: FlowCardLayout): number | null {
  if (card.id === 'whole') return props.counts?.total ?? null
  if (card.id === 'testFile') return props.counts?.testFile?.total ?? null
  return null
}

function setChipRow(id: FlowCardLayout['id'], element: unknown): void {
  if (id === 'whole') chipRow.value = element instanceof HTMLElement ? element : null
}

const percents = computed(() => splitPercents(props.file.document.settings.split.testSize))
/** 학습 유형을 아직 안 골랐다 — 분할도 말할 수 없고 이름표는 윤곽이다. */
const unsetTask = computed(() => model.value?.taskLabelKey === FLOW_TASK_LABEL_KEYS.unset)

// --- 상자와 원

const BOXES = ['p1', 'p2', 'p3', 'learn', 'eval'] as const

const boxes = computed(() =>
  BOXES.flatMap((id) => {
    const rect = layout.value?.boxes[id]
    const node = nodeById.value.get(id)
    return rect === undefined || node === undefined ? [] : [{ id, rect, node }]
  }),
)

const circles = computed(() => {
  const found = layout.value?.circles
  return found === undefined
    ? []
    : (['exp', 'pred'] as const).map((id) => ({
        id,
        rect: found[id],
        node: nodeById.value.get(id),
      }))
})

/** 그리는 층. 카드와 깔때기는 맨 아래라 따로 그린다. */
const DRAWN_LAYERS = ['fileBar', 'trainLine', 'splitBars', 'lines'] as const

const newCard = computed(() => layout.value?.cards.find((card) => card.id === 'new'))
</script>

<template>
  <div
    v-if="model !== null && layout !== null"
    class="relative bg-surface-sunken"
    :style="{ width: px(layout.width), height: px(layout.height) }"
    @pointerleave="leave"
    @click="onBackground"
  >
    <svg
      class="absolute top-0 left-0 overflow-visible"
      :width="layout.width"
      :height="layout.height"
      :viewBox="`0 0 ${layout.width} ${layout.height}`"
      aria-hidden="true"
    >
      <defs>
        <marker
          v-for="flow in FLOW_FLOWS"
          :id="`${uid}-m-${flow}`"
          :key="flow"
          viewBox="0 0 10 10"
          :refX="G.arrowRefX"
          :refY="G.arrowRefY"
          :markerWidth="G.arrowHead"
          :markerHeight="G.arrowHead"
          markerUnits="userSpaceOnUse"
          orient="auto"
          :class="TINT[flow]"
        >
          <path d="M0,0L10,5L0,10z" class="flow-fill" />
        </marker>
      </defs>

      <!-- 카드. 아직 안 한 단계(새 데이터)의 카드는 점선이다. -->
      <rect
        v-for="card in layout.cards"
        :key="card.id"
        :x="card.rect.x + (pendingOf(card.node) ? G.pendingStroke / 2 : 0)"
        :y="card.rect.y + (pendingOf(card.node) ? G.pendingStroke / 2 : 0)"
        :width="card.rect.w - (pendingOf(card.node) ? G.pendingStroke : 0)"
        :height="card.rect.h - (pendingOf(card.node) ? G.pendingStroke : 0)"
        :rx="G.cardRadius"
        :class="[
          pendingOf(card.node) ? 'flow-card-pending' : 'flow-card',
          'flow-fade',
          fade(nodeEmphasis(highlight, card.node)),
        ]"
        :stroke-width="pendingOf(card.node) ? G.pendingStroke : undefined"
        :stroke-dasharray="pendingOf(card.node) ? PENDING_DASH : undefined"
      />

      <!-- 깔때기: 전체 데이터가 두 몫으로 갈리는 자리. 파일 막대의 켜짐을 따른다. -->
      <g class="flow-fade flow-tint-file" :class="fade(nodeEmphasis(highlight, 'file'))">
        <path :d="layout.funnel.fill" class="flow-fill" :fill-opacity="G.funnelFillOpacity" />
        <path
          v-for="rail in layout.funnel.rails"
          :key="rail"
          :d="rail"
          class="flow-stroke"
          :stroke-opacity="G.railOpacity"
          :stroke-width="G.railStroke"
          :stroke-dasharray="`${G.railDashOn} ${G.railDashOff}`"
        />
      </g>

      <!-- 층 순서: 파일 막대 → 훈련 선 → 분할 막대 → 나머지 선. -->
      <template v-for="layer in DRAWN_LAYERS" :key="layer">
        <template v-if="layer === 'fileBar' || layer === 'splitBars'">
          <g
            v-for="piece in piecesIn(layer)"
            :key="pieceKey(piece)"
            class="flow-fade"
            :class="[
              TINT[flowOf(piece.node)],
              fade(pieceEmphasis(highlight, piece)),
              piece.look === 'gray' ? '' : glow(pieceEmphasis(highlight, piece)),
            ]"
          >
            <rect v-if="piece.look === 'gray'" v-bind="barRect(piece, 0)" class="flow-bar-gray" />
            <rect
              v-else-if="piece.look === 'outline'"
              v-bind="barRect(piece, 0)"
              class="flow-bar-outline"
              :stroke-width="G.pendingStroke"
              :stroke-dasharray="PENDING_DASH"
            />
            <template v-else>
              <rect v-bind="barRect(piece, G.barHalo)" class="flow-bar-halo" />
              <rect v-bind="barRect(piece, 0)" class="flow-fill" />
            </template>
          </g>
        </template>
        <template v-else>
          <g
            v-for="line in linesIn(layer)"
            :key="line.key"
            class="flow-fade"
            :class="fade(lineEmphasis(highlight, line.key))"
          >
            <path
              v-if="line.halo"
              :d="line.d"
              class="fill-none stroke-surface-sunken"
              :stroke-width="G.haloStroke"
              stroke-linecap="round"
            />
            <path
              :d="line.d"
              class="flow-stroke"
              :class="[TINT[line.flow], glow(lineEmphasis(highlight, line.key))]"
              :stroke-dasharray="line.pending ? PENDING_DASH : undefined"
              :stroke-width="lineEmphasis(highlight, line.key) === 'lit' ? G.strokeLit : G.stroke"
              :marker-end="line.arrow ? markerOf(line.flow) : undefined"
            />
          </g>
          <!-- 기준 선의 줄기와 갈라지는 점. 줄기는 갈래 하나라도 켜지면 켜진다. -->
          <g
            v-if="layer === 'lines' && layout.trunk !== null"
            class="flow-fade flow-tint-basis"
            :class="fade(trunkEmphasis(highlight))"
          >
            <path
              :d="layout.trunk.d"
              class="flow-stroke"
              :class="[glow(trunkEmphasis(highlight))]"
              :stroke-dasharray="layout.trunk.pending ? PENDING_DASH : undefined"
              :stroke-width="trunkEmphasis(highlight) === 'lit' ? G.strokeLit : G.stroke"
            />
            <circle
              :cx="layout.trunk.dot.x"
              :cy="layout.trunk.dot.y"
              :r="G.basisDot"
              class="flow-fill"
            />
          </g>
        </template>
      </template>
    </svg>

    <!-- 카드의 글자. 전부 HTML이다 — 번역이 길어지면 줄을 접거나 말줄임으로 받는다. -->
    <template v-for="card in layout.cards" :key="card.id">
      <div
        class="absolute flex h-6 items-center gap-2 font-semibold"
        :class="[
          'flow-fade',
          TINT[flowOf(card.node)],
          pendingOf(card.node) ? 'flow-text-dim' : 'flow-text-head',
          fade(nodeEmphasis(highlight, card.node)),
        ]"
        :style="{ left: px(G.innerX), top: px(card.headY), width: px(G.innerW) }"
      >
        <span class="flow-node-mark size-2.5 shrink-0 rounded-full" aria-hidden="true" />
        <span class="truncate">{{ labelOf(card.node) }}</span>
      </div>

      <div
        v-if="card.nameY !== null && (fileNameOf(card) !== undefined || countOf(card) !== null)"
        class="flow-fade absolute flex items-baseline gap-2.5"
        :class="fade(nodeEmphasis(highlight, card.node))"
        :style="{ left: px(G.innerX), top: px(card.nameY), width: px(G.innerW) }"
      >
        <span
          v-if="fileNameOf(card) !== undefined"
          class="min-w-0 truncate"
          :class="card.id === 'new' ? 'text-ink-soft' : 'font-semibold'"
          :title="fileNameOf(card)"
          >{{ fileNameOf(card) }}</span
        >
        <span v-if="countOf(card) !== null" class="shrink-0 text-ink-soft">{{
          t(text.countKey, { count: countOf(card) })
        }}</span>
      </div>

      <div
        :ref="(element) => setChipRow(card.id, element)"
        class="flow-fade absolute grid items-start"
        :class="fade(nodeEmphasis(highlight, card.node))"
        :style="{
          left: px(G.innerX),
          top: px(card.chipsY),
          width: px(G.innerW),
          gridTemplateColumns: card.id === 'new' ? '1fr' : `${px(G.chipColA)} ${px(G.chipColB)}`,
          columnGap: px(G.chipGap),
        }"
      >
        <div
          v-for="(chip, at) in chipsOf(card)"
          :key="at"
          class="relative flex min-w-0 items-center rounded-2xl border px-3 py-1 leading-tight font-semibold"
          :class="[chip.empty || chip.pending ? 'flow-chip-pending' : 'flow-chip']"
          :style="{ minHeight: px(G.newChipH) }"
        >
          <FlowOutline v-if="chip.empty || chip.pending" :radius="G.chipRadius" />
          <span v-if="!chip.empty" class="min-w-0 break-words">{{ chip.text }}</span>
        </div>
      </div>
    </template>

    <!--
      분할 글자 줄. 한 줄이 한 키다 — 이름만 굵게 하려고 따로 끼우지 않고 줄 전체를 굵게 그린다(i18n.md 규칙 3,
      코드 소유자).
    -->
    <p
      v-if="layout.splitTextY !== null"
      class="flow-fade absolute h-6 truncate font-semibold text-ink"
      :class="fade(nodeEmphasis(highlight, 'file'))"
      :style="{ left: px(G.innerX), top: px(layout.splitTextY), width: px(G.innerW) }"
    >
      {{ unsetTask ? t('flow.splitPending') : t('flow.split', percents) }}
    </p>

    <!-- 분할 막대 밑의 이름. 노드가 곧 조각의 이름이다. -->
    <div
      class="absolute flex gap-3"
      :style="{ left: px(G.innerX), top: px(layout.captions.y), width: px(G.innerW) }"
    >
      <span
        v-for="id in layout.captions.nodes"
        :key="id"
        class="flow-fade flow-text-head flex min-w-0 flex-1 items-center gap-2 font-semibold"
        :class="[TINT[flowOf(id)], fade(nodeEmphasis(highlight, id))]"
      >
        <span class="flow-node-mark size-2.5 shrink-0 rounded-full" aria-hidden="true" />
        <span class="truncate">{{ labelOf(id) }}</span>
      </span>
    </div>

    <!-- 기준 선의 이름. 훈련 데이터에서 구한 값을 테스트와 새 데이터가 받는다는 것을 방향 있는 선 하나가 말한다. -->
    <p
      v-if="layout.trunk !== null"
      class="flow-fade flow-text-dim absolute h-6 truncate font-semibold"
      :class="fade(trunkEmphasis(highlight))"
      :style="{
        left: px(layout.trunk.label.x),
        top: px(layout.trunk.label.y),
        width: px(layout.trunk.label.w),
      }"
    >
      {{ t(basisKey) }}
    </p>

    <!-- 상자. 노드는 HTML 단추다 — 누르면 그 노드의 경로가 고정된다. -->
    <AppPlainButton
      v-for="box in boxes"
      :key="box.id"
      class="flow-fade absolute flex overflow-hidden rounded-control text-left leading-tight font-semibold"
      :class="[
        box.id === 'learn' ? 'flex-col items-start justify-center gap-1 pl-3' : 'items-center pl-6',
        TINT[box.node.flow],
        pendingOf(box.id) ? 'flow-node-pending' : 'flow-node shadow-card',
        box.node.prep === 'preprocessOff' ? 'flow-node-off' : '',
        fade(nodeEmphasis(highlight, box.id)),
        glow(nodeEmphasis(highlight, box.id)),
      ]"
      :style="rectStyle(box.rect)"
      :aria-pressed="pinned === box.id"
      @pointerenter="enter(box.id)"
      @pointerleave="leaveNode"
      @focus="enter(box.id)"
      @blur="leave"
      @click="press(box.id)"
    >
      <FlowOutline
        v-if="pendingOf(box.id) || box.node.prep === 'preprocessOff'"
        :radius="G.boxRadius"
      />
      <template v-if="box.id === 'learn'">
        <!-- 학습 상자는 늘 두 줄이다: 이름, 그 아래 유형 칩(왼쪽을 이름에 맞춘다). 유형을 안 골랐으면 칩이 흐리다. -->
        <span class="flex min-w-0 items-center gap-2 pr-2.5">
          <span class="flow-node-mark h-4 w-1 shrink-0 rounded-sm" aria-hidden="true" />
          <span class="truncate">{{ labelOf(box.id) }}</span>
        </span>
        <span
          class="relative ml-3 max-w-full min-w-0 truncate rounded-2xl border px-3 py-0.5"
          :class="unsetTask ? 'flow-chip-pending' : 'flow-chip'"
          :title="t(model.taskLabelKey)"
        >
          <FlowOutline v-if="unsetTask" :radius="G.chipRadius" />{{ t(model.taskLabelKey) }}
        </span>
      </template>
      <template v-else>
        <span
          class="flow-node-mark absolute top-1/2 left-3 h-4 w-1 -translate-y-1/2 rounded-sm"
          aria-hidden="true"
        />
        <span class="line-clamp-2 min-w-0 pr-2.5 break-words">{{ labelOf(box.id) }}</span>
      </template>
    </AppPlainButton>

    <!-- 원: 실험과 예측. -->
    <template v-for="circle in circles" :key="circle.id">
      <AppPlainButton
        v-if="circle.node !== undefined"
        class="flow-fade absolute flex flex-col items-center justify-center overflow-hidden rounded-full text-center font-bold"
        :class="[
          TINT[circle.node.flow],
          pendingOf(circle.id) ? 'flow-circle-pending' : 'flow-circle',
          fade(nodeEmphasis(highlight, circle.id)),
          glow(nodeEmphasis(highlight, circle.id)),
        ]"
        :style="rectStyle(circle.rect)"
        :aria-pressed="pinned === circle.id"
        @pointerenter="enter(circle.id)"
        @pointerleave="leaveNode"
        @focus="enter(circle.id)"
        @blur="leave"
        @click="press(circle.id)"
      >
        <FlowOutline v-if="pendingOf(circle.id)" radius="50%" />
        <span class="line-clamp-2 max-w-21 leading-snug break-words">{{ labelOf(circle.id) }}</span>
        <span v-if="circle.id === 'exp'" class="font-normal">{{
          t('results.experimentCount', { count: model.experimentCount })
        }}</span>
      </AppPlainButton>
    </template>

    <!-- 새 데이터 카드는 카드 전체가 단추다. -->
    <AppPlainButton
      v-if="newCard !== undefined"
      class="absolute rounded-card bg-transparent"
      :style="rectStyle(newCard.rect)"
      :aria-label="labelOf('new')"
      :aria-pressed="pinned === 'new'"
      @pointerenter="enter('new')"
      @pointerleave="leaveNode"
      @focus="enter('new')"
      @blur="leave"
      @click="press('new')"
    />

    <!--
      막대 조각의 누르는 자리. 투명하고 최소 한 변이 `hitMin`이다. 탭 순서는 파랑 다음 그 막대의 회색이고,
      파란 조각이 위에 서야(`z-10`) 회색이 파란 조각 밑으로 들어간 자리를 가로채지 않는다.
    -->
    <AppPlainButton
      v-for="piece in pieces"
      :key="pieceKey(piece)"
      class="absolute rounded-full bg-transparent"
      :class="piece.look === 'gray' ? '' : 'z-10'"
      :style="rectStyle(piece.hit)"
      :aria-label="pieceName(piece)"
      :aria-pressed="pinned === pieceTargetKey(piece)"
      @pointerenter="enter(pieceTargetKey(piece))"
      @pointerleave="leaveNode"
      @focus="enter(pieceTargetKey(piece))"
      @blur="leave"
      @click="press(pieceTargetKey(piece))"
    />
  </div>
</template>
