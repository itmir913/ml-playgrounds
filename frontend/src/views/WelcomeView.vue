<script setup lang="ts">
/**
 * 작업실을 열었을 때의 가운데. **홈 페이지가 아니다** (architecture.md §8.6) —
 * 껍데기는 이미 떠 있고 여기는 그 안의 내용일 뿐이다.
 *
 * 할 일은 둘뿐이다 — 새로 만들거나, 있던 것을 열거나. 최근 프로젝트는 그 아래
 * 딸린 것이다.
 *
 * **문서 전체를 열지 않는다.** 목록에 필요한 것은 요약뿐이고, 여기서 문서를 열면
 * 프로젝트 수만큼 데이터셋 바이트가 메모리로 올라온다 (storage.ts의 ProjectSummary).
 *
 * 새로 만든 프로젝트는 **표가 없는 상태**로 저장되고 데이터 단계에서 시작한다
 * (open-decisions.md "데이터 없는 프로젝트는 정상 상태다").
 */

import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import AppDialog from '@/components/AppDialog.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import AppField from '@/components/AppField.vue'
import { useFormat } from '@/composables/useFormat'
import { MAX_FILE_NAME_LENGTH } from '@/limits'
import { supportedTaskTypes } from '@/ml/algorithms'
import { newProjectDocument, newProjectSeed } from '@/project/create'
import type { TaskType } from '@/project/schema'
import { deleteProject, listProjects, saveProject, type ProjectSummary } from '@/project/storage'
import { FIRST_STEP } from '@/router/steps'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'

const { t, locale } = useI18n()
const router = useRouter()
const format = useFormat()
const project = useProjectStore()
const toasts = useToastStore()

const summaries = ref<ProjectSummary[]>([])
const loading = ref(true)
const busy = ref(false)

const creating = ref(false)
const name = ref('')
const taskType = ref<TaskType>('classification')
const removing = ref<ProjectSummary | null>(null)

/** 알고리즘이 하나라도 있는 유형만 고르게 한다 (ml/algorithms.ts). */
const taskTypes = supportedTaskTypes()

const canCreate = computed(() => name.value.trim().length > 0 && !busy.value)

async function refresh(): Promise<void> {
  loading.value = true
  try {
    summaries.value = await listProjects()
  } catch (error) {
    toasts.pushError(error)
  } finally {
    loading.value = false
  }
}

function openCreate(): void {
  name.value = ''
  taskType.value = taskTypes[0] ?? 'classification'
  creating.value = true
}

function openProject(projectId: string): void {
  void router.push({ name: FIRST_STEP, params: { projectId } })
}

async function create(): Promise<void> {
  if (!canCreate.value) return
  busy.value = true
  try {
    const document = newProjectDocument(
      { name: name.value.trim(), taskType: taskType.value, locale: locale.value },
      newProjectSeed(),
    )
    await saveProject({ document, models: new Map() })
    creating.value = false
    openProject(document.manifest.projectId)
  } catch (error) {
    toasts.pushError(error)
  } finally {
    busy.value = false
  }
}

async function remove(): Promise<void> {
  const target = removing.value
  if (!target || busy.value) return
  busy.value = true
  try {
    await deleteProject(target.projectId)
    removing.value = null
    await refresh()
  } catch (error) {
    toasts.pushError(error)
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  // 목록으로 돌아오면 열어 둔 프로젝트를 놓아준다. 데이터셋 바이트를 계속 들고 있을
  // 이유가 없고, 교실 PC에서는 그 몇십 MB가 그대로 비용이다.
  project.close()
  await refresh()
})
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
    <div class="text-center">
      <h2 class="text-2xl font-black tracking-tight">{{ t('app.name') }}</h2>
      <p class="mt-2 leading-relaxed text-ink-soft">{{ t('app.tagline') }}</p>

      <div class="mt-6">
        <AppButton size="lg" @click="openCreate">{{ t('projects.new') }}</AppButton>
      </div>
    </div>

    <section>
      <h3 class="mb-3 text-sm font-bold text-ink-soft">{{ t('projects.title') }}</h3>

      <p v-if="loading" class="text-sm text-ink-faint">{{ t('projects.loading') }}</p>

      <AppEmpty
        v-else-if="summaries.length === 0"
        :reason="t('projects.empty.title')"
        :next="t('projects.empty.description')"
      >
        <AppButton @click="openCreate">{{ t('projects.new') }}</AppButton>
      </AppEmpty>

      <ul v-else class="flex flex-col gap-2">
        <li
          v-for="summary in summaries"
          :key="summary.projectId"
          class="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-panel border border-line bg-surface px-4 py-3 transition-colors hover:border-brand-line"
        >
          <button
            type="button"
            class="min-w-0 flex-1 text-left"
            @click="openProject(summary.projectId)"
          >
            <span class="block truncate font-bold">{{ summary.name }}</span>
            <span class="mt-0.5 block text-xs text-ink-faint">
              {{ format.dateTime(summary.updatedAt) }}
            </span>
          </button>

          <span
            class="rounded-pill bg-brand-soft px-2.5 py-0.5 text-xs font-bold whitespace-nowrap text-brand"
          >
            {{ t(`taskTypes.${summary.taskType}`) }}
          </span>
          <span class="text-xs whitespace-nowrap text-ink-faint">
            {{ format.bytes(summary.sizeBytes) }}
          </span>

          <AppButton variant="ghost" @click="removing = summary">
            {{ t('projects.delete') }}
          </AppButton>
        </li>
      </ul>

      <p class="mt-6 text-xs leading-relaxed text-ink-faint">{{ t('projects.storageNote') }}</p>
    </section>

    <AppDialog
      :open="creating"
      :title="t('projects.newTitle')"
      :description="t('projects.newDescription')"
      @close="creating = false"
    >
      <form class="flex flex-col gap-6" @submit.prevent="create">
        <AppField :label="t('projects.name')" :hint="t('projects.nameHint')">
          <template #default="field">
            <input
              v-bind="field"
              v-model="name"
              type="text"
              :maxlength="MAX_FILE_NAME_LENGTH"
              autofocus
              class="w-full rounded-field border border-line-strong bg-surface px-3 py-2.5"
            />
          </template>
        </AppField>

        <!--
          라디오 묶음은 AppField를 쓰지 않는다. <label for>가 가리킬 입력이 하나가
          아니라 여럿이라 fieldset/legend가 맞는 모양이다.
        -->
        <fieldset>
          <legend class="mb-2 text-sm font-bold text-ink-soft">{{ t('projects.taskType') }}</legend>
          <div class="flex flex-wrap gap-2">
            <label
              v-for="option in taskTypes"
              :key="option"
              class="cursor-pointer rounded-control border px-3 py-2 font-bold transition-colors"
              :class="
                taskType === option
                  ? 'border-brand bg-brand-soft text-brand'
                  : 'border-line text-ink-soft hover:bg-surface-sunken'
              "
            >
              <input v-model="taskType" type="radio" :value="option" class="sr-only" />
              {{ t(`taskTypes.${option}`) }}
            </label>
          </div>
        </fieldset>
      </form>

      <template #actions>
        <AppButton variant="ghost" @click="creating = false">{{ t('common.cancel') }}</AppButton>
        <AppButton :disabled="!canCreate" @click="create">{{ t('projects.create') }}</AppButton>
      </template>
    </AppDialog>

    <AppDialog
      :open="removing !== null"
      :title="t('projects.deleteTitle')"
      :description="t('projects.deleteDescription', { name: removing?.name ?? '' })"
      @close="removing = null"
    >
      <template #actions>
        <AppButton variant="ghost" @click="removing = null">{{ t('common.cancel') }}</AppButton>
        <AppButton variant="danger" :disabled="busy" @click="remove">
          {{ t('projects.delete') }}
        </AppButton>
      </template>
    </AppDialog>
  </div>
</template>
