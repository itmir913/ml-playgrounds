<script setup lang="ts">
/**
 * 프로젝트 요약에서 **이미지가 답하는 줄들** — 사진 수·범주 수·라벨 없는 사진.
 *
 * `TabularSummaryRows`의 형제다. **낱말을 바꾼 것이 아니라 세는 것이 다르다** —
 * 이미지에는 파일 하나도, 행도 열도, 타깃 열도 없다.
 *
 * **낱말은 `meta.image.*`에서 온다** (docs/i18n.md 규칙 10) — 표가 `meta.tabular.*`를
 * 읽는 것과 같은 자리다. 전에는 데이터 화면의 문구를 빌려 썼고, 그래서 그 화면에 뜨지도
 * 않는 문장 셋이 `data.image.*`에 살고 있었다.
 *
 * **라벨 없는 사진을 따로 보이는 이유**는 그것이 학생이 다음에 할 일이기 때문이다.
 * 분류에서 그 사진들은 학습에 안 들어가는데, 요약이 "사진 200장"만 말하면 그중 80장이
 * 안 쓰이고 있다는 것을 아무 데서도 못 본다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { IMAGE_UNLABELED } from '@/project/format'
import { countByCategory, imageCategories, readImages } from '@/project/images'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

const photos = computed(() => readImages(project.file).length)
const categories = computed(() => imageCategories(project.file).length)
const unlabeled = computed(() => countByCategory(project.file).get(IMAGE_UNLABELED) ?? 0)
</script>

<template>
  <div class="flex justify-between gap-4">
    <dt class="font-bold text-ink-soft">{{ t('meta.image.photos') }}</dt>
    <dd class="tabular-nums">{{ t('meta.image.countUnit', photos) }}</dd>
  </div>

  <div class="flex justify-between gap-4">
    <dt class="font-bold text-ink-soft">{{ t('meta.image.categories') }}</dt>
    <dd class="tabular-nums">{{ t('meta.countUnit', categories) }}</dd>
  </div>

  <!-- 0장이면 안 보인다. 할 일이 없는 줄은 요약에 자리를 차지할 이유가 없다. -->
  <div v-if="unlabeled > 0" class="flex justify-between gap-4">
    <dt class="font-bold text-ink-soft">{{ t('meta.image.unlabeled') }}</dt>
    <dd class="tabular-nums">{{ t('meta.image.countUnit', unlabeled) }}</dd>
  </div>
</template>
