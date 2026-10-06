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
 * **이 프롭에도 검사가 없었다** (2026-09-22 감사). 갈래를 `'w-full max-w-2xl'` 고정으로
 * 바꿔도 전부 초록이었고, 그러면 **시각화 창이 조용히 좁은 창으로 되돌아간다** —
 * 그림은 세로로 읽는 것이라 높이가 곧 읽을 수 있는 눈금의 수다.
 */
describe('크기는 `fill`·`wide`가 쥔다', () => {
  it('기본은 좁은 창이다', () => {
    const wrapper = render(true)
    const classes = wrapper.find('dialog').classes()
    expect(classes).toContain('max-w-2xl')
    expect(classes).not.toContain('dialog-fill')
    // 넓은 창의 천장은 기본 창의 안쪽 칸에 안 붙는다 — 묻고 답하는 창은 그대로다.
    expect(wrapper.find('dialog > div').classes()).not.toContain('dialog-wide-frame')
  })

  /**
   * **넓은 창** (#38, 그리기 창). 폭만 넓고 높이는 내용만큼이다 — 안쪽 세로 칸이 창의 천장을 들어야
   * 그 안의 두 칸이 각자 구른다(`styles/utilities.css`의 `dialog-wide-frame`).
   */
  it('`wide`면 넓은 폭이고, 안쪽 칸이 천장을 든다 — `h-full`은 아니다', () => {
    const wrapper = render(true, { wide: true })
    const classes = wrapper.find('dialog').classes()
    expect(classes).toContain('max-w-7xl')
    expect(classes).not.toContain('max-w-2xl')
    expect(classes).not.toContain('dialog-fill')
    const frame = wrapper.find('dialog > div').classes()
    expect(frame).toContain('dialog-wide-frame')
    expect(frame).not.toContain('h-full')
  })

  it('`fill`과 함께 오면 `fill`이 이긴다', () => {
    const wrapper = render(true, { fill: true, wide: true })
    expect(wrapper.find('dialog').classes()).toContain('dialog-fill')
    expect(wrapper.find('dialog').classes()).not.toContain('max-w-7xl')
    expect(wrapper.find('dialog > div').classes()).toContain('h-full')
  })

  it('`fill`이면 화면을 채운다 — 좁은 창의 천장을 안 쓴다', () => {
    const classes = render(true, { fill: true }).find('dialog').classes()
    expect(classes).toContain('dialog-fill')
    expect(classes).not.toContain('max-w-2xl')
    // **`w-full`도 함께 빠진다** — 같이 서면 특이도가 같아 `width`가 죽는다.
    expect(classes).not.toContain('w-full')
  })
})

/**
 * **열릴 때 초점은 `focusPanel`이 쥔다** (#38, open-decisions.md 67 결정 14). 그리기 창은 첫 단추가
 * 붓 굵기 칸이라 열자마자 거기 링이 서서 눌린 것처럼 보였다.
 *
 * **jsdom의 `showModal`에는 초점 규칙이 없다** — 가짜(`stubDialogElement`)는 열림만 세운다. 그래서
 * 브라우저가 하는 일(첫 단추에 초점)을 가짜 위에 흉내 내고, 창이 그 초점을 놓는지를 잰다.
 * `<dialog autofocus>`로 실제 브라우저가 창 자신에 초점을 두는지는 사람 확인이다.
 */
describe('열릴 때의 초점은 `focusPanel`이 쥔다', () => {
  /** 브라우저처럼 첫 단추에 초점을 두는 `showModal`. */
  function focusFirstOnOpen(): void {
    HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement): void {
      this.open = true
      this.querySelector('button')?.focus()
    }
  }

  function withButton(extra: Record<string, unknown>) {
    return mount(AppDialog, {
      props: { open: false, title: '제목', ...extra },
      slots: { default: '<button type="button">첫 단추</button>' },
      attachTo: document.body,
    })
  }

  it('기본은 브라우저가 둔 초점을 그대로 둔다', async () => {
    focusFirstOnOpen()
    const wrapper = withButton({})
    await wrapper.setProps({ open: true })
    expect(document.activeElement?.textContent).toBe('첫 단추')
    expect(wrapper.find('dialog').attributes('autofocus')).toBeUndefined()
    wrapper.unmount()
  })

  it('`focusPanel`이면 창이 `autofocus`를 들고, 첫 단추의 초점을 놓는다', async () => {
    focusFirstOnOpen()
    const wrapper = withButton({ focusPanel: true })
    await wrapper.setProps({ open: true })
    expect(wrapper.find('dialog').attributes('autofocus')).toBeDefined()
    expect(document.activeElement?.textContent).not.toBe('첫 단추')
    wrapper.unmount()
  })
})
