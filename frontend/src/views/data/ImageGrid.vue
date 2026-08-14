<script setup lang="ts">
/**
 * 범주 하나와 그 안의 사진들. **`ImagePanel`이 범주 수만큼 세운다.**
 *
 * **여기는 프로젝트를 안 고친다.** 고른 것과 누른 것을 위로 올릴 뿐이고, 실제로
 * 옮기고 지우는 것은 판이 한다 — 섹션마다 저장을 부르면 같은 프로젝트에 여러 번
 * 쓰게 되고 마지막 하나만 남는다.
 *
 * **썸네일 주소는 판이 만들어 내려준다.** 여기서 만들면 범주 사이를 옮길 때마다
 * 같은 사진의 주소가 새로 생기고, 놓아주는 자리가 없어 탭을 닫을 때까지 쌓인다.
 */

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import AppButton from '@/components/AppButton.vue'
import { IMAGE_GRID_PAGE_SIZE } from '@/limits'
import type { ImageEntry } from '@/project/images'

const props = defineProps<{
  /** 화면에 보일 이름. `_unlabeled`는 판이 번역해서 내려준다 — 파일 안 이름과 다르다. */
  label: string
  entries: readonly ImageEntry[]
  /** 해시 -> 썸네일 주소. */
  urls: ReadonlyMap<string, string>
  selected: ReadonlySet<string>
  /** 범주가 아니라 상태인 자리인가. 이름 바꾸기·없애기가 없다. */
  unlabeled?: boolean
}>()

const emit = defineEmits<{
  toggle: [hash: string]
  pickAll: []
  rename: []
  remove: []
  /** 이 칸에 사진을 넣겠다는 뜻. 파일 고르기는 판이 연다 — 입구가 하나여야 한다. */
  add: []
  /** 이 칸에 끌어다 놓았다. */
  drop: [files: readonly File[]]
}>()

const { t } = useI18n()

/**
 * 이 칸 위에 무언가 끌고 있는가. **칸마다 따로 든다** — 판 하나가 들면 어느 칸 위에
 * 있는지 화면이 말할 수 없고, 그러면 학생은 사진이 어디로 떨어질지 모른 채 놓는다.
 */
const hovering = ref(false)

function onDrop(event: DragEvent): void {
  hovering.value = false
  const files = [...(event.dataTransfer?.files ?? [])]
  if (files.length > 0) emit('drop', files)
}

/**
 * 지금 쪽. **한 번에 다 그리지 않는다** — 200장짜리 격자는 화면을 통째로 덮어서 범주
 * 사이를 오가는 것이 스크롤 작업이 된다 (`limits.ts`의 `IMAGE_GRID_PAGE_SIZE`).
 */
const page = ref(0)

const totalPages = computed(() =>
  Math.max(1, Math.ceil(props.entries.length / IMAGE_GRID_PAGE_SIZE)),
)

/**
 * 장수가 줄면 지금 쪽이 빈 쪽이 될 수 있다 — 사진을 지우거나 다른 범주로 옮겼을 때다.
 * **그때 빈 격자를 보이면 학생은 사진이 다 사라진 줄 안다.**
 */
watch(totalPages, (count) => {
  if (page.value > count - 1) page.value = count - 1
})

const shown = computed(() =>
  props.entries.slice(page.value * IMAGE_GRID_PAGE_SIZE, (page.value + 1) * IMAGE_GRID_PAGE_SIZE),
)
</script>

<template>
  <!--
    **칸 자체가 떨어뜨리는 자리다** (open-decisions.md "범주를 먼저 만들고 그 칸에
    올린다"). `stop`이 없으면 판의 드롭까지 함께 터져 같은 사진이 두 번 들어온다.
  -->
  <section
    class="flex flex-col gap-2 rounded-panel border bg-surface p-4 transition-colors"
    :class="hovering ? 'border-brand bg-brand-soft' : 'border-line'"
    @dragover.prevent.stop="hovering = true"
    @dragleave.stop="hovering = false"
    @drop.prevent.stop="onDrop"
  >
    <header class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <h3 class="min-w-0 truncate font-bold text-ink">{{ props.label }}</h3>
      <AppBadge>{{ t('data.image.count', props.entries.length) }}</AppBadge>

      <!--
        **글자 버튼은 안쪽 여백을 되당긴다.** `AppButton`의 `px-4`가 그대로 서면 글자
        사이가 44px이 되어 넷이 흩어져 보인다 - 눌리는 자리는 그대로 두고 자리만
        글자 폭으로 되돌린다 (`ChosenModels`의 `-my-2.5`와 같은 손질이다).
      -->
      <div class="ml-auto flex items-center gap-1">
        <!-- **이 칸으로 바로 들어간다.** 올린 뒤 다시 골라 옮기는 걸음이 없어진다. -->
        <AppButton variant="ghost" class="-mx-2 -my-2.5" @click="emit('add')">
          {{ t('data.image.addHere') }}
        </AppButton>
        <!--
          **누르는 것이 아니라 고르는 것이다.** 사진 수십 장을 하나씩 누르게 하면
          범주를 옮기는 일이 실제로는 못 하는 일이 된다.
        -->
        <AppButton
          v-if="props.entries.length > 0"
          variant="ghost"
          class="-mx-2 -my-2.5"
          @click="emit('pickAll')"
        >
          {{ t('data.image.pickAll') }}
        </AppButton>
        <template v-if="!props.unlabeled">
          <AppButton variant="ghost" class="-mx-2 -my-2.5" @click="emit('rename')">
            {{ t('data.image.rename') }}
          </AppButton>
          <AppButton variant="ghost" class="-mx-2 -my-2.5" @click="emit('remove')">
            {{ t('data.image.removeCategory') }}
          </AppButton>
        </template>
      </div>
    </header>

    <!--
      **빈 범주도 자리를 갖는다.** 사진이 없다고 칸이 사라지면 학생이 방금 만든 범주가
      화면에서 없어진 것처럼 보인다.
    -->
    <!--
      **빈 칸에 높이를 준다.** 한 줄짜리 문장만 두면 떨어뜨릴 자리가 손가락만 해서
      끌어다 놓기가 사실상 못 하는 동작이 된다 — 이 칸은 안내문이 아니라 **과녁**이다.
      점선은 "여기가 받는 자리"라는 말이고, 사진이 들어오면 격자가 그 말을 대신한다.

      **`범주 없음` 칸은 여기로 오지 않는다** — 판이 0장이면 그 칸을 아예 안 그린다.
      그래서 이 자리에 그 칸을 위한 문장을 따로 두지 않는다. 두었더니 아무도 못 보는
      문장이 두 언어에 남아 있었다.
      **사진 한 줄이 서는 높이만큼 준다** — 채워졌을 때와 비었을 때 칸 크기가 크게
      달라지면, 사진을 넣는 순간 옆 칸이 밀려 화면이 흔들린다.
    -->
    <div
      v-if="props.entries.length === 0"
      class="grid min-h-64 place-items-center rounded-control border-2 border-dashed border-line px-4 py-6 text-center text-base text-ink-faint"
    >
      {{ t('data.image.emptyCategory') }}
    </div>

    <!--
      **열 수를 여기서 세지 않는다** (`photo-grid`). 이 컴포넌트는 자기가 반쪽 칸으로
      섰는지 온 칸으로 섰는지 모르고, 알 필요도 없다 — 폭을 보고 열이 정해진다.
    -->
    <ul v-else class="photo-grid grid gap-2">
      <li v-for="entry in shown" :key="entry.hash">
        <!--
          **테두리는 늘 있고 색만 바뀐다** (AppChoices와 같은 이유) — 고른 것만 테두리를
          주면 안쪽 크기가 상태에 따라 달라져 격자가 한 픽셀씩 움직인다.
        -->
        <button
          type="button"
          class="block w-full overflow-hidden rounded-control border-2 transition-colors"
          :class="props.selected.has(entry.hash) ? 'border-brand' : 'border-transparent'"
          :aria-pressed="props.selected.has(entry.hash)"
          @click="emit('toggle', entry.hash)"
        >
          <!--
            **`loading="lazy"`가 아니면 저사양 교실 PC가 멈춘다.** 사진 수백 장의 디코딩이
            한 번에 몰린다. `aspect-square`인 이유는 정본이 정사각형이기 때문이다.
          -->
          <img
            :src="props.urls.get(entry.hash)"
            :alt="props.label"
            loading="lazy"
            class="aspect-square w-full bg-surface-sunken object-cover"
          />
        </button>
      </li>
    </ul>

    <!--
      **쪽이 하나뿐이면 안 그린다.** 아무 데도 못 가는 버튼 둘은 학생에게 고장으로 보인다.
      [전체 선택]은 이 칸 전체를 고르지 이 쪽만 고르지 않는다 — 쪽은 보는 단위이지
      고르는 단위가 아니다.
    -->
    <div v-if="totalPages > 1" class="flex items-center justify-between gap-4">
      <AppButton variant="secondary" :disabled="page === 0" @click="page -= 1">
        {{ t('common.prevPage') }}
      </AppButton>
      <p class="tabular-nums text-ink-soft">{{ page + 1 }} / {{ totalPages }}</p>
      <AppButton variant="secondary" :disabled="page >= totalPages - 1" @click="page += 1">
        {{ t('common.nextPage') }}
      </AppButton>
    </div>
  </section>
</template>
