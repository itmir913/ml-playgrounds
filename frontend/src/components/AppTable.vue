<script setup lang="ts">
/**
 * 표의 껍데기. **내용은 넘겨받는다** — `<thead>`와 `<tbody>`를 슬롯에 그대로 넣는다.
 *
 * 열 정의를 props로 받는 표를 만들지 않았다. 이 앱의 표는 아홉인데 하나도 같은 모양이
 * 없다 — 데이터 미리보기(넓고 스크롤), 열 고르기(라디오·체크박스와 머리글 팝오버),
 * 모델 비교(정렬·강조), 혼동 행렬(축이 둘), 일괄 예측(줄무늬와 칸 색칠).
 * 공통인 것은 넘칠 때의 처리와 줄 색뿐이라 거기까지만 묶는다.
 *
 * **가로로는 이 안에서만 넘친다.** 표 하나 때문에 화면 전체가 옆으로 밀리면
 * 휴대폰에서 못 쓴다.
 *
 * 숫자는 `tabular-nums`로 자릿수를 맞춘다. 지표가 세로로 늘어서는 화면에서
 * 자릿수가 흔들리면 비교가 안 된다.
 *
 * 칸의 모양은 `data-table` 유틸리티에 있다(styles/utilities.css). **템플릿에는 Tailwind 기본
 * 클래스만 둔다** - `[&_th]` 같은 임의 변형을 흩뿌리면 읽을 수도 고칠 수도 없어진다.
 */
</script>

<template>
  <div class="overflow-auto rounded-panel border border-line">
    <table class="data-table w-full border-collapse text-left tabular-nums">
      <slot />
    </table>
  </div>
</template>
