<script setup lang="ts">
/**
 * 답에 붙은 사진들 (mlpx-spec.md §8.3).
 *
 * **작성 화면과 완성본이 같은 것을 쓴다.** 다른 점은 뗄 수 있느냐 하나뿐이라 프롭
 * 하나로 가른다 - 두 벌이면 한쪽만 고쳐진다.
 *
 * **비어 있으면 아무것도 안 그린다.** 사진을 안 붙인 문항이 대부분이고, 빈 자리가
 * 문항마다 있으면 글 칸 아래가 계속 헐렁하다.
 */

import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import { ACTION_ICONS } from '@/icons'

const props = defineProps<{
  photos: readonly { readonly path: string; readonly url: string }[]
  /** 뗄 수 있는가. 완성본에서는 읽기만 한다. */
  removable?: boolean
}>()

const emit = defineEmits<{ remove: [path: string] }>()

const { t } = useI18n()
</script>

<template>
  <ul v-if="props.photos.length > 0" class="flex flex-wrap gap-3">
    <li v-for="photo in props.photos" :key="photo.path" class="relative">
      <!--
        **대체 텍스트를 지어내지 않는다.** 무엇이 찍혔는지는 우리가 모르고, 답이 그
        자리에서 이미 말하고 있다.
      -->
      <img
        :src="photo.url"
        :alt="t('portfolio.photoAlt')"
        class="max-h-64 rounded-panel border border-line"
      />

      <div v-if="props.removable" class="absolute top-1 right-1">
        <AppButton
          variant="secondary"
          :label="t('portfolio.removePhoto')"
          @click="emit('remove', photo.path)"
        >
          <component :is="ACTION_ICONS.remove" :size="18" aria-hidden="true" />
        </AppButton>
      </div>
    </li>
  </ul>
</template>
