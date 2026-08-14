<script setup lang="ts">
/**
 * 학습 화면 머리의 문맥 — **이미지의 것.** `TabularTrainContext`의 형제다.
 *
 * 표가 "타깃 열과 특성 몇 개"를 보이는 자리에 **학습에 들어갈 사진 수와 범주 수**를
 * 보인다. 낱말을 바꾼 것이 아니라 **세는 것이 다르다** — 이미지에는 타깃 열이 없고
 * 특성은 백본이 만든다.
 *
 * **분류에서는 라벨 붙은 사진만 센다.** 학습에 안 들어가는 사진을 세면 화면이 말하는
 * 수와 실제로 학습한 수가 갈리고, 그 차이는 결과가 나온 뒤에야 드러난다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import { trainableRowsOf } from '@/ml/training-source'
import { imageCategories } from '@/project/images'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

/** **학습이 세는 것과 같은 함수다** — 갈리면 화면과 학습이 다른 말을 한다. */
const photos = computed(() =>
  project.file === null ? 0 : trainableRowsOf(project.file, project.taskType),
)
const categories = computed(() => imageCategories(project.file).length)
</script>

<template>
  <div class="flex items-baseline gap-1.5">
    <dt>
      <AppBadge>{{ t('meta.image.photos') }}</AppBadge>
    </dt>
    <dd class="font-bold tabular-nums text-ink">{{ t('meta.image.countUnit', photos) }}</dd>
  </div>
  <div class="flex items-baseline gap-1.5">
    <dt>
      <AppBadge>{{ t('meta.image.categories') }}</AppBadge>
    </dt>
    <dd class="font-bold tabular-nums text-ink">{{ t('meta.countUnit', categories) }}</dd>
  </div>
</template>
