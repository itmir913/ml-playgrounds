<script setup lang="ts">
/**
 * data 단계. 표 파일을 올리고, 시트를 고르고, 미리 본다.
 *
 * 아직 껍데기다. 화면 하나씩 채운다 (roadmap.md 구현 순서 7).
 */

import { useI18n } from 'vue-i18n'

import AppCard from '@/components/AppCard.vue'

const { t } = useI18n()
</script>

<template>
  <AppCard :title="t('steps.data.label')">
    <p class="text-ink-soft">{{ t('common.underConstruction') }}</p>
  </AppCard>
</template>
