<script setup lang="ts">
/**
 * 입력 하나를 감싸는 껍데기 — 라벨, 도움말, 오류.
 *
 * **라벨과 입력을 잇는 id를 컴포넌트가 만든다.** 화면마다 손으로 붙이면 언젠가
 * 빠뜨리고, 빠진 라벨은 눈으로는 멀쩡해 보인다. 슬롯으로 내려주는 값을 그대로 쓴다.
 *
 * ```
 * <AppField :label="t('data.tabular.fileName')">
 *   <template #default="field"><input v-bind="field" /></template>
 * </AppField>
 * ```
 *
 * 오류가 있으면 도움말 자리를 오류가 차지한다. 둘을 같이 띄우면 어느 쪽을 읽어야
 * 하는지 알 수 없다.
 *
 * **순서는 이름 → 도움말 → 입력이다.** 도움말이 입력 아래에 있으면 **읽기 전에 이미
 * 답하고 있다** — 이름을 다 적고 나서야 "파일 이름이 됩니다"를 만난다. 그리고 축을
 * 고르는 칸(`AppChoices`)은 그 한 줄이 위에 있어서, 나란히 선 두 칸의 순서가 서로
 * 달랐다.
 *
 * **`#under-label`은 그 입력을 켜고 끄는 것의 자리다** (2026-09-22, 코드 소유자).
 * 히스토그램의 `자동으로 설정하기`처럼 **이름이 가리키는 것을 무엇이 정하는가**를 묻는
 * 스위치는 이름 바로 아래여야 한다 — 입력 아래에 두면 학생이 칸을 먼저 만나고,
 * 도움말 위에 따로 세우면 어느 칸의 스위치인지 알 수 없다.
 *
 * **`reference`는 입력 아래다** (2026-10-01, 코드 소유자). 예측 칸의 *"데이터에 있는 값의
 * 범위"*처럼 **읽고 나서 답하는 규칙이 아니라 적으면서 보는 값**이 여기 선다. 위에 두면
 * 참고값이 있는 칸과 없는 칸이 한 줄에 설 때 입력 칸의 높이가 어긋났다.
 * 오류가 서도 자리를 내주지 않는다 — 오류는 도움말의 자리다.
 */

import { computed, useId } from 'vue'

const props = defineProps<{
  label: string
  hint?: string | undefined
  /** 있으면 도움말 자리를 차지한다. 조건부로 넘기는 자리라 undefined를 받는다. */
  error?: string | undefined
  /** 입력 아래의 참고값. 조건부로 넘기는 자리라 undefined를 받는다. */
  reference?: string | undefined
}>()

const inputId = useId()
const noteId = useId()
const referenceId = useId()

const note = computed(() => props.error ?? props.hint)

const describedBy = computed(() => {
  const ids = [
    note.value === undefined ? undefined : noteId,
    props.reference === undefined ? undefined : referenceId,
  ].filter((id) => id !== undefined)
  return ids.length === 0 ? undefined : ids.join(' ')
})

/**
 * 슬롯으로 내려주는 값. **객체 하나로 건넨다** — `<slot :aria-describedby>`처럼 이름을 하나씩 적으면
 * 컴파일러가 이름을 `ariaDescribedby`로 바꿔 넘기고, 받은 쪽이 `<input v-bind>`로 붙이면
 * `ariadescribedby`라는 뜻 없는 속성이 서서 도움말이 칸과 안 이어졌다. `app-field.spec.ts`가 문다.
 */
const control = computed(() => ({
  id: inputId,
  'aria-describedby': describedBy.value,
  'aria-invalid': props.error !== undefined,
}))
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="inputId" class="text-base font-bold text-ink-soft">{{ label }}</label>

    <slot name="under-label" />

    <p
      v-if="note !== undefined"
      :id="noteId"
      class="text-base"
      :class="error === undefined ? 'text-ink-faint' : 'font-medium text-danger'"
    >
      {{ note }}
    </p>

    <slot v-bind="control" />

    <p v-if="reference !== undefined" :id="referenceId" class="text-base text-ink-faint">
      {{ reference }}
    </p>
  </div>
</template>
