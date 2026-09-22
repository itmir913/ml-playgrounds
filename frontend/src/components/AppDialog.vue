<script setup lang="ts">
/**
 * 모달 대화상자.
 *
 * **브라우저의 `<dialog>`를 쓴다.** 직접 만들면 포커스 가두기, Esc, 바깥 클릭,
 * 스크롤 잠금, `aria-modal`을 전부 우리가 짜야 하고 그중 하나는 반드시 빠진다.
 *
 * 열고 닫는 것은 `open` prop이 쥔다. Esc나 바깥을 눌러 닫히면 `close`를 올려
 * **부모가 상태의 유일한 출처로 남게** 한다 - 안에서 몰래 닫으면 다시 열 수 없다.
 */

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  title: string
  description?: string
  /**
   * 화면을 채우는 창인가. **기본은 내용만큼인 좁은 창이다** — 이 저장소의 대화상자는
   * 대개 묻고 답하는 자리이고, 거기서는 좁은 것이 읽기 쉽다.
   *
   * **그림을 담는 창 하나 때문에 생겼다** (`ChartDialog.vue`). 처음에는 `max-w-lg`를
   * `max-w-4xl`로 넓히는 갈래였는데, 실물에서 보니 **폭만으로는 모자랐다** — 박스 플롯은
   * 세로로 읽는 그림이라 높이가 곧 읽을 수 있는 눈금의 수다 (2026-09-22, 코드 소유자).
   * 그래서 지금은 **화면의 95%**이고, 남는 5%는 뒤가 비쳐 **모달이라는 것이 읽히는**
   * 자리다.
   */
  fill?: boolean
  /**
   * 바깥을 눌러도 안 닫히는가. **기본은 닫힌다** — 묻고 답하는 창에서 바깥 클릭은
   * `취소`와 같은 뜻이고, 거기서는 빠져나갈 길이 많을수록 좋다.
   *
   * **보는 창은 다르다** (2026-09-22, 코드 소유자). 그림을 보며 축과 열을 바꾸는 동안
   * 커서는 캔버스 밖으로 자주 나가고, 그때마다 창이 닫히면 **학생이 하던 일을 잃는다.**
   * **`Esc`는 그대로 닫는다** — `<dialog>`가 스스로 `close`를 올리므로 여기서 할 일이
   * 없다. 나가는 길이 없는 창을 만드는 것이 아니라 **실수로 나가는 길만** 막는다.
   */
  persistent?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const dialog = ref<HTMLDialogElement | null>(null)

/** `open`이 말하는 상태를 실제 `<dialog>`에 반영한다. 이미 그 상태면 아무것도 안 한다. */
function sync(): void {
  const element = dialog.value
  if (!element) return
  if (props.open && !element.open) element.showModal()
  if (!props.open && element.open) element.close()
}

watch(() => props.open, sync, { flush: 'post' })

/**
 * **열린 채로 태어나는 창이 있다** (2026-09-22, 실물에서 잡았다).
 *
 * 감시자는 값이 **바뀔 때만** 깨어난다. 부르는 쪽이 `v-if`로 이 컴포넌트를 만들면서
 * `open`을 처음부터 참으로 주면 **`showModal()`이 한 번도 안 불린다** — 마크업은 다
 * 있는데 `<dialog>`가 닫힌 채라 화면에 아무것도 안 뜬다.
 *
 * **검사가 못 잡았다.** jsdom과 `@vue/test-utils`는 `<dialog>`의 열림을 안 보고 내용을
 * 그리므로, 시각화 창을 마운트한 검사 열여섯이 전부 초록이었다 — **가짜가 진짜보다
 * 관대한 자리**다. 아래 `app-dialog.spec.ts`가 이제 열림 자체를 잰다.
 */
onMounted(sync)

// 라우트가 바뀌면서 열린 채로 사라질 수 있다. 남으면 화면이 잠긴다.
onBeforeUnmount(() => dialog.value?.close())

function onBackdrop(event: MouseEvent): void {
  if (props.persistent) return
  // <dialog> 자신이 대상이면 바깥을 누른 것이다. 안쪽 요소는 여기까지 안 온다.
  if (event.target === dialog.value) emit('close')
}
</script>

<template>
  <dialog
    ref="dialog"
    class="dialog-panel m-auto rounded-card border border-line bg-surface p-0 text-ink shadow-pop backdrop:bg-slate-900/40"
    :class="props.fill ? 'dialog-fill' : 'w-full max-w-lg'"
    @close="emit('close')"
    @click="onBackdrop"
  >
    <!--
      **세로 배치는 안쪽 칸이 든다. `<dialog>`이 아니다** (2026-09-22, 사용자가 실물에서
      봤다). 닫힌 `<dialog>`를 숨기는 것은 브라우저의 `display: none` 한 줄인데, 거기에
      `display: flex`를 주면 **그 한 줄을 덮어** 열리지도 않은 창이 화면에 눌러앉는다 —
      확인창 둘이 겹쳐 뜨고, 상태 표시줄 아래로 빈 흰 칸이 남았다.

      `[open]`에만 거는 방법도 있었지만 **아예 `display`를 안 건드리는 쪽을 골랐다** —
      규칙 하나를 더 두면 그 규칙이 사라졌을 때 같은 일이 다시 난다.
    -->
    <!--
      **`h-full`은 높이가 정해진 창에만 준다** (2026-09-22, 아이패드에서 사용자가 봤다).
      `fill`이 아닌 창은 높이가 `auto`(내용만큼)인데, 그 안에서 `height: 100%`는 **부모가
      자식을 보고 자식이 부모를 보는 순환**이다 — 크로뮴은 `auto`로 무시하고 **웹킷은
      0에 가깝게 잡는다.** 그래서 같은 확인창이 아이패드에서만 **제목과 첫 줄 높이로
      잘려** 단추가 안 보였다.

      **`fill`에는 필요하다.** 그쪽은 창 높이가 `95dvh`로 정해져 있어 안쪽 칸이 그것을
      받아야 아래 굴리는 자리가 높이를 얻는다.
    -->
    <div class="flex min-h-0 flex-col p-6 md:p-8" :class="props.fill ? 'h-full' : ''">
      <h2 class="text-xl font-bold tracking-tight md:text-2xl">{{ title }}</h2>
      <!--
        **리듬이 두 단이다** — 이름과 그 설명 사이는 1.5, 덩어리와 덩어리 사이는 6.
        칸 안의 `AppField`·`AppChoices`가 같은 두 값을 쓰므로, 대화상자 제목부터
        버튼까지 내려오는 간격이 한 벌로 읽힌다.
      -->
      <p v-if="description !== undefined" class="mt-1.5 leading-relaxed text-ink-soft">
        {{ description }}
      </p>

      <!--
        **굴리는 것은 창이 아니라 이 칸이다** (2026-09-22, 사용자 지적). 창 자신이
        굴러가면 스크롤 막대가 **둥근 모서리 위에 얹히고** 제목과 [닫기]까지 함께
        밀려 올라간다 — 막대가 내용 옆이 아니라 카드의 가장자리에 붙어 있어 어색했다.
        여기서 굴리면 머리와 단추는 제자리에 남는다.

        **이 칸은 스크롤 상자라, 안에 놓은 것이 밖으로 못 나간다.** 지금 대화상자 열
        어디에도 팝오버가 없어서 걸리는 것이 없지만(2026-09-22에 세어 확인했다),
        **여기에 `AppPopover`나 떠오르는 패널을 넣으면 잘린다** — 그때는 그 부품을
        창 바깥으로 올리거나 여기서 굴리는 것을 포기해야 한다.

        **좌우로 한 칸 반씩 새어 나간다** (`-mx-1.5 px-1.5`, 2026-09-22에 사용자가
        실물에서 봤다). 포커스 링은 요소의 **바깥**에 그려지는데(`outline` 2px +
        `outline-offset` 2px), 칸이 스크롤 상자의 끝과 맞닿아 있으면 그 링이 잘린다 —
        입력칸을 누른 학생에게 **테두리가 한쪽만 잘려 보인다.** 음수 여백으로 상자를
        바깥 여백 쪽으로 넓히고 같은 만큼 안쪽 여백을 줘서, **보이는 자리는 그대로 두고
        링이 설 자리만 만든다.**
      -->
      <div
        v-if="$slots.default"
        class="mt-6 -mx-1.5 flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5"
      >
        <slot />
      </div>

      <!--
        **고르는 것 둘의 너비가 같아야 한다** (2026-08-15, 사용자). `취소`와 `지우기`처럼
        글자 수가 다른 짝에서 폭이 갈리면 **무게가 글자 수로 정해진다** - 무엇이 무거운
        선택인지는 변종이 말해야 하고, 폭은 아무 말도 하면 안 된다.

        `AppEmpty`가 나란한 단추를 세우는 것과 같은 방식이다 - 격자로 놓고 칸을 같은
        너비로 나눈다(`auto-cols-fr`). 자리가 없으면 위아래로 쌓이고, 그때도 서로
        같은 너비다.

        **재는 것은 창이 아니라 이 대화상자다**(`@container`). `sm:`으로 쓰면 창이
        640px을 넘어야 나란히 서는데, **대화상자는 `max-w-lg`라 애초에 그보다 좁게
        산다** - 그래서 휴대폰에서는 `취소`와 `만들기`처럼 짧은 짝까지 언제나 세로로
        쌓였다 (2026-08-30, 사용자가 겪었다). 창은 이 줄에 남은 자리를 모른다.

        문턱은 **안 쪼개지는 낱말 덩어리**에서 나온다 - md 단추는 좌우 여백이 32px이고
        가장 긴 덩어리가 `training`(8자, 약 64px)이라 한 칸이 96px, 둘에 간격 12px을
        더하면 204px이다. 그 위의 첫 눈금이 `@3xs`(16rem)다.
      -->
      <div class="mt-6 shrink-0 @container">
        <div class="ml-auto grid w-fit gap-3 @3xs:grid-flow-col @3xs:auto-cols-fr">
          <slot name="actions" />
        </div>
      </div>
    </div>
  </dialog>
</template>
