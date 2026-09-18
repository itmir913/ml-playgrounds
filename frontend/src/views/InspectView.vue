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
import { useWork } from '@/composables/useWork'
import { errorMessageKey, type ClientErrorCode } from '@/errors'
import { ACTION_ICONS, STEP_ICONS } from '@/icons'
import { experimentPreprocessor } from '@/ml/preprocess'
import { experimentOrder } from '@/ml/results'
import { readDataset, readTestDataset } from '@/project/dataset'
import { MLPX_EXTENSION } from '@/project/format'
import { downloadBlob } from '@/project/download'
import { bundleOf, type BundleEntry } from '@/project/portfolio-bundle'
import { rosterOf, sortRoster, type RosterItem, type RosterSort } from '@/project/roster'
import IntegrityPanel from './inspect/IntegrityPanel.vue'
import PortfolioPanel from './inspect/PortfolioPanel.vue'
import StudentEditor from './inspect/StudentEditor.vue'
import ReproducePanel from './inspect/ReproducePanel.vue'
import ExperimentDetail from './results/ExperimentDetail.vue'
import ExperimentList from './results/ExperimentList.vue'

const { t, locale } = useI18n()
const roster = useRoster()
const work = useWork()

/** 묶는 동안 몇 줄까지 읽었는가. 서른 개면 그 수가 교사가 기다리는 크기다. */
const bundled = ref(0)

const folderInput = ref<HTMLInputElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

/** 지금 보고 있는 줄. **명렬이 갈리면 비운다** — 없는 줄을 가리키고 있을 수 없다. */
const opened = ref<RosterItem | null>(null)

/** 고른 실험. 없으면 마지막 실험을 본다 — 교사가 먼저 볼 것은 학생이 마지막에 한 일이다. */
const selected = ref<string | null>(null)

/**
 * 열람의 두 모드 (architecture.md §8.21, 2026-09-18 사용자).
 *
 * **그림은 학생이 그 단계에서 보던 것이다** — 교사가 보는 화면과 학생이 보던 화면이
 * 같은 그림을 쓰면 "이게 어느 쪽 이야기인지"를 다시 배우지 않는다.
 */
const VIEW_MODES = [
  { id: 'model', label: 'inspect.model', icon: STEP_ICONS.results },
  { id: 'portfolio', label: 'inspect.portfolio', icon: STEP_ICONS.portfolio },
] as const

/**
 * 지금 무엇을 보고 있나. **제출물을 건너 유지된다** — 이 갈래의 이유가 "글만 서른 개
 * 읽기"라, 줄을 바꿀 때마다 모델로 돌아오면 아무것도 안 바뀐 것이다. 명렬을 갈아
 * 끼워도 마찬가지다(`watch(roster.items)`가 안 건드린다).
 */
const mode = ref<(typeof VIEW_MODES)[number]['id']>('model')

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

/**
 * 같은 열을 다시 누르면 방향이 뒤집힌다. 다른 열이면 오름차순부터다.
 *
 * **기준이 없는 열도 받는다** — `상태`는 `ROSTER_SORTS`에 없어서 `null`이고, 그 열의
 * 머리는 누를 수 있는 것으로 그려지지도 않는다.
 */
function sortBy(key: RosterSort | null): void {
  if (key === null) return
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
  const read = roster.opened.value?.read
  const file = read?.project
  if (!file || roster.opened.value?.item.label !== opened.value?.label) return null

  const experiments = file.document.runs.experiments
  const index = Math.max(
    experiments.findIndex((experiment) => experiment.id === selected.value),
    0,
  )
  const current = experiments[experiments.length === 0 ? -1 : index]
  return {
    file,
    /** 해시 대조는 파일을 열 때 이미 끝나 있다 (`readProject`). 여기서 다시 세지 않는다. */
    integrity: read.integrity,
    /** 테스트 정본. `provided`로 나눈 실험이 아니면 없다 (mlpx-spec.md §1.1). */
    testDataset: readTestDataset(file),
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
        /** 교사가 고쳐 둔 줄. **파일과 다르다는 것을 화면이 말해야 한다.** */
        edited: roster.edits.value.has(item.label),
        /** 값이 아직 없는 줄. 회색으로 두어 훑는 눈이 건너뛴다. */
        faint: !read,
        /** 열마다 그 칸에 설 글자. **열쇠가 `COLUMNS`의 것과 같다** — 표가 이것으로 선다. */
        cells: {
          label: item.label,
          // **빈 자리의 이름은 열마다 다르다.** 학번 칸에 `이름 없음`이 서 있었다
          // (2026-09-18, 사용자).
          studentId: read ? (read.studentId ?? t('inspect.noStudentId')) : '',
          studentName: read ? (read.studentName ?? t('inspect.noStudentName')) : '',
          experiments: read ? t('meta.countUnit', read.experiments) : '',
          runs: read ? t('meta.countUnit', read.runs) : '',
          state: read
            ? t(`dataTypes.${read.dataType}`)
            : summary
              ? t('inspect.unreadable')
              : t('inspect.reading'),
        } satisfies Record<InspectColumn['key'], string>,
      }
    },
  ),
)

/**
 * 열 머리. **여기 한 줄을 더하면 표가 따라온다** — 머리와 칸이 같은 목록에서 나온다.
 *
 * **정렬도 여기 한 자리에 있다** (2026-09-18, 사용자). `상태` 열이 머리는 왼쪽이고 칸은
 * 오른쪽이었다 — 머리에 적은 `text-right`가 `data-table`에 눌려 죽은 것이 절반이고,
 * **머리와 칸이 서로 다른 자리에서 정렬을 정하고 있던 것**이 나머지 절반이다.
 * `tests/table-align.spec.ts`가 둘이 갈리면 운다.
 */
interface InspectColumn {
  key: RosterSort | 'state'
  label: string
  /** 이 열로 정렬할 수 있으면 그 기준. **`상태`는 없다** — `ROSTER_SORTS`에 없는 값이다. */
  sort: RosterSort | null
  /** 머리와 칸이 함께 쓴다. 숫자는 오른쪽, 글자는 왼쪽이 관행이다. */
  align: 'left' | 'right'
  /** 좁은 화면에서 접는 열. 제출물 이름과 상태만 남는다. */
  wide: boolean
  /**
   * 그 열의 **최소** 너비. 머리 글자가 접히지 않을 만큼 준다 — 접히면 머리 줄의 높이가
   * 열마다 달라지고, 정렬로 화살표가 붙고 떨어질 때 그 높이가 흔들린다.
   *
   * **남는 폭을 한 열에 몰아주지 않는다** (2026-09-18, 사용자). 첫 열에 `w-full`을 주면
   * 표가 나머지를 **내용 최소 너비까지 짜내서**, 자리가 남는데도 이름이 두 줄로 접혔다.
   * 상한도 안 준다 — 이름이 길면 그만큼 가져가고, 그때 좁아지는 것은 남는 폭을 쥐고 있던
   * 파일 이름 열이다.
   */
  width: string
  /** 칸에만 붙는 모양. 긴 이름은 접고, 상태는 안 접는다. */
  cell: string
}

const COLUMNS: readonly InspectColumn[] = [
  {
    key: 'label',
    label: 'inspect.file',
    sort: 'label',
    align: 'left',
    wide: false,
    width: 'min-w-48',
    // 남는 폭을 이 열이 다 먹는다. 긴 경로는 줄을 바꾼다.
    cell: 'break-words',
  },
  {
    key: 'studentId',
    label: 'inspect.studentId',
    sort: 'studentId',
    align: 'left',
    wide: true,
    width: 'min-w-28',
    cell: 'break-words',
  },
  {
    key: 'studentName',
    label: 'inspect.studentName',
    sort: 'studentName',
    align: 'left',
    wide: true,
    width: 'min-w-28',
    cell: 'break-words',
  },
  {
    key: 'experiments',
    label: 'inspect.experiments',
    sort: 'experiments',
    align: 'right',
    wide: true,
    width: 'w-44',
    cell: '',
  },
  {
    key: 'runs',
    label: 'inspect.runs',
    sort: 'runs',
    align: 'right',
    wide: true,
    width: 'w-36',
    cell: '',
  },
  {
    key: 'state',
    label: 'inspect.state',
    sort: null,
    align: 'right',
    wide: false,
    width: '',
    cell: 'whitespace-nowrap',
  },
]

/** 머리와 칸이 함께 부르는 것. **정렬을 두 번 적지 않는다.** */
function alignClass(column: InspectColumn): string {
  return column.align === 'right' ? 'text-right' : ''
}

/**
 * 교사가 고친 학번·이름. **파일에는 안 적는다** (open-decisions.md "점검은 읽기 전용
 * 열람기다") — 명렬의 표시와 정렬만 이 값으로 선다.
 *
 * **고치는 자리가 여기인 이유는 순서다.** 학생이 이름을 잘못 내면 교사는 **정렬하기
 * 전에** 그것을 고쳐야 하고, 고치려면 그 제출물을 열어 보고 있어야 한다.
 */
function correctStudent(edit: { studentId?: string; studentName?: string }): void {
  const item = opened.value
  if (item) roster.correct(item, edit)
}

/** 지금 칸에 들어 있는 값. 고친 것이 있으면 고친 것, 없으면 파일의 것. */
const studentFields = computed(() => {
  const summary = summaryOfOpened.value
  if (summary?.state !== 'read') return { studentId: '', studentName: '' }
  return { studentId: summary.studentId ?? '', studentName: summary.studentName ?? '' }
})

/**
 * 머리줄에 서는 한 줄 — 학번·이름과 파일 이름. **없는 칸은 빼고 잇는다** — `이름 없음 ·
 * 이름 없음 · test.mlpx`는 아무것도 말하지 않는다.
 */
const studentLine = computed(() =>
  [studentFields.value.studentId, studentFields.value.studentName, opened.value?.label]
    .filter((part) => part !== undefined && part !== '')
    .join(' · '),
)

/**
 * **명렬의 포트폴리오를 한 묶음으로 내려받는다** (open-decisions.md "점검은 읽기 전용
 * 열람기다"의 "내보내기는 열려 있다").
 *
 * 서른 명의 글을 읽는 일은 화면을 서른 번 여는 일이 아니라 한 번에 받아 두고 읽는 일이다.
 *
 * **나가는 것은 우리가 새로 지은 zip이다.** 학생의 `.mlpx`는 안 실린다 — 교사가 이미
 * 가진 것이고, 원본은 어느 경로로도 다시 쓰이지 않는다.
 *
 * **읽기는 여전히 한 줄로 흐른다** — 묶는 동안에도 동시에 풀리는 파일은 하나뿐이고,
 * 열어 보던 제출물도 안 바뀐다.
 */
async function downloadPortfolios(): Promise<void> {
  if (work.busy.value || roster.items.value.length === 0) return
  const job = work.start()
  bundled.value = 0
  const entries: BundleEntry[] = []
  try {
    await roster.collect((item, read) => {
      bundled.value += 1
      if (read) entries.push({ label: item.label, file: read.project })
    })
    if (entries.length > 0 && work.alive()) {
      downloadBlob(bundleOf(entries, t, locale.value), t('inspect.bundleName'))
    }
  } finally {
    bundled.value = 0
    job.done()
  }
}

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
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <h3 class="font-bold text-ink-soft">
            {{ t('inspect.roster', { read: progress.read, total: progress.total }) }}
          </h3>

          <!--
            **명렬 전체가 대상이라 명렬의 머리에 선다.** 고른 제출물 하나가 아니라 지금
            보이는 목록 전부를 묶는다.
          -->
          <AppButton variant="secondary" :disabled="work.busy.value" :action="downloadPortfolios">
            <component :is="ACTION_ICONS.exportFile" :size="18" aria-hidden="true" />
            {{
              work.busy.value
                ? t('inspect.bundling', { done: bundled, total: progress.total })
                : t('inspect.bundle')
            }}
          </AppButton>
        </div>

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
                :class="[
                  column.width,
                  alignClass(column),
                  column.wide ? 'hidden md:table-cell' : '',
                ]"
              >
                <!--
                  **오른쪽 열은 화살표가 글자 왼쪽이다.** 오른쪽에 두면 그 자리만큼 이름표가
                  안으로 밀려 **머리와 칸의 오른쪽 끝이 어긋난다** (2026-09-18, 사용자).
                -->
                <button
                  v-if="column.sort"
                  type="button"
                  class="flex w-full items-center gap-1"
                  :class="column.align === 'right' ? 'flex-row-reverse justify-start' : ''"
                  @click="sortBy(column.sort)"
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
                <!-- 정렬 기준이 아닌 열. 여기서는 `th`의 정렬이 곧 이 글자의 정렬이다. -->
                <template v-else>{{ t(column.label) }}</template>
              </th>
            </tr>
          </thead>
          <tbody>
            <!--
              **못 여는 파일도 줄을 갖는다.** 조용히 빠지면 교사는 그 제출물이 없는 것으로
                읽고, 그것이 이 화면이 가장 하면 안 되는 일이다.
              -->
            <!--
              **고른 줄은 색으로도 말한다** (2026-09-18, 사용자). 굵게만 하면 훑는 눈이
              어느 줄을 열어 둔 것인지 못 찾는다. 색은 이 앱이 "고른 것"에 쓰는 그 색이다
              (`ExperimentList`의 `bg-brand-soft`) — 표라고 다른 말을 쓰지 않는다.

              **얹힌 줄은 색이 드는 것이 아니라 어두워지고, 그것은 껍데기가 준다**
              (`data-table`의 `tbody tr:hover > td`). 여기서 hover를 또 적으면 이 표만
              다른 색이 된다 — 둘이 같은 색이면 마우스가 지나간 줄이 "골라진 것"으로
              읽힌다 (2026-09-18, 사용자). **고른 줄 위에도 그 한 겹이 그대로 얹힌다.**

              **전에는 둘 다 `bg-surface-soft`였고 그런 토큰이 없다.** Tailwind는 모르는
              이름에 CSS를 안 만들어서 강조도 hover도 처음부터 없었다
              (`tests/ui-rules.spec.ts`의 "없는 색 토큰을 부르지 않는다"가 이제 운다).
            -->
            <tr
              v-for="row in rows"
              :key="row.item.label"
              class="cursor-pointer"
              :class="opened?.label === row.item.label ? 'bg-brand-soft font-bold' : ''"
              @click="select(row.item)"
            >
              <!--
                **칸도 머리와 같은 목록에서 나온다** (2026-09-18, 사용자). 손으로 적던
                시절에는 `상태` 열의 머리와 칸이 서로 다른 자리에서 정렬을 정했고, 그래서
                갈렸다.
              -->
              <td
                v-for="column in COLUMNS"
                :key="column.key"
                :class="[
                  alignClass(column),
                  column.cell,
                  column.wide ? 'hidden md:table-cell' : '',
                ]"
              >
                <!-- 상태는 값이 아직 없는 줄을 회색으로 둔다. -->
                <span
                  v-if="column.key === 'state'"
                  :class="row.faint ? 'text-ink-faint' : 'text-ink-soft'"
                >
                  {{ row.cells[column.key] }}
                </span>
                <template v-else>
                  {{ row.cells[column.key] }}
                  <!--
                    **고친 줄에는 표시를 단다** (2026-09-18, 사용자). 교사가 화면에서 고친
                    값은 파일에 없는 값이라, 아무 표시 없이 두면 다음에 열었을 때 파일이
                    그렇게 적혀 있는 줄 안다.
                  -->
                  <span v-if="column.key === 'studentId' && row.edited" class="text-ink-faint">{{
                    t('inspect.editedMark')
                  }}</span>
                </template>
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
        <!--
          **머리줄은 누구의 무엇인지만 말한다.** 학번·이름을 고치는 일은 서른 명 중 두셋에게만
          생기는 드문 일이라, 폼으로 상시 자리를 먹지 않고 팝오버로 접어 둔다
          (2026-09-18, 사용자).
        -->
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex min-w-0 flex-col gap-1">
            <h3 class="truncate text-xl font-black">{{ viewing.file.document.manifest.name }}</h3>
            <p class="truncate text-ink-soft">
              {{ studentLine }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <!--
              **모드 스위치는 바꾸는 대상 바로 위에 선다** (2026-09-18, 사용자). 고른 쪽만
              색이 차고 자리는 그대로다 — `AppChoices`와 같은 문법이되, 머리줄에 서는
              것이라 그쪽의 이름표와 격자를 데려오지 않는다.
            -->
            <div class="flex gap-2" role="group" :aria-label="t('inspect.viewMode')">
              <AppButton
                v-for="one in VIEW_MODES"
                :key="one.id"
                :variant="mode === one.id ? 'primary' : 'secondary'"
                :aria-pressed="mode === one.id"
                @click="mode = one.id"
              >
                <component :is="one.icon" :size="18" aria-hidden="true" />
                {{ t(one.label) }}
              </AppButton>
            </div>

            <StudentEditor
              :student-id="studentFields.studentId"
              :student-name="studentFields.studentName"
              @correct="correctStudent"
            />
          </div>
        </header>

        <!--
          **왼쪽이 고르는 자리, 오른쪽이 고른 것의 속이다** (§8.12, 결과 화면의 두 열과
          같은 관계다, 2026-09-18 사용자). 목록을 상세 위에 쌓으면 실험이 여럿일 때
          상세가 그만큼 아래로 밀리고, 무엇보다 **학생이 보던 결과 화면과 문법이 갈린다.**

          **점선으로 가르지 않는다** — 왼쪽이 카드로 서 있는 자리에서는 그 선이 카드
          테두리와 겹쳐 보인다.
        -->
        <div v-if="mode === 'model'" class="grid gap-4 lg:grid-cols-3">
          <div class="flex min-w-0 flex-col gap-4">
            <!-- 무슨 데이터를 몇 행, 타깃은 무엇으로. **교사가 가장 먼저 보는 줄들이다.** -->
            <aside class="rounded-panel border border-line bg-surface p-4">
              <ProjectSummary :file="viewing.file" />
            </aside>

            <!--
              **무결성이 요약 바로 아래다.** 교사가 제출물에서 묻는 순서가 "무엇인가 →
              손댄 흔적이 있나 → 점수가 진짜인가"이고, **세 판이 이 열에 그 순서로 선다**
              (§8.21). 무결성은 파일 전체의 일이라 실험마다 다른 값이 아니다.
            -->
            <IntegrityPanel :integrity="viewing.integrity" />

            <!--
              **대조는 무결성 바로 아래다** (2026-09-18, 사용자). 둘 다 "이 제출물을 믿을
              수 있나"의 답이라, 사이에 다른 것이 끼면 묻는 흐름이 끊긴다. 대조가 **그
              실험**의 일이라는 것은 자리가 아니라 판이 말한다(`:order`).

              **단추로 돈다.** 열자마자 돌면 무결성만 훑는 한 바퀴가 불가능해지고, 서른 개
              동선이 거기서 무너진다 (open-decisions.md "명렬은 메타만 읽는다").
            -->
            <ReproducePanel
              v-if="viewing.current"
              :experiment="viewing.current"
              :order="viewing.order.get(viewing.current.id) ?? 0"
              :data-type="viewing.file.document.manifest.dataType"
              :dataset="viewing.dataset"
              :test-dataset="viewing.testDataset"
            />

            <section v-if="viewing.experiments.length > 0" class="flex flex-col gap-1.5">
              <h3 class="font-bold text-ink-soft">{{ t('results.experimentTitle') }}</h3>
              <ExperimentList
                :experiments="viewing.experiments"
                :selected="viewing.current?.id ?? null"
                @pick="selected = $event"
              />
            </section>
          </div>

          <!--
            **오른쪽은 결과 화면과 같은 것이다** (§8.21, 2026-09-18 사용자) — 왼쪽에서
            실험을 고르고 여기에 그 상세가 선다. 점검이 새로 만든 판은 전부 왼쪽에 모인다.
          -->
          <div class="flex min-w-0 flex-col gap-4 lg:col-span-2">
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

        <!--
          **글은 한 열로 넓게 선다** (§8.21). 학생이 [완성본]에서 보던 폭이고, 두 열에
          끼우면 읽는 폭이 아니다.
        -->
        <PortfolioPanel v-else :file="viewing.file" />
      </template>
    </template>
  </div>
</template>
