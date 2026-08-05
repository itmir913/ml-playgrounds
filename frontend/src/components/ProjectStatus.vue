<script setup lang="ts">
/**
 * 도구 막대의 프로젝트 정보 팝오버.
 *
 * **여기는 "지금 할 일"을 말하는 자리가 아니다.** 그건 프로젝트 홈이 한다 — 두 군데서
 * 말하면 학생은 툴바가 왜 자기를 재촉하는지 모른다. 여기 있는 것은 **지금 이 프로젝트가
 * 무엇인지**뿐이다: 언제 만들었고, 무슨 데이터가 몇 줄이고, 무엇을 예측하려 하고,
 * 모델이 몇 개 나왔는가.
 *
 * 학생이 파일을 열고 "이게 뭐였더라"를 확인하는 자리이고, 교사가 제출물을 열었을 때
 * 가장 먼저 보는 자리이기도 하다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppPopover from '@/components/AppPopover.vue'
import { useFormat } from '@/composables/useFormat'
import { toDataset } from '@/data/columns'
import { parseCsvText } from '@/data/csv'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const format = useFormat()
const project = useProjectStore()

/**
 * 보여줄 값들. **문서에서 읽기만 한다** — 여기서 판단을 만들지 않는다.
 *
 * 표의 크기는 정본 CSV를 파싱해서 센다. 저장해 둔 숫자가 아니라 실제 바이트에서
 * 세는 이유는, 파일을 손으로 고친 남의 프로젝트에서도 맞아야 하기 때문이다.
 */
const info = computed(() => {
  const file = project.file
  if (!file) return null
  const { manifest, settings, runs } = file.document

  const grid =
    file.dataset === undefined ? null : parseCsvText(new TextDecoder().decode(file.dataset.bytes))
  const dataset =
    grid === null || settings.dataset === undefined
      ? null
      : {
          fileName: settings.dataset.originalFileName,
          rows: toDataset(grid, settings.dataset.hasHeader).rows.length,
          columns: toDataset(grid, settings.dataset.hasHeader).columns.length,
        }

  let bytes = file.dataset?.bytes.length ?? 0
  for (const model of file.models.values()) bytes += model.length

  const allRuns = runs.batches.flatMap((batch) => batch.runs)
  return {
    manifest,
    dataset,
    bytes,
    target: settings.target,
    features: settings.features.length,
    algorithms: settings.selectedAlgorithms.map((one) => one.algorithm),
    runs: allRuns.length,
  }
})
</script>

<template>
  <AppPopover v-if="info" align="right">
    <template #trigger>
      <button
        type="button"
        class="rounded-control px-2.5 py-1.5 font-bold text-ink-soft transition-colors hover:bg-surface-sunken hover:text-ink"
      >
        {{ t('meta.title') }}
      </button>
    </template>

    <template #default>
      <h2 class="mb-3 truncate font-bold">{{ info.manifest.name }}</h2>

      <dl class="flex flex-col gap-1.5">
        <div class="flex justify-between gap-4">
          <dt class="text-ink-soft">{{ t('meta.taskType') }}</dt>
          <dd>{{ t(`taskTypes.${info.manifest.taskType}`) }}</dd>
        </div>

        <div class="flex justify-between gap-4">
          <dt class="shrink-0 text-ink-soft">{{ t('meta.dataset') }}</dt>
          <dd class="truncate">{{ info.dataset?.fileName ?? t('meta.none') }}</dd>
        </div>

        <div v-if="info.dataset" class="flex justify-between gap-4">
          <dt class="text-ink-soft">{{ t('meta.rows') }}</dt>
          <dd class="tabular-nums">{{ info.dataset.rows }}</dd>
        </div>

        <div v-if="info.dataset" class="flex justify-between gap-4">
          <dt class="text-ink-soft">{{ t('meta.columns') }}</dt>
          <dd class="tabular-nums">{{ info.dataset.columns }}</dd>
        </div>

        <div class="flex justify-between gap-4">
          <dt class="text-ink-soft">{{ t('meta.target') }}</dt>
          <dd class="truncate">{{ info.target ?? t('meta.none') }}</dd>
        </div>

        <div class="flex justify-between gap-4">
          <dt class="text-ink-soft">{{ t('meta.features') }}</dt>
          <dd class="tabular-nums">{{ t('meta.countUnit', info.features) }}</dd>
        </div>

        <div class="flex justify-between gap-4">
          <dt class="shrink-0 text-ink-soft">{{ t('meta.algorithms') }}</dt>
          <dd class="truncate">
            {{ info.algorithms.length === 0 ? t('meta.none') : info.algorithms.join(', ') }}
          </dd>
        </div>

        <div class="flex justify-between gap-4">
          <dt class="text-ink-soft">{{ t('meta.runs') }}</dt>
          <dd class="tabular-nums">{{ t('meta.countUnit', info.runs) }}</dd>
        </div>

        <div class="mt-2 flex justify-between gap-4 border-t border-line pt-2">
          <dt class="text-ink-soft">{{ t('meta.size') }}</dt>
          <dd>{{ format.bytes(info.bytes) }}</dd>
        </div>

        <div class="flex justify-between gap-4">
          <dt class="text-ink-soft">{{ t('meta.created') }}</dt>
          <dd>{{ format.dateTime(info.manifest.createdAt) }}</dd>
        </div>

        <div class="flex justify-between gap-4">
          <dt class="text-ink-soft">{{ t('meta.updated') }}</dt>
          <dd>{{ format.dateTime(info.manifest.updatedAt) }}</dd>
        </div>
      </dl>
    </template>
  </AppPopover>
</template>
