<script setup lang="ts">
/**
 * 전처리 화면 머리의 문맥 — **이미지의 것.** `TabularPrepContext`의 형제다.
 *
 * 표가 세는 것(행·열)과 여기서 세는 것이 다르다. **낱말을 바꾼 것이 아니라 세는 것이
 * 다르다** — 이미지에는 열이 없고, 학생이 알고 싶은 것은 사진이 몇 장이고 범주가 몇
 * 개인가다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import { imageCategories, readImages } from '@/project/images'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

const photos = computed(() => readImages(project.file).length)
const categories = computed(() => imageCategories(project.file).length)
</script>

<template>
  <div class="flex items-baseline gap-1.5">
    <dt>
      <AppBadge>{{ t('data.image.photos') }}</AppBadge>
    </dt>
    <dd class="font-bold tabular-nums text-ink">{{ t('data.image.countUnit', photos) }}</dd>
  </div>
  <div class="flex items-baseline gap-1.5">
    <dt>
      <AppBadge>{{ t('data.image.categories') }}</AppBadge>
    </dt>
    <dd class="font-bold tabular-nums text-ink">{{ t('meta.countUnit', categories) }}</dd>
  </div>
</template>
