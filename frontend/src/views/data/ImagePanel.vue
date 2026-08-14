<script setup lang="ts">
/**
 * **이미지 데이터**의 작업 공간. 사진을 받고, 무엇이 들어왔는지 확인시키고, 정본으로
 * 굽고, 범주에 앉힌다. 표의 `TabularPanel.vue`에 해당한다.
 *
 * **범주가 주인공이다.** 표에서 표가 화면을 다 쓰는 것과 같은 자리이고, 여기서는
 * 범주 칸들이 세로로 늘어선다 — 학생이 하는 일이 "이 사진을 어느 칸에 넣을까"라서다.
 *
 * **유형(분류·군집)을 여기서 묻지 않는다** (open-decisions.md "이미지 프로젝트의 데이터
 * 화면"). 라벨을 붙이는 자리가 여기이고, 유형은 학습 화면에서 고른다 — 업로드에서 못
 * 박으면 군집으로 시작한 학생이 분류로 갈 때 사진을 다시 올려야 한다.
 *
 * **읽기·굽기·앉히기는 전부 이 파일 밖에 있다** — 꾸러미를 읽는 것은
 * `data/image/upload.ts`, 굽는 것은 워커(`data/image/client.ts`), 프로젝트에 앉히는 것은
 * `project/images.ts`다. 여기 있는 것은 순서와 화면뿐이다.
 */

import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { dataKindFor, stepTextKey } from '@/data/kinds'

import AppBadge from '@/components/AppBadge.vue'
import AppButton from '@/components/AppButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import AppField from '@/components/AppField.vue'
import StepActionBar from '@/components/StepActionBar.vue'
import StepChecklist from '@/components/StepChecklist.vue'
import StepHeader from '@/components/StepHeader.vue'
import { isValidCategoryName } from '@/data/image/canonical'
import { canonicalizeImages, type CanonicalizeHandle } from '@/data/image/client'
import { spawnCanonicalizeWorker } from '@/data/image/spawn'
import { readImageFiles, readImageZip, summarizeUpload, type UploadItem } from '@/data/image/upload'
import { ClientError } from '@/errors'
import { MAX_CATEGORY_NAME_LENGTH } from '@/limits'
import { backboneFor } from '@/ml/backbones'
import { IMAGE_UNLABELED } from '@/project/format'
import {
  addCategory,
  addImages,
  countByCategory,
  hashesBetween,
  imageCategories,
  moveImages,
  readImages,
  removeCategory,
  removeImages,
  renameCategory,
} from '@/project/images'
import { dataSettings } from '@/project/schema'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'
import ImageGrid from './ImageGrid.vue'

defineProps<{ accept: string }>()

const { t } = useI18n()

/**
 * 이 단계의 설명문. **등록부가 준다** (architecture.md §8.10) — `steps.data.purpose`를
 * 직접 읽으면 표를 두고 쓴 문장("어떤 열이 있는지")이 이미지 화면에도 뜬다.
 */
const dataPurpose = stepTextKey(dataKindFor('image'), 'data', 'purpose')
const project = useProjectStore()
const toasts = useToastStore()

const fileInput = ref<HTMLInputElement | null>(null)
const folderInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const busy = ref(false)

/**
 * 다음에 고를 사진이 들어갈 칸. **파일 고르기 입구가 하나여서 필요하다** — 칸마다 숨은
 * `<input>`을 두면 범주 수만큼 늘고, 그 중 하나만 값을 안 비워도 같은 파일을 다시 못
 * 고르는 칸이 생긴다.
 */
const target = ref<string>(IMAGE_UNLABELED)

/** 읽었지만 아직 안 구운 것. **확인시키기 전에는 프로젝트를 손대지 않는다.** */
const pending = ref<readonly UploadItem[] | null>(null)
/** 굽는 중의 진행. 백분율은 화면이 만든다. */
const progress = ref<{ completed: number; total: number } | null>(null)
/** 돌고 있는 굽기. **취소 버튼이 이걸 부른다** — 화면을 떠날 때도 여기서 끊는다. */
const running = ref<CanonicalizeHandle | null>(null)

/** 골라 둔 사진들. 옮기기·지우기의 대상이다. */
const selected = ref(new Set<string>())

/**
 * shift+클릭이 어디서부터 셀지. **선택 집합과 같은 자리에 둔다** — 사진이 지워지거나
 * 다른 범주로 옮겨지면 함께 정리해야 하고(아래 `watch`), 그 정리가 두 군데로 갈리면
 * 없어진 사진을 기준으로 **조용히 엉뚱한 범위**가 나온다.
 *
 * 범주를 함께 든다. 범위는 같은 카드 안에서만이다 (open-decisions.md).
 */
const anchor = ref<{ category: string; hash: string } | null>(null)

const naming = ref<{ mode: 'create' | 'rename'; from: string; value: string } | null>(null)
const removingCategory = ref<string | null>(null)
const deleting = ref(false)

const entries = computed(() => readImages(project.file))
const categories = computed(() => imageCategories(project.file))
const counts = computed(() => countByCategory(project.file))
const unlabeled = computed(() => entries.value.filter((one) => one.category === IMAGE_UNLABELED))

function entriesOf(category: string) {
  return entries.value.filter((one) => one.category === category)
}

/**
 * 해시 -> 썸네일 주소.
 *
 * **놓아주지 않으면 사진 수백 장이 탭을 닫을 때까지 남는다.** 그래서 만든 자리와
 * 놓아주는 자리를 한 곳에 둔다 — 격자 안에서 만들면 범주를 옮길 때마다 새로 생기고,
 * 없어진 것을 아무도 모른다.
 */
const urls = ref(new Map<string, string>())

watch(
  entries,
  (current) => {
    const alive = new Set(current.map((one) => one.hash))
    const next = new Map<string, string>()
    for (const [hash, url] of urls.value) {
      if (alive.has(hash)) next.set(hash, url)
      else URL.revokeObjectURL(url)
    }
    for (const entry of current) {
      if (next.has(entry.hash)) continue
      // `Uint8Array`의 버퍼 타입이 `SharedArrayBuffer`일 수도 있다고 보는 자리라
      // 단언한다 (`project/download.ts`가 같은 이유로 같은 모양이다).
      const blob = new Blob([entry.bytes as unknown as BlobPart], { type: 'image/jpeg' })
      next.set(entry.hash, URL.createObjectURL(blob))
    }
    urls.value = next
    // 없어진 사진이 고른 채로 남으면 "3장 옮기기"가 거짓말이 된다.
    selected.value = new Set([...selected.value].filter((hash) => alive.has(hash)))
    if (anchor.value && !alive.has(anchor.value.hash)) anchor.value = null
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  for (const url of urls.value.values()) URL.revokeObjectURL(url)
  running.value?.cancel()
})

/** 굽기 전에 보여줄 요약. **중첩 흡수가 조용히 틀릴 수 있는 유일한 자리다.** */
const summary = computed(() => (pending.value ? summarizeUpload(pending.value) : []))

function labelOf(category: string): string {
  return category === IMAGE_UNLABELED ? t('meta.image.unlabeled') : category
}

/** 꾸러미인가 사진인가. **학생에게 묻지 않는다** — 확장자가 이미 답을 갖고 있다. */
async function readPicked(files: readonly File[], into: string): Promise<void> {
  if (files.length === 0) return
  busy.value = true
  try {
    const [only] = files
    // **구조가 있으면 구조가 이긴다.** 폴더나 zip이 라벨을 들고 있으면 그것이 답이고,
    // `into`는 구조가 없는 사진이 떨어질 자리다 (open-decisions.md "zip 읽기 규칙 다섯").
    const items =
      files.length === 1 && only && only.name.toLowerCase().endsWith('.zip')
        ? await readImageZip(new Uint8Array(await only.arrayBuffer()), into)
        : readImageFiles(files, into)
    pending.value = items
  } catch (error) {
    toasts.pushError(error)
  } finally {
    busy.value = false
  }
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement
  const files = [...(input.files ?? [])]
  // 같은 것을 다시 고를 수 있어야 한다. 값을 비우지 않으면 change가 다시 안 뜬다.
  input.value = ''
  void readPicked(files, target.value)
}

/** 어느 칸에 넣을지 정하고 파일 고르기를 연다. */
function pickInto(category: string, input: HTMLInputElement | null): void {
  target.value = category
  input?.click()
}

/** 판 전체에 떨어뜨린 것. **어느 칸도 아니므로 라벨이 없다.** */
function onDrop(event: DragEvent): void {
  dragging.value = false
  void readPicked([...(event.dataTransfer?.files ?? [])], IMAGE_UNLABELED)
}

/**
 * 확인한 것을 굽는다. **정본 크기는 백본이 정한다** — 224로 구운 정본은 260을 요구하는
 * 백본에 못 가므로, 그 값이 파일에도 함께 적힌다.
 */
async function bake(): Promise<void> {
  const items = pending.value
  const file = project.file
  if (!items || !file || busy.value) return

  const backboneId = dataSettings('image', file.document.settings).backboneId
  const backbone = backboneFor(backboneId)
  if (!backbone) {
    toasts.pushError(new ClientError('BACKBONE_UNAVAILABLE'))
    return
  }

  busy.value = true
  progress.value = { completed: 0, total: items.length }
  const byPath = new Map(items.map((item) => [item.path, item.category]))
  const handle = canonicalizeImages(
    items.map((item) => item.file),
    {
      createWorker: spawnCanonicalizeWorker,
      size: backbone.canonicalSize,
      onProgress: (completed, total) => {
        progress.value = { completed, total }
      },
    },
  )
  running.value = handle

  try {
    const result = await handle.result
    const applied = addImages(
      file,
      // 워커는 이름으로만 대답한다. 그 이름이 곧 꾸러미 안의 경로라 범주를 되찾을 수 있다.
      result.images.map((image) => ({
        hash: image.hash,
        bytes: image.bytes,
        category: byPath.get(image.sourceName) ?? IMAGE_UNLABELED,
      })),
      { canonicalSize: backbone.canonicalSize, now: new Date().toISOString() },
    )
    await project.save(applied.project)
    pending.value = null

    toasts.push('success', 'data.image.added', { count: applied.added })
    // **조용히 넘기지 않는다.** 40장을 올렸는데 12장만 늘어난 것을 학생은 고장으로 본다.
    if (applied.duplicates > 0) {
      toasts.push('info', 'data.image.duplicates', { count: applied.duplicates })
    }
    if (result.skipped.length > 0) {
      toasts.push('caution', 'data.image.skipped', { count: result.skipped.length })
    }
  } catch (error) {
    // 취소도 여기로 온다. 학생이 누른 것이므로 실패로 말하지 않는다.
    if (error instanceof ClientError && error.code === 'JOB_CANCELLED') pending.value = null
    else toasts.pushError(error)
  } finally {
    running.value = null
    progress.value = null
    busy.value = false
  }
}

async function save(next: ReturnType<typeof moveImages>): Promise<void> {
  busy.value = true
  try {
    await project.save(next)
  } catch (error) {
    toasts.pushError(error)
  } finally {
    busy.value = false
  }
}

/**
 * 한 장을 고르거나 풀고, shift를 함께 눌렀으면 **기준점부터 여기까지 전부 고른다.**
 *
 * **더하기만 한다** (open-decisions.md) — 갈아치우면 앞서 고른 것이 말없이 사라지는데
 * 되돌릴 단추가 없다. 기준점이 다른 카드에 있거나 없으면 보통 클릭으로 친다.
 */
function toggle(category: string, hash: string, extend: boolean): void {
  const from = anchor.value
  const next = new Set(selected.value)

  if (extend && from && from.category === category) {
    const range = hashesBetween(entriesOf(category), from.hash, hash)
    // 범위가 비면(기준점이 그새 사라졌다) 보통 클릭으로 떨어진다.
    if (range.length > 0) {
      for (const one of range) next.add(one)
      selected.value = next
      return
    }
  }

  if (!next.delete(hash)) next.add(hash)
  selected.value = next
  anchor.value = { category, hash }
}

function pickAll(category: string): void {
  const next = new Set(selected.value)
  const all = entriesOf(category)
  const everyPicked = all.every((entry) => next.has(entry.hash))
  for (const entry of all) {
    if (everyPicked) next.delete(entry.hash)
    else next.add(entry.hash)
  }
  selected.value = next
}

async function moveSelected(to: string): Promise<void> {
  const file = project.file
  if (!file || selected.value.size === 0) return
  await save(moveImages(file, [...selected.value], to, new Date().toISOString()))
  selected.value = new Set()
}

async function deleteSelected(): Promise<void> {
  const file = project.file
  if (!file) return
  await save(removeImages(file, [...selected.value], new Date().toISOString()))
  selected.value = new Set()
  deleting.value = false
}

/** 만들기와 이름 바꾸기가 같은 창이다 — 묻는 것이 이름 하나로 같다. */
const nameTaken = computed(() => {
  const draft = naming.value
  if (!draft) return false
  const trimmed = draft.value.trim()
  return trimmed !== draft.from && categories.value.includes(trimmed)
})

/**
 * 이름을 확정할 수 있는가. **템플릿에서 조건을 조립하지 않는다** (architecture.md §10) —
 * 조건이 하나 늘 때 고칠 자리가 늘고, 회색 버튼은 이유 없이는 고장으로 보인다.
 * 여기서는 이유를 창 안의 문장(`nameTaken`)과 힌트가 대신 말한다.
 */
const canName = computed(() => {
  const draft = naming.value
  if (draft === null || busy.value) return false
  return isValidCategoryName(draft.value.trim()) && !nameTaken.value
})

async function commitName(): Promise<void> {
  const draft = naming.value
  const file = project.file
  if (!draft || !file || !canName.value) return
  const name = draft.value.trim()
  await save(
    draft.mode === 'create'
      ? addCategory(file, name, new Date().toISOString())
      : renameCategory(file, draft.from, name, new Date().toISOString()),
  )
  naming.value = null
}

async function commitRemoveCategory(): Promise<void> {
  const file = project.file
  const name = removingCategory.value
  if (!file || name === null) return
  await save(removeCategory(file, name, new Date().toISOString()))
  removingCategory.value = null
}
</script>

<template>
  <div
    class="flex min-h-full flex-col gap-5 p-4 sm:p-5"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <StepHeader :title="t('steps.data.label')" :purpose="t(dataPurpose)">
      <template #context>
        <template v-if="entries.length > 0">
          <div class="flex items-baseline gap-1.5">
            <dt>
              <AppBadge>{{ t('meta.image.photos') }}</AppBadge>
            </dt>
            <dd class="font-bold tabular-nums text-ink">
              {{ t('meta.image.countUnit', entries.length) }}
            </dd>
          </div>
          <div class="flex items-baseline gap-1.5">
            <dt>
              <AppBadge>{{ t('meta.image.categories') }}</AppBadge>
            </dt>
            <dd class="font-bold tabular-nums text-ink">
              {{ t('meta.countUnit', categories.length) }}
            </dd>
          </div>
        </template>
      </template>
    </StepHeader>

    <StepChecklist step="data" />

    <!--
      **전체에 걸리는 동작은 위에 붙어 따라온다** (§8.13.1 "동작 바는 화면들이 함께
      쓴다"). 표 경로·학습·예측과 같은 컴포넌트다.

      **동작 셋이 여기 모인다** (§8.9). 머리에 있던 [사진 추가]가 내려와, 범주 카드의
      [여기에 사진 추가](그 범주로 들어간다)와 자리로 구별된다. 빈 상태와 같은 순서,
      같은 색이다 — 사진이 생겼다고 파란 버튼이 다른 것으로 옮겨 가면 학생은 화면이
      바뀐 줄 안다.

      **굽기 전에는 바가 읽은 결과를 든다** (open-decisions.md "zip 읽기 규칙 다섯").
      감싼 겹을 벗기는 판정은 구조만으로 답이 없는 자리이고, 이 줄이 그것을 시끄럽게
      만든다 — 표 경로가 시트와 머리글을 바에서 확인시키는 것과 같다.

      **아무것도 없을 때는 안 뜬다.** 그때 동작의 유일한 출처는 화면 가운데 빈 상태다.
    -->
    <StepActionBar v-if="pending || entries.length > 0 || categories.length > 0">
      <template v-if="pending">
        <span class="font-bold">{{ t('data.image.readTitle', pending.length) }}</span>
        <ul class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <li v-for="one in summary" :key="one.category" class="flex items-baseline gap-1.5">
            <span class="max-w-40 truncate font-bold text-ink-soft">
              {{ labelOf(one.category) }}
            </span>
            <!--
              **여기서 세는 것은 사진이 아니라 파일이다** — 굽기 전이라 사진인지 아직
              모른다(`data/image/upload.ts`). 그래서 `{count}장`이 아니라 `{count}개`다.
            -->
            <span class="tabular-nums">{{ t('meta.countUnit', one.count) }}</span>
          </li>
        </ul>
      </template>

      <template v-else>
        <AppButton @click="naming = { mode: 'create', from: '', value: '' }">
          {{ t('data.image.newCategory') }}
        </AppButton>
        <AppButton
          variant="secondary"
          :disabled="busy"
          @click="pickInto(IMAGE_UNLABELED, fileInput)"
        >
          {{ t('data.image.add') }}
        </AppButton>
        <AppButton
          variant="secondary"
          :disabled="busy"
          @click="pickInto(IMAGE_UNLABELED, folderInput)"
        >
          {{ t('data.image.addFolder') }}
        </AppButton>
      </template>

      <template #end>
        <template v-if="pending">
          <span v-if="progress" class="tabular-nums text-ink-soft">
            {{ t('meta.image.preparing', { done: progress.completed, total: progress.total }) }}
          </span>
          <AppButton variant="secondary" @click="progress ? running?.cancel() : (pending = null)">
            {{ t('common.cancel') }}
          </AppButton>
          <AppButton :disabled="busy" :action="bake">{{ t('data.image.use') }}</AppButton>
        </template>
      </template>
    </StepActionBar>

    <div
      v-if="entries.length === 0 && categories.length === 0"
      class="grid min-h-96 flex-1 place-items-center rounded-panel border-2 border-dashed transition-colors"
      :class="dragging ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface'"
    >
      <!--
        **첫 동작이 [범주 만들기]다** (open-decisions.md "범주를 먼저 만들고 그 칸에
        올린다"). 드롭존만 보이면 화면이 "일단 올려라"라고 말하는 셈인데, 학생이 하려는
        일은 "개와 고양이를 구분하는 것"이고 그건 범주를 세우는 데서 시작한다.

        사진 올리기를 없애지는 않는다 — 폴더나 zip이 이미 라벨을 들고 있는 경우가 있고,
        군집만 하려는 학생에게는 범주가 아예 필요 없다.
      -->
      <AppEmpty :reason="t('data.image.emptyReason')" :next="t('data.image.emptyNext')">
        <div class="flex flex-wrap justify-center gap-2">
          <AppButton size="lg" @click="naming = { mode: 'create', from: '', value: '' }">
            {{ t('data.image.newCategory') }}
          </AppButton>
          <AppButton
            size="lg"
            variant="secondary"
            :disabled="busy"
            @click="pickInto(IMAGE_UNLABELED, fileInput)"
          >
            {{ t('data.image.add') }}
          </AppButton>
          <AppButton
            size="lg"
            variant="secondary"
            :disabled="busy"
            @click="pickInto(IMAGE_UNLABELED, folderInput)"
          >
            {{ t('data.image.addFolder') }}
          </AppButton>
        </div>
      </AppEmpty>
    </div>

    <div v-else class="flex flex-1 flex-col gap-3">
      <!--
        **넓은 화면에서는 범주 칸이 두 줄로 선다** (architecture.md §8.10.1 "넓은 화면은
        세로로 늘리지 않는다"). 한 줄로 쌓으면 범주 셋만 있어도 아래 것을 보려고
        스크롤해야 하고, 사진을 옮기는 일은 **두 칸을 함께 보는 일**이다.

        **`items-start`가 있어야 한다.** 없으면 같은 행의 칸이 서로 높이를 맞추느라
        사진 세 장짜리 범주가 서른 장짜리만큼 늘어난다.

        **격자다.** 신문처럼 흘리면(`columns`) 읽는 차례가 세로가 되어 학생이 정렬해 둔
        범주 순서와 어긋난다 — 순서를 파일에 남기는 이유가 그것이다.
      -->
      <div class="grid items-start gap-3 lg:grid-cols-2">
        <ImageGrid
          v-for="category in categories"
          :key="category"
          :label="category"
          :entries="entriesOf(category)"
          :urls="urls"
          :selected="selected"
          @toggle="(hash, extend) => toggle(category, hash, extend)"
          @pick-all="pickAll(category)"
          @rename="naming = { mode: 'rename', from: category, value: category }"
          @remove="removingCategory = category"
          @add="pickInto(category, fileInput)"
          @drop="readPicked($event, category)"
        />
      </div>

      <!--
        **범주가 아니라 상태다** (open-decisions.md). 그래서 맨 아래에 따로 서고 이름
        바꾸기·없애기가 없다. 사진이 하나도 없으면 아예 안 그린다 — 라벨을 다 붙인
        학생에게 빈 칸이 남아 있을 이유가 없다.
      -->
      <ImageGrid
        v-if="(counts.get(IMAGE_UNLABELED) ?? 0) > 0"
        :label="t('meta.image.unlabeled')"
        :entries="unlabeled"
        :urls="urls"
        :selected="selected"
        unlabeled
        @toggle="(hash, extend) => toggle(IMAGE_UNLABELED, hash, extend)"
        @pick-all="pickAll(IMAGE_UNLABELED)"
        @add="pickInto(IMAGE_UNLABELED, fileInput)"
        @drop="readPicked($event, IMAGE_UNLABELED)"
      />
    </div>

    <!--
      **고른 것에 대한 조작은 한 줄에 모은다.** 범주마다 버튼을 두면 "어느 범주로
      옮길까"가 범주 수만큼의 버튼이 된다.

      **판의 맨 아래이고 `sticky`다.** 위쪽에 두면 나타날 때 아래 내용을 밀어내서 보고
      있던 자리가 흔들린다 — 흔들림을 만드는 것은 등장이 아니라 **흐름에 끼어드는
      것**이다. 흐름의 끝에 있으면 나타나도 페이지 끝이 늘어날 뿐이고, 스크롤 중에는
      아래에 붙어 따라오다가 끝까지 내리면 제자리로 돌아가 **마지막 사진 줄을 안 가린다.**

      **`fixed`가 아니다.** `AppShell`의 상태 표시줄이 `<main>` 밖에 따로 있어서
      `fixed`로 붙이면 그 위에 겹친다.
    -->
    <div
      v-if="selected.size > 0"
      class="sticky z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-panel border border-line-strong bg-surface px-4 py-2.5 shadow-card stick-above-shell"
    >
      <span class="font-bold">{{ t('data.image.selected', selected.size) }}</span>
      <label class="flex items-center gap-2">
        <span class="font-bold text-ink-soft">{{ t('data.image.moveTo') }}</span>
        <select
          class="rounded-field border border-line-strong bg-surface px-2 py-1"
          :disabled="busy"
          @change="moveSelected(($event.target as HTMLSelectElement).value)"
        >
          <!-- 고른 것이 아니라 명령이다. 고른 상태로 남으면 다시 누를 수 없다. -->
          <option value="" selected disabled>{{ t('data.image.pickCategory') }}</option>
          <option v-for="category in categories" :key="category" :value="category">
            {{ category }}
          </option>
          <option :value="IMAGE_UNLABELED">{{ t('meta.image.unlabeled') }}</option>
        </select>
      </label>

      <div class="ml-auto flex gap-2">
        <AppButton variant="secondary" @click="selected = new Set()">
          {{ t('common.clearAll') }}
        </AppButton>
        <AppButton variant="danger" :disabled="busy" @click="deleting = true">
          {{ t('data.image.deletePhotos') }}
        </AppButton>
      </div>
    </div>

    <input ref="fileInput" type="file" multiple :accept="accept" class="hidden" @change="onPick" />
    <!--
      **폴더째 고르는 입구를 따로 둔다.** 같은 input에 `webkitdirectory`를 걸면 파일
      몇 장만 고르는 길이 없어진다. `accept`를 안 주는 이유는 폴더 고르기에서는 브라우저가
      그걸 무시하고, 대신 사진이 아닌 파일은 굽는 워커가 걸러 준다.
    -->
    <input ref="folderInput" type="file" webkitdirectory class="hidden" @change="onPick" />

    <AppDialog
      :open="naming !== null"
      :title="naming?.mode === 'rename' ? t('data.image.renameTitle') : t('data.image.createTitle')"
      :description="t('data.image.nameDescription')"
      @close="naming = null"
    >
      <form v-if="naming" class="flex flex-col gap-3" @submit.prevent="commitName">
        <AppField :label="t('data.image.categoryName')" :hint="t('data.image.nameHint')">
          <template #default="field">
            <input
              v-bind="field"
              v-model="naming.value"
              type="text"
              :maxlength="MAX_CATEGORY_NAME_LENGTH"
              autofocus
              class="w-full rounded-field border border-line-strong bg-surface px-3 py-2.5"
            />
          </template>
        </AppField>
        <p v-if="nameTaken" role="status" class="text-caution">
          {{ t('data.image.nameTaken') }}
        </p>
      </form>

      <template #actions>
        <AppButton variant="secondary" @click="naming = null">{{ t('common.cancel') }}</AppButton>
        <!--
          **버튼이 자기가 할 일을 이름으로 말한다** — 이 저장소의 대화상자 규칙이다
          (`지우고 바꾸기`·`범주 없애기`). 창 하나가 둘을 겸하므로 제목과 같은 조건으로
          고른다.
        -->
        <AppButton :disabled="!canName" :action="commitName">
          {{
            t(naming?.mode === 'rename' ? 'data.image.renameConfirm' : 'data.image.createConfirm')
          }}
        </AppButton>
      </template>
    </AppDialog>

    <AppDialog
      :open="removingCategory !== null"
      :title="t('data.image.removeCategoryTitle')"
      :description="t('data.image.removeCategoryDescription', { name: removingCategory ?? '' })"
      @close="removingCategory = null"
    >
      <template #actions>
        <AppButton variant="secondary" @click="removingCategory = null">
          {{ t('common.cancel') }}
        </AppButton>
        <AppButton variant="danger" :disabled="busy" :action="commitRemoveCategory">
          {{ t('data.image.removeCategory') }}
        </AppButton>
      </template>
    </AppDialog>

    <AppDialog
      :open="deleting"
      :title="t('data.image.deleteTitle')"
      :description="t('data.image.deleteDescription', selected.size)"
      @close="deleting = false"
    >
      <template #actions>
        <AppButton variant="secondary" @click="deleting = false">{{
          t('common.cancel')
        }}</AppButton>
        <AppButton variant="danger" :disabled="busy" :action="deleteSelected">
          {{ t('data.image.deletePhotos') }}
        </AppButton>
      </template>
    </AppDialog>
  </div>
</template>
