<script setup lang="ts">
/**
 * 데이터 단계. 표 파일을 올리고, 시트를 고르고, 미리 보고, 정본으로 확정한다.
 *
 * **판단은 전부 이 파일 밖에 있다** — 파싱과 인코딩 판정은 `data/`, 열 이름과 요약은
 * `data/columns.ts`, 프로젝트에 붙이는 것은 `project/dataset.ts`다. 여기는 그것들을
 * 순서대로 부르고 결과를 그린다.
 *
 * **확정 버튼을 누르기 전까지 프로젝트를 손대지 않는다.** 파일을 잘못 골랐을 때
 * 되돌릴 것이 없어야 한다.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppDialog from '@/components/AppDialog.vue'
import AppTable from '@/components/AppTable.vue'
import { summarizeColumns, toDataset } from '@/data/columns'
import { parseCsvText } from '@/data/csv'
import { importTable, openTable, previewTable, type TableDocument } from '@/data/table'
import { PREVIEW_ROW_COUNT } from '@/limits'
import { applyDataset } from '@/project/dataset'
import { saveProject } from '@/project/storage'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'

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

const batchCount = computed(() => project.file?.document.runs.batches.length ?? 0)

const preview = computed(() => {
  const document = opened.value?.document
  if (!document) return []
  const sheets = previewTable(document)
  return sheets.find((sheet) => sheet.sheetName === sheetName.value)?.rows ?? sheets[0]?.rows ?? []
})

/** 미리보기 격자의 열 요약. 확정 전에도 자료형과 빈 칸을 보여준다. */
const previewColumns = computed(() => summarizeColumns(toDataset(preview.value, hasHeader.value)))

/** 확정된 데이터의 요약. 정본은 언제나 UTF-8 CSV라 인코딩을 판정할 필요가 없다. */
const current = computed(() => {
  const file = project.file
  const reference = file?.document.settings.dataset
  if (!file?.dataset || !reference) return null
  const grid = parseCsvText(new TextDecoder().decode(file.dataset.bytes))
  return {
    reference,
    rows: reference.hasHeader ? Math.max(0, grid.length - 1) : grid.length,
    columns: summarizeColumns(toDataset(grid, reference.hasHeader)),
  }
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
    await saveProject(applied.project)
    project.replace(applied.project)

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
</script>

<template>
  <div class="flex flex-col gap-6">
    <AppCard v-if="current" :title="t('data.current')">
      <dl class="mb-6 grid gap-x-6 sm:grid-cols-2">
        <div class="flex justify-between gap-4 border-b border-line py-2">
          <dt class="font-bold text-ink-soft">{{ t('data.fileName') }}</dt>
          <dd class="truncate">{{ current.reference.originalFileName }}</dd>
        </div>
        <div class="flex justify-between gap-4 border-b border-line py-2">
          <dt class="font-bold text-ink-soft">{{ t('data.encoding') }}</dt>
          <dd>{{ current.reference.sourceEncoding ?? current.reference.encoding }}</dd>
        </div>
        <div class="flex justify-between gap-4 border-b border-line py-2">
          <dt class="font-bold text-ink-soft">{{ t('data.rows') }}</dt>
          <dd class="tabular-nums">{{ current.rows }}</dd>
        </div>
        <div class="flex justify-between gap-4 border-b border-line py-2">
          <dt class="font-bold text-ink-soft">{{ t('data.columns') }}</dt>
          <dd class="tabular-nums">{{ current.columns.length }}</dd>
        </div>
      </dl>

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
          <tr v-for="column in current.columns" :key="column.name">
            <td class="font-bold">{{ column.name }}</td>
            <td>{{ t(`columnKind.${column.kind}`) }}</td>
            <td>{{ column.missing }}</td>
            <td>{{ column.unique }}</td>
            <td class="text-ink-soft">{{ column.samples.join(', ') }}</td>
          </tr>
        </tbody>
      </AppTable>

      <template #footer>
        <AppButton variant="secondary" @click="fileInput?.click()">
          {{ t('data.change') }}
        </AppButton>
      </template>
    </AppCard>

    <AppCard v-if="!opened" :title="t('steps.data.label')" :description="t('data.accepted')">
      <div
        class="flex flex-col items-center gap-4 rounded-panel border-2 border-dashed p-10 text-center transition-colors"
        :class="dragging ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface-sunken'"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <p class="text-ink-soft">{{ t('data.dropHint') }}</p>
        <AppButton size="lg" :disabled="busy" @click="fileInput?.click()">
          {{ t('data.choose') }}
        </AppButton>
        <p v-if="busy" class="text-sm text-ink-faint">{{ t('data.reading') }}</p>
      </div>
    </AppCard>

    <AppCard v-else :title="t('data.preview')" :description="opened.fileName">
      <div class="mb-6 flex flex-wrap items-center gap-6">
        <label v-if="opened.document.sheetNames.length > 1" class="flex items-center gap-2">
          <span class="text-sm font-bold text-ink-soft">{{ t('data.sheet') }}</span>
          <select
            v-model="sheetName"
            class="rounded-field border border-line-strong bg-surface px-3 py-2"
          >
            <option v-for="name in opened.document.sheetNames" :key="name" :value="name">
              {{ name }}
            </option>
          </select>
        </label>

        <label class="flex cursor-pointer items-center gap-2">
          <input v-model="hasHeader" type="checkbox" class="size-5 accent-brand" />
          <span class="font-bold">{{ t('data.hasHeader') }}</span>
        </label>
      </div>

      <p v-if="!hasHeader" class="mb-4 text-sm text-ink-faint">{{ t('data.noHeaderNote') }}</p>

      <AppTable>
        <thead>
          <tr>
            <th v-for="column in previewColumns" :key="column.name">{{ column.name }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, index) in hasHeader ? preview.slice(1) : preview" :key="index">
            <td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td>
          </tr>
        </tbody>
      </AppTable>

      <p class="mt-3 text-sm text-ink-faint">{{ t('data.previewNote', PREVIEW_ROW_COUNT) }}</p>

      <template #footer>
        <div class="flex flex-wrap justify-end gap-3">
          <AppButton variant="ghost" @click="opened = null">{{ t('common.cancel') }}</AppButton>
          <AppButton size="lg" :disabled="busy" @click="requestApply">
            {{ t('data.use') }}
          </AppButton>
        </div>
      </template>
    </AppCard>

    <input ref="fileInput" type="file" accept=".csv,.xlsx" class="hidden" @change="onPick" />

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
