<script setup lang="ts">
/**
 * **마감을 정하는 팝오버** (open-decisions.md 121, architecture.md §8.21).
 *
 * 학번·이름 고침(`StudentEditor`)과 같은 모양이고 같은 규칙이다 — **값은 이 화면에만 산다.**
 * 판정은 하지 않는다. 시각으로 바꾸는 것도 판정하는 것도 `project/deadline.ts`가 한다.
 */

import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppPopover from '@/components/AppPopover.vue'
import { ACTION_ICONS } from '@/icons'
import { deadlineFromInput, deadlineToInput } from '@/project/deadline'

const props = defineProps<{ deadline: number | null }>()
const emit = defineEmits<{ set: [deadline: number | null] }>()

const { t } = useI18n()

/** `StudentEditor`의 `INPUT`을 옮겨 적은 것이다(그것도 내보내기 팝오버의 사본). 셋이 같은 모양이다. */
const INPUT = 'w-full rounded-field border border-line-strong bg-surface px-3 py-2'

const value = computed(() => (props.deadline === null ? '' : deadlineToInput(props.deadline)))

/**
 * **고치는 도중에는 마감을 안 푼다.** 데스크톱의 `datetime-local`은 칸(연·월·일·시·분) 하나만
 * 지워도 값이 `''`이 된다 — 분만 고치려고 지우는 순간 열이 사라지고 정렬이 돌아가면 안 된다.
 * 그래서 `input`은 읽힌 값만 올리고, **비운 채로 칸을 떠날 때**(`blur`)만 해제한다.
 * `change`가 아닌 이유: 브라우저마다 날짜 칸의 `change`를 칸 하나 고칠 때마다 낼 수 있다 —
 * 헤드리스 Chrome으로 재려 했으나 날짜 칸이 합성 키를 안 받아 못 쟀다(2026-11-17). `blur`는
 * 칸 사이 이동에서는 안 나고 요소를 떠날 때만 난다.
 * 무는 검사: `inspect-deadline.spec.ts`의 *"고치는 도중"*과 *"비운 채로 떠나면"*.
 */
function onInput(event: Event): void {
  const next = deadlineFromInput((event.target as HTMLInputElement).value)
  if (next !== null) emit('set', next)
}

function onLeave(event: Event): void {
  const next = deadlineFromInput((event.target as HTMLInputElement).value)
  if (next === null) emit('set', null)
}
</script>

<template>
  <AppPopover>
    <template #trigger>
      <AppButton variant="secondary">
        <component :is="ACTION_ICONS.setDeadline" :size="18" aria-hidden="true" />
        {{ t('inspect.deadline.set') }}
      </AppButton>
    </template>

    <template #default>
      <h2 class="mb-4 font-bold">{{ t('inspect.deadline.set') }}</h2>

      <AppField :label="t('inspect.deadline.field')">
        <template #default="field">
          <input
            v-bind="field"
            type="datetime-local"
            step="60"
            :value="value"
            :class="INPUT"
            @input="onInput"
            @blur="onLeave"
          />
        </template>
      </AppField>

      <p class="mt-4 leading-relaxed text-ink-faint">{{ t('inspect.deadline.note') }}</p>

      <AppButton
        v-if="props.deadline !== null"
        class="mt-4"
        variant="secondary"
        @click="emit('set', null)"
      >
        {{ t('inspect.deadline.clear') }}
      </AppButton>
    </template>
  </AppPopover>
</template>
