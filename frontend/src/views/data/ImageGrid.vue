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

import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
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
}>()

const { t } = useI18n()
</script>

<template>
  <section class="flex flex-col gap-2 rounded-panel border border-line bg-surface p-4">
    <header class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <h3 class="min-w-0 truncate font-bold text-ink">{{ props.label }}</h3>
      <AppBadge>{{ t('data.image.count', props.entries.length) }}</AppBadge>

      <div class="ml-auto flex items-center gap-3">
        <!--
          **누르는 것이 아니라 고르는 것이다.** 사진 수십 장을 하나씩 누르게 하면
          범주를 옮기는 일이 실제로는 못 하는 일이 된다.
        -->
        <button
          v-if="props.entries.length > 0"
          type="button"
          class="text-base font-bold text-brand hover:underline"
          @click="emit('pickAll')"
        >
          {{ t('data.image.pickAll') }}
        </button>
        <template v-if="!props.unlabeled">
          <button
            type="button"
            class="text-base font-bold text-ink-soft hover:underline"
            @click="emit('rename')"
          >
            {{ t('data.image.rename') }}
          </button>
          <button
            type="button"
            class="text-base font-bold text-ink-soft hover:underline"
            @click="emit('remove')"
          >
            {{ t('data.image.removeCategory') }}
          </button>
        </template>
      </div>
    </header>

    <!--
      **빈 범주도 자리를 갖는다.** 사진이 없다고 칸이 사라지면 학생이 방금 만든 범주가
      화면에서 없어진 것처럼 보인다.
    -->
    <p v-if="props.entries.length === 0" class="py-3 text-base text-ink-faint">
      {{ props.unlabeled ? t('data.image.noUnlabeled') : t('data.image.emptyCategory') }}
    </p>

    <ul v-else class="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
      <li v-for="entry in props.entries" :key="entry.hash">
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
  </section>
</template>
