// @vitest-environment jsdom
/**
 * **학습 화면이 전처리 판과 같은 열 종류를 말하는가.** 학습 화면의 세 자리 — 타깃
 * 경고(`targetIssue`) · 머리의 특성 수(`TabularTrainContext`) · 예상 시간의 폭(`featureWidth`) —
 * 는 전처리 판과 같은 덮기(`plannedColumns`)를 지나 **계획의 종류**로 말한다.
 *
 * **같은 입력을 두 화면에 태워 나란히 단언한다** (`fixtures/prep-kind.ts`). 한쪽만 보면
 * 둘이 함께 틀려도 초록이다. 학습 화면은 **진짜 라우터로** 처음부터 띄운다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { RouterView } from 'vue-router'

/** 기기 교정 일감이 뜨지만 이 검사의 주제가 아니다 — 답하지 않는 워커. */
vi.mock('../src/ml/worker/spawn', () => ({
  spawnTrainingWorker: () => ({
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage() {},
    terminate() {},
  }),
}))

import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { closeStorage, DB_NAME, saveProject } from '../src/project/storage'
import { tabularPlanOf } from '../src/ml/plan-cache'
import { router } from '../src/router'
import TabularPrepPanel from '../src/views/preprocess/TabularPrepPanel.vue'
import TrainView from '../src/views/TrainView.vue'
import TabularTrainContext from '../src/views/train/TabularTrainContext.vue'
import { stubDialogElement } from './fixtures/image-workers'
import { scoreProject, surveyCsv, surveyProject, tabularProjectFrom } from './fixtures/prep-kind'

const Host = defineComponent({ render: () => h(RouterView) })

const NOT_NUMERIC = '타깃 열에는 숫자가 아닌 값이 있습니다'

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

beforeEach(async () => {
  setActivePinia(createPinia())
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  window.scrollTo = () => {}
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

interface Sides {
  prep: {
    usableFeatures: number | undefined
    targetIssue: string | undefined
    reds: number
    ok: boolean | undefined
  }
  train: {
    usableFeatures: number
    featureWidth: number
    targetIssue: string | null
    reds: number
  }
}

/**
 * 학습 화면을 진짜 라우터로 띄우고, **같은 스토어**에 전처리 판을 붙여 둘의 말을 모은다.
 * 전처리 판의 빨강은 타깃 줄과 요약 카드 둘에 서므로 학습 화면과 수가 다르다 — 견주는 것은
 * **있냐 없냐**다.
 */
async function bothScreens(file: ProjectFile, target: string): Promise<Sides> {
  await saveProject(file)
  const host = mount(Host, { global: { plugins: [i18n, router] } })
  await router.push('/')
  await router.isReady()
  await router.push(`/project/${file.document.manifest.projectId}/train`)
  await settle()

  const train = host.findComponent(TrainView)
  const context = host.findComponent(TabularTrainContext)
  expect(train.exists()).toBe(true)
  expect(context.exists()).toBe(true)
  const trainVm = train.vm as unknown as { featureWidth: number; targetIssue: string | null }
  const contextVm = context.vm as unknown as { usableFeatures: number }

  const prep = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
  await settle()
  const prepVm = prep.vm as unknown as {
    runPlan: { ok: boolean } | null
    plan: {
      usableFeatures: number
      columns: readonly { summary: { name: string }; targetIssue?: string }[]
    } | null
  }

  const sides: Sides = {
    prep: {
      usableFeatures: prepVm.plan?.usableFeatures,
      targetIssue: prepVm.plan?.columns.find((one) => one.summary.name === target)?.targetIssue,
      reds: prep.text().split(NOT_NUMERIC).length - 1,
      ok: prepVm.runPlan?.ok,
    },
    train: {
      usableFeatures: contextVm.usableFeatures,
      featureWidth: trainVm.featureWidth,
      targetIssue: trainVm.targetIssue,
      reds: host.text().split(NOT_NUMERIC).length - 1,
    },
  }
  prep.unmount()
  host.unmount()
  return sides
}

describe('학습 화면과 전처리 판이 같은 특성 수를 말한다', { timeout: 30_000 }, () => {
  /**
   * `모름` 행의 타깃이 비어 실행에서 빠지면 `키`는 수치다 — 인코딩을 꺼도 특성 둘이 다
   * 들어간다. 두 화면 다 그 수를 말한다.
   */
  it('글자가 실행에서 빠지면 두 화면 다 특성 2개이고 폭도 2다', async () => {
    const { prep, train } = await bothScreens(await surveyProject(true), '성별')

    expect(prep.usableFeatures).toBe(2)
    expect(train.usableFeatures).toBe(prep.usableFeatures)
    // 예상 시간이 곱하는 폭 — 인코딩이 꺼져 있으니 수치 열 하나가 한 칸이다.
    expect(train.featureWidth).toBe(2)
  })

  /** 대조 — 글자가 실행에 들어가면 두 화면 다 1이다. 덮기가 옳은 감소를 안 지운다. */
  it('글자가 실행에 들어가면 두 화면 다 특성 1개이고 폭도 1이다', async () => {
    const { prep, train } = await bothScreens(await surveyProject(false), '성별')

    expect(prep.usableFeatures).toBe(1)
    expect(train.usableFeatures).toBe(prep.usableFeatures)
    expect(train.featureWidth).toBe(1)
  })
})

/**
 * **예상 시간의 행 수는 계획의 훈련 행 수다.** 군집은 나누지 않고(`trainShare`) 타깃을 안
 * 본다(`TRAINING_ROW_COUNTS`) — `blankTarget`이면 타깃이 빈 행이 하나 있는데 군집은 그 행도 쓴다.
 */
describe('예상 시간의 행 수가 계획의 훈련 행 수와 같다', { timeout: 30_000 }, () => {
  it.each([false, true])('군집이면 쓸 수 있는 행 전부로 센다 (blankTarget: %s)', async (blank) => {
    const file = await tabularProjectFrom(surveyCsv(blank), '설문.csv', {
      taskType: 'clustering',
      target: '성별',
      features: ['몸무게'],
      preprocessing: {},
    })
    await saveProject(file)
    const host = mount(Host, { global: { plugins: [i18n, router] } })
    await router.push('/')
    await router.isReady()
    await router.push(`/project/${file.document.manifest.projectId}/train`)
    await settle()

    const train = host.findComponent(TrainView).vm as unknown as { trainingRows: number }
    const plan = tabularPlanOf(file)
    if (!plan?.ok) throw new Error('the clustering plan must stand')
    // 40행 전부 `몸무게`가 있다 — 군집은 타깃을 안 보므로 빠지는 행이 없다.
    expect(plan.split.trainIndices).toHaveLength(40)
    expect(train.trainingRows).toBe(plan.split.trainIndices.length)
    host.unmount()
  })
})

describe('학습 화면과 전처리 판이 같은 타깃 판정을 말한다', { timeout: 30_000 }, () => {
  /**
   * 글자가 `drop`으로 빠지는 행에만 있으면 계획은 선다 — 두 화면 다 빨강이 없다.
   * **`drop`은 새 프로젝트의 기본값이다.**
   */
  it('글자가 drop으로 빠지는 행에만 있으면 두 화면 다 조용하다', async () => {
    const { prep, train } = await bothScreens(await scoreProject(true, 'drop'), '점수')

    expect(prep.ok).toBe(true)
    expect(prep.targetIssue).toBeUndefined()
    expect(prep.reds).toBe(0)
    expect(train.targetIssue).toBeNull()
    expect(train.reds).toBe(0)
  })

  /** 대조 — 글자 행이 실행에 들어가면 두 화면 다 빨갛다. */
  it('글자 행이 실행에 들어가면 두 화면 다 거부를 말한다', async () => {
    const { prep, train } = await bothScreens(await scoreProject(false, 'drop'), '점수')

    expect(prep.targetIssue).toBe('TARGET_NOT_NUMERIC')
    expect(prep.reds).toBeGreaterThan(0)
    expect(train.targetIssue).not.toBeNull()
    expect(train.reds).toBeGreaterThan(0)
  })
})
