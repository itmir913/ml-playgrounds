<script setup lang="ts">
/**
 * 데이터 단계. **여기는 고르기만 한다.**
 *
 * 실제 화면은 데이터 종류마다 다르다 — 표는 스프레드시트이고 이미지는 썸네일 격자다.
 * 그래서 `data/kinds.ts` 등록부에서 판을 가져와 그린다. **`if (dataType === ...)`를
 * 두지 않는다** (CLAUDE.md §2) — 이미지·음성이 들어오는 V5에서 이 파일은 안 바뀐다.
 *
 * 모르는 종류는 거부하지 않고 **왜 못 다루는지 말한다.** 상위 버전에서 만든 파일을
 * 열었을 때 학생이 볼 수 있는 화면이다 (mlpx-spec.md §6.2와 같은 태도).
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppEmpty from '@/components/AppEmpty.vue'
import { dataKindFor } from '@/data/kinds'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

const kind = computed(() => {
  const dataType = project.file?.document.manifest.dataType
  return dataType === undefined ? undefined : dataKindFor(dataType)
})
</script>

<template>
  <component :is="kind.panel" v-if="kind" :accept="kind.accept" />
  <AppEmpty v-else :reason="t('data.unsupportedKind')" :next="t('data.unsupportedKindNext')" />
</template>
