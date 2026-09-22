// @vitest-environment jsdom
// 끌어다 놓기는 화면의 동작이라 띄워야 보인다.
/**
 * 점검 화면에 **파일을 끌어다 놓는다** (2026-09-22, 코드 소유자).
 *
 * **점선 테두리는 꾸밈이 아니라 약속이다.** 데이터 화면의 표 입구가 그 모양이고, 거기서
 * 점선은 *"여기 놓을 수 있다"*를 뜻한다. 점검 화면은 같은 명렬을 받는 자리인데 **테두리도
 * 받는 손도 없었다** — 교사가 제출물을 끌어다 놓으면 아무 일도 안 일어났다.
 *
 * **여기가 무는 것은 둘이다.** 놓은 파일이 실제로 명렬에 들어가는가, 그리고 **폴더를
 * 안 받는다고 말한 것이 지켜지는가**(문구가 *"파일을 끌어다 놓으세요"*라고만 말한다).
 */

import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { createPinia, setActivePinia } from 'pinia'

import { useToastStore } from '../src/stores/toasts'

import { i18n, setLocale } from '../src/i18n'
import InspectView from '../src/views/InspectView.vue'
import { submissionFile } from './fixtures/inspect-screen'

/**
 * **jsdom에는 `scrollIntoView`가 없다.** 화면이 줄을 고를 때 그것을 부르므로, 안 채워
 * 두면 처리 안 된 오류가 쌓인다 — 검사는 통과하는데 관문이 빨개지는 그 모양이다.
 * (`fixtures/inspect-screen.ts`의 같은 자리와 같은 판단이고, 그쪽은 내보내지 않는다.)
 */
function fillScrollIntoView(): void {
  if (typeof Element.prototype.scrollIntoView === 'undefined') {
    Element.prototype.scrollIntoView = () => {}
  }
}

/**
 * 끌어다 놓기 한 번.
 *
 * **`trigger('drop', { dataTransfer })`로는 안 된다** (2026-09-22에 겪었다). jsdom의
 * `DragEvent`에서 `dataTransfer`는 읽기 전용이라 **조용히 안 심기고**, 화면은 빈 놓기를
 * 받아 아무 일도 안 한다 — 검사는 *"기능이 없다"*가 아니라 *"놓아도 안 들어온다"*로
 * 보인다. 픽스처가 `input.files`에 쓰는 것과 같은 관용구로 직접 심는다.
 *
 * **읽기가 여러 턴에 걸친다.** 명렬은 파일을 열어 보고 채워지므로 가라앉을 때까지
 * 기다린다.
 */
async function dropFiles(wrapper: VueWrapper, files: File[]): Promise<void> {
  const event = new Event('drop', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files }, configurable: true })
  wrapper.find('div').element.dispatchEvent(event)
  for (let turn = 0; turn < 5; turn += 1) await flushPromises()
}

describe('점검 화면에 파일을 끌어다 놓는다', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    await setLocale('ko')
  })

  it('놓은 파일이 명렬에 들어간다', async () => {
    fillScrollIntoView()
    const wrapper = mount(InspectView, { global: { plugins: [i18n] } })
    expect(wrapper.text()).toContain('선택한 파일이 없습니다')

    await dropFiles(wrapper, [await submissionFile('가온.mlpx')])
    expect(wrapper.text()).toContain('가온.mlpx')
  })

  /** **여러 개를 그대로 받는다.** 이 화면은 원래 명렬을 받는 자리다. */
  it('여러 개를 한 번에 받는다', async () => {
    fillScrollIntoView()
    const wrapper = mount(InspectView, { global: { plugins: [i18n] } })

    await dropFiles(wrapper, [await submissionFile('가온.mlpx'), await submissionFile('나래.mlpx')])
    expect(wrapper.text()).toContain('가온.mlpx')
    expect(wrapper.text()).toContain('나래.mlpx')
  })

  /** 아무것도 안 놓았으면 아무 일도 없다 — 빈 명렬로 덮어쓰지 않는다. */
  it('빈 채로 놓으면 그대로다', async () => {
    fillScrollIntoView()
    const wrapper = mount(InspectView, { global: { plugins: [i18n] } })
    await dropFiles(wrapper, [await submissionFile('가온.mlpx')])

    await dropFiles(wrapper, [])
    expect(wrapper.text()).toContain('가온.mlpx')
  })

  /**
   * **사파리가 붙인 이름도 선다** (결정문 48). 아이패드가 `가온.mlpx`를 `가온.mlpx.zip`으로
   * 저장하는데, 그것이 조용히 떨어져 **점검 화면이 제출물을 안 열었다.**
   */
  it('사파리가 붙인 .mlpx.zip도 명렬에 들어간다', async () => {
    fillScrollIntoView()
    const wrapper = mount(InspectView, { global: { plugins: [i18n] } })

    await dropFiles(wrapper, [await submissionFile('가온.mlpx.zip')])
    expect(wrapper.text()).toContain('가온.mlpx.zip')
  })

  /**
   * **하나도 안 맞으면 말한다.** 조용히 빈 과녁으로 되돌아가면 놓은 사람은 **아무 일도
   * 안 일어난 것으로 본다** — 오늘 원인을 찾는 데 기기 로그를 끌어와야 했던 이유다.
   */
  it('프로젝트 파일이 하나도 없으면 알린다', async () => {
    fillScrollIntoView()
    const wrapper = mount(InspectView, { global: { plugins: [i18n] } })

    await dropFiles(wrapper, [new File([new Uint8Array([1, 2, 3])], '사진.zip')])
    expect(useToastStore().items.length).toBe(1)
    expect(useToastStore().items[0]?.key).toBe('inspect.noProjectFiles')
    // **빈 상태는 그대로다** — 못 받았으므로 명렬로 넘어가지 않는다.
    expect(wrapper.text()).toContain('선택한 파일이 없습니다')
  })

  /**
   * **말한 것과 되는 것이 같아야 한다.** 폴더째 끌기는 `webkitGetAsEntry`로 트리를
   * 훑어야 하는 다른 일이라 단추로 남겼고, 그래서 빈 상태의 문구도 **끌어다 놓는 것은
   * 파일**이라고만 말한다.
   */
  it('빈 상태가 끌어다 놓을 수 있는 것을 파일이라고 말한다', () => {
    fillScrollIntoView()
    const wrapper = mount(InspectView, { global: { plugins: [i18n] } })
    const next = wrapper.text()
    expect(next).toContain('끌어다 놓')
    expect(next).not.toContain('폴더를 끌어')
  })
})
