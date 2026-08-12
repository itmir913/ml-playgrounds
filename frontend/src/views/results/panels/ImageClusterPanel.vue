<script setup lang="ts">
/**
 * 이미지 군집 결과 — **묶인 사진을 그대로 보여준다** (open-decisions.md #28-8).
 *
 * **표 판(`ClusterResultPanel`)의 산점도 자리가 여기서는 사진 그리드다.** `v-if`가 아니라
 * 등록부 줄 하나로 갈린다 (`ml/metric-panels.ts`) — 이 파일은 자기가 이미지 전용이라는
 * 것을 모르고, "어떻게 그리는가"만 안다.
 *
 * **중심점을 표로 안 보여준다.** 1,280차원 벡터는 학생에게 아무 말도 못 한다. 대신
 * **중심에 가장 가까운 실제 사진**을 대표로 건다.
 *
 * **계산은 전부 `ml/image-clusters.ts`에 있다.** 여기 있는 것은 그리기뿐이다 (§8.3).
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import AppButton from '@/components/AppButton.vue'
import { IMAGE_GRID_PAGE_SIZE } from '@/limits'
import { backboneFor } from '@/ml/backbones'
import { imageClusterGroups } from '@/ml/image-clusters'
import { imageTrainingSource } from '@/ml/images'
import type { PanelInput } from '@/ml/metric-panels'
import { transform } from '@/ml/preprocess'
import { readEmbeddings } from '@/project/embeddings'
import { dataSnapshot } from '@/project/schema'
import { useProjectStore } from '@/stores/project'

const props = defineProps<{ input: PanelInput }>()

const { t } = useI18n()
const project = useProjectStore()

/**
 * 사진과 군집 배정.
 *
 * **백본은 그 실험의 것을 쓴다.** 학생이 그 뒤에 백본을 바꿨다면 그때의 임베딩으로
 * 그리는 것이 맞다 — 지금 것으로 그리면 결과 화면이 그 실험이 보지 않은 숫자를 보여준다.
 *
 * 하나라도 없으면 `null`이고, 그때 이 패널은 **아무것도 안 그린다**
 * (§9.2 "없는 것을 이름으로 말하지 않는다").
 */
const groups = computed(() => {
  const file = project.file
  if (!file) return null

  const { backboneId } = dataSnapshot('image', props.input.experiment.settings)
  const backbone = backboneFor(backboneId)
  const preprocessor = props.input.preprocessor
  if (!backbone || !preprocessor) return null

  const vectors = readEmbeddings(file, backboneId, backbone.embeddingDim)
  if (vectors.size === 0) return null

  // **학습에 쓴 것과 같은 표를 다시 짓는다** (`ml/images.ts`). 군집은 라벨을 안 보므로
  // 지금 있는 사진 전부가 대상이다.
  const source = imageTrainingSource(file, vectors, backbone, 'clustering')
  const rows = source.dataset.rows.map((_, index) => index)
  // 임베딩에는 범주형 열이 없어서 인코딩이 아무 일도 안 한다. 전처리기가 학습 때 정한
  // 것을 그대로 되쓰는 것이 핵심이고, 값 자체는 여기서 뜻을 갖지 않는다.
  const matrix = transform(preprocessor, source.dataset, rows, 'onehot')

  return imageClusterGroups(
    props.input.run.model?.format,
    props.input.modelBytes,
    matrix,
    source.hashes,
  )
})

/**
 * 해시 -> 썸네일 주소. **만든 자리와 놓아주는 자리를 함께 둔다** — 안 놓아주면 사진
 * 수백 장이 탭을 닫을 때까지 남는다 (`views/data/ImagePanel.vue`와 같은 규칙).
 */
const urls = ref(new Map<string, string>())

watch(
  () => project.file?.images,
  (images) => {
    for (const url of urls.value.values()) URL.revokeObjectURL(url)
    const next = new Map<string, string>()
    for (const [path, bytes] of images ?? []) {
      const name = path.slice(path.lastIndexOf('/') + 1)
      const hash = name.slice(0, name.lastIndexOf('.'))
      // `project/download.ts`가 같은 이유로 같은 모양이다 - 버퍼 타입이 공유일 수도
      // 있다고 보는 자리라 단언한다.
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'image/jpeg' })
      next.set(hash, URL.createObjectURL(blob))
    }
    urls.value = next
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  for (const url of urls.value.values()) URL.revokeObjectURL(url)
})

/**
 * 군집마다의 지금 쪽. **군집 하나가 200장일 수 있다** — 한 번에 다 그리면 그 군집
 * 하나가 화면을 덮어서 다른 군집을 보려면 스크롤해야 한다 (데이터 화면과 같은 규칙).
 */
const pages = ref(new Map<number, number>())

/** 배정이 다시 계산되면 쪽도 처음으로. 사진이 옮겨 갔는데 3쪽에 서 있으면 빈 격자다. */
watch(groups, () => {
  pages.value = new Map()
})

function pageOf(cluster: number): number {
  return pages.value.get(cluster) ?? 0
}

function totalPagesOf(count: number): number {
  return Math.max(1, Math.ceil(count / IMAGE_GRID_PAGE_SIZE))
}

function shownOf(group: { cluster: number; hashes: readonly string[] }): readonly string[] {
  const page = pageOf(group.cluster)
  return group.hashes.slice(page * IMAGE_GRID_PAGE_SIZE, (page + 1) * IMAGE_GRID_PAGE_SIZE)
}

function turn(cluster: number, step: number): void {
  const next = new Map(pages.value)
  next.set(cluster, pageOf(cluster) + step)
  pages.value = next
}
</script>

<template>
  <div v-if="groups" class="flex flex-col gap-4">
    <section v-for="group in groups" :key="group.cluster" class="flex flex-col gap-2">
      <header class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 class="font-bold text-ink">
          {{ t('results.clusterName', { cluster: group.cluster }) }}
        </h3>
        <AppBadge>{{ t('data.image.count', group.hashes.length) }}</AppBadge>
        <!--
          **대표 사진이 무엇인지 말한다.** 그냥 첫 칸에 두면 학생은 그것이 대표라는 것을
          모르고, 순서에 뜻이 있다는 것도 모른다.
        -->
        <span v-if="group.representative" class="text-ink-soft">
          {{ t('results.clusterRepresentative') }}
        </span>
      </header>

      <p v-if="group.hashes.length === 0" class="text-base text-ink-faint">
        {{ t('results.clusterEmpty') }}
      </p>

      <!--
        **중심에 가까운 순이다.** 앞엣것이 그 군집에서 가장 전형적인 사진이고, 학생이
        "이 군집은 무엇인가"를 볼 때 먼저 보는 것이 그것이어야 한다.
      -->
      <ul v-else class="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-10">
        <li v-for="(hash, index) in shownOf(group)" :key="hash">
          <img
            :src="urls.get(hash)"
            :alt="t('results.clusterName', { cluster: group.cluster })"
            loading="lazy"
            class="aspect-square w-full rounded-control bg-surface-sunken object-cover"
            :class="index === 0 && pageOf(group.cluster) === 0 ? 'ring-2 ring-brand' : ''"
          />
        </li>
      </ul>

      <!-- 쪽이 하나뿐이면 안 그린다. 아무 데도 못 가는 버튼은 고장으로 보인다. -->
      <div
        v-if="totalPagesOf(group.hashes.length) > 1"
        class="flex items-center justify-between gap-4"
      >
        <AppButton
          variant="secondary"
          :disabled="pageOf(group.cluster) === 0"
          @click="turn(group.cluster, -1)"
        >
          {{ t('common.prevPage') }}
        </AppButton>
        <p class="tabular-nums text-ink-soft">
          {{ pageOf(group.cluster) + 1 }} / {{ totalPagesOf(group.hashes.length) }}
        </p>
        <AppButton
          variant="secondary"
          :disabled="pageOf(group.cluster) >= totalPagesOf(group.hashes.length) - 1"
          @click="turn(group.cluster, 1)"
        >
          {{ t('common.nextPage') }}
        </AppButton>
      </div>
    </section>
  </div>
</template>
