<script setup lang="ts">
/**
 * 표의 껍데기. **내용은 넘겨받는다** — `<thead>`와 `<tbody>`를 슬롯에 그대로 넣는다.
 *
 * 열 정의를 props로 받는 표를 만들지 않았다. 이 앱의 표는 셋인데 셋 다 다르게
 * 생겼다 — 데이터 미리보기(넓고 스크롤), 모델 비교(정렬·강조), 혼동 행렬(축이 둘).
 * 공통인 것은 넘칠 때의 처리와 줄 색뿐이라 거기까지만 묶는다.
 *
 * **가로로는 이 안에서만 넘친다.** 표 하나 때문에 화면 전체가 옆으로 밀리면
 * 휴대폰에서 못 쓴다.
 *
 * 숫자는 `tabular-nums`로 자릿수를 맞춘다. 지표가 세로로 늘어서는 화면에서
 * 자릿수가 흔들리면 비교가 안 된다.
 */
</script>

<template>
  <div class="overflow-x-auto rounded-panel border border-line">
    <table
      class="w-full border-collapse text-left text-sm tabular-nums [&_td]:border-t [&_td]:border-line [&_td]:px-4 [&_td]:py-3 [&_th]:bg-surface-sunken [&_th]:px-4 [&_th]:py-3 [&_th]:font-bold [&_th]:whitespace-nowrap [&_th]:text-ink-soft"
    >
      <slot />
    </table>
  </div>
</template>
