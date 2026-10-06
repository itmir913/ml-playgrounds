// @vitest-environment jsdom
/**
 * **데이터를 교체하면 함께 잃는 것을 묻고 알린다** (`project/dataset.ts`의 `replaceLosses`).
 *
 * 교체는 실험만 지우는 것이 아니다 — 따로 불러온 테스트 데이터를 해제하고 분할을 `holdout`으로
 * 되돌리며, 예측할 파일도 삭제한다(mlpx-spec.md §1 "함께 있고 함께 없다"). 확인 조건이 실험 수
 * 하나였을 때는 학습 전에 테스트 데이터를 붙인 학생이 훈련 파일을 고쳐 다시 올리면 **확인 창도
 * 알림도 없이** 그 둘이 사라졌다 (2026-09-28 감사 E A1).
 *
 * 순수 판정을 먼저 재고, 그다음 **진짜 입구**로 판을 띄워 drop → `requestApply`를 지난다.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { importTable, openTable, type ImportedTable } from '../src/data/table'
import { i18n, setLocale } from '../src/i18n'
import { newProjectDocument } from '../src/project/create'
import {
  applyDataset,
  applyPredictDataset,
  applyTestDataset,
  needsReplaceConfirm,
  replaceLosses,
} from '../src/project/dataset'
import type { ProjectFile } from '../src/project/format'
import { closeStorage } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import TabularPanel from '../src/views/data/TabularPanel.vue'
import { dropEvent, stubDialogElement } from './fixtures/image-workers'
import { trainedIrisProject } from './fixtures/trained'
import { resetDatabase } from './fixtures/database'

const NOW = '2026-09-28T00:00:00.000Z'

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function settle(): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    await flushPromises()
    await tick()
    await flushPromises()
  }
}

function emptyTabularProject(): ProjectFile {
  const document = newProjectDocument(
    { name: '표 프로젝트', locale: 'ko', dataType: 'tabular' },
    {
      projectId: '550e8400-e29b-41d4-a716-446655440000',
      createdAt: '2026-09-02T08:00:00.000Z',
      randomState: 42,
    },
  )
  return {
    document,
    models: new Map(),
    images: new Map(),
    attachments: new Map(),
    embeddings: new Map(),
  }
}

async function imported(text: string): Promise<ImportedTable> {
  return importTable(await openTable(new TextEncoder().encode(text), 'x.csv', { locale: 'ko' }))
}

/** 훈련 데이터 + 타깃 + (선택) 테스트 데이터 + (선택) 예측할 파일. 실험은 0개다. */
async function projectWith(parts: { test?: boolean; predict?: boolean }): Promise<ProjectFile> {
  let file = applyDataset(emptyTabularProject(), await imported('a,b\n1,2\n3,4\n5,6\n'), {
    fileName: 'train.csv',
    hasHeader: true,
    now: NOW,
  }).project
  file = {
    ...file,
    document: {
      ...file.document,
      settings: {
        ...file.document.settings,
        data: { ...file.document.settings.data, target: 'b', features: ['a'] },
      },
    },
  }
  if (parts.test) {
    file = applyTestDataset(file, await imported('a,b\n7,8\n9,10\n'), {
      fileName: 'test.csv',
      hasHeader: true,
      now: NOW,
    }).project
  }
  if (parts.predict) {
    file = applyPredictDataset(file, await imported('a\n11\n12\n'), {
      fileName: 'predict.csv',
      hasHeader: true,
      now: NOW,
      requiredColumns: ['a'],
    }).project
  }
  return file
}

beforeEach(async () => {
  setActivePinia(createPinia())
  closeStorage()
  await resetDatabase()
  stubDialogElement()
  await setLocale('ko')
})

afterEach(async () => {
  closeStorage()
  await resetDatabase()
})

describe('replaceLosses — 교체로 잃는 것', () => {
  it('데이터만 있으면 잃을 것이 없고 묻지 않는다', async () => {
    const losses = replaceLosses(await projectWith({}))
    expect(losses).toEqual({ experiments: 0, testFile: null, predictFile: null })
    expect(needsReplaceConfirm(losses)).toBe(false)
  })

  it('실험이 0개여도 테스트 데이터가 있으면 묻는다', async () => {
    const losses = replaceLosses(await projectWith({ test: true }))
    expect(losses.testFile).toBe('test.csv')
    expect(needsReplaceConfirm(losses)).toBe(true)
  })

  it('실험이 0개여도 예측할 파일이 있으면 묻는다', async () => {
    const losses = replaceLosses(await projectWith({ predict: true }))
    expect(losses.predictFile).toBe('predict.csv')
    expect(needsReplaceConfirm(losses)).toBe(true)
  })

  it('applyDataset이 뗀 것을 이름으로 알린다', async () => {
    const applied = applyDataset(
      await projectWith({ test: true, predict: true }),
      await imported('a,b\n1,2\n3,4\n5,60\n'),
      { fileName: 'train.csv', hasHeader: true, now: NOW },
    )
    expect(applied.droppedTestFile).toBe('test.csv')
    expect(applied.droppedPredictFile).toBe('predict.csv')
    expect(applied.project.document.settings.split.method).toBe('holdout')
  })

  /** 테스트·예측 파일 없이 실험만 있을 때 — 고치기 전에도 묻던 갈래가 살아 있다. */
  it('실험만 있으면(테스트·예측 파일 없이) 묻는다', async () => {
    const losses = replaceLosses(await trainedIrisProject())
    expect(losses.experiments).toBeGreaterThan(0)
    expect(losses.testFile).toBeNull()
    expect(losses.predictFile).toBeNull()
    expect(needsReplaceConfirm(losses)).toBe(true)
  })

  it('뗄 것이 없으면 null이다', async () => {
    const applied = applyDataset(await projectWith({}), await imported('a,b\n1,2\n'), {
      fileName: 'train.csv',
      hasHeader: true,
      now: NOW,
    })
    expect(applied.droppedTestFile).toBeNull()
    expect(applied.droppedPredictFile).toBeNull()
  })
})

interface PanelInternals {
  confirming: boolean
  requestApply: () => Promise<void>
  apply: () => Promise<void>
}

async function mountWith(file: ProjectFile): Promise<{
  panel: PanelInternals
  wrapper: ReturnType<typeof mount>
}> {
  await useProjectStore().save(file)
  const wrapper = mount(TabularPanel, { props: { accept: '.csv' }, global: { plugins: [i18n] } })
  await flushPromises()
  // 학생이 훈련 파일의 오타 하나를 고쳐 다시 올린다 — 열은 그대로다.
  wrapper
    .find('[class*="min-h-full"]')
    .element.dispatchEvent(
      dropEvent([new File(['a,b\n1,2\n3,4\n5,60\n'], 'train.csv', { type: 'text/csv' })]),
    )
  await settle()
  return { panel: wrapper.vm as unknown as PanelInternals, wrapper }
}

describe('TabularPanel — 진짜 입구', () => {
  it('실험이 0개여도 테스트 데이터가 있으면 묻고, 묻는 창이 파일 이름을 댄다', async () => {
    const { panel, wrapper } = await mountWith(await projectWith({ test: true, predict: true }))
    await panel.requestApply()
    await settle()

    expect(panel.confirming, 'must ask before detaching the test data').toBe(true)
    // 아직 아무것도 안 바뀌었다.
    expect(useProjectStore().file?.document.settings.split.method).toBe('provided')
    const text = wrapper.text()
    expect(text).toContain(
      '별도 테스트 데이터가 해제되고, 사용 가능한 데이터의 일부를 테스트 데이터로 사용합니다. (test.csv)',
    )
    expect(text).toContain('예측할 파일이 함께 삭제됩니다. (predict.csv)')
    // 실험이 0개면 그 문장은 서지 않는다.
    expect(text).not.toContain('실험(Experiment)')
  })

  it('확인하고 교체하면 뗀 것마다 알린다', async () => {
    const { panel } = await mountWith(await projectWith({ test: true, predict: true }))
    await panel.requestApply()
    await settle()
    await panel.apply()
    await settle()

    const file = useProjectStore().file
    expect(file?.testDataset).toBeUndefined()
    expect(file?.predictDataset).toBeUndefined()
    const cautions = useToastStore()
      .items.filter((one) => one.tone === 'caution')
      .map((one) => [one.key, one.params])
    expect(cautions).toEqual([
      ['data.tabular.droppedTest', { fileName: 'test.csv' }],
      ['data.tabular.droppedPredict', { fileName: 'predict.csv' }],
    ])
  })

  it('실험만 있으면(테스트·예측 파일 없이) 묻고, 실험 문장만 선다', async () => {
    const { panel, wrapper } = await mountWith(await trainedIrisProject())
    await panel.requestApply()
    await settle()

    expect(panel.confirming, 'must ask before deleting experiments').toBe(true)
    expect(useProjectStore().file?.document.runs.experiments.length).toBeGreaterThan(0)
    const text = wrapper.text()
    expect(text).toContain('실험(Experiment)')
    expect(text).not.toContain('(test.csv)')
    expect(text).not.toContain('(predict.csv)')
  })

  it('잃을 것이 없으면 묻지 않고 바로 교체한다', async () => {
    const { panel } = await mountWith(await projectWith({}))
    await panel.requestApply()
    await settle()

    expect(panel.confirming).toBe(false)
    expect(useToastStore().items.filter((one) => one.tone === 'caution')).toEqual([])
  })
})
