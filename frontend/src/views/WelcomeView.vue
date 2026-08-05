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
import AppField from '@/components/AppField.vue'
import ProjectPicker from '@/components/ProjectPicker.vue'
import { ACTION_ICONS } from '@/icons'
import { MAX_FILE_NAME_LENGTH } from '@/limits'
import { newProjectDocument, newProjectSeed } from '@/project/create'
import { readFileBytes } from '@/project/download'
import { readProject } from '@/project/format'
import { deleteProject, listProjects, saveProject, type ProjectSummary } from '@/project/storage'
import { FIRST_STEP } from '@/router/steps'
import { useProjectStore } from '@/stores/project'
import { useToastStore } from '@/stores/toasts'

const { t, locale } = useI18n()
const router = useRouter()
const project = useProjectStore()
const toasts = useToastStore()

const summaries = ref<ProjectSummary[]>([])
const loading = ref(true)
const busy = ref(false)

const creating = ref(false)
const name = ref('')
const removing = ref<ProjectSummary | null>(null)
const openInput = ref<HTMLInputElement | null>(null)

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
  creating.value = true
}

function openProject(projectId: string): void {
  void router.push({ name: FIRST_STEP, params: { projectId } })
}

async function create(): Promise<void> {
  if (!canCreate.value) return
  busy.value = true
  try {
    // **과제 유형은 여기서 정하지 않는다.** 표를 보기도 전에 분류인지 회귀인지 아는
    // 학생은 없다. 무엇을 예측할지 고르는 전처리 화면이 그 판단이 서는 자리다
    // (mlpx-spec.md §0.1 - 자동으로 판정하지 않고 학생이 고른다).
    const document = newProjectDocument(
      { name: name.value.trim(), locale: locale.value },
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

/**
 * `.mlpx`를 열어 이 브라우저에 들인다.
 *
 * **컴퓨터실 PC는 전원을 끄면 디스크가 되돌아간다.** 다음 차시에 학생이 하는 첫
 * 동작이 이것이고, 그래서 새 프로젝트 옆에 나란히 둔다.
 *
 * 같은 projectId가 이미 있으면 덮어쓴다 - 같은 프로젝트를 다시 가져온 것이므로
 * 새로 만드는 것이 아니라 최신으로 맞추는 것이 맞다.
 */
async function openFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  // 같은 파일을 다시 고를 수 있어야 한다.
  input.value = ''
  if (!picked || busy.value) return

  busy.value = true
  try {
    const { project: opened, integrity } = await readProject(await readFileBytes(picked))
    await saveProject(opened)
    if (integrity.status === 'MODIFIED') {
      // 고쳐졌다고 열어 주지 않을 이유는 없다. 다만 말은 해 준다 (mlpx-spec.md §7.3).
      toasts.push('caution', 'project.openModified')
    }
    openProject(opened.document.manifest.projectId)
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
  <!--
    **화면 가운데에 둘만 놓는다.** 컴퓨터실 PC는 다음 차시에 리셋되므로 여기서
    학생이 하는 첫 동작은 대개 "파일 열기"다. 그 상황에서 빈 목록과 "아직 없습니다"는
    순수한 소음이다.

    저장된 것이 있을 때만 아래에 조용히 붙는다 - 가정 PC에서는 남아 있고, 그때는
    이어서 하는 것이 필요하다.
  -->
  <div class="flex min-h-full items-center justify-center p-6">
    <div class="flex w-full max-w-xl flex-col items-center gap-8">
      <div class="text-center">
        <h2 class="text-3xl font-black tracking-tight">{{ t('app.name') }}</h2>
        <p class="mt-3 leading-relaxed text-ink-soft">{{ t('app.tagline') }}</p>
      </div>

      <!-- 둘의 너비를 맞춘다. 나란한 두 선택지의 크기가 다르면 하나가 더 옳아 보인다. -->
      <div class="grid w-full max-w-xs gap-3">
        <AppButton size="lg" :disabled="busy" class="w-full" @click="openCreate">
          <component :is="ACTION_ICONS.newProject" :size="20" aria-hidden="true" />
          {{ t('projects.new') }}
        </AppButton>
        <AppButton
          size="lg"
          variant="secondary"
          :disabled="busy"
          class="w-full"
          @click="openInput?.click()"
        >
          <component :is="ACTION_ICONS.openFile" :size="20" aria-hidden="true" />
          {{ t('project.open') }}
        </AppButton>

        <ProjectPicker
          v-if="summaries.length > 0"
          :summaries="summaries"
          @open="openProject"
          @remove="removing = $event"
        />
      </div>

      <input ref="openInput" type="file" accept=".mlpx" class="hidden" @change="openFile" />

      <p class="max-w-md text-center leading-relaxed text-ink-faint">
        {{ t('projects.storageNote') }}
      </p>

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
        </form>

        <template #actions>
          <AppButton variant="ghost" @click="creating = false">{{ t('common.cancel') }}</AppButton>
          <AppButton :disabled="!canCreate" :action="create">{{ t('projects.create') }}</AppButton>
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
          <AppButton variant="danger" :action="remove">
            {{ t('projects.delete') }}
          </AppButton>
        </template>
      </AppDialog>
    </div>
  </div>
</template>
