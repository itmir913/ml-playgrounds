// @vitest-environment jsdom
/**
 * **점검의 대조 예상 시간이 학습과 같은 열 종류로 폭을 센다** (`ReproducePanel`의 `featureWidth`).
 *
 * 대조 판은 계획을 다시 세우지 않는다(`inspect-rules.spec.ts`). 학습이 본 열 종류는 파일에
 * **기록된 전처리기**에 있고, 대조 판은 그것으로 `ml/plan.ts`의 `fittedKinds`를 지난다 — 학습
 * 화면이 `plannedColumns`로 지나는 그 덮기다. 기록이 없으면 파일 전체의 종류로 센다. 학습과
 * 같이 타깃과 같은 이름은 특성에서 뺀다.
 *
 * 입력은 전처리 판·학습 화면과 **같은 것**이다(`fixtures/prep-kind.ts`). 실험의 분할은 그
 * 프로젝트에서 쓸 수 있는 행으로 적고, 기록된 전처리기는 학습이 남기는 것처럼 그 분할로
 * 계획해서 얻는다.
 */

import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/ml/worker/client', () => ({
  train: () => ({ result: new Promise(() => {}), cancel: () => {} }),
  calibrateDevice: () => Promise.resolve(null),
}))

vi.mock('../src/ml/worker/spawn', () => ({ spawnTrainingWorker: () => ({}) }))

const { MLJS_ENGINE } = await import('../src/ml/engines/mljs')
const { i18n, setLocale } = await import('../src/i18n')
const { planRun } = await import('../src/ml/plan')
const { usableRows } = await import('../src/ml/preprocess')
const { reproduceInputOf } = await import('../src/ml/reproduce')
const { readDataset } = await import('../src/project/dataset')
const { dataSnapshot, tabularDataOf } = await import('../src/project/schema')
const ReproducePanel = (await import('../src/views/inspect/ReproducePanel.vue')).default
const { experiment, run } = await import('./fixtures/project')
const { surveyCsv, tabularProjectFrom } = await import('./fixtures/prep-kind')

interface Case {
  readonly blankTarget: boolean
  /** 기록된 전처리기를 넘기는가. 거짓이면 남이 편집해 못 읽은 파일이다. */
  readonly recorded: boolean
  readonly features: readonly string[]
  readonly encoding: 'none' | 'onehot'
}

/** 설문 프로젝트를 학습했다면 파일에 남았을 실험 하나와, 그 실험의 대조 판 폭. */
async function widthOf(one: Case): Promise<number> {
  const file = await tabularProjectFrom(surveyCsv(one.blankTarget), '설문.csv', {
    taskType: 'classification',
    target: '성별',
    features: one.features,
    preprocessing: { categoricalEncoding: one.encoding },
  })
  const table = readDataset(file)
  const data = tabularDataOf(file.document)
  if (!table || !data) throw new Error('survey project has no table')
  const usable = usableRows(table, data.features, data.target, data.preprocessing.missing)
  const base = experiment('experiment-1', [run('experiment-1-run-1', { engine: MLJS_ENGINE })])
  const claim = {
    ...base,
    settings: {
      ...base.settings,
      taskType: 'classification' as const,
      selectedAlgorithms: [{ algorithm: 'decision_tree', runtime: 'mljs' }],
      data: dataSnapshot('tabular', { data }),
      split: { ...file.document.settings.split },
      trainIndices: usable.filter((_, at) => at % 5 !== 0),
      testIndices: usable.filter((_, at) => at % 5 === 0),
    },
  }
  const plan = planRun(
    reproduceInputOf({ experiment: claim, dataset: table, testDataset: null, dataType: 'tabular' }),
  )
  if (!plan.ok) throw new Error('the survey experiment must plan')
  const panel = mount(ReproducePanel, {
    props: {
      experiment: claim,
      order: 1,
      dataType: 'tabular',
      dataset: table,
      testDataset: null,
      preprocessor: one.recorded ? plan.preprocessor : null,
    },
    global: { plugins: [i18n] },
  })
  const width = (panel.vm as unknown as { featureWidth: number }).featureWidth
  panel.unmount()
  return width
}

const SURVEY = { features: ['키', '몸무게'], encoding: 'none' } as const

describe('대조 예상 시간의 폭이 학습과 같은 열 종류로 선다', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await setLocale('ko')
  })

  /** `모름` 행이 실행에서 빠졌으므로 학습은 `키`를 수치로 썼다 — 인코딩이 꺼져도 둘 다 한 칸. */
  it('글자가 실행에서 빠지면 폭이 2다', async () => {
    expect(await widthOf({ ...SURVEY, blankTarget: true, recorded: true })).toBe(2)
  })

  /** 대조 — 글자가 실행에 들어가면 `키`는 범주이고 인코딩이 꺼져 빠진다. */
  it('글자가 실행에 들어가면 폭이 1이다', async () => {
    expect(await widthOf({ ...SURVEY, blankTarget: false, recorded: true })).toBe(1)
  })

  /** 기록된 전처리기를 못 읽은 파일은 파일 전체의 종류로 센다 — 지어내지 않는다. */
  it('기록이 없으면 파일 전체의 종류로 센다', async () => {
    expect(await widthOf({ ...SURVEY, blankTarget: true, recorded: false })).toBe(1)
  })

  /**
   * **타깃과 같은 이름은 특성에서 뺀다** — 학습이 뺀다(`featuresInUse`). 원핫이면 범주 타깃
   * `성별`은 두 칸이라, 빼지 않으면 폭이 4가 된다.
   */
  it('특성 목록에 타깃이 남아 있어도 폭에 안 센다', async () => {
    const width = await widthOf({
      blankTarget: true,
      recorded: true,
      features: ['키', '몸무게', '성별'],
      encoding: 'onehot',
    })
    expect(width).toBe(2)
  })
})
