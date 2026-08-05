<script setup lang="ts">
/**
 * portfolio 단계. 학생이 과정을 글로 남긴다.
 *
 * 아직 껍데기다. 화면 하나씩 채운다 (roadmap.md 구현 순서 7).
 */

import { useI18n } from 'vue-i18n'

import AppCard from '@/components/AppCard.vue'

const { t } = useI18n()
</script>

<template>
  <AppCard :title="t('steps.portfolio.label')">
    <p class="text-ink-soft">{{ t('common.underConstruction') }}</p>
  </AppCard>
</template>
