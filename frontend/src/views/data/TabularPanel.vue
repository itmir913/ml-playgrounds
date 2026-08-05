<script setup lang="ts">
/**
 * **표 데이터**의 작업 공간. 파일을 올리고, 시트를 고르고, 미리 보고, 정본으로 확정한다.
 *
 * 데이터 종류마다 이런 판이 하나씩 있고 `data/kinds.ts`가 고른다. 이미지·음성이
 * 들어오는 V5에서 여기를 고치는 것이 아니라 **옆에 새 판을 하나 더 만든다**
 * (architecture.md §6).
 *
 * **표가 주인공이다** (architecture.md §8.9). 카드를 쌓지 않는다 — 열이 수십 개인 표를
 * 카드 안에 가두면 가로 스크롤 상자 안에서만 볼 수 있게 된다. 순서는 표 > 데이터 정보 >
 * 열 검사기이고, 검사기는 필요할 때만 나오는 보조 영역이다.
 *
 * **판단은 전부 이 파일 밖에 있다** — 파싱과 인코딩 판정은 `data/`, 열 이름과 요약은
 * `data/columns.ts`, 프로젝트에 붙이는 것은 `project/dataset.ts`다.
 *
 * **확정 버튼을 누르기 전까지 프로젝트를 손대지 않는다.** 파일을 잘못 골랐을 때
 * 되돌릴 것이 없어야 한다.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import AppTable from '@/components/AppTable.vue'
import StepChecklist from '@/components/StepChecklist.vue'
import StepHeader from '@/components/StepHeader.vue'
import { summarizeColumns, toDataset, type ColumnSummary } from '@/data/columns'
import { parseCsvText } from '@/data/csv'
import { importTable, openTable, previewTable, type TableDocument } from '@/data/table'
import { PREVIEW_ROW_COUNT } from '@/limits'
import { applyDataset } from '@/project/dataset'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'

defineProps<{ accept: string }>()

const { t } = useI18n()
const project = useProjectStore()
const toasts = useToastStore()

const fileInput = ref<HTMLInputElement | null>(null)
const dragging = ref(false)
const busy = ref(false)

/** 아직 확정하지 않은 파일. 확정하면 비운다. */
const opened = ref<{ document: TableDocument; fileName: string } | null>(null)
const sheetName = ref<string | undefined>(undefined)
const hasHeader = ref(true)
const confirming = ref(false)
/** 열 검사기에서 펼쳐 놓은 열. 보조 영역이라 기본은 닫혀 있다. */
const inspecting = ref(false)

const batchCount = computed(() => project.file?.document.runs.batches.length ?? 0)

const previewRows = computed(() => {
  const document = opened.value?.document
  if (!document) return []
  const sheets = previewTable(document)
  return sheets.find((sheet) => sheet.sheetName === sheetName.value)?.rows ?? sheets[0]?.rows ?? []
})

/** 확정된 데이터. 정본은 언제나 UTF-8 CSV라 인코딩을 판정할 필요가 없다. */
const saved = computed(() => {
  const file = project.file
  const reference = file?.document.settings.dataset
  if (!file?.dataset || !reference) return null
  const grid = parseCsvText(new TextDecoder().decode(file.dataset.bytes))
  const dataset = toDataset(grid, reference.hasHeader)
  return { reference, dataset, columns: summarizeColumns(dataset) }
})

/** 지금 화면에 그릴 표. 파일을 고르는 중이면 그쪽이 이긴다. */
const shown = computed(() => {
  if (opened.value) {
    const dataset = toDataset(previewRows.value, hasHeader.value)
    return { dataset, columns: summarizeColumns(dataset), draft: true }
  }
  if (saved.value) {
    // 저장된 표는 앞부분만 보여준다. 5천 줄을 DOM에 그리면 교실 PC가 멈춘다.
    const { dataset, columns } = saved.value
    return {
      dataset: { columns: dataset.columns, rows: dataset.rows.slice(0, PREVIEW_ROW_COUNT) },
      columns,
      draft: false,
    }
  }
  return null
})

async function readFile(file: File): Promise<void> {
  busy.value = true
  try {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const document = await openTable(bytes, file.name)
    opened.value = { document, fileName: file.name }
    sheetName.value = document.sheetNames[0]
    hasHeader.value = true
  } catch (error) {
    toasts.pushError(error)
  } finally {
    busy.value = false
  }
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 같은 파일을 다시 고를 수 있어야 한다. 값을 비우지 않으면 change가 다시 안 뜬다.
  input.value = ''
  if (file) void readFile(file)
}

function onDrop(event: DragEvent): void {
  dragging.value = false
  const file = event.dataTransfer?.files[0]
  if (file) void readFile(file)
}

/** 확정 요청. 지울 묶음이 있으면 먼저 물어본다 (mlpx-spec.md §4.3). */
function requestApply(): void {
  if (batchCount.value > 0) {
    confirming.value = true
    return
  }
  void apply()
}

async function apply(): Promise<void> {
  const source = opened.value
  const file = project.file
  if (!source || !file || busy.value) return

  busy.value = true
  try {
    const imported = importTable(source.document, sheetName.value)
    const applied = applyDataset(file, imported, {
      fileName: source.fileName,
      hasHeader: hasHeader.value,
      now: new Date().toISOString(),
    })
    await project.save(applied.project)

    confirming.value = false
    opened.value = null
    toasts.push('success', 'data.applied')
    if (applied.droppedColumns.length > 0) {
      // 조용히 사라지면 학생은 자기가 고른 열이 빠진 줄 모른다.
      toasts.push('caution', 'data.droppedColumns', { names: applied.droppedColumns.join(', ') })
    }
  } catch (error) {
    toasts.pushError(error)
  } finally {
    busy.value = false
  }
}

function kindOf(column: ColumnSummary): string {
  return t(`columnKind.${column.kind}`)
}
</script>

<template>
  <div
    class="flex h-full flex-col gap-4 p-4 sm:p-5"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <StepHeader :title="t('steps.data.label')" :purpose="t('steps.data.purpose')">
      <template #context>
        <template v-if="saved">
          <div class="flex gap-1.5">
            <dt class="sr-only">{{ t('data.fileName') }}</dt>
            <dd class="max-w-56 truncate font-bold text-ink">
              {{ saved.reference.originalFileName }}
            </dd>
          </div>
          <div class="flex gap-1.5">
            <dt>{{ t('data.rows') }}</dt>
            <dd class="tabular-nums">{{ saved.dataset.rows.length }}</dd>
          </div>
          <div class="flex gap-1.5">
            <dt>{{ t('data.columns') }}</dt>
            <dd class="tabular-nums">{{ saved.columns.length }}</dd>
          </div>
          <div class="flex gap-1.5">
            <dt>{{ t('data.encoding') }}</dt>
            <dd>{{ saved.reference.sourceEncoding ?? saved.reference.encoding }}</dd>
          </div>
        </template>
        <AppButton variant="secondary" :disabled="busy" @click="fileInput?.click()">
          {{ saved ? t('data.change') : t('data.choose') }}
        </AppButton>
      </template>
    </StepHeader>

    <StepChecklist step="data" />

    <!-- 고르는 중일 때의 조작 줄. 확정 전에만 있다. -->
    <div
      v-if="opened"
      class="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-panel border border-brand-line bg-brand-soft px-4 py-2.5"
    >
      <span class="max-w-64 truncate text-base font-bold">{{ opened.fileName }}</span>

      <label v-if="opened.document.sheetNames.length > 1" class="flex items-center gap-2 text-base">
        <span class="font-bold text-ink-soft">{{ t('data.sheet') }}</span>
        <select
          v-model="sheetName"
          class="rounded-field border border-line-strong bg-surface px-2 py-1"
        >
          <option v-for="name in opened.document.sheetNames" :key="name" :value="name">
            {{ name }}
          </option>
        </select>
      </label>

      <label class="flex cursor-pointer items-center gap-2 text-base">
        <input v-model="hasHeader" type="checkbox" class="size-4 accent-brand" />
        <span class="font-bold">{{ t('data.hasHeader') }}</span>
      </label>

      <span v-if="!hasHeader" class="text-base text-ink-soft">{{ t('data.noHeaderNote') }}</span>

      <div class="ml-auto flex gap-2">
        <AppButton variant="ghost" @click="opened = null">{{ t('common.cancel') }}</AppButton>
        <AppButton :disabled="busy" @click="requestApply">{{ t('data.use') }}</AppButton>
      </div>
    </div>

    <!-- 표. 남은 세로 공간을 전부 쓴다. -->
    <div class="min-h-0 flex-1">
      <AppTable v-if="shown" class="h-full">
        <thead class="sticky top-0 z-10">
          <tr>
            <th v-for="column in shown.columns" :key="column.name" class="align-bottom">
              <span class="block text-ink">{{ column.name }}</span>
              <span class="block font-normal">{{ kindOf(column) }}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in shown.dataset.rows" :key="index">
            <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
          </tr>
        </tbody>
      </AppTable>

      <div
        v-else
        class="grid h-full place-items-center rounded-panel border-2 border-dashed transition-colors"
        :class="dragging ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface'"
      >
        <AppEmpty :reason="t('data.emptyReason')" :next="t('data.dropHint')">
          <AppButton size="lg" :disabled="busy" @click="fileInput?.click()">
            {{ busy ? t('data.reading') : t('data.choose') }}
          </AppButton>
        </AppEmpty>
      </div>
    </div>

    <p v-if="shown" class="shrink-0 text-base text-ink-faint">
      {{ t('data.previewNote', PREVIEW_ROW_COUNT) }}
    </p>

    <!-- 열 검사기. 보조 영역이라 접혀 있다. -->
    <details
      v-if="shown"
      class="shrink-0 rounded-panel border border-line bg-surface"
      :open="inspecting"
    >
      <summary class="cursor-pointer px-4 py-2.5 text-base font-bold text-ink-soft">
        {{ t('data.inspector') }}
      </summary>
      <div class="border-t border-line p-3">
        <AppTable>
          <thead>
            <tr>
              <th>{{ t('data.columnName') }}</th>
              <th>{{ t('data.kind') }}</th>
              <th>{{ t('data.missing') }}</th>
              <th>{{ t('data.unique') }}</th>
              <th>{{ t('data.samples') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="column in shown.columns" :key="column.name">
              <td class="font-bold">{{ column.name }}</td>
              <td>{{ kindOf(column) }}</td>
              <td>{{ column.missing }}</td>
              <td>{{ column.unique }}</td>
              <td class="text-ink-soft">{{ column.samples.join(', ') }}</td>
            </tr>
          </tbody>
        </AppTable>
      </div>
    </details>

    <input ref="fileInput" type="file" :accept="accept" class="hidden" @change="onPick" />

    <AppDialog
      :open="confirming"
      :title="t('data.replaceTitle')"
      :description="t('data.replaceDescription', batchCount)"
      @close="confirming = false"
    >
      <template #actions>
        <AppButton variant="ghost" @click="confirming = false">{{ t('common.cancel') }}</AppButton>
        <AppButton variant="danger" :disabled="busy" @click="apply">
          {{ t('data.replaceConfirm') }}
        </AppButton>
      </template>
    </AppDialog>
  </div>
</template>
