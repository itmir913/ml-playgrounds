<script setup lang="ts">
/**
 * train 단계. 묶음을 돌리고 진행 상황을 보여준다.
 *
 * 아직 껍데기다. 화면 하나씩 채운다 (roadmap.md 구현 순서 7).
 */

import { useI18n } from 'vue-i18n'

import AppCard from '@/components/AppCard.vue'

const { t } = useI18n()
</script>

<template>
  <AppCard :title="t('steps.train.label')">
    <p class="text-ink-soft">{{ t('common.underConstruction') }}</p>
  </AppCard>
</template>
