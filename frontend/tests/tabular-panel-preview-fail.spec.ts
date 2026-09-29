// @vitest-environment jsdom
/**
 * **미리보기를 못 그리는 파일은 판에 세우지 않고 말한다** (`views/data/TabularPanel.vue`의 `readFile`).
 *
 * CSV는 `openTable`이 여는 순간에는 안 읽는다 — 줄을 읽는 것은 미리보기(`previewTable`)다. 그래서
 * 앞줄에서 따옴표가 안 닫힌 파일은 여는 데 성공하고, 미리보기를 계산하는 `computed`가 **그리는
 * 도중에** `DATASET_PARSE_FAILED`를 던졌다. 전역 오류 손잡이가 없어서 배포판의 Vue는 판을 빈 주석으로
 * 바꾸고 알림은 안 떴다 — 데이터 화면이 통째로 사라지고, 다시 놓을 과녁도 함께 사라졌다.
 *
 * **진짜 입구로 잰다** — 판을 띄워 과녁에 파일을 떨어뜨린다.
 */
import 'fake-indexeddb/auto'

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import { newProjectDocument } from '../src/project/create'
import type { ProjectFile } from '../src/project/format'
import { closeStorage } from '../src/project/storage'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import TabularPanel from '../src/views/data/TabularPanel.vue'
import { resetDatabase } from './fixtures/database'
import { dropEvent, stubDialogElement } from './fixtures/image-workers'

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

async function dropInto(wrapper: ReturnType<typeof mount>, file: File): Promise<void> {
  wrapper.find('[class*="min-h-full"]').element.dispatchEvent(dropEvent([file]))
  // 읽기가 끝나 알림이 서거나 판이 설 때까지 — 고정 틱이 아니라 끝 상태를 기다린다.
  await vi.waitFor(() => {
    const settled = useToastStore().items.length > 0 || wrapper.text().includes('broken.csv')
    if (!settled) throw new Error('reading has not finished')
  })
  await flushPromises()
}

describe('TabularPanel — 미리보기를 못 그리는 파일', () => {
  it('앞줄의 따옴표가 안 닫힌 CSV는 판에 세우지 않고 DATASET_PARSE_FAILED로 말한다', async () => {
    await useProjectStore().save(emptyTabularProject())
    const wrapper = mount(TabularPanel, {
      props: { accept: '.csv' },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    await dropInto(wrapper, new File(['키,몸무게\n170,"65\n180,70\n'], 'broken.csv'))

    const errors = useToastStore()
      .items.filter((one) => one.tone === 'danger')
      .map((one) => one.key)
    expect(errors).toEqual(['errors.DATASET_PARSE_FAILED'])
    // 판이 살아 있다 — 다시 고를 단추와 과녁이 그대로 있다.
    expect(wrapper.text()).toContain('파일 선택')
    expect(wrapper.text()).not.toContain('broken.csv')
  })

  it('실패한 뒤에 멀쩡한 파일을 놓으면 미리보기가 선다', async () => {
    await useProjectStore().save(emptyTabularProject())
    const wrapper = mount(TabularPanel, {
      props: { accept: '.csv' },
      global: { plugins: [i18n] },
    })
    await flushPromises()

    await dropInto(wrapper, new File(['키,몸무게\n170,"65\n180,70\n'], 'broken.csv'))
    wrapper
      .find('[class*="min-h-full"]')
      .element.dispatchEvent(dropEvent([new File(['키,몸무게\n170,65\n'], 'good.csv')]))
    await vi.waitFor(() => {
      if (!wrapper.text().includes('good.csv')) throw new Error('preview has not appeared')
    })
    expect(wrapper.text()).toContain('몸무게')
  })
})
