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

import { computed, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { CHART_CONTROLS } from '@/data/charts'

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

/**
 * 도구가 자기 설정을 보낼 자리 (`data/charts.ts`의 `CHART_CONTROLS`).
 *
 * **왜 텔레포트인가.** 무엇을 물을지는 도구가 알아야 하고(§9.1), 어디에 세울지는 창이
 * 정해야 한다 — 그 둘이 같은 컴포넌트에 있으면 하나를 고칠 때 다른 하나가 따라 움직인다.
 * 도구는 `<Teleport>`로 **보내기만** 하고, 창은 **자리만** 내준다.
 */
const controls = ref<HTMLElement | null>(null)
provide(CHART_CONTROLS, controls)
</script>

<template>
  <AppDialog
    fill
    persistent
    :open="props.open"
    :title="t('data.charts.title')"
    :description="t('data.charts.lead')"
    @close="emit('close')"
  >
    <!--
      **고르는 자리와 보는 자리를 가른다** (2026-09-22, 코드 소유자). 설정이 그림 위에
      가로로 누우면 창이 넓어질수록 **그 줄만 길어지고 그림은 그대로**다 — 창을 화면의
      95%로 키운 이유가 사라진다. 왼쪽이 3, 오른쪽이 7이다.

      **좁은 화면에서는 한 열로 내려온다** (§8.10.1). 거기서는 설정이 위, 그림이 아래다.
    -->
    <div class="grid min-h-0 flex-1 grid-cols-1 gap-5 md:grid-cols-10">
      <div class="flex min-w-0 flex-col gap-5 md:col-span-3">
        <!--
          **열을 창 안에서도 바꿀 수 있다.** 검사기의 줄이 여는 손잡이이고, 연 뒤에
          옆 열을 보려고 창을 닫았다 여는 것은 같은 일을 두 번 시키는 것이다.
        -->
        <label class="flex min-w-0 flex-col gap-1.5">
          <span class="flex items-baseline gap-2 font-bold text-ink-soft">
            {{ t('data.charts.column') }}
            <span v-if="columnKind" class="font-normal">{{ t(`columnKind.${columnKind}`) }}</span>
          </span>
          <select
            v-model="column"
            class="w-full min-w-0 rounded-field border border-line-strong bg-surface px-2 py-1.5"
          >
            <option v-for="one in props.columns" :key="one.name" :value="one.name">
              {{ one.name }}
            </option>
          </select>
        </label>

        <!--
          **못 쓰는 도구를 숨기지 않고 이유와 함께 잠근다** (§8.2 "이유 없이 회색이면
          고장으로 본다"). 사라지면 그 도구는 없는 것이 되고, 회색으로 남아 있으면
          학생이 "수치 열에서 됩니다"를 읽는다.

          **격자이지 흐르는 줄이 아니다.** `flex-wrap`으로 두면 글자 수대로 폭이 제각각이
          되고 창 너비에 따라 줄바꿈 자리가 달라져 **같은 도구가 어제와 다른 자리에 선다.**
          격자는 칸 수만 바뀌고 차례는 그대로다 (`AppChoices`와 같은 판단).

          **잠긴 단추의 글자는 `text-ink-faint`가 아니다** (2026-09-22에 재서 바꿨다).
          그 색은 어두운 배색에서 대비가 3.75:1이라 16px 굵은 글자의 기준(4.5)에 못
          미치는데, **여기 글자는 꾸밈이 아니라 "어느 도구가 잠겼는가"를 말한다** —
          안 읽히면 학생은 회색 덩어리만 보고 고장으로 읽는다(§8.2). `text-ink-soft`는
          같은 자리에서 7.4:1이다.
        -->
        <!--
          **두 열로 갈리는 문턱을 재서 잡았다** (2026-09-22, 코드 소유자). 한 열로만
          세우면 넷이 세로를 다 먹고, 그 아래 설정과 그림이 그만큼 밀린다.

          **재는 것은 창이 아니라 이 열이 받은 폭이다**(`@container`, `AppChoices`와 같은
          규칙) — `md:`로 쓰면 **창이 넓다는 이유로 좁은 왼쪽 열 안에서 두 열로 갈린다.**

          **문턱의 근거.** 가장 긴 이름이 `히스토그램(Histogram)`으로 158px이고(16px 굵은
          글자, 2026-09-22 실측) 칸의 좌우 여백과 테두리가 26px이라 한 칸이 184px이다.
          둘에 간격 8px을 더하면 376px이고, 그것을 넘는 가장 가까운 눈금이 `@sm`(384px)다.

          **어느 화면에서 갈리는지 재 봤다** (2026-09-22, 이 열이 받은 폭): 375에서 306px ·
          1366에서 351px이라 한 열이고, 1536에서 399px · 1920에서 513px이라 두 열이다.
          **1366이 33px 모자란 것은 우연이 아니라 옳다** — 거기서 둘로 가르면 칸이 176px이라
          가장 긴 이름이 두 줄로 접힌다.
        -->
        <div class="@container">
          <div class="grid grid-cols-1 gap-2 @sm:grid-cols-2">
            <button
              v-for="one in tools"
              :key="one.id"
              type="button"
              class="w-full rounded-field border px-3 py-2 text-left text-base font-bold"
              :class="
                one.id === toolId
                  ? 'border-brand bg-brand-soft text-brand'
                  : blocks(one).length > 0
                    ? 'cursor-not-allowed border-line bg-surface-sunken text-ink-soft'
                    : 'border-line-strong bg-surface text-ink'
              "
              :disabled="blocks(one).length > 0"
              :title="blocks(one).join(' ')"
              @click="toolId = one.id"
            >
              {{ t(`data.charts.${one.id}.name`) }}
            </button>
          </div>
        </div>

        <!--
          **도구마다의 설정이 여기로 온다.** 무엇이 오는지는 그 도구가 알고
          (§8.9.1 "둘째 열은 도구가 스스로 묻는다"), 이 창은 **자리만 내준다** — 여기서
          도구별로 갈래를 세우면 §9.1이 막으려던 분기가 화면에 생긴다.
        -->
        <div ref="controls" class="flex min-w-0 flex-col gap-3"></div>

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
      </div>

      <!--
        **칸이 캔버스보다 작아지면 안 된다** (2026-09-22, 모바일에서 재서 봤다). 한 열로
        내려오면 격자가 두 줄을 나눠 갖는데, 아래 줄이 201px까지 눌려서 **캔버스가 칸
        밖으로 55px 넘쳤다** — 굴러가는 상자라 보이기는 하지만 칸의 셈이 거짓이 된다.
        `min-h-64`는 `ChartFrame`이 캔버스에 주는 바닥값과 같은 값이다.
      -->
      <div class="flex min-h-64 min-w-0 flex-col md:col-span-7">
        <component :is="tool.panel" v-if="tool && blocks(tool).length === 0" :input="input" />
      </div>
    </div>

    <template #actions>
      <AppButton variant="secondary" @click="emit('close')">{{ t('common.dismiss') }}</AppButton>
    </template>
  </AppDialog>
</template>
