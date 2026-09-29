// @vitest-environment jsdom
/**
 * **열 이름이 `__proto__`여도 파일로 예측한다** (2026-09-28 감사 E A3).
 *
 * 열 이름은 학생의 파일에서 오고 스키마는 아무 글자나 받는다(`userString`). 파일 예측 판이
 * 행마다 `values[name] = v`로 사전을 만들었을 때 `__proto__`는 own 속성이 안 되어 **값이
 * 조용히 사라졌고**, 이어서 `inputVector`의 `values[name]`이 `Object.prototype`을 주어
 * `.trim()`이 던졌다 — 판이 예측 대신 날것의 TypeError를 냈다.
 *
 * **진짜 입구로 잰다** — CSV 바이트 → `openTable` → `importTable` → `applyDataset` → 설정 문 →
 * `runExperiment` → `applyExperiment`로 진짜 모델을 세우고, 예측할 파일을 붙여 판을 띄운 뒤
 * 바의 [CSV로 다운로드]를 누른다. 고침: `ml/predict.ts`의 `rowValues`·`inputVector`.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const captured = vi.hoisted(() => ({ bytes: null as Uint8Array | null }))

vi.mock('../src/project/download', async (real) => {
  const actual = await real<typeof import('../src/project/download')>()
  return {
    ...actual,
    downloadBytes: (bytes: Uint8Array) => {
      captured.bytes = bytes
    },
  }
})

import { importTable, openTable, type ImportedTable } from '../src/data/table'
import { i18n, setLocale } from '../src/i18n'
import { runExperiment } from '../src/ml/experiment'
import { applyExperiment } from '../src/project/attach'
import { applyDataset, applyPredictDataset, readDataset } from '../src/project/dataset'
import { dataSnapshot } from '../src/project/schema'
import {
  withFeatures,
  withSelectedAlgorithms,
  withTarget,
  withTaskType,
} from '../src/project/settings'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import TabularPredictPanel from '../src/views/predict/TabularPredictPanel.vue'
import { projectFile } from './fixtures/project'

const NOW = '2026-09-28T00:00:00Z'
const PROTO = '__proto__'

async function settle(): Promise<void> {
  for (let round = 0; round < 4; round += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function table(text: string, name: string): Promise<ImportedTable> {
  return importTable(await openTable(new TextEncoder().encode(text), name))
}

beforeEach(async () => {
  setActivePinia(createPinia())
  captured.bytes = null
  await setLocale('ko')
  if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = () => {}
  }
})

describe('열 이름이 __proto__인 표', () => {
  it('파일로 예측해 답을 내려받는다', async () => {
    // 작은 수는 a, 큰 수는 b — 결정 트리가 틀릴 수 없는 표다.
    const lines = [`${PROTO},y`]
    for (let value = 1; value <= 10; value += 1) lines.push(`${value},a`, `${value + 100},b`)
    const { project } = applyDataset(projectFile(), await table(`${lines.join('\n')}\n`, 't.csv'), {
      fileName: 't.csv',
      hasHeader: true,
      now: NOW,
    })
    let document = withTaskType(project.document, 'classification', NOW)
    document = withTarget(document, 'y', NOW)
    document = withFeatures(document, [PROTO], NOW)
    document = withSelectedAlgorithms(
      document,
      [{ algorithm: 'decision_tree', runtime: 'mljs' }],
      NOW,
    )
    const seeded = { ...project, document }
    const dataset = readDataset(seeded)
    if (!dataset) throw new Error('fixture has no dataset')
    expect(dataset.columns).toEqual([PROTO, 'y'])
    const result = await runExperiment({
      dataset,
      testDataset: null,
      taskType: 'classification',
      dataType: 'tabular',
      settings: document.settings,
      context: {
        serverStatus: 'unavailable',
        limitsOff: false,
        rowCount: dataset.rows.length,
        dataType: 'tabular',
      },
      snapshot: dataSnapshot('tabular', document.settings),
    })
    const trained = applyExperiment(seeded, result, NOW)

    const { project: file } = applyPredictDataset(
      trained,
      await table(`${PROTO}\n3\n105\n`, 'p.csv'),
      { fileName: 'p.csv', hasHeader: true, now: NOW, requiredColumns: [PROTO] },
    )
    useProjectStore().update(file)

    const wrapper = mount(TabularPredictPanel, { global: { plugins: [i18n] } })
    await settle()
    await wrapper.findAll('input[name="predict-input-mode"]')[1]?.trigger('change')
    await settle()
    const download = wrapper
      .findAll('button')
      .find((one) => one.text() === i18n.global.t('predict.tabular.download'))
    expect(download, 'download button').toBeDefined()
    await download!.trigger('click')
    await settle()

    expect(useToastStore().items.filter((one) => one.tone === 'danger')).toEqual([])
    expect(captured.bytes, 'download produced no file').not.toBeNull()
    const grid = new TextDecoder()
      .decode(captured.bytes ?? new Uint8Array())
      .replace(/^\uFEFF/, '')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => line.split(','))
    // 행 번호 · 답(특성 열은 기본으로 안 싣는다). 답이 표의 규칙대로다 — 값이 사라져 빈 칸으로
    // 예측했다면 두 줄이 같은 답이거나 칸이 비었을 것이다.
    expect(grid.slice(1).map((row) => row.slice(0, 2))).toEqual([
      ['1', 'a'],
      ['2', 'b'],
    ])
  })
})
