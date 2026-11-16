<script setup lang="ts">
/**
 * **아직 안 한 일의 점선 윤곽** — HTML 상자·원·칩 안에 겹쳐 그리는 SVG 한 장이다 (`architecture.md` §8.22).
 * 점선 길이를 브라우저가 정하는 `border: dashed` 대신 `stroke-dasharray`로 그려, SVG 층의 윤곽(카드·막대)과
 * **같은 굵기·같은 점선**이 된다(`FLOW_GEOMETRY`의 `pending*`).
 *
 * **상자 가장자리에 정확히 겹친다.** 사각형을 상자 크기 그대로 두고 선을 두 배로 그은 뒤 바깥 절반을 SVG 경계로
 * 자른다 — 남는 안쪽 절반이 `pendingStroke`이고, 상자가 `overflow-hidden`이어도 잘리지 않는다. 글자 뒤에 서도록
 * 상자의 첫 자식으로 둔다.
 */

import { FLOW_GEOMETRY } from '@/ml/flow-layout'

defineProps<{
  /** 모서리 반지름. 원은 `50%`다. */
  radius: number | string
}>()

const G = FLOW_GEOMETRY
const dash = `${G.pendingDashOn} ${G.pendingDashOff}`
</script>

<template>
  <svg class="absolute top-0 left-0" width="100%" height="100%" aria-hidden="true">
    <rect
      class="flow-outline"
      width="100%"
      height="100%"
      :rx="radius"
      :ry="radius"
      :stroke-width="G.pendingStroke * 2"
      :stroke-dasharray="dash"
    />
  </svg>
</template>
