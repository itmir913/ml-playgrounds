<script setup lang="ts">
/**
 * **점검** — 교사가 제출물을 열어 보는 화면 (architecture.md §8.21).
 *
 * 이 판은 명렬까지다. 고른 파일의 열람·무결성·재실행 대조는 이어서 붙는다.
 *
 * **읽기 전용이다.** 원본 `.mlpx`를 고칠 길을 안 만든다 — 저장도, 내려받기도, 탭 잠금도
 * 여기서 안 부른다 (`tests/inspect-rules.spec.ts`가 지킨다).
 *
 * **입구는 둘이고 경로는 하나다.** 폴더째 고르든 파일 하나를 고르든 같은 명렬을 지난다 —
 * 항목이 하나뿐이면 자동으로 골라 손이 한 번 준다.
 *
 * **명렬은 표다** (2026-09-18, 사용자). 교사가 여기서 하는 일은 읽기가 아니라 **비교**다 —
 * "실험이 0개인 줄이 누구지"를 찾는 동작은 세로 훑기이고, 카드 목록은 그것을 못 한다.
 * 그리고 **열이 곧 정렬 기준**이라 기준이 화면 밖으로 안 나간다. 무결성과 대조 판정이
 * 붙을 자리도 열이다.
 */

import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppButton from '@/components/AppButton.vue'
import AppTable from '@/components/AppTable.vue'
import ProjectSummary from '@/components/ProjectSummary.vue'
import { useRoster } from '@/composables/useRoster'
import { errorMessageKey, type ClientErrorCode } from '@/errors'
import { ACTION_ICONS } from '@/icons'
import { experimentPreprocessor } from '@/ml/preprocess'
import { experimentOrder } from '@/ml/results'
import { readDataset } from '@/project/dataset'
import { MLPX_EXTENSION } from '@/project/format'
import { rosterOf, sortRoster, type RosterItem, type RosterSort } from '@/project/roster'
import ExperimentDetail from './results/ExperimentDetail.vue'
import ExperimentList from './results/ExperimentList.vue'

const { t } = useI18n()
const roster = useRoster()

const folderInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

/** 지금 보고 있는 줄. **명렬이 갈리면 비운다** — 없는 줄을 가리키고 있을 수 없다. */
const opened = ref<RosterItem | null>(null)

/** 고른 실험. 없으면 마지막 실험을 본다 — 교사가 먼저 볼 것은 학생이 마지막에 한 일이다. */
const selected = ref<string | null>(null)

/** 지금 정렬 기준. 기본은 이름표순이라 **폴더째 고르면 반이 묶여 선다.** */
const sort = ref<RosterSort>('label')
const descending = ref(false)

/**
 * 고른 것을 명렬로 바꾼다. **입구 둘이 여기서 하나가 된다.**
 *
 * 입력 요소의 값을 비우는 이유는 **같은 폴더를 다시 고를 수 있어야 하기 때문**이다 —
 * 안 비우면 두 번째 선택에서 `change`가 안 온다.
 */
function pick(event: Event): void {
  const input = event.target as HTMLInputElement
  const picked = rosterOf([...(input.files ?? [])])
  input.value = ''
  roster.show(picked)
}

/** 항목이 하나뿐이면 자동으로 고른다. 경로는 같고 누르는 손이 한 번 준다. */
watch(roster.items, (items) => {
  opened.value = null
  const only = items.length === 1 ? items[0] : undefined
  if (only) select(only)
})

/**
 * 이 줄을 본다. **기다리지 않는다** — 고르는 순간 아래가 `읽는 중`으로 서고, 요약이
 * 도착하면 그 자리가 채워진다. 여기서 `await`하면 누른 것이 화면에 늦게 반영된다.
 */
function select(item: RosterItem): void {
  opened.value = item
  selected.value = null
  void roster.open(item)
}

/** 같은 열을 다시 누르면 방향이 뒤집힌다. 다른 열이면 오름차순부터다. */
function sortBy(key: RosterSort): void {
  descending.value = sort.value === key ? !descending.value : false
  sort.value = key
}

const summaryOfOpened = computed(() =>
  opened.value ? roster.summaries.value.get(opened.value.label) : undefined,
)

/**
 * 열어 본 제출물의 재료. **파일을 아는 것은 이 화면 하나이고, 아래는 받은 것을 나르기만
 * 한다** (`ResultsView`가 적어 둔 같은 규칙).
 *
 * **여기서 읽는 것들은 전부 이미 있던 함수다** — 정본 표는 `readDataset`, 실험의 전처리기는
 * `experimentPreprocessor`, 번호는 `experimentOrder`. 옮겨 적으면 결과 화면과 점검 화면이
 * 다른 숫자를 말하게 된다.
 */
const viewing = computed(() => {
  const file = roster.opened.value?.read.project
  if (!file || roster.opened.value?.item.label !== opened.value?.label) return null

  const experiments = file.document.runs.experiments
  const index = Math.max(
    experiments.findIndex((experiment) => experiment.id === selected.value),
    0,
  )
  const current = experiments[experiments.length === 0 ? -1 : index]
  return {
    file,
    experiments,
    current,
    order: experimentOrder(experiments),
    previous: index > 0 ? experiments[index - 1] : undefined,
    dataset: readDataset(file),
    preprocessor: current ? experimentPreprocessor(current, file.models) : null,
  }
})

/** 몇 줄까지 읽었는가. 훑는 동안 교사가 기다림의 크기를 안다. */
const progress = computed(() => ({
  read: roster.summaries.value.size,
  total: roster.items.value.length,
}))

/**
 * 표에 그릴 줄들. **판단을 템플릿에 두지 않는다** — 상태 셋(읽는 중·읽음·못 읽음)이
 * `v-if` 사슬로 흩어지면 그중 하나가 빠져도 아무도 모른다.
 */
const rows = computed(() =>
  sortRoster(roster.items.value, roster.summaries.value, sort.value, descending.value).map(
    (item) => {
      const summary = roster.summaries.value.get(item.label)
      const read = summary?.state === 'read' ? summary : undefined
      return {
        item,
        student: read ? (read.student ?? t('inspect.noStudent')) : '',
        experiments: read ? t('meta.countUnit', read.experiments) : '',
        runs: read ? t('meta.countUnit', read.runs) : '',
        state: read
          ? t(`dataTypes.${read.dataType}`)
          : summary
            ? t('inspect.unreadable')
            : t('inspect.reading'),
        /** 값이 아직 없는 줄. 회색으로 두어 훑는 눈이 건너뛴다. */
        faint: !read,
      }
    },
  ),
)

/** 열 머리. **여기 한 줄을 더하면 표가 따라온다** — 머리와 칸이 같은 목록에서 나온다. */
const COLUMNS: readonly {
  key: RosterSort
  label: string
  numeric: boolean
  /** 좁은 화면에서 접는 열. 제출물 이름과 상태만 남는다. */
  wide: boolean
  /**
   * 그 열의 너비. **머리 글자가 접히지 않을 만큼 준다** — 접히면 머리 줄의 높이가
   * 열마다 달라지고, 정렬로 화살표가 붙고 떨어질 때 그 높이가 흔들린다.
   */
  width: string
}[] = [
  { key: 'label', label: 'inspect.file', numeric: false, wide: false, width: 'w-full' },
  { key: 'student', label: 'inspect.student', numeric: false, wide: true, width: 'w-32' },
  { key: 'experiments', label: 'inspect.experiments', numeric: true, wide: true, width: 'w-44' },
  { key: 'runs', label: 'inspect.runs', numeric: true, wide: true, width: 'w-36' },
]

/** 못 읽은 줄의 사유 문장. **코드를 화면이 문장으로 바꾼다** (CLAUDE.md §1.4). */
function reasonOf(code: string): string {
  return t(errorMessageKey(code as ClientErrorCode))
}
</script>

<template>
  <div class="flex min-h-full flex-col gap-5 p-4 sm:p-5">
    <header class="flex flex-col gap-2">
      <h2 class="text-2xl font-black tracking-tight">{{ t('inspect.title') }}</h2>
      <p class="leading-relaxed text-ink-soft">{{ t('inspect.lead') }}</p>
    </header>

    <!--
      **입구 둘을 나란히 둔다** (§8의 "같은 규칙의 두 모양"). 휴대폰에는 폴더 고르기가
      없으므로 폴백이 아니라 나란한 길이고, 둘 다 같은 명렬로 들어간다.
    -->
    <div class="flex flex-wrap gap-3">
      <AppButton @click="folderInput?.click()">
        <component :is="ACTION_ICONS.openFile" :size="20" aria-hidden="true" />
        {{ t('inspect.pickFolder') }}
      </AppButton>
      <AppButton variant="secondary" @click="fileInput?.click()">
        <component :is="ACTION_ICONS.openFile" :size="20" aria-hidden="true" />
        {{ t('inspect.pickFiles') }}
      </AppButton>
    </div>

    <input
      ref="fileInput"
      type="file"
      multiple
      :accept="MLPX_EXTENSION"
      class="hidden"
      @change="pick"
    />
    <!--
      **폴더 입구를 따로 둔다** (데이터 화면의 사진 입구와 같은 관용구). 같은 입력에
      `webkitdirectory`를 걸면 파일 몇 개만 고르는 길이 없어진다.
    -->
    <input ref="folderInput" type="file" webkitdirectory class="hidden" @change="pick" />

    <p v-if="roster.items.value.length === 0" class="text-ink-soft">
      {{ t('inspect.empty') }}
    </p>

    <template v-else>
      <!-- 머리글은 표에 붙는다. 바깥 리듬(`gap-5`)이 아니라 제 짝과의 간격이다. -->
      <div class="flex flex-col gap-2">
        <h3 class="font-bold text-ink-soft">
          {{ t('inspect.roster', { read: progress.read, total: progress.total }) }}
        </h3>

        <!--
          **표의 껍데기는 `AppTable`이 갖는다** — 머리 줄의 색도, 줄 사이의 선도, 넘칠 때의
          처리도 거기 있다(`data-table`). 여기서 다시 그리면 이 앱의 표 아홉 중 하나만
          다른 모양이 된다.

          **높이에 상한이 있다** (§8.9, 전처리의 열 고르기와 같은 값). 제출물이 서른이면
          표만 1,400px이라 **고른 줄의 상세가 화면 밖으로 밀린다** — 교사는 누르고 나서
          한참 내려가야 무엇을 눌렀는지 본다. 상한을 두면 상세가 늘 표 바로 아래에 선다.

          **그래서 머리 줄을 고정한다.** 안에서 스크롤하는 동안 열 이름이 사라지면 어느
          칸을 보고 있는지 알 수 없다.
        -->
        <AppTable class="lg:max-h-150">
          <thead class="sticky top-0 z-10">
            <tr>
              <!--
                  **열 머리가 곧 정렬 기준이다.** 누르면 그 열로 서고 다시 누르면 뒤집힌다 —
                  지금 무엇으로 서 있는지가 화살표로 그 자리에 있다.

                  **좁은 화면에서는 열을 줄인다.** 표를 카드로 바꾸는 것이 아니라 덜 중요한
                  열을 접는 것이라, 교사가 두 화면을 따로 배우지 않는다.
                -->
              <th
                v-for="column in COLUMNS"
                :key="column.key"
                scope="col"
                :class="[column.width, column.wide ? 'hidden md:table-cell' : '']"
              >
                <button
                  type="button"
                  class="flex w-full items-center gap-1"
                  :class="column.numeric ? 'justify-end' : ''"
                  @click="sortBy(column.key)"
                >
                  {{ t(column.label) }}
                  <!--
                      **화살표 자리는 늘 있다.** 누를 때마다 생겼다 사라지면 그 열의
                      글자가 좌우로 밀리고, 정렬을 바꿀 때마다 머리 줄이 출렁인다.
                    -->
                  <component
                    :is="descending ? ACTION_ICONS.moveDown : ACTION_ICONS.moveUp"
                    :size="16"
                    :class="sort === column.key ? '' : 'invisible'"
                    aria-hidden="true"
                  />
                </button>
              </th>
              <th scope="col" class="text-right">{{ t('inspect.state') }}</th>
            </tr>
          </thead>
          <tbody>
            <!--
              **못 여는 파일도 줄을 갖는다.** 조용히 빠지면 교사는 그 제출물이 없는 것으로
                읽고, 그것이 이 화면이 가장 하면 안 되는 일이다.
              -->
            <tr
              v-for="row in rows"
              :key="row.item.label"
              class="cursor-pointer hover:bg-surface-soft"
              :class="opened?.label === row.item.label ? 'bg-surface-soft font-bold' : ''"
              @click="select(row.item)"
            >
              <!-- 남는 폭을 이 열이 다 먹는다. 긴 경로는 그 안에서 잘린다. -->
              <td class="w-full max-w-0">
                <span class="block truncate">{{ row.item.label }}</span>
              </td>
              <td class="hidden max-w-0 md:table-cell">
                <span class="block truncate">{{ row.student }}</span>
              </td>
              <td class="hidden text-right md:table-cell">{{ row.experiments }}</td>
              <td class="hidden text-right md:table-cell">{{ row.runs }}</td>
              <td
                class="text-right whitespace-nowrap"
                :class="row.faint ? 'text-ink-faint' : 'text-ink-soft'"
              >
                {{ row.state }}
              </td>
            </tr>
          </tbody>
        </AppTable>
      </div>

      <!--
        고른 하나. **열람은 결과 화면의 부품을 그대로 쓴다** (open-decisions.md "점검은
        읽기 전용 열람기다"의 "화면 부품도 사본을 만들지 않는다") — 여기서 다시 그리면
        교사가 보는 화면과 학생이 보던 화면이 갈린다. 무결성과 대조는 이 아래에 붙는다.
      -->
      <p v-if="!opened" class="text-ink-soft">{{ t('inspect.pickOne') }}</p>
      <p
        v-else-if="summaryOfOpened?.state === 'unreadable'"
        class="rounded-panel border border-line bg-surface p-4 leading-relaxed"
      >
        {{ reasonOf(summaryOfOpened.code) }}
      </p>
      <p v-else-if="!viewing" class="text-ink-soft">{{ t('inspect.reading') }}</p>
      <template v-else>
        <header class="flex flex-col gap-1">
          <h3 class="truncate text-xl font-black">{{ viewing.file.document.manifest.name }}</h3>
          <p class="truncate text-ink-soft">{{ opened.label }}</p>
        </header>

        <!--
          **왼쪽이 고르는 자리, 오른쪽이 고른 것의 속이다** (§8.12, 결과 화면의 두 열과
          같은 관계다, 2026-09-18 사용자). 목록을 상세 위에 쌓으면 실험이 여럿일 때
          상세가 그만큼 아래로 밀리고, 무엇보다 **학생이 보던 결과 화면과 문법이 갈린다.**

          **점선으로 가르지 않는다** — 왼쪽이 카드로 서 있는 자리에서는 그 선이 카드
          테두리와 겹쳐 보인다.
        -->
        <div class="grid gap-4 lg:grid-cols-3">
          <div class="flex min-w-0 flex-col gap-4">
            <!-- 무슨 데이터를 몇 행, 타깃은 무엇으로. **교사가 가장 먼저 보는 줄들이다.** -->
            <aside class="rounded-panel border border-line bg-surface p-4">
              <ProjectSummary :file="viewing.file" />
            </aside>

            <section v-if="viewing.experiments.length > 0" class="flex flex-col gap-1.5">
              <h4 class="font-bold text-ink-soft">{{ t('results.experimentTitle') }}</h4>
              <ExperimentList
                :experiments="viewing.experiments"
                :selected="viewing.current?.id ?? null"
                @pick="selected = $event"
              />
            </section>
          </div>

          <div class="min-w-0 lg:col-span-2">
            <ExperimentDetail
              v-if="viewing.current"
              :experiment="viewing.current"
              :order="viewing.order.get(viewing.current.id) ?? 0"
              :previous="viewing.previous"
              :data-type="viewing.file.document.manifest.dataType"
              :dataset="viewing.dataset"
              :preprocessor="viewing.preprocessor"
              :models="viewing.file.models"
              :file="viewing.file"
            />
            <p v-else class="rounded-panel border border-line bg-surface p-4 text-ink-soft">
              {{ t('inspect.noExperiment') }}
            </p>
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
