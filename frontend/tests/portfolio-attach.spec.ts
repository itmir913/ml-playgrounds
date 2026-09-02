// @vitest-environment jsdom
/**
 * **사진을 붙일 때 빠진 장을 말하는가** (2026-09-02 R24 B-9).
 *
 * 조건을 **뒤집어도** 관문이 초록이었다. 사진 폴더를 통째로 끌어다 놓으면 `.txt`가
 * 섞여 오는 것이 흔한 일이고, **되는 데까지 붙이는 것**이 이 화면의 결정이다 — 첫
 * 장에서 멈추면 나머지가 왜 없는지 모르고, 통째로 거절하면 한 장 때문에 아홉 장을
 * 다시 고른다. 그러니 **몇 장이 빠졌는지는 반드시 말해야 한다.**
 *
 * **굽기는 jsdom에 없다** — 캔버스가 없어 `bakeAttachments`가 언제나 빈 배열이다.
 * 그래서 여기서는 굽기를 갈아 끼우고 **판정만** 잰다. 굽는 것 자체는
 * `attachments.spec.ts`의 몫이다.
 */
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import { useProjectStore } from '../src/stores/project'
import { useToastStore } from '../src/stores/toasts'
import PortfolioView from '../src/views/PortfolioView.vue'
import SectionCard from '../src/views/portfolio/SectionCard.vue'
import { projectFile } from './fixtures/project'

/** 몇 장이 구워지는가. **검사가 정한다.** */
const oven = vi.hoisted(() => ({ bakes: 0 }))

vi.mock('../src/project/attachments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/project/attachments')>()
  return {
    ...actual,
    bakeAttachments: async (files: readonly File[]) =>
      files.slice(0, oven.bakes).map(() => ({
        bytes: new Uint8Array([1, 2, 3]),
        extension: 'webp',
        mime: 'image/webp',
      })),
  }
})

function photo(name: string): File {
  return new File([new Uint8Array([1])], name, { type: 'image/png' })
}

async function drop(files: readonly File[]) {
  useProjectStore().file = projectFile()
  const view = mount(PortfolioView, { global: { plugins: [i18n] } })
  const card = view.findComponent(SectionCard)
  expect(card.exists(), 'the fixture has one section').toBe(true)
  card.vm.$emit('attach', files)
  await view.vm.$nextTick()
  await Promise.resolve()
  await view.vm.$nextTick()
  return view
}

const cautions = () => useToastStore().items.filter((one) => one.tone === 'caution')

beforeEach(async () => {
  setActivePinia(createPinia())
  oven.bakes = 0
  await setLocale('ko')
})

describe('R24 B-9: photos that could not be read', () => {
  it('one of two is skipped: it attaches one and says one was left out', async () => {
    oven.bakes = 1
    await drop([photo('a.png'), photo('b.txt')])

    const attachments = useProjectStore().file?.attachments ?? new Map()
    expect(attachments.size).toBe(1)
    expect(cautions()).toEqual([
      expect.objectContaining({ key: 'portfolio.photoSkipped', params: { count: 1 } }),
    ])
  })

  it('all of them bake: it says nothing', async () => {
    oven.bakes = 2
    await drop([photo('a.png'), photo('b.png')])

    expect(useProjectStore().file?.attachments.size).toBe(2)
    expect(cautions()).toEqual([])
  })
})
