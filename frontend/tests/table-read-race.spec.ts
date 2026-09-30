// @vitest-environment jsdom
/**
 * **읽기가 겹치면 나중에 놓은 파일이 판에 선다** — 먼저 끝난 쪽이 아니다 (`composables/useWork.ts`의
 * `latestOnly`).
 *
 * 파일을 받는 판(데이터 화면의 표·사진, 테스트 데이터, 예측할 파일)은 읽는 동안에도 과녁이 열려 있다
 * (architecture.md §8.10.4 — 읽기는 판에 설 뿐 프로젝트를 안 건드린다). 그래서 학생이 잘못 고른 큰
 * 파일을 놓고 곧바로 맞는 파일을 놓을 수 있다. 전에는 **늦게 끝난 읽기가 판을 덮어서**, 작은 파일이
 * 먼저 서고 잠시 뒤 큰 파일이 그 자리를 말없이 차지했다 — 학생은 방금 본 미리보기를 믿고 확정을
 * 누른다. 어느 것이 서는지가 파일 크기에 달려 있었다.
 *
 * **읽기를 검사가 붙든다** — `File.arrayBuffer`가 검사가 풀 때까지 답하지 않는다. 그 사이가
 * "먼저 놓은 파일을 읽는 중"이다. 판마다 **진짜 입구**(과녁에 떨어뜨리기)로 잰다 — 테스트 데이터
 * 판만 읽기 함수를 직접 부른다(`tabular-prep-fail.spec.ts`와 같은 입구).
 */
import 'fake-indexeddb/auto'

import { zipSync } from 'fflate'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import type { PredictableModel } from '../src/ml/predict'
import type { Preprocessor } from '../src/ml/preprocess'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { closeStorage } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import ImagePanel from '../src/views/data/ImagePanel.vue'
import TabularPanel from '../src/views/data/TabularPanel.vue'
import BatchPredict from '../src/views/predict/BatchPredict.vue'
import TabularPrepPanel from '../src/views/preprocess/TabularPrepPanel.vue'
import { resetDatabase } from './fixtures/database'
import { dropEvent, pasteEvent, stubDialogElement } from './fixtures/image-workers'
import { experiment, projectFile, run } from './fixtures/project'

// 사진 판의 자리 묻기는 이 검사의 주제가 아니다.
vi.mock('../src/data/image/room', () => ({ imageRoomShortfall: async () => null }))

/**
 * 저장을 붙드는 손잡이. **참이면 `saveProject`가 답하지 않고** 검사가 `releaseSave()`로 끝낸다 —
 * 그 사이가 "적용 중"이다 (`tabular-panel-overlap.spec.ts`와 같은 짜임).
 */
const saveGate = vi.hoisted(() => ({ hold: false, waiting: [] as (() => void)[] }))

vi.mock('../src/project/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/storage')>()
  return {
    ...actual,
    saveProject: async (file: ProjectFile) => {
      if (saveGate.hold) await new Promise<void>((resolve) => saveGate.waiting.push(resolve))
      return actual.saveProject(file)
    },
  }
})

function releaseSave(): void {
  saveGate.hold = false
  const waiting = [...saveGate.waiting]
  saveGate.waiting.length = 0
  for (const one of waiting) one()
}

const dangers = () => useToastStore().items.filter((one) => one.tone === 'danger')

function emptyProject(dataType: 'tabular' | 'image'): ProjectFile {
  const document = newProjectDocument(
    { name: '프로젝트', locale: 'ko', dataType },
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

/** 검사가 `release()`를 부를 때까지 읽히지 않는 파일. 먼저 놓은 큰 파일의 대역이다. */
function heldFile(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
): { file: File; release: () => void } {
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  const file = new File([bytes], name)
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => {
      await held
      return bytes.buffer
    },
  })
  return { file, release }
}

const text = (value: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(value)

beforeEach(async () => {
  setActivePinia(createPinia())
  closeStorage()
  await resetDatabase()
  stubDialogElement()
  URL.createObjectURL = () => 'blob:fake'
  URL.revokeObjectURL = () => {}
  await setLocale('ko')
})

afterEach(async () => {
  releaseSave()
  closeStorage()
  await resetDatabase()
})

interface Reader {
  busy: boolean
}

/** 먼저 놓은 읽기가 끝날 때까지 — 고정 틱이 아니라 `busy`가 내려가기를 기다린다. */
async function finished(panel: Reader): Promise<void> {
  await vi.waitFor(() => {
    if (panel.busy) throw new Error('the first read has not finished')
  })
  await flushPromises()
}

function dropOn(wrapper: VueWrapper, selector: string, files: readonly File[]): void {
  const zone = wrapper.find(selector)
  expect(zone.exists()).toBe(true)
  zone.element.dispatchEvent(dropEvent(files))
}

describe('겹친 읽기 — 나중에 놓은 것이 선다', () => {
  it('데이터 화면(표): 먼저 놓은 파일이 늦게 끝나도 나중 파일이 판에 남는다', async () => {
    await useProjectStore().save(emptyProject('tabular'))
    const wrapper = mount(TabularPanel, {
      props: { accept: '.csv' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    const panel = wrapper.vm as unknown as Reader & { opened: { fileName: string } | null }

    const first = heldFile(text('잘못,고른\n1,2\n'), 'wrong.csv')
    dropOn(wrapper, '[class*="min-h-full"]', [first.file])
    dropOn(wrapper, '[class*="min-h-full"]', [new File(['키,몸무게\n170,65\n'], 'right.csv')])
    await vi.waitFor(() => {
      if (panel.opened?.fileName !== 'right.csv') throw new Error('the second file is not up')
    })

    first.release()
    await finished(panel)

    expect(panel.opened?.fileName).toBe('right.csv')
    expect(wrapper.text()).toContain('몸무게')
    expect(wrapper.text()).not.toContain('wrong.csv')
  })

  it('데이터 화면(표): 먼저 놓은 파일의 실패는 말하지 않는다 — 학생은 이미 넘어갔다', async () => {
    await useProjectStore().save(emptyProject('tabular'))
    const wrapper = mount(TabularPanel, {
      props: { accept: '.csv' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    const panel = wrapper.vm as unknown as Reader & { opened: { fileName: string } | null }

    const first = heldFile(new Uint8Array([0, 1, 2]), 'wrong.pdf')
    dropOn(wrapper, '[class*="min-h-full"]', [first.file])
    dropOn(wrapper, '[class*="min-h-full"]', [new File(['키,몸무게\n170,65\n'], 'right.csv')])
    first.release()
    await finished(panel)

    expect(panel.opened?.fileName).toBe('right.csv')
    expect(useToastStore().items.filter((one) => one.tone === 'danger')).toEqual([])
  })

  it('테스트 데이터: 먼저 읽기 시작한 파일이 늦게 끝나도 나중 파일이 판에 남는다', async () => {
    const file = projectFile()
    await useProjectStore().save({
      ...file,
      document: { ...file.document, runs: { experiments: [] } },
    })
    const wrapper = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as {
      testBusy: boolean
      openedTest: { fileName: string } | null
      readTestFile: (file: File) => Promise<void>
    }

    const first = heldFile(text('꽃받침,품종\n1,a\n'), 'wrong.csv')
    const reading = panel.readTestFile(first.file)
    await panel.readTestFile(new File(['꽃받침,품종\n5.1,setosa\n'], 'right.csv'))
    expect(panel.openedTest?.fileName).toBe('right.csv')

    first.release()
    await reading
    await flushPromises()

    expect(panel.openedTest?.fileName).toBe('right.csv')
  })

  it('예측할 파일: 먼저 놓은 파일이 늦게 끝나도 나중 파일이 판에 남는다', async () => {
    await useProjectStore().save(projectFile())
    const model: PredictableModel = {
      experiment: experiment('experiment-1', []),
      run: run('run-A', { algorithm: 'decision_tree' }),
    }
    const wrapper = mount(BatchPredict, {
      props: {
        models: [model],
        preprocessors: new Map<string, Preprocessor>([
          ['experiment-1', { columns: [] } as unknown as Preprocessor],
        ]),
        dataset: null,
        fields: [],
        experimentNames: new Map(),
      },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    const panel = wrapper.vm as unknown as Reader & { opened: { fileName: string } | null }

    const first = heldFile(text('a,b\n1,2\n'), 'wrong.csv')
    dropOn(wrapper, '[class*="border-dashed"]', [first.file])
    dropOn(wrapper, '[class*="border-dashed"]', [new File(['a,b\n3,4\n'], 'right.csv')])
    await vi.waitFor(() => {
      if (panel.opened?.fileName !== 'right.csv') throw new Error('the second file is not up')
    })

    first.release()
    await finished(panel)

    expect(panel.opened?.fileName).toBe('right.csv')
  })

  it('데이터 화면(사진): 먼저 놓은 zip이 늦게 끝나도 나중에 놓은 사진이 확인 판에 남는다', async () => {
    await useProjectStore().save(emptyProject('image'))
    const wrapper = mount(ImagePanel, {
      props: { accept: 'image/*,.zip' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    const panel = wrapper.vm as unknown as Reader & {
      pending: readonly { path: string }[] | null
    }

    const zip = zipSync({ '개/wrong.jpg': new Uint8Array([1, 2, 3]) })
    const first = heldFile(new Uint8Array(zip), 'wrong.zip')
    dropOn(wrapper, '[class*="min-h-full"]', [first.file])
    dropOn(wrapper, '[class*="min-h-full"]', [
      new File([new Uint8Array([4, 5, 6])], 'right.jpg', { type: 'image/jpeg' }),
    ])
    await vi.waitFor(() => {
      if (panel.pending?.[0]?.path !== 'right.jpg') throw new Error('the photo is not up')
    })

    first.release()
    await finished(panel)

    expect(panel.pending?.map((one) => one.path)).toEqual(['right.jpg'])
  })
})

/**
 * **밀려난 읽기의 실패는 말하지 않는다** — 판마다 문다. 학생은 이미 다른 파일로 넘어갔고, 옛
 * 파일의 거절이 새 파일에 대한 말처럼 읽힌다. 먼저 놓은 것은 받지 않는 파일(`.pdf`·깨진 zip)이다.
 */
describe('밀려난 읽기의 실패', () => {
  it('테스트 데이터: 먼저 읽기 시작한 파일의 실패는 말하지 않는다', async () => {
    const file = projectFile()
    await useProjectStore().save({
      ...file,
      document: { ...file.document, runs: { experiments: [] } },
    })
    const wrapper = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as {
      openedTest: { fileName: string } | null
      readTestFile: (file: File) => Promise<void>
    }

    const first = heldFile(new Uint8Array([0, 1, 2]), 'wrong.pdf')
    const reading = panel.readTestFile(first.file)
    await panel.readTestFile(new File(['꽃받침,품종\n5.1,setosa\n'], 'right.csv'))
    first.release()
    await reading
    await flushPromises()

    expect(panel.openedTest?.fileName).toBe('right.csv')
    expect(dangers()).toEqual([])
  })

  it('예측할 파일: 먼저 놓은 파일의 실패는 말하지 않는다', async () => {
    await useProjectStore().save(projectFile())
    const model: PredictableModel = {
      experiment: experiment('experiment-1', []),
      run: run('run-A', { algorithm: 'decision_tree' }),
    }
    const wrapper = mount(BatchPredict, {
      props: {
        models: [model],
        preprocessors: new Map<string, Preprocessor>([
          ['experiment-1', { columns: [] } as unknown as Preprocessor],
        ]),
        dataset: null,
        fields: [],
        experimentNames: new Map(),
      },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    const panel = wrapper.vm as unknown as Reader & { opened: { fileName: string } | null }

    const first = heldFile(new Uint8Array([0, 1, 2]), 'wrong.pdf')
    dropOn(wrapper, '[class*="border-dashed"]', [first.file])
    dropOn(wrapper, '[class*="border-dashed"]', [new File(['a,b\n3,4\n'], 'right.csv')])
    first.release()
    await finished(panel)

    expect(panel.opened?.fileName).toBe('right.csv')
    expect(dangers()).toEqual([])
  })

  it('데이터 화면(사진): 먼저 놓은 깨진 zip의 실패는 말하지 않는다', async () => {
    await useProjectStore().save(emptyProject('image'))
    const wrapper = mount(ImagePanel, {
      props: { accept: 'image/*,.zip' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    const panel = wrapper.vm as unknown as Reader & {
      pending: readonly { path: string }[] | null
    }

    const first = heldFile(new Uint8Array([0, 1, 2]), 'wrong.zip')
    dropOn(wrapper, '[class*="min-h-full"]', [first.file])
    dropOn(wrapper, '[class*="min-h-full"]', [
      new File([new Uint8Array([4, 5, 6])], 'right.jpg', { type: 'image/jpeg' }),
    ])
    first.release()
    await finished(panel)

    expect(panel.pending?.map((one) => one.path)).toEqual(['right.jpg'])
    expect(dangers()).toEqual([])
  })
})

/**
 * **붙여넣기는 표를 받지 않는다** (`ImagePanel.vue`의 `readPicked`). 받으면 zip을 읽는 동안
 * 스크린샷 하나를 붙여넣는 것만으로 그 zip이 밀려나 말없이 버려진다.
 *
 * **여기서 보는 것은 zip이 버려지지 않는다는 것뿐이다.** 그 zip이 앉을 때 먼저 붙여넣은
 * 스크린샷은 밀려난다 — 그대로 두기로 했다(open-decisions.md 90). 정한 것이 "고치지 않는다"라
 * 그 밀려남은 못 박지 않는다.
 */
describe('붙여넣기는 앞의 읽기를 밀어내지 않는다', () => {
  it('zip을 읽는 동안 붙여넣어도 그 zip이 확인 판에 선다', async () => {
    await useProjectStore().save(emptyProject('image'))
    const wrapper = mount(ImagePanel, {
      props: { accept: 'image/*,.zip' },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    const panel = wrapper.vm as unknown as Reader & {
      pending: readonly { path: string }[] | null
    }

    const zip = zipSync({ '개/dropped.jpg': new Uint8Array([1, 2, 3]) })
    const first = heldFile(new Uint8Array(zip), 'dropped.zip')
    dropOn(wrapper, '[class*="min-h-full"]', [first.file])
    window.dispatchEvent(
      pasteEvent([new File([new Uint8Array([7, 8, 9])], 'image.png', { type: 'image/png' })]),
    )
    await vi.waitFor(() => {
      if (!panel.pending) throw new Error('the pasted photo is not up')
    })

    first.release()
    await finished(panel)

    expect(panel.pending?.map((one) => one.path)).toContain('개/dropped.jpg')
    wrapper.unmount()
  })
})

/**
 * **적용하는 동안 놓은 테스트 파일은 적용이 끝나도 판에 남는다** (`TabularPrepPanel.vue`의
 * `applyTest` — `clearIfHeld`). 테스트 판은 적용 중에도 읽기를 받는다. 전에는 적용이 끝나며 판을
 * 통째로 비워, 그 사이에 선 새 파일이 사라지고 "적용했다"는 알림만 남았다 — 학생은 새 파일이
 * 적용됐다고 믿는다. 저장을 붙들어 "적용 중"을 만든다.
 */
describe('적용하는 동안 놓은 테스트 파일', () => {
  it('적용이 끝나도 새로 놓은 파일이 판에 남는다', async () => {
    const file = projectFile()
    await useProjectStore().save({
      ...file,
      document: { ...file.document, runs: { experiments: [] } },
    })
    const wrapper = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const panel = wrapper.vm as unknown as {
      openedTest: { fileName: string } | null
      readTestFile: (file: File) => Promise<void>
      applyTest: () => Promise<void>
    }

    await panel.readTestFile(new File(['꽃받침,품종\n5.1,setosa\n'], 'first.csv'))
    expect(panel.openedTest?.fileName).toBe('first.csv')

    saveGate.hold = true
    const applying = panel.applyTest()
    await vi.waitFor(() => {
      if (saveGate.waiting.length === 0) throw new Error('saving has not started')
    })
    await panel.readTestFile(new File(['꽃받침,품종\n6.0,virginica\n'], 'second.csv'))
    expect(panel.openedTest?.fileName).toBe('second.csv')

    releaseSave()
    await applying
    await flushPromises()

    expect(useToastStore().items.map((one) => one.key)).toContain(
      'preprocess.tabular.testDataApplied',
    )
    expect(panel.openedTest?.fileName).toBe('second.csv')
  })
})
