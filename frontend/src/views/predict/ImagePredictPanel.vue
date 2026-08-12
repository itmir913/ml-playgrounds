<script setup lang="ts">
/**
 * **이미지 데이터**의 예측 작업 공간.
 *
 * **입력이 양자택일이 아니다** (open-decisions.md "이미지 예측 화면"). 표는 한 줄을 손으로
 * 채우거나 파일을 올리거나인데, 사진에는 "손으로 채우기"에 해당하는 것이 없다 —
 * **한 장은 여러 장의 특수한 경우**라 갈래가 안 생긴다. 그래서 라디오도 없고 "한 장 예측 /
 * 일괄 예측"이라는 낱말도 안 만든다.
 *
 * **답의 모양은 표와 같다** — 사진 하나가 표의 한 줄이고, 그 옆에 모델들의 답이 나란히
 * 선다 (`AnswerList`는 종류를 모른다).
 *
 * **예측은 학습과 같은 문을 지난다** — 사진 → 정본 → 임베딩 → 그 뒤는 표와 같다. 여기서
 * 하는 일은 그 문을 순서대로 여는 것뿐이고, 새로 만드는 계산이 없다.
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import { canonicalizeImages } from '@/data/image/client'
import { spawnCanonicalizeWorker } from '@/data/image/spawn'
import { IMAGE_ACCEPT, readImageFiles, readImageZip } from '@/data/image/upload'
import { isClientError } from '@/errors'
import { backboneFor } from '@/ml/backbones'
import { embedImages } from '@/ml/embed/client'
import { spawnEmbedWorker } from '@/ml/embed/spawn'
import { imageTrainingRows, imageTrainingSource, pendingEmbeddings } from '@/ml/images'
import { loadModel, loadModelProba, type LoadContext } from '@/ml/models'
import { predictableModels, type Answer, type PredictableModel } from '@/ml/predict'
import { parsePreprocessor, transform, type Preprocessor } from '@/ml/preprocess'
import { addEmbeddings, readEmbeddings } from '@/project/embeddings'
import { IMAGE_UNLABELED } from '@/project/format'
import { addImages, readImages } from '@/project/images'
import { dataSettings } from '@/project/schema'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'
import AnswerList from './AnswerList.vue'

const { t } = useI18n()
const project = useProjectStore()
const toasts = useToastStore()

const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
const predicting = ref(false)
/** 준비 진행. 백본을 받는 동안 화면이 할 말이 여기서 나온다. */
const progress = ref<{ completed: number; total: number } | null>(null)

/** 사진 해시 -> (run id -> 답). 사진 하나가 표의 한 줄이다. */
const answers = ref(new Map<string, Map<string, Answer>>())

const backbone = computed(() => {
  const file = project.file
  if (!file) return undefined
  return backboneFor(dataSettings('image', file.document.settings).backboneId)
})

/** 예측 자리에 앉은 사진들. 범주 폴더가 없는 한 겹이다 (mlpx-spec.md §1.2). */
const photos = computed(() => readImages(project.file, 'predict'))

const models = computed<readonly PredictableModel[]>(() => {
  const file = project.file
  // **사진이 곧 데이터다.** 참조형 모델이 실제로 학습 행을 되세울 수 있는지는 그때 본다 —
  // 못 세우면 그 모델의 답이 사유와 함께 실패한다.
  return file ? predictableModels(file.document, photos.value.length > 0) : []
})

/** **결과 화면의 세로줄과 같은 이름이어야** 학생이 같은 것을 같은 것으로 읽는다. */
const experimentNames = computed(() => {
  const names = new Map<string, string>()
  const experiments = project.file?.document.runs.experiments ?? []
  experiments.forEach((experiment, index) => {
    names.set(experiment.id, t('results.experimentName', { index: index + 1 }))
  })
  return names
})

/** 실험 id -> 전처리기. 못 읽으면 그 실험의 모델은 답을 못 낸다. */
const preprocessors = computed(() => {
  const found = new Map<string, Preprocessor>()
  const file = project.file
  if (!file) return found
  for (const experiment of file.document.runs.experiments) {
    const path = experiment.preprocessor?.path
    const bytes = path === undefined ? undefined : file.models.get(path)
    if (!bytes) continue
    try {
      found.set(experiment.id, parsePreprocessor(JSON.parse(new TextDecoder().decode(bytes))))
    } catch {
      // 남이 편집한 파일이다. 그 실험의 모델은 아래에서 사유와 함께 실패한다.
    }
  }
  return found
})

/** 사진을 받아 정본으로 굽고 예측 자리에 앉힌다. 데이터 화면과 같은 문이다. */
async function readPicked(files: readonly File[]): Promise<void> {
  const file = project.file
  const spec = backbone.value
  if (files.length === 0 || !file || !spec || busy.value) return

  busy.value = true
  try {
    const [only] = files
    const items =
      files.length === 1 && only && only.name.toLowerCase().endsWith('.zip')
        ? await readImageZip(new Uint8Array(await only.arrayBuffer()))
        : readImageFiles(files)

    progress.value = { completed: 0, total: items.length }
    const baked = await canonicalizeImages(
      items.map((item) => item.file),
      {
        createWorker: spawnCanonicalizeWorker,
        size: spec.canonicalSize,
        onProgress: (completed, total) => {
          progress.value = { completed, total }
        },
      },
    ).result

    const applied = addImages(
      file,
      // **라벨이 없다.** 답을 모르는 사진이라 범주에 넣을 수가 없다 (mlpx-spec.md §1.2).
      baked.images.map((image) => ({
        hash: image.hash,
        bytes: image.bytes,
        category: IMAGE_UNLABELED,
      })),
      { canonicalSize: spec.canonicalSize, now: new Date().toISOString(), role: 'predict' },
    )
    await project.save(applied.project)
    if (baked.skipped.length > 0) {
      toasts.push('caution', 'data.image.skipped', { count: baked.skipped.length })
    }
    // 사진이 바뀌면 답이 뜻을 잃는다.
    answers.value = new Map()
  } catch (error) {
    toasts.pushError(error)
  } finally {
    progress.value = null
    busy.value = false
  }
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  input.value = ''
  void readPicked(files)
}

/**
 * 예측한다. **없는 임베딩만 먼저 뽑는다** — 학습과 같은 규칙이다 (mlpx-spec.md §1.3).
 */
async function run(): Promise<void> {
  const file = project.file
  const spec = backbone.value
  if (!file || !spec || predicting.value) return

  predicting.value = true
  try {
    let current = file
    const known = readEmbeddings(current, spec.id, spec.embeddingDim)
    const pending = pendingEmbeddings(current, new Set(known.keys())).filter((entry) =>
      photos.value.some((photo) => photo.hash === entry.hash),
    )

    if (pending.length > 0) {
      progress.value = { completed: 0, total: pending.length }
      const { vectors, dim } = await embedImages(
        spec.id,
        pending.map((entry) => entry.bytes as Uint8Array<ArrayBuffer>),
        {
          createWorker: spawnEmbedWorker,
          onProgress: (completed, total) => {
            progress.value = { completed, total }
          },
        },
      ).result

      const fresh = new Map<string, Float32Array>()
      for (const [index, entry] of pending.entries()) {
        fresh.set(entry.hash, vectors.slice(index * dim, (index + 1) * dim))
      }
      for (const [hash, vector] of fresh) known.set(hash, vector)
      current = addEmbeddings(current, spec.id, fresh)
      await project.save(current)
    }
    progress.value = null

    // 예측할 사진들의 표. 학습과 같은 함수가 짓는다 — 좌표계가 갈릴 자리가 없다.
    const table = {
      columns: imageTrainingSource(current, known, spec, 'clustering').dataset.columns,
      rows: photos.value.map((photo) =>
        Array.from(known.get(photo.hash) ?? new Float32Array(spec.embeddingDim), String),
      ),
    }

    const next = new Map<string, Map<string, Answer>>()
    const contexts = new Map<string, LoadContext>()

    for (const [index, photo] of photos.value.entries()) {
      const perRun = new Map<string, Answer>()
      for (const entry of models.value) {
        if (entry.reason) continue
        const preprocessor = preprocessors.value.get(entry.experiment.id)
        const path = entry.run.model?.path
        const bytes = path === undefined ? undefined : current.models.get(path)
        if (!preprocessor || !bytes) continue

        try {
          const payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown
          let context = contexts.get(entry.experiment.id)
          if (context === undefined) {
            const rows = imageTrainingRows(
              current,
              entry.experiment,
              preprocessor,
              spec,
              known,
              entry.experiment.settings.taskType,
            )
            context = rows ? { trainingRows: rows } : {}
            contexts.set(entry.experiment.id, context)
          }

          const vector = transform(preprocessor, table, [index], 'onehot')[0] ?? []
          const value = loadModel(payload, context)([vector])[0]
          // **확률을 내는 모델만 확률이 있다** (mlpx-spec.md §5.4). 라벨은 위에서 이미
          // 나왔다 — **확률로 다시 구하지 않는다.** 포화 구간에서 둘이 갈린다.
          const proba = loadModelProba(payload, context)
          const row = proba?.predict([vector])[0]
          if (value !== undefined) {
            perRun.set(entry.run.id, {
              value,
              ...(proba && row ? { probabilities: { classes: proba.classes, values: row } } : {}),
            })
          }
        } catch (error) {
          perRun.set(entry.run.id, {
            failure: isClientError(error)
              ? { code: error.code, params: error.params }
              : { code: 'UNEXPECTED_ERROR', params: {} },
          })
        }
      }
      next.set(photo.hash, perRun)
    }
    answers.value = next
  } catch (error) {
    toasts.pushError(error)
  } finally {
    progress.value = null
    predicting.value = false
  }
}

/** 해시 -> 썸네일 주소. 만든 자리와 놓아주는 자리를 함께 둔다. */
const urls = ref(new Map<string, string>())

watch(
  photos,
  (current) => {
    const alive = new Set(current.map((entry) => entry.hash))
    const next = new Map<string, string>()
    for (const [hash, url] of urls.value) {
      if (alive.has(hash)) next.set(hash, url)
      else URL.revokeObjectURL(url)
    }
    for (const entry of current) {
      if (next.has(entry.hash)) continue
      const blob = new Blob([entry.bytes as unknown as BlobPart], { type: 'image/jpeg' })
      next.set(entry.hash, URL.createObjectURL(blob))
    }
    urls.value = next
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  for (const url of urls.value.values()) URL.revokeObjectURL(url)
})

const canPredict = computed(
  () => photos.value.length > 0 && models.value.some((model) => !model.reason) && !busy.value,
)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-5">
    <div class="flex flex-wrap items-center gap-3">
      <AppButton variant="secondary" :disabled="busy" @click="fileInput?.click()">
        {{ t('predict.image.add') }}
      </AppButton>
      <span v-if="progress" class="tabular-nums font-bold" role="status">
        {{ t('train.preparingPhotos', { done: progress.completed, total: progress.total }) }}
      </span>
      <AppButton class="ml-auto" :disabled="!canPredict" :action="run">
        {{ t('predict.run') }}
      </AppButton>
    </div>

    <div v-if="photos.length === 0" class="grid min-h-0 flex-1 place-items-center">
      <AppEmpty :reason="t('predict.image.emptyReason')" :next="t('predict.image.emptyNext')">
        <AppButton size="lg" :disabled="busy" @click="fileInput?.click()">
          {{ t('predict.image.add') }}
        </AppButton>
      </AppEmpty>
    </div>

    <!--
      **사진 하나가 표의 한 줄이다** (open-decisions.md "이미지 예측 화면"). 왼쪽 붙박이
      자리에 값 대신 사진이 뜨고, 오른쪽에 모델들의 답이 나란히 선다.
    -->
    <ul v-else class="flex flex-col gap-3">
      <li
        v-for="photo in photos"
        :key="photo.hash"
        class="flex flex-col gap-3 rounded-panel border border-line bg-surface p-4 md:flex-row"
      >
        <img
          :src="urls.get(photo.hash)"
          :alt="t('predict.image.photo')"
          loading="lazy"
          class="aspect-square w-32 shrink-0 rounded-control bg-surface-sunken object-cover"
        />
        <div class="min-w-0 flex-1">
          <AnswerList
            :models="models"
            :answers="answers.get(photo.hash) ?? new Map()"
            :experiment-names="experimentNames"
          />
        </div>
      </li>
    </ul>

    <input
      ref="fileInput"
      type="file"
      multiple
      :accept="IMAGE_ACCEPT"
      class="hidden"
      @change="onPick"
    />
  </div>
</template>
