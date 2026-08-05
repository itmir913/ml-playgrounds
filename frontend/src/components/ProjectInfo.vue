<script setup lang="ts">
/**
 * 도구 막대의 프로젝트 이름. **누르면 고칠 수 있다.**
 *
 * 이름만 있는 것이 아니라 학번과 이름까지 함께 있는 이유는 **셋이 같은 결과를 만들기
 * 때문이다** — `10203_홍길동_붓꽃품종분류.mlpx`. 따로 흩어 두면 학생은 파일 이름이
 * 어디서 오는지 모른다. 그래서 지금 저장하면 무슨 이름이 되는지도 함께 보여준다.
 *
 * 인적사항은 **선택 입력이다**(mlpx-spec.md §6.2). 비워 두면 파일에서도 지운다.
 *
 * 팝오버라 작업을 막지 않는다. 고치는 즉시 반영되고 자동 저장이 뒤따른다 —
 * 확인 버튼이 없는 것은 되돌릴 것이 없는 편집이기 때문이다.
 */

import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import AppField from '@/components/AppField.vue'
import { MAX_FILE_NAME_LENGTH, MAX_STUDENT_ID_LENGTH, MAX_STUDENT_NAME_LENGTH } from '@/limits'
import { projectFileName } from '@/project/format'
import { identityOf, withIdentity, type Identity } from '@/project/identity'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

const popoverId = useId()

const identity = computed<Identity>(() => {
  const manifest = project.file?.document.manifest
  return manifest === undefined
    ? { name: '', studentId: '', studentName: '' }
    : identityOf(manifest)
})

/** 지금 저장하면 무슨 파일 이름이 되는가. 학생이 적은 것이 어디에 쓰이는지 보여준다. */
const fileName = computed(() => {
  const manifest = project.file?.document.manifest
  return manifest === undefined ? '' : projectFileName(manifest)
})

function edit(field: keyof Identity, event: Event): void {
  const file = project.file
  if (!file) return
  const next = { ...identity.value, [field]: (event.target as HTMLInputElement).value }
  project.update({
    ...file,
    document: withIdentity(file.document, next, new Date().toISOString()),
  })
}

const INPUT = 'w-full rounded-field border border-line-strong bg-surface px-3 py-2'
</script>

<template>
  <div class="min-w-0">
    <button
      type="button"
      class="max-w-64 min-w-0 truncate rounded-control px-2 py-1 font-bold transition-colors hover:bg-surface-sunken"
      :popovertarget="popoverId"
      :title="t('identity.edit')"
    >
      {{ project.name }}
    </button>

    <div
      :id="popoverId"
      popover="auto"
      class="m-auto w-full max-w-md rounded-card border border-line bg-surface p-5 text-ink shadow-pop"
    >
      <h2 class="mb-4 font-bold">{{ t('identity.title') }}</h2>

      <div class="flex flex-col gap-4">
        <AppField :label="t('identity.name')">
          <template #default="field">
            <input
              v-bind="field"
              type="text"
              :class="INPUT"
              :maxlength="MAX_FILE_NAME_LENGTH"
              :value="identity.name"
              @input="edit('name', $event)"
            />
          </template>
        </AppField>

        <div class="grid gap-4 sm:grid-cols-2">
          <AppField :label="t('identity.studentId')" :hint="t('identity.optional')">
            <template #default="field">
              <input
                v-bind="field"
                type="text"
                :class="INPUT"
                :maxlength="MAX_STUDENT_ID_LENGTH"
                :value="identity.studentId"
                @input="edit('studentId', $event)"
              />
            </template>
          </AppField>

          <AppField :label="t('identity.studentName')" :hint="t('identity.optional')">
            <template #default="field">
              <input
                v-bind="field"
                type="text"
                :class="INPUT"
                :maxlength="MAX_STUDENT_NAME_LENGTH"
                :value="identity.studentName"
                @input="edit('studentName', $event)"
              />
            </template>
          </AppField>
        </div>
      </div>

      <p class="mt-4 leading-relaxed text-ink-faint">
        {{ t('identity.fileNameHint', { fileName }) }}
      </p>
    </div>
  </div>
</template>
