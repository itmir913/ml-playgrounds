// @vitest-environment jsdom
/**
 * **한 옵션이 다른 옵션을 무의미하게 만들 때 — 끄지 않고 잠근다** (`open-decisions.md` 55,
 * 2026-09-23, 코드 소유자).
 *
 * A 때문에 B가 적용될 수 없으면 B의 값은 그대로 두고, 학습은 B를 무시하고, 화면은 B를
 * 이유와 함께 잠근다. **A를 되돌리면 B가 그대로 살아나야 한다.** 전에는 다섯 자리가 B를
 * 끄거나 지우거나 다른 값으로 덮어써서, 학생이 그 탭으로 돌아가 다시 골라야 했다.
 *
 * | # | A | 이 파일의 describe |
 * |---|---|---|
 * | 1 | 기계학습 유형 | 유형을 바꿔도 모델 선택이 남는다 |
 * | 2 | 타깃 열 | 타깃을 골라도 특성 목록이 남는다 |
 * | 3 | 표본 수 · 시험 비율 · 데이터 | 층화가 막히면 잠기고 학습은 무시한다 |
 * | 4 | 시각화 창의 열 | 창의 도구 |
 * | 5 | 산점도의 가로축 | 산점도의 세로축 |
 *
 * **왕복으로 잰다.** A를 바꾸고 → B가 잠기고 → A를 되돌리면 → B가 처음 그대로인지. 한쪽
 * 시점만 재면 "지웠다가 다시 채운 것"과 "안 지운 것"이 구별되지 않는다.
 *
 * **학생의 손으로 몬다** — 유형 카드·타깃 라디오는 누르고, 창의 열은 바깥이 바꾼다
 * (검사기에서 다른 열을 누른 것과 같다). 판의 안쪽은 **읽기만** 한다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { RouterView } from 'vue-router'

/**
 * 학습 화면이 뜨자마자 기기 교정을 워커에 시킨다. **아무 말도 안 하는 워커**로 갈아 끼운다.
 * 몇 번 띄웠는지 센다 — 학습이 시작됐는지를 워커가 떴는지로 본다.
 */
const spawned = vi.hoisted(() => ({ count: 0 }))
vi.mock('../src/ml/worker/spawn', () => ({
  spawnTrainingWorker: () => {
    spawned.count += 1
    return {
      onmessage: null,
      onerror: null,
      onmessageerror: null,
      postMessage() {},
      terminate() {},
    }
  },
}))

vi.mock('vue-chartjs', () => ({
  Bar: { name: 'Bar', props: ['data', 'options', 'plugins'], render: () => null },
  Scatter: { name: 'Scatter', props: ['data', 'options'], render: () => null },
}))

import { i18n, setLocale } from '../src/i18n'
import { planRun } from '../src/ml/plan'
import {
  byChosenRow,
  chosenModelBlocks,
  featuresInUse,
  trainableSelections,
} from '../src/ml/selection'
import { trainingSourceOf } from '../src/ml/training-source'
import { factsOf } from '../src/stores/project'
import StepActionBar from '../src/components/StepActionBar.vue'
import TabularSummaryRows from '../src/components/summary/TabularSummaryRows.vue'
import { readDataset } from '../src/project/dataset'
import { DATA_FACTS } from '../src/project/facts'
import type { ProjectFile } from '../src/project/format'
import { withFeatures, withSampling, withSplit, withTaskType } from '../src/project/settings'
import { closeStorage, DB_NAME, saveProject } from '../src/project/storage'
import { router } from '../src/router'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ChartDialog from '../src/views/data/ChartDialog.vue'
import TabularPrepPanel from '../src/views/preprocess/TabularPrepPanel.vue'
import TrainView from '../src/views/TrainView.vue'
import { stubDialogElement } from './fixtures/image-workers'
import { IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN } from './fixtures/iris'
import { irisProject } from './fixtures/trained'

const NOW = '2026-09-23T00:00:00Z'
const WAIT_MS = 10_000
const t = (key: string, params: Record<string, unknown> = {}): string => i18n.global.t(key, params)

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** 라우터를 태워 화면을 띄우는 껍데기. **파일에 하나만 둔다** (`vue/one-component-per-file`). */
const Host = defineComponent({ render: () => h(RouterView) })

function occurrences(text: string, fragment: string): number {
  return text.split(fragment).length - 1
}

beforeEach(async () => {
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  window.scrollTo = () => {}
  // jsdom에는 없다. 시각화 창이 도구를 고르면 그림으로 데려간다(`ChartDialog`의 `pickTool`).
  if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = () => {}
  }
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: { estimate: () => Promise.resolve({ quota: 10_000_000_000, usage: 0 }) },
  })
  if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = () => {}
  }
  await setLocale('ko')
})

afterEach(async () => {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined })
  closeStorage()
  await deleteDatabase()
})

// ------------------------------------------------------------------------------------ 1

describe('유형을 바꿔도 모델 선택이 남는다', { timeout: 30_000 }, () => {
  /** 분류 전용 하나 · 회귀 전용 하나. 어느 유형에서든 한 줄이 잠긴다. */
  const BOTH = ['logistic_regression', 'linear_regression'] as const

  it('잠긴 줄은 학습에 안 넘어가고, 파일의 선택은 그대로다', async () => {
    const file = await irisProject(BOTH)
    const source = await trainingSourceOf({ project: file, taskType: 'classification' })
    expect(source.settings.selectedAlgorithms.map((one) => one.algorithm)).toEqual([
      'logistic_regression',
    ])
    expect(file.document.settings.selectedAlgorithms.map((one) => one.algorithm)).toEqual([...BOTH])
  })

  it('판정은 줄마다 이유 목록이고, 학습에 넘기는 목록과 같은 판정이다', () => {
    const rows = BOTH.map((algorithm) => ({ algorithm }))
    expect(rows.map((row) => chosenModelBlocks(row, 'classification'))).toEqual([
      [],
      ['ALGORITHM_NOT_FOR_TASK_TYPE'],
    ])
    expect(trainableSelections(rows, 'classification')).toEqual([rows[0]])
    // 유형을 안 골랐으면 잠그지 않는다 — 무엇을 하려는지 모른다.
    expect(chosenModelBlocks(rows[1]!, undefined)).toEqual([])
  })

  /**
   * **학습이 보낸 상태는 잠긴 줄을 건너 제 줄에 앉는다.** 학습에는 잠긴 줄을 뺀 목록이 가므로
   * 워커의 자리는 그 목록의 자리다 — 그대로 붙이면 다른 모델의 줄에 상태가 앉는다.
   */
  it('학습이 보낸 상태가 줄 자리로 옮겨진다', () => {
    const blocks = [[], ['ALGORITHM_NOT_FOR_TASK_TYPE'], []]
    expect(byChosenRow(blocks, ['done', 'running'])).toEqual(['done', null, 'running'])
  })

  async function trainScreen(file: ProjectFile): Promise<VueWrapper> {
    await saveProject(file)
    const wrapper = mount(Host, { global: { plugins: [i18n, router] } })
    await router.push('/')
    await router.isReady()
    await router.push(`/project/${file.document.manifest.projectId}/train`)
    await settle()
    expect(String(router.currentRoute.value.name)).toBe('train')
    return wrapper
  }

  /** 그 모델의 줄. 담긴 목록의 `<li>`에서 모델 이름으로 찾는다. */
  function rowOf(wrapper: VueWrapper, algorithm: string) {
    const row = wrapper
      .findAll('li')
      .find((one) => one.text().startsWith(t(`algorithms.${algorithm}`)))
    expect(row, algorithm).toBeDefined()
    return row!
  }

  async function pickTaskType(wrapper: VueWrapper, label: string): Promise<void> {
    const card = wrapper.findAll('button').find((one) => one.text().startsWith(label))
    expect(card, label).toBeDefined()
    await card!.trigger('click')
    await settle()
  }

  it('유형 카드를 오가도 두 줄이 남고, 잠기는 줄만 바뀐다', async () => {
    const wrapper = await trainScreen(await irisProject(BOTH))
    const reason = t('client.ALGORITHM_NOT_FOR_TASK_TYPE')
    const selected = () =>
      useProjectStore().file?.document.settings.selectedAlgorithms.map((one) => one.algorithm)

    // 분류 — 회귀 전용 줄이 잠긴다.
    expect(rowOf(wrapper, 'linear_regression').text()).toContain(reason)
    expect(rowOf(wrapper, 'logistic_regression').text()).not.toContain(reason)

    await pickTaskType(wrapper, '회귀')
    expect(selected()).toEqual([...BOTH])
    expect(rowOf(wrapper, 'logistic_regression').text()).toContain(reason)
    expect(rowOf(wrapper, 'linear_regression').text()).not.toContain(reason)

    // 되돌리면 처음 그대로다 — 지웠다가 다시 채운 것이 아니라 안 지웠다.
    await pickTaskType(wrapper, '분류')
    expect(selected()).toEqual([...BOTH])
    expect(occurrences(wrapper.text(), reason)).toBe(1)
    wrapper.unmount()
  })

  it('담은 모델이 전부 잠기면 [학습하기]가 이유와 함께 잠긴다', async () => {
    const wrapper = await trainScreen(await irisProject(['linear_regression']))
    expect(wrapper.text()).toContain(t('train.nothingTrainable'))
    // 줄이 보이는데 "추가한 모델이 없다"고 말하면 거짓이다.
    expect(wrapper.text()).not.toContain(t('train.nothingToTrain'))
    const start = wrapper.findAll('button').find((one) => one.text() === t('train.start'))
    expect(start?.attributes('disabled')).toBeDefined()

    // **동작도 같은 gate로 거절한다** — 잠긴 버튼을 우회해 불러도 시작하지 않는다.
    const view = wrapper.findComponent(TrainView).vm as unknown as {
      startTraining: () => Promise<void>
      working: boolean
    }
    void view.startTraining()
    await settle()
    expect(view.working).toBe(false)
    expect(useProjectStore().file?.document.runs.experiments).toHaveLength(0)
    wrapper.unmount()
  })

  /**
   * **유형 없이 모델이 담긴 파일에서 [학습하기]는 켜져 있고, 누르면 실패를 알린다**
   * (`open-decisions.md` 60, architecture.md §10.6). 스키마에 유형·모델 교차 제약이 없어 이런
   * 파일이 열린다. 잠그지 않되 **조용히 아무 일도 안 하면 안 된다** — 알림이 뜨고, 동작 바에
   * 실패가 남고, 학습은 시작하지 않는다.
   */
  it('유형이 빠진 파일에서 [학습하기]가 켜져 있고, 누르면 알림이 뜨고 워커는 안 뜬다', async () => {
    const file = await irisProject(['decision_tree'])
    const manifest = { ...file.document.manifest }
    delete manifest.taskType
    const wrapper = await trainScreen({ ...file, document: { ...file.document, manifest } })
    expect(useProjectStore().taskType).toBeUndefined()

    const start = wrapper.findAll('button').find((one) => one.text() === t('train.start'))
    expect(start?.attributes('disabled')).toBeUndefined()
    const before = spawned.count
    await start!.trigger('click')
    await settle()

    const alerts = useToastStore().items.filter((one) => one.tone === 'danger')
    expect(alerts.map((one) => one.key)).toContain('train.noTaskTypeReason')
    // 알림은 사라져도 실패는 동작 바에 남는다(학습의 다른 실패와 같은 자리).
    expect(wrapper.findComponent(StepActionBar).text()).toContain(t('train.failedHere'))
    expect(spawned.count).toBe(before)
    expect(useProjectStore().file?.document.runs.experiments).toHaveLength(0)
    wrapper.unmount()
  })

  /**
   * **잠긴 줄은 돌 것처럼 말하지 않는다** (R38-D55 N7·B-3). 예상 시간은 걸릴 시간이라 잠긴 줄에
   * 있으면 돌 것처럼 읽히고, 손잡이가 열려 있으면 학습이 무시할 값을 고치게 된다 — 값은 보이되
   * `readonly`다. 유형을 되돌리면 그 값으로 돈다.
   */
  it('잠긴 줄에는 예상 시간이 없고 손잡이는 읽기만 된다', async () => {
    const wrapper = await trainScreen(await irisProject(['knn', 'linear_regression']))
    await pickTaskType(wrapper, '회귀')
    const locked = rowOf(wrapper, 'knn')
    const open = rowOf(wrapper, 'linear_regression')
    expect(locked.text()).toContain(t('client.ALGORITHM_NOT_FOR_TASK_TYPE'))

    // 교정 워커가 말이 없어 예상은 "모름"이다 — 그래도 열린 줄에는 선다.
    expect(open.text()).toContain(t('train.estimateUnknown'))
    expect(locked.text()).not.toContain(t('train.estimateUnknown'))

    const knobs = locked.findAll('input[type="number"]')
    expect(knobs.length, 'knn has hyperparameters').toBeGreaterThan(0)
    for (const knob of knobs) expect(knob.attributes('readonly')).toBeDefined()

    // 되돌리면 풀린다.
    await pickTaskType(wrapper, '분류')
    for (const knob of rowOf(wrapper, 'knn').findAll('input[type="number"]')) {
      expect(knob.attributes('readonly')).toBeUndefined()
    }
    wrapper.unmount()
  })

  /**
   * **체크리스트도 학습에 넘어가는 모델로 센다** (R38-D55 B-2). 전부 잠긴 목록에 체크하면
   * [학습하기]는 잠겼는데 체크리스트는 끝냈다고 한다.
   */
  it('담은 모델이 전부 잠기면 체크리스트가 모델을 안 고른 것으로 센다', async () => {
    expect(factsOf(await irisProject(['linear_regression'])).algorithmsChosen).toBe(false)
    expect(factsOf(await irisProject(BOTH)).algorithmsChosen).toBe(true)
    // 유형이 없으면 아무것도 안 잠기므로 목록 그대로다.
    const file = await irisProject(['linear_regression'])
    const untyped = {
      ...file,
      document: { ...file.document, manifest: { ...file.document.manifest, taskType: undefined } },
    }
    expect(factsOf(untyped).algorithmsChosen).toBe(true)
  })

  /** **등록부에 없는 알고리즘은 거르지 않는다** — 남의 파일에서 온 것을 조용히 빼면 학생이 모른다. */
  it('등록부에 없는 알고리즘은 학습에 넘겨 실패로 말하게 한다', () => {
    const rows = [{ algorithm: 'someone_elses_model' }, { algorithm: 'linear_regression' }]
    expect(trainableSelections(rows, 'classification')).toEqual([rows[0]])
    expect(chosenModelBlocks(rows[0]!, 'classification')).toEqual([])
  })
})

// ------------------------------------------------------------------------------------ 2

describe('타깃을 골라도 특성 목록이 남는다', { timeout: 30_000 }, () => {
  /** 특성 넷을 다 고른 붓꽃. 타깃을 그중 하나로 옮겨 본다. */
  async function allFeatures(): Promise<ProjectFile> {
    const file = await irisProject([])
    return { ...file, document: withFeatures(file.document, [...IRIS_FEATURE_COLUMNS], NOW) }
  }

  it('학습 계획은 타깃과 같은 이름을 특성에서 뺀다 — 정답이 문제에 안 들어간다', async () => {
    const file = await allFeatures()
    const dataset = readDataset(file)!
    const document = withFeatures(file.document, [...IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN], NOW)
    const plan = planRun({
      dataset,
      testDataset: null,
      settings: document.settings,
      taskType: 'classification',
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const used = plan.preprocessor.columns.map((one) => one.name)
    expect(used).not.toContain(IRIS_TARGET_COLUMN)
    expect(used).toEqual([...IRIS_FEATURE_COLUMNS])
  })

  /** **군집에는 정답이 없다** — 저장된 타깃 이름은 어떤 열도 타깃으로 만들지 않으므로 거르지 않는다. */
  it('군집이면 저장된 타깃 이름의 열도 특성으로 쓴다', async () => {
    expect(featuresInUse(['a', 'species'], undefined)).toEqual(['a', 'species'])
    expect(featuresInUse(['a', 'species'], 'species')).toEqual(['a'])

    // **계획을 지나서도 그렇다** (R38-D55 N1) — 단위 검사만 있으면 계획이 군집에서도 거르게
    // 바꿔도 조용했다.
    const file = await allFeatures()
    const document = withFeatures(file.document, ['sepal_length', IRIS_TARGET_COLUMN], NOW)
    const plan = planRun({
      dataset: readDataset(file)!,
      testDataset: null,
      settings: {
        ...document.settings,
        selectedAlgorithms: [{ algorithm: 'k_means' }],
      },
      taskType: 'clustering',
    })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    const used = plan.preprocessor.columns.map((one) => one.name)
    expect(used).toContain(IRIS_TARGET_COLUMN)
  })

  it('실험 기록에는 쓴 특성만 남는다', async () => {
    const file = await allFeatures()
    const withTarget = {
      ...file,
      document: withFeatures(file.document, [...IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN], NOW),
    }
    const source = await trainingSourceOf({ project: withTarget, taskType: 'classification' })
    const snapshot = source.snapshot as { features: readonly string[] }
    expect(snapshot.features).toEqual([...IRIS_FEATURE_COLUMNS])
  })

  async function prepPanel(file: ProjectFile): Promise<VueWrapper> {
    await useProjectStore().save(file)
    const wrapper = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
    await settle()
    return wrapper
  }

  const radio = (wrapper: VueWrapper, name: string) =>
    wrapper.find(`input[type="radio"][aria-label="${name}"]`)
  const box = (wrapper: VueWrapper, name: string) =>
    wrapper.find(`input[type="checkbox"][aria-label="${name}"]`).element as HTMLInputElement

  it('특성인 열을 타깃으로 옮겼다 되돌리면 특성 칸이 켜진 채로 돌아온다', async () => {
    const wrapper = await prepPanel(await allFeatures())
    const features = () =>
      (useProjectStore().file?.document.settings.data as { features: readonly string[] }).features

    await radio(wrapper, 'petal_length').setValue()
    await settle()
    // 목록은 그대로고, 그 칸은 **켜진 채** 잠긴다 — 꺼진 것처럼 보이면 돌아온다는 것을 모른다.
    expect(features()).toEqual([...IRIS_FEATURE_COLUMNS])
    expect(box(wrapper, 'petal_length').checked).toBe(true)
    expect(box(wrapper, 'petal_length').disabled).toBe(true)

    await radio(wrapper, IRIS_TARGET_COLUMN).setValue()
    await settle()
    expect(features()).toEqual([...IRIS_FEATURE_COLUMNS])
    expect(box(wrapper, 'petal_length').checked).toBe(true)
    expect(box(wrapper, 'petal_length').disabled).toBe(false)
    wrapper.unmount()
  })

  /** **[전체 선택]도 다른 열을 고르는 동작이다** — 그것이 타깃으로 옮겨 간 열을 떨구면 안 된다. */
  it('타깃인 동안 [전체 선택]을 눌러도 그 이름이 목록에 남는다', async () => {
    const file = await allFeatures()
    const wrapper = await prepPanel(file)
    await radio(wrapper, 'petal_length').setValue()
    await settle()
    const selectAll = wrapper
      .findAll('button')
      .find((one) => one.text() === t('preprocess.tabular.selectAll'))
    expect(selectAll, 'select all').toBeDefined()
    await selectAll!.trigger('click')
    await settle()
    const features = (
      useProjectStore().file?.document.settings.data as { features: readonly string[] }
    ).features
    expect(features).toContain('petal_length')
    wrapper.unmount()
  })

  /**
   * **세는 자리도 학습이 쓰는 것으로 센다.** 특성이 타깃과 같은 이름 하나뿐이면 학습은 특성이
   * 없는 것이다 — 체크리스트가 "특성 고름"에 체크하고 요약이 "1개"라 하면 거짓이다.
   */
  it('특성이 타깃 이름 하나뿐이면 체크리스트와 요약이 고른 특성이 없다고 센다', async () => {
    const file = await irisProject([])
    const only = {
      ...file,
      document: withFeatures(file.document, [IRIS_TARGET_COLUMN], NOW),
    }
    expect(DATA_FACTS.tabular(only).featuresChosen).toBe(false)

    const summary = mount(TabularSummaryRows, {
      props: { file: only },
      global: { plugins: [i18n] },
    })
    const row = summary
      .findAll('div')
      .find(
        (one) => one.find('dt').exists() && one.find('dt').text() === t('meta.tabular.features'),
      )
    expect(row?.find('dd').text()).toBe(i18n.global.t('meta.countUnit', 0))
    summary.unmount()
  })

  /**
   * **특성 한 줄 요약도 학습이 쓰는 것으로 센다** (R38-D55 C-4). 목록 길이로 세면 타깃이 목록에
   * 남은 파일에서 *"5개 중 4개"*라고 한다 — 그 문장은 인코딩으로 빠진 열을 위한 것이다.
   */
  it('타깃이 목록에 남아 있어도 특성 요약이 뺄셈을 시키지 않는다', async () => {
    const file = await allFeatures()
    const wrapper = await prepPanel({
      ...file,
      document: withFeatures(file.document, [...IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN], NOW),
    })
    const all = IRIS_FEATURE_COLUMNS.length
    expect(wrapper.text()).toContain(i18n.global.t('preprocess.tabular.featureSummary', all))
    wrapper.unmount()
  })

  /**
   * **학습 화면의 예상 폭도 학습이 쓰는 특성으로 센다** (R38-D55 N12). 붓꽃의 `species`는 범주라
   * 원핫이면 세 칸이다 — 타깃을 안 빼면 넷이 일곱이 되어 예상 시간이 부푼다.
   */
  it('학습 화면의 예상 폭에 타깃이 안 들어간다', async () => {
    const file = await allFeatures()
    await saveProject({
      ...file,
      document: withFeatures(file.document, [...IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN], NOW),
    })
    const wrapper = mount(Host, { global: { plugins: [i18n, router] } })
    await router.push('/')
    await router.isReady()
    await router.push(`/project/${file.document.manifest.projectId}/train`)
    await settle()
    const view = wrapper.findComponent(TrainView).vm as unknown as { featureWidth: number }
    expect(view.featureWidth).toBe(IRIS_FEATURE_COLUMNS.length)
    wrapper.unmount()
  })

  it('타깃인 동안 다른 특성을 켜고 꺼도 그 이름이 목록에서 안 사라진다', async () => {
    const wrapper = await prepPanel(await allFeatures())
    await radio(wrapper, 'petal_length').setValue()
    await settle()
    await wrapper.find('input[type="checkbox"][aria-label="sepal_width"]').setValue(false)
    await settle()
    const features = (
      useProjectStore().file?.document.settings.data as { features: readonly string[] }
    ).features
    expect(features).toContain('petal_length')
    expect(features).not.toContain('sepal_width')
    wrapper.unmount()
  })
})

// ------------------------------------------------------------------------------------ 3

describe('층화가 막히면 잠기고 학습은 무시한다', { timeout: 30_000 }, () => {
  /**
   * **표본 수(A)가 층화(B)를 막는다.** 붓꽃 3품종 · 5행이면 품종마다의 바닥을 못 채운다.
   * 전에는 켜진 채로 학습이 거부했고 체크박스는 안 잠겼다 — 학생이 꺼야 했다.
   */
  it('켜진 채 잠기고, 이유가 보이고, 계획은 선다 — 표본 수를 되돌리면 풀린다', async () => {
    const file = await irisProject(['decision_tree'])
    const stratified = withSplit(file.document, { stratify: true }, NOW)
    await useProjectStore().save({ ...file, document: withSampling(stratified, 5, NOW) })
    const wrapper = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
    await settle()

    const stratify = () => {
      const label = wrapper
        .findAll('label')
        .find((one) => one.text().trim() === t('preprocess.stratify'))
      expect(label, 'stratify checkbox').toBeDefined()
      return label!.find('input[type="checkbox"]').element as HTMLInputElement
    }
    expect(stratify().checked).toBe(true)
    expect(stratify().disabled).toBe(true)
    // 이유 문장의 뒷부분 — 무엇을 하면 다시 적용되는지.
    expect(wrapper.text()).toContain('추출할 행 수를 늘리면 다시 적용됩니다')
    const vm = wrapper.vm as unknown as { runPlan: { ok: boolean } | null }
    expect(vm.runPlan?.ok).toBe(true)

    // 표본 수를 되돌리면 켜 두었던 대로 살아난다.
    useProjectStore().update((live) => ({
      ...live,
      document: withSampling(live.document, undefined, NOW),
    }))
    await settle()
    expect(stratify().checked).toBe(true)
    expect(stratify().disabled).toBe(false)
    wrapper.unmount()
  })

  /**
   * **따로 받은 테스트 데이터면 층화는 뽑기의 손잡이라 뽑기 카드에 선다** (R38-D55 B-6).
   * 그 갈래에서 ①이 접혀 체크박스가 사라졌는데 층화는 뽑기에 여전히 걸렸다 — 켜져 있는지도
   * 왜 잠겼는지도 학생이 몰랐다. 뽑기가 없으면 층화가 아무 일도 안 하므로 안 그린다.
   */
  /**
   * **①을 골라도 ②에서 읽어 둔 파일 초안이 남는다** (R38-D55 C-9). 전에는 ①을 누르는 순간
   * 초안을 버려서, ②로 돌아온 학생이 파일을 다시 골라야 했다. 파일을 읽는 것은 준비라 판의
   * 읽기 함수로 하고, 오가는 것은 라디오로 한다.
   */
  it('①을 골랐다 ②로 돌아오면 읽어 둔 테스트 파일이 그대로다', async () => {
    const file = await irisProject(['decision_tree'])
    await useProjectStore().save({
      ...file,
      document: { ...file.document, runs: { experiments: [] } },
    })
    const wrapper = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
    await settle()
    const radios = () => wrapper.findAll('input[name="test-data-choice"]')
    await radios()[1]!.trigger('change')
    await settle()
    const panel = wrapper.vm as unknown as {
      readTestFile: (file: File) => Promise<void>
      openedTest: { fileName: string } | null
    }
    const csv = `${[...IRIS_FEATURE_COLUMNS, IRIS_TARGET_COLUMN].join(',')}\n5.1,3.5,1.4,0.2,setosa\n`
    await panel.readTestFile(new File([csv], 'test.csv', { type: 'text/csv' }))
    await settle()
    expect(panel.openedTest?.fileName).toBe('test.csv')

    await radios()[0]!.trigger('change')
    await settle()
    await radios()[1]!.trigger('change')
    await settle()
    expect(panel.openedTest?.fileName).toBe('test.csv')
    expect(wrapper.text()).toContain('test.csv')
    wrapper.unmount()
  })

  it('따로 받은 테스트 데이터면 뽑기가 켜져 있을 때만 체크박스가 하나 선다', async () => {
    const file = await irisProject(['decision_tree'])
    const provided = withSplit(file.document, { method: 'provided', stratify: true }, NOW)
    const boxes = (wrapper: VueWrapper) =>
      wrapper.findAll('label').filter((one) => one.text().trim() === t('preprocess.stratify'))

    await useProjectStore().save({ ...file, document: provided })
    const plain = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
    await settle()
    expect(boxes(plain)).toHaveLength(0)
    plain.unmount()

    await useProjectStore().save({ ...file, document: withSampling(provided, 20, NOW) })
    const sampled = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
    await settle()
    expect(boxes(sampled)).toHaveLength(1)
    const box = boxes(sampled)[0]!.find('input[type="checkbox"]').element as HTMLInputElement
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(false)
    sampled.unmount()
  })
})

// ------------------------------------------------------------------------------------ 4 · 5

describe('시각화 창의 고른 값', () => {
  type Kind = 'numeric' | 'categorical'
  const column = (name: string, kind: Kind) => ({
    name,
    kind,
    missing: 0,
    unique: 0,
    samples: [] as string[],
  })

  function open(columns: ReturnType<typeof column>[], rows: string[][], first: string) {
    return mount(ChartDialog, {
      props: {
        open: true,
        kind: 'tabular' as const,
        dataset: { columns: columns.map((one) => one.name), rows },
        columns,
        column: first,
        randomState: 42,
      },
      global: { plugins: [i18n] },
    })
  }

  async function drawn(wrapper: VueWrapper): Promise<void> {
    await vi.waitFor(() => {
      if (
        !wrapper.findComponent({ name: 'Bar' }).exists() &&
        !wrapper.findComponent({ name: 'Scatter' }).exists()
      ) {
        throw new Error('chart not mounted yet')
      }
    }, WAIT_MS)
  }

  /** 지금 고른(강조된) 도구의 이름. */
  function pickedTool(wrapper: VueWrapper): string {
    const picked = wrapper
      .find('.grid')
      .findAll('button')
      .find((one) => one.classes().includes('bg-brand-soft'))
    return picked?.text() ?? ''
  }

  async function pickTool(wrapper: VueWrapper, key: string): Promise<void> {
    const button = wrapper
      .find('.grid')
      .findAll('button')
      .find((one) => one.text().startsWith(t(key)))
    expect(button, key).toBeDefined()
    await button!.trigger('click')
    await drawn(wrapper)
  }

  it('못 그리는 열을 지나갔다 돌아오면 고른 도구가 돌아온다', async () => {
    const columns = [column('a', 'numeric'), column('g', 'categorical')]
    const rows = Array.from({ length: 20 }, (_, i) => [String(i), i % 2 === 0 ? '남' : '여'])
    const wrapper = open(columns, rows, 'a')
    await drawn(wrapper)

    await pickTool(wrapper, 'data.charts.box.name')
    expect(pickedTool(wrapper)).toContain(t('data.charts.box.name'))

    // 범주 열에서는 박스 플롯을 못 그린다 — 다른 도구로 그린다.
    await wrapper.setProps({ column: 'g' })
    await drawn(wrapper)
    expect(pickedTool(wrapper)).not.toContain(t('data.charts.box.name'))

    await wrapper.setProps({ column: 'a' })
    await drawn(wrapper)
    expect(pickedTool(wrapper)).toContain(t('data.charts.box.name'))
  })

  it('가로축이 고른 세로축과 같아졌다 돌아오면 고른 세로축이 돌아온다', async () => {
    const columns = [column('x', 'numeric'), column('y', 'numeric'), column('z', 'numeric')]
    const rows = Array.from({ length: 20 }, (_, i) => [String(i), String(i * 2), String(i * 3)])
    const wrapper = open(columns, rows, 'x')
    await drawn(wrapper)
    await pickTool(wrapper, 'data.charts.scatter.name')

    const yAxis = () => {
      const label = wrapper
        .findAll('label')
        .find((one) => one.text().startsWith(t('data.charts.scatter.yAxis')))
      expect(label, 'y axis').toBeDefined()
      return label!.find('select')
    }
    await yAxis().setValue('z')
    expect((yAxis().element as HTMLSelectElement).value).toBe('z')

    // 가로축을 z로 — 자기 자신과는 못 그리므로 다른 세로축으로 그린다.
    await wrapper.setProps({ column: 'z' })
    await drawn(wrapper)
    expect((yAxis().element as HTMLSelectElement).value).not.toBe('z')

    await wrapper.setProps({ column: 'x' })
    await drawn(wrapper)
    expect((yAxis().element as HTMLSelectElement).value).toBe('z')
  })
})

// 이 파일이 쓰지 않는 문은 없다 — 유형을 바꾸는 문도 모델을 안 건드리는지 한 번 더 본다.
describe('문 하나는 제 필드만 쓴다', () => {
  it('withTaskType은 모델 선택을 안 건드린다', async () => {
    const file = await irisProject(['logistic_regression', 'linear_regression'])
    const next = withTaskType(file.document, 'regression', NOW)
    expect(next.settings).toEqual(file.document.settings)
  })
})
