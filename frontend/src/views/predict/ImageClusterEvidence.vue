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
 *
 * **먼저 서고, 그다음 찾는다** (2026-08-14, 사용자). 배정을 되계산하는 것은 사진 수백
 * 장짜리 행렬을 훑는 일이라, 계산을 마친 뒤에 열면 **누른 것이 안 먹은 것처럼 보인다.**
 * 상자를 먼저 세우고 "찾는 중"을 보여준 뒤에 계산한다 (`screen.ts`의 `yieldToScreen`).
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
import { yieldToScreen } from '@/screen'
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
function findRepresentatives(): readonly string[] {
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
}

const representatives = ref<readonly string[]>([])
/** 아직 찾는 중인가. **상자가 먼저 서고 이 문구가 그 자리를 지킨다.** */
const loading = ref(true)

watch(
  () => [project.file, props.input.run.id, props.input.value] as const,
  async () => {
    loading.value = true
    // **여기서 비켜 주는 것이 이 화면의 전부다.** 안 비키면 팝오버가 계산이 끝난 뒤에야
    // 그려지고, 학생에게는 누른 것이 늦게 먹은 것으로 보인다.
    await yieldToScreen()
    representatives.value = findRepresentatives()
    loading.value = false
  },
  { immediate: true },
)

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
  <!--
    **찾는 동안에도 제목과 설명은 서 있다.** 상자가 통째로 비었다가 채워지면 그 순간
    안의 것이 튀어 오른다 — 팝오버를 쓴 이유가 화면이 안 움직이게 하는 것이었다.
  -->
  <div v-if="loading || representatives.length > 0" class="flex flex-col gap-2">
    <h5 class="font-bold text-ink">
      {{
        t('predict.clusterEvidenceTitle', {
          name: t('results.clusterName', { index: props.input.value }),
        })
      }}
    </h5>
    <p class="text-ink-soft">{{ t('predict.clusterEvidenceNote') }}</p>

    <p v-if="loading" class="text-ink-faint">{{ t('predict.clusterEvidenceLoading') }}</p>

    <!--
      **3열 격자다.** 정본이 정사각형이라 격자도 정사각형이 되고, 상자는 그 위에 제목과
      설명이 얹힌 만큼만 길어진다 (`popover-panel-photos`). 열 수를 상수로 빼지 않는
      이유는 이것이 장수가 아니라 **격자의 모양**이기 때문이다
      (`limits.ts`의 `CLUSTER_REPRESENTATIVE_COUNT` 주석).
    -->
    <ul v-else class="grid grid-cols-3 gap-1.5">
      <li v-for="hash in representatives" :key="hash">
        <img
          :src="urls.get(hash)"
          :alt="t('results.image.trainingPhoto')"
          loading="lazy"
          class="aspect-square w-full rounded-control object-cover"
        />
      </li>
    </ul>
  </div>
</template>
