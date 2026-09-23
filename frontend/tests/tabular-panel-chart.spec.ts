// @vitest-environment jsdom
/**
 * **데이터 화면이 시각화 창에 무엇을 넘기는가** (2026-09-23, R38 C-1).
 *
 * 창을 여는 줄(`@visualize`)이 **어느 스펙에서도 실행되지 않았다.** `chart-dialog.spec.ts`는
 * 창을 **자기 표로** 직접 띄우므로, 데이터 판이 창에 **정본 전체**(`saved.dataset`) 대신
 * **미리보기 20행**(`shown.dataset`)을 넘겨도 초록이었을 것이다 — `architecture.md` §8.9.1이
 * *"확정된 정본에만 붙는다 … 20행으로 그린 분포는 전체의 분포가 아니다"*로 못 박은 자리다.
 *
 * **진짜 판을 띄워** 검사기의 [시각화]를 누르고 창이 받은 표의 행 수를 본다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('vue-chartjs', () => ({
  Bar: { name: 'Bar', props: ['data', 'options', 'plugins'], render: () => null },
  Scatter: { name: 'Scatter', props: ['data', 'options'], render: () => null },
}))

import { importTable, openTable } from '../src/data/table'
import { i18n, setLocale } from '../src/i18n'
import { TABLE_PREVIEW_ROW_COUNT } from '../src/limits'
import { applyDataset } from '../src/project/dataset'
import { closeStorage, DB_NAME } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import ChartDialog from '../src/views/data/ChartDialog.vue'
import ColumnInspector from '../src/views/data/ColumnInspector.vue'
import TabularPanel from '../src/views/data/TabularPanel.vue'
import { stubDialogElement } from './fixtures/image-workers'
import { projectFile } from './fixtures/project'

/** 미리보기보다 확실히 많다 — 둘이 같으면 이 검사는 아무것도 못 가른다. */
const ROWS = TABLE_PREVIEW_ROW_COUNT + 17

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
  await setLocale('ko')
})

afterEach(async () => {
  closeStorage()
  await deleteDatabase()
})

describe('시각화 창은 정본 전체를 받는다', () => {
  it('검사기에서 연 창이 미리보기가 아니라 확정된 표 전부를 받는다', async () => {
    const lines = ['키,몸무게']
    for (let i = 0; i < ROWS; i += 1) lines.push(`${150 + i},${45 + i}`)
    const csv = new TextEncoder().encode(`${lines.join('\n')}\n`)
    const imported = importTable(await openTable(csv, '표.csv'))
    const { project: file } = applyDataset(projectFile(), imported, {
      fileName: '표.csv',
      hasHeader: true,
      now: '2026-09-23T00:00:00Z',
    })
    await useProjectStore().save(file)

    const wrapper = mount(TabularPanel, { global: { plugins: [i18n] } })
    await settle()
    expect(wrapper.findComponent(ChartDialog).exists()).toBe(false)

    // 검사기의 [시각화] — 판이 그 사건을 받아 창을 연다.
    wrapper.findComponent(ColumnInspector).vm.$emit('visualize', '키')
    await settle()

    const dialog = wrapper.findComponent(ChartDialog)
    expect(dialog.exists()).toBe(true)
    const dataset = dialog.props('dataset') as unknown as { rows: unknown[] }
    expect(dataset.rows).toHaveLength(ROWS)
    expect(dialog.props('column')).toBe('키')
  })
})
