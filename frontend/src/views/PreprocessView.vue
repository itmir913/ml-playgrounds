<script setup lang="ts">
/**
 * preprocess 단계. 결측치·스케일링·인코딩과 학습할 모델을 정한다.
 *
 * 아직 껍데기다. 화면 하나씩 채운다 (roadmap.md 구현 순서 7).
 */

import { useI18n } from 'vue-i18n'

import AppCard from '@/components/AppCard.vue'

const { t } = useI18n()
</script>

<template>
  <AppCard :title="t('steps.preprocess.label')">
    <p class="text-ink-soft">{{ t('common.underConstruction') }}</p>
  </AppCard>
</template>
