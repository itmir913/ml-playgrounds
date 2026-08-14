<script setup lang="ts">
/**
 * 군집 답의 증거 — **그 군집의 대표 사진 아홉 장** (open-decisions.md "군집 답의 증거는
 * 팝오버가 갖는다").
 *
 * **`3번 군집`은 그 자체로 아무 말도 안 한다.** 표에서 산점도와 이웃이 답하던 자리를
 * 여기서는 사진이 답한다 — 이미지에서는 그 질문에 직접 답할 수 있다 (#28-8).
 *
 * **자기가 이미지 전용이라는 것을 모른다.** 등록부가 골라 부른다
 * (`ml/answer-evidence.ts`) — 이 파일은 "어떻게 그리는가"만 안다.
 *
 * **계산은 전부 `ml/image-clusters.ts`에 있다.** 대표를 고르는 규칙(중심에 가까운 순)도
 * 거기가 갖는다 — 여기서 다시 정렬하면 결과 화면의 격자와 순서가 갈린다.
 *
 * **열었을 때만 돈다.** 팝오버 안에서 지연 로딩되므로, 답 카드 스무 장이 서 있어도
 * 학생이 누른 그 군집의 사진만 디코딩된다.
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { canonicalFormatOfPath } from '@/data/image/formats'
import { CLUSTER_REPRESENTATIVE_COUNT } from '@/limits'
import type { AnswerEvidenceInput } from '@/ml/answer-evidence'
import { backboneFor } from '@/ml/backbones'
import { imageClusterGroups } from '@/ml/image-clusters'
import { imageTrainingSource } from '@/ml/images'
import { parsePreprocessor, transform } from '@/ml/preprocess'
import { readEmbeddings } from '@/project/embeddings'
import { dataSnapshot } from '@/project/schema'
import { useProjectStore } from '@/stores/project'

const props = defineProps<{ input: AnswerEvidenceInput }>()

const { t } = useI18n()
const project = useProjectStore()

/** 이 실험의 전처리기. 학습 때 정한 것을 그대로 되써야 좌표계가 안 갈린다. */
const preprocessor = computed(() => {
  const file = project.file
  const path = props.input.experiment.preprocessor?.path
  const bytes = path === undefined ? undefined : file?.models.get(path)
  if (!bytes) return null
  try {
    return parsePreprocessor(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    // 남이 편집한 파일이다. 재료가 없으면 아무것도 안 그린다 (§9.2).
    return null
  }
})

/**
 * 이 답이 가리키는 군집의 사진들. **앞엣것이 중심에 가장 가깝다** (`imageClusterGroups`).
 *
 * 하나라도 없으면 빈 배열이고, 그때 이 증거는 아무것도 안 그린다 — 이유를 이름으로
 * 말하지 않는다 (§9.2). 여는 단추 자체는 `hasData`가 이미 걸렀다.
 */
const representatives = computed<readonly string[]>(() => {
  const file = project.file
  const parsed = preprocessor.value
  if (!file || !parsed) return []

  const { backboneId } = dataSnapshot('image', props.input.experiment.settings)
  const backbone = backboneFor(backboneId)
  if (!backbone) return []

  const vectors = readEmbeddings(file, backboneId, backbone.embeddingDim)
  if (vectors.size === 0) return []

  // **학습에 쓴 것과 같은 표를 다시 짓는다** (`ImageClusterPanel`과 같은 문이다).
  const source = imageTrainingSource(file, vectors, backbone, 'clustering')
  const rows = source.dataset.rows.map((_, index) => index)
  const matrix = transform(parsed, source.dataset, rows, 'onehot')

  const path = props.input.run.model?.path
  const groups = imageClusterGroups(
    props.input.run.model?.format,
    path === undefined ? undefined : file.models.get(path),
    matrix,
    source.hashes,
  )

  const group = groups?.find((entry) => entry.cluster === props.input.value)
  return group ? group.hashes.slice(0, CLUSTER_REPRESENTATIVE_COUNT) : []
})

/**
 * 해시 -> 썸네일 주소. **만든 자리와 놓아주는 자리를 함께 둔다** — 안 놓아주면 팝오버를
 * 열 때마다 아홉 장이 탭을 닫을 때까지 쌓인다.
 */
const urls = ref(new Map<string, string>())

watch(
  representatives,
  (hashes) => {
    for (const url of urls.value.values()) URL.revokeObjectURL(url)
    const next = new Map<string, string>()
    const wanted = new Set(hashes)
    for (const [path, bytes] of project.file?.images ?? []) {
      const name = path.slice(path.lastIndexOf('/') + 1)
      // **형식은 확장자가 갖는다** (mlpx-spec.md §1.2). 객체 URL은 Blob의 타입이 그대로
      // 그 자원의 MIME이 된다.
      const format = canonicalFormatOfPath(path)
      if (!format) continue
      const hash = name.slice(0, name.length - format.extension.length)
      if (!wanted.has(hash)) continue
      // 버퍼 타입이 공유일 수도 있다고 보는 자리라 단언한다 (`project/download.ts`).
      const blob = new Blob([bytes as unknown as BlobPart], { type: format.mime })
      next.set(hash, URL.createObjectURL(blob))
    }
    urls.value = next
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  for (const url of urls.value.values()) URL.revokeObjectURL(url)
})
</script>

<template>
  <div v-if="representatives.length > 0" class="flex h-full flex-col gap-2">
    <h5 class="font-bold text-ink">
      {{
        t('predict.clusterEvidenceTitle', {
          name: t('results.clusterName', { index: props.input.value }),
        })
      }}
    </h5>
    <p class="text-ink-soft">{{ t('predict.clusterEvidenceNote') }}</p>

    <!--
      **3열 격자다.** 정본이 정사각형이라 상자와 맞물린다 (`popover-panel-square`).
      열 수를 상수로 빼지 않는 이유는 이것이 장수가 아니라 **이 상자의 모양**이기
      때문이다 (`limits.ts`의 `CLUSTER_REPRESENTATIVE_COUNT` 주석).
    -->
    <ul class="grid min-h-0 flex-1 grid-cols-3 gap-1.5 overflow-y-auto">
      <li v-for="hash in representatives" :key="hash">
        <img
          :src="urls.get(hash)"
          :alt="t('predict.image.photo')"
          loading="lazy"
          class="aspect-square w-full rounded-control object-cover"
        />
      </li>
    </ul>
  </div>
</template>
