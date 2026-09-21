// @vitest-environment jsdom
// `<dialog>`의 열고 닫기를 재는 스펙이라 DOM이 필요하다.
/**
 * 대화상자가 **실제로 열리는가** (`components/AppDialog.vue`).
 *
 * **이 파일은 실물에서 잡힌 결함에서 태어났다** (2026-09-22). 시각화 창이 `v-if`로
 * 만들어지면서 `open`을 처음부터 참으로 받았고, 감시자는 **값이 바뀔 때만** 깨어나므로
 * `showModal()`이 한 번도 안 불렸다 — 마크업은 다 있는데 화면에 아무것도 안 떴다.
 *
 * **검사 열여섯이 그 창을 마운트하고도 전부 초록이었다.** jsdom과 `@vue/test-utils`는
 * `<dialog>`의 열림을 안 보고 내용을 그리기 때문이다. **가짜가 진짜보다 관대한 자리**이고
 * (2026-09-14 R26의 뿌리), 그래서 여기서는 내용이 아니라 **`element.open`을 잰다.**
 */

import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import AppDialog from '../src/components/AppDialog.vue'
import { stubDialogElement } from './fixtures/image-workers'

function render(open: boolean) {
  return mount(AppDialog, { props: { open, title: '제목' } })
}

/** 지금 이 창이 열려 있는가. **내용이 아니라 `<dialog>` 자신에게 묻는다.** */
function opened(wrapper: ReturnType<typeof render>): boolean {
  return wrapper.find('dialog').element.open
}

beforeEach(stubDialogElement)

describe('열림은 `open`이 쥔다', () => {
  /** **열린 채로 태어나는 창** — `v-if`로 만들어지는 자리가 그렇다. */
  it('처음부터 열려 있으면 마운트하면서 연다', () => {
    expect(opened(render(true))).toBe(true)
  })

  it('닫힌 채로 태어나면 안 연다', () => {
    expect(opened(render(false))).toBe(false)
  })

  it('나중에 참이 되면 그때 연다', async () => {
    const wrapper = render(false)
    await wrapper.setProps({ open: true })
    expect(opened(wrapper)).toBe(true)
  })

  it('거짓이 되면 닫는다', async () => {
    const wrapper = render(true)
    await wrapper.setProps({ open: false })
    expect(opened(wrapper)).toBe(false)
  })

  /** 떠날 때 안 닫으면 화면이 잠긴다 — 라우트가 바뀌며 열린 채로 사라질 수 있다. */
  it('사라질 때 닫는다', () => {
    const wrapper = render(true)
    const element = wrapper.find('dialog').element
    wrapper.unmount()
    expect(element.open).toBe(false)
  })
})
