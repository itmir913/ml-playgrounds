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
 * **오래 걸리는 것은 `action`으로 준다** - 프리셋은 네트워크를 타므로 두 번 눌릴 수
 * 있고, `@click`은 그것을 막지 못한다 (CLAUDE.md §4).
 */

import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppPopover from '@/components/AppPopover.vue'
import { TEMPLATE_SOURCES, type TemplateSource } from '@/project/portfolio-sources'

const props = defineProps<{
  /** 버튼 크기. 시작 화면에서는 옆에 선 [빈 양식에서 시작]과 같아야 한다. */
  size?: 'md' | 'lg'
  load: (source: TemplateSource) => Promise<void>
}>()

const { t } = useI18n()

async function pick(source: TemplateSource, close: () => void): Promise<void> {
  await props.load(source)
  close()
}
</script>

<template>
  <AppPopover>
    <template #trigger>
      <AppButton variant="secondary" :size="props.size ?? 'md'">
        {{ t('portfolio.import') }}
      </AppButton>
    </template>

    <template #default="{ close }">
      <div class="flex flex-col gap-2">
        <AppButton
          v-for="source in TEMPLATE_SOURCES"
          :key="source.id"
          variant="subtle"
          :action="() => pick(source, close)"
        >
          {{ t(`portfolio.source.${source.id}`) }}
        </AppButton>
      </div>
    </template>
  </AppPopover>
</template>
