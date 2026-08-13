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

/** 타깃·특성·유형까지 고른 프로젝트. 여기까지 와야 계획이 선다. */
function chosen(preprocessing?: Partial<Preprocessing>): ProjectFile {
  const file = projectWith()
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
    expect(text).toContain('기계학습 유형을 고르면 정해집니다.')
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
    expect(text).toContain('채운 값과 스케일링 기준은 훈련 데이터에서만 구합니다.')
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
    expect(text).toContain('빈 칸')
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
    // 채울 것이 있는 열에만 뜬다. 빈 칸이 없는 열에 값을 보여주면 거기도 비어 보인다.
    expect(text).toContain('빈 칸 →')
  })

  it('스케일링 기준을 방식의 말로 읽는다', () => {
    const file = chosen({ scaling: 'standard' })
    const text = pickerFor(file).text()
    // 표준화의 기준은 평균과 표준편차다. 기준·폭 같은 우리 낱말을 만들지 않는다.
    expect(text).toContain('평균')
    expect(text).toContain('표준편차')
    expect(text).not.toMatch(/scalingBasis[.]\w+/)
  })
})
