<script setup lang="ts">
/**
 * [사진 추가] 메뉴 (open-decisions.md 67, 결정 1·2·6). 선례는 양식 가져오기의 `TemplateSourceMenu`다
 * — `AppPopover` 하나에 등록부의 줄을 그대로 그린다(`ImageSourceList`).
 *
 * **데이터·예측 두 화면이 같은 것을 쓴다.** 데이터 화면은 툴바·빈 상태·범주 칸마다 이것을 하나씩
 * 그린다. 그래서 **손(`context`)은 여기서 짓지 않고 판에서 받는다** — 메뉴마다 지으면 그림 이름
 * 발급기가 메뉴마다 생긴다(`composables/useImageSources.ts`).
 *
 * **선례와 갈리는 한 곳 (감사 A-1).** 목록은 고른 줄만 올리고, 여기서 **팝오버를 먼저 닫은 뒤**
 * 그 줄의 `load`를 기다린다. 목록 안에서 기다리면 그리기 창을 누르는 순간 팝오버가 닫히며 목록이
 * 떨어져 나가고, 그 뒤의 `emit`은 버려진다.
 *
 * **받은 것은 `emit`이 아니라 판이 준 함수(`pick`)로 넘긴다.** 이 메뉴도 기다리는 사이에 떨어져
 * 나갈 수 있다 — 그리는 동안 붙여넣으면 데이터 화면의 툴바가 확인 판 요약으로 바뀌며 이 메뉴가
 * 내려간다. 내려간 부품의 `emit`은 버려지지만, 판이 준 함수는 살아 있는 판의 것이다. 무는 검사:
 * `image-source-menu.spec.ts` "그리는 동안 메뉴가 내려가도 그린 것이 닿는다".
 *
 * **어디로 들어가는지 말하지 않는다** (코드 소유자 지시) — 팝오버 안에는 줄만 선다.
 */

import AppButton from '@/components/AppButton.vue'
import AppPopover from '@/components/AppPopover.vue'
import type { ImageSourceContext, ImageSourceRow, PickImages } from '@/data/image/sources'
import type { Lock } from '@/locks'
import { useToastStore } from '@/stores/toasts'
import ImageSourceList from './ImageSourceList.vue'

const props = defineProps<{
  /** 트리거의 이름. 범주 칸은 [여기에 사진 추가]다. */
  label: string
  /** 판의 손. 판 하나에 한 벌이다(`useImageSources`). */
  context: ImageSourceContext
  /** 받은 묶음을 넘길 곳. 판이 준다 — 머리말의 "`emit`이 아니라". */
  pick: PickImages
  /** 트리거의 잠금. 지금 화면의 [사진 추가] 버튼이 받던 그것이다. */
  lock?: Lock | undefined
  variant?: 'primary' | 'secondary' | 'ghost'
  size?: 'md' | 'lg'
}>()

const toasts = useToastStore()

async function choose(row: ImageSourceRow, close: () => void): Promise<void> {
  // **먼저 닫는다** — 머리말의 감사 A-1. 받아 오는 동안 팝오버가 떠 있을 이유도 없다.
  close()
  try {
    const files = await row.load()
    if (files !== null) props.pick(files, { appends: row.appends })
  } catch (error) {
    toasts.pushError(error)
  }
}
</script>

<template>
  <AppPopover>
    <template #trigger>
      <AppButton
        :variant="props.variant ?? 'secondary'"
        :size="props.size ?? 'md'"
        :lock="props.lock"
      >
        {{ props.label }}
      </AppButton>
    </template>

    <template #default="{ close }">
      <ImageSourceList
        :context="props.context"
        :lock="props.lock"
        @choose="(row) => void choose(row, close)"
        @failed="toasts.pushError"
      />
    </template>
  </AppPopover>
</template>
