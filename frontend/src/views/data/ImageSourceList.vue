<script setup lang="ts">
/**
 * 사진을 받아 올 곳들. **등록부에서 나온 줄을 그대로 그린다** (`data/image/sources.ts`,
 * open-decisions.md 67). 선례는 양식 가져오기의 `TemplateSourceList`다.
 *
 * **선례와 갈리는 한 곳 — 고른 줄만 올리고 받아 오지 않는다** (계획 2.2, 감사 A-1). 양식 목록은
 * `emit('pick', await row.load())`인데, 여기서 그렇게 하면 [그리기]가 띄운 창을 누르는 순간
 * `AppPopover`가 바깥 `pointerdown`으로 닫히며 이 목록을 떼어 내고, Vue는 떼어 낸 부품의 `emit`을
 * 버린다 — **그린 사진이 말없이 사라진다.** 받아 오는 것은 팝오버 밖에 사는 메뉴(`ImageSourceMenu`)가
 * 한다. 무는 검사: `image-source-menu.spec.ts` "팝오버가 닫혀도 그린 것이 닿는다".
 *
 * **무게를 단추 모양으로 옮기는 표가 여기 있는 전부다.** 어느 줄이 앞서는지는 등록부가 정한다.
 * `subtle`이 아니라 `secondary`인 이유는 `TemplateSourceList`와 같다(흰 면 위의 옅은 단추는 꺼진
 * 것으로 읽힌다).
 */

import { onMounted, ref } from 'vue'

import AppButton from '@/components/AppButton.vue'
import {
  imageSourceRows,
  type ImageSourceContext,
  type ImageSourceRow,
  type ImageSourceWeight,
} from '@/data/image/sources'
import type { Lock } from '@/locks'

const props = defineProps<{
  context: ImageSourceContext
  /**
   * 메뉴 트리거와 같은 잠금. **줄도 잠근다** — 잠긴 단추는 포인터를 안 받아 누름이 `AppPopover`의
   * 트리거 상자로 떨어지고 팝오버가 열린다(`StepRail`의 잠긴 칸이 이것을 쓴다). 사람 확인(브라우저).
   */
  lock?: Lock | undefined
}>()

const emit = defineEmits<{
  /** 고른 줄. **받아 오지 않고 올리기만 한다** — 머리말. */
  choose: [row: ImageSourceRow]
  failed: [error: unknown]
}>()

/** 무게 -> 단추 모양. **표 하나다** - 변종을 고르는 `if`를 화면에 두지 않는다. */
const VARIANTS: Readonly<Record<ImageSourceWeight, 'primary' | 'secondary'>> = {
  lead: 'primary',
  normal: 'secondary',
}

const rows = ref<ImageSourceRow[]>([])

onMounted(async () => {
  const { rows: found, failures } = await imageSourceRows(props.context)
  rows.value = found
  for (const failure of failures) emit('failed', failure)
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <AppButton
      v-for="row in rows"
      :key="row.key"
      :variant="VARIANTS[row.weight]"
      :lock="props.lock"
      @click="emit('choose', row)"
    >
      {{ row.label }}
    </AppButton>
  </div>
</template>
