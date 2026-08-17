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
import AppDialog from '@/components/AppDialog.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import StepActionBar from '@/components/StepActionBar.vue'
import { canonicalizeImages } from '@/data/image/client'
import { spawnCanonicalizeWorker } from '@/data/image/spawn'
import { IMAGE_ACCEPT, readImageFiles, readImageZip } from '@/data/image/upload'
import { ClientError, isClientError } from '@/errors'
import { backboneFor } from '@/ml/backbones'
import { embedImages } from '@/ml/embed/client'
import { spawnEmbedWorker } from '@/ml/embed/spawn'
import { imagePredictTable, imageTrainingRows, pendingEmbeddings } from '@/ml/images'
import { loadModel, loadModelProba, type LoadContext } from '@/ml/models'
import {
  applyPredictFilter,
  defaultFilter,
  predictableModels,
  toggleAllFilter,
  toggleFilter,
  type Answer,
  type FilterAxisId,
  type PredictableModel,
  rankAnswersAcross,
  showsClusterNames,
  type PredictFilter,
} from '@/ml/predict'
import { parsePreprocessor, transform, type Preprocessor } from '@/ml/preprocess'
import { addEmbeddings, readEmbeddings } from '@/project/embeddings'
import { IMAGE_PREDICT_PAGE_SIZE } from '@/limits'
import { IMAGE_UNLABELED } from '@/project/format'
import { addImages, imageOverflow, readImages, removeImages } from '@/project/images'
import { dataSettings } from '@/project/schema'
import { yieldToScreen } from '@/screen'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'
import AnswerList from './AnswerList.vue'
import PredictFilters, { type FilterAxis, type FilterOption } from './PredictFilters.vue'

const { t } = useI18n()
const project = useProjectStore()
const toasts = useToastStore()

const fileInput = ref<HTMLInputElement | null>(null)
const busy = ref(false)
/** 사진을 끌고 판 위에 있는가. 빈 자리의 점선이 이걸 보고 색을 바꾼다. */
const dragging = ref(false)
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

/**
 * 지금 쪽. **끊는 이유가 화면이 아니라 계산이다** — 답 하나가 `사진 수 × 모델 수`이고
 * 임베딩도 그만큼 뽑는다 (`limits.ts`의 `IMAGE_PREDICT_PAGE_SIZE`).
 */
const page = ref(0)

const totalPages = computed(() =>
  Math.max(1, Math.ceil(photos.value.length / IMAGE_PREDICT_PAGE_SIZE)),
)

/** 사진이 줄면 지금 쪽이 빈 쪽이 될 수 있다. 그때 빈 화면을 보이면 다 사라진 줄 안다. */
watch(totalPages, (count) => {
  if (page.value > count - 1) page.value = count - 1
})

/** 이 쪽에 세울 사진들. **뽑는 것도 예측하는 것도 이만큼이다.** */
const shown = computed(() =>
  photos.value.slice(
    page.value * IMAGE_PREDICT_PAGE_SIZE,
    (page.value + 1) * IMAGE_PREDICT_PAGE_SIZE,
  ),
)

/**
 * 한 번이라도 [예측]을 눌렀는가. **쪽을 넘길 때 자동으로 이어 도는 근거다** —
 * 안 누른 학생에게 백본 12.4MB를 받게 하지 않으면서, 누른 뒤에는 쪽마다 다시 누르게
 * 하지 않는다.
 */
const predicted = ref(false)

/**
 * 넘길 수 있는가. **템플릿에서 조건을 조립하지 않는다** (architecture.md §10) —
 * 도는 중에 넘기면 답이 이 쪽 것인지 저 쪽 것인지 알 수 없다. `BatchPredict`가 같은
 * 이름으로 같은 일을 한다.
 */
const atFirstPage = computed(() => predicting.value || page.value === 0)
const atLastPage = computed(() => predicting.value || page.value >= totalPages.value - 1)

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

/**
 * 필터 — 실험 × 알고리즘의 다중 선택이다 (architecture.md §8.13.1 "답을 거르고 세어
 * 본다"). **표와 같은 것이 같은 모양으로 있어야 한다** — 종류를 바꿨다고 화면의 문법이
 * 달라지면 학생은 같은 도구를 두 번 배운다.
 *
 * **여기서는 거르는 것이 화면 정리에 그치지 않는다.** 답 하나가 `사진 수 × 모델 수`라,
 * 모델을 반으로 줄이면 도는 계산도 반이 된다 — 쪽 나누기와 같은 이유의 장치다.
 */
const filter = ref<PredictFilter>({ experimentIds: new Set(), algorithms: new Set() })

/** 지금 있는 실험·알고리즘의 집합. 이게 바뀔 때만 필터를 다시 연다. */
const availableIds = computed(() => {
  const experiments = [...new Set(models.value.map((entry) => entry.experiment.id))].sort()
  const algorithms = [...new Set(models.value.map((entry) => entry.run.algorithm))].sort()
  return `${experiments.join(',')}|${algorithms.join(',')}`
})

watch(
  availableIds,
  () => {
    filter.value = defaultFilter(models.value)
  },
  { immediate: true },
)

const experimentOptions = computed<FilterOption[]>(() => {
  const seen = new Set<string>()
  const list: FilterOption[] = []
  for (const entry of models.value) {
    if (seen.has(entry.experiment.id)) continue
    seen.add(entry.experiment.id)
    list.push({
      id: entry.experiment.id,
      label: experimentNames.value.get(entry.experiment.id) ?? entry.experiment.id,
    })
  }
  return list
})

const algorithmOptions = computed<FilterOption[]>(() => {
  const seen = new Set<string>()
  const list: FilterOption[] = []
  for (const entry of models.value) {
    if (seen.has(entry.run.algorithm)) continue
    seen.add(entry.run.algorithm)
    list.push({ id: entry.run.algorithm, label: t(`algorithms.${entry.run.algorithm}`) })
  }
  return list
})

/** 필터를 지난 모델. 사유가 있는 카드도 포함한다 — 꺼진 이유는 필터와 별개다. */
const visible = computed(() => applyPredictFilter(models.value, filter.value))

/**
 * `값 -> 등수`. **사진 전부를 모아 한 번 매긴다** (architecture.md §8.13.1).
 *
 * 사진마다 매기면 `몰루 1개 · 0 1개`처럼 동점일 때 정렬이 뒤집혀 **같은 답이 사진마다
 * 다른 색**을 받는다. 화면에서 실제로 그렇게 났다.
 *
 * **쪽에 보이는 것만이 아니라 지금 올린 사진 전부를 본다** — 쪽을 넘길 때마다 색이
 * 바뀌면 방금 본 카드를 못 찾는다.
 */
const ranks = computed(() => rankAnswersAcross(visible.value, answers.value.values()))
const visibleUsable = computed(() => visible.value.filter((entry) => entry.reason === undefined))

/**
 * 필터를 바꾸면 지금까지의 답을 지운다 (표와 같다). 안 지우면 방금 켠 모델만 빈 채로
 * 남아, 사진마다 답이 있는 칸과 없는 칸이 섞인다.
 *
 * **임베딩은 안 지운다.** 그건 사진에서 나온 것이라 어느 모델을 보든 같다 — 필터를
 * 껐다 켰다 한다고 백본을 다시 돌릴 이유가 없다.
 */
function toggle(axis: FilterAxisId, id: string): void {
  filter.value = toggleFilter(filter.value, axis, id)
  answers.value = new Map()
}

function toggleAll(axis: FilterAxisId): void {
  const found = axes.value.find((one) => one.id === axis)
  filter.value = toggleAllFilter(
    filter.value,
    axis,
    (found?.options ?? []).map((option) => option.id),
  )
  answers.value = new Map()
}

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

    // **굽기 전에 막는다** (project/images.ts의 imageOverflow). 백본을 돌린 뒤에
    // 거절하면 학생은 기다린 시간을 통째로 버린다.
    const overflow = imageOverflow(file, items.length, 'predict')
    if (overflow) throw new ClientError('IMAGE_TOO_MANY_PHOTOS', { ...overflow })

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
      {
        canonicalSize: spec.canonicalSize,
        now: new Date().toISOString(),
        role: 'predict',
        format: baked.format,
      },
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

/** 판에 떨어뜨린 것. **고르기와 같은 문으로 보낸다** — zip이든 사진이든 거기서 갈린다. */
function onDrop(event: DragEvent): void {
  dragging.value = false
  void readPicked([...(event.dataTransfer?.files ?? [])])
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
    // **무엇을 하기 전에 한 번 양보한다** (`screen.ts`). 임베딩이 이미 있으면 아래가
    // 통째로 동기라, 여기서 안 비켜 주면 **단추가 한 번도 꺼진 적 없는 채로** 계산이
    // 끝나고 그동안 쌓인 클릭이 전부 다시 돈다 — 연타하면 화면이 먹통이 된다.
    await yieldToScreen()

    let current = file
    const known = readEmbeddings(current, spec.id, spec.embeddingDim)
    // **이 쪽의 사진만이다.** 200장을 한 번에 뽑으면 학생이 보지도 않을 사진 때문에
    // 기다린다 (limits.ts의 `IMAGE_PREDICT_PAGE_SIZE`).
    const wanted = new Set(shown.value.map((photo) => photo.hash))
    const pending = pendingEmbeddings(current, new Set(known.keys()), 'predict').filter((entry) =>
      wanted.has(entry.hash),
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

    // 예측할 사진들의 표. 학습과 같은 열 이름을 쓴다 — 좌표계가 갈릴 자리가 없다.
    // **벡터가 없는 사진은 답을 안 낸다** — `table.missing`이 그것을 들고 있다.
    const table = imagePredictTable(photos.value, known, spec)

    // **이미 낸 답은 그대로 둔다.** 쪽을 되돌아갔을 때 다시 계산하지 않는다.
    const next = new Map(answers.value)
    const contexts = new Map<string, LoadContext>()

    for (const [index, photo] of photos.value.entries()) {
      if (!wanted.has(photo.hash)) continue
      // 벡터가 없으면 답을 내지 않는다. 0으로 메우면 모든 사진이 같은 답을 받는다.
      if (table.missing.has(photo.hash)) continue
      const perRun = new Map<string, Answer>()
      // **필터를 지난 것만 돈다.** 안 보이는 모델을 돌리면 사진 수만큼의 계산이 화면에
      // 뜨지도 않을 답을 위해 늘어난다.
      for (const entry of visibleUsable.value) {
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
      // 사진 하나가 끝날 때마다 보여주고 비켜 준다 — 표 화면과 같은 규칙이다.
      // 답 하나가 `사진 수 × 모델 수`라, 안 비켜 주면 그 곱만큼 화면이 멎는다.
      answers.value = new Map(next)
      await yieldToScreen()
    }
    predicted.value = true
  } catch (error) {
    toasts.pushError(error)
  } finally {
    progress.value = null
    predicting.value = false
  }
}

/** 예측 사진을 전부 지울지 묻는 중. */
const clearing = ref(false)

/** 사진이 나가면 그 답도 뜻을 잃는다. 남겨 두면 없는 사진의 답이 화면에 남는다. */
async function drop(hashes: readonly string[]): Promise<void> {
  const file = project.file
  if (!file || hashes.length === 0) return
  busy.value = true
  try {
    await project.save(removeImages(file, hashes, new Date().toISOString(), 'predict'))
    const next = new Map(answers.value)
    for (const hash of hashes) next.delete(hash)
    answers.value = next
  } catch (error) {
    toasts.pushError(error)
  } finally {
    busy.value = false
    clearing.value = false
  }
}

/**
 * 한 장 빼기. **약속을 그대로 돌려준다** — `@click`으로 흘려보내면 `AppButton`이 기다릴
 * 것이 없어 두 번 눌리는 것을 못 막는다 (CLAUDE.md §4).
 */
function removeOne(hash: string): Promise<void> {
  return drop([hash])
}

function clearAll(): Promise<void> {
  return drop(photos.value.map((photo) => photo.hash))
}

/**
 * 쪽을 넘기면 그 쪽을 이어서 돌린다. **한 번 누른 뒤에는 쪽마다 다시 누르게 하지
 * 않는다** — 학생이 하려는 일은 "이 사진들의 답 보기"이지 쪽 넘기기가 아니다.
 */
watch(page, () => {
  const missing = shown.value.some((photo) => !answers.value.has(photo.hash))
  if (predicted.value && missing) void run()
})

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
      const blob = new Blob([entry.bytes as unknown as BlobPart], { type: entry.format.mime })
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
  () => photos.value.length > 0 && visibleUsable.value.length > 0 && !busy.value,
)

/**
 * 필터 칸을 보이는가. 각 축이 둘 이상일 때만 그 축을 그리는 판정은 `PredictFilters`가
 * 한다 — 여기는 "거를 모델이 있는가"만 본다.
 */
const showFilters = computed(() => models.value.length > 0)

/** 필터에 그릴 축. 표 경로와 같은 배열이다 — 두 경로가 같은 필터를 쓴다. */
const axes = computed<FilterAxis[]>(() => [
  { id: 'experiment', label: t('predict.filterExperiments'), options: experimentOptions.value },
  { id: 'algorithm', label: t('predict.filterAlgorithms'), options: algorithmOptions.value },
])

/** 셈은 스크립트에서 만든다 (`TabularPredictPanel`과 같은 이유). */
const filterCount = computed(() =>
  t('predict.filterCount', { shown: visible.value.length, total: models.value.length }),
)

/**
 * **필터가 전부 걸러 냈다.** 모델이 없는 것과는 다른 사유다 — 이유 없이 빈 화면이
 * 되면 학생은 사진이 사라진 줄 안다.
 */
const filteredOut = computed(() => models.value.length > 0 && visible.value.length === 0)

/** 아무 사진도 안 그리는 동안에는 쪽 넘기기도 뜻이 없다. */
const showPages = computed(() => totalPages.value > 1 && !filteredOut.value)
</script>

<template>
  <!--
    **떨어뜨려서 올릴 수 있다** — 데이터 화면과 같은 문이다(`ImagePanel`). 여기만 단추로
    고르게 하면 같은 일이 화면마다 다른 몸짓이 된다. 판 전체가 받는 이유도 거기와 같다:
    떨어뜨릴 자리가 빈 상자 안으로 좁혀져 있으면 학생이 그 상자를 겨눠야 한다.
  -->
  <div
    class="flex min-h-0 flex-1 flex-col gap-5"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <!--
      **`ImagePanel`의 선택 줄과 방향만 다르다.** 거기는 나타났다 사라지는 줄이라 흐름
      끝(`bottom-0`)이어야 했고, 여기는 늘 있는 줄이라 흐름 맨 앞에 그대로 둔 채 위에
      붙인다 — 나타나며 아래를 밀어내는 일이 없다.

      **진행 표시가 바 안에 서는 이유**는 짧기 때문이다. 긴 문장은 바를 두 줄로 만든다
      (`StepActionBar` 주석).
    -->
    <StepActionBar>
      <AppButton variant="secondary" :disabled="busy" @click="fileInput?.click()">
        {{ t('predict.image.add') }}
      </AppButton>
      <span v-if="progress" class="tabular-nums font-bold" role="status">
        {{ t('meta.image.preparing', { done: progress.completed, total: progress.total }) }}
      </span>
      <!--
        **초기화 경로가 있어야 한다.** 잘못 올린 사진을 빼는 길이 없으면 학생이 할 수
        있는 일이 프로젝트를 새로 만드는 것뿐이다.
      -->
      <AppButton
        v-if="photos.length > 0"
        variant="secondary"
        :disabled="busy"
        @click="clearing = true"
      >
        {{ t('predict.image.clear') }}
      </AppButton>

      <template #end>
        <AppButton :disabled="!canPredict" :action="run">
          {{ t('predict.run') }}
          <template #pending>{{ t('predict.running') }}</template>
        </AppButton>
      </template>
    </StepActionBar>

    <!--
      **빈 자리가 곧 드롭존이다** (`ImagePanel`의 첫 화면과 같은 모양). 점선과 끌고 왔을
      때의 색이 "여기에 놓아도 된다"를 말한다 — 단추만 있으면 끌어다 놓아도 되는지를
      학생이 시험해 봐야 안다.
    -->
    <div
      v-if="photos.length === 0"
      class="grid min-h-0 flex-1 place-items-center rounded-panel border-2 border-dashed transition-colors"
      :class="dragging ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface'"
    >
      <AppEmpty :reason="t('predict.image.emptyReason')" :next="t('predict.image.emptyNext')">
        <AppButton size="lg" :disabled="busy" @click="fileInput?.click()">
          {{ t('predict.image.add') }}
        </AppButton>
      </AppEmpty>
    </div>

    <!--
      **표와 같은 필터다.** 각 축이 둘 이상일 때만 그 축이 그려진다(`PredictFilters` 안에서
      판정한다) - 실험이 하나뿐인데 거를 것을 보이면 아무것도 안 하는 버튼이 된다.
    -->
    <PredictFilters
      v-else-if="showFilters"
      :axes="axes"
      :filter="filter"
      :count="filterCount"
      :disabled="predicting"
      @toggle="toggle"
      @toggle-all="toggleAll"
    />

    <!--
      **군집 번호의 뜻은 답을 읽기 전에 말한다** (open-decisions.md "머리글은 목록 밖에
      선다"). 서로 다른 학습의 `2번 군집`은 같은 군집이 아닌데, 그걸 모르고 보면
      **화면의 모든 비교가 틀린 비교가 된다** — 조용한 오독이라 스스로 못 알아챈다.

      **필터 바로 아래인 이유는 이 문장이 "지금 보이는 모델들"에 대한 주석이기
      때문이다.** 군집 모델을 걸러 낸 학생에게는 할 말이 없고, **사진이 하나도 없으면
      답이 설 자리가 없어서** 역시 할 말이 없다 — 빈 화면 아래에 주의색 한 줄만 남으면
      학생은 자기가 뭘 잘못한 줄 안다.
    -->
    <p v-if="showsClusterNames(visible, photos.length > 0)" class="font-bold text-caution">
      {{ t('predict.clusterAnswerNote') }}
    </p>

    <div v-if="filteredOut" class="grid min-h-0 flex-1 place-items-center">
      <AppEmpty :reason="t('predict.filterEmptyReason')" :next="t('predict.filterEmptyNext')" />
    </div>

    <!--
      **사진 하나가 표의 한 줄이다** (open-decisions.md "이미지 예측 화면"). 왼쪽 붙박이
      자리에 값 대신 사진이 뜨고, 오른쪽에 모델들의 답이 나란히 선다.
    -->
    <!--
      **사진 줄은 카드가 아니라 구분선으로 나눈다** (open-decisions.md "머리글은 목록
      밖에 선다"). 머리글이 빠진 뒤 이 줄에 남는 것은 사진과 모델 카드뿐인데, 그때
      바깥 카드는 아무것도 안 담은 채 테두리만 두르는 상자가 된다 — **화면에서 카드는
      모델 카드 하나여야** 갈림 색이 유일한 신호가 되어 눈이 답으로 간다.
    -->
    <ul v-else-if="photos.length > 0" class="flex flex-col">
      <li
        v-for="(photo, index) in shown"
        :key="photo.hash"
        class="flex flex-col gap-3 py-5 md:flex-row"
        :class="index > 0 ? 'border-t border-line' : ''"
      >
        <!--
          **좁은 화면에서는 사진과 [빼기]가 한 줄이다.** 축이 뒤집히면 같은 속성의 뜻도
          뒤집힌다 — `flex-col`에서는 마지막 자식이 맨 **아래**이고 `self-start`가
          **왼쪽**이라, 묶지 않으면 버튼이 왼쪽 하단으로 떨어진다.

          **`md:contents`로 넓은 화면에서는 이 줄이 사라진다.** 그러면 사진과 버튼이 다시
          `<li>`의 직계가 되어 가로로 서는데, DOM 차례가 사진 → 빼기 → 답이므로
          **`md:order-last`가 함께 있어야** 버튼이 맨 오른쪽에 선다.
        -->
        <div class="flex items-start justify-between gap-3 md:contents">
          <!--
            **`self-start`가 없으면 비율이 깨진다.** flex 행의 기본은 `stretch`라 답이 길어
            행이 높아지면 사진이 그만큼 늘어나고, `aspect-square`가 그걸 못 막는다 —
            늘어나는 것은 높이이고 비율은 그 뒤에 계산된다.
          -->
          <img
            :src="urls.get(photo.hash)"
            :alt="t('predict.image.photo')"
            loading="lazy"
            class="aspect-square w-32 shrink-0 self-start rounded-control bg-surface-sunken object-cover"
          />

          <!--
            **한 장 빼기는 확인창을 안 거친다.** 예측 사진은 답을 얻으려고 올린 입력이고
            다시 올리면 그만이다 — 훈련 사진을 지우는 것과 무게가 다르다. 대신 전부
            지우기는 묻는다.
          -->
          <AppButton
            variant="ghost"
            class="self-start md:order-last"
            :disabled="busy"
            :action="() => removeOne(photo.hash)"
          >
            {{ t('predict.image.remove') }}
          </AppButton>
        </div>

        <div class="min-w-0 flex-1">
          <AnswerList
            data-type="image"
            :models="visible"
            :answers="answers.get(photo.hash) ?? new Map()"
            :experiment-names="experimentNames"
            :ranks="ranks"
            :waiting="t('predict.image.waiting')"
          />
        </div>
      </li>
    </ul>

    <!-- 쪽이 하나뿐이면 안 그린다. 아무 데도 못 가는 버튼은 고장으로 보인다. -->
    <div v-if="showPages" class="flex items-center justify-between gap-4">
      <AppButton variant="secondary" :disabled="atFirstPage" @click="page -= 1">
        {{ t('common.prevPage') }}
      </AppButton>
      <p class="tabular-nums text-ink-soft">{{ page + 1 }} / {{ totalPages }}</p>
      <AppButton variant="secondary" :disabled="atLastPage" @click="page += 1">
        {{ t('common.nextPage') }}
      </AppButton>
    </div>

    <AppDialog
      :open="clearing"
      :title="t('predict.image.clearTitle')"
      :description="t('predict.image.clearDescription', photos.length)"
      @close="clearing = false"
    >
      <template #actions>
        <AppButton variant="secondary" @click="clearing = false">{{
          t('common.cancel')
        }}</AppButton>
        <AppButton variant="danger" :disabled="busy" :action="clearAll">
          {{ t('predict.image.clear') }}
        </AppButton>
      </template>
    </AppDialog>

    <!--
      **파일에 안 남는다는 사실을 말한다** (mlpx-spec.md §0). 표 화면에만 있고 여기엔
      없었다 — 사진을 올리는 화면이라 오히려 여기서 더 궁금한 말이다.
    -->

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
