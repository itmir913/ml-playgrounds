<script setup lang="ts">
/**
 * 프로젝트 목록. 앱을 열면 여기부터다.
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
import AppCard from '@/components/AppCard.vue'
import AppDialog from '@/components/AppDialog.vue'
import AppField from '@/components/AppField.vue'
import AppHero from '@/components/AppHero.vue'
import { useFormat } from '@/composables/useFormat'
import { MAX_FILE_NAME_LENGTH } from '@/limits'
import { supportedTaskTypes } from '@/ml/algorithms'
import { newProjectDocument, newProjectSeed } from '@/project/create'
import { deleteProject, listProjects, saveProject, type ProjectSummary } from '@/project/storage'
import type { TaskType } from '@/project/schema'
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
    await router.push({
      name: FIRST_STEP,
      params: { projectId: document.manifest.projectId },
    })
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
  <div class="min-h-screen">
    <AppHero :badge="t('app.name')" :title="t('projects.title')" :description="t('app.tagline')">
      <div class="mt-2">
        <AppButton variant="secondary" size="lg" @click="openCreate">
          {{ t('projects.new') }}
        </AppButton>
      </div>
    </AppHero>

    <main class="mx-auto max-w-shell px-4 py-8 sm:px-6 md:py-12">
      <p v-if="loading" class="text-ink-soft">{{ t('projects.loading') }}</p>

      <AppCard
        v-else-if="summaries.length === 0"
        :title="t('projects.empty.title')"
        :description="t('projects.empty.description')"
      >
        <AppButton size="lg" @click="openCreate">{{ t('projects.new') }}</AppButton>
      </AppCard>

      <template v-else>
        <p class="mb-4 text-sm font-bold text-ink-soft">
          {{ t('projects.count', summaries.length) }}
        </p>

        <ul class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <li
            v-for="summary in summaries"
            :key="summary.projectId"
            class="flex flex-col gap-4 rounded-card border border-line bg-surface p-6 shadow-card"
          >
            <div>
              <span
                class="inline-block rounded-pill bg-brand-soft px-3 py-1 text-xs font-bold text-brand"
              >
                {{ t(`taskTypes.${summary.taskType}`) }}
              </span>
              <h2 class="mt-3 text-lg font-bold break-keep">{{ summary.name }}</h2>
            </div>

            <dl class="mt-auto flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
              <div class="flex gap-2">
                <dt class="sr-only">{{ t('projects.updatedAt') }}</dt>
                <dd>{{ format.dateTime(summary.updatedAt) }}</dd>
              </div>
              <div class="flex gap-2">
                <dt class="sr-only">{{ t('projects.size') }}</dt>
                <dd>{{ format.bytes(summary.sizeBytes) }}</dd>
              </div>
            </dl>

            <div class="flex flex-wrap gap-2">
              <AppButton
                @click="router.push({ name: FIRST_STEP, params: { projectId: summary.projectId } })"
              >
                {{ t('projects.open') }}
              </AppButton>
              <AppButton variant="ghost" @click="removing = summary">
                {{ t('projects.delete') }}
              </AppButton>
            </div>
          </li>
        </ul>
      </template>

      <p class="mt-8 text-sm leading-relaxed text-ink-faint">{{ t('projects.storageNote') }}</p>
    </main>

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
              class="w-full rounded-field border border-line-strong bg-surface px-4 py-3 text-lg"
            />
          </template>
        </AppField>

        <!--
          라디오 묶음은 AppField를 쓰지 않는다. <label for>가 가리킬 입력이 하나가
          아니라 여럿이라 fieldset/legend가 맞는 모양이다.
        -->
        <fieldset class="flex flex-col gap-2">
          <legend class="mb-2 text-sm font-bold text-ink-soft">{{ t('projects.taskType') }}</legend>
          <div class="flex flex-wrap gap-2">
            <label
              v-for="option in taskTypes"
              :key="option"
              class="cursor-pointer rounded-control border px-4 py-2.5 font-bold transition-colors"
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
