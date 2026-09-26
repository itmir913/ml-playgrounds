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
 * **`md` 이상에서 위에 붙어 따라온다.** 아래가 길게 이어지는 화면들이라 스크롤하면 누를
 * 것과 진행 표시가 화면 밖으로 나간다 — 학생은 아무 일도 안 일어난 줄 알고 다시 누르러
 * 올라간다.
 *
 * **`md` 미만에서는 붙지 않고, `below` 자리(학습 진행 게이지)만 남는다** (`open-decisions.md`
 * 59). 예측 화면만 예외라 `sticky`를 받아 통째로 붙는다. 붙박이가 지키려던 것은 오래 걸리는 동작의 진행 표시라, `below`가 있으면 바가
 * **게이지 줄이 보이는 만큼만** 붙는다 — 그 위는 도구 막대 뒤로 들어간다
 * (`styles/utilities.css`의 `stick-step-bar-strip`). 게이지를 바 밖에 따로 붙이지 않는
 * 이유는, 붙박이는 자기 부모 안에서만 붙어서 바 안의 게이지는 바와 함께 떠나기 때문이다.
 *
 * **`fixed`가 아니다** — `AppShell`의 상태 표시줄이 `<main>` 밖에 있다.
 *
 * **`md` 이상에서 붙는 높이는 `--shell-top`이 정한다**(`md:stick-below-shell`, 그 폭에서는
 * 0이다). `md` 미만의 게이지 줄은 `stick-step-bar-strip`이 도구 막대 아래에 세운다 — 그 폭에서는
 * 문서가 스크롤하고 도구 막대가 화면 위를 덮고 있어서, `top-0`이면 줄이 그 아래로 숨는다.
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

defineProps<{
  /**
   * **휴대폰에서도 바를 통째로 붙인다** — 예측 화면만 쓴다(`open-decisions.md` 59의 예외).
   * 값을 넣고 곧바로 [예측하기]를 누르는 일을 되풀이하는 화면이라서다. 쓰는 화면이 예측뿐인지는
   * `ui-rules.spec.ts`의 *"동작 바는 md 이상에서만 붙고, …"*가 문다.
   */
  sticky?: boolean
}>()

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
 * **내놓는 것은 바의 높이가 아니라 바가 화면을 덮는 높이다.** `md` 미만에서 붙지 않으면
 * 0이고, 게이지 줄만 붙으면 그 줄의 높이다 — 안 그러면 도착 지점(`under-step-bar`)이 없는
 * 바를 비켜 한 칸 아래에서 멈춘다. 어느 경우인지는 **CSS가 정한 결과를 읽는다**(붙었는가,
 * 게이지 줄만인가) — 폭의 경계를 여기 다시 적으면 CSS와 갈린다. 이 값은 레이아웃이라 jsdom
 * 검사가 못 본다(사람 확인 — architecture.md §8.13.1의 잰 값).
 *
 * `ResizeObserver`가 없으면 첫 값만 쓴다 - jsdom에 그것이 없어서, 안 막으면 이
 * 컴포넌트에 닿는 스펙이 전부 죽는다.
 */
const HEIGHT_VAR = '--step-bar-height'

/** 게이지 줄만 붙을 때 도구 막대 뒤로 들어가는 높이. 바 자신에 둔다(`stick-step-bar-strip`). */
const HIDDEN_VAR = '--step-bar-hidden'

/** CSS가 게이지 줄만 붙이고 있다는 표시(`stick-step-bar-strip`). */
const STRIP_VAR = '--step-bar-strip'

const barEl = ref<HTMLElement | null>(null)
const panelEl = ref<HTMLElement | null>(null)
const belowEl = ref<HTMLElement | null>(null)
let observer: ResizeObserver | null = null

/**
 * 바 위쪽에서 게이지 줄이 시작하기 전까지의 높이. 게이지 위에 패널 아래 여백과 같은 틈을
 * 남긴다 — 줄이 위아래로 같은 숨을 갖는다. `below`가 없으면 0이다.
 */
function hiddenAbove(el: HTMLElement): number {
  const below = belowEl.value
  const panel = panelEl.value
  if (!below || !panel) return 0
  const pad = Number.parseFloat(getComputedStyle(panel).paddingBottom)
  const offset =
    below.getBoundingClientRect().top -
    el.getBoundingClientRect().top -
    (Number.isFinite(pad) ? pad : 0)
  return Math.max(offset, 0)
}

function publish(el: HTMLElement): void {
  const hidden = hiddenAbove(el)
  el.style.setProperty(HIDDEN_VAR, `${hidden}px`)
  const style = getComputedStyle(el)
  const stuck = style.position === 'sticky'
  const strip = style.getPropertyValue(STRIP_VAR).trim() === 'on'
  const cover = !stuck ? 0 : strip ? el.offsetHeight - hidden : el.offsetHeight
  document.documentElement.style.setProperty(HEIGHT_VAR, `${cover}px`)
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
  <!--
    붙는 것은 `md` 이상뿐이다. 그 아래에서는 `below`가 있을 때만 게이지 줄이 붙는다
    (`open-decisions.md` 59). `sticky`면 폭을 가리지 않고 통째로 붙는다(그 결정의 예외).
  -->
  <div
    ref="barEl"
    class="z-20 -mt-4 bg-surface pt-4 md:sticky md:stick-below-shell"
    :class="sticky ? 'sticky stick-below-shell' : { 'stick-step-bar-strip': $slots.below }"
  >
    <div
      ref="panelEl"
      class="flex flex-wrap items-center gap-3 rounded-panel border border-line-strong bg-surface px-4 py-2.5 shadow-card"
    >
      <slot />

      <!-- 결론은 늘 오른쪽 끝이다. 자리를 컴포넌트가 정해야 세 경로가 안 갈린다. -->
      <div class="ml-auto flex flex-wrap items-center gap-3">
        <slot name="end" />
      </div>

      <!-- 전체 폭을 갖는 자리. `w-full`이라 `flex-wrap`이 스스로 다음 줄로 내린다. -->
      <div v-if="$slots.below" ref="belowEl" class="w-full"><slot name="below" /></div>
    </div>
  </div>
</template>
