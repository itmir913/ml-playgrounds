<script setup lang="ts">
/**
 * 파일로 내보내기. **버튼을 누르면 팝오버가 열리고, 진짜 내보내기는 그 안에 있다.**
 *
 * 곧장 내려받지 않는 이유는 **여기가 학번과 이름을 물어볼 유일하게 자연스러운 자리**이기
 * 때문이다. 그 둘은 파일 이름 앞에 붙는 것이고(`10203_홍길동_붓꽃품종분류.mlpx`),
 * 그러므로 파일을 만드는 순간에 정하는 것이 맞다. 프로젝트를 만들 때 미리 묻거나
 * 이름 편집기에 끼워 넣으면 학생은 그게 어디에 쓰이는지 모른다.
 *
 * 지금 누르면 무슨 이름이 되는지를 함께 보여준다. 적은 것이 어디로 가는지 눈에 보여야
 * 한다.
 */

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppField from '@/components/AppField.vue'
import AppPopover from '@/components/AppPopover.vue'
import { ACTION_ICONS } from '@/icons'
import { MAX_STUDENT_ID_LENGTH, MAX_STUDENT_NAME_LENGTH } from '@/limits'
import { projectFileName } from '@/project/format'
import { renderPortfolioMarkdown } from '@/project/portfolio'
import { portfolioMarkdownText } from '@/project/portfolio-text'
import { identityOf, withIdentity } from '@/project/identity'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'

const { t, locale } = useI18n()
const project = useProjectStore()
const toasts = useToastStore()

const studentId = ref('')
const studentName = ref('')

/** 열려 있는 프로젝트가 바뀌면 적혀 있던 값을 다시 읽어 온다. */
watch(
  () => project.projectId,
  () => {
    const manifest = project.file?.document.manifest
    const identity = manifest === undefined ? null : identityOf(manifest)
    studentId.value = identity?.studentId ?? ''
    studentName.value = identity?.studentName ?? ''
  },
  { immediate: true },
)

/** 지금 내보내면 무슨 이름이 되는가. 적은 것이 어디에 쓰이는지 보여준다. */
const fileName = computed(() => {
  const file = project.file
  if (!file) return ''
  const document = withIdentity(
    file.document,
    {
      name: file.document.manifest.name,
      studentId: studentId.value,
      studentName: studentName.value,
    },
    file.document.manifest.updatedAt,
  )
  return projectFileName(document.manifest)
})

async function exportFile(close: () => void): Promise<void> {
  const file = project.file
  if (!file) return
  try {
    // 적은 인적사항을 먼저 문서에 넣는다. 파일 이름이 그것으로 만들어져야 한다.
    project.update({
      ...file,
      document: withIdentity(
        file.document,
        {
          name: file.document.manifest.name,
          studentId: studentId.value,
          studentName: studentName.value,
        },
        new Date().toISOString(),
      ),
    })

    // portfolio.md는 파생물이지만 파일에 담는다 - 교사가 압축을 풀어 메모장으로
    // 열어도 학생이 무엇을 썼는지 보여야 한다 (CLAUDE.md §1.3).
    const markdown = renderPortfolioMarkdown(
      portfolioMarkdownText(file.document.manifest, (key) => t(key), locale.value),
      file.document.portfolio,
    )
    const dropped = await project.exportFile(markdown)
    close()

    toasts.push('success', 'project.exportDone')
    if (dropped.length > 0) {
      // 조용히 빠지면 학생은 예측이 왜 안 되는지 모른다.
      toasts.push('caution', 'project.exportDropped', { count: dropped.length })
    }
  } catch (error) {
    toasts.pushError(error)
  }
}

const INPUT = 'w-full rounded-field border border-line-strong bg-surface px-3 py-2'
</script>

<template>
  <AppPopover align="right">
    <template #trigger>
      <AppButton variant="secondary">
        <component :is="ACTION_ICONS.exportFile" :size="18" aria-hidden="true" />
        <span class="max-md:hidden">{{ t('project.export') }}</span>
      </AppButton>
    </template>

    <template #default="{ close }">
      <h2 class="mb-1 font-bold">{{ t('project.export') }}</h2>
      <p class="mb-4 leading-relaxed text-ink-soft">{{ t('project.exportLead') }}</p>

      <div class="flex flex-col gap-3">
        <AppField :label="t('identity.studentId')">
          <template #default="field">
            <input
              v-bind="field"
              v-model="studentId"
              type="text"
              :class="INPUT"
              :maxlength="MAX_STUDENT_ID_LENGTH"
            />
          </template>
        </AppField>

        <AppField :label="t('identity.studentName')">
          <template #default="field">
            <input
              v-bind="field"
              v-model="studentName"
              type="text"
              :class="INPUT"
              :maxlength="MAX_STUDENT_NAME_LENGTH"
            />
          </template>
        </AppField>
      </div>

      <p class="mt-4 leading-relaxed break-all text-ink-faint">
        {{ t('identity.fileNameHint', { fileName }) }}
      </p>

      <AppButton size="lg" class="mt-4 w-full" :action="() => exportFile(close)">
        <component :is="ACTION_ICONS.exportFile" :size="20" aria-hidden="true" />
        {{ t('project.exportNow') }}
      </AppButton>
    </template>
  </AppPopover>
</template>
