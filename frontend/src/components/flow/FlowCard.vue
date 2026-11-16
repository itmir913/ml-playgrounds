<script setup lang="ts">
/**
 * **대시보드 맨 아래의 전폭 카드** (`architecture.md` §8.22). 머리는 다른 카드처럼 제목만 두고, 그림 안
 * 오른쪽 위의 아이콘 단추(이름은 [크게 보기])가 창을 연다.
 *
 * **그림은 배율 1로 고정이다.** 카드가 받은 폭이 그림의 캔버스 폭(`FLOW_GEOMETRY.width`)보다 좁으면 그림 대신
 * 진행사항 줄과 같은 한 줄(왼쪽 제목, 오른쪽 [열기])로 둔다 — **가로 스크롤도, 줄여 그리기도 하지 않는다**(줄이면 가장 작은 글자
 * 규칙이 깨진다). 분기는 창 폭이 아니라 이 카드가 받은 폭이 정한다(`useElementSize`, §8.20).
 *
 * **그림이 보일 때만 수를 구한다**(`useFlowCounts`) — 단추만 서는 좁은 화면은 계획 코드를 싣지 않는다.
 * 데이터가 없으면 카드가 서지 않는다(그릴 것이 없다. 도구 막대의 단추가 이유와 함께 남는다).
 *
 * **파일만 받는다. 스토어를 읽지 않는다.** `Esc`는 고정한 강조를 푼다(창 밖이라 닫을 것이 그것뿐이다).
 */

import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppPlainButton from '@/components/AppPlainButton.vue'
import { ACTION_ICONS } from '@/icons'
import FlowDiagram from '@/components/flow/FlowDiagram.vue'
import { useElementSize } from '@/composables/useElementSize'
import { useFlowCounts } from '@/composables/useFlowCounts'
import { useFlowDialog } from '@/composables/useFlowDialog'
import { flowModelOf } from '@/ml/flow'
import { FLOW_GEOMETRY } from '@/ml/flow-layout'
import { factsOf } from '@/project/facts'
import type { ProjectFile } from '@/project/format'

const props = defineProps<{ file: ProjectFile }>()

const { t } = useI18n()
const dialog = useFlowDialog()

const hasDiagram = computed(() => flowModelOf(props.file, factsOf(props.file)) !== null)

const body = ref<HTMLElement | null>(null)
const bodySize = useElementSize(body)
/** 그림이 통째로 들어가는 폭인가. */
const fits = computed(() => bodySize.value.width >= FLOW_GEOMETRY.width)

const { counts, bars } = useFlowCounts(
  () => props.file,
  () => false,
  () => hasDiagram.value && fits.value,
)

const pinned = ref<string | null>(null)

function enlarge(event: MouseEvent): void {
  dialog.open(props.file, { opener: event.currentTarget })
}

/**
 * `Esc`. **카드 안이 아니라 문서에서 받는다** — 사파리는 단추를 눌러도 초점이 안 가서 카드가 키 입력을 못
 * 받는다. 창이 열려 있으면 창이 우선이다(창의 `Esc`가 고정 해제와 닫기를 맡는다). 고정이 없으면 건드리지 않는다.
 */
function onDocumentKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || pinned.value === null) return
  // 다른 부품이 이미 처리했거나 열린 창이 있으면 비킨다 — 창이 우선이다.
  if (event.defaultPrevented || dialog.request.value !== null) return
  if (document.querySelector('dialog[open]') !== null) return
  event.preventDefault()
  pinned.value = null
}

onMounted(() => document.addEventListener('keydown', onDocumentKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onDocumentKeydown))

/** 가라앉은 바탕 전체(그림 밖 여백 포함)의 빈 곳을 누르면 고정이 풀린다. 단추는 제외다. */
function onBlank(event: MouseEvent): void {
  if (pinned.value === null) return
  const target = event.target
  if (target instanceof Element && target.closest('button') !== null) return
  pinned.value = null
}
</script>

<template>
  <!-- 머리는 다른 카드(`ProjectHomeView`의 프로젝트 요약)와 같다 — 제목만 두고 같은 클래스를 쓴다. -->
  <section v-if="hasDiagram" class="min-w-0 rounded-panel border border-line bg-surface p-4">
    <h2 v-if="fits" class="mb-3 font-bold">{{ t('flow.title') }}</h2>
    <!--
      좁은 폭에서는 그림이 없어 **대시보드의 진행사항 줄과 같은 모양이다** — 왼쪽은 아이콘과 이름, 오른쪽 끝은
      [열기](`project.openStep`, `secondary`). 단추의 이름은 "프로젝트 흐름도 열기"다.
    -->
    <div v-else class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-2 font-bold break-keep">
        <component :is="ACTION_ICONS.openFlow" :size="20" aria-hidden="true" />
        {{ t('flow.title') }}
      </div>
      <AppButton variant="secondary" :label="t('flow.openFlow')" @click="enlarge">
        {{ t('project.openStep') }}
      </AppButton>
    </div>

    <div ref="body">
      <!-- 가라앉은 바탕이 카드 폭 전체에 깔리고 그림은 가운데에 선다. [크게 보기]는 그 안쪽 오른쪽 위에 겹쳐 둔다. -->
      <div
        v-if="fits"
        class="relative flex justify-center overflow-hidden rounded-card border border-line bg-surface-sunken"
        @click="onBlank"
      >
        <FlowDiagram v-model:pinned="pinned" :file="props.file" :counts="counts" :bars="bars" />
        <AppPlainButton
          :aria-label="t('flow.enlarge')"
          :title="t('flow.enlarge')"
          class="absolute top-2 right-2 z-10 rounded-control border border-line bg-surface p-2 text-ink shadow-card hover:bg-surface-sunken"
          @click="enlarge"
        >
          <component :is="ACTION_ICONS.fitAll" :size="18" aria-hidden="true" />
        </AppPlainButton>
      </div>
    </div>
  </section>
</template>
