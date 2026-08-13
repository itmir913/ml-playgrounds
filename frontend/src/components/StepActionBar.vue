<script setup lang="ts">
/**
 * 한 단계의 동작 바 — **누르는 것이 전부 여기 모인다** (architecture.md §8.13.1
 * "동작 바는 화면들이 함께 쓴다").
 *
 * **학습 화면과 예측 화면 셋(표·값, 표·파일, 이미지)이 이것 하나를 쓴다.** 화면마다
 * 갈려 있으면 한 교사가 두 수업에서 다른 화면을 가르치게 된다. 자리는 둘이고 뜻이
 * 정해져 있다 — 기본 자리에는 **거리를 채우고 비우는 것과 지금 무슨 일이 있는지**가,
 * `end` 자리에는 **그 화면의 결론** 하나가 선다([학습하기]·[예측]이고, 파일 예측은
 * 누를 예측이 없어 [내려받기]다).
 *
 * **위에 붙어 따라온다.** 아래가 길게 이어지는 화면들이라 스크롤하면 누를 것과 진행
 * 표시가 화면 밖으로 나간다 — 학생은 아무 일도 안 일어난 줄 알고 다시 누르러 올라간다.
 *
 * **`fixed`가 아니다** — `AppShell`의 상태 표시줄이 `<main>` 밖에 있다.
 *
 * **표 머리글보다 앞이어야 한다.** 붙박이 머리글도 `z-10`으로 붙는데 DOM에서 이 바보다
 * 뒤에 있어서, 같은 값이면 표가 바를 덮는다 — 데이터 화면에서 실제로 그렇게 나갔다
 * (2026-08-14). 대화상자·팝오버의 `z-50`은 그대로 이 위를 덮는다.
 *
 * **바깥 칸은 여백을 만드는 자리다.** `top-0`으로 붙이면 바가 화면 맨 끝에 딱 달라붙어
 * 눌린 것처럼 보이고, 그렇다고 `top-4`로 띄우면 그 틈으로 아래 내용이 지나가는 것이
 * 보인다. 그래서 위쪽 여백만큼을 **칸 안의 `pt`로 넣고 같은 값을 `-mt`로 도로 빼서**,
 * 붙었을 때 그 자리를 불투명한 바탕이 덮게 한다.
 *
 * **띠는 칸 사이 간격(`gap-5`, 20px)보다 짧아야 한다.** 같으면 띠가 앞 칸의 아래 경계에
 * 딱 붙어 **그 칸의 그림자를 통째로 가린다** — `해야 할 일` 카드의 그림자가 실제로 그렇게
 * 사라졌고, 바가 없는 전처리 화면에서만 보였다(2026-08-14). 16px이면 4px이 남고 그것이
 * 그림자가 차지하는 폭이다. 그래서 화면 바깥 여백을 따라 `sm`에서 20px로 키우지 않는다 —
 * 붙었을 때 바가 화면 끝에서 16px 떨어지는 것으로 충분하다.
 *
 * **여기에는 짧은 것만 온다.** 바가 두 줄이 되어도 아래 자리는 안 어긋나지만(아래
 * `--step-bar-height`), 그만큼 볼 것이 밀려 내려간다.
 *
 * `below`는 줄 아래 전체 폭을 갖는 자리다 — 학습 진행 게이지처럼 가로로 긴 것이 온다.
 */

import { onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * **자기 높이를 재서 내놓는다.** 아래 화면들은 "바 아래 첫 자리"를 알아야 한다 —
 * 스크롤이 멈출 자리와 옆 칸이 붙어 설 자리다. 그 값을 화면이 상수로 들고 있으면
 * **좁은 화면에서 바가 두 줄이 되는 순간 전부 틀린다**(휴대폰이 그렇다).
 * 형제의 높이를 읽는 CSS 문법이 없어서 여기서 재는 수밖에 없다.
 *
 * **재는 것은 바깥 칸이다.** 그 칸이 `pt-4`로 위쪽 여백을 품고 있어서, 붙었을 때
 * 화면 끝에서 바 아래까지가 정확히 이 칸의 높이다.
 *
 * 값을 `documentElement`에 두는 것은 **쓰는 쪽이 DOM에서 얼마나 떨어져 있는지 모르기
 * 때문이다** - 붙박이 칸은 형제지만 스크롤 대상은 더 아래에 있다. 화면 하나에 바는
 * 하나뿐이고(판마다 `v-if`로 갈린다) 떠날 때 지운다.
 *
 * `ResizeObserver`가 없으면 첫 값만 쓴다 - jsdom에 그것이 없어서, 안 막으면 이
 * 컴포넌트에 닿는 스펙이 전부 죽는다.
 */
const HEIGHT_VAR = '--step-bar-height'

const barEl = ref<HTMLElement | null>(null)
let observer: ResizeObserver | null = null

function publish(el: HTMLElement): void {
  document.documentElement.style.setProperty(HEIGHT_VAR, `${el.offsetHeight}px`)
}

onMounted(() => {
  const el = barEl.value
  if (!el) return

  publish(el)
  if (typeof ResizeObserver === 'undefined') return

  observer = new ResizeObserver(() => publish(el))
  observer.observe(el)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  document.documentElement.style.removeProperty(HEIGHT_VAR)
})
</script>

<template>
  <div ref="barEl" class="sticky top-0 z-20 -mt-4 bg-surface pt-4">
    <div
      class="flex flex-wrap items-center gap-3 rounded-panel border border-line-strong bg-surface px-4 py-2.5 shadow-card"
    >
      <slot />

      <!-- 결론은 늘 오른쪽 끝이다. 자리를 컴포넌트가 정해야 세 경로가 안 갈린다. -->
      <div class="ml-auto flex flex-wrap items-center gap-3">
        <slot name="end" />
      </div>

      <!-- 전체 폭을 갖는 자리. `w-full`이라 `flex-wrap`이 스스로 다음 줄로 내린다. -->
      <div v-if="$slots.below" class="w-full"><slot name="below" /></div>
    </div>
  </div>
</template>
