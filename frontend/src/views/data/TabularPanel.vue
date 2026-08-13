<script setup lang="ts">
/**
 * **표 데이터**의 작업 공간. 파일을 올리고, 시트를 고르고, 미리 보고, 정본으로 확정한다.
 *
 * 데이터 종류마다 이런 판이 하나씩 있고 `data/kinds.ts`가 고른다. 이미지·음성이
 * 들어오는 V5에서 여기를 고치는 것이 아니라 **옆에 새 판을 하나 더 만든다**
 * (architecture.md §6).
 *
 * **표가 주인공이다** (architecture.md §8.9). 카드를 쌓지 않는다 — 열이 수십 개인 표를
 * 카드 안에 가두면 가로 스크롤 상자 안에서만 볼 수 있게 된다. **열 검사기는 넓은 화면에서
 * 표 옆에 서고, 좁은 화면에서만 표 아래로 접힌다** — 접어 두면 펼칠 때 표가 먹힌다.
 *
 * **판단은 전부 이 파일 밖에 있다** — 파싱과 인코딩 판정은 `data/`, 열 이름과 요약은
 * `data/columns.ts`, 프로젝트에 붙이는 것은 `project/dataset.ts`다.
 *
 * **확정 버튼을 누르기 전까지 프로젝트를 손대지 않는다.** 파일을 잘못 골랐을 때
 * 되돌릴 것이 없어야 한다.
 */

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { dataKindFor, stepTextKey } from '@/data/kinds'

import AppBadge from '@/components/AppBadge.vue'
import AppButton from '@/components/AppButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import AppTable from '@/components/AppTable.vue'
import StepChecklist from '@/components/StepChecklist.vue'
import StepHeader from '@/components/StepHeader.vue'
import { summarizeColumns, toDataset, type ColumnSummary } from '@/data/columns'
import { importTable, openTable, previewTable, type TableDocument } from '@/data/table'
import ColumnInspector from './ColumnInspector.vue'
import { PREVIEW_ROW_COUNT } from '@/limits'
import { applyDataset, readDataset } from '@/project/dataset'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'

defineProps<{ accept: string }>()

const { t } = useI18n()

/**
 * 이 단계의 설명문. **등록부가 준다** (architecture.md §8.10) — `steps.data.purpose`를
 * 직접 읽으면 표를 두고 쓴 문장("어떤 열이 있는지")이 이미지 화면에도 뜬다.
 */
const dataPurpose = stepTextKey(dataKindFor('tabular'), 'data', 'purpose')
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

const experimentCount = computed(() => project.file?.document.runs.experiments.length ?? 0)

const previewRows = computed(() => {
  const document = opened.value?.document
  if (!document) return []
  const sheets = previewTable(document)
  return sheets.find((sheet) => sheet.sheetName === sheetName.value)?.rows ?? sheets[0]?.rows ?? []
})

/** 확정된 데이터. 정본은 언제나 UTF-8 CSV라 인코딩을 판정할 필요가 없다. */
const saved = computed(() => {
  const reference = project.file?.document.settings.data.dataset
  const dataset = readDataset(project.file)
  if (!dataset || !reference) return null
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

/**
 * 표를 잘라서 보여주고 있으면 그린 줄 수. 안 잘랐으면 0이다.
 *
 * **상수를 그대로 문구에 넘기면 안 된다.** 10줄짜리 파일에도 "처음 20줄만 보여 줍니다"가
 * 떠서 도구가 거짓말을 한다.
 */
const truncated = computed(() => {
  const rows = shown.value?.dataset.rows.length ?? 0
  const total = opened.value ? previewRows.value.length : (saved.value?.dataset.rows.length ?? 0)
  return total > rows ? rows : 0
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

/** 확정 요청. 지울 실험이 있으면 먼저 물어본다 (mlpx-spec.md §4.3). */
function requestApply(): void {
  if (experimentCount.value > 0) {
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
    toasts.push('success', 'data.tabular.applied')
    if (applied.droppedColumns.length > 0) {
      // 조용히 사라지면 학생은 자기가 고른 열이 빠진 줄 모른다.
      toasts.push('caution', 'data.tabular.droppedColumns', {
        names: applied.droppedColumns.join(', '),
      })
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
  <!--
    **`min-h-full`이지 `h-full`이 아니다.** 화면이 낮으면 `h-full`은 남은 자리를
    0으로 나눠 주고, 그러면 표가 머리만 남긴 채 **잘리는데 스크롤도 안 생긴다** —
    작업 공간의 높이가 딱 맞아떨어져서 바깥(`AppShell`의 `<main>`)도 넘칠 것이 없다고
    본다. 최소 높이를 주면 낮은 화면에서는 바깥이 넘쳐서 그쪽이 스크롤한다.
  -->
  <div
    class="flex min-h-full flex-col gap-5 p-4 sm:p-5"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <StepHeader :title="t('steps.data.label')" :purpose="t(dataPurpose)">
      <template #context>
        <template v-if="saved">
          <div class="flex gap-1.5">
            <dt class="sr-only">{{ t('data.tabular.fileName') }}</dt>
            <dd class="max-w-56 truncate font-bold text-ink">
              {{ saved.reference.originalFileName }}
            </dd>
          </div>
          <div class="flex items-baseline gap-1.5">
            <dt>
              <AppBadge>{{ t('data.tabular.rows') }}</AppBadge>
            </dt>
            <dd class="font-bold tabular-nums text-ink">{{ saved.dataset.rows.length }}</dd>
          </div>
          <div class="flex items-baseline gap-1.5">
            <dt>
              <AppBadge>{{ t('data.tabular.columns') }}</AppBadge>
            </dt>
            <dd class="font-bold tabular-nums text-ink">{{ saved.columns.length }}</dd>
          </div>
          <div class="flex items-baseline gap-1.5">
            <dt>
              <AppBadge>{{ t('data.tabular.encoding') }}</AppBadge>
            </dt>
            <dd class="font-bold text-ink">
              {{ saved.reference.sourceEncoding ?? saved.reference.encoding }}
            </dd>
          </div>
        </template>
      </template>
    </StepHeader>

    <StepChecklist step="data" />

    <!--
      **전체에 걸리는 동작은 여기 모인다** (§8.9). 머리에 두면 네 화면의 같은 자리가
      데이터에서만 다른 모양이 되고, 데이터가 없을 때는 화면 가운데 [파일 선택]과
      **같은 동작의 버튼이 둘**이 된다.

      **그래서 데이터가 있을 때만 뜬다.** 없을 때 이 동작의 유일한 출처는 가운데
      빈 상태다. 이미지 경로의 버튼 줄과 같은 자리, 같은 규칙이다.
    -->
    <section
      v-if="saved"
      class="flex flex-wrap items-center gap-2 rounded-panel border border-line bg-surface p-4"
    >
      <AppButton variant="secondary" :disabled="busy" @click="fileInput?.click()">
        {{ busy ? t('data.tabular.reading') : t('data.tabular.change') }}
      </AppButton>
    </section>

    <!-- 고르는 중일 때의 조작 줄. 확정 전에만 있다. -->
    <div
      v-if="opened"
      class="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-panel border border-brand-line bg-brand-soft px-4 py-2.5"
    >
      <span class="max-w-64 truncate text-base font-bold">{{ opened.fileName }}</span>

      <label v-if="opened.document.sheetNames.length > 1" class="flex items-center gap-2 text-base">
        <span class="font-bold text-ink-soft">{{ t('data.tabular.sheet') }}</span>
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
        <span class="font-bold">{{ t('data.tabular.hasHeader') }}</span>
      </label>

      <span v-if="!hasHeader" class="text-base text-ink-soft">{{
        t('data.tabular.noHeaderNote')
      }}</span>

      <div class="ml-auto flex gap-2">
        <AppButton variant="secondary" @click="opened = null">{{ t('common.cancel') }}</AppButton>
        <AppButton :disabled="busy" @click="requestApply">{{ t('data.tabular.use') }}</AppButton>
      </div>
    </div>

    <!--
      **표와 열 검사기가 남은 세로 공간을 나눠 갖는다** (architecture.md §8.9).
      넓은 화면에서는 옆으로, 좁은 화면에서는 표만 여기 있고 검사기는 아래로 접힌다.
    -->
    <div class="flex min-h-96 flex-1 gap-5">
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <h3 v-if="shown" class="font-bold text-ink-soft">{{ t('data.tabular.previewTitle') }}</h3>

        <AppTable v-if="shown" class="min-h-0 flex-1">
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
          class="grid min-h-0 flex-1 place-items-center rounded-panel border-2 border-dashed transition-colors"
          :class="dragging ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface'"
        >
          <AppEmpty :reason="t('data.tabular.emptyReason')" :next="t('data.tabular.dropHint')">
            <AppButton size="lg" :disabled="busy" @click="fileInput?.click()">
              {{ busy ? t('data.tabular.reading') : t('data.tabular.choose') }}
            </AppButton>
          </AppEmpty>
        </div>
      </div>

      <!--
        **넓은 화면에서는 검사기가 표 옆에 늘 열려 있다.** 결측 수를 보는 이유가 표의 그
        열을 보기 위해서이므로 둘은 함께 봐야 한다. 자기 열 안에서 스크롤하므로 열이
        몇 개든 표의 자리는 안 줄어든다.
      -->
      <aside v-if="shown" class="hidden min-w-0 flex-1 flex-col gap-1.5 md:flex">
        <h3 class="font-bold text-ink-soft">{{ t('data.tabular.inspector') }}</h3>
        <div class="flex min-h-0 flex-1 flex-col">
          <ColumnInspector :columns="shown.columns" />
        </div>
      </aside>
    </div>

    <!-- **자른 경우에만 말한다.** 20줄짜리 파일에 "처음 20줄만"은 거짓말이다. -->
    <p v-if="truncated" class="shrink-0 text-base text-ink-faint">
      {{ t('data.tabular.previewNote', truncated) }}
    </p>

    <!--
      **좁은 화면에서만 접힌다.** 여기서는 세로가 진짜로 부족해서, 펼치는 동안 표를
      양보하는 것이 유일한 길이다 (§8.10.1은 좁은 화면에서 1열을 타협하지 않는다).
    -->
    <details
      v-if="shown"
      class="shrink-0 rounded-panel border border-line bg-surface md:hidden"
      :open="inspecting"
    >
      <summary class="cursor-pointer px-4 py-2.5 text-base font-bold text-ink-soft">
        {{ t('data.tabular.inspector') }}
      </summary>
      <div class="max-h-72 overflow-y-auto border-t border-line p-3">
        <ColumnInspector :columns="shown.columns" />
      </div>
    </details>

    <input ref="fileInput" type="file" :accept="accept" class="hidden" @change="onPick" />

    <AppDialog
      :open="confirming"
      :title="t('data.tabular.replaceTitle')"
      :description="t('data.tabular.replaceDescription', experimentCount)"
      @close="confirming = false"
    >
      <template #actions>
        <AppButton variant="secondary" @click="confirming = false">{{
          t('common.cancel')
        }}</AppButton>
        <AppButton variant="danger" :disabled="busy" :action="apply">
          {{ t('data.tabular.replaceConfirm') }}
        </AppButton>
      </template>
    </AppDialog>
  </div>
</template>
