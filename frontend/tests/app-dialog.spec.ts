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

function render(open: boolean, extra: Record<string, unknown> = {}) {
  return mount(AppDialog, { props: { open, title: '제목', ...extra } })
}

/** 바깥을 누른 것. **`<dialog>` 자신이 대상일 때만 바깥이다** — 안쪽 요소는 안 온다. */
async function clickBackdrop(wrapper: ReturnType<typeof render>): Promise<void> {
  await wrapper.find('dialog').trigger('click')
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

/**
 * **바깥을 눌러 닫히는가.** 기본은 닫히고, `persistent`는 안 닫힌다.
 *
 * **이 프롭에 검사가 없었다** (2026-09-22 감사가 잡았다). `if (props.persistent) return`을
 * 지워도 저장소가 조용했다 — 그림을 보며 축을 바꾸는 동안 커서가 캔버스 밖으로 나가면
 * 창이 닫혀 **학생이 하던 일을 잃는데**, 그 되돌아감을 아무것도 안 막고 있었다.
 */
describe('바깥 클릭은 `persistent`가 쥔다', () => {
  it('기본은 바깥을 누르면 닫자고 올린다', async () => {
    const wrapper = render(true)
    await clickBackdrop(wrapper)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('`persistent`면 바깥을 눌러도 아무 말도 안 한다', async () => {
    const wrapper = render(true, { persistent: true })
    await clickBackdrop(wrapper)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  /** **`Esc`는 그대로 닫는다.** 나가는 길이 없는 창을 만드는 것이 아니다. */
  it('`persistent`여도 `<dialog>`가 스스로 닫으면 그대로 올린다', async () => {
    const wrapper = render(true, { persistent: true })
    await wrapper.find('dialog').trigger('close')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

/**
 * **창의 크기를 `fill`이 쥔다.**
 *
 * **이 프롭에도 검사가 없었다** (2026-09-22 감사). 갈래를 `'w-full max-w-lg'` 고정으로
 * 바꿔도 전부 초록이었고, 그러면 **시각화 창이 조용히 좁은 창으로 되돌아간다** —
 * 그림은 세로로 읽는 것이라 높이가 곧 읽을 수 있는 눈금의 수다.
 */
describe('크기는 `fill`이 쥔다', () => {
  it('기본은 좁은 창이다', () => {
    const classes = render(true).find('dialog').classes()
    expect(classes).toContain('max-w-lg')
    expect(classes).not.toContain('dialog-fill')
  })

  it('`fill`이면 화면을 채운다 — 좁은 창의 천장을 안 쓴다', () => {
    const classes = render(true, { fill: true }).find('dialog').classes()
    expect(classes).toContain('dialog-fill')
    expect(classes).not.toContain('max-w-lg')
    // **`w-full`도 함께 빠진다** — 같이 서면 특이도가 같아 `width`가 죽는다.
    expect(classes).not.toContain('w-full')
  })
})
