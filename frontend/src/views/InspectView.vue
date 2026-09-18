<script setup lang="ts">
/**
 * **점검** — 교사가 제출물을 열어 보는 화면 (architecture.md §8.21).
 *
 * 이 판은 명렬까지다. 고른 파일의 열람·무결성·재실행 대조는 이어서 붙는다.
 *
 * **읽기 전용이다.** 원본 `.mlpx`를 고칠 길을 안 만든다 — 저장도, 내려받기도, 탭 잠금도
 * 여기서 안 부른다 (`tests/inspect-rules.spec.ts`가 지킨다).
 *
 * **입구는 둘이고 경로는 하나다.** 폴더째 고르든 파일 하나를 고르든 같은 명렬을 지난다 —
 * 항목이 하나뿐이면 자동으로 골라 손이 한 번 준다.
 */

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import { useRoster } from '@/composables/useRoster'
import { errorMessageKey, type ClientErrorCode } from '@/errors'
import { ACTION_ICONS } from '@/icons'
import { MLPX_EXTENSION } from '@/project/format'
import { rosterOf, type RosterItem } from '@/project/roster'

const { t } = useI18n()
const roster = useRoster()

const folderInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

/** 지금 보고 있는 줄. **명렬이 갈리면 비운다** — 없는 줄을 가리키고 있을 수 없다. */
const opened = ref<RosterItem | null>(null)

/**
 * 고른 것을 명렬로 바꾼다. **입구 둘이 여기서 하나가 된다.**
 *
 * 입력 요소의 값을 비우는 이유는 **같은 폴더를 다시 고를 수 있어야 하기 때문**이다 —
 * 안 비우면 두 번째 선택에서 `change`가 안 온다.
 */
function pick(event: Event): void {
  const input = event.target as HTMLInputElement
  const picked = rosterOf([...(input.files ?? [])])
  input.value = ''
  roster.show(picked)
}

/** 항목이 하나뿐이면 자동으로 고른다. 경로는 같고 누르는 손이 한 번 준다. */
watch(roster.items, (items) => {
  opened.value = null
  const only = items.length === 1 ? items[0] : undefined
  if (only) select(only)
})

/**
 * 이 줄을 본다. **기다리지 않는다** — 고르는 순간 오른쪽이 `읽는 중`으로 서고, 요약이
 * 도착하면 그 자리가 채워진다. 여기서 `await`하면 누른 것이 화면에 늦게 반영된다.
 */
function select(item: RosterItem): void {
  opened.value = item
  void roster.readNow(item)
}

const summaryOfOpened = computed(() =>
  opened.value ? roster.summaries.value.get(opened.value.label) : undefined,
)

/** 몇 줄까지 읽었는가. 훑는 동안 교사가 기다림의 크기를 안다. */
const progress = computed(() => ({
  read: roster.summaries.value.size,
  total: roster.items.value.length,
}))

/**
 * 명렬에 그릴 줄들. **판단을 템플릿에 두지 않는다** — 상태 셋(읽는 중·읽음·못 읽음)이
 * `v-if` 사슬로 흩어지면 그중 하나가 빠져도 아무도 모른다.
 */
const rows = computed(() =>
  roster.items.value.map((item) => {
    const summary = roster.summaries.value.get(item.label)
    if (!summary) return { item, note: t('inspect.reading'), faint: true }
    if (summary.state === 'unreadable') return { item, note: t('inspect.unreadable'), faint: true }
    return {
      item,
      note: t('inspect.line', {
        student: summary.student ?? t('inspect.noStudent'),
        experiments: summary.experiments,
      }),
      faint: false,
    }
  }),
)

/** 못 읽은 줄의 사유 문장. **코드를 화면이 문장으로 바꾼다** (CLAUDE.md §1.4). */
function reasonOf(code: string): string {
  return t(errorMessageKey(code as ClientErrorCode))
}
</script>

<template>
  <div class="flex min-h-full flex-col gap-5 p-4 sm:p-5">
    <header class="flex flex-col gap-2">
      <h2 class="text-2xl font-black tracking-tight">{{ t('inspect.title') }}</h2>
      <p class="leading-relaxed text-ink-soft">{{ t('inspect.lead') }}</p>
    </header>

    <!--
      **입구 둘을 나란히 둔다** (§8의 "같은 규칙의 두 모양"). 휴대폰에는 폴더 고르기가
      없으므로 폴백이 아니라 나란한 길이고, 둘 다 같은 명렬로 들어간다.
    -->
    <div class="flex flex-wrap gap-3">
      <AppButton @click="folderInput?.click()">
        <component :is="ACTION_ICONS.openFile" :size="20" aria-hidden="true" />
        {{ t('inspect.pickFolder') }}
      </AppButton>
      <AppButton variant="secondary" @click="fileInput?.click()">
        <component :is="ACTION_ICONS.openFile" :size="20" aria-hidden="true" />
        {{ t('inspect.pickFiles') }}
      </AppButton>
    </div>

    <input
      ref="fileInput"
      type="file"
      multiple
      :accept="MLPX_EXTENSION"
      class="hidden"
      @change="pick"
    />
    <!--
      **폴더 입구를 따로 둔다** (데이터 화면의 사진 입구와 같은 관용구). 같은 입력에
      `webkitdirectory`를 걸면 파일 몇 개만 고르는 길이 없어진다.
    -->
    <input ref="folderInput" type="file" webkitdirectory class="hidden" @change="pick" />

    <p v-if="roster.items.value.length === 0" class="text-ink-soft">
      {{ t('inspect.empty') }}
    </p>

    <div v-else class="grid gap-4 md:grid-cols-5">
      <!-- 왼쪽: 명렬. 파일 하나가 한 줄이다. -->
      <section class="min-w-0 md:col-span-2">
        <h3 class="mb-2 font-bold text-ink-soft">
          {{ t('inspect.roster', { read: progress.read, total: progress.total }) }}
        </h3>
        <ul class="flex flex-col overflow-hidden rounded-panel border border-line bg-surface">
          <!--
            **못 여는 파일도 줄을 갖는다.** 조용히 빠지면 교사는 그 제출물이 없는 것으로
            읽고, 그것이 이 화면이 가장 하면 안 되는 일이다.
          -->
          <li
            v-for="(row, index) in rows"
            :key="row.item.label"
            :class="index > 0 ? 'border-t border-line' : ''"
          >
            <button
              type="button"
              class="flex w-full flex-col gap-1 p-3 text-left hover:bg-surface-soft"
              :class="opened?.label === row.item.label ? 'bg-surface-soft font-bold' : ''"
              @click="select(row.item)"
            >
              <span class="truncate">{{ row.item.label }}</span>
              <span :class="row.faint ? 'text-ink-faint' : 'text-ink-soft'">{{ row.note }}</span>
            </button>
          </li>
        </ul>
      </section>

      <!-- 오른쪽: 고른 하나. 열람과 대조가 이 자리에 붙는다. -->
      <section class="min-w-0 rounded-panel border border-line bg-surface p-4 md:col-span-3">
        <p v-if="!opened" class="text-ink-soft">{{ t('inspect.pickOne') }}</p>
        <template v-else-if="summaryOfOpened?.state === 'read'">
          <h3 class="truncate text-xl font-black">{{ summaryOfOpened.name }}</h3>
          <dl class="mt-3 flex flex-col gap-1.5">
            <div class="flex justify-between gap-4">
              <dt class="font-bold text-ink-soft">{{ t('inspect.student') }}</dt>
              <dd>{{ summaryOfOpened.student ?? t('inspect.noStudent') }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="font-bold text-ink-soft">{{ t('meta.dataType') }}</dt>
              <dd>{{ t(`dataTypes.${summaryOfOpened.dataType}`) }}</dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="font-bold text-ink-soft">{{ t('inspect.experiments') }}</dt>
              <dd class="tabular-nums">
                {{ t('meta.countUnit', summaryOfOpened.experiments) }}
              </dd>
            </div>
            <div class="flex justify-between gap-4">
              <dt class="font-bold text-ink-soft">{{ t('inspect.runs') }}</dt>
              <dd class="tabular-nums">{{ t('meta.countUnit', summaryOfOpened.runs) }}</dd>
            </div>
          </dl>
        </template>
        <p v-else-if="summaryOfOpened?.state === 'unreadable'" class="leading-relaxed">
          {{ reasonOf(summaryOfOpened.code) }}
        </p>
        <p v-else class="text-ink-soft">{{ t('inspect.reading') }}</p>
      </section>
    </div>
  </div>
</template>
