<script setup lang="ts">
/**
 * **프로젝트 흐름도의 창을 여는 단추** (`architecture.md` §8.22) — 도구 막대의 단추(`components/FlowButton.vue`)와
 * 점검 화면의 단추가 같은 이 부품이다. **파일만 받는다. 스토어를 읽지 않는다** — 점검은 스토어를 안 쓴다.
 *
 * **올린 데이터가 없으면 이유와 함께 잠근다** (`@/locks`의 `flow`). 숨기지 않는다 — 사라진 단추는 없는 기능이다.
 * 잠긴 단추는 누를 수 있게 두고(`announce`) 누르면 이유가 선다. 마우스를 올려야 보이는 `title`만으로는 휴대폰에서
 * 이유를 못 읽는다(결정문 65). 이유는 종류가 준다(`FLOW_TEXT`) — 사진 프로젝트에 "데이터를 불러오세요"는 맞지 않는다.
 *
 * `compact`는 좁은 폭에서 글자를 숨기고 그림만 남긴다. 이름은 `aria-label`이 준다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppPlainButton from '@/components/AppPlainButton.vue'
import AppPopover from '@/components/AppPopover.vue'
import { useFlowDialog } from '@/composables/useFlowDialog'
import { ACTION_ICONS } from '@/icons'
import { isLocked, lockFor } from '@/locks'
import { FLOW_TEXT } from '@/ml/flow-view'
import { factsOf } from '@/project/facts'
import type { ProjectFile } from '@/project/format'

const props = withDefaults(
  defineProps<{
    file: ProjectFile
    /** 점검이다 — 창이 행 수 없이 그린다. */
    lite?: boolean
    /** 좁은 폭에서 글자를 숨긴다. */
    compact?: boolean
  }>(),
  { lite: false, compact: false },
)

const { t } = useI18n()
const dialog = useFlowDialog()

const lock = computed(() => lockFor('flow', { dataReady: factsOf(props.file).datasetReady }))
const reason = computed(() => t(FLOW_TEXT[props.file.document.manifest.dataType].noDataKey))

function open(event: MouseEvent): void {
  dialog.open(props.file, { lite: props.lite, opener: event.currentTarget })
}
</script>

<template>
  <AppButton v-if="!isLocked(lock)" variant="secondary" :label="t('flow.title')" @click="open">
    <component :is="ACTION_ICONS.openFlow" :size="18" aria-hidden="true" />
    <span :class="props.compact ? 'max-md:hidden' : ''">{{ t('flow.title') }}</span>
  </AppButton>

  <!-- 잠겼을 때: 보이게 두되 누를 수 없다고 알리고, 누르면 이유가 선다. -->
  <AppPopover v-else align="right">
    <template #trigger>
      <AppPlainButton
        announce
        look="sunken"
        :lock="lock"
        :aria-label="t('flow.title')"
        class="inline-flex items-center justify-center gap-2 rounded-control border px-4 py-2.5 font-bold"
      >
        <component :is="ACTION_ICONS.openFlow" :size="18" aria-hidden="true" />
        <span :class="props.compact ? 'max-md:hidden' : ''">{{ t('flow.title') }}</span>
      </AppPlainButton>
    </template>
    <p class="font-bold">{{ t('flow.title') }}</p>
    <p role="status" class="mt-1">{{ reason }}</p>
  </AppPopover>
</template>
