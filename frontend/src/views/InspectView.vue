<script setup lang="ts">
/**
 * **점검** — 교사가 제출물을 열어 보는 화면 (architecture.md §8.21).
 *
 * 이 화면이 명렬을 들고, 고른 파일의 열람·무결성·재실행 대조가 그 아래 붙는다.
 *
 * **원본 `.mlpx`를 고칠 길을 안 만든다.** 저장도, 탭 잠금도 여기서 안 부른다
 * (`tests/inspect-rules.spec.ts`가 지킨다). **내려받기는 예외다** — 포트폴리오를 한
 * 묶음으로 내보내는 zip은 우리가 새로 짓는 파일이고, 학생의 파일은 거기 안 실린다
 * (open-decisions.md "점검은 읽기 전용 열람기다"의 "내보내기는 열려 있다").
 *
 * **입구는 둘이고 경로는 하나다.** 폴더째 고르든 파일 하나를 고르든 같은 명렬을 지난다 —
 * 항목이 하나뿐이면 자동으로 골라 손이 한 번 준다.
 *
 * **명렬은 표다** (2026-09-18, 사용자). 교사가 여기서 하는 일은 읽기가 아니라 **비교**다 —
 * "실험이 0개인 줄이 누구지"를 찾는 동작은 세로 훑기이고, 카드 목록은 그것을 못 한다.
 * 그리고 **열이 곧 정렬 기준**이라 기준이 화면 밖으로 안 나간다. 무결성과 대조 판정이
 * 붙을 자리도 열이다.
 */

import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import AppBadge from '@/components/AppBadge.vue'
import AppButton from '@/components/AppButton.vue'
import AppEmpty from '@/components/AppEmpty.vue'
import AppTable from '@/components/AppTable.vue'
import ProjectSummary from '@/components/ProjectSummary.vue'
import StepActionBar from '@/components/StepActionBar.vue'
import StepHeader from '@/components/StepHeader.vue'
import { useRoster } from '@/composables/useRoster'
import { useWork } from '@/composables/useWork'
import { errorMessageKey, type ClientErrorCode } from '@/errors'
import { ACTION_ICONS, STEP_ICONS } from '@/icons'
import { experimentPreprocessor } from '@/ml/preprocess'
import { experimentOrder } from '@/ml/results'
import { readDataset, readTestDataset } from '@/project/dataset'
import { MLPX_ACCEPT } from '@/project/format'
import { downloadBlob } from '@/project/download'
import { bundleOf, type BundleEntry } from '@/project/portfolio-bundle'
import {
  groupName,
  rosterOf,
  sameProjectsOf,
  sortRoster,
  studentFieldsInUse,
  type RosterItem,
  type RosterSort,
} from '@/project/roster'
import { useToastStore } from '@/stores/toasts'
import IntegrityPanel from './inspect/IntegrityPanel.vue'
import PortfolioPanel from './inspect/PortfolioPanel.vue'
import SameProjectPanel from './inspect/SameProjectPanel.vue'
import StudentEditor from './inspect/StudentEditor.vue'
import ReproducePanel from './inspect/ReproducePanel.vue'
import ExperimentDetail from './results/ExperimentDetail.vue'
import ExperimentList from './results/ExperimentList.vue'

const { t, locale } = useI18n()
const roster = useRoster()
const toasts = useToastStore()
/**
 * **떠날 때 도는 것을 끊고 끝났다고 표시한다** (`useWork`). 이 화면은 묶음을 굽는 일을
 * 들고 있고 그 뒤에 `alive()`를 묻는데, `retire`를 안 걸면 **그 값이 영영 참이라 가드가
 * 죽은 채로 초록이다** — 굽다 나가면 다른 화면에서 zip이 내려간다 (2026-09-18 R28 A-1).
 */
const { busy, start, alive, retire } = useWork()

onBeforeUnmount(() => {
  retire()
  // **명렬도 함께 멈춘다** (2026-09-18 R28-V §5). `retire`는 워커까지이고 파일 읽기
  // 루프에는 맡길 손잡이가 없다 — 안 멈추면 서른 개를 훑다 나가도 큐가 끝까지 돈다.
  roster.stop()
})

/** 묶는 동안 몇 줄까지 읽었는가. 서른 개면 그 수가 교사가 기다리는 크기다. */
const bundled = ref(0)

/** 고른 것이 서는 자리. **누르면 여기로 굴러온다** (2026-09-18, 사용자). */
const detailEl = ref<HTMLElement | null>(null)

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
  const files = [...(input.files ?? [])]
  input.value = ''
  show(files)
}

/**
 * 받은 파일들을 명렬로 세운다. **입구 둘이 반드시 여기를 지난다.**
 *
 * **하나도 안 남으면 말한다** (결정문 48). 조용히 빈 과녁으로 되돌아가면 놓은 사람은
 * **아무 일도 안 일어난 것으로 본다** — 아이패드가 내보낸 `프로젝트.mlpx.zip`이 그렇게
 * 떨어졌고, 원인을 찾는 데 기기 로그를 개발 서버로 끌어와야 했다.
 *
 * 부르는 쪽에서 세지 마라. 자리가 둘이 되면 한쪽만 고쳐진다.
 */
function show(files: readonly File[]): void {
  if (files.length === 0) return
  const picked = rosterOf(files)
  if (picked.length === 0) {
    toasts.push('caution', 'inspect.noProjectFiles', { count: files.length })
    return
  }
  roster.show(picked)
}

/**
 * 파일을 끌고 들어와 있는가. **과녁의 색이 이것으로 바뀐다.**
 *
 * 데이터 화면의 표 입구와 같은 관용구다 (`views/data/TabularPanel.vue`) — **점선 테두리는
 * 꾸밈이 아니라 "여기 놓을 수 있다"는 약속**이라, 테두리만 그리고 받지 않으면 교사가
 * 제출물을 끌어다 놓고 아무 일도 안 일어나는 것을 본다 (2026-09-22, 코드 소유자).
 */
const dragging = ref(false)

/**
 * 끌어다 놓은 파일들. **여러 개를 그대로 받는다** — 이 화면은 원래 명렬을 받는 자리이고
 * `pickFiles`가 이미 그 길이다.
 *
 * **폴더는 안 받는다.** 폴더째 끌기는 `webkitGetAsEntry`로 트리를 훑어야 하는 다른 일이라
 * 단추(`pickFolder`)로 남긴다 — 문구도 *"파일을 끌어다 놓으세요"*라고만 말해서 **되는
 * 것과 말하는 것이 같다.**
 */
function onDrop(event: DragEvent): void {
  dragging.value = false
  show([...(event.dataTransfer?.files ?? [])])
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
 * **누른 것이 보이는 자리로 데려간다** (2026-09-18, 사용자).
 *
 * **누르는 순간에 굴리면 안 된다.** 그때는 아직 `읽는 중` 한 줄이라 문서가 화면보다
 * 짧아지고, 브라우저가 스크롤을 0으로 당겨 **굴린 것이 그대로 취소된다** — 실물 파일로
 * 눌러 보고서야 보였다(주소는 맞는데 화면은 맨 위였다).
 *
 * 그래서 **그 제출물의 내용이 자리를 잡은 뒤에** 굴린다. 못 읽는 파일도 자기 사유로
 * 자리를 잡으므로 같은 자리에서 멈춘다.
 */
watch(
  () => {
    if (!opened.value) return null
    const ready = viewing.value !== null || summaryOfOpened.value?.state === 'unreadable'
    return ready ? opened.value.label : null
  },
  (label) => {
    if (label === null) return
    void nextTick(() => detailEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  },
)

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
  /**
   * **안 고르면 마지막 실험이다** (2026-09-18, 실물 파일로 재다 잡았다). 여기 `0`이 박혀
   * 있어서 실험이 셋인 파일을 열면 **학생이 제일 먼저 한 실험**이 떴다 — 교사가 먼저 볼
   * 것은 학생이 마지막에 한 일이고, **결과 화면도 마지막을 연다**(`ResultsView`).
   * 바로 위 주석은 그동안 "마지막 실험을 본다"고 적혀 있었다.
   */
  const found = experiments.findIndex((experiment) => experiment.id === selected.value)
  const current = found >= 0 ? experiments[found] : experiments[experiments.length - 1]
  const index = found >= 0 ? found : experiments.length - 1
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
/**
 * **같은 프로젝트에서 나온 줄들** (§8.21). 이름표 → 묶음 번호.
 *
 * 번호는 정렬이 아니라 **명렬의 순서**가 정하므로 여기서 한 번 계산하고, 표도 판도
 * 같은 것을 본다 — 두 자리가 따로 세면 배지의 번호와 판의 목록이 갈린다.
 */
const same = computed(() => sameProjectsOf(roster.items.value, roster.summaries.value))

const groups = computed(() => same.value.groups)

/**
 * 표 위 한 줄. **있으면 언제나 말한다** — 훑다 놓치지 않을 만큼만.
 *
 * **전부가 한 프로젝트일 때가 가장 중요한 자리다** (2026-09-18, 사용자). 칸마다 같은
 * 글자가 서른 번 서면 구분은 0이라 열도 판도 안 서지만, **그 문장까지 숨기면 `전부
 * 다르다`와 `전부 같다`가 화면에서 똑같이 보인다.**
 */
const sameProject = computed(() => {
  const files = groups.value.size
  return {
    files,
    all: same.value.all,
    // 전원이 한 프로젝트면 문장이 갈린다 — 그때는 묶음 수를 셀 것이 없다.
    line: same.value.all
      ? t('inspect.sameProjectAll', { files })
      : t('inspect.sameProjectSummary', { files }),
  }
})

/**
 * 지금 열어 둔 줄과 같은 프로젝트에서 나온 이름표들. **명렬의 순서 그대로다.**
 *
 * 짝이 없으면 빈 배열이고 그때 판은 안 선다 — 드문 것이 눈에 띄어야 한다.
 */
const sameProjectPeers = computed(() => {
  // 전원이 한 프로젝트면 서른 줄을 나열할 일이 아니다 — 표 위 한 줄이 이미 다 말했다.
  if (same.value.all) return []
  const mine = opened.value ? groups.value.get(opened.value.label) : undefined
  if (mine === undefined) return []
  return roster.items.value
    .filter((item) => groups.value.get(item.label) === mine)
    .map((item) => item.label)
})

/**
 * 그 줄의 묶음 번호. **짝이 없으면 빈 글자다.**
 *
 * **글자만 적는다** (`groupName`) — 무엇의 글자인지는 열 머리(`프로젝트`)가 말하고, 그
 * 열은 짝이 있을 때만 선다. 칸마다 `같은 프로젝트 1`을 적으면 같은 말이 서른 번 반복되고,
 * 숫자를 적으면 옆 칸의 `1개`·`5개`와 섞인다.
 */
function sameProjectText(label: string): string {
  const group = groups.value.get(label)
  return group === undefined ? '' : groupName(group)
}

const rows = computed(() =>
  sortRoster(roster.items.value, roster.summaries.value, sort.value, descending.value).map(
    (item) => {
      const summary = roster.summaries.value.get(item.label)
      const read = summary?.state === 'read' ? summary : undefined
      return {
        item,
        /** 값이 아직 없는 줄. 회색으로 두어 훑는 눈이 건너뛴다. */
        faint: !read,
        /** 열마다 그 칸에 설 글자. **열쇠가 `COLUMNS`의 것과 같다** — 표가 이것으로 선다. */
        cells: {
          label: item.label,
          // **빈 자리의 이름은 열마다 다르다.** 학번 칸에 `이름 없음`이 서 있었다
          // (2026-09-18, 사용자).
          studentId: read ? (read.studentId ?? t('inspect.noStudentId')) : '',
          studentName: read ? (read.studentName ?? t('inspect.noStudentName')) : '',
          // **학생이 붙인 제목이다.** 파일 이름과 다를 수 있고, 다를 때 그것이 정보다.
          name: read ? read.name : '',
          sameProject: sameProjectText(item.label),
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

const BASE_COLUMNS: readonly InspectColumn[] = [
  {
    key: 'label',
    label: 'inspect.file',
    sort: 'label',
    align: 'left',
    wide: false,
    // **열이 여덟이 되면서 한 칸 줄였다** (2026-09-18). 이름은 어차피 남는 폭을 먹으므로
    // 바닥값이 낮아도 넓은 화면에서는 그대로 넓고, 좁은 화면에서는 두 줄로 접힌다.
    width: 'min-w-40',
    // 남는 폭을 이 열이 다 먹는다. 긴 경로는 줄을 바꾼다.
    cell: 'break-words',
  },
  {
    key: 'studentId',
    label: 'inspect.studentId',
    sort: 'studentId',
    align: 'left',
    wide: true,
    // 머리 두 글자와 `학번 없음`이 한 줄로 들어가는 최소치. **더 주면 표가 가로로 넘친다** —
    // 프로젝트 열이 서는 순간 1024px에서 18px이 모자랐다 (2026-09-18 실측).
    width: 'min-w-24',
    cell: 'break-words',
  },
  {
    key: 'studentName',
    label: 'inspect.studentName',
    sort: 'studentName',
    align: 'left',
    wide: true,
    width: 'min-w-24',
    cell: 'break-words',
  },
  {
    key: 'name',
    label: 'inspect.projectName',
    sort: 'name',
    align: 'left',
    wide: true,
    width: 'min-w-32',
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

/**
 * 묶음 열 (2026-09-18, 사용자). **누르면 같은 묶음끼리 모여 선다.**
 *
 * 배지를 파일 이름 칸에 달아 두었더니 이름 아래 한 줄이 더 생겨 **줄 높이가 45px에서
 * 73px이 됐고**, 무엇보다 **누를 머리가 없어 묶음을 눈으로 찾아야 했다.**
 */
const GROUP_COLUMN: InspectColumn = {
  key: 'sameProject',
  label: 'inspect.sameProjectColumn',
  sort: 'sameProject',
  align: 'left',
  // 좁은 화면에서는 접힌다. 거기서도 표 위의 한 줄은 그대로 서서 있다는 것을 말한다.
  wide: true,
  // 칸에는 글자 한둘뿐이라 **머리 글자가 안 접힐 만큼**이면 된다. 넓게 잡으면 그만큼
  // 표가 가로로 넘쳐서 `상태`가 잘린다(1024px에서 실제로 그랬다).
  width: 'min-w-24',
  cell: '',
}

/**
 * 지금 표가 세울 열들. **묶음이 하나도 없으면 그 열은 아예 없다** — 빈 열은 폭만 먹고
 * 아무 말도 안 한다(§8.21의 "전부가 한 묶음이면 아무 표시도 안 한다"와 같은 이유다).
 *
 * **자리는 파일 이름 바로 옆이다.** 그 배지가 꾸미는 것이 파일이기 때문이다.
 */
const COLUMNS = computed<readonly InspectColumn[]>(() => {
  /**
   * **아무도 안 적은 칸은 열이 안 선다** (2026-09-18, 사용자). 학번과 이름은 학생이 안
   * 적어도 되는 값이라, 아무도 안 적은 명렬에서는 `학번 없음`이 서른 줄 서는 열이 둘
   * 생긴다 — 아무것도 못 가르면서 폭만 먹는다. **둘은 따로 본다.**
   */
  const inUse = studentFieldsInUse(roster.summaries.value)
  const shown = BASE_COLUMNS.filter(
    (column) =>
      (column.key !== 'studentId' || inUse.studentId) &&
      (column.key !== 'studentName' || inUse.studentName),
  )
  return sameProject.value.files === 0 || sameProject.value.all
    ? shown
    : [shown[0]!, GROUP_COLUMN, ...shown.slice(1)]
})

/**
 * 왼쪽 열의 판 하나를 담는 카드 (2026-09-18, 사용자).
 *
 * **셋이 한 문자열을 쓴다.** 자리마다 적으면 그중 하나만 고쳐지는 날이 오고, 어긋난
 * 것은 그 열을 통째로 봐야 보인다 — 요약만 카드이던 동안이 정확히 그 상태였다.
 */
const PANEL = 'rounded-panel border border-line bg-surface p-4'

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
 * 머리줄 둘째 줄 — 학번과 이름. **없는 칸은 빼고 잇고, 둘 다 없으면 줄이 아예 없다**
 * (2026-09-18, 사용자). `이름 없음 · 이름 없음`은 아무것도 말하지 않는다.
 *
 * **파일 이름은 여기 없다.** 그것이 머리줄의 제목으로 올라갔다.
 */
const studentLine = computed(() =>
  [studentFields.value.studentId, studentFields.value.studentName]
    .filter((part) => part !== '')
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
  if (busy.value || roster.items.value.length === 0) return
  const job = start()
  bundled.value = 0
  const entries: BundleEntry[] = []
  try {
    // **다 읽었을 때만 내려받는다** (§8.21). 굽는 동안 교사가 다른 폴더를 고르면 그
    // 묶음은 이미 남의 것이라, 여기서 안 물으면 **앞 반의 절반짜리 zip이 내려간다.**
    const whole = await roster.collect((item, read) => {
      bundled.value += 1
      // **나갈 것 둘만 들고 나머지는 놓는다** (2026-09-18 R28-V N-1). `read.project`를
      // 통째로 들면 굽기가 끝날 때까지 **서른 개의 정본 표와 모델과 사진이 동시에 산다** —
      // 한 번에 하나만 푼다는 규칙이 바로 여기서 무너졌다.
      if (read) {
        const { document, attachments } = read.project
        entries.push({ label: item.label, file: { document, attachments } })
      }
    })
    if (whole && entries.length > 0 && alive()) {
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
  <div
    class="flex min-h-full flex-col gap-5 p-4 sm:p-5"
    @dragover.prevent="dragging = true"
    @dragleave="dragging = false"
    @drop.prevent="onDrop"
  >
    <!--
      **머리는 다른 탭과 같은 것이다** (`StepHeader`, §8.9, 2026-09-18 사용자). 점검만
      큰 제목에 큰 단추를 세워 두었더니 **같은 앱의 화면으로 안 읽혔다** — 단계가 아니라고
      해서 머리의 문법까지 다를 이유는 없다.

      **맥락은 배지-값이다** (§8.16, 결과·전처리·학습의 머리와 같은 문법).
    -->
    <StepHeader :title="t('inspect.title')" :purpose="t('inspect.lead')">
      <template v-if="roster.items.value.length > 0" #context>
        <div class="flex items-baseline gap-1.5">
          <dt>
            <AppBadge>{{ t('inspect.submissions') }}</AppBadge>
          </dt>
          <dd class="font-bold tabular-nums text-ink">
            {{ t('inspect.readOf', { read: progress.read, total: progress.total }) }}
          </dd>
        </div>
      </template>
    </StepHeader>

    <input
      ref="fileInput"
      type="file"
      multiple
      :accept="MLPX_ACCEPT"
      class="hidden"
      @change="pick"
    />
    <!--
      **폴더 입구를 따로 둔다** (데이터 화면의 사진 입구와 같은 관용구). 같은 입력에
      `webkitdirectory`를 걸면 파일 몇 개만 고르는 길이 없어진다.
    -->
    <input ref="folderInput" type="file" webkitdirectory class="hidden" @change="pick" />

    <!--
      **비었을 때는 빈 상태가 화면이다** (`AppEmpty`, §8.9). 데이터 화면이 표를 받기 전에
      서 있는 그 모양이다 — 왜 비었는지와 무엇을 하면 열리는지를 함께 주고, **입구 둘이
      그 안에 나란히 선다.** 휴대폰에는 폴더 고르기가 없으므로 둘은 폴백이 아니라 나란한
      길이고, 둘 다 같은 명렬로 들어간다.
    -->
    <!--
      **비어 있는 자리가 곧 과녁이다** (데이터 화면의 표 입구와 같은 모양). 점선은
      장식이 아니라 **끌어다 놓을 수 있다는 약속**이고, 그래서 이 상자에 `@drop`이
      함께 걸려 있다 — 끌면 테두리와 바탕이 물들어 놓을 자리임을 말한다.

      **과녁은 스스로 높이를 갖는다**(`min-h-64`). 부모가 늘려 줄 때는 `flex-1`이
      그것을 받는다 — 데이터 화면의 같은 자리와 같은 판단이다.
    -->
    <div
      v-if="roster.items.value.length === 0"
      class="grid min-h-64 flex-1 place-items-center rounded-panel border-2 border-dashed transition-colors"
      :class="dragging ? 'border-brand bg-brand-soft' : 'border-line-strong bg-surface'"
    >
      <AppEmpty :reason="t('inspect.emptyReason')" :next="t('inspect.emptyNext')">
        <AppButton size="lg" @click="folderInput?.click()">
          <component :is="ACTION_ICONS.openFile" :size="20" aria-hidden="true" />
          {{ t('inspect.pickFolder') }}
        </AppButton>
        <AppButton size="lg" variant="secondary" @click="fileInput?.click()">
          <component :is="ACTION_ICONS.openFile" :size="20" aria-hidden="true" />
          {{ t('inspect.pickFiles') }}
        </AppButton>
      </AppEmpty>
    </div>

    <template v-else>
      <!--
        **누르는 것은 동작 바에 모인다** (`StepActionBar`, §8.13.1). 학습·예측 화면 셋이
        쓰는 그 바이고, 점검만 단추를 본문에 흩어 두면 교사가 화면마다 다른 곳을 찾게
        된다. **기본 자리에는 명렬을 채우는 것**이, **`end`에는 이 화면의 결론**이 선다 —
        교사가 가져가는 것이 포트폴리오 묶음이다.
      -->
      <StepActionBar>
        <AppButton variant="secondary" @click="folderInput?.click()">
          <component :is="ACTION_ICONS.openFile" :size="18" aria-hidden="true" />
          {{ t('inspect.pickFolder') }}
        </AppButton>
        <AppButton variant="secondary" @click="fileInput?.click()">
          <component :is="ACTION_ICONS.openFile" :size="18" aria-hidden="true" />
          {{ t('inspect.pickFiles') }}
        </AppButton>

        <template #end>
          <AppButton :disabled="busy" :action="downloadPortfolios">
            <component :is="ACTION_ICONS.exportFile" :size="18" aria-hidden="true" />
            {{
              busy
                ? t('inspect.bundling', { done: bundled, total: progress.total })
                : t('inspect.bundle')
            }}
          </AppButton>
        </template>
      </StepActionBar>

      <div class="flex flex-col gap-2">
        <!--
          **묶음이 있으면 표 위에서 먼저 말한다** (§8.21, 2026-09-18 사용자). 배지 하나로는
          서른 줄을 훑다 지나친다. **있을 때만 선다** — 드문 것이 눈에 띄어야 한다.
        -->
        <p v-if="sameProject.files > 0" class="text-ink-soft">{{ sameProject.line }}</p>

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
                <!--
                  **같은 프로젝트에서 나온 짝** (§8.21, 2026-09-18 사용자). 번호가 같은
                  줄끼리 한 프로젝트에서 나왔다는 **사실만** 말한다 — 교사가 나눠 준 시작
                  파일이면 반 전체가 같은 번호이므로, 베꼈다는 말은 화면이 하지 않는다.
                -->
                <AppBadge
                  v-if="column.key === 'sameProject' && row.cells.sameProject !== ''"
                  class="whitespace-nowrap"
                  >{{ row.cells.sameProject }}</AppBadge
                >

                <!-- 상태는 값이 아직 없는 줄을 회색으로 둔다. -->
                <span
                  v-else-if="column.key === 'state'"
                  :class="row.faint ? 'text-ink-faint' : 'text-ink-soft'"
                >
                  {{ row.cells[column.key] }}
                </span>
                <!--
                  **교사가 고친 값에는 표시를 안 단다** (§8.21, 2026-09-18 사용자). 한때
                  `(수정)`을 달았는데 **학번 칸에만** 붙어서, 이름만 적게 한 수업에서는
                  학번 열이 안 서므로 표시가 어디에도 없었다. 칸마다 제대로 다는 대신
                  없앤 이유는 **그 값을 방금 넣은 사람이 교사 자신**이고, 그 고침이 이
                  목록에만 산다는 것은 고치는 자리의 안내가 이미 말하기 때문이다.
                -->
                <template v-else>{{ row.cells[column.key] }}</template>
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
      <!--
        **고른 것이 서는 자리** (2026-09-18, 사용자). 줄을 누르면 여기로 굴러온다.

        **누르면 화면이 맨 위로 튀었다.** 읽는 동안 이 자리가 한 줄로 접히면서 문서가
        화면보다 짧아지고, 브라우저가 스크롤을 0으로 당긴다 — 교사는 방금 누른 줄이
        어디 갔는지 모른 채 표 맨 위를 본다.

        **도착 지점은 붙박이 동작 바 아래에서 멈춘다**(`scroll-below-shell`). 그 자리에
        여백이 없으면 바가 머리줄을 덮는다.
      -->
      <!--
        **머리줄은 제 판들과 가깝고, 표와는 멀다** (2026-09-18, 사용자). 이 상자 안의
        간격은 제목과 그 내용 사이(`gap-3`)이고, 표와의 사이는 바깥 리듬(`gap-5`)에
        한 칸을 더 둔다 — 제목이 표에 붙어 서면 표의 마지막 줄처럼 읽힌다.
      -->
      <div ref="detailEl" class="mt-2 flex min-h-0 flex-col gap-3 scroll-below-shell">
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
              <!--
                **제목은 파일 이름이다** (2026-09-18, 사용자). 점검에서 줄의 정체는 파일이고,
                교사가 누른 것도 명렬의 그 글자다 — 머리줄이 다른 글자를 받으면 누른 것과
                보고 있는 것을 한 번 더 대조해야 한다. **학생이 붙인 제목은 요약 카드의 첫
                줄과 표의 열이 갖는다.**

                **같은 프로젝트에서 나온 파일들은 제목이 같다.** 제목을 여기 두면 그 넷을
                번갈아 여는 동안 — 표절 의심을 가리는 바로 그 순간에 — 머리가 한 글자도
                안 바뀐다.

                **화면 제목보다 크면 안 된다.** `StepHeader`의 제목과 같은 눈금으로 선다.
              -->
              <h3 class="truncate text-lg font-bold tracking-tight">{{ opened?.label }}</h3>
              <p v-if="studentLine !== ''" class="truncate text-ink-soft">{{ studentLine }}</p>
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
          <!-- 칸 사이 간격은 다른 화면의 두 열과 같다 (`gap-5`, 전처리·대시보드·포트폴리오). -->
          <div v-if="mode === 'model'" class="grid gap-5 lg:grid-cols-3">
            <!--
            **왼쪽 판 셋은 같은 카드에 담긴다** (2026-09-18, 사용자). 요약만 카드이고
            나머지가 맨몸이면 한 열에 두 문법이 서고, 그 열이 통째로 흐트러져 보인다 —
            **카드 안의 절 리듬은 그대로다**(이름표 `font-bold text-ink-soft`, `gap-1.5`).
          -->
            <div class="flex min-w-0 flex-col gap-5">
              <!-- 무슨 데이터를 몇 행, 타깃은 무엇으로. **교사가 가장 먼저 보는 줄들이다.** -->
              <aside :class="PANEL">
                <!-- **제목이 첫 줄이다** (2026-09-18, 사용자). 학생이 이 프로젝트를 뭐라고
                   불렀는지가 요약의 머리에 선다 — 파일 이름과 다를 수 있다. -->
                <ProjectSummary :file="viewing.file" with-name />
              </aside>

              <!--
              **어디서 왔나는 무엇인가 다음이다** (§8.21). 짝이 있을 때만 서므로, 이 판이
              보이는 것 자체가 드문 일이라는 신호다.
            -->
              <div v-if="sameProjectPeers.length > 0" :class="PANEL">
                <SameProjectPanel
                  :labels="sameProjectPeers"
                  :current="opened?.label ?? ''"
                  :name="sameProjectText(opened?.label ?? '')"
                  :project-id="viewing.file.document.manifest.projectId"
                />
              </div>

              <!--
              **무결성이 요약 바로 아래다.** 교사가 제출물에서 묻는 순서가 "무엇인가 →
              손댄 흔적이 있나 → 점수가 진짜인가"이고, **세 판이 이 열에 그 순서로 선다**
              (§8.21). 무결성은 파일 전체의 일이라 실험마다 다른 값이 아니다.
            -->
              <div :class="PANEL">
                <IntegrityPanel :integrity="viewing.integrity" />
              </div>

              <!--
              **대조는 무결성 바로 아래다** (2026-09-18, 사용자). 둘 다 "이 제출물을 믿을
              수 있나"의 답이라, 사이에 다른 것이 끼면 묻는 흐름이 끊긴다. 대조가 **그
              실험**의 일이라는 것은 자리가 아니라 판이 말한다(`:order`).

              **단추로 돈다.** 열자마자 돌면 무결성만 훑는 한 바퀴가 불가능해지고, 서른 개
              동선이 거기서 무너진다 (open-decisions.md "명렬은 메타만 읽는다").
            -->
              <div v-if="viewing.current" :class="PANEL">
                <!--
                **판정 꾸러미는 제출물마다 새로 선다** (2026-09-18, 사용자). 판은 실험을
                바꿔도 판정을 들고 있는데(그래야 3번을 대조하고 2번을 들렀다 돌아왔을 때
                다시 안 돌린다), **파일이 바뀌면 그 기억은 남의 것**이다. 실험 id는 같은
                프로젝트에서 나온 파일들 사이에서 겹치므로 이름표로 가른다.

                **이 `:key`가 그 일을 혼자 하는 것은 아니다** (2026-09-18 R28 C-6). 줄을
                고르면 `viewing`이 잠깐 `null`이 되어 위 `v-else` 아래가 통째로 내려갔다
                다시 서므로, 지워도 남의 판정이 앉을 자리는 없다 — **뜻을 자리가 아니라
                이름으로 적어 두는 것**이라 남긴다.
              -->
                <ReproducePanel
                  :key="opened?.label"
                  :experiment="viewing.current"
                  :order="viewing.order.get(viewing.current.id) ?? 0"
                  :data-type="viewing.file.document.manifest.dataType"
                  :dataset="viewing.dataset"
                  :test-dataset="viewing.testDataset"
                />
              </div>

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
            <div class="flex min-w-0 flex-col gap-5 lg:col-span-2">
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
              <!--
                **빈 상태는 자리를 넉넉히 잡는다** (2026-09-18, 사용자, 포트폴리오 빈 자리와
                같은 처리). 한 줄짜리 판이면 오른쪽 열이 통째로 접혀서, 왼쪽 판들만 선
                화면이 한쪽으로 쏠린다. 다른 화면의 빈 상태와 같은 부품이고 같은 여백이다.
              -->
              <div
                v-else
                class="grid min-h-64 flex-1 place-items-center rounded-panel border border-line bg-surface"
              >
                <AppEmpty
                  :reason="t('inspect.noExperiment')"
                  :next="t('inspect.noExperimentNext')"
                />
              </div>
            </div>
          </div>

          <!--
          **글은 한 열로 넓게 선다** (§8.21). 학생이 [완성본]에서 보던 폭이고, 두 열에
          끼우면 읽는 폭이 아니다.
        -->
          <PortfolioPanel v-else :file="viewing.file" />
        </template>
      </div>
    </template>
  </div>
</template>
