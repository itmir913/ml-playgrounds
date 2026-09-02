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
import { FALLBACK_LOCALE, isSupportedLocale } from '@/i18n'
import { NOTICES_PATH, privacyPath } from '@/legal'
import { REPOSITORY_URL } from '@/links'
import { DEMO_DATASETS_URL } from '@/links'
import { MAX_FILE_NAME_LENGTH } from '@/limits'
import { newProjectDocument, newProjectSeed } from '@/project/create'
import type { DataType } from '@/project/schema'
import { readFileBytes } from '@/project/download'
import { MLPX_EXTENSION, readProject } from '@/project/format'
import { deleteProject, listProjects, saveProject, type ProjectSummary } from '@/project/storage'
import { useWork } from '@/composables/useWork'
import { useToastStore } from '@/stores/toasts'

const { t, locale } = useI18n()
const router = useRouter()
const toasts = useToastStore()

/**
 * 지금 언어의 개인정보 처리방침. **vue-i18n의 `locale`은 문자열이라 한 번 좁힌다** -
 * 없는 언어의 주소를 만들면 학생이 404를 보고, 그것은 링크가 없는 것보다 나쁘다.
 */
const privacyHref = computed(() =>
  privacyPath(isSupportedLocale(locale.value) ? locale.value : FALLBACK_LOCALE),
)

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
/** 지금 이 화면에서 도는 일들 (architecture.md §8.10.4). */
const { busy, start } = useWork()

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
  const job = start()
  try {
    // **과제 유형은 여기서 정하지 않는다.** 표를 보기도 전에 분류인지 회귀인지 아는
    // 학생은 없다. 무엇을 예측할지 고르는 전처리 화면이 그 판단이 서는 자리다
    // (mlpx-spec.md §0.1 - 자동으로 판정하지 않고 학생이 고른다).
    const document = newProjectDocument(
      { name: name.value.trim(), locale: locale.value, dataType: dataType.value },
      newProjectSeed(),
    )
    await saveProject({
      document,
      models: new Map(),
      images: new Map(),
      attachments: new Map(),
      embeddings: new Map(),
    })
    creating.value = false
    openProject(document.manifest.projectId)
  } catch (error) {
    toasts.pushError(error)
  } finally {
    job.done()
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

  const job = start()
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
    job.done()
  }
}

async function remove(): Promise<void> {
  const target = removing.value
  if (!target || busy.value) return
  const job = start()
  try {
    await deleteProject(target.projectId)
    await refresh()
    closeRemove()
  } catch (error) {
    toasts.pushError(error)
  } finally {
    job.done()
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
  <div class="flex min-h-full flex-col p-6">
    <div
      v-if="ready"
      class="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-8"
    >
      <div class="text-center">
        <h2 class="text-3xl font-black tracking-tight">{{ t('app.name') }}</h2>
        <p class="mt-3 leading-relaxed text-ink-soft">{{ t('app.tagline') }}</p>
      </div>

      <!--
        둘의 너비를 맞춘다. 나란한 두 선택지의 크기가 다르면 하나가 더 옳아 보인다.

        **폭은 가장 긴 이름표가 정한다.** 여기 들어가는 것은 짧은 동사가 아니라
        "이 컴퓨터의 프로젝트" 같은 구절이고, 영어는 같은 뜻이 30% 정도 길다
        (`i18n.md` 규칙 7). `max-w-xs`에서는 그것이 두 줄로 접혀 **한국어와 영어의
        단추 높이가 달랐다.**

        **한 판의 여백만 줄이지 않는다.** 높이는 맞출 수 있어도 세로로 붙은 판들의
        안쪽 여백이 하나만 좁아지고, `size="lg"`가 뜻하는 것이 흐려진다.

        **좁은 화면에서는 이것으로 안 풀린다** — 화면이 이 폭보다 좁으면 상한이
        걸리지 않는다. 거기서는 접히는 것을 감수한다.
      -->
      <div class="grid w-full max-w-sm gap-3">
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

      <!--
        **올릴 데이터가 없는 학생이 막히는 자리다.** [새 프로젝트]를 누르면 곧바로
        파일을 올리라는 화면인데, 수업에 쓸 표나 사진을 아직 안 가진 학생은 거기서
        할 수 있는 일이 없다.

        **단추 아래이지 푸터가 아니다.** 아래 둘은 규정이고 성격이 다르며, 흐린
        글씨라 눈에 안 들어온다. 네 번째 단추도 아니다 — 예시를 받는 것은 주 동작이
        아니라 **그것을 하러 가기 전의 준비**다.

        **프로젝트를 만들 때 이미 표인지 이미지인지 정한다.** 그러므로 고르기 전에
        무엇이 있는지 볼 수 있어야 하고, 그 자리는 여기뿐이다.

        근거는 `open-decisions.md` "예시 데이터셋은 바깥에 있고, 앱은 주소만 갖는다".
      -->
      <a
        :href="DEMO_DATASETS_URL"
        target="_blank"
        rel="noopener noreferrer"
        class="inline-flex items-center gap-2 rounded-control text-ink-soft transition-colors hover:text-brand hover:underline"
      >
        {{ t('datasets.demo') }}
        <component :is="ACTION_ICONS.externalLink" :size="18" aria-hidden="true" />
      </a>

      <input
        ref="openInput"
        type="file"
        :accept="MLPX_EXTENSION"
        class="hidden"
        @change="openFile"
      />

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

    <!--
      **규정으로 나가는 유일한 문이다.** 고지는 산출물에 구워지는데 여기가 없으면
      앱 주소만 받은 사람은 도달할 길이 없다 — 랜딩 푸터는 다른 저장소의 페이지다
      (`open-decisions.md` "바깥에 내놓는 규정은 앱이 데리고 간다").

      **첫 화면에만 둔다.** 작업 중에 상시 보이면 셸이 넷을 넘는다
      (`architecture.md` §8.6). 아래에 붙이므로 가운데 정렬을 흔들지 않는다.

      **휴대폰에서 링크로 안 보였다** (2026-09-01, 코드 소유자). 표시가 `hover:underline`
      하나뿐이었는데 **휴대폰에는 hover가 없다** — 그러면 셋은 화면 아래 떠 있는 흐린
      글자일 뿐이고, 누를 수 있다는 것을 아무것도 말하지 않는다. **이 저장소가 이미
      진단해 둔 병이다**: `AppButton`의 ghost가 *"면도 테두리도 없어서 가만히 있을 때는
      버튼인 줄 모르고, hover로는 못 알린다"*는 이유로 **상시 밑줄**을 얻었다. 여기만
      그 규칙 밖에 있었다.

      **알리는 것은 색이다. 밑줄이 아니다** (2026-09-01, 두 번째 고침).

      처음에는 ghost처럼 상시 밑줄을 줬는데, **휴대폰에서는 셋이 세로로 쌓여 밑줄 세 줄이
      나란히 놓인다** — 잉크가 글자만큼 무거워져 푸터가 본문처럼 읽혔다. ghost가 밑줄을
      고른 이유는 **면도 테두리도 색도 없어서**였고, 여기는 색을 쓸 수 있다.

      **`brand`가 링크의 관습색이다.** 학생이 다른 데서 만나는 그 신호이고, hover 없이
      가만히 있을 때 말한다 — 그것이 애초에 고쳐야 했던 것이다.

      **안쪽 여백은 누를 자리를 만드는 것이다.** 맨 글자는 손가락에 24px짜리 과녁인데
      이 셋은 휴대폰에서 만나는 자리다. 세로는 좁게 준다 — 과녁은 가로로 넓다.

      **접히게 둔다. 쌓지 않는다.** 375px에서 둘이 한 줄에 서고 `GitHub`만 내려간다.
      세로로 셋을 쌓으면 목록처럼 보이고, 푸터가 차지할 높이가 아니다.
    -->
    <footer
      v-if="ready"
      class="mt-8 flex flex-wrap items-center justify-center gap-x-1 border-t border-line pt-3"
    >
      <a
        :href="privacyHref"
        target="_blank"
        rel="noopener noreferrer"
        class="rounded-control px-3 py-1.5 text-brand transition-colors hover:bg-surface-sunken hover:text-brand-strong"
        >{{ t('legal.privacy') }}</a
      >
      <a
        :href="NOTICES_PATH"
        target="_blank"
        rel="noopener noreferrer"
        class="rounded-control px-3 py-1.5 text-brand transition-colors hover:bg-surface-sunken hover:text-brand-strong"
        >{{ t('legal.notices') }}</a
      >
      <!--
        **아이콘이 아니라 글자다.** 옆의 둘과 같은 위계라 같은 모양이어야 하고, 로고를
        번들에 넣으면 상표와 벤더링 규약이 함께 따라온다(CLAUDE.md §4). 그리고 이 도구를
        쓰는 사람은 중고등학생이다 — **모양만으로 말하지 않는다.**

        **이름이 `소스 코드`가 아닌 이유**는 바로 옆이 `오픈소스 라이선스`라서다. 두
        링크의 목적지가 정반대인데(남의 코드 고지 대 우리 코드) 낱말이 겹치면 같은 것으로
        읽힌다. 그리고 밖으로 나가는 링크는 **어디로 가는지**를 말해야 한다.
      -->
      <a
        :href="REPOSITORY_URL"
        target="_blank"
        rel="noopener noreferrer"
        class="rounded-control px-3 py-1.5 text-brand transition-colors hover:bg-surface-sunken hover:text-brand-strong"
        >{{ t('legal.source') }}</a
      >
    </footer>
  </div>
</template>
