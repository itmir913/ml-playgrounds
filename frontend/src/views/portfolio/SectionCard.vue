<script setup lang="ts">
/**
 * 문항 하나. **번호가 붙고 제목이 크고 굵다. 그 아래 안내문, 그 아래 글 칸이다**
 * (mlpx-spec.md §8.3).
 *
 * **문항은 마음대로 고친다** - 받아 온 양식의 문항도 같다. 막을 근거가 없다: 이 도구는
 * 누구의 것도 아닌 놀이터이고, "받은 양식은 받은 대로"를 강제할 권한이 우리에게 없다.
 *
 * **고치기는 자리를 따로 연다.** 제목과 안내문을 늘 입력 칸으로 두면 이 화면이 글 쓰는
 * 자리가 아니라 양식 만드는 자리로 읽힌다 - 여기서 대부분의 시간에 하는 일은 답을 쓰는
 * 것이다.
 *
 * **안내문은 마크다운이다.** 목록·표·강조가 살아나고, 그리는 것과 살균은
 * `GuidanceText`가 한다 (mlpx-spec.md §8.1).
 *
 * **쓰는 중인 문항이 한 덩어리로 켜진다** (architecture.md §8.18.1). 조건은 스크롤이
 * 아니라 **포커스**다 - 굴리기만 해도 켜지면 시끄럽고, 무엇보다 **보고 있는 것과 쓰고
 * 있는 것은 다르다.** 색은 전부 토큰이다(`brand`·`brand-line`·`brand-soft`).
 *
 * **도구는 손이 가 있을 때만 뜬다** (`tools-on-demand`). 문항이 열넷이면 도구 넷이
 * 열네 벌 늘 떠 있다. **터치 기기에서는 언제나 보인다** - 손가락에는 hover가 없다.
 *
 * **값을 고쳐서 올려보내므로 되돌릴 거리가 있다** - 상한에 걸리면 부모가 거절하고,
 * 그때 화면이 파일과 다른 글자를 들고 있으면 안 된다. 그래서 요소를 함께 넘긴다
 * (architecture.md §8.15.1).
 */

import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppField from '@/components/AppField.vue'
import GuidanceText from './GuidanceText.vue'
import { ACTION_ICONS } from '@/icons'
import { imagesFromClipboard } from '@/project/attachments'
import { growToFit } from '@/screen'
import type { PortfolioSection } from '@/project/portfolio'
import PhotoCards from './PhotoCards.vue'

const props = defineProps<{
  section: PortfolioSection
  /** 화면에 보이는 번호. 0부터 온다. */
  index: number
  /** 지금 양식의 문항 수. 끝에서 더 못 가는 것을 여기서 안다. */
  count: number
  /** 이 문항에 붙은 사진. 미리보기 주소는 화면이 만들어 넘긴다. */
  photos: readonly { readonly path: string; readonly url: string }[]
}>()

const emit = defineEmits<{
  answer: [text: string, element: HTMLTextAreaElement]
  title: [text: string, element: HTMLInputElement]
  description: [text: string, element: HTMLTextAreaElement]
  move: [delta: number]
  remove: []
  attach: [files: readonly File[]]
  detach: [path: string]
}>()

const { t } = useI18n()

/** 글 칸이 무엇에 대한 답인지는 제목이 말한다. 라벨을 또 만들지 않는다. */
const headingId = useId()

const editing = ref(false)

/** 두 자리로 맞춘 번호. 읽기 화면의 여백 번호와 같은 표기다 (§8.18.1). */
const number = computed(() => String(props.index + 1).padStart(2, '0'))

/**
 * 답 칸. **내용만큼 자란다** (architecture.md §8.18) - 그래서 높이를 여기서 만진다.
 *
 * 밖에서 값이 바뀌는 길이 둘이다: 다른 문항으로 갈려 이 카드가 다시 쓰일 때와, 상한에
 * 걸려 부모가 되돌릴 때다. 앞은 프롭이 바뀌고 뒤는 DOM만 바뀌므로 **부모도 같은 함수를
 * 부른다** (`PortfolioView`의 되돌리기).
 */
const answerBox = ref<HTMLTextAreaElement | null>(null)

function fit(): void {
  const element = answerBox.value
  if (element !== null) growToFit(element)
}

onMounted(fit)
watch(
  () => props.section.answer,
  () => void nextTick(fit),
)

function onAnswer(event: Event): void {
  const element = event.target as HTMLTextAreaElement
  growToFit(element)
  emit('answer', element.value, element)
}

function onTitle(event: Event): void {
  const element = event.target as HTMLInputElement
  emit('title', element.value, element)
}

function onDescription(event: Event): void {
  const element = event.target as HTMLTextAreaElement
  emit('description', element.value, element)
}

/** 사진을 고르는 칸. 카드마다 하나다 - 어느 문항에 붙는지가 자리로 정해진다. */
const photoInput = ref<HTMLInputElement | null>(null)

function pickPhotos(): void {
  const input = photoInput.value
  if (input === null) return
  // 같은 사진을 다시 골라도 `change`가 오게 한다.
  input.value = ''
  input.click()
}

function onPicked(event: Event): void {
  const input = event.target as HTMLInputElement
  emit('attach', [...(input.files ?? [])])
}

/**
 * 글 칸에 붙여넣기. **캡처를 붙이는 것이 실제로 필요한 전부다.**
 *
 * 글을 붙여넣을 때는 아무 일도 일어나면 안 되므로 이미지가 하나라도 있을 때만
 * 가로챈다 - 안 그러면 복사한 글이 칸에 안 들어간다.
 */
function onPaste(event: ClipboardEvent): void {
  const images = imagesFromClipboard(event.clipboardData)
  if (images.length === 0) return
  event.preventDefault()
  emit('attach', images)
}
</script>

<template>
  <AppCard
    class="group transition-shadow focus-within:border-brand focus-within:ring-2 focus-within:ring-brand-line"
  >
    <div class="flex flex-col gap-3">
      <header class="flex items-center gap-3">
        <!-- 번호는 배지다. 읽기 화면의 여백 번호와 같은 표기를 쓴다 (§8.18.1). -->
        <span
          class="inline-flex size-8 shrink-0 items-center justify-center rounded-control font-bold tabular-nums transition-colors bg-surface-sunken text-ink-soft group-focus-within:bg-brand-soft group-focus-within:text-brand"
        >
          {{ number }}
        </span>
        <h3 :id="headingId" class="min-w-0 flex-1 text-lg font-bold">{{ props.section.title }}</h3>

        <!-- 굴리면서도 남은 문항이 보여야 한다. 목차는 좁은 화면에서 맨 위에만 있다. -->
        <component
          :is="ACTION_ICONS.written"
          v-if="props.section.answer.trim() !== ''"
          :size="18"
          class="shrink-0 text-positive"
          aria-hidden="true"
        />

        <div
          class="flex shrink-0 items-center gap-1 tools-on-demand group-hover:opacity-100 group-focus-within:opacity-100"
        >
          <AppButton
            variant="ghost"
            :label="t('portfolio.moveUp')"
            :disabled="props.index === 0"
            @click="emit('move', -1)"
          >
            <component :is="ACTION_ICONS.moveUp" :size="18" aria-hidden="true" />
          </AppButton>
          <AppButton
            variant="ghost"
            :label="t('portfolio.moveDown')"
            :disabled="props.index === props.count - 1"
            @click="emit('move', 1)"
          >
            <component :is="ACTION_ICONS.moveDown" :size="18" aria-hidden="true" />
          </AppButton>
          <AppButton
            variant="ghost"
            :label="t('portfolio.editSection')"
            @click="editing = !editing"
          >
            <component :is="ACTION_ICONS.editSection" :size="18" aria-hidden="true" />
          </AppButton>
          <AppButton variant="ghost" :label="t('portfolio.remove')" @click="emit('remove')">
            <component :is="ACTION_ICONS.remove" :size="18" aria-hidden="true" />
          </AppButton>
        </div>
      </header>

      <div v-if="editing" class="flex flex-col gap-3 rounded-panel bg-surface-sunken p-4">
        <AppField :label="t('portfolio.sectionTitle')">
          <template #default="field">
            <input
              v-bind="field"
              type="text"
              class="w-full rounded-field border border-line-strong bg-surface px-3 py-2"
              :value="props.section.title"
              @input="onTitle"
            />
          </template>
        </AppField>

        <AppField :label="t('portfolio.sectionDescription')">
          <template #default="field">
            <textarea
              v-bind="field"
              rows="3"
              class="w-full rounded-field border border-line-strong bg-surface px-3 py-2"
              :value="props.section.description ?? ''"
              @input="onDescription"
            />
          </template>
        </AppField>
      </div>

      <!-- 안내문은 읽는 것이다. 살균은 `renderGuidance` 한 곳에서 한다 (§8.1). -->
      <GuidanceText
        v-else-if="props.section.description !== undefined"
        :markdown="props.section.description"
      />

      <!--
        **상자가 아니라 왼쪽 세로선이다** (architecture.md §8.18). 포커스 표시는 카드가
        통째로 갖는다(테두리 + 링) - 그래서 여기서는 **선의 색만** 바뀐다. 굵기를 건드리면
        칸의 안쪽 폭이 상태에 따라 달라진다(`AppButton`의 같은 규칙).
      -->
      <textarea
        ref="answerBox"
        :aria-labelledby="headingId"
        :placeholder="t('portfolio.answerHint')"
        class="w-full resize-none border-l-2 border-line bg-transparent py-1 pl-4 leading-relaxed min-h-16 focus:border-brand focus:outline-none"
        :value="props.section.answer"
        @input="onAnswer"
        @paste="onPaste"
      />

      <!--
        **사진은 답 아래에 카드로 붙는다. 문단 중간에는 못 꽂는다** (mlpx-spec.md §8.3).
        중간 삽입을 포기하면 글 편집기를 만들 일이 없어진다.
      -->
      <PhotoCards :photos="props.photos" removable @remove="(path) => emit('detach', path)" />

      <div>
        <AppButton variant="secondary" :action="() => pickPhotos()">
          <component :is="ACTION_ICONS.addPhoto" :size="18" aria-hidden="true" />
          {{ t('portfolio.addPhoto') }}
        </AppButton>
        <input
          ref="photoInput"
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          @change="onPicked"
        />
      </div>
    </div>
  </AppCard>
</template>
