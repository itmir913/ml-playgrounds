<script setup lang="ts">
/**
 * 양식을 어디서 가져올지 (mlpx-spec.md §8.3).
 *
 * **가져오는 곳이 여럿이므로 버튼을 늘리지 않고 팝오버 하나에 담는다.** 목록은
 * 등록부에서 그대로 나온다(`project/portfolio-sources.ts`) - 출처마다 하는 일이
 * "마크다운 문자열 하나를 돌려주는 것"으로 같기 때문에 화면이 경로마다 다른 단추를
 * 만들지 않는다.
 *
 * **시작 화면과 동작 바가 같은 것을 쓴다.** 두 벌이면 한쪽만 고쳐진다.
 *
 * **좁은 화면에서는 그림만 남는다**(`compact`). 동작 바가 두 줄이 되면 그만큼 아래 글
 * 칸이 줄어드는데, 이 화면에서 그건 그냥 손해다 (architecture.md §8.18). 시작 화면에서는
 * 안 켠다 - 거기서는 이 단추가 둘뿐인 갈림길의 한쪽이라 글자가 있어야 한다.
 *
 * **목록은 열 때 붙는다** (`AppPopover`의 패널이 `v-if`다). 그래서 받아 오는 일이
 * 화면에 들어올 때가 아니라 누를 때 일어난다 - `TemplateSourceList`의 머리말에 있다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppPopover from '@/components/AppPopover.vue'
import { ACTION_ICONS } from '@/icons'
import { FALLBACK_LOCALE, isSupportedLocale } from '@/i18n'
import type { Locale } from '@/i18n'
import type { TemplateSourceContext } from '@/project/portfolio-sources'
import TemplateSourceList from './TemplateSourceList.vue'

const props = defineProps<{
  /** 버튼 크기. 시작 화면에서는 옆에 선 [빈 양식에서 시작]과 같아야 한다. */
  size?: 'md' | 'lg'
  /** 파일 하나를 고르게 한다. 화면이 준다 - 등록부도 여기도 DOM을 모른다. */
  pickFile: () => Promise<File | null>
  /** 좁은 화면에서 글자를 접고 그림만 남긴다. 동작 바에서만 켠다. */
  compact?: boolean
}>()

const emit = defineEmits<{
  /**
   * 받아 온 양식과 **그 양식의 언어** (mlpx-spec.md §8.5). 모르는 출처는 `undefined`다.
   *
   * **언어를 여기서 흘리면 양식에 안 박힌다.** 실제로 그랬다 — 이 메뉴만 인자를 하나
   * 받아 되보내고 있었고, 아이패드에서 만든 실물 파일에 `template.locale`이 없었다.
   * 시작 화면(`TemplateSourceList`를 직접 쓴다)은 멀쩡했다.
   */
  pick: [markdown: string | null, locale?: Locale]
  failed: [error: unknown]
}>()

const { t, locale } = useI18n()

const context = computed<TemplateSourceContext>(() => ({
  locale: isSupportedLocale(locale.value) ? locale.value : FALLBACK_LOCALE,
  translate: (key: string) => t(key),
  pickFile: props.pickFile,
}))

function onPick(markdown: string | null, formLocale: Locale | undefined, close: () => void): void {
  emit('pick', markdown, formLocale)
  close()
}
</script>

<template>
  <AppPopover>
    <template #trigger>
      <AppButton variant="secondary" :size="props.size ?? 'md'" :label="t('portfolio.import')">
        <component
          :is="ACTION_ICONS.importForm"
          v-if="props.compact"
          :size="18"
          aria-hidden="true"
        />
        <span :class="props.compact ? 'max-md:hidden' : ''">{{ t('portfolio.import') }}</span>
      </AppButton>
    </template>

    <template #default="{ close }">
      <TemplateSourceList
        :context="context"
        @pick="(markdown, formLocale) => onPick(markdown, formLocale, close)"
        @failed="(error) => emit('failed', error)"
      />
    </template>
  </AppPopover>
</template>
