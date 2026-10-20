<script setup lang="ts">
/**
 * 범주형 열 하나의 인코딩과 범주 순서 (open-decisions.md 116).
 *
 * **표에 칸을 더하지 않고 창을 띄운다** (2026-10-20, 코드 소유자). 순서를 고르는 목록은 표의
 * 칸에 안 들어가고, 표는 이미 휴대폰에서 옆으로 넘친다. 인코딩 선택도 같은 창에 둬서 결정이
 * 한 자리에 있다.
 *
 * **고친 것은 [적용]에서 한 번에 쓴다.** 옮길 때마다 쓰면 실험 기록의 "바뀜"이 옮긴 횟수만큼
 * 흔들린다. 무엇을 저장하는지는 `ml/column-override.ts`가 정한다 — 이 부품은 부르기만 한다.
 *
 * **순서 목록에 상한이 없고 아무것도 잠그지 않는다** (116, 코드 소유자). 저장된 순서는 언제나
 * 보이고 [순서 지정 해제]로 풀 수 있다(행동불능이 없다). 값이 많으면 보이는 줄만 그리고
 * (`virtual-window.ts`), ↑↓로 못 옮길 만큼 많으면 [사전순 정렬]·[사전 역순 정렬]로 한 번에 채운다.
 */

import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import { ACTION_ICONS } from '@/icons'
import { CATEGORY_ORDER_OVERSCAN_ROWS, STRAY_VALUE_PREVIEW_COUNT } from '@/limits'
import { lockFor } from '@/locks'
import {
  dictionaryOrder,
  moveCategory,
  overrideOf,
  straysOf,
  withColumnOverride,
  type EncodingChoice,
} from '@/ml/column-override'
import { categoryOrder } from '@/ml/preprocess'
import { CATEGORICAL_ENCODINGS, type Preprocessing } from '@/project/schema'
import { virtualWindow } from '@/virtual-window'

const props = defineProps<{
  open: boolean
  /** 열 이름. 학생의 파일에서 온 말이다. */
  column: string
  /** 이 열에 있는 값 종류(빈 칸 제외). 순서를 처음 만들 때 이 값들의 정렬에서 시작한다. */
  values: readonly string[]
  preprocessing: Preprocessing
}>()

const emit = defineEmits<{
  close: []
  apply: [next: Preprocessing]
}>()

const { t } = useI18n()

const CHOICES: readonly EncodingChoice[] = ['inherit', ...CATEGORICAL_ENCODINGS]

const encoding = ref<EncodingChoice>('inherit')
const categories = ref<string[] | undefined>(undefined)

/** 열 때마다 저장된 것에서 다시 시작한다. 닫았다 열면 고치던 것은 버린다([취소]와 같다). */
watch(
  () => props.open,
  (open) => {
    if (!open) return
    const stored = overrideOf(props.preprocessing, props.column)
    encoding.value = stored?.categoricalEncoding ?? 'inherit'
    categories.value = stored?.categories === undefined ? undefined : [...stored.categories]
  },
  { immediate: true },
)

const effective = computed(() =>
  encoding.value === 'inherit' ? props.preprocessing.categoricalEncoding : encoding.value,
)

const sorted = computed(() => categoryOrder(props.values))

/** 보이는 순서. 지정했으면 그 순서, 아니면 정렬이다. */
const shown = computed(() => categories.value ?? sorted.value)

/** 데이터에 있는데 지정한 순서에 없는 값. 앞의 몇 개만 늘어놓고 나머지는 개수로 말한다. */
const strays = computed(() => straysOf(categories.value, props.values, STRAY_VALUE_PREVIEW_COUNT))

const strayText = computed(() => {
  const { count, shown: values } = strays.value
  const listed = values.join(', ')
  const rest = count - values.length
  return rest > 0
    ? t('preprocess.columnEncoding.strayValuesMore', { values: listed, rest })
    : listed
})

/**
 * 사전순·사전 역순으로 한 번에 채운다 (2026-10-20, 코드 소유자). 값이 많으면 ↑↓로는 못 옮기므로
 * 상한 대신 이 길을 둔다 — 사전순은 [순서 지정 해제]와 번호가 같지만 **지정한 순서**로 남는다.
 */
function fillOrder(direction: 'ascending' | 'descending'): void {
  categories.value = dictionaryOrder(props.values, direction)
}

function move(index: number, delta: -1 | 1): void {
  categories.value = moveCategory(shown.value, index, delta)
}

/** 목록 상자와 그 안의 첫 줄. 굴린 자리와 줄 높이를 잰다. */
const viewport = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewportHeight = ref(0)
const rowHeight = ref(0)
/** 상자 맨 위에 붙은 머리글의 높이. 줄은 그 아래에서 시작하므로 굴린 자리에서 뺀다. */
const headerHeight = ref(0)

function measureList(): void {
  const box = viewport.value
  if (!box) return
  scrollTop.value = box.scrollTop
  viewportHeight.value = box.clientHeight
  const row = box.querySelector('li')
  if (row) rowHeight.value = row.getBoundingClientRect().height
  const header = box.firstElementChild
  if (header) headerHeight.value = header.getBoundingClientRect().height
}

const listWindow = computed(() =>
  virtualWindow({
    count: shown.value.length,
    rowHeight: rowHeight.value,
    scrollTop: Math.max(0, scrollTop.value - headerHeight.value),
    viewportHeight: Math.max(0, viewportHeight.value - headerHeight.value),
    overscan: CATEGORY_ORDER_OVERSCAN_ROWS,
  }),
)

/** 지금 그리는 줄. 번호는 목록 전체에서의 자리다. */
const visible = computed(() =>
  shown.value
    .slice(listWindow.value.start, listWindow.value.end)
    .map((value, offset) => ({ value, index: listWindow.value.start + offset })),
)

// 창이 열리거나 순서 칸이 새로 서면 상자를 다시 잰다.
watch([() => props.open, () => effective.value], () => void nextTick(measureList), {
  flush: 'post',
})

function clearOrder(): void {
  categories.value = undefined
}

function apply(): void {
  emit(
    'apply',
    withColumnOverride(props.preprocessing, props.column, encoding.value, categories.value),
  )
}
</script>

<template>
  <!--
    **데스크톱에서는 두 열이다** (2026-10-20, 코드 소유자). 왼쪽이 인코딩, 오른쪽이 범주 순서 —
    고르는 것과 그 결과(번호)가 나란히 보인다. `lg` 아래에서는 위아래로 쌓인다. 두 열이 각자
    폭을 가지려면 넓은 창이어야 한다(`wide`).
  -->
  <AppDialog
    wide
    focus-panel
    :open="props.open"
    :title="t('preprocess.columnEncoding.title', { column: props.column })"
    :description="t('preprocess.columnEncoding.lead')"
    @close="emit('close')"
  >
    <div class="grid gap-6 lg:grid-cols-2 lg:gap-8">
      <fieldset class="min-w-0">
        <legend class="font-bold">{{ t('preprocess.tabular.encoding') }}</legend>
        <div class="mt-2 flex flex-col gap-3">
          <label
            v-for="choice in CHOICES"
            :key="choice"
            class="flex cursor-pointer items-start gap-2"
          >
            <input
              v-model="encoding"
              type="radio"
              class="mt-1 size-4 shrink-0 accent-brand"
              :value="choice"
            />
            <span class="min-w-0">
              <span v-if="choice === 'inherit'" class="block">
                {{
                  t('preprocess.columnEncoding.inherit', {
                    shared: t(`categoricalEncoding.${props.preprocessing.categoricalEncoding}`),
                  })
                }}
              </span>
              <template v-else>
                <span class="block">{{ t(`categoricalEncoding.${choice}`) }}</span>
                <span class="block text-ink-soft">{{ t(`encodingHelp.${choice}`) }}</span>
              </template>
            </span>
          </label>
        </div>
      </fieldset>

      <!-- 순서 인코딩이 아니면 오른쪽 칸은 왜 비었는지 말한다. 저장된 순서는 남고 쓰이지 않는다. -->
      <p v-if="effective !== 'ordinal'" class="min-w-0 text-ink-soft">
        {{ t('preprocess.columnEncoding.orderOnlyOrdinal') }}
      </p>
      <section v-else class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="font-bold">{{ t('preprocess.columnEncoding.orderTitle') }}</h3>
          <span class="text-ink-soft">
            {{
              categories === undefined
                ? t('preprocess.columnEncoding.orderSorted')
                : t('preprocess.columnEncoding.orderSpecified')
            }}
          </span>
        </div>
        <p class="mt-1 text-ink-soft">{{ t('preprocess.columnEncoding.orderLead') }}</p>
        <!-- 값이 많아도 잠그지 않는다. ↑↓로 못 옮길 만큼 많으면 한 번에 채우는 길이 있다. -->
        <div class="mt-2 flex flex-wrap gap-2">
          <AppButton variant="secondary" @click="fillOrder('ascending')">
            {{ t('preprocess.columnEncoding.fillAscending') }}
          </AppButton>
          <AppButton variant="secondary" @click="fillOrder('descending')">
            {{ t('preprocess.columnEncoding.fillDescending') }}
          </AppButton>
          <AppButton v-if="categories !== undefined" variant="secondary" @click="clearOrder">
            {{ t('preprocess.columnEncoding.clearOrder') }}
          </AppButton>
        </div>
        <p v-if="strays.count > 0" class="mt-1 text-danger">
          {{
            t('preprocess.columnEncoding.strays', strays.count, {
              named: { count: strays.count, values: strayText },
            })
          }}
        </p>

        <!--
          **보이는 줄만 그린다** (`virtual-window.ts`). 줄 높이가 모두 같아야 하므로 값은 한 줄로
          자르고 전체는 `title`로 보인다. 위아래 빈자리가 굴림 막대의 길이를 지킨다.
        -->
        <div
          ref="viewport"
          class="mt-3 max-h-96 overflow-y-auto rounded-card border border-line"
          @scroll="measureList"
        >
          <!--
            **머리글이 있고, 줄은 `원래 값 → 숫자로 바꾼 값`으로 읽힌다** (2026-10-20, 코드 소유자). 번호만
            왼쪽에 있으면 그것이 무엇인지 안 읽힌다 — 이 목록이 보여 주는 것은 값이 **어떤 정수로 인코딩되는가**다.
            낱말은 전처리 미리보기의 두 칸과 같다. 머리글은 상자 맨 위에 붙고, 옮기기 버튼 칸은 폭을
            고정해 머리글과 줄의 칸이 맞는다. 화살표는 자기 칸을 갖고 머리는 비운다(코드 소유자).
          -->
          <div
            class="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-surface px-3 py-2 font-bold text-ink-soft"
          >
            <span class="min-w-0 flex-1">{{ t('preprocess.previewValueRaw') }}</span>
            <!-- 화살표 칸의 머리는 비운다 — 두 값을 잇는 기호라 이름이 없다. -->
            <span class="w-6 shrink-0" aria-hidden="true" />
            <span class="w-24 shrink-0 text-center">{{ t('preprocess.previewValueCode') }}</span>
            <span class="w-24 shrink-0" aria-hidden="true" />
          </div>
          <div :style="{ height: `${listWindow.before}px` }" />
          <ol class="flex flex-col divide-y divide-line">
            <li v-for="row in visible" :key="row.value" class="flex h-12 items-center gap-3 px-3">
              <span class="min-w-0 flex-1 truncate font-bold text-ink" :title="row.value">
                {{ row.value }}
              </span>
              <span class="flex w-6 shrink-0 justify-center">
                <component
                  :is="ACTION_ICONS.encodedAs"
                  :size="16"
                  class="text-ink-faint"
                  aria-hidden="true"
                />
              </span>
              <span class="w-24 shrink-0 text-center font-bold text-ink tabular-nums">
                {{ row.index }}
              </span>
              <span class="flex w-24 shrink-0 justify-end">
                <AppButton
                  variant="ghost"
                  :label="t('common.moveUp')"
                  :lock="lockFor('listTop', { index: row.index })"
                  @click="move(row.index, -1)"
                >
                  <component :is="ACTION_ICONS.moveUp" :size="18" aria-hidden="true" />
                </AppButton>
                <AppButton
                  variant="ghost"
                  :label="t('common.moveDown')"
                  :lock="lockFor('listBottom', { index: row.index, count: shown.length })"
                  @click="move(row.index, 1)"
                >
                  <component :is="ACTION_ICONS.moveDown" :size="18" aria-hidden="true" />
                </AppButton>
              </span>
            </li>
          </ol>
          <div :style="{ height: `${listWindow.after}px` }" />
        </div>
      </section>
    </div>

    <template #actions>
      <AppButton variant="secondary" @click="emit('close')">{{ t('common.cancel') }}</AppButton>
      <AppButton @click="apply">{{ t('preprocess.columnEncoding.apply') }}</AppButton>
    </template>
  </AppDialog>
</template>
