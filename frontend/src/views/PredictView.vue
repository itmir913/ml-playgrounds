<script setup lang="ts">
/**
 * predict 단계. **여기는 고르기만 한다.**
 *
 * 실제 화면은 데이터 종류마다 다르다 — 표는 한 줄을 채우거나 파일을 올리고, 이미지는
 * 사진을 올리면 장수만큼 답이 나온다 (open-decisions.md "이미지 예측 화면"). 그래서
 * `data/kinds.ts` 등록부에서 판을 가져와 그린다.
 *
 * **`if (dataType === ...)`를 두지 않는다** (CLAUDE.md §2). 데이터 화면·전처리 화면과
 * 같은 모양이고, 음성이 들어오는 V6에서 이 파일은 안 바뀐다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppEmpty from '@/components/AppEmpty.vue'
import StepHeader from '@/components/StepHeader.vue'
import { dataKindFor } from '@/data/kinds'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

const kind = computed(() => dataKindFor(project.file?.document.manifest.dataType ?? ''))
</script>

<template>
  <!-- `min-h-full`인 이유는 `views/data/TabularPanel.vue`에 적어 두었다. -->
  <div class="flex min-h-full flex-col gap-5 p-4 sm:p-5">
    <StepHeader :title="t('steps.predict.label')" :purpose="t('steps.predict.purpose')" />

    <component :is="kind.predictPanel" v-if="kind" />
    <AppEmpty v-else :reason="t('data.unsupportedKind')" :next="t('data.unsupportedKindNext')" />
  </div>
</template>
