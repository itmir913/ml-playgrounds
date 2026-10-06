// @vitest-environment jsdom
/**
 * **CSV를 받는 화면이 지금 UI 언어를 판정에 넘기는가** (`open-decisions.md` 102).
 *
 * `detectEncoding`·`openTable`의 언어는 필수라서 빼면 `vue-tsc`가 운다. 그러나 **엉뚱한 언어를
 * 넘기는 것**(늘 `FALLBACK_LOCALE`, 프로젝트를 만든 언어)은 타입이 못 본다 — 판정 검사
 * (`encoding.spec.ts`·`table.spec.ts`)는 언어를 손으로 주므로 초록이다. 그래서 화면을 띄워
 * 같은 CP932 파일을 놓아 본다: 일본어 화면이면 `身長`으로 읽히고, 한국어 화면이면
 * `DATASET_ENCODING_UNKNOWN`으로 멈춘다.
 *
 * **진짜 입구로 잰다** — 판을 띄워 과녁에 파일을 떨어뜨린다(`inspect-drop.spec.ts`의 관용구,
 * `fixtures/image-workers.ts`의 `dropEvent`).
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { TableDocument } from '../src/data/table'
import { i18n, setLocale } from '../src/i18n'
import type { PredictableModel } from '../src/ml/predict'
import type { Preprocessor } from '../src/ml/preprocess'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { closeStorage } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import TabularPanel from '../src/views/data/TabularPanel.vue'
import BatchPredict from '../src/views/predict/BatchPredict.vue'
import TabularPrepPanel from '../src/views/preprocess/TabularPrepPanel.vue'
import { CP932_SAMPLE } from './fixtures/cp932'
import { resetDatabase } from './fixtures/database'
import { dropEvent, stubDialogElement } from './fixtures/image-workers'
import { experiment, projectFile, run } from './fixtures/project'

/**
 * CP932 표본은 `fixtures/cp932.ts`가 준다 — 판정 검사와 같은 바이트이고, Node와 브라우저의 euc-kr
 * 어느 쪽으로도 안 풀린다(그래야 한국어 화면의 멈춤이 브라우저에서도 참이다).
 */
const CP932_BYTES = CP932_SAMPLE

const UNKNOWN = 'client.DATASET_ENCODING_UNKNOWN'

function cp932File(name: string): File {
  return new File([CP932_BYTES], name, { type: 'text/csv' })
}

/** 데이터가 없는 표 프로젝트 — 데이터 화면이 빈 과녁을 그린다. */
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

const dangerKeys = (): string[] =>
  useToastStore()
    .items.filter((one) => one.tone === 'danger')
    .map((one) => one.key)

/** 과녁(점선 테두리)에 파일을 떨어뜨리고, 판이 서거나 알림이 뜰 때까지 기다린다. */
async function dropAndSettle(
  wrapper: VueWrapper,
  file: File,
  opened: () => boolean,
): Promise<void> {
  wrapper.find('[class*="border-dashed"]').element.dispatchEvent(dropEvent([file]))
  await vi.waitFor(() => {
    if (!opened() && useToastStore().items.length === 0) throw new Error('reading has not finished')
  })
  await flushPromises()
}

beforeEach(async () => {
  setActivePinia(createPinia())
  closeStorage()
  await resetDatabase()
  stubDialogElement()
})

afterEach(async () => {
  closeStorage()
  await resetDatabase()
})

describe('데이터 화면(TabularPanel)이 UI 언어로 판정한다', () => {
  async function mountPanel(): Promise<VueWrapper> {
    await useProjectStore().save(emptyTabularProject())
    const wrapper = mount(TabularPanel, { props: { accept: '.csv' }, global: { plugins: [i18n] } })
    await flushPromises()
    return wrapper
  }

  it('일본어 화면은 CP932 CSV의 열 이름을 바르게 보인다', async () => {
    await setLocale('ja')
    const wrapper = await mountPanel()
    await dropAndSettle(wrapper, cp932File('jp.csv'), () => wrapper.text().includes('jp.csv'))

    expect(dangerKeys()).toEqual([])
    expect(wrapper.text()).toContain('身長')
    expect(wrapper.text()).toContain('クラス')
  })

  it('한국어 화면은 같은 파일을 DATASET_ENCODING_UNKNOWN으로 멈춘다', async () => {
    await setLocale('ko')
    const wrapper = await mountPanel()
    await dropAndSettle(wrapper, cp932File('jp.csv'), () => wrapper.text().includes('jp.csv'))

    expect(dangerKeys()).toEqual([UNKNOWN])
    expect(wrapper.text()).not.toContain('jp.csv')
  })
})

/** 전처리 판의 테스트 파일 자리. 띄운 뒤 "②"를 골라야 과녁이 그려진다(`tabular-prep-fail.spec.ts`). */
describe('전처리 화면(TabularPrepPanel)의 테스트 파일이 UI 언어로 판정된다', () => {
  interface PrepInternals {
    openedTest: { document: TableDocument; fileName: string } | null
  }

  async function mountPanel(): Promise<{ wrapper: VueWrapper; panel: PrepInternals }> {
    await useProjectStore().save(projectFile())
    const wrapper = mount(TabularPrepPanel, { global: { plugins: [i18n] } })
    await flushPromises()
    const radios = wrapper.findAll('input[name="test-data-choice"]')
    expect(radios.length).toBeGreaterThan(1)
    await radios[radios.length - 1]?.trigger('change')
    await flushPromises()
    return { wrapper, panel: wrapper.vm as unknown as PrepInternals }
  }

  it('일본어 화면은 CP932로 연다', async () => {
    await setLocale('ja')
    const { wrapper, panel } = await mountPanel()
    await dropAndSettle(wrapper, cp932File('test.csv'), () => panel.openedTest !== null)

    expect(dangerKeys()).toEqual([])
    expect(panel.openedTest?.document.sourceEncoding).toBe('cp932')
  })

  it('한국어 화면은 DATASET_ENCODING_UNKNOWN으로 멈춘다', async () => {
    await setLocale('ko')
    const { wrapper, panel } = await mountPanel()
    await dropAndSettle(wrapper, cp932File('test.csv'), () => panel.openedTest !== null)

    expect(dangerKeys()).toEqual([UNKNOWN])
    expect(panel.openedTest).toBeNull()
  })
})

/** 예측 화면의 파일 예측 판. 붙이기 전의 판(`opened`)만 본다 — 모델과 열은 판정과 무관하다. */
describe('예측 화면(BatchPredict)의 파일이 UI 언어로 판정된다', () => {
  interface BatchInternals {
    opened: { document: TableDocument; fileName: string } | null
  }

  const model: PredictableModel = {
    experiment: experiment('experiment-1', []),
    run: run('run-A', { algorithm: 'decision_tree' }),
  }
  const preprocessors = new Map<string, Preprocessor>([
    ['experiment-1', { columns: [] } as unknown as Preprocessor],
  ])

  async function mountPanel(): Promise<{ wrapper: VueWrapper; panel: BatchInternals }> {
    await useProjectStore().save(projectFile())
    const wrapper = mount(BatchPredict, {
      props: {
        models: [model],
        preprocessors,
        dataset: null,
        fields: [],
        experimentNames: new Map(),
      },
      global: { plugins: [i18n] },
    })
    await flushPromises()
    return { wrapper, panel: wrapper.vm as unknown as BatchInternals }
  }

  it('일본어 화면은 CP932로 연다', async () => {
    await setLocale('ja')
    const { wrapper, panel } = await mountPanel()
    await dropAndSettle(wrapper, cp932File('predict.csv'), () => panel.opened !== null)

    expect(dangerKeys()).toEqual([])
    expect(panel.opened?.document.sourceEncoding).toBe('cp932')
  })

  it('한국어 화면은 DATASET_ENCODING_UNKNOWN으로 멈춘다', async () => {
    await setLocale('ko')
    const { wrapper, panel } = await mountPanel()
    await dropAndSettle(wrapper, cp932File('predict.csv'), () => panel.opened !== null)

    expect(dangerKeys()).toEqual([UNKNOWN])
    expect(panel.opened).toBeNull()
  })
})
