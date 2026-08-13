<script setup lang="ts">
/**
 * 작업 공간의 머리 (architecture.md §8.9).
 *
 * 이 단계가 무엇을 하는 곳인지 한 줄, 그리고 지금의 맥락. **길잡이 역할은 하지
 * 않는다** — 이동은 레일이 쥔다. 히어로가 아니라서 낮고 조용하다.
 *
 * **높이가 화면마다 달라지면 안 된다.** 오른쪽에 무엇이 오느냐에 따라(맥락 줄이냐 큰
 * 버튼이냐) 머리가 커지면 아래 내용이 통째로 밀리고, 제목 자체도 정렬 때문에 위아래로
 * 움직인다. 단계를 옮길 때마다 화면이 몇 px씩 뛰는 원인이 여기였다. 그래서 둘을 건다 —
 * **바닥이 아니라 위에 맞추고**(제목의 y가 고정된다), **최소 높이를 준다**(오른쪽이
 * 비어도 같은 높이다). 글자가 길어 두 줄이 되면 늘어나지만 그건 언어가 바뀔 때이지
 * 단계를 옮길 때가 아니다.
 *
 * 슬롯이 둘인 이유는 **맥락과 동작이 다른 것이기 때문이다.** 맥락은 `<dl>`에 들어가는
 * 이름-값 쌍이고(파일 이름, 행 수), 동작은 버튼이다. 한 슬롯에 몰면 버튼이 `<dl>` 안에
 * 들어가 마크업이 거짓말을 한다 — 데이터 화면이 실제로 그 상태였다 (2026-08-13).
 *
 * **동작 슬롯을 쓰는 것은 대시보드의 [바로가기] 하나뿐이다** (§8.9). 단계 화면의 머리에는
 * 버튼이 없다 — 동작은 본문에 서고, 자리는 무엇에 걸리는 동작인가가 정한다.
 * `tests/ui-rules.spec.ts`가 맥락 슬롯 안의 버튼을 잡는다.
 */
defineProps<{
  title: string
  purpose: string
}>()
</script>

<template>
  <header class="flex min-h-14 flex-wrap items-start justify-between gap-x-6 gap-y-2">
    <div class="min-w-0">
      <h2 class="text-lg font-bold tracking-tight">{{ title }}</h2>
      <p class="mt-0.5 text-base text-ink-soft">{{ purpose }}</p>
    </div>

    <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
      <dl
        v-if="$slots.context"
        class="flex flex-wrap items-center gap-x-5 gap-y-1 text-base text-ink-soft"
      >
        <slot name="context" />
      </dl>
      <slot name="actions" />
    </div>
  </header>
</template>
