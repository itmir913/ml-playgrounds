// @vitest-environment jsdom
/**
 * **확정된 미리보기는 쪽으로 끊어 전체를 보인다** (open-decisions.md "118. 확정된 데이터 미리보기는
 * 쪽으로 끊어 전체를 보인다").
 *
 * 진짜 판을 띄워 [다음]을 누르고, 그린 줄 수와 표 아래 문장을 본다. **무관한 설정 저장은 쪽을
 * 유지한다**는 음성 검사가 `TabularPanel`의 쪽 되돌림 머리말이 가리키는 자리다 — `watch(saved)`로
 * 바꾸면 저장마다 1쪽으로 튀어 여기서 빨개진다.
 */

import 'fake-indexeddb/auto'

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { importTable, openTable } from '../src/data/table'
import { i18n, setLocale } from '../src/i18n'
import { DATA_PREVIEW_PAGE_SIZE, TABLE_PREVIEW_ROW_COUNT } from '../src/limits'
import { applyDataset } from '../src/project/dataset'
import type { ProjectFile } from '../src/project/format'
import { closeStorage } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import TabularPanel from '../src/views/data/TabularPanel.vue'
import { resetDatabase } from './fixtures/database'
import { dropEvent, stubDialogElement } from './fixtures/image-workers'
import { projectFile } from './fixtures/project'

const SIZE = DATA_PREVIEW_PAGE_SIZE

function csvOf(rows: number, first = 150): string {
  const lines = ['키,몸무게']
  for (let i = 0; i < rows; i += 1) lines.push(`${first + i},${45 + i}`)
  return `${lines.join('\n')}\n`
}

async function withDataset(base: ProjectFile, rows: number, first = 150): Promise<ProjectFile> {
  const imported = importTable(
    await openTable(new TextEncoder().encode(csvOf(rows, first)), '표.csv', { locale: 'ko' }),
  )
  return applyDataset(base, imported, {
    fileName: '표.csv',
    hasHeader: true,
    now: '2026-10-21T00:00:00Z',
  }).project
}

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

function bodyRows(wrapper: VueWrapper): string[] {
  // 검사기(`aside`)에도 표가 있다 — 미리보기 카드(`section`)의 몸통만 센다.
  return wrapper.findAll('section tbody tr').map((row) => row.find('td').text())
}

function pageButton(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('button').find((one) => one.text() === label)
  expect(found, label).toBeDefined()
  return found!
}

async function mountWith(rows: number): Promise<VueWrapper> {
  await useProjectStore().save(await withDataset(projectFile(), rows))
  const wrapper = mount(TabularPanel, { props: { accept: '.csv' }, global: { plugins: [i18n] } })
  await settle()
  return wrapper
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

describe('확정된 미리보기의 쪽 (결정 118)', () => {
  it('쪽마다 한 쪽분만 그리고, 마지막 쪽은 남은 줄이다', async () => {
    const total = SIZE * 2 + 3
    const wrapper = await mountWith(total)

    expect(bodyRows(wrapper)).toHaveLength(SIZE)
    expect(wrapper.text()).toContain(`전체 ${total}행 중 1–${SIZE}행을 표시합니다.`)
    expect(wrapper.text()).toContain('1 / 3')

    await pageButton(wrapper, '다음').trigger('click')
    await pageButton(wrapper, '다음').trigger('click')
    await settle()

    expect(bodyRows(wrapper)).toEqual([0, 1, 2].map((i) => String(150 + SIZE * 2 + i)))
    expect(wrapper.text()).toContain(`전체 ${total}행 중 ${SIZE * 2 + 1}–${total}행을 표시합니다.`)
    expect(wrapper.text()).toContain('3 / 3')
  })

  it('한 쪽에 다 들어가면 단추도 문장도 없다', async () => {
    const wrapper = await mountWith(SIZE)
    expect(bodyRows(wrapper)).toHaveLength(SIZE)
    expect(wrapper.findAll('button').some((one) => one.text() === '다음')).toBe(false)
    expect(wrapper.text()).not.toContain('행을 표시합니다.')
  })

  it('무관한 설정 저장은 보던 쪽을 유지한다', async () => {
    const wrapper = await mountWith(SIZE * 2 + 3)
    await pageButton(wrapper, '다음').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('2 / 3')

    const store = useProjectStore()
    const live = store.file!
    const settings = live.document.settings
    await store.save({
      ...live,
      document: {
        ...live.document,
        settings: { ...settings, split: { ...settings.split, randomState: 7 } },
      },
    })
    await settle()

    expect(wrapper.text()).toContain('2 / 3')
    expect(bodyRows(wrapper)[0]).toBe(String(150 + SIZE))
  })

  it('데이터를 다시 확정하면 첫 쪽으로 돌아간다', async () => {
    const wrapper = await mountWith(SIZE * 2 + 3)
    await pageButton(wrapper, '다음').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('2 / 3')

    const store = useProjectStore()
    await store.save(await withDataset(store.file!, SIZE * 3, 300))
    await settle()

    expect(wrapper.text()).toContain('1 / 3')
    expect(bodyRows(wrapper)[0]).toBe('300')
  })

  it('확정 전 훑어보기는 그대로다 - 쪽 단추가 없고 읽은 만큼의 문장이 숫자를 갖는다', async () => {
    const wrapper = await mountWith(SIZE * 2 + 3)
    wrapper
      .find('[class*="min-h-full"]')
      .element.dispatchEvent(dropEvent([new File([csvOf(TABLE_PREVIEW_ROW_COUNT * 3)], 'new.csv')]))
    await vi.waitFor(() => {
      if (!wrapper.text().includes('new.csv')) throw new Error('reading has not finished')
    })
    await settle()

    // 확정 전 캡은 머리글을 포함해 센다 — 그린 행은 하나 적다 (`probeNote`의 머리말).
    const drawn = TABLE_PREVIEW_ROW_COUNT - 1
    expect(bodyRows(wrapper)).toHaveLength(drawn)
    expect(wrapper.findAll('button').some((one) => one.text() === '다음')).toBe(false)
    const caption = i18n.global.t('data.tabular.previewProbeNote', { count: drawn }, drawn)
    expect(caption).toContain(String(drawn))
    expect(wrapper.text()).toContain(caption)
  })
})
