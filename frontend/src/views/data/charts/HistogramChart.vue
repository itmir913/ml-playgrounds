<script setup lang="ts">
/**
 * 히스토그램 — 수치 열의 분포 (Orange3의 `Distributions`).
 *
 * **계산은 하나도 없다.** 구간 나누기는 `data/stats.ts`, Chart.js 설정은
 * `data/chart-config.ts`이고 여기는 그것을 캔버스에 얹는 일만 한다
 * (`architecture.md` §8.9.1).
 *
 * **Chart.js 등록이 여기 있다.** 이 부품이 지연 로딩되므로(`data/charts.ts`) 시각화를
 * 안 여는 학생은 차트 라이브러리를 안 받는다.
 */

import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LinearScale,
  LogarithmicScale,
  Tooltip,
} from 'chart.js'
import { computed, ref, watch } from 'vue'
import { Bar } from 'vue-chartjs'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import ChartFrame from './ChartFrame.vue'
import { barOptions, binLabels, histogramData } from '@/data/chart-config'
import { useChartControls, type ChartInput } from '@/data/charts'
import { columnCells, histogram, isBinCount, numericValues, type BinChoice } from '@/data/stats'
import { useChartTokens } from '@/composables/useChartTokens'
import { useFormat } from '@/composables/useFormat'
import { HISTOGRAM_BIN_LIMIT } from '@/limits'

/**
 * **`LogarithmicScale`을 여기서 등록한다.** Chart.js는 쓰는 것만 등록하는 구조라, 옵션에
 * `type: 'logarithmic'`을 적어도 **등록이 없으면 `"logarithmic" is not a registered scale`로
 * 죽는다** — 그림이 통째로 사라진다.
 *
 * **검사가 이것을 못 봤다** (2026-09-22). `chart-config.spec.ts`가 옵션 객체는 물지만
 * 등록은 다른 파일의 일이라, **설정은 옳고 화면은 빈** 상태가 초록으로 통과했다.
 * 아래 `tests/chart-registry.spec.ts`가 그 이음매를 문다.
 */
Chart.register(BarController, BarElement, CategoryScale, LinearScale, LogarithmicScale, Tooltip)

const props = defineProps<{ input: ChartInput }>()

const { t } = useI18n()
const format = useFormat()
const paint = useChartTokens()

/** 설정을 세울 자리. 창 밖에서 마운트되면 `null`이고, 그때는 제자리에 그린다. */
const controls = useChartControls()

/** 구간 수를 자동(numpy의 `'auto'`)에 맡기는가. */
const auto = ref(true)

/**
 * **그림이 실제로 쓰는 수.** 아래 `draft`와 가르는 것이 이 손잡이의 전부다
 * (`architecture.md` §8.9.1.1) — 학생이 치는 동안 10만 행을 다시 세지 않는다.
 */
const applied = ref<BinChoice>('auto')

/** 학생이 치고 있는 초안. **[적용]을 눌러야 그림에 닿는다.** */
const draft = ref(1)

/**
 * **학생이 마지막으로 [적용]한 수.** 고른 적이 없으면 `null`이다.
 *
 * 칸(`draft`)은 자동인 동안 자동이 고른 수를 **비춘다** — 그 칸 하나로 학생의 수까지 들면,
 * 자동을 켰다 끄는 것만으로 학생이 고른 수가 사라진다(`open-decisions.md` 55 표의 6,
 * R38-D55 B-4). **비추는 값과 고른 값을 두 칸에 든다** (`architecture.md` §8.9.1.1).
 */
const chosen = ref<number | null>(null)

const read = computed(() => numericValues(columnCells(props.input.dataset, props.input.column)))
const made = computed(() => histogram(read.value.values, HISTOGRAM_BIN_LIMIT, applied.value))
const labels = computed(() => binLabels(made.value.edges, (value) => format.stat(value)))

/**
 * **자동인 동안 초안은 자동이 고른 수를 비춘다.**
 *
 * 그래야 칸에 선 숫자가 *"numpy가 고른 수"*가 되고(학생이 파이썬에 옮겨 적을 값이다),
 * 자동을 껐을 때 **그 수에서 이어서 고치게 된다.** 열을 바꾸면 그 열의 수로 따라간다.
 */
watch(
  [() => made.value.counts.length, auto],
  ([count, on]) => {
    if (on) draft.value = count
  },
  { immediate: true },
)

/**
 * **자동은 즉시 반영한다.** 돌아가는 길에는 물을 것이 없다 (§8.9.1.1).
 *
 * **끄면 학생이 고른 수로 돌아온다** — 전에 [적용]한 수가 있으면 그것을 칸과 그림에 다시
 * 앉힌다. 고른 적이 없으면 **끄는 것만으로는 그림이 안 바뀐다** — 초안이 이미 자동이 고른
 * 수라, 칸이 열릴 뿐 같은 그림이다. 거기서 수동으로 넘기면 학생이 아무것도 안 골랐는데
 * 그림이 움직인다.
 */
watch(auto, (on) => {
  if (on) {
    applied.value = 'auto'
    return
  }
  if (chosen.value !== null) {
    draft.value = chosen.value
    applied.value = chosen.value
  }
})

/**
 * 지금 초안으로는 그릴 수 없는 이유. **없으면 빈 값이다.**
 *
 * **조용히 당기지 않는다** (§8.9.1.1). 클램프한 값이 지금 값과 같으면 Vue가 DOM을 다시
 * 안 써서 학생이 친 숫자가 칸에 남고 화면이 계속 거짓말한다 (2026-08-12 감사 B-3).
 *
 * **도움말과 다른 문장이다** (2026-09-22, 브라우저로 몰아 보고 고쳤다). `AppField`는
 * 오류가 도움말 자리를 차지하므로, 둘이 같은 글자면 **색만 붉어지고 학생에게 새 정보가
 * 없다** — 도움말은 규칙을 가르치고 오류는 무엇이 틀렸는지 말한다 (`copy.md` §5).
 */
const blocked = computed(() =>
  isBinCount(draft.value, HISTOGRAM_BIN_LIMIT)
    ? ''
    : t('data.charts.histogram.binInvalid', { min: 1, max: HISTOGRAM_BIN_LIMIT }),
)

function apply(): void {
  applied.value = draft.value
  chosen.value = draft.value
}

/**
 * 그림 아래 한 줄.
 *
 * **[적용] 방식에는 "칸은 50인데 그림은 20"인 순간이 생긴다.** 어느 쪽을 봐도 거짓이
 * 없도록 **그림이 자기가 그린 수를 말한다** (§8.9.1.1). 자동일 때는 줄였다는 사실이
 * 그 자리의 몫이고(`capped`), 학생이 고른 수는 줄인 것이 아니다.
 */
const note = computed(() => {
  if (applied.value !== 'auto') {
    return t('data.charts.histogram.bins', { count: made.value.counts.length })
  }
  return made.value.capped
    ? t('data.charts.histogram.capped', { count: made.value.counts.length })
    : ''
})

const data = computed(() =>
  histogramData(made.value, labels.value, paint.value, t('data.charts.histogram.series')),
)

/**
 * 세는 축을 로그로 볼 것인가 (`open-decisions.md` "46. 히스토그램의 y축을 로그로 볼
 * 것인가").
 *
 * **[적용]이 없다.** 축의 종류를 바꾸는 것은 **다시 세는 일이 아니라 다시 그리는 일**이라
 * 10만 행을 건드리지 않는다 (`architecture.md` §8.9.1.1의 "되돌아가는 길은 즉시").
 *
 * **자동도 없다.** 구간 수의 자동은 *"numpy가 고른 값"*이라는 내용이 있었지만, 축에는
 * 고를 것이 없다 — 켜거나 끄거나다.
 */
const logarithmic = ref(false)

const options = computed(() =>
  barOptions(
    paint.value,
    {
      x: props.input.column,
      y: t('data.charts.axisCount'),
      point: (label, count) => t('data.charts.histogram.point', { range: label, count }),
    },
    logarithmic.value,
  ),
)
</script>

<template>
  <!--
    **그릴 값이 하나도 없으면 그림 대신 이유를 말한다** (§9.2). 열 전체가 빈 칸인
    표가 실제로 있고, 그때 빈 격자만 뜨면 학생은 앱이 고장 난 줄 안다.
  -->
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <!-- **설정은 창이 내준 자리로 보낸다** (§8.9.1). `BoxChart`·`ScatterChart`와 같은 규칙이다. -->
    <Teleport :to="controls" :disabled="controls === null">
      <!--
        **자동일 때는 `readonly`이지 `disabled`가 아니다** (§8.9.1.1). 이 숫자는 꾸밈이
        아니라 **numpy가 고른 값**이고 학생이 파이썬에 옮겨 적을 수다 — `disabled`는
        브라우저가 글자를 흐리게 만들어 읽히지 않는다. 이 창이 잠긴 도구 글자를
        `text-ink-faint`에서 `text-ink-soft`로 바꾼 것과 같은 판단이다.

        **`@change` 핸들러를 안 단다.** 안 당기므로 되돌릴 것이 없고, `v-model`이
        초안을 그대로 들고 있으면 칸과 초안이 갈릴 자리가 없다.
      -->
      <AppField
        :label="t('data.charts.histogram.binCount')"
        :hint="t('data.charts.histogram.binRange', { min: 1, max: HISTOGRAM_BIN_LIMIT })"
        :error="blocked === '' ? undefined : blocked"
      >
        <!--
          **스위치는 이름 바로 아래다** (2026-09-22, 코드 소유자가 화면에서 잡았다) —
          칸이 무엇을 담는지 읽은 직후에 *"그 수를 누가 정하는가"*가 온다.
        -->
        <template #under-label>
          <label class="flex items-center gap-2 text-ink">
            <input v-model="auto" type="checkbox" class="size-5 accent-brand" />
            {{ t('data.charts.histogram.binAuto') }}
          </label>
        </template>

        <!--
          **[적용]은 칸과 한 줄이다** (2026-09-22, 코드 소유자가 화면에서 잡았다).
          아래로 세웠더니 좁은 화면에서 **단추를 보려면 굴려야 했다** — 칸을 고치고
          바로 누르는 자리라 함께 보여야 한다.

          **자동일 때는 단추 자체가 없다** (§8.9.1.1). 고칠 것이 없는데 회색으로 세워
          두면 *"왜 못 누르나"*를 또 설명해야 한다.
        -->
        <template #default="field">
          <div class="flex min-w-0 items-center gap-2">
            <!--
              **칸의 높이가 단추와 같다** (2026-09-22, 코드 소유자가 화면에서 잡았다).
              `AppButton`의 `md`가 `py-2.5`이고 칸은 `py-1.5`라 8px이 낮았는데, 자동을
              껐다 켤 때 **단추가 들고 나면서 줄 높이가 튀었다.** 같은 값을 쓰면 단추가
              있든 없든 그 줄이 안 움직인다.
            -->
            <input
              v-bind="field"
              v-model.number="draft"
              type="number"
              class="w-full min-w-0 rounded-field border border-line-strong bg-surface px-2 py-2.5"
              :readonly="auto"
              :min="1"
              :max="HISTOGRAM_BIN_LIMIT"
              step="1"
            />
            <AppButton
              v-if="!auto"
              class="shrink-0"
              variant="secondary"
              :disabled="blocked !== ''"
              @click="apply"
            >
              {{ t('data.charts.histogram.binApply') }}
            </AppButton>
          </div>
        </template>
      </AppField>

      <!--
        **자기 이름을 단 칸으로 선다** (결정문 46). 축을 바꾸는 것과 구간을 바꾸는 것은
        다른 질문이라, 구간 수 칸 안에 끼워 넣지 않는다.

        **`AppField`를 안 쓴다** — 그쪽은 라벨이 입력을 가리키는 껍데기이고, 여기 입력은
        체크박스 하나뿐이라 **이름이 곧 그 체크박스의 이름**이다. 라벨을 두 번 세우면
        스크린리더가 같은 말을 두 번 읽는다.
      -->
      <label class="flex items-center gap-2 text-base font-bold text-ink-soft">
        <input v-model="logarithmic" type="checkbox" class="size-5 accent-brand" />
        {{ t('data.charts.histogram.logScale') }}
      </label>
    </Teleport>

    <ChartFrame
      :empty="made.counts.length === 0 ? t('data.charts.noValues') : ''"
      :missing="read.missing"
      :note="note"
    >
      <Bar :data="data" :options="options" />
    </ChartFrame>
  </div>
</template>
