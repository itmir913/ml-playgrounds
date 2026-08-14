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
 * **값을 고쳐서 올려보내므로 되돌릴 거리가 있다** - 상한에 걸리면 부모가 거절하고,
 * 그때 화면이 파일과 다른 글자를 들고 있으면 안 된다. 그래서 요소를 함께 넘긴다
 * (architecture.md §8.15.1).
 */

import { ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppCard from '@/components/AppCard.vue'
import AppField from '@/components/AppField.vue'
import GuidanceText from './GuidanceText.vue'
import { ACTION_ICONS } from '@/icons'
import type { PortfolioSection } from '@/project/portfolio'

const props = defineProps<{
  section: PortfolioSection
  /** 화면에 보이는 번호. 0부터 온다. */
  index: number
  /** 지금 양식의 문항 수. 끝에서 더 못 가는 것을 여기서 안다. */
  count: number
}>()

const emit = defineEmits<{
  answer: [text: string, element: HTMLTextAreaElement]
  title: [text: string, element: HTMLInputElement]
  description: [text: string, element: HTMLTextAreaElement]
  move: [delta: number]
  remove: []
}>()

const { t } = useI18n()

/** 글 칸이 무엇에 대한 답인지는 제목이 말한다. 라벨을 또 만들지 않는다. */
const headingId = useId()

const editing = ref(false)

function onAnswer(event: Event): void {
  const element = event.target as HTMLTextAreaElement
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
</script>

<template>
  <AppCard>
    <div class="flex flex-col gap-3">
      <header class="flex items-start gap-3">
        <span class="mt-0.5 font-bold text-ink-faint tabular-nums">{{ props.index + 1 }}</span>
        <h3 :id="headingId" class="min-w-0 flex-1 text-lg font-bold">{{ props.section.title }}</h3>

        <div class="flex shrink-0 items-center gap-1">
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

      <textarea
        :aria-labelledby="headingId"
        :placeholder="t('portfolio.answerHint')"
        rows="6"
        class="w-full rounded-field border border-line-strong bg-surface px-3 py-2 leading-relaxed"
        :value="props.section.answer"
        @input="onAnswer"
      />
    </div>
  </AppCard>
</template>
