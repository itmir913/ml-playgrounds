<script setup lang="ts">
/**
 * 프로젝트 목록. 앱을 열면 여기부터다.
 *
 * 아직 껍데기다 — 목록·새 프로젝트·열기는 다음 차례다 (roadmap.md 구현 순서 7).
 */

import { useI18n } from 'vue-i18n'

import AppCard from '@/components/AppCard.vue'
import AppHero from '@/components/AppHero.vue'

const { t } = useI18n()
</script>

<template>
  <div class="min-h-screen">
    <AppHero :badge="t('app.name')" :title="t('app.name')" :description="t('app.tagline')" />

    <main class="mx-auto max-w-shell px-4 py-8 sm:px-6 md:py-12">
      <AppCard :title="t('nav.projects')">
        <p class="text-ink-soft">{{ t('common.underConstruction') }}</p>
      </AppCard>
    </main>
  </div>
</template>
