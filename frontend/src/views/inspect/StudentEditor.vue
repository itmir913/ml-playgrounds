<script setup lang="ts">
/**
 * **학번과 이름을 고쳐 두는 자리** (2026-09-18, 사용자).
 *
 * 학생이 잘못 적어 내면 명렬이 그 값으로 서고, 교사는 **정렬하기 전에** 그것을 고쳐야
 * 한다. 그런데 이 일은 서른 명 중 두셋에게만 생기는 **드문 일**이라, 상시 자리를 먹으면
 * 안 된다 — 그래서 팝오버다.
 *
 * **모양은 내보내기 팝오버와 같다** (`components/ExportButton.vue`). 이 앱에서 학번·이름을
 * 적는 자리가 거기 하나였고, 교사가 보는 화면과 학생이 보던 화면이 같은 문법이어야 한다.
 * 특히 **힌트는 두 칸 아래 한 문단이다** — 칸 사이에 끼우면 한 칸만 아래로 밀려 정렬이
 * 무너진다(처음에 그렇게 만들었다가 사용자가 잡았다).
 *
 * **파일은 안 고친다.** 고친 값은 명렬의 표시와 정렬에만 쓰이고 새로 열면 사라진다
 * (open-decisions.md "점검은 읽기 전용 열람기다").
 */

import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppPopover from '@/components/AppPopover.vue'
import { ACTION_ICONS } from '@/icons'
import { MAX_STUDENT_ID_LENGTH, MAX_STUDENT_NAME_LENGTH } from '@/limits'

const props = defineProps<{ studentId: string; studentName: string }>()

const emit = defineEmits<{ correct: [{ studentId?: string; studentName?: string }] }>()

const { t } = useI18n()

/** 내보내기 팝오버가 쓰는 입력 모양 그대로. */
const INPUT = 'w-full rounded-field border border-line-strong bg-surface px-3 py-2'

function onInput(field: 'studentId' | 'studentName', event: Event): void {
  emit('correct', { [field]: (event.target as HTMLInputElement).value })
}
</script>

<template>
  <AppPopover align="right">
    <template #trigger>
      <AppButton variant="secondary">
        <component :is="ACTION_ICONS.editSection" :size="16" aria-hidden="true" />
        {{ t('inspect.editStudent') }}
      </AppButton>
    </template>

    <template #default>
      <h2 class="mb-4 font-bold">{{ t('inspect.editStudent') }}</h2>

      <div class="flex flex-col gap-3">
        <AppField :label="t('inspect.studentId')">
          <template #default="field">
            <input
              v-bind="field"
              type="text"
              :value="props.studentId"
              :class="INPUT"
              :maxlength="MAX_STUDENT_ID_LENGTH"
              @input="onInput('studentId', $event)"
            />
          </template>
        </AppField>

        <AppField :label="t('inspect.studentName')">
          <template #default="field">
            <input
              v-bind="field"
              type="text"
              :value="props.studentName"
              :class="INPUT"
              :maxlength="MAX_STUDENT_NAME_LENGTH"
              @input="onInput('studentName', $event)"
            />
          </template>
        </AppField>
      </div>

      <p class="mt-4 leading-relaxed text-ink-faint">{{ t('inspect.editHint') }}</p>
    </template>
  </AppPopover>
</template>
