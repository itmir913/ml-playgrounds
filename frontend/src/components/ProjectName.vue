<script setup lang="ts">
/**
 * 도구 막대의 프로젝트 이름. **누르면 그 자리가 입력칸이 된다.**
 *
 * 팝오버도 모달도 아니다 — 이름 하나를 고치는 데 창을 띄우는 것은 과하고, 고친 결과가
 * 보이는 자리와 고치는 자리가 같아야 무엇을 바꾸는지 헷갈리지 않는다.
 *
 * **저장 버튼이 없다.** 자동 저장이 뒤따르고(stores/project.ts) 상태 표시줄이 그것을
 * 말한다. Enter나 포커스를 잃으면 편집이 끝난다. Esc는 되돌린다 — 잘못 눌러 이름을
 * 지운 학생이 돌아갈 곳이 있어야 한다.
 *
 * 학번과 이름은 여기 없다. 그건 파일을 내보낼 때 정하는 것이라 내보내기 쪽에 있다.
 */

import { nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { MAX_FILE_NAME_LENGTH } from '@/limits'
import { withIdentity, identityOf } from '@/project/identity'
import { useProjectStore } from '@/stores/project'

const { t } = useI18n()
const project = useProjectStore()

const editing = ref(false)
const draft = ref('')
const input = ref<HTMLInputElement | null>(null)

async function start(): Promise<void> {
  draft.value = project.name
  editing.value = true
  await nextTick()
  input.value?.select()
}

/** 편집을 끝낸다. 빈 이름은 받지 않는다 - 이름 없는 프로젝트는 파일 이름을 잃는다. */
function commit(): void {
  const file = project.file
  editing.value = false
  if (!file) return

  const name = draft.value.trim()
  if (name === '' || name === project.name) return

  project.update({
    ...file,
    document: withIdentity(
      file.document,
      { ...identityOf(file.document.manifest), name },
      new Date().toISOString(),
    ),
  })
}

function cancel(): void {
  editing.value = false
}
</script>

<template>
  <input
    v-if="editing"
    ref="input"
    v-model="draft"
    type="text"
    class="min-w-0 rounded-field border border-brand bg-surface px-2 py-1 font-bold"
    :maxlength="MAX_FILE_NAME_LENGTH"
    :aria-label="t('projects.name')"
    @keydown.enter="commit"
    @keydown.esc="cancel"
    @blur="commit"
  />

  <!--
    **툴팁이 이름을 들고 있다.** 좁은 화면에서 이름이 잘리는데(truncate) 마우스를
    올렸을 때 "고치기"라고만 뜨면, 정작 궁금한 것인 **전체 이름**을 볼 데가 없다.
    한 문장이 둘을 다 한다 - 무엇을 하는 버튼인지와 지금 이름이 무엇인지.

    문구가 "정보"가 아니라 "이름"인 이유는 이 버튼이 이름만 바꾸기 때문이다.
    학번과 이름은 내보내기 쪽에 있다 (위 설명).
  -->
  <button
    v-else
    type="button"
    class="max-w-64 min-w-0 truncate rounded-control px-2 py-1 font-bold transition-colors hover:bg-surface-sunken"
    :title="t('identity.rename', { name: project.name })"
    :aria-label="t('identity.rename', { name: project.name })"
    @click="start"
  >
    {{ project.name }}
  </button>
</template>
