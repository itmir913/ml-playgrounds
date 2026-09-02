// @vitest-environment jsdom
/**
 * **파일 예측 판에서 붙이는 동안 다른 파일을 놓으면** 무슨 일이 나는가
 * (architecture.md §8.10.4).
 *
 * 표 데이터 화면(`tabular-panel-overlap.spec.ts`)과 같은 병이고 자리만 예측이다 — 붙이기가
 * 끝나며 `opened`를 통째로 비우면 그 사이에 학생이 읽힌 새 파일이 말없이 사라지는데,
 * **그 자리를 되돌려도 2,839개가 초록이었다** (2026-09-02 R22 재감사 C-3). R22와 재감사
 * 양쪽이 이 판만 안 띄웠다.
 *
 * **저장을 검사가 붙든다.** 그래야 "붙이는 중"이라는 창이 생긴다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import type { PredictableModel } from '../src/ml/predict'
import type { Preprocessor } from '../src/ml/preprocess'
import type { ProjectFile } from '../src/project/format'
import { dataSettings } from '../src/project/schema'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import BatchPredict from '../src/views/predict/BatchPredict.vue'
import { dropEvent, stubDialogElement } from './fixtures/image-workers'
import { experiment, projectFile, run } from './fixtures/project'

/**
 * 저장을 붙드는 손잡이. **참이면 `saveProject`가 답하지 않고** 검사가 `release()`로
 * 끝낸다 — 그 사이가 "붙이는 중"이다.
 */
const gate = vi.hoisted(() => ({
  hold: false,
  waiting: [] as (() => void)[],
}))

vi.mock('../src/project/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/storage')>()
  return {
    ...actual,
    saveProject: async (file: ProjectFile) => {
      if (gate.hold) {
        await new Promise<void>((resolve) => gate.waiting.push(resolve))
      }
      return actual.saveProject(file)
    },
  }
})

function release(): void {
  const waiting = [...gate.waiting]
  gate.waiting.length = 0
  for (const one of waiting) one()
}

// 계산은 이 검사의 주제가 아니다.
vi.mock('../src/ml/predict', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/ml/predict')>()
  return {
    ...original,
    predictPage: (models: readonly PredictableModel[], rows: readonly unknown[]) =>
      rows.map(() => models.map((model) => ({ value: model.run.id }))),
  }
})

const A: PredictableModel = {
  experiment: experiment('experiment-1', []),
  run: run('run-A', { algorithm: 'decision_tree' }),
}

const preprocessors = new Map<string, Preprocessor>([
  ['experiment-1', { columns: [] } as unknown as Preprocessor],
])

/** 매크로태스크 한 번. 파일을 읽는 동안 비켜 준다. */
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

/** 판 안쪽. 붙이기와 읽기의 순서를 검사가 정해야 해서 직접 묻는다. */
interface PanelInternals {
  busy: boolean
  opened: { fileName: string } | null
  apply: () => Promise<void>
}

/** 붙은 예측용 표의 원래 파일 이름. **무엇이 실제로 앉았는지가 이 값이다.** */
function appliedFileName(file: ProjectFile | null): string | undefined {
  if (!file) return undefined
  return dataSettings('tabular', file.document.settings).predictDataset?.originalFileName
}

function csv(name: string): File {
  return new File([`a,b\n1,2\n3,4\n`], name, { type: 'text/csv' })
}

beforeEach(async () => {
  setActivePinia(createPinia())
  gate.hold = false
  gate.waiting.length = 0
  closeStorage()
  await deleteDatabase()
  stubDialogElement()
  await setLocale('ko')
})

afterEach(async () => {
  release()
  closeStorage()
  await deleteDatabase()
})

/** 판을 띄우고 `first.csv`를 세운다. */
async function panelWithFile() {
  const project = useProjectStore()
  await project.save(projectFile())
  const wrapper = mount(BatchPredict, {
    props: {
      models: [A],
      preprocessors,
      dataset: null,
      fields: [],
      experimentNames: new Map(),
    },
    global: { plugins: [i18n] },
  })
  await flushPromises()
  const panel = wrapper.vm as unknown as PanelInternals

  /** 놓는 자리. **빈 상태의 점선 상자다** — 파일이 서면 사라진다. */
  const drop = async (file: File): Promise<void> => {
    const zone = wrapper.find('[class*="border-dashed"]')
    expect(zone.exists()).toBe(true)
    zone.element.dispatchEvent(dropEvent([file]))
    await settle()
  }

  await drop(csv('first.csv'))
  expect(panel.opened?.fileName).toBe('first.csv')

  return { project, wrapper, panel, drop }
}

/**
 * **이 판은 표 데이터 화면과 입구가 다르다.** 파일이 서면 점선 상자가 사라지고
 * (`v-if="!opened"`), 붙이는 동안 남는 입구는 부모 바가 `busy`로 잠그는 숨은 파일
 * 입력뿐이다. 그러니 겹침은 **화면으로는 닿지 않고**, `clearIfHeld`는 그 잠금이 뚫렸을
 * 때의 방어선이다. 검사는 그 둘을 따로 적는다 — 자리가 없다는 것과, 그래도 들어오면
 * 남는다는 것.
 */
describe('붙이는 동안', () => {
  it('놓을 자리가 없고 자물쇠는 잠겨 있다', async () => {
    const { wrapper, panel } = await panelWithFile()

    gate.hold = true
    const applying = panel.apply()
    await flushPromises()
    expect(panel.busy).toBe(true)
    expect(wrapper.find('[class*="border-dashed"]').exists()).toBe(false)

    release()
    await applying
    await settle()
    expect(panel.busy).toBe(false)
  })

  /**
   * **내가 든 파일만 치운다.** 부모 바의 잠금이 뚫려 숨은 입력으로 파일이 들어와도,
   * 통째로 `null`을 쓰면 붙이기가 끝나며 그 파일이 판에서 사라진다 — 그 자리를 되돌려도
   * 아무것도 안 울던 것이 R22 V4다.
   */
  it('숨은 입력으로 들어온 파일은 붙이기가 끝나도 판에 남는다', async () => {
    const { project, wrapper, panel } = await panelWithFile()

    gate.hold = true
    const applying = panel.apply()
    await flushPromises()

    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', {
      value: [csv('second.csv')],
      configurable: true,
    })
    await input.trigger('change')
    await settle()
    expect(panel.opened?.fileName).toBe('second.csv')
    // 읽기가 끝나도 붙이기는 아직 돈다.
    expect(panel.busy).toBe(true)

    release()
    await applying
    await settle()

    expect(appliedFileName(project.file)).toBe('first.csv')
    expect(panel.opened?.fileName).toBe('second.csv')
    expect(useToastStore().items.map((one) => one.key)).toContain('predict.tabular.fileApplied')
  })

  it('아무것도 안 놓았으면 붙인 판은 치운다', async () => {
    const { project, panel } = await panelWithFile()

    await panel.apply()
    await settle()

    expect(appliedFileName(project.file)).toBe('first.csv')
    expect(panel.opened).toBeNull()
  })
})
