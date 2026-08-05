<script setup lang="ts">
/**
 * predict 단계. 담긴 모델에 새 값을 넣어 예측한다.
 *
 * 아직 껍데기다. 화면 하나씩 채운다 (roadmap.md 구현 순서 7).
 */

import { useI18n } from 'vue-i18n'

import AppCard from '@/components/AppCard.vue'

const { t } = useI18n()
</script>

<template>
  <AppCard :title="t('steps.predict.label')">
    <p class="text-ink-soft">{{ t('common.underConstruction') }}</p>
  </AppCard>
</template>
