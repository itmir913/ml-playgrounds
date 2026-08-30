// @vitest-environment jsdom
/**
 * 전처리 요약 카드 (`views/preprocess/TabularPrepSummary.vue`).
 *
 * **카드가 말하는 숫자는 `planRun`에서 온다** — 그 계획이 학습이 쓰는 것과 같은지는
 * `plan.spec.ts`가 본다. 여기서 보는 것은 **화면이 그 값을 제대로 꺼내 놓는지**와
 * **세 상태를 다 갖는지**다: 유형을 안 골랐다 / 학습이 거부한다 / 계획이 섰다.
 *
 * 대시보드 검사와 같은 방식으로 **띄워서 본다** — 없는 로케일 키를 만나면 `i18n`이
 * 검사 환경에서 던지므로, 그리는 것만으로 그물에 걸린다.
 *
 * 열마다의 값(무엇으로 채우고 무엇을 기준으로 스케일링하는가)은 카드가 아니라 **열
 * 고르기 표**가 갖는다. 그 칸도 여기서 함께 본다 — 출처가 같은 계획이다.
 */

import { createPinia, setActivePinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import ColumnPicker from '../src/views/preprocess/ColumnPicker.vue'
import TabularPrepSummary from '../src/views/preprocess/TabularPrepSummary.vue'
import { summarizeColumns } from '../src/data/columns'
import { columnPlan } from '../src/ml/selection'
import { hashBytes } from '../src/hash'
import { planRun } from '../src/ml/plan'
import { i18n, setLocale } from '../src/i18n'
import { newProjectDocument } from '../src/project/create'
import { applyDataset, readDataset, readTestDataset } from '../src/project/dataset'
import type { ProjectFile } from '../src/project/format'
import {
  withFeatures,
  withPreprocessing,
  withSplit,
  withTarget,
  withTaskType,
} from '../src/project/settings'
import { tabularDataOf, type Preprocessing } from '../src/project/schema'
import { useProjectStore } from '../src/stores/project'

const NOW = '2026-08-13T00:00:00.000Z'

const CSV = ['키,반,점수', '150,A,80', '160,B,90', '170,A,70', '180,B,60'].join('\n')

/** 같은 표인데 `키` 한 칸이 비어 있다. 결측 전략을 시험하려면 정말로 빈 칸이 필요하다. */
const CSV_WITH_BLANK = ['키,반,점수', '150,A,80', ',B,90', '170,A,70', '180,B,60'].join('\n')

/** 정본이 앉은 프로젝트. **진짜 입구로 만든다** — 손으로 조립하면 방어선을 건너뛴다. */
function projectWith(csv = CSV): ProjectFile {
  const document = newProjectDocument(
    { name: '테스트', locale: 'ko', dataType: 'tabular' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: NOW,
      randomState: 42,
    },
  )
  const bytes = new TextEncoder().encode(csv)
  const grid = csv.split('\n').map((line) => line.split(','))
  const empty: ProjectFile = {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
  return applyDataset(
    empty,
    { bytes, hash: hashBytes(bytes), grid, source: 'csv', sourceEncoding: 'utf-8' },
    { fileName: '점수.csv', hasHeader: true, now: NOW },
  ).project
}

/**
 * **계획은 판이 계산해서 내려준다.** 검사도 같은 자리에서 같은 함수를 부른다 — 카드가
 * 스스로 세지 않는다는 것이 이 컴포넌트의 전부다.
 */
function mountSummary(file: ProjectFile) {
  const store = useProjectStore()
  store.file = file
  const dataset = readDataset(file)
  const plan =
    dataset === null
      ? null
      : planRun({
          dataset,
          testDataset: readTestDataset(file),
          settings: file.document.settings,
          taskType: file.document.manifest.taskType,
        })
  return mount(TabularPrepSummary, { props: { plan }, global: { plugins: [i18n] } })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  await setLocale('ko')
})

/**
 * 카드의 `<dt>`와 그 짝 `<dd>`. **이름과 숫자를 짝지어 읽는다.**
 *
 * 카드 글 전체에서 `toContain('3행')`만 보던 때에는 **훈련과 테스트 자리를 통째로
 * 맞바꿔도** 글자열이 한 자도 안 변해서 저장소 2,254개가 전부 초록이었다
 * (2026-08-30 R12 감사 A-1).
 */
function labelled(wrapper: ReturnType<typeof mountSummary>): Record<string, string> {
  const pairs: Record<string, string> = {}
  for (const row of wrapper.findAll('dl div')) {
    const name = row.find('dt')
    const value = row.find('dd')
    if (name.exists() && value.exists()) pairs[name.text()] = value.text()
  }
  return pairs
}

/** 타깃·특성·유형까지 고른 프로젝트. 여기까지 와야 계획이 선다. */
function chosen(preprocessing?: Partial<Preprocessing>, csv = CSV): ProjectFile {
  const file = projectWith(csv)
  let document = withTarget(file.document, '점수', NOW)
  document = withFeatures(document, ['키', '반'], NOW)
  document = withTaskType(document, 'regression', [], NOW)
  // 층화는 회귀 타깃에서 막힌다(값이 거의 다 다르다). 여기서 보려는 것은 그 뒤다.
  document = withSplit(document, { stratify: false }, NOW)
  if (preprocessing) document = withPreprocessing(document, preprocessing, NOW)
  return { ...file, document }
}

describe('전처리 요약', () => {
  it('유형을 안 골랐으면 정해지지 않았다고 말한다', () => {
    const summary = mountSummary(projectWith())
    const text = summary.text()

    // 전체 행 수는 계획이 못 서도 안다 - 정본을 읽은 것이 곧 그 숫자다.
    expect(text).toContain('4행')
    expect(text).toContain('기계학습 유형을 선택하면 정해집니다.')
    // 로케일 키가 그대로 뜨는 것까지 막는다 (대시보드 검사와 같은 그물이다).
    expect(text).not.toMatch(/preprocess[.]\w+/)
  })

  it('계획이 서면 훈련과 테스트 행 수를 말한다', () => {
    const summary = mountSummary(chosen())
    const text = summary.text()

    // 4행 중 30%가 테스트다 - 반올림은 ml/split.ts가 하고 화면은 받아 적기만 한다.
    expect(text).toContain('훈련 데이터')
    expect(text).toContain('3행')
    expect(text).toContain('1행')
    expect(text).toContain('대체한 값과 스케일링 기준은 훈련 데이터에서만 구합니다.')
  })

  /**
   * **네 숫자가 제 이름 옆에 앉는지 본다.**
   *
   * 위의 검사는 카드 글 전체에서 숫자가 **있는지**만 보므로 자리를 바꿔도 안 운다.
   * 게다가 `chosen()`의 표는 4행에 결측이 없어 `전체`와 `쓸 수 있는 행`이 **같은 값**
   * 이라 그 축이 아예 안 갈린다. 그래서 여기서는 **넷이 다 다른** 표를 쓴다 —
   * 빈 칸이 하나 있는 표에 `drop`을 걸면 4 · 3 · 2 · 1이 된다.
   */
  it('네 숫자가 제 이름 옆에 앉는다', () => {
    const pairs = labelled(mountSummary(chosen({ missing: 'drop' }, CSV_WITH_BLANK)))

    expect(pairs).toMatchObject({
      전체: '4행',
      '쓸 수 있는 행': '3행',
      '훈련 데이터': '2행',
      '테스트 데이터': '1행',
    })
  })

  /**
   * **거부 사유도 결과다.** 지금까지는 [학습]을 눌러야 알 수 있었다. `반`은 문자
   * 열이라 인코딩을 끄면 학습에서 빠지고, 남는 특성이 `키` 하나다 — 여기서는 그보다
   * 앞서 "빈 칸을 그대로 두기"가 걸리도록 값을 비운 표를 쓴다.
   */
  it('학습이 거부하면 그 사유가 뜬다', () => {
    const file = projectWith(CSV_WITH_BLANK)
    let document = withTarget(file.document, '점수', NOW)
    document = withFeatures(document, ['키'], NOW)
    document = withTaskType(document, 'regression', [], NOW)
    document = withPreprocessing(document, { missing: 'none' }, NOW)

    const text = mountSummary({ ...file, document }).text()
    expect(text).toContain('결측치')
    expect(text).not.toMatch(/errors[.]\w+/)
  })
})

describe('열 표의 전처리 칸', () => {
  /** 카드와 같은 계획에서 나온다. 표는 받아 적기만 한다. */
  function pickerFor(file: ProjectFile) {
    const dataset = readDataset(file)
    if (dataset === null) throw new Error('정본이 없다')
    const plan = planRun({
      dataset,
      testDataset: readTestDataset(file),
      settings: file.document.settings,
      taskType: file.document.manifest.taskType,
    })
    if (!plan.ok) throw new Error('계획이 서야 하는 자리다')
    const data = tabularDataOf(file.document)!
    return mount(ColumnPicker, {
      props: {
        plan: columnPlan({
          columns: summarizeColumns(dataset),
          rowCount: dataset.rows.length,
          taskType: file.document.manifest.taskType,
          target: data.target,
          features: data.features,
          preprocessing: data.preprocessing,
        }),
        fitted: new Map(plan.preprocessor.columns.map((column) => [column.name, column])),
        scaling: data.preprocessing.scaling,
        encoding: data.preprocessing.categoricalEncoding,
      },
      global: { plugins: [i18n] },
    })
  }

  it('결측이 있는 열에만 채움값을 말한다', () => {
    const file = projectWith(CSV_WITH_BLANK)
    let document = withTarget(file.document, '점수', NOW)
    document = withFeatures(document, ['키'], NOW)
    document = withTaskType(document, 'regression', [], NOW)
    document = withSplit(document, { stratify: false }, NOW)
    document = withPreprocessing(document, { missing: 'median' }, NOW)

    const text = pickerFor({ ...file, document }).text()
    // 대체할 것이 있는 열에만 뜬다. 결측치가 없는 열에 값을 보여주면 거기도 비어 보인다.
    expect(text).toContain('결측치 →')
  })

  /**
   * **인코딩도 이 열에 일어나는 일이다.** 스케일링 기준만 적던 때에는, 미리보기에
   * `반=A`처럼 늘어난 열이 보이는데 그 열의 `전처리` 칸이 비어 있었다
   * (2026-08-29 전 경로 감사).
   */
  it('원-핫은 열이 몇 개로 늘어나는지 말한다', () => {
    const text = pickerFor(chosen({ categoricalEncoding: 'onehot' })).text()

    expect(text).toContain('원-핫 인코딩')
    // `반`은 A와 B 둘이라 열이 둘이 된다.
    expect(text).toContain('2개')
    expect(text).not.toMatch(/encodingBasis[.]\w+/)
  })

  it('순서 인코딩은 번호가 어디까지 가는지 말한다', () => {
    const text = pickerFor(chosen({ categoricalEncoding: 'ordinal' })).text()

    expect(text).toContain('순서 인코딩')
    // 범주 둘이면 0과 1이다.
    expect(text).toContain('0 ~ 1')
  })

  /** 수치 열에는 인코딩이 없다. 문자 열 하나뿐이므로 문장도 하나뿐이어야 한다. */
  it('수치 열에는 인코딩을 안 말한다', () => {
    const text = pickerFor(chosen({ categoricalEncoding: 'onehot' })).text()

    expect(text.match(/인코딩/g)).toHaveLength(1)
  })

  it('스케일링 기준을 방식의 말로 읽는다', () => {
    const file = chosen({ scaling: 'standard' })
    const text = pickerFor(file).text()
    // 표준화의 기준은 평균과 표준편차다. 기준·폭 같은 우리 낱말을 만들지 않는다.
    expect(text).toContain('평균')
    expect(text).toContain('표준편차')
    expect(text).not.toMatch(/scalingBasis[.]\w+/)
  })

  /**
   * **숫자까지 못 박는다.** 낱말만 보면 `center`와 `spread`를 **서로 맞바꿔도** 안 운다 —
   * 화면이 `평균 12.47 · 표준편차 163.3`이라 적어도 `평균`과 `표준편차`는 둘 다 있다
   * (2026-08-30 R12 감사 A-3). 방식 셋을 나란히 두면 방식을 하나로 못 박는 돌연변이도
   * 함께 걸린다.
   *
   * 값은 **훈련 데이터에서만** 나온다(4행 중 3행). 여기 적은 숫자는 화면이 실제로 그린
   * 것이고, 계산을 검사가 다시 하지 않는다 — 같은 함수로 기대값을 만들면 규칙을 바꿔도
   * 대조는 언제나 맞는다.
   */
  const BASES: [Preprocessing['scaling'], string][] = [
    ['standard', '평균 163.3 · 표준편차 12.47'],
    ['minmax', '최솟값 150 · 범위 30'],
    ['robust', '중앙값 160 · 사분위 범위 15'],
  ]

  for (const [scaling, expected] of BASES) {
    it(`${scaling}의 기준값이 제 이름 옆에 앉는다`, () => {
      expect(pickerFor(chosen({ scaling })).text()).toContain(expected)
    })
  }

  /**
   * **채울 것이 없으면 채움값을 안 보여준다.** 소스가 머리말에 적어 둔 조건인데
   * (`column.summary.missing > 0`), 떼도 아무도 안 울었다. 있음(`toContain`)만 보고
   * 없음을 안 봤기 때문이다. 이 표에는 빈 칸이 하나도 없다.
   */
  it('결측이 없는 열에는 채움값을 안 적는다', () => {
    expect(pickerFor(chosen({ missing: 'mean' })).text()).not.toContain('결측치 →')
  })

  /**
   * **색이 문장보다 넓게 잡히면 안 된다.**
   *
   * `columnPlan`은 `targetIssue`를 역할과 무관하게 모든 열에 채운다. `noteOf`는
   * `role === 'target'`으로 거르는데 `toneOf`는 안 걸러서, **회귀에서 범주 특성이
   * 빨갛게 나왔다** — 그 줄이 실제로 말하는 것은 `notEncodable`이고, 그건
   * *"고르는 것 자체는 막지 않는다"*고 `selection.spec.ts`가 못 박은 **주의**다.
   * 같은 사실이 분류에서는 회색, 회귀에서는 빨강이었다 (2026-08-30, R12 감사 C-1).
   */
  it('회귀에서 범주 특성의 주의를 빨강으로 칠하지 않는다', () => {
    // 회귀 · 타깃 점수(수치) · 특성에 반(범주) · 인코딩 없음.
    const picker = pickerFor(chosen({ categoricalEncoding: 'none' }))
    const rows = picker.findAll('tbody tr')
    const grade = rows.find((row) => row.text().includes('반'))

    const note = grade?.find('span.block:not(.font-bold)')
    expect(note?.text()).toContain('학습에서 빠집니다')
    expect(note?.classes()).toContain('text-ink-soft')
    expect(note?.classes()).not.toContain('text-danger')
  })
})
