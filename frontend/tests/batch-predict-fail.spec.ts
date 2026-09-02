// @vitest-environment jsdom
/**
 * **파일 예측 판의 실패 경로.** 붙이기가 거절될 때 판이 어떻게 되는가.
 *
 * **이 화면의 B-1 자리는 소스만 고쳐지고 재현 검사가 없었다** (2026-09-02 R23 재감사 B-2) —
 * 세 자리 중 유일한 무검사였고, `clearIfHeld`를 성공 뒤로 되돌려도 131개 파일이 초록이었다.
 *
 * **갈래가 둘이라는 것이 이 파일의 요점이다** (§8.10.4): 저장이 쿼터로 거절되면 정본은
 * 이미 앉았으므로 판을 접고, **개정 함수가 스스로 던지면 아무것도 안 앉았으므로 남긴다.**
 * 뒤엣것이 R23 재감사 B-1이다 — 열이 없는 파일을 붙이면 판이 사라져 학생이 시트나
 * 머리글을 고칠 자리를 잃었다.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ClientError } from '../src/errors'
import { i18n, setLocale } from '../src/i18n'
import type { PredictableModel, PredictionField } from '../src/ml/predict'
import type { Preprocessor } from '../src/ml/preprocess'
import type { ProjectFile } from '../src/project/format'
import { dataSettings } from '../src/project/schema'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import BatchPredict from '../src/views/predict/BatchPredict.vue'
import { dropEvent, stubDialogElement } from './fixtures/image-workers'
import { experiment, projectFile, run } from './fixtures/project'

const gate = vi.hoisted(() => ({ failSave: false }))

vi.mock('../src/project/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/storage')>()
  return {
    ...actual,
    saveProject: async (file: ProjectFile) => {
      if (gate.failSave) {
        throw new ClientError('STORAGE_QUOTA_EXCEEDED', { requiredMb: 9, availableMb: 1 })
      }
      return actual.saveProject(file)
    },
  }
})

vi.mock('../src/ml/predict', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/ml/predict')>()
  return {
    ...original,
    predictPage: (models: readonly PredictableModel[], rows: readonly unknown[]) =>
      rows.map(() => models.map((model) => ({ value: model.run.id }))),
  }
})

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

async function settle(): Promise<void> {
  for (let round = 0; round < 2; round += 1) {
    await flushPromises()
    await tick()
    await flushPromises()
  }
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}

interface PanelInternals {
  busy: boolean
  opened: { fileName: string } | null
  apply: () => Promise<void>
}

function csv(name: string, header = 'a,b'): File {
  return new File([`${header}\n1,2\n3,4\n`], name, { type: 'text/csv' })
}

const A: PredictableModel = {
  experiment: experiment('experiment-1', []),
  run: run('run-A', { algorithm: 'decision_tree' }),
}
const preprocessors = new Map<string, Preprocessor>([
  ['experiment-1', { columns: [] } as unknown as Preprocessor],
])

beforeEach(async () => {
  setActivePinia(createPinia())
  gate.failSave = false
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  await setLocale('ko')
})

afterEach(async () => {
  closeStorage()
  await deleteDatabase()
})

const dangers = () => useToastStore().items.filter((one) => one.tone === 'danger')

async function panelWithFile(fields: readonly PredictionField[] = []) {
  const project = useProjectStore()
  await project.save(projectFile())
  const wrapper = mount(BatchPredict, {
    props: { models: [A], preprocessors, dataset: null, fields, experimentNames: new Map() },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  const panel = wrapper.vm as unknown as PanelInternals
  wrapper.find('[class*="border-dashed"]').element.dispatchEvent(dropEvent([csv('first.csv')]))
  await settle()
  expect(panel.opened?.fileName).toBe('first.csv')
  return { project, wrapper, panel }
}

describe('R23: the save is refused by quota', () => {
  it('takes the draft off the bar and tells', async () => {
    const { project, panel } = await panelWithFile()
    gate.failSave = true
    await panel.apply()
    await settle()
    const applied = project.file
      ? dataSettings('tabular', project.file.document.settings).predictDataset?.originalFileName
      : undefined
    expect(applied).toBe('first.csv')
    expect(panel.opened).toBeNull()
    expect(panel.busy).toBe(false)
    expect(dangers().map((one) => one.key)).toEqual(['client.STORAGE_QUOTA_EXCEEDED'])
  })
})

describe('R23: the revision itself refuses (nothing seated)', () => {
  /**
   * **아무것도 안 앉았으면 판이 남아야 한다** (2026-09-02 R23 재감사 B-1).
   *
   * `applyPredictDataset`은 **필요한 열이 없으면 던진다.** 스토어는 개정 함수가 던지면
   * `file.value`를 안 바꾸므로 그때는 앉은 것이 없다 — 그런데 함수 전체를 `finally`로
   * 두르면 판까지 접혀, 학생은 시트나 머리글을 고칠 자리를 잃고 파일을 다시 고른다.
   */
  it('a file missing a required column keeps the draft on the bar', async () => {
    const { project, panel } = await panelWithFile([{ name: 'zzz', kind: 'numeric' }])
    await panel.apply()
    await settle()
    const applied = project.file
      ? dataSettings('tabular', project.file.document.settings).predictDataset?.originalFileName
      : undefined

    expect(panel.busy).toBe(false)
    expect(applied).toBeUndefined()
    expect(panel.opened?.fileName).toBe('first.csv')
    expect(dangers().map((one) => one.key)).toEqual(['client.PREDICT_DATASET_COLUMN_MISSING'])
  })
})
