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

import { computed, nextTick, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppButton from '@/components/AppButton.vue'
import AppChoices from '@/components/AppChoices.vue'
import AppDialog from '@/components/AppDialog.vue'
import AppField from '@/components/AppField.vue'
import ProjectPicker from '@/components/ProjectPicker.vue'
import { DATA_KINDS, DEFAULT_DATA_TYPE } from '@/data/kinds'
import { ROUTE_PROJECT_HOME } from '@/router'
import { ACTION_ICONS } from '@/icons'
import { MAX_FILE_NAME_LENGTH } from '@/limits'
import { newProjectDocument, newProjectSeed } from '@/project/create'
import type { DataType } from '@/project/schema'
import { readFileBytes } from '@/project/download'
import { readProject } from '@/project/format'
import { deleteProject, listProjects, saveProject, type ProjectSummary } from '@/project/storage'
import { useToastStore } from '@/stores/toasts'

const { t, locale } = useI18n()
const router = useRouter()
const toasts = useToastStore()

const summaries = ref<ProjectSummary[]>([])

/**
 * 첫 목록 읽기가 끝났는가. **한 번만 뒤집힌다.**
 *
 * 이 화면은 세로 가운데 정렬이라, 목록이 IndexedDB에서 늦게 도착해 아래에 붙으면
 * **블록이 자라면서 가운데가 다시 잡히고 전체가 위로 튄다.** 학생 눈에는 화면이 한 번
 * 흔들리는 것으로 보인다. 그래서 첫 읽기 전에는 아무것도 안 그리고, 도착한 뒤 최종
 * 자리에 한 번에 그린다.
 *
 * **두 번째부터는 안 비운다.** 지우기·가져오기 뒤의 갱신에서도 화면이 사라졌다
 * 나타나면 그게 더 나쁘다.
 */
const ready = ref(false)
const busy = ref(false)

const creating = ref(false)
const name = ref('')
const dataType = ref<DataType>(DEFAULT_DATA_TYPE)

/**
 * 종류를 묻는가. **선택지가 하나면 묻지 않는다**
 * (open-decisions.md "데이터 종류는 프로젝트를 만들 때 고르고, 그 뒤로 안 바뀐다").
 *
 * 아무것도 보기 전에 받는 질문이라 값이 하나뿐일 때까지 물으면 순수한 소음이다.
 * 숫자를 적지 않는 이유는 판이 늘거나 줄 때 이 자리가 따라 움직이지 않게 하기 위해서다.
 */
const asksDataType = computed(() => DATA_KINDS.length > 1)

/**
 * 고를 수 있는 종류들. **전부 켜져 있다** — 목록 자체가 "판이 있는 것"이라
 * 꺼질 이유가 없다. 꺼진 칸이 생기는 것은 사유를 댈 수 있는 축에서다 (AppChoices).
 */
const dataTypeChoices = computed(() =>
  DATA_KINDS.map((kind) => ({ id: kind.dataType, label: t(kind.labelKey), enabled: true })),
)

/** 고른 칸의 id를 종류로 되돌린다. 등록부에 없는 id는 온 적이 없다 — 목록이 거기서 났다. */
function pickDataType(id: string): void {
  const kind = DATA_KINDS.find((one) => one.dataType === id)
  if (kind !== undefined) dataType.value = kind.dataType
}
const removing = ref<ProjectSummary | null>(null)

/**
 * 프로젝트 목록. **지우기 확인창을 닫은 뒤 다시 열어 주려고** 잡아 둔다.
 *
 * 확인창이 열리면 목록(popover)은 브라우저가 닫는다. 그대로 두면 지운 사람은 결과를
 * 확인하러, 취소한 사람은 보던 자리로 돌아가려고 **버튼을 한 번 더 눌러야 한다.**
 */
const picker = ref<InstanceType<typeof ProjectPicker> | null>(null)

/** 확인창을 닫고 목록을 되돌린다. 확인창이 화면에서 사라진 뒤라야 열린다. */
function closeRemove(): void {
  removing.value = null
  void nextTick(() => picker.value?.open())
}
const openInput = ref<HTMLInputElement | null>(null)

const canCreate = computed(() => name.value.trim().length > 0 && !busy.value)

async function refresh(): Promise<void> {
  try {
    summaries.value = await listProjects()
  } catch (error) {
    toasts.pushError(error)
  } finally {
    // 실패해도 뒤집는다 - 못 읽은 것과 아직 안 읽은 것은 다르고, 못 읽었어도
    // [새 프로젝트]와 [파일 불러오기]는 여전히 할 수 있어야 한다.
    ready.value = true
  }
}

function openCreate(): void {
  name.value = ''
  // 지난번에 고른 것이 남아 있으면 학생이 안 본 채로 만들어진다. 매번 처음으로 돌린다.
  dataType.value = DEFAULT_DATA_TYPE
  creating.value = true
}

function openProject(projectId: string): void {
  void router.push({ name: ROUTE_PROJECT_HOME, params: { projectId } })
}

async function create(): Promise<void> {
  if (!canCreate.value) return
  busy.value = true
  try {
    // **과제 유형은 여기서 정하지 않는다.** 표를 보기도 전에 분류인지 회귀인지 아는
    // 학생은 없다. 무엇을 예측할지 고르는 전처리 화면이 그 판단이 서는 자리다
    // (mlpx-spec.md §0.1 - 자동으로 판정하지 않고 학생이 고른다).
    const document = newProjectDocument(
      { name: name.value.trim(), locale: locale.value, dataType: dataType.value },
      newProjectSeed(),
    )
    await saveProject({ document, models: new Map(), images: new Map(), embeddings: new Map() })
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
    await refresh()
    closeRemove()
  } catch (error) {
    toasts.pushError(error)
  } finally {
    busy.value = false
  }
}

// 프로젝트를 놓아주는 것은 라우터가 한다(router/index.ts). 화면의 생명주기에
// 맡기면 순서가 어긋났을 때 열어 둔 프로젝트가 그대로 남는다.
onMounted(refresh)
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
    <div v-if="ready" class="flex w-full max-w-xl flex-col items-center gap-8">
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
          ref="picker"
          :summaries="summaries"
          :disabled="busy"
          @open="openProject"
          @remove="removing = $event"
        />
      </div>

      <input ref="openInput" type="file" accept=".mlpx" class="hidden" @change="openFile" />

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
            **이름 다음이다.** 종류가 첫 질문이면 아무것도 안 본 학생이 모르는 것부터
            받는다. 이름은 무엇을 물어보는지 알고 답할 수 있는 유일한 칸이다.
          -->
          <AppChoices
            v-if="asksDataType"
            :label="t('projects.dataType')"
            :hint="t('projects.dataTypeHint')"
            :items="dataTypeChoices"
            :selected="dataType"
            @pick="pickDataType"
          />
        </form>

        <template #actions>
          <AppButton variant="secondary" @click="creating = false">{{
            t('common.cancel')
          }}</AppButton>
          <AppButton :disabled="!canCreate" :action="create">{{ t('projects.create') }}</AppButton>
        </template>
      </AppDialog>

      <AppDialog
        :open="removing !== null"
        :title="t('projects.deleteTitle')"
        :description="t('projects.deleteDescription', { name: removing?.name ?? '' })"
        @close="closeRemove"
      >
        <template #actions>
          <AppButton variant="secondary" @click="removing = null">{{
            t('common.cancel')
          }}</AppButton>
          <AppButton variant="danger" :action="remove">
            {{ t('projects.delete') }}
          </AppButton>
        </template>
      </AppDialog>
    </div>
  </div>
</template>
