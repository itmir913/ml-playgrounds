// @vitest-environment jsdom
/**
 * **표 전처리 판의 실패 경로와 확인 문턱.**
 *
 * **이 판을 띄우는 스펙이 0이었다** (2026-09-02 R24 B-2). `grep -l TabularPrepPanel
 * tests/`가 `ui-rules.spec.ts` 하나였고 그것은 글자 규칙이라, async 핸들러 셋이
 * **뭉개도 전부 초록**이었다.
 *
 * 여기서 재는 것은 셋이다.
 *
 * - **잠금이 풀리는가** — 깨진 파일 한 번에 [파일 선택]이 "읽는 중"으로 영영 꺼지면
 *   학생에게 남는 길은 새로고침뿐이다.
 * - **묻고 지우는가** — "실험 N개가 사라집니다"의 문턱은 **화면에만 있다.** 순수 함수
 *   쪽 검사는 지우는 것을 재지 묻는 것을 안 잰다.
 * - **실패해도 고른 파일이 남는가** — 쿼터가 거절했는데 판까지 비면 학생은 파일을
 *   다시 고른다.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ClientError } from '../src/errors'
import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import TabularPrepPanel from '../src/views/preprocess/TabularPrepPanel.vue'
import { stubDialogElement } from './fixtures/image-workers'
import { projectFile } from './fixtures/project'

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

/** 이 판의 안쪽. **띄우지 않으면 이 셋이 전부 안 보인다** — 그래서 R24까지 조용했다. */
interface PrepInternals {
  testBusy: boolean
  testAttaching: boolean
  testRemoving: boolean
  openedTest: { fileName: string } | null
  readTestFile: (file: File) => Promise<void>
  requestApplyTest: () => Promise<void>
  requestRemoveTest: () => Promise<void>
  applyTest: () => Promise<void>
}

/**
 * 테스트용 표. **열 이름이 훈련 표와 같아야 한다** — 다르면 `TEST_DATASET_COLUMN_MISSING`
 * 으로 되돌려진다.
 */
function csv(name: string): File {
  return new File(['꽃받침,품종\n5.1,setosa\n6.0,virginica\n'], name, {
    type: 'text/csv',
  })
}

/** 실험이 없는 표 프로젝트. **문턱 검사의 반대쪽이다.** */
function withoutExperiments(): ProjectFile {
  const file = projectFile()
  return { ...file, document: { ...file.document, runs: { experiments: [] } } }
}

async function openPanel(file: ProjectFile): Promise<{
  panel: PrepInternals
  wrapper: ReturnType<typeof mount>
}> {
  const project = useProjectStore()
  await project.save(file)
  const wrapper = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
  await flushPromises()
  // "②"를 고른다 — 파일 받는 자리는 그 뒤에야 그려진다.
  const radios = wrapper.findAll('input[name="test-data-choice"]')
  expect(radios.length).toBeGreaterThan(1)
  await radios[radios.length - 1]?.trigger('change')
  await flushPromises()
  return { panel: wrapper.vm as unknown as PrepInternals, wrapper }
}

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

describe('R24 B-2a: the test file cannot be read', () => {
  it('garbage bytes: unlocks and tells', async () => {
    const { panel } = await openPanel(withoutExperiments())
    await panel.readTestFile(new File([new Uint8Array([0, 255, 1])], 'broken.xlsx'))
    await settle()

    expect(panel.testBusy).toBe(false)
    expect(panel.openedTest).toBeNull()
    expect(dangers()).toHaveLength(1)
  })

  it('the disk refuses the read: unlocks and tells', async () => {
    const { panel } = await openPanel(withoutExperiments())
    const bad = csv('bad.csv')
    Object.defineProperty(bad, 'arrayBuffer', {
      value: async () => {
        throw new DOMException('read failed', 'NotReadableError')
      },
    })
    await panel.readTestFile(bad)
    await settle()

    expect(panel.testBusy).toBe(false)
    expect(panel.openedTest).toBeNull()
    expect(dangers()).toHaveLength(1)
  })
})

/**
 * **묻는 문턱은 화면에만 있다** (R24 B-2b). `applyTestDataset`이 실험을 전부 지우는
 * 것은 순수 함수 검사가 물지만, **묻는지는 여기서만 보인다** — 문턱을 `> 1`로 뭉개면
 * 실험 하나가 확인 없이 사라진다.
 */
describe('R24 B-2b: the confirmation threshold', () => {
  it('one experiment is enough to ask before attaching', async () => {
    const project = useProjectStore()
    const { panel } = await openPanel(projectFile())
    expect(project.file?.document.runs.experiments).toHaveLength(1)

    await panel.readTestFile(csv('test.csv'))
    await settle()
    expect(panel.openedTest?.fileName).toBe('test.csv')

    await panel.requestApplyTest()
    await settle()

    expect(panel.testAttaching).toBe(true)
    // 아직 아무것도 안 붙었다 — 물어보고 끝났다.
    expect(project.file?.document.settings.data.testDataset).toBeUndefined()
    expect(project.file?.document.runs.experiments).toHaveLength(1)
  })

  it('one experiment is enough to ask before removing', async () => {
    const project = useProjectStore()
    const { panel } = await openPanel(projectFile())

    await panel.requestRemoveTest()
    await settle()

    expect(panel.testRemoving).toBe(true)
    expect(project.file?.document.runs.experiments).toHaveLength(1)
  })

  it('no experiment: attaching goes straight through without asking', async () => {
    const project = useProjectStore()
    const { panel } = await openPanel(withoutExperiments())

    await panel.readTestFile(csv('test.csv'))
    await settle()
    await panel.requestApplyTest()
    await settle()

    expect(panel.testAttaching).toBe(false)
    expect(project.file?.document.settings.data.testDataset).toBeDefined()
    expect(panel.openedTest).toBeNull()
  })
})

/**
 * **거절당하면 고른 파일이 남아 있어야 한다** (R24 B-2c). 비우는 줄이 `await` 앞으로
 * 가면 쿼터 거절 뒤 학생이 파일을 처음부터 다시 고른다.
 */
describe('R24 B-2c: the save is refused by quota', () => {
  it('keeps the chosen file on the bar and unlocks', async () => {
    const { panel } = await openPanel(withoutExperiments())
    await panel.readTestFile(csv('test.csv'))
    await settle()
    expect(panel.openedTest?.fileName).toBe('test.csv')

    gate.failSave = true
    await panel.applyTest()
    await settle()

    expect(panel.openedTest?.fileName).toBe('test.csv')
    expect(panel.testBusy).toBe(false)
    // 경고창은 성공이든 실패든 접힌다 — 안 접으면 실패 알림이 그 아래에 깔린다.
    expect(panel.testAttaching).toBe(false)
    expect(dangers()).toHaveLength(1)
  })
})
