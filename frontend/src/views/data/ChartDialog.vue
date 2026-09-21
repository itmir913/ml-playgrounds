<script setup lang="ts">
/**
 * 데이터 시각화 창 (`architecture.md` §8.9.1, `open-decisions.md` "44. 데이터 화면의 시각화").
 *
 * **창 안에 열 선택기와 도구 선택기가 함께 있다.** 그림을 바꿀 때마다 창을 닫았다 여는
 * 것이 아니라 **그 안에서 계속 돌아다닌다** — Orange3의 위젯 창과 같은 모양이다.
 *
 * **무엇을 그릴 수 있는지는 등록부가 안다** (`data/charts.ts`). 여기는 그 목록을 받아
 * 늘어놓고, 잠긴 것에는 **등록부가 준 이유**를 붙인다 — 조건을 조립하지 않는다
 * (`CLAUDE.md` §2).
 *
 * **아무 상태도 저장하지 않는다.** 창을 닫으면 고른 열도 도구도 사라진다 — 보는 것뿐이라
 * `.mlpx`에 남길 것이 없다 (결정문의 "저장하지 않는다").
 */

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import { chartToolsFor, defaultChartTool, type ChartTool } from '@/data/charts'
import type { ColumnSummary } from '@/data/columns'
import type { Dataset } from '@/ml/preprocess'
import type { DataType } from '@/project/schema'

const props = defineProps<{
  open: boolean
  /** 데이터 종류. `data/kinds.ts`가 부르는 그 종류다 — 도구가 어디서 성립하는지를 등록부가 이것으로 판정한다. */
  kind: DataType
  dataset: Dataset
  columns: readonly ColumnSummary[]
  /** 창을 열 때 고른 열. 창 안에서 바뀌어도 이 값은 안 바뀐다. */
  column: string
  randomState: number
}>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

/** 지금 보고 있는 열. **바깥이 준 것으로 시작하고 그 뒤로는 창이 쥔다.** */
const column = ref(props.column)
/** 지금 고른 도구의 `id`. */
const toolId = ref('')

const tools = computed(() => chartToolsFor(props.kind))

const gate = computed(() => ({ columns: props.columns, column: column.value }))

/** 도구마다 잠긴 이유. **비어 있으면 그릴 수 있다.** */
function blocks(tool: ChartTool): readonly string[] {
  return tool.blockedBy(gate.value).map((block) => t(`data.charts.blocked.${block}`))
}

/**
 * **열이 바뀌면 그 열에서 그릴 수 있는 도구로 옮긴다.**
 *
 * 지금 도구가 여전히 그릴 수 있으면 그대로 둔다 — 열을 옮겨 다니며 같은 그림을 보는
 * 것이 이 창을 쓰는 방식이고, 매번 첫 도구로 되돌리면 그것을 못 한다.
 *
 * **창을 다시 열 때는 바깥이 준 열로 돌아간다.** 학생이 방금 누른 줄이 그 열이다.
 */
watch(
  () => [props.open, props.column] as const,
  ([open, picked]) => {
    if (open) column.value = picked
  },
  { immediate: true },
)

watch(
  [tools, gate],
  ([list, input]) => {
    const current = list.find((tool) => tool.id === toolId.value)
    if (current && current.blockedBy(input).length === 0) return
    toolId.value = defaultChartTool(props.kind, input)?.id ?? ''
  },
  { immediate: true },
)

const tool = computed(() => tools.value.find((one) => one.id === toolId.value))

const input = computed(() => ({
  dataset: props.dataset,
  columns: props.columns,
  column: column.value,
  randomState: props.randomState,
}))

/**
 * 지금 열의 **자료형**(수치·범주). **`props.kind`와 다른 것이다** — 저쪽은 데이터
 * 종류(표·사진)이고 이쪽은 열 하나의 자료형이다. 이름이 겹치면 다음 사람이 둘을 헷갈린다.
 */
const columnKind = computed(() => props.columns.find((one) => one.name === column.value)?.kind)
</script>

<template>
  <AppDialog
    wide
    :open="props.open"
    :title="t('data.charts.title')"
    :description="t('data.charts.lead')"
    @close="emit('close')"
  >
    <div class="flex flex-col gap-5">
      <!--
        **열을 창 안에서도 바꿀 수 있다.** 검사기의 줄이 여는 손잡이이고, 연 뒤에
        옆 열을 보려고 창을 닫았다 여는 것은 같은 일을 두 번 시키는 것이다.
      -->
      <label class="flex items-center gap-2">
        <span class="shrink-0 font-bold text-ink-soft">{{ t('data.charts.column') }}</span>
        <select
          v-model="column"
          class="min-w-0 flex-1 rounded-field border border-line-strong bg-surface px-2 py-1"
        >
          <option v-for="one in props.columns" :key="one.name" :value="one.name">
            {{ one.name }}
          </option>
        </select>
        <span v-if="columnKind" class="shrink-0 text-ink-soft">{{
          t(`columnKind.${columnKind}`)
        }}</span>
      </label>

      <!--
        **못 쓰는 도구를 숨기지 않고 이유와 함께 잠근다** (§8.2 "이유 없이 회색이면
        고장으로 본다"). 사라지면 그 도구는 없는 것이 되고, 회색으로 남아 있으면
        학생이 "수치 열에서 됩니다"를 읽는다.
      -->
      <div class="flex flex-wrap gap-2">
        <button
          v-for="one in tools"
          :key="one.id"
          type="button"
          class="rounded-field border px-3 py-1.5 text-base font-bold"
          :class="
            one.id === toolId
              ? 'border-brand bg-brand-soft text-brand'
              : blocks(one).length > 0
                ? 'cursor-not-allowed border-line bg-surface-sunken text-ink-faint'
                : 'border-line-strong bg-surface text-ink'
          "
          :disabled="blocks(one).length > 0"
          :title="blocks(one).join(' ')"
          @click="toolId = one.id"
        >
          {{ t(`data.charts.${one.id}.name`) }}
        </button>
      </div>

      <!--
        **잠긴 이유는 붙임말이 아니라 글로도 있어야 한다.** `title` 어트리뷰트는
        마우스를 올려야 보이고, 휴대폰에는 올릴 마우스가 없다.
      -->
      <p v-if="tool === undefined" class="text-ink-soft">
        {{ t('data.charts.nothingToDraw') }}
      </p>
      <p v-else-if="blocks(tool).length > 0" class="text-ink-soft">
        {{ blocks(tool).join(' ') }}
      </p>

      <component :is="tool.panel" v-if="tool && blocks(tool).length === 0" :input="input" />
    </div>

    <template #actions>
      <AppButton variant="secondary" @click="emit('close')">{{ t('common.dismiss') }}</AppButton>
    </template>
  </AppDialog>
</template>
