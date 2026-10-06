<script setup lang="ts">
/**
 * 빈 상태 (architecture.md §8.9).
 *
 * **고장처럼 보이면 안 된다.** 그래서 둘을 반드시 받는다 — **왜 비어 있는지**(`reason`)와
 * **무엇을 하면 열리는지**(`next`). "결과가 없습니다"로 끝내면 학생은 자기가 뭘 잘못한
 * 줄 안다.
 *
 * 둘 다 필수 props다. 하나를 빠뜨리면 컴파일이 깨진다 — 규칙을 사람의 성실함에
 * 맡기지 않는다.
 */
defineProps<{
  reason: string
  next: string
}>()
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-6 py-14 text-center">
    <p class="font-bold text-ink-soft">{{ reason }}</p>
    <p class="max-w-md text-base leading-relaxed text-ink-faint">{{ next }}</p>
    <!--
      **누를 것들의 너비를 가장 긴 것에 맞춘다** (2026-08-14, 사용자). 폭이 제각각이면
      비어 있는 화면에서 셋이 계단처럼 보이고, 무엇이 보통의 길인지가 색이 아니라
      길이로 읽힌다.

      `w-fit` 안의 `fr` 트랙은 **가장 넓은 것의 너비로 모두 같아진다** — 고정 너비를
      주는 것이 아니라서 영어에서 문장이 길어져도 그대로 맞는다 (docs/i18n.md 규칙 7).
      자리가 없으면 한 줄에 하나씩 쌓이고, 그때도 너비는 같다.

      **재는 것은 창이 아니라 이 빈 상태가 받은 폭이다**(`@container`, 대화상자와 같다).
      빈 상태는 화면 전체일 때도 있고 두 칸 중 한 칸일 때도 있어서 **창 폭은 여기 남은
      자리를 말해 주지 못한다** — `sm:`으로 쓰면 좁은 칸에서 셋이 나란히 눌리고, 휴대폰
      에서는 반대로 언제나 쌓인다.

      문턱은 **안 쪼개지는 낱말 덩어리**에서 나온다 - lg 단추는 좌우 여백이 48px이다.
      **처음 잡을 때의 근거는 단추 셋이었다** — 데이터 빈 상태의 `폴더에서`(4글자, 18px 기준
      72px)라 한 칸이 120px, 셋에 간격 8px 둘을 더해 376px, 그 위의 첫 눈금이 `@sm`(24rem)이다.
      **지금은 셋이 서는 자리가 없다** (#38에서 데이터 빈 상태가 [범주 만들기]·[사진 추가] 둘이
      됐다). 단추를 받는 빈 상태는 전부 둘 이하다(데이터·점검·포트폴리오). 둘이면 가장 긴 덩어리가
      약 130px(일본어 문절 `テンプレートを`, 7글자 × 18px의 어림 — 잰 값이 아니다)이어도 한 칸
      178px, 둘에 간격을 더해 364px이라 `@sm` 안에 든다 — 문턱은 여전히 넘치지 않는 쪽이다.
      둘만 보면 더 낮출 수도 있지만 **값은 그대로 둔다**(바꾸려면 실물에서 재고 정한다, 사람 확인).
    -->
    <div v-if="$slots.default" class="mt-2 w-full @container">
      <div class="mx-auto grid w-fit gap-2 @sm:grid-flow-col @sm:auto-cols-fr">
        <slot />
      </div>
    </div>
  </div>
</template>
