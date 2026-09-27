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
import { hashBytes } from '../src/hash'
import { i18n, setLocale } from '../src/i18n'
import type { ProjectFile } from '../src/project/format'
import { MISSING_STRATEGIES } from '../src/project/schema'
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
 * **[따로 받은 테스트 데이터]는 타깃 전에도 고를 수 있고, 확정할 때 알린다**
 * (`open-decisions.md` 65 ①). 라디오를 잠그던 때는 이 길에 닿을 수 없었다 — 잠금을 풀었으니
 * 확정이 **조용하면 안 된다.** 거절은 `applyTestDataset` 한 자리다.
 */
describe('decision 65 ①: provided test data before a target is chosen', () => {
  function withoutTarget(): ProjectFile {
    const file = withoutExperiments()
    const data: Record<string, unknown> = { ...file.document.settings.data }
    delete data['target']
    return {
      ...file,
      document: {
        ...file.document,
        settings: {
          ...file.document.settings,
          data: data as ProjectFile['document']['settings']['data'],
        },
      },
    }
  }

  it('the radio is not locked, and confirming tells why and keeps the file', async () => {
    const project = useProjectStore()
    const { panel, wrapper } = await openPanel(withoutTarget())
    expect(project.file?.document.settings.data).not.toHaveProperty('target')

    const provided = wrapper.findAll('input[name="test-data-choice"]').at(-1)
    expect(provided?.attributes('disabled')).toBeUndefined()
    expect((provided?.element as HTMLInputElement | undefined)?.checked).toBe(true)

    await panel.readTestFile(csv('test.csv'))
    await settle()
    expect(panel.openedTest?.fileName).toBe('test.csv')

    await panel.requestApplyTest()
    await settle()

    expect(dangers().map((one) => one.key)).toEqual(['errors.TARGET_NOT_SELECTED'])
    expect(project.file?.document.settings.data.testDataset).toBeUndefined()
    expect(panel.openedTest?.fileName).toBe('test.csv')
    expect(panel.testBusy).toBe(false)
  })

  /**
   * **실험이 있으면 "실험이 지워진다"를 묻기 전에 거절한다** (결정문 65 "구조 뒤 감사에서 더한 것",
   * 사진 쪽 `refusedTest`와 같은 순서). 전에는 지울지 묻고, 학생이 [확인]을 누른 뒤에야 거절했다.
   */
  it('with experiments, the refusal comes before the "experiments will be cleared" dialog', async () => {
    const project = useProjectStore()
    const targetless = withoutTarget()
    const withRuns = projectFile()
    const { panel } = await openPanel({
      ...targetless,
      document: { ...targetless.document, runs: withRuns.document.runs },
    })
    expect(project.file?.document.runs.experiments.length).toBeGreaterThan(0)

    await panel.readTestFile(csv('test.csv'))
    await settle()
    await panel.requestApplyTest()
    await settle()

    expect(panel.testAttaching, 'the clear-experiments dialog opened first').toBe(false)
    expect(dangers().map((one) => one.key)).toEqual(['errors.TARGET_NOT_SELECTED'])
    expect(project.file?.document.runs.experiments.length).toBeGreaterThan(0)
    expect(panel.openedTest?.fileName).toBe('test.csv')
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

/**
 * 결측이 든 표 프로젝트. `몸무게` 한 칸이 비었고 **이미 특성으로 켜져 있다.** 교실에서 흔한
 * 순서다 — [전체 선택] 뒤에 결측 처리를 바꾼다.
 */
function withMissingFeature(
  overrides: { target?: string | undefined; taskType?: 'classification' | 'clustering' } = {},
): ProjectFile {
  const file = withoutExperiments()
  const bytes = new TextEncoder().encode('키,몸무게,품종\n150,40,a\n151,,b\n152,42,a\n153,43,b\n')
  const data: Record<string, unknown> = {
    ...file.document.settings.data,
    dataset: {
      path: 'dataset/data.csv',
      originalFileName: 'data.csv',
      hasHeader: true,
      encoding: 'utf-8',
    },
    features: ['키', '몸무게'],
    target: '품종',
    preprocessing: { missing: 'drop', scaling: 'none', categoricalEncoding: 'onehot' },
  }
  if ('target' in overrides) {
    if (overrides.target === undefined) delete data['target']
    else data['target'] = overrides.target
  }
  return {
    ...file,
    document: {
      ...file.document,
      manifest: {
        ...file.document.manifest,
        taskType: overrides.taskType ?? file.document.manifest.taskType,
      },
      settings: {
        ...file.document.settings,
        split: { ...file.document.settings.split, method: 'holdout', stratify: false },
        data: data as ProjectFile['document']['settings']['data'],
      },
    },
    dataset: { bytes, hash: hashBytes(bytes) },
    testDataset: undefined,
  }
}

async function mountPrep(file: ProjectFile): Promise<ReturnType<typeof mount>> {
  await useProjectStore().save(file)
  const wrapper = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
  await settle()
  return wrapper
}

/**
 * **켜 둔 특성이 결측 때문에 잠기지 않는다** (결정문 65 "감사 뒤 더한 것"). 전에는 결측 처리를
 * "그대로 두기"로 바꾸는 순간 켜진 `몸무게`가 **켜진 채 잠겨** 풀 길이 [전체 해제]뿐이었다.
 * 이제 칸은 열려 있고, 줄이 이유를 말하고, 학습이 같은 판정으로 거절한다.
 */
describe('decision 65: missing values do not trap a checked feature', () => {
  it('after switching to keep, the checked feature can still be unchecked', async () => {
    const project = useProjectStore()
    const wrapper = await mountPrep(withMissingFeature())

    const keep = wrapper.findAll('input[name="missing"]').at(MISSING_STRATEGIES.indexOf('none'))
    expect(keep, 'the keep radio').toBeDefined()
    await keep?.setValue(true)
    await settle()
    expect(project.file?.document.settings.data).toMatchObject({
      preprocessing: { missing: 'none' },
    })

    const box = wrapper.find('input[type="checkbox"][aria-label="몸무게"]')
    expect((box.element as HTMLInputElement).checked).toBe(true)
    expect(
      box.attributes('disabled'),
      'a feature with missing values is not locked',
    ).toBeUndefined()
    // 줄은 여전히 이유를 말한다 — 잠그지 않을 뿐 알리지 않는 것이 아니다. 그 문장이 **"선택을
    // 해제해 주세요"라고 시키는데** 잠겨 있던 것이 덫의 모양이었다.
    expect(wrapper.text()).toContain('이 특성의 선택을 해제해 주세요. (몸무게)')

    await box.setValue(false)
    await settle()
    expect(project.file?.document.settings.data).toMatchObject({ features: ['키'] })
  })

  it('the target column is still locked by its role (decision 55)', async () => {
    const wrapper = await mountPrep(withMissingFeature())
    const target = wrapper.find('input[type="checkbox"][aria-label="품종"]')
    expect(target.attributes('disabled')).toBeDefined()
  })
})

/**
 * **군집은 타깃 없이도 [일부 추출]을 켤 수 있다** (결정문 65 "감사 뒤 더한 것"). 군집은 타깃을
 * 안 쓰는데 "타깃을 먼저 정해야"로 잠겨 **영영 안 풀리는 덫**이었다. 천장은 특성의 빈 칸만 보고
 * 센다 — 학습(`ml/training-source.ts`)과 같은 함수다.
 */
describe('decision 65: sampling in a clustering project', () => {
  it('군집 프로젝트는 타깃 없이도 일부 추출을 켤 수 있다', async () => {
    const project = useProjectStore()
    const wrapper = await mountPrep(
      withMissingFeature({ target: undefined, taskType: 'clustering' }),
    )
    const part = wrapper.findAll('input[name="sampling"]').at(1)
    expect(part?.attributes('disabled'), 'sampling is not locked for clustering').toBeUndefined()

    await part?.setValue(true)
    await settle()
    // `몸무게`가 빈 한 행을 뺀 셋 — 학습이 쓰는 행이다. 파일의 행 수(넷)가 아니다.
    expect(project.file?.document.settings.nSamples).toBe(3)
  })

  it('타깃을 쓰는 유형은 타깃을 고르기 전에 여전히 잠근다', async () => {
    const wrapper = await mountPrep(
      withMissingFeature({ target: undefined, taskType: 'classification' }),
    )
    const part = wrapper.findAll('input[name="sampling"]').at(1)
    expect(part?.attributes('disabled')).toBeDefined()
  })

  /**
   * **잠금이 유일한 방어가 아니다** (결정문 65 "구조 뒤 감사에서 더한 것"). 잠금을 건너 켜도 같은
   * 칸(`sampling`)이 거절하고 알린다 — 파일 행 수가 표본 수로 박히지 않는다.
   */
  it('잠금을 건너 켜도 같은 칸이 거절하고 알린다', async () => {
    const project = useProjectStore()
    const wrapper = await mountPrep(
      withMissingFeature({ target: undefined, taskType: 'classification' }),
    )
    const part = wrapper.findAll('input[name="sampling"]').at(1)
    const input = part?.element as HTMLInputElement
    input.checked = true
    ;(wrapper.vm as unknown as { startSampling: (input: HTMLInputElement) => void }).startSampling(
      input,
    )
    await settle()
    expect(project.file?.document.settings.nSamples).toBeUndefined()
    expect(input.checked, 'the radio went back to the file value').toBe(false)
    expect(
      useToastStore()
        .items.filter((one) => one.tone === 'caution')
        .map((one) => one.key),
    ).toEqual(['preprocess.tabular.sampleNeedsTarget'])
  })
})
