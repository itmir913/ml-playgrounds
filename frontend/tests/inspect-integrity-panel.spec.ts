// @vitest-environment jsdom
// 판을 띄워서 무엇이 어느 자리에 서는지 본다.
/**
 * **무결성 판은 자기 문장대로 선다** (2026-09-18 R28 C-16).
 *
 * 설명문이 *"어느 부분이 바뀌었는지 **아래에** 함께 표시합니다"*라고 말하는데 바뀐
 * 엔트리 목록이 그 **위에** 서 있었다. 교사는 무엇인지 모르는 목록을 먼저 읽고, 그것을
 * 설명하는 문장을 지나친 뒤에 만난다.
 *
 * **화면이 자기 문구와 어긋나는 것은 눈으로 안 보인다** — 둘 다 그 자리에 멀쩡히 있다.
 */

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { i18n, setLocale } from '../src/i18n'
import type { HashCheck } from '../src/project/integrity'
import IntegrityPanel from '../src/views/inspect/IntegrityPanel.vue'

/** 한 엔트리가 바뀐 파일. **목록이 서려면 어긋난 자리가 있어야 한다.** */
const CHANGED: HashCheck = {
  status: 'MODIFIED',
  contentHash: 'a',
  computedContentHash: 'b',
  entries: [
    { path: 'runs.json', state: 'MODIFIED' },
    { path: 'manifest.json', state: 'UNCHANGED' },
  ],
}

function mountPanel(integrity: HashCheck) {
  return mount(IntegrityPanel, { props: { integrity }, global: { plugins: [i18n] } })
}

describe('무결성 판', () => {
  beforeEach(() => {
    setLocale('ko')
  })

  it('설명이 바뀐 자리 목록보다 위에 선다 - 문장이 아래라고 말한다', () => {
    const panel = mountPanel(CHANGED)
    const note = panel.find('p').element
    const list = panel.find('ul').element
    expect(list, 'no changed list to place').toBeTruthy()
    // `DOCUMENT_POSITION_FOLLOWING`: 목록이 설명문 **뒤에** 온다.
    expect(note.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    panel.unmount()
  })

  it('어긋난 자리만 이름으로 선다', () => {
    const panel = mountPanel(CHANGED)
    const items = panel.findAll('li').map((one) => one.text())
    expect(items).toHaveLength(1)
    expect(items[0]).toContain('runs.json')
    panel.unmount()
  })

  it('바뀐 자리가 없으면 목록이 아예 안 선다', () => {
    const panel = mountPanel({
      status: 'UNCHANGED',
      contentHash: 'a',
      computedContentHash: 'a',
      entries: [{ path: 'runs.json', state: 'UNCHANGED' }],
    })
    expect(panel.find('ul').exists()).toBe(false)
    expect(panel.text()).toContain(i18n.global.t('inspect.integrityNote'))
    panel.unmount()
  })
})
